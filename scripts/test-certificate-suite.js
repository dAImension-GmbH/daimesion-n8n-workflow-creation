#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PDF_DIR = process.env.CERTIFICATE_PDF_DIR || "/Users/mdklause/Downloads";
const cases = JSON.parse(readFileSync(path.join(ROOT, "evaluations/certificate-ground-truth.json"), "utf8"));
const workflow = JSON.parse(readFileSync(path.join(ROOT, "workflows/outlook-certificate-analysis.json"), "utf8"));
const evaluator = workflow.nodes.find((node) => node.name === "Evaluation deterministisch bewerten")?.parameters?.jsCode;
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

for (const node of workflow.nodes.filter((entry) => entry.type === "n8n-nodes-base.code" && typeof entry.parameters?.jsCode === "string")) {
  try { new AsyncFunction("$input", "$", node.parameters.jsCode); }
  catch (error) { throw new Error(`${node.name}: generated Code node does not compile: ${error.message}`); }
}

if (!evaluator) throw new Error("Deterministic certificate evaluator is missing from the workflow. Run npm run prepare:evaluations.");
if (cases.length !== 9) throw new Error(`Expected nine certificate cases, found ${cases.length}.`);
for (const nodeName of ["Zeugnis in Belegblöcke teilen", "Belege sammeln und Normalisierung bauen", "Qualitätsprüfung vorbereiten"]) {
  const code = workflow.nodes.find((node) => node.name === nodeName)?.parameters?.jsCode ?? "";
  if (!code.includes("Zulassungsnummern dürfen es nicht ersetzen")) throw new Error(`${nodeName}: approval-certificate exclusion is missing.`);
  if (!code.includes("das früheste Abnahmeprüfzeugnis")) throw new Error(`${nodeName}: cover-certificate precedence rule is missing.`);
  if (!code.includes("Mechanische Istwerte niemals runden")) throw new Error(`${nodeName}: specimen-location rule is missing.`);
  if (!code.includes("yieldStrength10 den kleinsten dieser belegten Istwerte")) throw new Error(`${nodeName}: Rp1.0 extraction rule is missing.`);
  if (!code.includes("Bei parallel angeordneten Mechanikspalten")) throw new Error(`${nodeName}: paired mechanical-column rule is missing.`);
  if (!code.includes("isPrimaryAcceptanceBlock=true nur")) throw new Error(`${nodeName}: primary acceptance-block rule is missing.`);
  if (!code.includes("Bestell-Nr./Customer Order/P.O.")) throw new Error(`${nodeName}: header-label disambiguation rule is missing.`);
  if (!code.includes("Werkstoffspezifikationen, die in der Material-/B02-Zeile stehen")) throw new Error(`${nodeName}: material-standard extraction rule is missing.`);
  if (code.includes("den kleinsten Wert")) throw new Error(`${nodeName}: obsolete cross-location minimum rule is still present.`);
}
const extractionCode = workflow.nodes.find((node) => node.name === "Zeugnis in Belegblöcke teilen")?.parameters?.jsCode ?? "";
if (!extractionCode.includes("gaugeLengthType") || !extractionCode.includes("yieldStrength10Explicit")) {
  throw new Error("Evidence extraction does not preserve tensile-test gauge and Rp1.0 column provenance.");
}
if (!extractionCode.includes("Mehrzeilige Tabellenzellen sind mehrere Prüfzeilen")) {
  throw new Error("Evidence extraction does not split vertically stacked mechanical values into separate test rows.");
}
for (const nodeName of ["Belege sammeln und Normalisierung bauen", "Qualitätsprüfung vorbereiten"]) {
  const code = workflow.nodes.find((node) => node.name === nodeName)?.parameters?.jsCode ?? "";
  if (!code.includes("mechanicalSelection") || !code.includes("feldweise Minimum")) throw new Error(`${nodeName}: deterministic mechanical trace contract is missing.`);
  if (!code.includes("deckSelection") || !code.includes("documentRole=DECK")) throw new Error(`${nodeName}: deterministic deck-certificate trace contract is missing.`);
}
const uploadCode = workflow.nodes.find((node) => node.name === "PDF-Upload vorbereiten")?.parameters?.jsCode ?? "";
if (!uploadCode.includes("normalizeLandscapeScanRotation") || !uploadCode.includes("landscape-scan-270-to-180") || !uploadCode.includes("hasPortraitScannerPage")) {
  throw new Error("Sideways landscape scan rotation normalization is missing before MinerU upload.");
}
if (!uploadCode.includes("hasInvalidClassicXref") || !uploadCode.includes("invalid-classic-xref-rebuilt")) {
  throw new Error("Invalid classic XRef repair is missing before MinerU upload.");
}
if ((uploadCode.match(/rotationNormalizedPages:/g) ?? []).length !== 1) {
  throw new Error("PDF upload metadata contains duplicate rotation-normalization fields.");
}

