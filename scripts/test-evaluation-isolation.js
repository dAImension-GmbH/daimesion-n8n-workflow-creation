#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workflow = JSON.parse(readFileSync(path.join(ROOT, "workflows/outlook-certificate-analysis.json"), "utf8"));
const evaluationPreparation = readFileSync(path.join(ROOT, "scripts/prepare-certificate-evaluation-workflow.js"), "utf8");
const evaluator = readFileSync(path.join(ROOT, "scripts/certificate-evaluator-code.js"), "utf8");

const productionPromptNodes = [
  "Mail vorbereiten",
  "Zeugnis in Belegblöcke teilen",
  "Belege sammeln und Normalisierung bauen",
  "Qualitätsprüfung vorbereiten",
];
const workflowRepresentations = [
  { label: "editable workflow", nodes: workflow.nodes },
  ...(Array.isArray(workflow.activeVersion?.nodes)
    ? [{ label: "embedded activeVersion", nodes: workflow.activeVersion.nodes }]
    : []),
];

const promptSource = workflowRepresentations.flatMap(({ label, nodes }) => productionPromptNodes.map((name) => {
  const node = nodes.find((entry) => entry.name === name);
  assert(node, `Missing production prompt node in ${label}: ${name}`);
  return node.parameters?.jsCode ?? "";
})).join("\n");

const forbiddenEvaluationLiterals = [
  "Unicorn_1.pdf", "Venus.pdf", "Starofit_2.pdf", "B+K_Tuev.pdf", "Silcotub_2.pdf",
  "Silcotub_1.pdf", "Lindemann.pdf", "JMD.pdf", "Dalmine_1.pdf",
  "608.63", "613.85", "279.26", "327.21", "301.87", "358.29",
  "284/317", "271/306",
  "F316/F316L - ASTM A 182M-24 / ASME SA-182M-23",
  "PO-26-RFS004402",
  "AD2000 W4+TEMPLATE BUHLMANN-007 REV.10",
];
for (const literal of forbiddenEvaluationLiterals) {
  assert(!promptSource.includes(literal), `Production prompt contains evaluation-derived literal: ${literal}`);
}
assert(!promptSource.includes("expectedAnswer"), "Production prompt code must not reference expectedAnswer");
assert(!promptSource.includes("When fetching a dataset row"), "Production prompt code must not access the evaluation trigger");
assert(!promptSource.includes("Evaluationsfall manuell laden"), "Production prompt code must not access the manual evaluation row");

for (const { label, nodes } of workflowRepresentations) {
  const evaluationPrepareNode = nodes.find((node) => node.name === "Evaluations-PDF vorbereiten");
  assert(evaluationPrepareNode, `Missing evaluation PDF preparation node in ${label}`);
  assert(
    !evaluationPrepareNode.parameters.jsCode.includes("expectedAnswer"),
    `Expected answers must be stripped before the extraction path in ${label}`,
  );
}

for (const forbiddenMutationMarker of [
  "appendPromptRule",
  "applyStructuredTensileValidatorCode",
  "stackedMechanicalRowsRule",
  "pairedMechanicalColumnsRule",
  "deterministicCorrectionCode",
]) {
  assert(!evaluationPreparation.includes(forbiddenMutationMarker), `Evaluation harness still mutates production behavior: ${forbiddenMutationMarker}`);
}

assert(!evaluator.includes("$('Evaluations-PDF vorbereiten')"), "Evaluator must not recover expectedAnswer from the extraction payload");
assert(evaluator.includes("$('When fetching a dataset row')"), "Evaluator must read the test-run row directly");
assert(evaluator.includes("$('Evaluationsfall manuell laden')"), "Evaluator must read the manual dataset row directly");
assert(!evaluator.includes("value.includes(actualNormalized)"), "Identifier matching must not accept a truncated actual value");
assert(!evaluator.includes("actualType === 'A' || expectedType === 'A'"), "Generic elongation A must not wildcard-match specific gauge types");

console.log("Evaluation isolation and leakage checks passed.");
