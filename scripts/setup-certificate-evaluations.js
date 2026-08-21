#!/usr/bin/env node

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TABLE_NAME = "Certificate OCR and Extraction Evaluation";
const CREDENTIAL_NAME = "Daimension OpenAI-compatible Eval Judge";
const PDF_DIR = process.env.CERTIFICATE_PDF_DIR || "/Users/mdklause/Downloads";
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
if (!baseUrl || !apiKey || !process.env.DAIMENSION_API_KEY) {
  throw new Error("N8N_BASE_URL, N8N_API_KEY and DAIMENSION_API_KEY must be set in .env");
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
const existingColumnNames = new Set((existingColumns.data ?? existingColumns ?? []).map((column) => column.name));
for (const column of REQUIRED_COLUMNS) {
  if (existingColumnNames.has(column.name)) continue;
  await api(`/data-tables/${table.id}/columns`, {
    method: "POST",
    body: JSON.stringify(column)
  });
}

const existingRows = await api(`/data-tables/${table.id}/rows?limit=100`);
const existingCaseIds = new Set((existingRows.data ?? existingRows ?? []).map((row) => row.caseId));
for (const testCase of cases) {
  if (existingCaseIds.has(testCase.caseId)) continue;
  const pdfPath = path.join(PDF_DIR, testCase.fileName);
  const pdf = readFileSync(pdfPath);
  if (!pdf.subarray(0, 4).equals(Buffer.from("%PDF"))) throw new Error(`${pdfPath} is not a PDF`);
  await api(`/data-tables/${table.id}/rows`, {
    method: "POST",
    body: JSON.stringify({
      data: [{
        caseId: testCase.caseId,
        fileName: testCase.fileName,
        subject: testCase.subject,
        correlationKey: testCase.correlationKey,
        pdfBase64: pdf.toString("base64"),
        expectedAnswer: JSON.stringify(testCase.expected)
      }],
      returnType: "all"
    })
  });
}

const credentials = (await api("/credentials?limit=100")).data ?? [];
let credential = credentials.find((entry) => entry.name === CREDENTIAL_NAME && entry.type === "openAiApi");
if (!credential) {
  credential = await api("/credentials", {
    method: "POST",
    body: JSON.stringify({
      name: CREDENTIAL_NAME,
      type: "openAiApi",
      data: {
        apiKey: process.env.DAIMENSION_API_KEY,
        url: "https://llm-inference.daimension.ai/v1"
      }
    })
  });
}

console.log(JSON.stringify({
  table: { id: table.id, name: table.name },
  credential: { id: credential.id, name: credential.name, type: credential.type },
  caseCount: cases.length,
  evaluationConfig: {
    name: "Certificate OCR and Extraction – nine certificates",
    triggerNodeName: "When fetching a dataset row",
    outputNodeName: "Evaluation – Ergebnis speichern",
    metricsNodeName: "Evaluation – Metriken setzen",
    model: "deepseek-v4-flash-3107"
  }
}, null, 2));
