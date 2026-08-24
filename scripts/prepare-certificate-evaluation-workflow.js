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
const deterministicEvaluationName = "Evaluation deterministisch bewerten";
const setOutputsName = "Evaluation – Ergebnis speichern";
const setMetricsName = "Evaluation – Metriken setzen";
const productionPdfGateName = "Produktions-PDF für Dokumentenreview";
const existingEvaluationNode = workflow.nodes.find((node) =>
  [evaluationTriggerName, setOutputsName].includes(node.name)
  && node.parameters?.dataTableId?.value
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
  cachedResultName: "Certificate OCR and Extraction Evaluation"
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
const deterministicEvaluationCode = `const actual = $('Ergebnis validieren und Dokumentenreview vorbereiten').first().json;
let evaluationRow = {};
try { evaluationRow = $('When fetching a dataset row').first().json; } catch {}
let prepared = {};
try { prepared = $('Evaluations-PDF vorbereiten').first().json; } catch {}
const expectedRaw = evaluationRow.expectedAnswer ?? prepared.expectedAnswer;
if (!expectedRaw) throw new Error('The evaluation row has no expectedAnswer.');
let expected = expectedRaw;
if (typeof expectedRaw === 'string') {
  try { expected = JSON.parse(expectedRaw); } catch { throw new Error('expectedAnswer is not valid JSON.'); }
}
const actualAnswer = JSON.stringify(actual);
const expectedAnswer = typeof expectedRaw === 'string' ? expectedRaw : JSON.stringify(expectedRaw);
const normalizeString = value => String(value ?? '').normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g, '');
const stringMatches = (actualValue, expectedValue) => {
  const actualNormalized = normalizeString(actualValue);
  const alternatives = String(expectedValue ?? '').split(/\\s+\\/\\s+/).map(normalizeString).filter(Boolean);
  return Boolean(actualNormalized) && alternatives.some(value => actualNormalized === value || actualNormalized.includes(value) || value.includes(actualNormalized));
};
const productTokens = value => {
  const aliases = { exzentrisch: 'eccentric', exzentrisches: 'eccentric', reduzierstuck: 'reducer', reduzierstueck: 'reducer', typ: 'type', rf: 'raisedface', raised: 'raisedface', face: '', zoll: 'inch', stuck: 'piece', stueck: 'piece', stick: 'piece' };
  return String(value ?? '').normalize('NFKD').replace(/\\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(/\\s+/).map(token => aliases[token] ?? token).filter(Boolean);
};
const productMatches = (actualValue, expectedValue) => {
  if (stringMatches(actualValue, expectedValue)) return true;
  const actualTokens = new Set(productTokens(actualValue));
  return String(expectedValue ?? '').split(/\\s+\\/\\s+/).some(alternative => {
    const expectedTokens = productTokens(alternative);
    return expectedTokens.length > 0 && expectedTokens.every(token => actualTokens.has(token));
  });
};
const expectedNumber = value => Array.isArray(value) ? Math.min(...value.map(Number).filter(Number.isFinite)) : Number(value);
const numberMatches = (actualValue, expectedValue) => {
  const left = Number(actualValue);
  const right = expectedNumber(expectedValue);
  const tolerance = Math.max(0.01, Math.abs(right) * 0.0001);
  return Number.isFinite(left) && Number.isFinite(right) && Math.abs(left - right) <= tolerance;
};
const chemicalNumberMatches = (actualValue, expectedValue) => {
  const left = Number(actualValue);
  const right = Number(expectedValue);
  const tolerance = Math.max(0.000001, Math.abs(right) * 0.0001);
  return Number.isFinite(left) && Number.isFinite(right) && left >= 0 && Math.abs(left - right) <= tolerance;
};
const dimensionsMatch = (actualValue, expectedValue) => normalizeString(actualValue) === normalizeString(expectedValue);
const actualRows = Array.isArray(actual.results) ? actual.results : [];
const expectedRows = Array.isArray(expected.positions) ? expected.positions : [];
const matchedFacts = [];
const missingOrWrongFacts = [];
const matchedChemistryFacts = [];
const missingOrWrongChemistryFacts = [];
let checkedFacts = 0;
let checkedChemistryFacts = 0;
const record = (path, ok, detail) => {
  checkedFacts++;
  (ok ? matchedFacts : missingOrWrongFacts).push(ok ? path : path + ': ' + detail);
};
const recordChemistry = (path, ok, detail) => {
  checkedChemistryFacts++;
  (ok ? matchedChemistryFacts : missingOrWrongChemistryFacts).push(ok ? path : path + ': ' + detail);
  record(path, ok, detail);
};
for (const [key, actualKey] of [['certificateNumber','certificateNumber'], ['customerOrderNumber','customerOrderNumber'], ['creditor','creditor']]) {
  if (expected[key] === undefined) continue;
  const values = actualRows.map(row => row[actualKey]);
  record(key, values.some(value => stringMatches(value, expected[key])), 'expected ' + JSON.stringify(expected[key]) + ', got ' + JSON.stringify(values));
}
if (expected.rawMaterialCertificate !== undefined) {
  const values = actualRows.map(row => row.rawMaterialCertificate);
  record('rawMaterialCertificate', values.some(value => stringMatches(value, expected.rawMaterialCertificate)), 'expected ' + JSON.stringify(expected.rawMaterialCertificate) + ', got ' + JSON.stringify(values));
}
const unusedRows = new Set(actualRows.map((_, index) => index));
for (let expectedIndex = 0; expectedIndex < expectedRows.length; expectedIndex++) {
  const expectedRow = expectedRows[expectedIndex];
  const candidates = [...unusedRows].filter(index => stringMatches(actualRows[index].heatNumber, expectedRow.heatNumber));
  let rowIndex = candidates.find(index => expectedRow.dimensions === undefined || dimensionsMatch(actualRows[index].dimensions, expectedRow.dimensions));
  if (rowIndex === undefined) rowIndex = candidates[0];
  const prefix = 'positions[' + expectedIndex + ']';
  if (rowIndex === undefined) {
    record(prefix, false, 'no row for heat ' + expectedRow.heatNumber);
    for (const [element, expectedValue] of Object.entries(expectedRow.chemicals ?? {})) {
      recordChemistry(prefix + '.chemicals.' + element, false, 'no row for heat ' + expectedRow.heatNumber + '; expected ' + expectedValue);
    }
    continue;
  }
  unusedRows.delete(rowIndex);
  const row = actualRows[rowIndex];
  record(prefix + '.heatNumber', stringMatches(row.heatNumber, expectedRow.heatNumber), 'expected ' + expectedRow.heatNumber + ', got ' + row.heatNumber);
  for (const field of ['quantity','yieldStrength02','yieldStrength10','tensileStrength','elongation']) {
    if (expectedRow[field] === undefined) continue;
    record(prefix + '.' + field, numberMatches(row[field], expectedRow[field]), 'expected ' + JSON.stringify(expectedRow[field]) + ', got ' + row[field]);
  }
  for (const field of ['product','dimensions']) {
    if (expectedRow[field] === undefined) continue;
    const ok = field === 'dimensions' ? dimensionsMatch(row[field], expectedRow[field]) : productMatches(row[field], expectedRow[field]);
    record(prefix + '.' + field, ok, 'expected ' + JSON.stringify(expectedRow[field]) + ', got ' + JSON.stringify(row[field]));
  }
  if (expectedRow.material !== undefined) {
    const materials = [row.werkstoff1,row.werkstoff2,row.werkstoff3,row.werkstoff4,row.werkstoff5].filter(value => value && value !== '-1').join(' / ');
    record(prefix + '.material', stringMatches(materials, expectedRow.material), 'expected ' + JSON.stringify(expectedRow.material) + ', got ' + JSON.stringify(materials));
  }
  if (expectedRow.standards !== undefined) {
    const norms = [row.norm1,row.norm2,row.norm3,row.norm4,row.norm5].filter(value => value && value !== '-1').join(' / ');
    const standards = Array.isArray(expectedRow.standards) ? expectedRow.standards : [expectedRow.standards];
    for (let standardIndex = 0; standardIndex < standards.length; standardIndex++) {
      record(prefix + '.standards[' + standardIndex + ']', stringMatches(norms, standards[standardIndex]), 'expected ' + JSON.stringify(standards[standardIndex]) + ', got ' + JSON.stringify(norms));
    }
  }
  const actualChemicals = row.chemicals && typeof row.chemicals === 'object' && !Array.isArray(row.chemicals) ? row.chemicals : {};
  const actualChemicalEntries = Object.entries(actualChemicals);
  for (const [element, expectedValue] of Object.entries(expectedRow.chemicals ?? {})) {
    const actualEntry = actualChemicalEntries.find(([actualElement]) => String(actualElement).toUpperCase() === String(element).toUpperCase());
    const actualValue = actualEntry?.[1];
    recordChemistry(
      prefix + '.chemicals.' + element,
      chemicalNumberMatches(actualValue, expectedValue),
      'expected ' + expectedValue + ', got ' + JSON.stringify(actualValue)
    );
  }
}
if (checkedChemistryFacts === 0) {
  recordChemistry('chemistryGroundTruth', false, 'no expected chemical measurements configured');
}
record('rowCount', actualRows.length === expectedRows.length, 'expected ' + expectedRows.length + ', got ' + actualRows.length);
const correctness = checkedFacts ? matchedFacts.length / checkedFacts : 0;
const chemistryScore = checkedChemistryFacts ? matchedChemistryFacts.length / checkedChemistryFacts : 0;
const chemistryPassed = checkedChemistryFacts > 0 && missingOrWrongChemistryFacts.length === 0 ? 1 : 0;
const baseScore = missingOrWrongFacts.length === 0 ? 5 : correctness >= 0.95 ? 4 : correctness >= 0.8 ? 3 : correctness >= 0.5 ? 2 : 1;
const score = chemistryPassed ? baseScore : Math.min(baseScore, 3);
const passed = missingOrWrongFacts.length === 0 && chemistryPassed === 1 ? 1 : 0;
const reasoning = passed ? 'All ' + checkedFacts + ' expected facts matched deterministically.' : missingOrWrongFacts.join('; ');
const chemistryReasoning = chemistryPassed
  ? 'All ' + checkedChemistryFacts + ' expected chemical measurements matched their heat.'
  : missingOrWrongChemistryFacts.join('; ');
return [{ json: { actualAnswer, expectedAnswer, score, correctness, passed, reasoning, matchedFacts, missingOrWrongFacts, chemistryScore, chemistryPassed, chemistryReasoning, matchedChemistryFacts, missingOrWrongChemistryFacts } }];`;

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
      value: dataTableId,
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

const deterministicEvaluationDefinition = {
  parameters: { jsCode: deterministicEvaluationCode },
  id: "3427a101-4da5-43e7-b0b8-2010bdf3d282",
  name: deterministicEvaluationName,
  type: "n8n-nodes-base.code",
  typeVersion: 2,
  position: [4160, 272]
};
const deterministicEvaluationNode = workflow.nodes.find((node) =>
  [deterministicEvaluationName, "Evaluationsbewertung vorbereiten"].includes(node.name)
);
if (deterministicEvaluationNode) Object.assign(deterministicEvaluationNode, deterministicEvaluationDefinition);
else workflow.nodes.push(deterministicEvaluationDefinition);
workflow.nodes = workflow.nodes.filter((node) => !["Mit DeepSeek bewerten", "Evaluationsbewertung lesen"].includes(node.name));

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
      { outputName: "chemistryScore", outputValue: "={{ $json.chemistryScore }}" },
      { outputName: "chemistryReasoning", outputValue: "={{ $json.chemistryReasoning }}" },
      { outputName: "chemistryPassed", outputValue: "={{ $json.chemistryPassed }}" },
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
      { id: "2e1b70c2-45c4-4f06-8985-3ef7b1ff3df4", name: "correctness", value: "={{ $json.correctness }}", type: "number" },
      { id: "cb591335-2bbc-4ac4-9d55-d6d27ed2ff6c", name: "Chemistry score", value: "={{ $json.chemistryScore }}", type: "number" },
      { id: "ffae4488-3f4a-4074-b2f8-da805ae09582", name: "Chemistry pass rate", value: "={{ $json.chemistryPassed }}", type: "number" },
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
    [{ node: deterministicEvaluationName, type: "main", index: 0 }],
    [{ node: "Original-PDF und Analyse zusammenführen", type: "main", index: 1 }]
  ]
};
workflow.connections[deterministicEvaluationName] = { main: [[{ node: setOutputsName, type: "main", index: 0 }]] };
workflow.connections[setOutputsName] = { main: [[{ node: setMetricsName, type: "main", index: 0 }]] };
workflow.connections[setMetricsName] = { main: [[{ node: manualResultName, type: "main", index: 0 }]] };
workflow.connections[manualResultName] = { main: [[]] };
delete workflow.connections.Evaluation;
delete workflow.connections["Evaluationsbewertung vorbereiten"];
delete workflow.connections["Mit DeepSeek bewerten"];
delete workflow.connections["Evaluationsbewertung lesen"];

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

