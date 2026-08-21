#!/usr/bin/env node

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workflowPath = path.join(ROOT, "workflows/outlook-certificate-analysis.json");
const workflow = JSON.parse(readFileSync(workflowPath, "utf8"));

const manualName = "Evaluations-Eingang (manuell)";
const loaderName = "Evaluationsfall manuell laden";
const prepareName = "Evaluations-PDF vorbereiten";
const evaluationGateName = "Evaluationslauf?";
const manualResultName = "Evaluations-Ergebnis (manuell)";
const evaluationTriggerName = "When fetching a dataset row";
const judgePrepareName = "Evaluationsbewertung vorbereiten";
const judgeRequestName = "Mit DeepSeek bewerten";
const judgeParseName = "Evaluationsbewertung lesen";
const setOutputsName = "Evaluation – Ergebnis speichern";
const setMetricsName = "Evaluation – Metriken setzen";
const productionPdfGateName = "Produktions-PDF für Dokumentenreview";
const dataTableId = "o5kI3iiMHP9tRCoT";
const evaluationCaseId = String(process.env.EVALUATION_CASE_ID ?? "").trim();
const dataTableReference = {
  __rl: true,
  value: dataTableId,
  mode: "list",
  cachedResultName: "Certificate OCR and Extraction Evaluation",
  cachedResultUrl: "/projects/rQWJLyrY2gAKELRh/datatables/o5kI3iiMHP9tRCoT"
};
const prepareCode = `const input = $input.first().json ?? {};
const source = input.row ?? input.data ?? input;
const caseId = String(source.caseId ?? '').trim();
const fileName = String(source.fileName ?? '').trim();
const pdfBase64 = String(source.pdfBase64 ?? '').replace(/^data:application\\/pdf;base64,/, '');
if (!caseId || !fileName || !pdfBase64) throw new Error('No evaluation dataset row received. Run from Evaluations-Eingang (manuell) or start an Evaluation test run. Required columns: caseId, fileName, pdfBase64.');
const pdf = Buffer.from(pdfBase64, 'base64');
if (pdf.subarray(0, 4).toString('ascii') !== '%PDF') throw new Error('Evaluation row does not contain a valid PDF.');
const correlationKey = String(source.correlationKey ?? caseId).trim();
return [{
  json: {
    caseId,
    expectedAnswer: source.expectedAnswer,
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
const judgePrepareCode = `const actual = $('Ergebnis validieren und Dokumentenreview vorbereiten').first().json;
let evaluationRow = {};
try { evaluationRow = $('When fetching a dataset row').first().json; } catch {}
let prepared = {};
try { prepared = $('Evaluations-PDF vorbereiten').first().json; } catch {}
const expectedRaw = evaluationRow.expectedAnswer ?? prepared.expectedAnswer;
if (!expectedRaw) throw new Error('The evaluation row has no expectedAnswer.');
let expected = expectedRaw;
if (typeof expectedRaw === 'string') {
  try { expected = JSON.parse(expectedRaw); } catch { expected = expectedRaw; }
}
const actualAnswer = JSON.stringify(actual);
const expectedAnswer = typeof expectedRaw === 'string' ? expectedRaw : JSON.stringify(expectedRaw);
const system = [
  'You are a strict evaluator for structured material-certificate extraction.',
  'Compare the expected facts with the actual extraction JSON.',
  'Judge only facts explicitly present in the expected answer. Ignore additional valid fields, timestamps, service metadata, array ordering, and formatting differences.',
  'Score with an integer from 1 to 5: 5=all expected facts are present and correct; 4=only a minor non-material mismatch; 3=one significant expected fact is missing or wrong; 2=several expected facts are missing or wrong; 1=unusable extraction.',
  'Return only one JSON object with keys score, reasoning, matchedFacts, missingOrWrongFacts.'
].join(' ');
return [{ json: {
  actualAnswer,
  expectedAnswer,
  llmRequest: {
    model: 'deepseek-v4-flash-3107',
    temperature: 0,
    max_tokens: 1800,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: '<EXPECTED_FACTS>\\n' + JSON.stringify(expected) + '\\n</EXPECTED_FACTS>\\n<ACTUAL_EXTRACTION>\\n' + actualAnswer + '\\n</ACTUAL_EXTRACTION>' }
    ]
  }
} }];`;
const judgeParseCode = `const response = $input.first().json;
const source = $('Evaluationsbewertung vorbereiten').first().json;
const raw = response.choices?.[0]?.message?.content ?? response.output_text ?? response.text ?? response;
let parsed = raw;
if (typeof raw === 'string') {
  const text = raw.trim().replace(/^\`\`\`(?:json)?\\s*/i, '').replace(/\\s*\`\`\`$/, '');
  try { parsed = JSON.parse(text); } catch {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start < 0 || end <= start) throw new Error('Evaluation judge returned no JSON object.');
    parsed = JSON.parse(text.slice(start, end + 1));
  }
}
const numericScore = Number(parsed?.score);
if (!Number.isFinite(numericScore)) throw new Error('Evaluation judge returned no numeric score.');
const score = Math.max(1, Math.min(5, Math.round(numericScore)));
const reasoning = String(parsed?.reasoning ?? parsed?.reasoning_summary ?? '').trim() || 'No reasoning returned.';
return [{ json: {
  actualAnswer: source.actualAnswer,
  expectedAnswer: source.expectedAnswer,
  score,
  passed: score >= 4 ? 1 : 0,
  reasoning,
  judge: parsed
} }];`;

if (!workflow.nodes.some((node) => node.name === manualName)) {
  workflow.nodes.push({
    parameters: {},
    id: "e5d172a6-31b2-4620-a214-a45af973331c",
    name: manualName,
    type: "n8n-nodes-base.manualTrigger",
    typeVersion: 1,
    position: [-80, 900]
  });
}
const loaderNode = workflow.nodes.find((node) => node.name === loaderName);
const loaderDefinition = {
  parameters: {
    resource: "row",
    operation: "get",
    dataTableId: {
      __rl: true,
      value: "o5kI3iiMHP9tRCoT",
      mode: "id"
    },
    matchType: "anyCondition",
    filters: {},
    returnAll: false,
    limit: 1,
    orderBy: true,
    orderByColumn: "createdAt",
    orderByDirection: "ASC"
  },
  id: "d43692c2-b8de-4f98-a8a2-690a1ce6e07a",
  name: loaderName,
  type: "n8n-nodes-base.dataTable",
  typeVersion: 1.1,
  position: [180, 900]
};
if (loaderNode) {
  Object.assign(loaderNode, loaderDefinition);
} else {
  workflow.nodes.push(loaderDefinition);
}
const prepareNode = workflow.nodes.find((node) => node.name === prepareName);
const prepareDefinition = {
  parameters: { jsCode: prepareCode },
  id: "a0d4690a-24c6-497b-8ec0-784b9af23bde",
  name: prepareName,
  type: "n8n-nodes-base.code",
  typeVersion: 2,
  position: [440, 900]
};
if (prepareNode) {
  Object.assign(prepareNode, prepareDefinition);
} else {
  workflow.nodes.push(prepareDefinition);
}

const evaluationTriggerDefinition = {
  parameters: {
    source: "dataTable",
    dataTableId: dataTableReference,
    limitRows: false,
    filterRows: Boolean(evaluationCaseId),
    matchType: "anyCondition",
    filters: evaluationCaseId ? {
      conditions: [{ keyName: "caseId", condition: "eq", keyValue: evaluationCaseId }]
    } : {}
  },
  id: "9c35fc3c-52a3-4a2c-9350-89e61bf252a0",
  name: evaluationTriggerName,
  type: "n8n-nodes-base.evaluationTrigger",
  typeVersion: 4.7,
  position: [-80, 1168]
};
const evaluationTriggerNode = workflow.nodes.find((node) => node.name === evaluationTriggerName);
if (evaluationTriggerNode) Object.assign(evaluationTriggerNode, evaluationTriggerDefinition);
else workflow.nodes.push(evaluationTriggerDefinition);

const judgePrepareDefinition = {
  parameters: { jsCode: judgePrepareCode },
  id: "3427a101-4da5-43e7-b0b8-2010bdf3d282",
  name: judgePrepareName,
  type: "n8n-nodes-base.code",
  typeVersion: 2,
  position: [4160, 272]
};
const judgePrepareNode = workflow.nodes.find((node) => node.name === judgePrepareName);
if (judgePrepareNode) Object.assign(judgePrepareNode, judgePrepareDefinition);
else workflow.nodes.push(judgePrepareDefinition);

const judgeRequestDefinition = {
  parameters: {
    method: "POST",
    url: "https://llm-inference.daimension.ai/v1/chat/completions",
    authentication: "genericCredentialType",
    genericAuthType: "httpBearerAuth",
    sendHeaders: true,
    headerParameters: { parameters: [{ name: "Content-Type", value: "application/json" }] },
    sendBody: true,
    specifyBody: "json",
    jsonBody: "={{ $json.llmRequest }}",
    options: { timeout: 300000 }
  },
  id: "bb183a87-4072-44de-94bb-57695bc1e2ce",
  name: judgeRequestName,
  type: "n8n-nodes-base.httpRequest",
  typeVersion: 4.2,
  position: [4416, 272],
  credentials: {
    httpBearerAuth: { id: "pAOBlEBSCcHS5Do1", name: "Daimension LLM Bearer Auth" }
  }
};
const judgeRequestNode = workflow.nodes.find((node) => node.name === judgeRequestName);
if (judgeRequestNode) Object.assign(judgeRequestNode, judgeRequestDefinition);
else workflow.nodes.push(judgeRequestDefinition);

const judgeParseDefinition = {
  parameters: { jsCode: judgeParseCode },
  id: "26da2516-7051-42a6-ac2d-0d1eae105f1b",
  name: judgeParseName,
  type: "n8n-nodes-base.code",
  typeVersion: 2,
  position: [4672, 272]
};
const judgeParseNode = workflow.nodes.find((node) => node.name === judgeParseName);
if (judgeParseNode) Object.assign(judgeParseNode, judgeParseDefinition);
else workflow.nodes.push(judgeParseDefinition);

const existingOutputsNode = workflow.nodes.find((node) => node.name === setOutputsName)
  ?? workflow.nodes.find((node) => node.name === "Evaluation" && node.type === "n8n-nodes-base.evaluation");
const setOutputsDefinition = {
  parameters: {
    operation: "setOutputs",
    source: "dataTable",
    dataTableId: dataTableReference,
    outputs: { values: [
      { outputName: "actualAnswer", outputValue: "={{ $json.actualAnswer }}" },
      { outputName: "judgeScore", outputValue: "={{ $json.score }}" },
      { outputName: "judgeReasoning", outputValue: "={{ $json.reasoning }}" },
      { outputName: "passed", outputValue: "={{ $json.passed }}" }
    ] }
  },
  id: existingOutputsNode?.id ?? "4011dba4-a7e1-4ff0-9342-b74f35175ee7",
  name: setOutputsName,
  type: "n8n-nodes-base.evaluation",
  typeVersion: 4.8,
  position: [4928, 272]
};
if (existingOutputsNode) Object.assign(existingOutputsNode, setOutputsDefinition);
else workflow.nodes.push(setOutputsDefinition);

const setMetricsDefinition = {
  parameters: {
    operation: "setMetrics",
    metric: "customMetrics",
    metrics: { assignments: [
      { id: "2e1b70c2-45c4-4f06-8985-3ef7b1ff3df4", name: "correctness", value: "={{ $json.score }}", type: "number" },
      { id: "ef05dbf9-b4ec-4d11-9215-cb19e12bafc4", name: "Pass rate", value: "={{ $json.passed }}", type: "number" }
    ] }
  },
  id: "893c268b-cdf1-4205-ad4e-46100e7346a0",
  name: setMetricsName,
  type: "n8n-nodes-base.evaluation",
  typeVersion: 4.8,
  position: [5184, 272]
};
const setMetricsNode = workflow.nodes.find((node) => node.name === setMetricsName);
if (setMetricsNode) Object.assign(setMetricsNode, setMetricsDefinition);
else workflow.nodes.push(setMetricsDefinition);

const productionPdfGateDefinition = {
  parameters: {
    jsCode: "if ($input.first().json?.evaluationRun) return [];\nreturn $input.all();"
  },
  id: "5c65f70e-a584-46c0-b063-49f79e8d53b5",
  name: productionPdfGateName,
  type: "n8n-nodes-base.code",
  typeVersion: 2,
  position: [1568, -160]
};
const productionPdfGate = workflow.nodes.find((node) => node.name === productionPdfGateName);
if (productionPdfGate) Object.assign(productionPdfGate, productionPdfGateDefinition);
else workflow.nodes.push(productionPdfGateDefinition);

workflow.connections[manualName] = { main: [[{ node: loaderName, type: "main", index: 0 }]] };
workflow.connections[loaderName] = { main: [[{ node: prepareName, type: "main", index: 0 }]] };
workflow.connections[prepareName] = { main: [[{ node: "PDF-Upload vorbereiten", type: "main", index: 0 }]] };
workflow.connections[evaluationTriggerName] = { main: [[{ node: prepareName, type: "main", index: 0 }]] };
workflow.connections["PDF-Upload vorbereiten"] = {
  main: [[
    { node: "PDF bei MinerU einreichen", type: "main", index: 0 },
    { node: productionPdfGateName, type: "main", index: 0 }
  ]]
};
workflow.connections[productionPdfGateName] = {
  main: [[{ node: "Original-PDF und Analyse zusammenführen", type: "main", index: 0 }]]
};

const evaluationGateDefinition = {
  parameters: {
    conditions: {
      options: {
        caseSensitive: true,
        leftValue: "",
        typeValidation: "strict",
        version: 2
      },
      conditions: [{
        id: "3646416f-6ab1-47c5-b003-bd3ed4af1d39",
        leftValue: "={{ String($json.replyMailId ?? '').startsWith('evaluation:') }}",
        rightValue: true,
        operator: { type: "boolean", operation: "true", singleValue: true }
      }],
      combinator: "and"
    },
    options: {}
  },
  id: "6116c85e-6052-405c-8f0c-1971e9a04c7f",
  name: evaluationGateName,
  type: "n8n-nodes-base.if",
  typeVersion: 2.2,
  position: [3900, 260]
};
const existingEvaluationGate = workflow.nodes.find((node) => node.name === evaluationGateName);
if (existingEvaluationGate) Object.assign(existingEvaluationGate, evaluationGateDefinition);
else workflow.nodes.push(evaluationGateDefinition);

const manualResultDefinition = {
  parameters: { jsCode: "return $input.all();" },
  id: "25ba701d-41c2-45c3-97a5-f0cba581f93e",
  name: manualResultName,
  type: "n8n-nodes-base.code",
  typeVersion: 2,
  position: [4160, 260]
};
const existingManualResult = workflow.nodes.find((node) => node.name === manualResultName);
if (existingManualResult) Object.assign(existingManualResult, manualResultDefinition);
else workflow.nodes.push(manualResultDefinition);

workflow.connections["Ergebnis validieren und Dokumentenreview vorbereiten"] = {
  main: [[{ node: evaluationGateName, type: "main", index: 0 }]]
};
workflow.connections[evaluationGateName] = {
  main: [
    [{ node: judgePrepareName, type: "main", index: 0 }],
    [{ node: "Original-PDF und Analyse zusammenführen", type: "main", index: 1 }]
  ]
};
workflow.connections[judgePrepareName] = { main: [[{ node: judgeRequestName, type: "main", index: 0 }]] };
workflow.connections[judgeRequestName] = { main: [[{ node: judgeParseName, type: "main", index: 0 }]] };
workflow.connections[judgeParseName] = { main: [[{ node: setOutputsName, type: "main", index: 0 }]] };
workflow.connections[setOutputsName] = { main: [[{ node: setMetricsName, type: "main", index: 0 }]] };
workflow.connections[setMetricsName] = { main: [[{ node: manualResultName, type: "main", index: 0 }]] };
workflow.connections[manualResultName] = { main: [[]] };
delete workflow.connections.Evaluation;

const storage = workflow.nodes.find((node) => node.name === "Zertifikat zwischenspeichern");
storage.parameters.jsCode = storage.parameters.jsCode.replace(
  "const original = $('Einordnung lesen').first().json;",
  "let original;\ntry { original = $('Einordnung lesen').first().json; } catch { original = $('Evaluations-PDF vorbereiten').first().json; }"
);

const mineruReply = workflow.nodes.find((node) => node.name === "MinerU-Ausgabe für Antwort vorbereiten");
mineruReply.parameters.jsCode = mineruReply.parameters.jsCode.replace(
  "const original = $('Einordnung lesen').first().json;",
  "let original;\ntry { original = $('Einordnung lesen').first().json; } catch { original = $('Evaluations-PDF vorbereiten').first().json; }\nif (original.evaluationRun) return [];"
);

const evidenceLoop = workflow.nodes.find((node) => node.name === "DeepSeek-Belegblöcke nacheinander");
if (evidenceLoop) evidenceLoop.parameters.batchSize = 1;

const pdfUploadPreparation = workflow.nodes.find((node) => node.name === "PDF-Upload vorbereiten");
if (pdfUploadPreparation) {
  pdfUploadPreparation.parameters.jsCode = pdfUploadPreparation.parameters.jsCode
    .replace(
      "const uploadPdfBuffer = needsStructuralRewrite\n  ? await normalizePdf(pdfBuffer)\n  : Buffer.from(pdfBuffer);",
      "let pdfNormalizationError = null;\nlet uploadPdfBuffer;\nif (needsStructuralRewrite) {\n  try {\n    uploadPdfBuffer = await normalizePdf(pdfBuffer);\n  } catch (error) {\n    pdfNormalizationError = String(error?.message ?? error);\n    uploadPdfBuffer = Buffer.from(pdfBuffer);\n  }\n} else {\n  uploadPdfBuffer = Buffer.from(pdfBuffer);\n}"
    )
    .replace(
      "pdfNormalization: needsStructuralRewrite ? 'object-streams-to-classic-xref' : 'not-required'",
      "pdfNormalization: needsStructuralRewrite ? (pdfNormalizationError ? 'rewrite-failed-fallback-original' : 'object-streams-to-classic-xref') : 'not-required',\n      pdfNormalizationError"
    )
    .replace(
      "pdfNormalizationApplied: needsStructuralRewrite",
      "pdfNormalizationApplied: needsStructuralRewrite && !pdfNormalizationError"
    );
}

writeFileSync(workflowPath, `${JSON.stringify(workflow, null, 2)}\n`);
console.log(`Prepared ${workflowPath}`);
