#!/usr/bin/env node

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TABLE_NAME = "Certificate OCR and Extraction Evaluation";
const PDF_DIR = process.env.CERTIFICATE_PDF_DIR || "/Users/mdklause/Downloads";
const expectedOnly = process.argv.includes("--expected-only");
const REQUIRED_COLUMNS = [
  { name: "caseId", type: "string" },
  { name: "fileName", type: "string" },
  { name: "subject", type: "string" },
  { name: "correlationKey", type: "string" },
  { name: "pdfBase64", type: "string" },
  { name: "expectedAnswer", type: "string" },
  { name: "actualAnswer", type: "string" },
  { name: "judgeScore", type: "number" },
  { name: "judgeReasoning", type: "string" },
  { name: "chemistryScore", type: "number" },
  { name: "chemistryReasoning", type: "string" },
  { name: "chemistryPassed", type: "number" },
  { name: "tensileScore", type: "number" },
  { name: "tensileReasoning", type: "string" },
  { name: "tensilePassed", type: "number" },
  { name: "passed", type: "number" }
];

function loadEnv() {
  for (const rawLine of readFileSync(path.join(ROOT, ".env"), "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim().replace(/^['"]|['"]$/g, "");
    process.env[key] ??= value;
  }
}

loadEnv();
const baseUrl = process.env.N8N_BASE_URL?.replace(/\/+$/, "");
const apiKey = process.env.N8N_API_KEY;
if (!baseUrl || !apiKey) {
  throw new Error("N8N_BASE_URL and N8N_API_KEY must be set in .env");
}

async function api(route, options = {}) {
  const response = await fetch(`${baseUrl}/api/v1${route}`, {
    ...options,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-N8N-API-KEY": apiKey,
      ...options.headers,
    },
  });
  const text = await response.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!response.ok) throw new Error(`${options.method || "GET"} ${route}: ${response.status} ${typeof body === "string" ? body : JSON.stringify(body)}`);
  return body;
}

const workflow = JSON.parse(readFileSync(path.join(ROOT, "workflows/outlook-certificate-analysis.json"), "utf8"));
const projectId = workflow.shared?.[0]?.projectId;
const cases = JSON.parse(readFileSync(path.join(ROOT, "evaluations/certificate-ground-truth.json"), "utf8"));

const tables = (await api("/data-tables?limit=100")).data ?? [];
let table = tables.find((entry) => entry.name === TABLE_NAME);
if (!table && expectedOnly) {
  throw new Error(`Data Table ${TABLE_NAME} does not exist; --expected-only cannot create the initial dataset.`);
}
if (!table) {
  table = await api("/data-tables", {
    method: "POST",
    body: JSON.stringify({
      name: TABLE_NAME,
      ...(projectId ? { projectId } : {}),
      columns: REQUIRED_COLUMNS
    })
  });
}

const existingColumns = await api(`/data-tables/${table.id}/columns`);
const columns = existingColumns.data ?? existingColumns ?? [];
const existingColumnNames = new Set(columns.map((column) => column.name));
for (const column of REQUIRED_COLUMNS) {
  const existing = columns.find((entry) => entry.name === column.name);
  if (existing && existing.type !== column.type) {
    throw new Error(`Data Table column ${column.name} has type ${existing.type}; expected ${column.type}`);
  }
  if (existingColumnNames.has(column.name)) continue;
  await api(`/data-tables/${table.id}/columns`, {
    method: "POST",
    body: JSON.stringify(column)
  });
}

if (expectedOnly) {
  const existingRowsPage = await api(`/data-tables/${table.id}/rows?limit=100`);
  const existingCaseIds = new Set((existingRowsPage.data ?? existingRowsPage ?? []).map((row) => row.caseId));
  const missingCaseIds = cases.map((testCase) => testCase.caseId).filter((caseId) => !existingCaseIds.has(caseId));
  if (missingCaseIds.length) throw new Error(`Cannot update expected answers; missing cases: ${missingCaseIds.join(", ")}`);
}

for (const testCase of cases) {
  let data;
  if (expectedOnly) {
    data = { expectedAnswer: JSON.stringify(testCase.expected) };
  } else {
    const pdfPath = path.join(PDF_DIR, testCase.fileName);
    const pdf = readFileSync(pdfPath);
    if (!pdf.subarray(0, 4).equals(Buffer.from("%PDF"))) throw new Error(`${pdfPath} is not a PDF`);
    data = {
      caseId: testCase.caseId,
      fileName: testCase.fileName,
      subject: testCase.subject,
      correlationKey: testCase.correlationKey,
      pdfBase64: pdf.toString("base64"),
      expectedAnswer: JSON.stringify(testCase.expected),
      actualAnswer: "",
      judgeScore: -1,
      judgeReasoning: "Not evaluated after latest setup",
      chemistryScore: 0,
      chemistryReasoning: "Not evaluated after latest setup",
      chemistryPassed: 0,
      tensileScore: 0,
      tensileReasoning: "Not evaluated after latest setup",
      tensilePassed: 0,
      passed: 0
    };
  }
  await api(`/data-tables/${table.id}/rows/upsert`, {
    method: "POST",
    body: JSON.stringify({
      filter: {
        type: "and",
        filters: [{ columnName: "caseId", condition: "eq", value: testCase.caseId }]
      },
      data,
      returnData: true
    })
  });
}

const tableReference = {
  __rl: true,
  value: table.id,
  mode: "list",
  cachedResultName: TABLE_NAME,
  ...(table.projectId ? { cachedResultUrl: `/projects/${table.projectId}/datatables/${table.id}` } : {})
};
if (!expectedOnly) {
  for (const graph of [workflow, workflow.activeVersion].filter(Boolean)) {
    for (const node of graph.nodes ?? []) {
      if (["When fetching a dataset row", "Evaluation – Ergebnis speichern"].includes(node.name)) {
        node.parameters.dataTableId = tableReference;
      }
      if (node.name === "Evaluationsfall manuell laden") {
        node.parameters.dataTableId = { __rl: true, value: table.id, mode: "id" };
      }
    }
  }
  writeFileSync(path.join(ROOT, "workflows/outlook-certificate-analysis.json"), `${JSON.stringify(workflow, null, 2)}\n`);
}

console.log(JSON.stringify({
  table: { id: table.id, name: table.name },
  caseCount: cases.length,
  mode: expectedOnly ? "expected-only" : "full",
  evaluationConfig: {
    name: "Certificate OCR and Extraction – nine certificates",
    triggerNodeName: "When fetching a dataset row",
    outputNodeName: "Evaluation – Ergebnis speichern",
    metricsNodeName: "Evaluation – Metriken setzen",
    scoring: "deterministic field comparison"
  }
}, null, 2));