const deckCertificateRule = "Reine ISO-/TÜV-/DVGW-, Zulassungs- und QM-Zertifikate ohne positionsbezogene Schmelze sind Referenzanlagen und niemals das Deckzeugnis. certificateNumber muss das Prüf-/Werkstoffzeugnis identifizieren, das unmittelbar zu Produktposition und Schmelze gehört; Zulassungsnummern dürfen es nicht ersetzen. Zweisprachig wiederholte Positionen zählen genau einmal.";
const coverCertificateRule = "Bei zusammengesetzten PDFs ist das früheste Abnahmeprüfzeugnis, das Kundenbestellung, Fertigprodukt, Stückzahl und Fertigmaße gemeinsam nennt, das Deckzeugnis; reine Titel- oder Indexseiten ausgenommen. Spätere Herstellerzeugnisse mit Rohmaterialabmessungen und schmelzenspezifischen Prüfwerten sind Vormaterialanlagen: Ihre Nummer, Menge und Produktbezeichnung dürfen certificateNumber, quantity und product des Deckzeugnisses niemals ersetzen.";
const legacyMechanicalRule = "Mechanische Istwerte niemals runden: Bei mehreren Messungen derselben Schmelze und Prüftemperatur jeden Originalwert vergleichen und den exakt kleinsten belegten Wert übernehmen.";
const exactMechanicalRule = "Mechanische Istwerte niemals runden oder über getrennte Probenlagen hinweg minimieren. Wähle den primären Abnahme-/Lieferzustandsblock, der Produktposition, Probenlage und ausgewiesenen Prüfanforderungen zugeordnet ist; nachfolgende Zusatzproben anderer Lage dürfen ihn nicht ersetzen. Nur innerhalb desselben vergleichbaren Prüfblocks gilt die dort verlangte Auswahlregel.";
const offsetYieldRule = "Enthält der gewählte vergleichbare Prüfblock ausdrücklich Rp1.0, Rp1,0 oder einen 1-%-Offset-Istwert, muss yieldStrength10 den kleinsten dieser belegten Istwerte enthalten und darf nicht -1 sein. Anforderungs-/Grenzwerte ohne Istmessung sind weiterhin keine Messwerte.";
const evidenceTraceRule = "Erhalte für jeden Zugversuch comparableGroupId, testBlockId, specimenId, specimenLocation, gaugeLengthType, temperatureC, die wörtlichen Spaltenüberschriften und sourceQuote. gaugeLengthType ist genau A5, 5D, A4, 2IN, OTHER oder UNKNOWN. Ein Rp1.0-Wert darf nur in yieldStrength10 stehen, wenn yieldStrength10Explicit=true und die zitierte Überschrift ausdrücklich Rp1.0, Rp1,0 oder 1 % nennt.";
const stackedMechanicalRowsRule = "Mehrzeilige Tabellenzellen sind mehrere Prüfzeilen: Stehen unter einer gemeinsamen Proben-Nr. beispielsweise 284/317 und darunter 271/306, erzeuge zwei Tests desselben comparableGroupId und erhalte beide Rp0.2/Rp1.0-Paare. Dasselbe gilt für parallel gestapelte Rm- und Dehnungswerte. Wenn der vollständige Tabellenkopf zwei Dehngrenzenspalten als 0,2 % und 1,0 % kennzeichnet, ist die zweite Spalte ein ausdrücklicher Rp1.0-Beleg, auch wenn MinerU die Überschrift von den Zahlenzeilen getrennt hat.";
const pairedMechanicalColumnsRule = "Bei parallel angeordneten Mechanikspalten niemals Spalten als neue Proben ausgeben. Beispiel: Rm=[608.63,613.85], Rp0.2=[279.26,327.21], Rp1.0=[301.87,358.29] sind genau zwei Probenzeilen: 608.63/279.26/301.87 und 613.85/327.21/358.29. Enthält jede Probenzeile zwei Dehnungen, kennzeichne die A5/5D-/proportionale bzw. erste primäre Dehnung mit isPreferredElongationColumn=true und die 2IN-/sekundäre Dehnung mit false; nur die bevorzugte Dehnung liefert elongation.";
const acceptanceBlockRule = "isPrimaryAcceptanceBlock=true nur für den durch dieselbe Anforderungszeile (Min./Max./Requirements/Anforderungen) und Probenlage bezeichneten Abnahmeblock. Eine nachfolgende Zusatzmessung ohne diese Anforderungszeile bleibt false, auch wenn Schmelze, testBlockId oder comparableGroupId gleich aussehen. comparableGroupId gilt nur innerhalb desselben sourceBlock und darf niemals über verschiedene Anlagen hinweg zusammengeführt werden.";
const deterministicMechanicalRule = "Fülle mechanicalSelection vollständig vor den vier Mechanik-Skalaren: selectedComparableGroupId, gaugeLengthType, selectionReason und alle Tests des ausgewählten vergleichbaren Blocks. 5D gilt als A5 und hat Vorrang vor 2IN; A5/5D hat Vorrang vor A4. Innerhalb dieses einen Blocks wird das feldweise Minimum gebildet; die vier Endwerte dürfen absichtlich aus verschiedenen Probenzeilen stammen. Niemals eine komplette erste Tabellenzeile nur deshalb übernehmen, weil sie zusammenhängend ist.";
const deckTraceRule = "Fülle deckSelection mit documentRole=DECK, sourceBlockIndex, sourcePage, selectionReason und den wörtlich belegten Deckfeldern. Die Kundenbestellung dient nur zur Auswahl des Deckzeugnisses: Wähle den frühesten Beleg, der dieselbe Kundenbestellung sowie Fertigprodukt, Stückzahl und Fertigmaße nennt. Rohmaterial-, Rohr-, Zulassungs- oder QM-Anlagen dürfen diese Felder nicht liefern.";
const headerLabelRule = "Ordne Kopfwerte ausschließlich nach ihrem Etikett zu: Inspection Certificate No./Abnahmeprüfzeugnis-Nr. ist certificateNumber; Bestell-Nr./Customer Order/P.O. ist customerOrderNumber. Auftrags-Nr./Works Order, Supplier Order, PU- und AB-Vorgangsnummern sind keine Kundenbestellung und keine Zeugnisnummer, sofern sie nicht ausdrücklich genau so beschriftet sind.";
const legacyMaterialStandardRule = "Werkstoffspezifikationen, die in der Material-/B02-Zeile stehen, bleiben zusätzlich eigenständige Normen und stehen vor allgemeinen Prüfanforderungen. Beispiel: 'F316/F316L - ASTM A 182M-24 / ASME SA-182M-23' ergibt werkstoff=F316/F316L sowie norm1=ASTM A182M-24 und norm2=ASME SA-182M-23.";
const materialStandardRule = "Werkstoffspezifikationen, die in der Material-/B02-Zeile stehen, bleiben zusätzlich eigenständige Normen und stehen vor allgemeinen Prüfanforderungen. Beispiel: F316/F316L - ASTM A 182M-24 / ASME SA-182M-23 ergibt werkstoff=F316/F316L sowie norm1=ASTM A182M-24 und norm2=ASME SA-182M-23.";
const chemistryTraceRule = "Erhalte für jeden Chemiewert zusätzlich columnHeader und scaleSourceQuote aus derselben Tabelle. Niemals eine Skala aus einer benachbarten Spaltengruppe übernehmen; bei colspan gilt die Skala nur für die von ihr überspannten Elementspalten.";
const removePromptRule = (node, rule) => {
  if (!node) return;
  node.parameters.jsCode = node.parameters.jsCode.replace("  '" + rule + "',\n", "");
};
const appendPromptRule = (node, anchor, rule) => {
  if (!node || node.parameters.jsCode.includes(rule)) return;
  node.parameters.jsCode = node.parameters.jsCode.replace(anchor, anchor + "\n  '" + rule + "',");
};
for (const nodeName of ["Zeugnis in Belegblöcke teilen", "Belege sammeln und Normalisierung bauen", "Qualitätsprüfung vorbereiten"]) {
  const promptNode = workflow.nodes.find((node) => node.name === nodeName);
  removePromptRule(promptNode, legacyMechanicalRule);
  if (promptNode) promptNode.parameters.jsCode = promptNode.parameters.jsCode.replaceAll(legacyMaterialStandardRule, materialStandardRule);
}
appendPromptRule(
  workflow.nodes.find((node) => node.name === "Zeugnis in Belegblöcke teilen"),
  "  'Deckzeugnisfelder haben Vorrang für Zertifikats-/Reportnummer, Kundenbestellung, Menge, Produkt, Abmessung, Werkstoff und ausstellenden Hersteller. Angefügte Vormaterialzeugnisse liefern die schmelzenspezifische Chemie und Mechanik; ihre Auftrags-, Zertifikats-, Mengen- und Abmessungswerte ersetzen die Deckzeugnisfelder nicht.',",
  deckCertificateRule,
);
appendPromptRule(
  workflow.nodes.find((node) => node.name === "Zeugnis in Belegblöcke teilen"),
  "  '" + deckCertificateRule + "',",
  coverCertificateRule,
);
appendPromptRule(
  workflow.nodes.find((node) => node.name === "Zeugnis in Belegblöcke teilen"),
  "  'Zugversuche: Messwerte bei Raumtemperatur bevorzugen; 20 °C und 23 °C gelten als Raumtemperatur. Min.-/Max.-Anforderungen sind keine Messwerte. A5 und A4 getrennt belegen und nicht miteinander vermischen.',",
  exactMechanicalRule,
);
appendPromptRule(
  workflow.nodes.find((node) => node.name === "Zeugnis in Belegblöcke teilen"),
  "  '" + exactMechanicalRule + "',",
  offsetYieldRule,
);
appendPromptRule(
  workflow.nodes.find((node) => node.name === "Zeugnis in Belegblöcke teilen"),
  "  '" + offsetYieldRule + "',",
  evidenceTraceRule,
);
appendPromptRule(
  workflow.nodes.find((node) => node.name === "Zeugnis in Belegblöcke teilen"),
  "  '" + evidenceTraceRule + "',",
  stackedMechanicalRowsRule,
);
appendPromptRule(
  workflow.nodes.find((node) => node.name === "Zeugnis in Belegblöcke teilen"),
  "  '" + stackedMechanicalRowsRule + "',",
  pairedMechanicalColumnsRule,
);
appendPromptRule(
  workflow.nodes.find((node) => node.name === "Zeugnis in Belegblöcke teilen"),
  "  '" + pairedMechanicalColumnsRule + "',",
  acceptanceBlockRule,
);
appendPromptRule(
  workflow.nodes.find((node) => node.name === "Zeugnis in Belegblöcke teilen"),
  "  '" + coverCertificateRule + "',",
  headerLabelRule,
);
appendPromptRule(
  workflow.nodes.find((node) => node.name === "Zeugnis in Belegblöcke teilen"),
  "  '" + headerLabelRule + "',",
  materialStandardRule,
);
appendPromptRule(
  workflow.nodes.find((node) => node.name === "Zeugnis in Belegblöcke teilen"),
  "  'Skalierungsbeispiele: raw 18 unter X 100 ergibt 0.18; raw 13 unter X 1000 ergibt 0.013; raw 92 unter X 10000 ergibt 0.0092. Gib rawValue, scale, value und analysisType aus.',",
  chemistryTraceRule,
);

