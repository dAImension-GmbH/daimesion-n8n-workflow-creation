#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pdfPath = process.argv[2];
const resultPath = process.argv[3];

if (!pdfPath) {
  throw new Error("Usage: node scripts/test-certificate-regression.js /absolute/path/to/certificate.pdf [result.json]");
}

const text = execFileSync("pdftotext", ["-layout", pdfPath, "-"], {
  encoding: "utf8",
  maxBuffer: 5 * 1024 * 1024,
});
const workflow = JSON.parse(readFileSync(path.join(ROOT, "workflows/outlook-certificate-analysis.json"), "utf8"));
const nodeCode = Object.fromEntries(workflow.nodes.map((node) => [node.name, node.parameters?.jsCode ?? ""]));

const failures = [];
function requireMatch(label, value, pattern) {
  if (!pattern.test(value)) failures.push(`${label}: ${pattern}`);
}

async function runCodeNode(name, inputItems, outputs = {}) {
  const code = nodeCode[name];
  const input = {
    first: () => inputItems[0],
    all: () => inputItems,
  };
  const selectNode = (nodeName) => ({
    first: () => outputs[nodeName]?.[0],
    all: () => outputs[nodeName] ?? [],
  });
  const factory = new Function("$input", "$", `return async function () {\n${code}\n}`);
  return factory(input, selectNode)();
}

for (const node of workflow.nodes.filter((entry) => entry.type === "n8n-nodes-base.code")) {
  try {
    new Function(`return async function () {\n${node.parameters.jsCode}\n}`);
  } catch (error) {
    failures.push(`${node.name}: invalid JavaScript (${error.message})`);
  }
}

