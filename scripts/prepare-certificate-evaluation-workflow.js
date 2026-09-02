#!/usr/bin/env node

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { deterministicEvaluationCode } from "./certificate-evaluator-code.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workflowPath = path.join(ROOT, "workflows/outlook-certificate-analysis.json");
const workflow = JSON.parse(readFileSync(workflowPath, "utf8"));

const names = {
  manual: "Evaluations-Eingang (manuell)",
  loader: "Evaluationsfall manuell laden",
  prepare: "Evaluations-PDF vorbereiten",
  trigger: "When fetching a dataset row",
  productionPdfGate: "Produktions-PDF für Dokumentenreview",
  evaluationGate: "Evaluationslauf?",
  evaluator: "Evaluation deterministisch bewerten",
  outputs: "Evaluation – Ergebnis speichern",
  metrics: "Evaluation – Metriken setzen",
  manualResult: "Evaluations-Ergebnis (manuell)",
};

const existingEvaluationNode = workflow.nodes.find((node) =>
  [names.trigger, names.outputs].includes(node.name) && node.parameters?.dataTableId?.value
);
const dataTableId = String(
  process.env.CERTIFICATE_EVALUATION_TABLE_ID
    ?? existingEvaluationNode?.parameters?.dataTableId?.value
    ?? ""
).trim();
if (!dataTableId) {
  throw new Error("No evaluation Data Table ID is configured. Run npm run setup:evaluations first or set CERTIFICATE_EVALUATION_TABLE_ID.");
}

const evaluationCaseId = String(process.env.EVALUATION_CASE_ID ?? "").trim();
const dataTableReference = {
  __rl: true,
  value: dataTableId,
  mode: "list",
  cachedResultName: "Certificate OCR and Extraction Evaluation",
};

function upsertNode(definition, aliases = []) {
  const existing = workflow.nodes.find((node) => [definition.name, ...aliases].includes(node.name));
  if (existing) Object.assign(existing, definition);
  else workflow.nodes.push(definition);
}

upsertNode({
  parameters: {},
  id: "e5d172a6-31b2-4620-a214-a45af973331c",
  name: names.manual,
  type: "n8n-nodes-base.manualTrigger",
  typeVersion: 1,
  position: [-80, 900],
});

upsertNode({
  parameters: {
    resource: "row",
    operation: "get",
    dataTableId: { __rl: true, value: dataTableId, mode: "id" },
    matchType: "anyCondition",
    filters: {},
    returnAll: false,
    limit: 1,
    orderBy: true,
    orderByColumn: "createdAt",
    orderByDirection: "ASC",
  },
  id: "d43692c2-b8de-4f98-a8a2-690a1ce6e07a",
  name: names.loader,
  type: "n8n-nodes-base.dataTable",
  typeVersion: 1.1,
  position: [180, 900],
});

const prepareCode = `const input = $input.first().json ?? {};
const source = input.row ?? input.data ?? input;
const caseId = String(source.caseId ?? '').trim();
const fileName = String(source.fileName ?? '').trim();
const pdfBase64 = String(source.pdfBase64 ?? '').replace(/^data:application\\/pdf;base64,/, '');
if (!caseId || !fileName || !pdfBase64) throw new Error('No evaluation dataset row received. Required columns: caseId, fileName, pdfBase64.');
const pdf = Buffer.from(pdfBase64, 'base64');
if (pdf.subarray(0, 4).toString('ascii') !== '%PDF') throw new Error('Evaluation row does not contain a valid PDF.');
const correlationKey = String(source.correlationKey ?? caseId).trim();
return [{
  json: {
    caseId,
    evaluationRun: true,
    mailId: \`evaluation:\${caseId}\`,
    subject: String(source.subject ?? \`Evaluation \${fileName}\`),
    receivedDateTime: new Date().toISOString(),
    pdfFileName: fileName,
    correlationKey,
    isCertificate: true,
    classification: {
      kind: 'certificate',
      confidence: 1,
      correlationKey,
      poNumber: correlationKey,
      orderData: { poNumber: correlationKey, lines: [] }
    }
  },
  binary: { data: await this.helpers.prepareBinaryData(pdf, fileName, 'application/pdf') }
}];`;