const evidencePreparation = workflow.nodes.find((node) => node.name === "Zeugnis in Belegblöcke teilen");
if (evidencePreparation) {
  evidencePreparation.parameters.jsCode = evidencePreparation.parameters.jsCode
    .replace(
      "  certificate: {\n    certificateNumber:",
      "  certificate: {\n    documentRole: { value: 'DECK|RAW_MATERIAL|APPROVAL|OTHER|UNKNOWN', sourceQuote: 'string|null' },\n    sourcePage: { value: 'string|number|null', sourceQuote: 'string|null' },\n    deckIndicators: { customerOrder: 'boolean', finishedProduct: 'boolean', finishedQuantity: 'boolean', finishedDimensions: 'boolean' },\n    certificateNumber:"
    )
    .replace(
      "    chemistry: [{ element: 'string', analysisType: 'H|P', rawValue: 'number|string', scale: 'number', value: 'number', sourceQuote: 'string' }],",
      "    chemistry: [{ element: 'string', analysisType: 'H|P', rawValue: 'number|string', scale: 'number', value: 'number', columnHeader: 'string', scaleSourceQuote: 'string', sourceQuote: 'string' }],"
    )
    .replace(
      "    tensileTests: [{ temperatureC: 'number|null', yieldStrength02: 'number|null', yieldStrength10: 'number|null', tensileStrength: 'number|null', elongationA5: 'number|null', elongationA4: 'number|null', sourceQuote: 'string' }]",
      "    tensileTests: [{ comparableGroupId: 'string', testBlockId: 'string', specimenId: 'string|null', specimenLocation: 'string|null', gaugeLengthType: 'A5|5D|A4|2IN|OTHER|UNKNOWN', elongationColumnType: 'A5|5D|A4|2IN|FS|PRIMARY|SECONDARY|UNKNOWN', isPreferredElongationColumn: 'boolean', temperatureC: 'number|null', columnHeaders: 'string', yieldStrength02: 'number|null', yieldStrength10: 'number|null', yieldStrength10Explicit: 'boolean', tensileStrength: 'number|null', elongation: 'number|null', elongationA5: 'number|null', elongationA4: 'number|null', isPrimaryAcceptanceBlock: 'boolean', sourcePage: 'string|number|null', sourceQuote: 'string' }]"
    );
}

const pdfUploadPreparation = workflow.nodes.find((node) => node.name === "PDF-Upload vorbereiten");
if (pdfUploadPreparation) {
  if (!pdfUploadPreparation.parameters.jsCode.includes("function normalizeLandscapeScanRotation")) {
    pdfUploadPreparation.parameters.jsCode = pdfUploadPreparation.parameters.jsCode.replace(
      "const item = $input.first();",
      "function normalizeLandscapeScanRotation(input) {\n  const source = Buffer.from(input).toString('latin1');\n  const rotate270Count = (source.match(/\\/Rotate\\s+270\\b/g) ?? []).length;\n  const landscapeA4Count = (source.match(/\\/MediaBox\\s*\\[\\s*0(?:\\.0+)?\\s+0(?:\\.0+)?\\s+84[01](?:\\.\\d+)?\\s+59[45](?:\\.\\d+)?\\s*\\]/g) ?? []).length;\n  const largeImageDimensions = [...source.matchAll(/\\/Width\\s+(\\d+)[\\s\\S]{0,160}?\\/Height\\s+(\\d+)/g)].map((match) => ({ width: Number(match[1]), height: Number(match[2]) })).filter(({ width, height }) => width >= 1000 && height >= 1000);\n  const hasPortraitScannerPage = largeImageDimensions.some(({ width, height }) => height > width);\n  if (!rotate270Count || landscapeA4Count < rotate270Count || hasPortraitScannerPage) return { buffer: Buffer.from(input), applied: false, pageCount: 0 };\n  const corrected = source.replace(/\\/Rotate(\\s+)270\\b/g, (_, spacing) => '/Rotate' + spacing + '180');\n  return { buffer: Buffer.from(corrected, 'latin1'), applied: true, pageCount: rotate270Count };\n}\n\nconst item = $input.first();"
    );
  }
  pdfUploadPreparation.parameters.jsCode = pdfUploadPreparation.parameters.jsCode.replace(
    "const landscapeA4Count = (source.match(/\\/MediaBox\\s*\\[\\s*0(?:\\.0+)?\\s+0(?:\\.0+)?\\s+84[01](?:\\.\\d+)?\\s+59[45](?:\\.\\d+)?\\s*\\]/g) ?? []).length;\n  if (!rotate270Count || landscapeA4Count < rotate270Count)",
    "const landscapeA4Count = (source.match(/\\/MediaBox\\s*\\[\\s*0(?:\\.0+)?\\s+0(?:\\.0+)?\\s+84[01](?:\\.\\d+)?\\s+59[45](?:\\.\\d+)?\\s*\\]/g) ?? []).length;\n  const largeImageDimensions = [...source.matchAll(/\\/Width\\s+(\\d+)[\\s\\S]{0,160}?\\/Height\\s+(\\d+)/g)].map((match) => ({ width: Number(match[1]), height: Number(match[2]) })).filter(({ width, height }) => width >= 1000 && height >= 1000);\n  const hasPortraitScannerPage = largeImageDimensions.some(({ width, height }) => height > width);\n  if (!rotate270Count || landscapeA4Count < rotate270Count || hasPortraitScannerPage)"
  );
  pdfUploadPreparation.parameters.jsCode = pdfUploadPreparation.parameters.jsCode
    .replace(
      "const trailerStart = Math.max(0, pdfBuffer.length - 65536);\nconst trailer = pdfBuffer.subarray(trailerStart).toString('latin1');",
      "const rotationNormalization = normalizeLandscapeScanRotation(pdfBuffer);\nconst uploadSourceBuffer = rotationNormalization.buffer;\nconst trailerStart = Math.max(0, uploadSourceBuffer.length - 65536);\nconst trailer = uploadSourceBuffer.subarray(trailerStart).toString('latin1');"
    )
    .replace(
      "const xrefProbe = pdfBuffer.subarray(xrefOffset, Math.min(pdfBuffer.length, xrefOffset + 4096)).toString('latin1');",
      "const xrefProbe = uploadSourceBuffer.subarray(xrefOffset, Math.min(uploadSourceBuffer.length, xrefOffset + 4096)).toString('latin1');"
    )
    .replace(
      "uploadPdfBuffer = await normalizePdf(pdfBuffer);",
      "uploadPdfBuffer = await normalizePdf(uploadSourceBuffer);"
    )
    .replaceAll(
      "uploadPdfBuffer = Buffer.from(pdfBuffer);",
      "uploadPdfBuffer = Buffer.from(uploadSourceBuffer);"
    )
    .replace(
      "pdfNormalization: needsStructuralRewrite ? (pdfNormalizationError ? 'rewrite-failed-fallback-original' : 'object-streams-to-classic-xref') : 'not-required',\n      pdfNormalizationError",
      "pdfNormalization: needsStructuralRewrite ? (pdfNormalizationError ? 'rewrite-failed-fallback-original' : 'object-streams-to-classic-xref') : 'not-required',\n      pdfNormalizationError,\n      rotationNormalization: rotationNormalization.applied ? 'landscape-scan-270-to-180' : 'not-required',\n      rotationNormalizedPages: rotationNormalization.pageCount"
    )
    .replace(
      "const uploadPdfBuffer = needsStructuralRewrite\n  ? await normalizePdf(pdfBuffer)\n  : Buffer.from(pdfBuffer);",
      "let pdfNormalizationError = null;\nlet uploadPdfBuffer;\nif (needsStructuralRewrite) {\n  try {\n    uploadPdfBuffer = await normalizePdf(pdfBuffer);\n  } catch (error) {\n    pdfNormalizationError = String(error?.message ?? error);\n    uploadPdfBuffer = Buffer.from(pdfBuffer);\n  }\n} else {\n  uploadPdfBuffer = Buffer.from(pdfBuffer);\n}"
    )
    .replace(
      "pdfNormalization: needsStructuralRewrite ? 'object-streams-to-classic-xref' : 'not-required'",
      "pdfNormalization: needsStructuralRewrite ? (pdfNormalizationError ? 'rewrite-failed-fallback-original' : 'object-streams-to-classic-xref') : 'not-required',\n      pdfNormalizationError"
    )
    .replace(
      /pdfNormalizationApplied: needsStructuralRewrite(?: && !pdfNormalizationError)+/,
      "pdfNormalizationApplied: needsStructuralRewrite && !pdfNormalizationError"
    );
}