function buildClassicXrefPdf(invalidMissingEntry) {
  const chunks = [];
  const offsets = new Map();
  let length = 0;
  const push = (value) => {
    const bytes = Buffer.from(value, "latin1");
    chunks.push(bytes);
    length += bytes.length;
  };
  push("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n");
  for (const [number, body] of [
    [1, "<< /Type /Catalog /Pages 2 0 R >>"],
    [2, "<< /Type /Pages /Kids [3 0 R] /Count 1 >>"],
    [3, "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 10 10] >>"],
  ]) {
    offsets.set(number, length);
    push(`${number} 0 obj\n${body}\nendobj\n`);
  }
  const xrefOffset = length;
  push("xref\n0 5\n0000000000 65535 f \n");
  for (let number = 1; number <= 3; number++) {
    push(`${String(offsets.get(number)).padStart(10, "0")} 00000 n \n`);
  }
  push(invalidMissingEntry ? "0000000000 00000 n \n" : "0000000000 00000 f \n");
  push(`trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`);
  return Buffer.concat(chunks);
}

async function runPdfUploadPreparation(pdf) {
  const inputItem = {
    json: { correlationKey: "classic-xref-regression", subject: "Classic XRef regression" },
    binary: { data: { fileName: "classic-xref.pdf", mimeType: "application/pdf" } },
  };
  const execute = new AsyncFunction("$input", "$", uploadCode);
  return execute.call({
    helpers: {
      getBinaryDataBuffer: async () => pdf,
      prepareBinaryData: async (data, fileName, mimeType) => ({
        fileName,
        mimeType,
        buffer: Buffer.from(data),
      }),
    },
  }, {
    first: () => inputItem,
    all: () => [inputItem],
  }, () => ({ first: () => undefined, all: () => [] }));
}

const malformedClassicPdf = buildClassicXrefPdf(true);
const repairedClassicResult = await runPdfUploadPreparation(malformedClassicPdf);
const repairedClassicItem = repairedClassicResult[0];
const repairedClassicPdf = repairedClassicItem?.binary?.data?.buffer;
const repairedClassicMetadata = JSON.parse(repairedClassicItem?.json?.pdfAdditionalInformation ?? "{}");
if (!Buffer.isBuffer(repairedClassicPdf) || repairedClassicPdf.equals(malformedClassicPdf)) {
  throw new Error("Malformed classic XRef PDF was not rewritten.");
}
if (repairedClassicMetadata.pdfNormalization !== "invalid-classic-xref-rebuilt" || repairedClassicItem?.json?.pdfNormalizationApplied !== true) {
  throw new Error("Malformed classic XRef repair was not reported in upload metadata.");
}
if (/0000000000 00000 n/.test(repairedClassicPdf.toString("latin1"))) {
  throw new Error("Rewritten classic XRef still marks a zero-offset object as in use.");
}
const repairedStartXref = Number(repairedClassicPdf.toString("latin1").match(/startxref\s+(\d+)\s+%%EOF\s*$/)?.[1]);
if (!Number.isSafeInteger(repairedStartXref) || repairedClassicPdf.subarray(repairedStartXref, repairedStartXref + 4).toString("ascii") !== "xref") {
  throw new Error("Rewritten classic PDF has an invalid startxref target.");
}