if (/Report Number:\s*2026\s*-\s*102898/i.test(text)) {
  requireMatch("Unicorn report number", text, /Report Number:\s*2026\s*-\s*102898/i);
  requireMatch("customer order", text, /PO-25-RFS003046/);
  requireMatch("heat 475670 position", text, /Material:\s+Heat:[\s\S]{0,1000}1\.4541\s+475670[\s\S]{0,300}193,7\s*x\s*22,2\s*mm/i);
  requireMatch("heat 901972 position", text, /1\.4541\s+901972[\s\S]{0,300}133,0\s*x\s*14,2\s*mm/i);
  requireMatch("heat 475670 chemistry", text, /475670[\s\S]{0,9000}0\.044\s+0\.24\s+1\.27\s+0\.036\s+0\.005\s+17\.60\s+0\.42\s+9\.84/i);
  requireMatch("heat 901972 chemistry", text, /CHARGENº\.:901972[\s\S]{0,3000}0,043\s+1,590\s+0,406\s+0,031\s+0,021\s+17,110\s+9,060/i);
  requireMatch("heat 475670 mechanics", text, /Rp0\.2[\s\S]{0,700}233\s+278\s+529\s+42\.9/i);
  requireMatch("heat 901972 mechanics", text, /Rp\(0,2%\)\s+259MPa[\s\S]{0,100}1%\s+293MPa[\s\S]{0,100}50,1%/i);

  const pair = {
    certificate: {
      markdown: text,
      mailId: "unicorn-regression-mail",
      subject: "Unicorn inspection certificate",
      fileName: path.basename(pdfPath),
      mineruEndpoint: "local-regression",
      mineruModel: "pdftotext-layout",
    },
    additionalInfo: null,
  };
  const chunkItems = await runCodeNode("Zeugnis in Belegblöcke teilen", [{
    json: { correlationKey: "PO-25-RFS003046", replyMailId: "unicorn-regression-mail", pair },
  }]);
  if (chunkItems.length < 3) failures.push("chunking: expected the eight-page composite certificate to produce at least three evidence blocks");
  for (const [index, item] of chunkItems.entries()) {
    const userPrompt = item.json.llmRequest?.messages?.[1]?.content ?? "";
    requireMatch(`chunk ${index + 1} document header`, userPrompt, /<DOKUMENTKOPF>[\s\S]*2026\s*-\s*102898/);
  }

  const malformedEvidence = '{"certificate":{"certificateNumber":{"value":"2026-102898" "sourceQuote":"Report Number"}}}';
  const fakeEvidenceResponses = chunkItems.map((_, index) => ({
    json: index === 0 ? { choices: [{ message: { content: malformedEvidence } }] } : {},
  }));
  const collected = await runCodeNode(
    "Belege sammeln und Normalisierung bauen",
    fakeEvidenceResponses,
    { "Zeugnis in Belegblöcke teilen": chunkItems },
  );
  const collectedJson = collected[0]?.json ?? {};
  const firstEvidence = collectedJson.evidence?.chunks?.[0] ?? {};
  if (firstEvidence.certificate?.certificateNumber?.value !== "2026-102898") {
    failures.push("JSON repair: missing comma in evidence response was not repaired");
  }
  requireMatch("critical source contains second heat", collectedJson.criticalSource ?? "", /CHARGENº\.:901972/);
  requireMatch("critical source contains first heat", collectedJson.criticalSource ?? "", /Schmelzen-Nr\.[\s\S]{0,300}475670/);

  const baseRow = {
    heatNumber: "475670",
    chemicals: { C: 0.044, SI: 0.24, MN: 1.27, P: 0.036, S: 0.005, CR: 17.6, MO: 0.42, NI: 9.84, CU: 0.38, V: 0.05, W: 0.04, CO: 0.18, AL: 0.045, N: 0.0094, TI: 0.43 },
    yieldStrength02: 233,
    yieldStrength10: 278,
    tensileStrength: 529,
    elongation: 42.9,
    certificateNumber: "2026-102898",
    quantity: 2,
    creditor: "Unicorn GmbH Tailormade Processing",
    product: "Hülse aus Rundstahl gedreht",
    humanRequired: false,
    customerOrderNumber: "PO-25-RFS003046",
    dimensions: "193,7 x 22,2 mm",
    werkstoff1: "1.4541",
    werkstoff2: "-1",
    werkstoff3: "-1",
    werkstoff4: "-1",
    werkstoff5: "-1",
    norm1: "DIN EN 10204 3.1",
    norm2: "ISO 10474",
    norm3: "DGRL 2014/68 EU",
    norm4: "AD 2000 W0",
    norm5: "ISO 9001:2015",
  };
  const secondRow = {
    ...baseRow,
    heatNumber: "901972",
    chemicals: { C: 0.043, SI: 0.406, MN: 1.59, P: 0.031, S: 0.021, CR: 17.11, NI: 9.06, CO: 0.249, TI: 0.436, N: 0.01 },
    yieldStrength02: 255,
    yieldStrength10: 290,
    tensileStrength: 564,
    elongation: 50.1,
    dimensions: "133,0 x 14,2 mm",
  };
  const validationContext = { ...collectedJson, orderData: { poNumber: "PO-25-RFS003046" }, replyMailId: "unicorn-regression-mail" };
  const malformedFinal = JSON.stringify({ results: [baseRow, secondRow] }).replace(',"chemicals"', ' "chemicals"');
  const validated = await runCodeNode(
    "Ergebnis validieren und Dokumentenreview vorbereiten",
    [{ json: { choices: [{ message: { content: malformedFinal } }] } }],
    { "Qualitätsprüfung vorbereiten": [{ json: validationContext }] },
  );
  const validatedRows = validated[0]?.json?.results ?? [];
  if (validatedRows.length !== 2) failures.push(`final validation: expected 2 positions, got ${validatedRows.length}`);
  if (validatedRows[0]?.dimensions !== "193.7 x 22.2 mm") failures.push(`final validation: unexpected first dimensions ${validatedRows[0]?.dimensions}`);
  if (validatedRows[1]?.dimensions !== "133.0 x 14.2 mm") failures.push(`final validation: unexpected second dimensions ${validatedRows[1]?.dimensions}`);

  const repeatedHeatRows = [baseRow, { ...baseRow, dimensions: "133,0 x 14,2 mm", quantity: 3 }];
  const repeated = await runCodeNode(
    "Ergebnis validieren und Dokumentenreview vorbereiten",
    [{ json: { choices: [{ message: { content: JSON.stringify({ results: repeatedHeatRows }) } }] } }],
    { "Qualitätsprüfung vorbereiten": [{ json: validationContext }] },
  );
  if (repeated[0]?.json?.results?.length !== 2) failures.push("same-heat positions: a repeated heat number was deduplicated");
  if (repeated[0]?.json?.results?.some((row) => row.humanRequired)) failures.push("same-heat positions: repeated heat number was incorrectly marked as requiring review");

  const chunkPrompt = nodeCode["Zeugnis in Belegblöcke teilen"];
  const normalizePrompt = nodeCode["Belege sammeln und Normalisierung bauen"];
  const qualityPrompt = nodeCode["Qualitätsprüfung vorbereiten"];
  requireMatch("extraction composite-certificate rule", chunkPrompt, /Deckzeugnis[\s\S]*Vormaterialzeugnissen/);
  requireMatch("extraction position identity", chunkPrompt, /Item-\/Positionsnummer[\s\S]*positionNumber/);
  requireMatch("normalization repeated-heat position rule", normalizePrompt, /Dieselbe Schmelznummer[\s\S]*jede Position/);
  requireMatch("quality repeated-heat position rule", qualityPrompt, /Gleiche Schmelznummern[\s\S]*getrennte Zeilen/);
  requireMatch("room-temperature range", normalizePrompt, /20 bis 23 °C/);
  requireMatch("piece quantity support", chunkPrompt, /Stück\/Qty\/PCS/);

  if (failures.length) {
    console.error(`Certificate regression failed (${failures.length}):`);
    for (const failure of failures) console.error(`- ${failure}`);
    process.exit(1);
  }

  const expected = {
    certificateNumber: "2026-102898",
    customerOrderNumber: "PO-25-RFS003046",
    creditor: "Unicorn GmbH Tailormade Processing",
    positions: validatedRows.map((row) => ({
      heatNumber: row.heatNumber,
      quantity: row.quantity,
      dimensions: row.dimensions,
      yieldStrength02: row.yieldStrength02,
      yieldStrength10: row.yieldStrength10,
      tensileStrength: row.tensileStrength,
      elongation: row.elongation,
      chemicals: row.chemicals,
    })),
  };
  if (resultPath) {
    const actual = JSON.parse(readFileSync(resultPath, "utf8"));
    const expectedDimensions = new Map([["475670", "193.7 x 22.2 mm"], ["901972", "133.0 x 14.2 mm"]]);
    for (const [heat, dimensions] of expectedDimensions) {
      const row = actual.results?.find((entry) => entry.heatNumber === heat && entry.dimensions === dimensions);
      if (!row) failures.push(`end-to-end result: missing position ${heat} / ${dimensions}`);
      else if (row.quantity !== 2) failures.push(`end-to-end result: ${heat}.quantity ${row.quantity} != 2`);
    }
    if (actual.results?.length !== 2) failures.push(`end-to-end result: row count ${actual.results?.length} != 2`);
    if (failures.length) {
      console.error(`End-to-end result comparison failed (${failures.length}):`);
      for (const failure of failures) console.error(`- ${failure}`);
      process.exit(1);
    }
    console.log(`End-to-end result matches the Unicorn certificate ground truth: ${resultPath}`);
  }
  console.log("Unicorn composite-certificate source, prompts, JSON repair, and repeated-heat position handling passed.");
  console.log(JSON.stringify(expected, null, 2));
  process.exit(0);
}