const finalValidation = workflow.nodes.find((node) => node.name === "Ergebnis validieren und Dokumentenreview vorbereiten");
if (finalValidation) {
  const deterministicCorrectionCode = String.raw`const evidenceValue = (value) => value && typeof value === 'object' && !Array.isArray(value) && Object.prototype.hasOwnProperty.call(value, 'value') ? value.value : value;
const canonicalEvidence = (value) => String(evidenceValue(value) ?? '').normalize('NFKD').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
const evidenceNumber = (value) => { const raw = evidenceValue(value); if (raw === null || raw === undefined || String(raw).trim() === '') return null; const number = Number(String(raw).trim().replace(',', '.')); return Number.isFinite(number) && number >= 0 ? number : null; };
const chemicalHeaderMap = {
  C: 'C', SI: 'SI', S: 'S', P: 'P', SN: 'SN', MN: 'MN', CR: 'CR', NI: 'NI', MO: 'MO', TI: 'TI', CO: 'CO', CU: 'CU', N: 'N', AL: 'AL', AI: 'AL', V: 'V', NB: 'NB', B: 'B', ZR: 'Zr', W: 'W', SB: 'Sb', AS: 'As', F1: 'AL/N',
  ALN: 'AL/N', NBV25: 'Nb+(V2,5)', NBVTI: 'Nb+V+Ti', MNC: 'Mn/C', CEV: 'CEV', VNB: 'V+NB', NICU: 'Ni+Cu', CUNICRMOV: 'Cu+Ni+Cr+Mo+V', CRCUMONI: 'Cr+Cu+Mo+Ni', CUMO: 'Cu+Mo',
};
const canonicalChemicalHeader = (value) => chemicalHeaderMap[canonicalEvidence(value)] ?? null;
const decodeHtmlCell = (value) => String(value ?? '')
  .replace(/<img\b[^>]*>/gi, ' ')
  .replace(/<br\s*\/?\s*>/gi, ' ')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
  .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
  .replace(/&nbsp;|&#160;/gi, ' ')
  .replace(/&amp;/gi, '&')
  .replace(/&lt;/gi, '<')
  .replace(/&gt;/gi, '>')
  .replace(/&quot;/gi, '"')
  .replace(/&#x27;|&apos;/gi, "'")
  .replace(/\s+/g, ' ')
  .trim();
const strictChemicalNumber = (value) => {
  const text = decodeHtmlCell(value).replace(/^[<>≈~]\s*/, '').replace(/\s*%$/, '').replace(/\s+/g, '');
  if (!/^-?\d+(?:[.,]\d+)?$/.test(text)) return null;
  const number = Number(text.replace(',', '.'));
  return Number.isFinite(number) && number >= 0 ? number : null;
};
const isActualAnalysisMarker = (value) => {
  const key = canonicalEvidence(value);
  return Boolean(key) && key.replace(/HEAT|ACTUAL|ACTUEL|IST|REP|CER|H/g, '') === '';
};
const expandHtmlTable = (tableHtml) => {
  const grid = [];
  const spans = new Map();
  for (const rowMatch of tableHtml.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const row = [];
    let column = 0;
    const consumeSpans = () => {
      while (spans.has(column)) {
        const span = spans.get(column);
        row[column] = span.value;
        span.remaining--;
        if (span.remaining <= 0) spans.delete(column);
        column++;
      }
    };
    for (const cellMatch of rowMatch[1].matchAll(/<(?:td|th)\b([^>]*)>([\s\S]*?)<\/(?:td|th)>/gi)) {
      consumeSpans();
      const attributes = cellMatch[1];
      const value = decodeHtmlCell(cellMatch[2]);
      const colspan = Math.max(1, Number(attributes.match(/\bcolspan\s*=\s*["']?(\d+)/i)?.[1] ?? 1));
      const rowspan = Math.max(1, Number(attributes.match(/\browspan\s*=\s*["']?(\d+)/i)?.[1] ?? 1));
      for (let offset = 0; offset < colspan; offset++) {
        row[column + offset] = value;
        if (rowspan > 1) spans.set(column + offset, { value, remaining: rowspan - 1 });
      }
      column += colspan;
    }
    const laterSpanColumns = [...spans.keys()].filter((spanColumn) => spanColumn >= column).sort((left, right) => left - right);
    for (const spanColumn of laterSpanColumns) {
      while (column < spanColumn) column++;
      consumeSpans();
    }
    grid.push(row);
  }
  return grid;
};
const labeledHeatKeys = (value) => {
  const text = decodeHtmlCell(value);
  const keys = [];
  for (const labelMatch of text.matchAll(/(?:HEAT[-\s]*(?:NO(?:\.|\b)|NUMBER|N[°º])|SCHMELZEN?[-\s]*(?:NR(?:\.|\b)|NO(?:\.|\b)|N[°º])|CHARGEN[°º]|CHARGEN?[-\s]*(?:NR(?:\.|\b)|NO(?:\.|\b)|N[°º]))/gi)) {
    const following = text.slice(labelMatch.index + labelMatch[0].length, labelMatch.index + labelMatch[0].length + 120);
    const token = [...following.matchAll(/[A-Z0-9][A-Z0-9./-]*/gi)]
      .map((match) => match[0])
      .find((candidate) => { const key = canonicalEvidence(candidate); return key.length >= 5 && /\d/.test(key); });
    const key = canonicalEvidence(token);
    if (key) keys.push(key);
  }
  return keys;
};
const sourceChemistryForHeat = (sourceText, heatKey) => {
  const chemistry = {};
  const source = String(sourceText ?? '');
  const tables = [...source.matchAll(/<table\b[^>]*>[\s\S]*?<\/table>/gi)];
  for (const tableMatch of tables) {
    const tableHtml = tableMatch[0];
    const vicinity = source.slice(Math.max(0, tableMatch.index - 4000), tableMatch.index) + tableHtml;
    const vicinityKey = canonicalEvidence(decodeHtmlCell(vicinity));
    if (!/(CHEM|COMPOSITION|ANALY|ZUSAMMENSETZUNG)/.test(vicinityKey)) continue;
    const tableLabeledHeats = labeledHeatKeys(tableHtml);
    const grid = expandHtmlTable(tableHtml);
    if (!grid.length) continue;
    let headerIndex = -1;
    let headerElements = [];
    for (let rowIndex = 0; rowIndex < grid.length; rowIndex++) {
      const elements = grid[rowIndex].map(canonicalChemicalHeader);
      if (elements.filter(Boolean).length >= 3 && elements.filter(Boolean).length > headerElements.filter(Boolean).length) {
        headerIndex = rowIndex;
        headerElements = elements;
      }
    }
    if (headerIndex < 0) continue;
    const elementColumns = headerElements.map((element, column) => element ? { element, column } : null).filter(Boolean);
    const firstElementColumn = Math.min(...elementColumns.map((entry) => entry.column));
    const scaleByColumn = new Map();
    for (const { column } of elementColumns) {
      let scale = 1;
      for (let rowIndex = headerIndex - 1; rowIndex >= 0; rowIndex--) {
        const match = decodeHtmlCell(grid[rowIndex][column]).match(/^X\s*(10000|1000|100)$/i);
        if (match) { scale = Number(match[1]); break; }
      }
      scaleByColumn.set(column, scale);
    }
    const tableHasHeat = grid.some((row) => row.some((cell) => canonicalEvidence(cell) === heatKey));
    if (tableLabeledHeats.length && !tableLabeledHeats.includes(heatKey) && !tableHasHeat) continue;
    if (!tableLabeledHeats.length && !tableHasHeat) {
      const precedingHeatKeys = labeledHeatKeys(source.slice(Math.max(0, tableMatch.index - 4000), tableMatch.index));
      if (precedingHeatKeys.length && precedingHeatKeys.at(-1) !== heatKey) continue;
    }
    const directAnalysisContext = /(HEATCHEMICALANALYSIS|SCHMELZANALYSE|CHARGENANALYSE|COMPOSITIONOFCAST|CHEMCOMPOSITIONOFCAST)/.test(vicinityKey);
    for (let rowIndex = headerIndex + 1; rowIndex < grid.length; rowIndex++) {
      const row = grid[rowIndex];
      const metadataCells = row.slice(0, firstElementColumn);
      const metadataKey = canonicalEvidence(metadataCells.join(' '));
      const rowHasHeat = row.some((cell) => canonicalEvidence(cell) === heatKey);
      const hasActualMarker = metadataCells.some(isActualAnalysisMarker);
      const hasProductMarker = metadataCells.some((cell) => ['P', 'PRODUCT', 'PRODUKT'].includes(canonicalEvidence(cell)));
      const isLimitRow = /(?:MAX|MIN|REQUIREMENT|ANFORDERUNG|SOLL)/.test(metadataKey);
      const values = elementColumns.map(({ element, column }) => ({ element, number: strictChemicalNumber(row[column]), scale: scaleByColumn.get(column) ?? 1 })).filter((entry) => entry.number !== null);
      const qualifies = !hasProductMarker && !isLimitRow && values.length >= 3 && (rowHasHeat || hasActualMarker || (tableHasHeat && directAnalysisContext));
      if (!qualifies) continue;
      for (const { element, number, scale } of values) chemistry[element] = number / scale;
      break;
    }
  }
  return chemistry;
};
const evidenceChemistryForHeat = (chunks, heatKey) => {
  const chemistry = {};
  for (const chunk of chunks) {
    for (const heat of Array.isArray(chunk?.heats) ? chunk.heats : []) {
      if (canonicalEvidence(heat?.heatNumber) !== heatKey) continue;
      for (const entry of Array.isArray(heat.chemistry) ? heat.chemistry : []) {
        if (!isActualAnalysisMarker(entry.analysisType)) continue;
        const element = canonicalChemicalHeader(entry.element);
        if (!element) continue;
        const rawValue = evidenceNumber(entry.rawValue);
        const scale = evidenceNumber(entry.scale);
        const declaredValue = evidenceNumber(entry.value);
        const value = rawValue !== null && [1, 10, 100, 1000, 10000].includes(scale) ? rawValue / scale : declaredValue;
        if (value !== null) chemistry[element] = value;
      }
    }
  }
  return chemistry;
};
const mergeCanonicalChemistry = (source, ...corrections) => {
  const merged = { ...(source && typeof source === 'object' && !Array.isArray(source) ? source : {}) };
  for (const correction of corrections) {
    for (const [element, value] of Object.entries(correction ?? {})) {
      for (const existing of Object.keys(merged)) if (canonicalChemicalHeader(existing) === element) delete merged[existing];
      merged[element] = value;
    }
  }
  return merged;
};
const gaugeType = (test) => {
  const source = [test.gaugeLengthType, test.gaugeLength, test.elongationType, test.elongationColumnType, test.columnHeaders, test.sourceQuote].map(evidenceValue).join(' ').toUpperCase().replace(/\s+/g, ' ');
  if (/\b(?:A5|5D)\b|L0\s*=\s*5\s*D/.test(source)) return 'A5';
  if (/\b(?:A4|4D)\b|L0\s*=\s*4\s*D/.test(source)) return 'A4';
  if (/\b2\s*(?:IN|INCH|ZOLL)\b|2[\"″]|50(?:[.,]8)?\s*MM/.test(source)) return '2IN';
  return 'UNKNOWN';
};
const fieldMinimum = (tests, field) => {
  const values = tests.map((test) => evidenceNumber(test[field])).filter((value) => value !== null && value > 0);
  return values.length ? Math.min(...values) : null;
};
const repairCollapsedPairedTests = (inputTests) => {
  const byQuote = new Map();
  for (const test of inputTests) {
    const quote = String(evidenceValue(test.sourceQuote) ?? '').trim();
    if (!quote) continue;
    if (!byQuote.has(quote)) byQuote.set(quote, []);
    byQuote.get(quote).push(test);
  }
  const consumed = new Set();
  const repaired = [];
  for (const [quote, quoteTests] of byQuote) {
    if (quoteTests.length !== 4 || !quote.includes('|') || !quote.includes('/')) continue;
    if (quoteTests.some((test) => evidenceNumber(test.yieldStrength10) !== null)) continue;
    const tensileOrder = [];
    for (const test of quoteTests) {
      const tensile = evidenceNumber(test.tensileStrength);
      if (tensile !== null && !tensileOrder.includes(tensile)) tensileOrder.push(tensile);
    }
    if (tensileOrder.length !== 2 || tensileOrder.some((tensile) => quoteTests.filter((test) => evidenceNumber(test.tensileStrength) === tensile).length !== 2)) continue;
    const yieldPairs = tensileOrder.map((tensile) => quoteTests.filter((test) => evidenceNumber(test.tensileStrength) === tensile).map((test) => evidenceNumber(test.yieldStrength02)).filter((value) => value !== null).sort((left, right) => left - right));
    const elongations = quoteTests.map((test) => evidenceNumber(test.elongation ?? test.elongationA5 ?? test.elongationA4));
    if (yieldPairs.some((pair) => pair.length !== 2 || pair[1] <= pair[0]) || elongations.some((value) => value === null)) continue;
    const template = quoteTests[0];
    for (let index = 0; index < tensileOrder.length; index++) {
      repaired.push({
        ...template,
        comparableGroupId: 'PAIRED-' + canonicalEvidence(quote).slice(0, 24),
        testBlockId: 'PAIRED-COLUMNS',
        specimenId: String(index + 1),
        tensileStrength: tensileOrder[index],
        yieldStrength02: yieldPairs[index][0],
        yieldStrength10: yieldPairs[index][1],
        yieldStrength10Explicit: true,
        elongation: elongations[index * 2],
        isPreferredElongationColumn: true,
      });
    }
    quoteTests.forEach((test) => consumed.add(test));
  }
  return inputTests.filter((test) => !consumed.has(test)).concat(repaired);
};
const sourcePreferredPairedElongations = (sourceText) => {
  const source = String(sourceText ?? '');
  for (const tableMatch of source.matchAll(/<table\b[^>]*>[\s\S]*?<\/table>/gi)) {
    const tableKey = canonicalEvidence(decodeHtmlCell(tableMatch[0]));
    if (!tableKey.includes('MECHANICAL') || !tableKey.includes('ELONGATION')) continue;
    for (const row of expandHtmlTable(tableMatch[0])) {
      for (const cell of row) {
        const text = decodeHtmlCell(cell);
        const match = text.match(/^(\d{2,3}(?:[.,]\d+)?)\s*\/\s*(\d{2,3}[.,]\d{1,2})(\d{2,3}[.,]\d+)\s*\/\s*(\d{2,3}(?:[.,]\d+)?)$/);
        if (!match) continue;
        const preferred = [strictChemicalNumber(match[1]), strictChemicalNumber(match[3])].filter((value) => value !== null);
        if (preferred.length === 2) return preferred;
      }
    }
  }
  return [];
};
const correctCertificateRow = (sourceRow) => {
  const row = { ...sourceRow };
  const heatKey = canonicalEvidence(row.heatNumber);
  const expectedPoKey = canonicalEvidence(context.orderData?.poNumber);
  const chunks = Array.isArray(context.evidence?.chunks) ? context.evidence.chunks : [];
  const deckCandidates = [];
  if (row.deckSelection && typeof row.deckSelection === 'object') {
    deckCandidates.push({ ...row.deckSelection, sourceBlockIndex: evidenceNumber(row.deckSelection.sourceBlockIndex) ?? -1 });
  }
  for (const [chunkIndex, chunk] of chunks.entries()) {
    const certificate = chunk?.certificate;
    if (!certificate || typeof certificate !== 'object') continue;
    const matchingHeat = (Array.isArray(chunk.heats) ? chunk.heats : []).find((heat) => canonicalEvidence(heat?.heatNumber) === heatKey);
    deckCandidates.push({
      documentRole: evidenceValue(certificate.documentRole),
      sourceBlockIndex: evidenceNumber(chunk?.sourceBlock?.index) ?? chunkIndex + 1,
      sourcePage: evidenceValue(certificate.sourcePage),
      deckIndicators: certificate.deckIndicators,
      certificateNumber: evidenceValue(certificate.certificateNumber),
      customerOrderNumber: evidenceValue(certificate.customerOrderNumber),
      manufacturer: evidenceValue(certificate.manufacturer),
      product: evidenceValue(certificate.product),
      dimensions: evidenceValue(certificate.dimensions),
      material: evidenceValue(Array.isArray(certificate.materials) ? certificate.materials[0] : null),
      quantity: evidenceValue(matchingHeat?.quantity),
    });
  }
  const usableDecks = deckCandidates.filter((candidate) => {
    const role = canonicalEvidence(candidate.documentRole);
    const poMatches = expectedPoKey && canonicalEvidence(candidate.customerOrderNumber) === expectedPoKey;
    return poMatches && !['RAWMATERIAL', 'APPROVAL', 'QM'].includes(role) && canonicalEvidence(candidate.certificateNumber);
  });
  usableDecks.sort((left, right) => {
    const roleScore = (candidate) => canonicalEvidence(candidate.documentRole) === 'DECK' ? 100 : 0;
    const indicators = (candidate) => Object.values(candidate.deckIndicators ?? {}).filter(Boolean).length;
    return roleScore(right) - roleScore(left) || indicators(right) - indicators(left) || Number(left.sourceBlockIndex ?? 9999) - Number(right.sourceBlockIndex ?? 9999);
  });
  const deck = usableDecks[0];
  if (deck) {
    const assignString = (target, source) => { const value = String(evidenceValue(source) ?? '').trim(); if (value && value !== '-1') row[target] = value; };
    assignString('certificateNumber', deck.certificateNumber);
    assignString('customerOrderNumber', deck.customerOrderNumber);
    assignString('creditor', deck.manufacturer);
    assignString('product', deck.product);
    assignString('dimensions', deck.dimensions);
    assignString('werkstoff1', deck.material);
    const deckQuantity = evidenceNumber(deck.quantity);
    if (deckQuantity !== null && deckQuantity > 0) row.quantity = deckQuantity;
  }

  const criticalSource = String(context.criticalSource ?? '');
  const criticalHeader = criticalSource.slice(0, 16000);
  const expectedPo = String(context.orderData?.poNumber ?? '').trim();
  if (expectedPo && canonicalEvidence(criticalSource).includes(canonicalEvidence(expectedPo))) {
    row.customerOrderNumber = expectedPo;
  }
  const certificateMatches = [...criticalHeader.matchAll(/\b(?:NO|NR|N°)\s*[:.]?\s*([A-Z]{1,8}-[A-Z0-9][A-Z0-9./-]{3,})/gi)]
    .map((match) => match[1])
    .filter((value) => !/^(?:PO|PU|AB)-/i.test(value));
  if (certificateMatches.length && /^(?:PO|PU|AB)-/i.test(String(row.certificateNumber ?? ''))) {
    row.certificateNumber = certificateMatches[0];
  }
  const materialStandardSource = [row.werkstoff1, criticalHeader].join(' ');
  const materialStandards = [];
  for (const match of materialStandardSource.matchAll(/\b(ASTM|ASME)\s+(SA|A)\s*[- ]?\s*(\d{3,4})M?\s*[-–:]\s*(\d{2,4})\b/gi)) {
    const organization = match[1].toUpperCase();
    const prefix = match[2].toUpperCase();
    const normalized = organization + ' ' + (prefix === 'SA' ? 'SA-' : 'A') + match[3] + 'M-' + match[4];
    if (!materialStandards.some((value) => canonicalEvidence(value) === canonicalEvidence(normalized))) materialStandards.push(normalized);
  }
  if (materialStandards.length) {
    const existingNorms = [row.norm1, row.norm2, row.norm3, row.norm4, row.norm5]
      .map((value) => String(value ?? '').trim())
      .filter((value) => value && value !== '-1' && !materialStandards.some((standard) => canonicalEvidence(value).includes(canonicalEvidence(standard))));
    const mergedNorms = materialStandards.concat(existingNorms).slice(0, 5);
    for (let index = 0; index < 5; index++) row['norm' + (index + 1)] = mergedNorms[index] ?? '-1';
  }

  const evidenceChemistry = evidenceChemistryForHeat(chunks, heatKey);
  const sourceChemistry = sourceChemistryForHeat(criticalSource, heatKey);
  row.chemicals = mergeCanonicalChemistry(row.chemicals, evidenceChemistry, sourceChemistry);

  const modelTests = Array.isArray(row.mechanicalSelection?.tests) ? row.mechanicalSelection.tests : [];
  const evidenceTests = chunks.flatMap((chunk, chunkIndex) => (Array.isArray(chunk?.heats) ? chunk.heats : [])
    .filter((heat) => canonicalEvidence(heat?.heatNumber) === heatKey)
    .flatMap((heat) => (Array.isArray(heat.tensileTests) ? heat.tensileTests : []).map((test) => ({ ...test, _chunkIndex: chunkIndex }))));
  let tests = repairCollapsedPairedTests(evidenceTests.length ? evidenceTests : modelTests);
  const deduplicatedTests = [];
  const seenTests = new Set();
  for (const test of tests) {
    const key = JSON.stringify([
      canonicalEvidence(test.comparableGroupId ?? test.testBlockId), canonicalEvidence(test.specimenId), gaugeType(test),
      evidenceNumber(test.temperatureC), evidenceNumber(test.yieldStrength02), evidenceNumber(test.yieldStrength10),
      evidenceNumber(test.tensileStrength), evidenceNumber(test.elongation ?? test.elongationA5 ?? test.elongationA4), canonicalEvidence(test.sourceQuote),
    ]);
    if (!seenTests.has(key)) { seenTests.add(key); deduplicatedTests.push(test); }
  }
  tests = deduplicatedTests;
  const gaugePriority = { A5: 3, A4: 2, '2IN': 1, UNKNOWN: 0 };
  const bestGaugePriority = tests.reduce((best, test) => Math.max(best, gaugePriority[gaugeType(test)] ?? 0), -1);
  if (bestGaugePriority > 0) tests = tests.filter((test) => (gaugePriority[gaugeType(test)] ?? 0) === bestGaugePriority);
  const primaryTests = tests.filter((test) => test.isPrimaryAcceptanceBlock === true || test.selectedForFinalValues === true);
  if (primaryTests.length) tests = primaryTests;
  const requirementTests = tests.filter((test) => /(?:\bMIN\.?|\bMAX\.?|>=|<=|≥|≤|\bREQUIREMENTS?\b|\bANFORDERUNGEN?\b|\bCONDITIONS?\b|\(\s*\d+(?:[.,]\d+)?\s*\/\s*\d+)/i.test(String(test.sourceQuote ?? '')));
  if (requirementTests.length && requirementTests.length < tests.length) tests = requirementTests;
  const roomTemperatureTests = tests.filter((test) => {
    const temperature = evidenceNumber(test.temperatureC);
    return temperature !== null && temperature >= 20 && temperature <= 23;
  });
  if (roomTemperatureTests.length) tests = roomTemperatureTests;
  if (tests.length) {
    const groups = new Map();
    for (const test of tests) {
      const group = String(test._chunkIndex ?? 'MODEL') + ':' + (canonicalEvidence(test.testBlockId ?? test.comparableGroupId) || 'UNKNOWN');
      if (!groups.has(group)) groups.set(group, []);
      groups.get(group).push(test);
    }
    if (groups.size > 1) {
      const scoredGroups = [...groups.values()].map((groupTests) => ({
        tests: groupTests,
        score: groupTests.reduce((score, test) => score + ['yieldStrength02', 'tensileStrength', 'elongation', 'elongationA5', 'elongationA4'].filter((field) => evidenceNumber(test[field]) !== null).length, 0),
        invalidOffsets: groupTests.filter((test) => { const yield02 = evidenceNumber(test.yieldStrength02); const yield10 = evidenceNumber(test.yieldStrength10); return yield02 !== null && yield10 !== null && yield10 < yield02; }).length,
        firstChunk: Math.min(...groupTests.map((test) => Number(test._chunkIndex ?? 9999))),
      })).sort((left, right) => left.invalidOffsets - right.invalidOffsets || right.score - left.score || left.firstChunk - right.firstChunk);
      tests = scoredGroups[0].tests;
    }
  }
  if (tests.length) {
    const normalizedTests = tests.map((test) => ({
      ...test,
      elongation: evidenceValue(test.elongation) ?? (gaugeType(test) === 'A4' ? evidenceValue(test.elongationA4) : evidenceValue(test.elongationA5)),
    }));
    for (const field of ['yieldStrength02', 'tensileStrength']) {
      const minimum = fieldMinimum(normalizedTests, field);
      if (minimum !== null) row[field] = minimum;
    }
    const preferredElongationTests = normalizedTests.filter((test) => test.isPreferredElongationColumn === true);
    const elongation = fieldMinimum(preferredElongationTests.length ? preferredElongationTests : normalizedTests, 'elongation');
    if (elongation !== null) row.elongation = elongation;
    const explicitRp10Tests = normalizedTests.filter((test) => test.yieldStrength10Explicit === true || /RP\s*1(?:[.,]0)?|1\s*%/i.test(String(test.columnHeaders ?? '')));
    const yieldStrength10 = fieldMinimum(explicitRp10Tests, 'yieldStrength10');
    if (yieldStrength10 !== null) row.yieldStrength10 = yieldStrength10;
  }
  const sourcePreferredElongations = sourcePreferredPairedElongations(criticalSource);
  if (sourcePreferredElongations.length) row.elongation = Math.min(...sourcePreferredElongations);
  const yield02 = evidenceNumber(row.yieldStrength02);
  const yield10 = evidenceNumber(row.yieldStrength10);
  if (yield02 !== null && yield10 !== null && yield10 < yield02) {
    row.yieldStrength10 = -1;
    row.humanRequired = true;
    row.mechanicalValidationError = 'Rp1.0 is lower than Rp0.2; likely column or row drift.';
  }
  return row;
};`;
  const correctionStart = finalValidation.parameters.jsCode.indexOf("const evidenceValue =");
  const correctionEndMarker = "  return row;\n};";
  const correctionEnd = correctionStart >= 0 ? finalValidation.parameters.jsCode.indexOf(correctionEndMarker, correctionStart) : -1;
  if (correctionStart >= 0 && correctionEnd >= 0) {
    finalValidation.parameters.jsCode = finalValidation.parameters.jsCode.slice(0, correctionStart)
      + deterministicCorrectionCode
      + finalValidation.parameters.jsCode.slice(correctionEnd + correctionEndMarker.length);
  } else if (!finalValidation.parameters.jsCode.includes("const correctCertificateRow =")) {
    finalValidation.parameters.jsCode = finalValidation.parameters.jsCode.replace(
      "const normalized = rows.map((row) => {",
      deterministicCorrectionCode + "\nconst normalized = rows.map((sourceRow) => {\n  const row = correctCertificateRow(sourceRow);"
    );
  }
  finalValidation.parameters.jsCode = finalValidation.parameters.jsCode
    .replace(
      "const dm = dimensionsRaw.match(/(\\d{1,4}(?:[.,]\\d+)?)\\s*(?:mm[^0-9]*)?(?:x|×|\\/)\\s*(\\d{1,4}(?:[.,]\\d+)?)/i);\n  const dimensions = dimensionsRaw === '-1' ? '-1' : (dm ? dm[1].replace(',', '.') + ' x ' + dm[2].replace(',', '.') + ' mm' : '-1');",
      "const dimensionPairs = [...dimensionsRaw.matchAll(/(\\d{1,4}(?:[.,]\\d+)?)\\s*(?:mm[^0-9]*)?(?:x|×)\\s*(\\d{1,4}(?:[.,]\\d+)?)/gi)];\n  const dimensions = dimensionsRaw === '-1' ? '-1' : (dimensionPairs.length ? dimensionPairs.map(match => match[1].replace(',', '.') + ' x ' + match[2].replace(',', '.')).join(' / ') + ' mm' : '-1');"
    )
    .replace(
      "certificateNumber: toString(row.certificateNumber), quantity, creditor:",
      "certificateNumber: toString(row.certificateNumber), rawMaterialCertificate: toString(row.rawMaterialCertificate), quantity, creditor:"
    );
}