const healthyClassicPdf = buildClassicXrefPdf(false);
const healthyClassicResult = await runPdfUploadPreparation(healthyClassicPdf);
const healthyClassicItem = healthyClassicResult[0];
if (!healthyClassicItem?.binary?.data?.buffer?.equals(healthyClassicPdf) || healthyClassicItem?.json?.pdfNormalizationApplied !== false) {
  throw new Error("Healthy classic XRef PDF should remain byte-identical.");
}
const mineruErrorCode = workflow.nodes.find((node) => node.name === "MinerU-Fehler vorbereiten")?.parameters?.jsCode ?? "";
if (!mineruErrorCode.includes("Evaluations-PDF vorbereiten")) throw new Error("MinerU error handling is not safe on the evaluation branch.");

const scalar = (value) => Array.isArray(value) ? Math.min(...value) : value;
const actualFor = (testCase) => ({
  correlationKey: testCase.correlationKey,
  results: testCase.expected.positions.map((position) => ({
    heatNumber: position.heatNumber,
    quantity: position.quantity,
    yieldStrength02: position.yieldStrength02 === undefined ? -1 : scalar(position.yieldStrength02),
    yieldStrength10: position.yieldStrength10 === undefined ? -1 : scalar(position.yieldStrength10),
    tensileStrength: position.tensileStrength === undefined ? -1 : scalar(position.tensileStrength),
    elongation: position.elongation === undefined ? -1 : scalar(position.elongation),
    certificateNumber: testCase.expected.certificateNumber,
    rawMaterialCertificate: testCase.expected.rawMaterialCertificate ?? "-1",
    customerOrderNumber: testCase.expected.customerOrderNumber,
    creditor: testCase.expected.creditor ?? "-1",
    product: position.product ?? "-1",
    dimensions: position.dimensions ?? "-1",
    werkstoff1: position.material ?? "-1",
    werkstoff2: "-1",
    werkstoff3: "-1",
    werkstoff4: "-1",
    werkstoff5: "-1",
    ...Object.fromEntries(Array.from({ length: 5 }, (_, index) => [`norm${index + 1}`, position.standards?.[index] ?? "-1"])),
    humanRequired: true,
    chemicals: structuredClone(position.chemicals ?? {}),
  })),
});

async function evaluate(testCase, actual) {
  const nodes = {
    "Ergebnis validieren und Dokumentenreview vorbereiten": [{ json: actual }],
    "When fetching a dataset row": [{ json: { expectedAnswer: JSON.stringify(testCase.expected) } }],
  };
  const selectNode = (name) => ({
    first: () => {
      const item = nodes[name]?.[0];
      if (!item) throw new Error(`Node ${name} did not execute.`);
      return item;
    },
  });
  const factory = new Function("$input", "$", `return async function () {\n${evaluator}\n}`);
  return factory({ first: () => ({ json: {} }) }, selectNode)();
}