requireMatch("certificate number", text, /02-26-15374/);
requireMatch("customer order", text, /PO-26-RFS004402/);
requireMatch("metric dimensions", text, /57\.00mm\s+O\.D\.\s+x\s+8\.00mm\s+W\.T\./i);
requireMatch("heat 760491 H chemistry", text, /760491\s+H\s+18\s+73\s+21\s+13\s+10\s+27\s+13\s+8\s+1\s+8\s+31\s+92/);
requireMatch("heat 761392 H chemistry", text, /761392\s+H\s+17\s+73\s+19\s+20\s+16\s+27\s+13\s+8\s+3\s+9\s+30\s+96/);
requireMatch("heat quantities", text, /760491\s*\/\s*13\s+16\s+207\.67\s+2036[\s\S]{0,300}761392\s*\/\s*15\s+22\s+285\.54\s+2760/);
requireMatch("heat 760491 room-temperature tests", text, /760491[\s\S]{0,160}\+20\s+341\.00\s+526\.00[\s\S]{0,180}760491[\s\S]{0,160}\+20\s+334\.00\s+521\.00/);
requireMatch("heat 761392 room-temperature tests", text, /761392[\s\S]{0,160}\+20\s+360\.00\s+520\.00[\s\S]{0,180}761392[\s\S]{0,160}\+20\s+352\.00\s+519\.00/);