const normalizationPreparation = workflow.nodes.find((node) => node.name === "Belege sammeln und Normalisierung bauen");
if (normalizationPreparation) {
  const legacyTraceSchema = "    deckSelection: { documentRole: 'DECK', sourceBlockIndex: 'number', sourcePage: 'string|number|null', selectionReason: 'string', certificateNumber: 'string', customerOrderNumber: 'string', manufacturer: 'string', product: 'string', dimensions: 'string', material: 'string', quantity: 'number' },\n    mechanicalSelection: { selectedComparableGroupId: 'string', gaugeLengthType: 'A5|5D|A4|2IN|OTHER|UNKNOWN', selectionReason: 'string', tests: [{ comparableGroupId: 'string', testBlockId: 'string', specimenId: 'string|null', specimenLocation: 'string|null', gaugeLengthType: 'A5|5D|A4|2IN|OTHER|UNKNOWN', temperatureC: 'number|null', columnHeaders: 'string', yieldStrength02: 'number|null', yieldStrength10: 'number|null', yieldStrength10Explicit: 'boolean', tensileStrength: 'number|null', elongation: 'number|null', sourceQuote: 'string' }] },\n";
  const traceSchema = "    deckSelection: { documentRole: 'DECK', sourceBlockIndex: 'number', sourcePage: 'string|number|null', selectionReason: 'string', certificateNumber: 'string', customerOrderNumber: 'string', manufacturer: 'string', product: 'string', dimensions: 'string', material: 'string', quantity: 'number' },\n    mechanicalSelection: { selectedComparableGroupId: 'string', gaugeLengthType: 'A5|5D|A4|2IN|OTHER|UNKNOWN', selectionReason: 'string', tests: [{ comparableGroupId: 'string', testBlockId: 'string', specimenId: 'string|null', specimenLocation: 'string|null', gaugeLengthType: 'A5|5D|A4|2IN|OTHER|UNKNOWN', elongationColumnType: 'A5|5D|A4|2IN|FS|PRIMARY|SECONDARY|UNKNOWN', isPreferredElongationColumn: 'boolean', temperatureC: 'number|null', columnHeaders: 'string', yieldStrength02: 'number|null', yieldStrength10: 'number|null', yieldStrength10Explicit: 'boolean', tensileStrength: 'number|null', elongation: 'number|null', sourceQuote: 'string' }] },\n";
  normalizationPreparation.parameters.jsCode = normalizationPreparation.parameters.jsCode
    .replace(
      "const sourceText = String(source.pair.certificate?.markdown ?? '').replace(/\\r\\n?/g, '\\n');\nconst criticalSource = sourceText.slice(0, 60000);",
      "const sourceText = String(source.pair.certificate?.markdown ?? '').replace(/\\r\\n?/g, '\\n');\nconst sourceTextWithoutEmbeddedImages = sourceText\n  .replace(/<img\\b[^>]*>/gi, '[embedded image omitted]')\n  .replace(/data:image\\/[a-z0-9.+-]+;base64,[a-z0-9+/=]+/gi, '[embedded image omitted]');\nconst criticalSource = sourceTextWithoutEmbeddedImages.slice(0, 90000);"
    )
    .replaceAll(legacyTraceSchema, "")
    .replaceAll(traceSchema, "")
    .replace(
      "certificateNumber: 'string', quantity: 'number', creditor:",
      "certificateNumber: 'string', rawMaterialCertificate: 'string', quantity: 'number', creditor:"
    )
    .replace(
      /Übernimm certificateNumber, customerOrderNumber, quantity, creditor, product, dimensions und werkstoff aus dem Deckzeugnis\.(?: rawMaterialCertificate ist die Nummer des eindeutig zugeordneten Roh-\/Vormaterialzeugnisses; fehlt eine solche Anlage, ist der Wert -1\.)*/g,
      "Übernimm certificateNumber, customerOrderNumber, quantity, creditor, product, dimensions und werkstoff aus dem Deckzeugnis. rawMaterialCertificate ist die Nummer des eindeutig zugeordneten Roh-/Vormaterialzeugnisses; fehlt eine solche Anlage, ist der Wert -1."
    )
    .replace(
      "Bei mehreren vergleichbaren Messungen je Feld den kleinsten Wert derselben Schmelze verwenden.",
      "Bei mehreren Messblöcken derselben Schmelze den primären, durch Prüfanforderungen und Probenlage der Produktposition belegten Abnahmeblock verwenden."
    )
    .replace(
      "    yieldStrength02: 'number', yieldStrength10:",
      traceSchema + "    yieldStrength02: 'number', yieldStrength10:"
    );
}
appendPromptRule(
  normalizationPreparation,
  "  'Übernimm certificateNumber, customerOrderNumber, quantity, creditor, product, dimensions und werkstoff aus dem Deckzeugnis. rawMaterialCertificate ist die Nummer des eindeutig zugeordneten Roh-/Vormaterialzeugnisses; fehlt eine solche Anlage, ist der Wert -1. Nutze angehängte Vormaterialzeugnisse nur für die zugehörige Chemie, Mechanik und ergänzende Normen.',",
  deckCertificateRule,
);
appendPromptRule(
  normalizationPreparation,
  "  '" + deckCertificateRule + "',",
  coverCertificateRule,
);
appendPromptRule(
  normalizationPreparation,
  "  'Mechanik aus Messwerten bei Raumtemperatur (typisch 20 bis 23 °C). Bei mehreren vergleichbaren Messungen je Feld den kleinsten Wert derselben Schmelze verwenden. A5 bevorzugen; A4 nur verwenden, wenn kein A5-Wert belegt ist. yieldStrength10 nur bei ausdrücklich 1,0 % Offset.',",
  exactMechanicalRule,
);
appendPromptRule(
  normalizationPreparation,
  "  '" + exactMechanicalRule + "',",
  offsetYieldRule,
);
appendPromptRule(normalizationPreparation, "  '" + offsetYieldRule + "',", deterministicMechanicalRule);
appendPromptRule(normalizationPreparation, "  '" + deterministicMechanicalRule + "',", deckTraceRule);
appendPromptRule(normalizationPreparation, "  '" + deckTraceRule + "',", stackedMechanicalRowsRule);
appendPromptRule(normalizationPreparation, "  '" + stackedMechanicalRowsRule + "',", pairedMechanicalColumnsRule);
appendPromptRule(normalizationPreparation, "  '" + pairedMechanicalColumnsRule + "',", acceptanceBlockRule);
appendPromptRule(normalizationPreparation, "  '" + coverCertificateRule + "',", headerLabelRule);
appendPromptRule(normalizationPreparation, "  '" + headerLabelRule + "',", materialStandardRule);
const qualityPreparation = workflow.nodes.find((node) => node.name === "Qualitätsprüfung vorbereiten");
if (qualityPreparation) {
  qualityPreparation.parameters.jsCode = qualityPreparation.parameters.jsCode
    .replace(
      /Chemie und Mechanik aus dem je Schmelze referenzierten Vormaterialzeugnis\.(?: Dessen Zertifikatsnummer als rawMaterialCertificate erhalten\.)*/g,
      "Chemie und Mechanik aus dem je Schmelze referenzierten Vormaterialzeugnis. Dessen Zertifikatsnummer als rawMaterialCertificate erhalten."
    )
    .replace(
      "Bei mehreren vergleichbaren Messungen den kleinsten Wert je Feld verwenden;",
      "Bei mehreren Messblöcken den primären, durch Prüfanforderungen und Probenlage belegten Abnahmeblock verwenden;"
    );
}
appendPromptRule(
  qualityPreparation,
  "  'Bei einem Deckzeugnis mit Vormaterialanlagen gilt: Report-/Zertifikatsnummer, Kundenbestellung, Position, Menge, Aussteller, Produkt, Abmessung und Werkstoff stammen vom Deckzeugnis; Chemie und Mechanik aus dem je Schmelze referenzierten Vormaterialzeugnis. Dessen Zertifikatsnummer als rawMaterialCertificate erhalten.',",
  deckCertificateRule,
);
appendPromptRule(
  qualityPreparation,
  "  '" + deckCertificateRule + "',",
  coverCertificateRule,
);
appendPromptRule(
  qualityPreparation,
  "  'Mechanik bei Raumtemperatur 20 bis 23 °C bevorzugen. Bei mehreren vergleichbaren Messungen den kleinsten Wert je Feld verwenden; A5 bevorzugen und A4 nicht mit A5 mischen.',",
  exactMechanicalRule,
);
appendPromptRule(
  qualityPreparation,
  "  '" + exactMechanicalRule + "',",
  offsetYieldRule,
);
appendPromptRule(qualityPreparation, "  '" + offsetYieldRule + "',", deterministicMechanicalRule);
appendPromptRule(qualityPreparation, "  '" + deterministicMechanicalRule + "',", deckTraceRule);
appendPromptRule(qualityPreparation, "  '" + deckTraceRule + "',", stackedMechanicalRowsRule);
appendPromptRule(qualityPreparation, "  '" + stackedMechanicalRowsRule + "',", pairedMechanicalColumnsRule);
appendPromptRule(qualityPreparation, "  '" + pairedMechanicalColumnsRule + "',", acceptanceBlockRule);
appendPromptRule(qualityPreparation, "  '" + coverCertificateRule + "',", headerLabelRule);
appendPromptRule(qualityPreparation, "  '" + headerLabelRule + "',", materialStandardRule);