let textPdfCount = 0;
let ocrPdfCount = 0;
for (const testCase of cases) {
  for (const position of testCase.expected.positions) {
    if (!position.chemicals || Object.keys(position.chemicals).length === 0) {
      throw new Error(`${testCase.caseId}/${position.heatNumber}: chemical ground truth is missing.`);
    }
  }
  const pdfPath = path.join(PDF_DIR, testCase.fileName);
  const pdf = readFileSync(pdfPath);
  if (pdf.subarray(0, 4).toString("ascii") !== "%PDF") throw new Error(`${pdfPath} is not a PDF.`);
  const text = execFileSync("pdftotext", ["-layout", pdfPath, "-"], { encoding: "utf8", maxBuffer: 20 * 1024 * 1024 });
  if (text.trim().length < 50) ocrPdfCount++;
  else textPdfCount++;

  const actual = actualFor(testCase);
  const positive = (await evaluate(testCase, actual))[0]?.json;
  if (positive?.passed !== 1 || positive?.score !== 5 || positive?.correctness !== 1 || positive?.chemistryPassed !== 1 || positive?.chemistryScore !== 1) {
    throw new Error(`${testCase.caseId}: valid result did not pass: ${positive?.reasoning}`);
  }

  const negative = structuredClone(actual);
  negative.results[0].quantity = Number(negative.results[0].quantity) + 1;
  const rejected = (await evaluate(testCase, negative))[0]?.json;
  if (rejected?.passed !== 0 || !rejected?.missingOrWrongFacts?.some((fact) => fact.includes("quantity"))) {
    throw new Error(`${testCase.caseId}: incorrect quantity was not rejected.`);
  }

  const wrongChemistry = structuredClone(actual);
  const [firstElement, firstValue] = Object.entries(testCase.expected.positions[0].chemicals)[0];
  wrongChemistry.results[0].chemicals[firstElement] = firstValue === 0 ? 1 : Number(firstValue) * 100;
  const chemistryRejected = (await evaluate(testCase, wrongChemistry))[0]?.json;
  if (chemistryRejected?.passed !== 0 || chemistryRejected?.chemistryPassed !== 0 || chemistryRejected?.chemistryScore >= 1 || chemistryRejected?.score > 3) {
    throw new Error(`${testCase.caseId}: incorrect chemical value was not a hard failure.`);
  }
  if (!chemistryRejected?.missingOrWrongChemistryFacts?.some((fact) => fact.includes(`chemicals.${firstElement}`))) {
    throw new Error(`${testCase.caseId}: incorrect chemical value was not reported for ${firstElement}.`);
  }

  const missingChemistry = structuredClone(actual);
  delete missingChemistry.results[0].chemicals[firstElement];
  const missingRejected = (await evaluate(testCase, missingChemistry))[0]?.json;
  if (missingRejected?.passed !== 0 || missingRejected?.chemistryPassed !== 0) {
    throw new Error(`${testCase.caseId}: missing chemical value was not a hard failure.`);
  }
}

const unicornCase = cases.find((entry) => entry.caseId === "unicorn-2026-102898");
const swappedChemistry = actualFor(unicornCase);
[swappedChemistry.results[0].chemicals, swappedChemistry.results[1].chemicals] = [swappedChemistry.results[1].chemicals, swappedChemistry.results[0].chemicals];
const swappedRejected = (await evaluate(unicornCase, swappedChemistry))[0]?.json;
if (swappedRejected?.passed !== 0 || swappedRejected?.chemistryPassed !== 0) {
  throw new Error("Chemical values assigned to the wrong heat were not rejected.");
}

for (const [caseId, equivalentProduct] of [
  ["starofit-26030318", "Exzentrisches Reduzierstück, DIN EN 10253-2:2021-11 Typ A, nahtlos"],
  ["bk-tuev-w089986", "T-STUCK"],
  ["jmd-100000125315", "1 Inch Welding Neck Flange 150 Class Sch-40s Raised Face"],
]) {
  const testCase = cases.find((entry) => entry.caseId === caseId);
  if (!testCase) throw new Error(`Missing product-equivalence regression case ${caseId}.`);
  const actual = actualFor(testCase);
  actual.results[0].product = equivalentProduct;
  const result = (await evaluate(testCase, actual))[0]?.json;
  if (result?.passed !== 1) throw new Error(`${caseId}: equivalent product wording was rejected: ${result?.reasoning}`);
}

console.log(`Nine-case deterministic certificate suite passed (${textPdfCount} text PDFs, ${ocrPdfCount} OCR-required PDFs).`);