upsertNode({
  parameters: { jsCode: prepareCode },
  id: "a0d4690a-24c6-497b-8ec0-784b9af23bde",
  name: names.prepare,
  type: "n8n-nodes-base.code",
  typeVersion: 2,
  position: [440, 900],
});

upsertNode({
  parameters: {
    source: "dataTable",
    dataTableId: dataTableReference,
    limitRows: false,
    filterRows: Boolean(evaluationCaseId),
    matchType: "anyCondition",
    filters: evaluationCaseId
      ? { conditions: [{ keyName: "caseId", condition: "eq", keyValue: evaluationCaseId }] }
      : {},
  },
  id: "9c35fc3c-52a3-4a2c-9350-89e61bf252a0",
  name: names.trigger,
  type: "n8n-nodes-base.evaluationTrigger",
  typeVersion: 4.7,
  position: [-80, 1168],
});

upsertNode({
  parameters: {
    jsCode: "if ($input.first().json?.evaluationRun) return [];\nreturn $input.all();",
  },
  id: "5c65f70e-a584-46c0-b063-49f79e8d53b5",
  name: names.productionPdfGate,
  type: "n8n-nodes-base.code",
  typeVersion: 2,
  position: [1568, -160],
});

upsertNode({
  parameters: {
    conditions: {
      options: { caseSensitive: true, leftValue: "", typeValidation: "strict", version: 2 },
      conditions: [{
        id: "3646416f-6ab1-47c5-b003-bd3ed4af1d39",
        leftValue: "={{ String($json.replyMailId ?? '').startsWith('evaluation:') }}",
        rightValue: true,
        operator: { type: "boolean", operation: "true", singleValue: true },
      }],
      combinator: "and",
    },
    options: {},
  },
  id: "6116c85e-6052-405c-8f0c-1971e9a04c7f",
  name: names.evaluationGate,
  type: "n8n-nodes-base.if",
  typeVersion: 2.2,
  position: [3900, 260],
});

upsertNode({
  parameters: { jsCode: deterministicEvaluationCode },
  id: "3427a101-4da5-43e7-b0b8-2010bdf3d282",
  name: names.evaluator,
  type: "n8n-nodes-base.code",
  typeVersion: 2,
  position: [4160, 272],
}, ["Evaluationsbewertung vorbereiten"]);
workflow.nodes = workflow.nodes.filter((node) => !["Mit GLM 5.3 Flash bewerten", "Evaluationsbewertung lesen"].includes(node.name));

const existingOutputs = workflow.nodes.find((node) => node.name === names.outputs)
  ?? workflow.nodes.find((node) => node.name === "Evaluation" && node.type === "n8n-nodes-base.evaluation");
upsertNode({
  parameters: {
    operation: "setOutputs",
    source: "dataTable",
    dataTableId: dataTableReference,
    outputs: { values: [
      { outputName: "actualAnswer", outputValue: "={{ $json.actualAnswer }}" },
      { outputName: "judgeScore", outputValue: "={{ $json.score }}" },
      { outputName: "judgeReasoning", outputValue: "={{ $json.reasoning }}" },
      { outputName: "chemistryScore", outputValue: "={{ $json.chemistryScore }}" },
      { outputName: "chemistryReasoning", outputValue: "={{ $json.chemistryReasoning }}" },
      { outputName: "chemistryPassed", outputValue: "={{ $json.chemistryPassed }}" },
      { outputName: "tensileScore", outputValue: "={{ $json.tensileScore }}" },
      { outputName: "tensileReasoning", outputValue: "={{ $json.tensileReasoning }}" },
      { outputName: "tensilePassed", outputValue: "={{ $json.tensilePassed }}" },
      { outputName: "passed", outputValue: "={{ $json.passed }}" },
    ] },
  },
  id: existingOutputs?.id ?? "4011dba4-a7e1-4ff0-9342-b74f35175ee7",
  name: names.outputs,
  type: "n8n-nodes-base.evaluation",
  typeVersion: 4.8,
  position: [4928, 272],
}, ["Evaluation"]);