const mineruErrorPreparation = workflow.nodes.find((node) => node.name === "MinerU-Fehler vorbereiten");
if (mineruErrorPreparation) {
  mineruErrorPreparation.parameters.jsCode = String.raw`const status = $input.first().json ?? {};
let original = {};
try { original = $('Einordnung lesen').first().json; } catch {}
if (!original.mailId) { try { original = $('Evaluations-PDF vorbereiten').first().json; } catch {} }
const detail = status.extraction_error ?? status.error ?? status.message ?? 'Unbekannter Fehler';
if (original.evaluationRun) {
  const state = $getWorkflowStaticData('global');
  state.mineruEvaluationRetries ??= {};
  const now = Date.now();
  for (const [key, entry] of Object.entries(state.mineruEvaluationRetries)) {
    if (now - Number(entry?.updatedAt ?? 0) > 24 * 60 * 60 * 1000) delete state.mineruEvaluationRetries[key];
  }
  const retryKey = String($execution?.id ?? original.caseId ?? original.mailId);
  const attempt = Number(state.mineruEvaluationRetries[retryKey]?.attempt ?? 0) + 1;
  state.mineruEvaluationRetries[retryKey] = { attempt, updatedAt: now };
  if (attempt >= 3) {
    delete state.mineruEvaluationRetries[retryKey];
    throw new Error('MinerU extraction failed during evaluation after 3 attempts: ' + String(detail));
  }
  const uploadItem = $('PDF-Upload vorbereiten').first();
  return [{ json: { ...uploadItem.json, mineruEvaluationRetry: true, mineruEvaluationRetryAttempt: attempt }, binary: uploadItem.binary }];
}
return [{ json: { replyMailId: original.mailId, replyText: 'Die Zertifikatsextraktion mit MinerU ist fehlgeschlagen.\n\n' + String(detail) } }];`;
}