const pair = {
  certificate: {
    markdown: text,
    mailId: "regression-mail",
    subject: "Regression certificate",
    fileName: path.basename(pdfPath),
    mineruEndpoint: "local-regression",
    mineruModel: "pdftotext-layout",
  },
  additionalInfo: null,
};
const chunkItems = await runCodeNode("Zeugnis in Belegblöcke teilen", [{
  json: { correlationKey: "PO-26-RFS004402", replyMailId: "regression-mail", pair },
}]);
if (chunkItems.length < 2) failures.push("chunking: expected a multi-page certificate to produce multiple evidence blocks");
for (const [index, item] of chunkItems.entries()) {
  const userPrompt = item.json.llmRequest?.messages?.[1]?.content ?? "";
  requireMatch(`chunk ${index + 1} document header`, userPrompt, /<DOKUMENTKOPF>[\s\S]*02-26-15374/);
}

const fakeEvidenceResponses = chunkItems.map(() => ({ json: {} }));
const collected = await runCodeNode(
  "Belege sammeln und Normalisierung bauen",
  fakeEvidenceResponses,
  { "Zeugnis in Belegblöcke teilen": chunkItems },
);
const criticalSource = collected[0]?.json?.criticalSource ?? "";
requireMatch("critical source chemical table", criticalSource, /CHEMICAL COMPOSITION|CHEMISCHE ZUSAMMENSETZUNG/i);
requireMatch("critical source tensile table", criticalSource, /TENSILE TEST|ZUGVERSUCH/i);
requireMatch("critical source per-heat quantities", criticalSource, /760491\s*\/\s*13\s+16\s+207\.67/);

const candidateRow = {
  heatNumber: "760491",
  chemicals: { C: 0.18, Si: 0.21, Mn: 0.73 },
  yieldStrength02: 334,
  yieldStrength10: -1,
  tensileStrength: 521,
  elongation: 27.5,
  certificateNumber: "02-26-15374",
  quantity: 207.67,
  creditor: "Silcotub S.A. Plant",
  product: "Seamless hot finished steel tubes for boilers",
  humanRequired: false,
  customerOrderNumber: "PO-26-RFS004402",
  dimensions: "57.00 x 8.00 mm",
  werkstoff1: "16Mo3 TC2",
  werkstoff2: "-1",
  werkstoff3: "-1",
  werkstoff4: "-1",
  werkstoff5: "-1",
  norm1: "EN 10216-2 TC2",
  norm2: "-1",
  norm3: "-1",
  norm4: "-1",
  norm5: "-1",
};
const validationContext = {
  ...collected[0].json,
  orderData: { poNumber: "PO-26-RFS004402" },
  replyMailId: "regression-mail",
};
const validated = await runCodeNode(
  "Ergebnis validieren und Dokumentenreview vorbereiten",
  [{ json: { choices: [{ message: { content: JSON.stringify({ results: [candidateRow] }) } }] } }],
  { "Qualitätsprüfung vorbereiten": [{ json: validationContext }] },
);
const validatedRow = validated[0]?.json?.results?.[0] ?? {};
if (validatedRow.chemicals?.SI !== 0.21 || validatedRow.chemicals?.MN !== 0.73) {
  failures.push("final validation: mixed-case element symbols Si/Mn were not normalized to SI/MN");
}
if (validatedRow.dimensions !== "57.00 x 8.00 mm") {
  failures.push(`final validation: unexpected metric dimensions ${validatedRow.dimensions}`);
}

const chunkPrompt = nodeCode["Zeugnis in Belegblöcke teilen"];
const normalizePrompt = nodeCode["Belege sammeln und Normalisierung bauen"];
const qualityPrompt = nodeCode["Qualitätsprüfung vorbereiten"];
for (const [label, code] of [["extraction prompt", chunkPrompt], ["normalization prompt", normalizePrompt], ["quality prompt", qualityPrompt]]) {
  requireMatch(`${label} H rule`, code, /H\/Heat/i);
  requireMatch(`${label} P exclusion`, code, /(?:niemals|keine)\s+P\/?-?Product|keine\s+P-?\/Product/i);
  requireMatch(`${label} X100 example`, code, /18\/X100\s*=\s*0\.18|raw 18 unter X 100 ergibt 0\.18/i);
  requireMatch(`${label} X1000 example`, code, /13\/X1000\s*=\s*0\.013|raw 13 unter X 1000 ergibt 0\.013/i);
  requireMatch(`${label} X10000 example`, code, /92\/X10000\s*=\s*0\.0092|raw 92 unter X 10000 ergibt 0\.0092/i);
  requireMatch(`${label} per-heat metres`, code, /schmelzenspezifische[nr]?\s+(?:MT-Spalte|Länge)|MT(?:-Spalte)?\s+je\s+Schmelze/i);
}
requireMatch("critical source passed to normalization", normalizePrompt, /<ORIGINALAUSSCHNITTE>/);
requireMatch("critical source passed to quality check", qualityPrompt, /<ORIGINALAUSSCHNITTE>/);
requireMatch("complete Note 2 normalization", normalizePrompt, /TEMPLATE BUHLMANN-007 REV\.10/);
requireMatch("complete Note 2 quality check", qualityPrompt, /TEMPLATE BUHLMANN-007 REV\.10/);

