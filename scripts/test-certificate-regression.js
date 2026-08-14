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