for (const [name, tries, delay] of [
  ["MinerU-Status prüfen", 3, 5000],
  ["PDF mit MinerU lesen", 3, 5000],
  ["Dokumentenreview anlegen", 3, 5000],
  ["Original-PDF in Review-Speicher hochladen", 3, 5000],
  ["Dokumentenreview-Upload abschließen", 3, 5000],
  ["MinerU-Fehler an Absender", 3, 2000],
  ["MinerU-Ausgabe an Absender", 3, 2000],
  ["Bestätigung per Outlook", 3, 2000],
  ["Ergebnis per Outlook senden", 3, 2000]
]) {
  const node = workflow.nodes.find((entry) => entry.name === name);
  if (!node) continue;
  node.retryOnFail = true;
  node.maxTries = tries;
  node.waitBetweenTries = delay;
}

function upsertNode(definition) {
  const current = workflow.nodes.find((node) => node.name === definition.name);
  if (current) Object.assign(current, definition);
  else workflow.nodes.push(definition);
}

upsertNode({
  parameters: {
    conditions: {
      options: { caseSensitive: true, leftValue: "", typeValidation: "strict", version: 2 },
      conditions: [{ id: "0b62413a-42a2-492f-9382-d7e830449ca9", leftValue: "={{ $json.mineruEvaluationRetry === true }}", rightValue: true, operator: { type: "boolean", operation: "true", singleValue: true } }],
      combinator: "and"
    },
    options: {}
  },
  id: "343ac9dc-af48-441a-9e07-7270d83c8a91",
  name: "MinerU-Evaluierung erneut versuchen?",
  type: "n8n-nodes-base.if",
  typeVersion: 2.2,
  position: [2864, -80]
});
upsertNode({
  parameters: { amount: 15 },
  id: "93b77478-038f-4afb-a0f7-03524d7c83fd",
  name: "Vor MinerU-Evaluierungsretry warten",
  type: "n8n-nodes-base.wait",
  typeVersion: 1.1,
  position: [3120, -80],
  webhookId: "664261aa-d173-4735-8c87-f335aeab41db"
});
workflow.connections["MinerU-Fehler vorbereiten"] = { main: [[{ node: "MinerU-Evaluierung erneut versuchen?", type: "main", index: 0 }]] };
workflow.connections["MinerU-Evaluierung erneut versuchen?"] = { main: [
  [{ node: "Vor MinerU-Evaluierungsretry warten", type: "main", index: 0 }],
  [{ node: "Letzter MinerU-Versuch?", type: "main", index: 0 }]
] };
workflow.connections["Vor MinerU-Evaluierungsretry warten"] = { main: [[{ node: "PDF bei MinerU einreichen", type: "main", index: 0 }]] };