if (failures.length) {
  console.error(`Certificate regression failed (${failures.length}):`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

const expected = {
  certificateNumber: "02-26-15374",
  customerOrderNumber: "PO-26-RFS004402",
  dimensions: "57 x 8 mm",
  heats: [
    {
      heatNumber: "760491",
      quantity: 207.67,
      yieldStrength02: 334,
      tensileStrength: 521,
      elongation: 27.5,
      chemicals: { C: 0.18, MN: 0.73, SI: 0.21, NI: 0.13, CR: 0.1, MO: 0.27, CU: 0.13, P: 0.008, S: 0.001, SN: 0.008, AL: 0.031, N: 0.0092 },
    },
    {
      heatNumber: "761392",
      quantity: 285.54,
      yieldStrength02: 352,
      tensileStrength: 519,
      elongation: 27,
      chemicals: { C: 0.17, MN: 0.73, SI: 0.19, NI: 0.2, CR: 0.16, MO: 0.27, CU: 0.13, P: 0.008, S: 0.003, SN: 0.009, AL: 0.03, N: 0.0096 },
    },
  ],
};

if (resultPath) {
  const actual = JSON.parse(readFileSync(resultPath, "utf8"));
  const comparisonFailures = [];
  const close = (left, right) => Math.abs(Number(left) - Number(right)) < 1e-9;
  for (const expectedRow of expected.heats) {
    const actualRow = actual.results?.find((row) => row.heatNumber === expectedRow.heatNumber);
    if (!actualRow) {
      comparisonFailures.push(`missing heat ${expectedRow.heatNumber}`);
      continue;
    }
    for (const key of ["quantity", "yieldStrength02", "tensileStrength", "elongation"]) {
      if (!close(actualRow[key], expectedRow[key])) comparisonFailures.push(`${expectedRow.heatNumber}.${key}: ${actualRow[key]} != ${expectedRow[key]}`);
    }
    for (const [key, value] of Object.entries(expectedRow.chemicals)) {
      if (!close(actualRow.chemicals?.[key], value)) comparisonFailures.push(`${expectedRow.heatNumber}.chemicals.${key}: ${actualRow.chemicals?.[key]} != ${value}`);
    }
    if (actualRow.certificateNumber !== expected.certificateNumber) comparisonFailures.push(`${expectedRow.heatNumber}.certificateNumber`);
    if (actualRow.customerOrderNumber !== expected.customerOrderNumber) comparisonFailures.push(`${expectedRow.heatNumber}.customerOrderNumber`);
    if (actualRow.dimensions !== "57.00 x 8.00 mm") comparisonFailures.push(`${expectedRow.heatNumber}.dimensions: ${actualRow.dimensions}`);
    if (actualRow.norm5 !== "TEMPLATE BUHLMANN-007 REV.10") comparisonFailures.push(`${expectedRow.heatNumber}.norm5: ${actualRow.norm5}`);
  }
  if (actual.results?.length !== expected.heats.length) comparisonFailures.push(`row count: ${actual.results?.length}`);
  if (comparisonFailures.length) {
    console.error(`End-to-end result comparison failed (${comparisonFailures.length}):`);
    for (const failure of comparisonFailures) console.error(`- ${failure}`);
    process.exit(1);
  }
  console.log(`End-to-end result matches the certificate ground truth: ${resultPath}`);
}

console.log("Certificate source and workflow prompts passed the local regression checks.");
console.log(JSON.stringify(expected, null, 2));