upsertNode({
  parameters: {
    operation: "setMetrics",
    metric: "customMetrics",
    metrics: { assignments: [
      { id: "2e1b70c2-45c4-4f06-8985-3ef7b1ff3df4", name: "correctness", value: "={{ $json.correctness }}", type: "number" },
      { id: "cb591335-2bbc-4ac4-9d55-d6d27ed2ff6c", name: "Chemistry score", value: "={{ $json.chemistryScore }}", type: "number" },
      { id: "ffae4488-3f4a-4074-b2f8-da805ae09582", name: "Chemistry pass rate", value: "={{ $json.chemistryPassed }}", type: "number" },
      { id: "76f0d41b-8cb1-42d8-8d71-b07177cbe101", name: "Tensile-test score", value: "={{ $json.tensileScore }}", type: "number" },
      { id: "ad5ad829-d247-4668-995d-08f2b9f3f7fb", name: "Tensile-test pass rate", value: "={{ $json.tensilePassed }}", type: "number" },
      { id: "ef05dbf9-b4ec-4d11-9215-cb19e12bafc4", name: "Pass rate", value: "={{ $json.passed }}", type: "number" },
    ] },
  },
  id: "893c268b-cdf1-4205-ad4e-46100e7346a0",
  name: names.metrics,
  type: "n8n-nodes-base.evaluation",
  typeVersion: 4.8,
  position: [5184, 272],
});

upsertNode({
  parameters: { jsCode: "return $input.all();" },
  id: "25ba701d-41c2-45c3-97a5-f0cba581f93e",
  name: names.manualResult,
  type: "n8n-nodes-base.code",
  typeVersion: 2,
  position: [5440, 272],
});

workflow.connections[names.manual] = { main: [[{ node: names.loader, type: "main", index: 0 }]] };
workflow.connections[names.loader] = { main: [[{ node: names.prepare, type: "main", index: 0 }]] };
workflow.connections[names.trigger] = { main: [[{ node: names.prepare, type: "main", index: 0 }]] };
workflow.connections[names.prepare] = { main: [[{ node: "PDF-Upload vorbereiten", type: "main", index: 0 }]] };
workflow.connections["PDF-Upload vorbereiten"] = { main: [[
  { node: "PDF bei MinerU einreichen", type: "main", index: 0 },
  { node: names.productionPdfGate, type: "main", index: 0 },
]] };
workflow.connections[names.productionPdfGate] = { main: [[{ node: "Original-PDF und Analyse zusammenführen", type: "main", index: 0 }]] };
workflow.connections["Ergebnis validieren und Dokumentenreview vorbereiten"] = { main: [[{ node: names.evaluationGate, type: "main", index: 0 }]] };
workflow.connections[names.evaluationGate] = { main: [
  [{ node: names.evaluator, type: "main", index: 0 }],
  [{ node: "Original-PDF und Analyse zusammenführen", type: "main", index: 1 }],
] };
workflow.connections[names.evaluator] = { main: [[{ node: names.outputs, type: "main", index: 0 }]] };
workflow.connections[names.outputs] = { main: [[{ node: names.metrics, type: "main", index: 0 }]] };
workflow.connections[names.metrics] = { main: [[{ node: names.manualResult, type: "main", index: 0 }]] };
workflow.connections[names.manualResult] = { main: [[]] };

for (const obsolete of ["Evaluation", "Evaluationsbewertung vorbereiten", "Mit GLM 5.3 Flash bewerten", "Evaluationsbewertung lesen"]) {
  delete workflow.connections[obsolete];
}

// n8n exports can contain a second, embedded representation of the published
// workflow. Keep it aligned with the editable representation so stale prompts
// or evaluation adapters cannot survive unnoticed in the repository artifact.
if (workflow.activeVersion && typeof workflow.activeVersion === "object") {
  workflow.activeVersion.nodes = structuredClone(workflow.nodes);
  workflow.activeVersion.connections = structuredClone(workflow.connections);
}

writeFileSync(workflowPath, `${JSON.stringify(workflow, null, 2)}\n`);
console.log(`Prepared evaluation harness in ${workflowPath}`);