upsertNode({
  parameters: {
    jsCode: "const item = $input.first();\nreturn [{ json: { ...item.json, mineruPollStartedAt: Date.now(), mineruMaxPollingMs: 10 * 60 * 1000 }, binary: item.binary }];"
  },
  id: "30df4a44-030c-492c-8e0c-886515644d9a",
  name: "MinerU-Polling initialisieren",
  type: "n8n-nodes-base.code",
  typeVersion: 2,
  position: [1824, -16]
});
upsertNode({
  parameters: {
    jsCode: "const status = $input.first().json;\nconst started = $('MinerU-Polling initialisieren').first().json;\nconst statusValue = String(status.extraction_status ?? status.status ?? '').toLowerCase();\nconst timedOut = !['succeeded','failed'].includes(statusValue) && Date.now() - Number(started.mineruPollStartedAt) >= Number(started.mineruMaxPollingMs);\nreturn [{ json: timedOut ? { ...status, extraction_status: 'failed', mineruTimedOut: true, error: 'MinerU polling exceeded 10 minutes.' } : status }];"
  },
  id: "67ab9fea-9a31-45db-af66-4000726740bb",
  name: "MinerU-Polling begrenzen",
  type: "n8n-nodes-base.code",
  typeVersion: 2,
  position: [2336, -16]
});
workflow.connections["PDF bei MinerU einreichen"] = { main: [[{ node: "MinerU-Polling initialisieren", type: "main", index: 0 }]] };
workflow.connections["MinerU-Polling initialisieren"] = { main: [[{ node: "Auf MinerU warten", type: "main", index: 0 }]] };
workflow.connections["MinerU-Status prüfen"] = { main: [[{ node: "MinerU-Polling begrenzen", type: "main", index: 0 }]] };
workflow.connections["MinerU-Polling begrenzen"] = { main: [[
  { node: "Bearbeitungslease erneuern", type: "main", index: 0 },
  { node: "MinerU fertig?", type: "main", index: 0 }
]] };

const notificationGateCode = kind => `const item = $input.first();
const key = String(item.json.replyMailId ?? item.json.sourceMails?.certificate?.id ?? item.json.correlationKey ?? 'unknown');
const state = $getWorkflowStaticData('global');
state.certificateNotifications ??= {};
const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
for (const [id, value] of Object.entries(state.certificateNotifications)) if (Number(value.updatedAt ?? 0) < cutoff) delete state.certificateNotifications[id];
return [{ json: { ...item.json, notificationKey: key, notificationAlreadySent: Boolean(state.certificateNotifications[key]?.${kind}) }, binary: item.binary }];`;
const notificationRememberCode = (kind, sourceNode) => `const item = $input.first();
const source = $('${sourceNode}').first().json;
const key = String(source.notificationKey ?? source.replyMailId ?? source.sourceMails?.certificate?.id ?? source.correlationKey ?? 'unknown');
const state = $getWorkflowStaticData('global');
state.certificateNotifications ??= {};
state.certificateNotifications[key] = { ...(state.certificateNotifications[key] ?? {}), ${kind}: true, updatedAt: Date.now() };
return $input.all().map(entry => ({ ...entry, json: { ...source, ...entry.json }, binary: entry.binary ?? item.binary }));`;

upsertNode({ parameters: { jsCode: notificationGateCode("mineru") }, id: "c983ad35-07c5-4421-83cb-250009592ed2", name: "MinerU-Antwortstatus prüfen", type: "n8n-nodes-base.code", typeVersion: 2, position: [3104, -224] });
upsertNode({
  parameters: { conditions: { options: { caseSensitive: true, leftValue: "", typeValidation: "strict", version: 2 }, conditions: [{ id: "ac3abb08-12e3-448f-87c7-fcbd2f98e52b", leftValue: "={{ $json.notificationAlreadySent }}", rightValue: true, operator: { type: "boolean", operation: "true", singleValue: true } }], combinator: "and" }, options: {} },
  id: "00cfde9a-09c9-4446-b4c5-363c8c4f2288", name: "MinerU-Antwort bereits gesendet?", type: "n8n-nodes-base.if", typeVersion: 2.2, position: [3360, -224]
});
upsertNode({ parameters: { jsCode: notificationRememberCode("mineru", "MinerU-Antwortstatus prüfen") }, id: "21032073-35f5-45cc-92ab-8b24259978b3", name: "MinerU-Antwort merken", type: "n8n-nodes-base.code", typeVersion: 2, position: [3872, -224] });
workflow.connections["MinerU-Ausgabe für Antwort vorbereiten"] = { main: [[{ node: "MinerU-Antwortstatus prüfen", type: "main", index: 0 }]] };
workflow.connections["MinerU-Antwortstatus prüfen"] = { main: [[{ node: "MinerU-Antwort bereits gesendet?", type: "main", index: 0 }]] };
workflow.connections["MinerU-Antwort bereits gesendet?"] = { main: [[], [{ node: "MinerU-Ausgabe an Absender", type: "main", index: 0 }]] };
workflow.connections["MinerU-Ausgabe an Absender"] = { main: [[{ node: "MinerU-Antwort merken", type: "main", index: 0 }]] };
workflow.connections["MinerU-Antwort merken"] = { main: [[]] };

upsertNode({ parameters: { jsCode: notificationGateCode("result") }, id: "8f25c804-54f9-4f05-9981-7964e4d4cbf6", name: "Ergebnisantwortstatus prüfen", type: "n8n-nodes-base.code", typeVersion: 2, position: [4416, 16] });
upsertNode({
  parameters: { conditions: { options: { caseSensitive: true, leftValue: "", typeValidation: "strict", version: 2 }, conditions: [{ id: "bb1f9228-5d26-4dc2-87e0-0543ab6e7a6a", leftValue: "={{ $json.notificationAlreadySent }}", rightValue: true, operator: { type: "boolean", operation: "true", singleValue: true } }], combinator: "and" }, options: {} },
  id: "cf27a382-fda8-4d9d-8371-1e1342dfe1af", name: "Ergebnisantwort bereits gesendet?", type: "n8n-nodes-base.if", typeVersion: 2.2, position: [4672, 16]
});
upsertNode({ parameters: { jsCode: notificationRememberCode("result", "Ergebnisantwortstatus prüfen") }, id: "dc490fcc-0dca-465a-bda0-a067f0dbbb38", name: "Ergebnisantwort merken", type: "n8n-nodes-base.code", typeVersion: 2, position: [5184, 16] });
workflow.connections["Dokumentenreview im Ergebnis verknüpfen"] = { main: [[{ node: "Ergebnisantwortstatus prüfen", type: "main", index: 0 }]] };
workflow.connections["Ergebnisantwortstatus prüfen"] = { main: [[{ node: "Ergebnisantwort bereits gesendet?", type: "main", index: 0 }]] };
workflow.connections["Ergebnisantwort bereits gesendet?"] = { main: [
  [{ node: "Outlook-Mail erfolgreich abschließen", type: "main", index: 0 }],
  [{ node: "Ergebnis per Outlook senden", type: "main", index: 0 }]
] };
workflow.connections["Ergebnis per Outlook senden"] = { main: [[{ node: "Ergebnisantwort merken", type: "main", index: 0 }]] };
workflow.connections["Ergebnisantwort merken"] = { main: [[{ node: "Outlook-Mail erfolgreich abschließen", type: "main", index: 0 }]] };

const dispatcherPath = path.join(ROOT, "workflows/outlook-certificate-dispatcher.json");
const dispatcher = JSON.parse(readFileSync(dispatcherPath, "utf8"));
dispatcher.settings ??= {};
delete dispatcher.settings.concurrency;
const dispatcherPlanner = dispatcher.nodes.find((node) => node.name === "Queue planen");
if (dispatcherPlanner && !dispatcherPlanner.parameters.jsCode.includes("DISPATCHER_LOCK_MS")) {
  dispatcherPlanner.parameters.jsCode = dispatcherPlanner.parameters.jsCode.replace(
    "const OWN_ADDRESS = 'certificates@daimension.de';\n\nconst state = $getWorkflowStaticData('global');",
    "const OWN_ADDRESS = 'certificates@daimension.de';\nconst DISPATCHER_LOCK_MS = 55 * 1000;\n\nconst state = $getWorkflowStaticData('global');\nconst dispatcherExecutionId = String($execution?.id ?? 'unknown');\nconst dispatcherLock = state.dispatcherLock ?? {};\nif (dispatcherLock.owner !== dispatcherExecutionId && Number(dispatcherLock.expiresAt ?? 0) > Date.now()) return [];\nstate.dispatcherLock = { owner: dispatcherExecutionId, expiresAt: Date.now() + DISPATCHER_LOCK_MS };"
  );
}
writeFileSync(dispatcherPath, `${JSON.stringify(dispatcher, null, 2)}\n`);

writeFileSync(workflowPath, `${JSON.stringify(workflow, null, 2)}\n`);
console.log(`Prepared ${workflowPath}`);
