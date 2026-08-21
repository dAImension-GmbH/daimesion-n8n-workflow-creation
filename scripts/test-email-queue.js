#!/usr/bin/env node

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dispatcher = JSON.parse(readFileSync(path.join(ROOT, "workflows/outlook-certificate-dispatcher.json"), "utf8"));
const worker = JSON.parse(readFileSync(path.join(ROOT, "workflows/outlook-certificate-analysis.json"), "utf8"));
const planner = dispatcher.nodes.find((node) => node.name === "Queue planen")?.parameters?.jsCode;

if (!planner) throw new Error("Queue planner Code node is missing");
new Function(`return async function () {\n${planner}\n}`);
if (!planner.includes("const LEASE_MS = 15 * 60 * 1000;")) throw new Error("Queue processing lease must be 15 minutes");

const now = Date.now();
const state = { initialUnreadCutoff: new Date(now - 24 * 60 * 60 * 1000).toISOString() };
const message = (index, overrides = {}) => ({
  id: `mail-${index}`,
  subject: `Certificate ${index}`,
  from: { emailAddress: { address: "supplier@example.com" } },
  receivedDateTime: new Date(now - index * 60_000).toISOString(),
  lastModifiedDateTime: new Date(now - index * 60_000).toISOString(),
  categories: [],
  isRead: false,
  ...overrides,
});

async function plan(messages) {
  const input = { all: () => messages.map((json) => ({ json })) };
  const staticData = () => state;
  const factory = new Function("$input", "$getWorkflowStaticData", `return async function () {\n${planner}\n}`);
  return factory(input, staticData)();
}

function assert(condition, messageText) {
  if (!condition) throw new Error(messageText);
}

const burst = await plan(Array.from({ length: 8 }, (_, index) => message(index + 1)));
assert(burst.filter((item) => item.json.action === "claim").length === 5, "Eight new emails must claim exactly five slots");

const active = Array.from({ length: 5 }, (_, index) => message(index + 1, {
  categories: ["DAIMENSION-PROCESSING", "DAIMENSION-ATTEMPT-1"],
  lastModifiedDateTime: new Date(now).toISOString(),
}));
const blocked = await plan(active.concat(Array.from({ length: 3 }, (_, index) => message(index + 10))));
assert(blocked.filter((item) => item.json.action === "claim").length === 0, "Five active workers must block further claims");

const recentLeases = active.map((mail) => ({
  ...mail,
  lastModifiedDateTime: new Date(now - 14 * 60 * 1000).toISOString(),
}));
const stillBlocked = await plan(recentLeases.concat(message(19)));
assert(stillBlocked.filter((item) => item.json.action === "claim").length === 0, "A 14-minute-old heartbeat must still hold its slot");

const partlyActive = active.slice(0, 3).concat(Array.from({ length: 5 }, (_, index) => message(index + 20)));
const refill = await plan(partlyActive);
assert(refill.filter((item) => item.json.action === "claim").length === 2, "Three active workers must leave exactly two free slots");

const staleThirdAttempt = message(40, {
  categories: ["DAIMENSION-PROCESSING", "DAIMENSION-ATTEMPT-3"],
  lastModifiedDateTime: new Date(now - 16 * 60 * 1000).toISOString(),
});
const failed = await plan([staleThirdAttempt]);
assert(failed.some((item) => item.json.action === "fail" && item.json.targetCategories.includes("DAIMENSION-FAILED")), "A stale third attempt must be marked failed");

const oldMail = message(50, { receivedDateTime: new Date(now - 25 * 60 * 60 * 1000).toISOString() });
const ownMail = message(51, { from: { emailAddress: { address: "certificates@daimension.de" } } });
const excluded = await plan([oldMail, ownMail]);
assert(excluded.length === 0, "Old backlog and self-sent messages must not be claimed");

const workerTrigger = worker.nodes.find((node) => node.name === "Einzelmail aus Dispatcher");
assert(workerTrigger?.type === "n8n-nodes-base.executeWorkflowTrigger", "Worker must start through an Execute Sub-workflow Trigger");
const caller = dispatcher.nodes.find((node) => node.name === "Ein Worker pro E-Mail");
assert(caller?.parameters?.mode === "each", "Dispatcher must execute the worker once per email");
assert(caller?.parameters?.options?.waitForSubWorkflow === false, "Dispatcher must start workers asynchronously");

const evidenceLoop = worker.nodes.find((node) => node.name === "DeepSeek-Belegblöcke nacheinander");
assert(evidenceLoop?.type === "n8n-nodes-base.splitInBatches", "Evidence extraction must use an explicit item loop");
assert(evidenceLoop?.parameters?.batchSize === 1, "Evidence extraction must process exactly one block at a time");
const loopOutputs = worker.connections[evidenceLoop.name]?.main ?? [];
assert(loopOutputs[0]?.some((entry) => entry.node === "Belege sammeln und Normalisierung bauen"), "Completed evidence loop must continue to normalization");
assert(loopOutputs[1]?.some((entry) => entry.node === "Belege mit DeepSeek extrahieren"), "Loop output must call DeepSeek for one evidence block");
assert(worker.connections["Belege mit DeepSeek extrahieren"]?.main?.[0]?.some((entry) => entry.node === "DeepSeek zwischen Blöcken entlasten"), "Evidence requests must be spaced between blocks");
assert(worker.connections["DeepSeek zwischen Blöcken entlasten"]?.main?.[0]?.some((entry) => entry.node === evidenceLoop.name), "Evidence block path must return to the loop");
assert(worker.connections["DeepSeek zwischen Blöcken entlasten"]?.main?.[0]?.some((entry) => entry.node === "Bearbeitungslease erneuern"), "Long evidence extraction must renew the processing lease");

for (const deepSeekNodeName of [
  "Mail mit DeepSeek einordnen",
  "Belege mit DeepSeek extrahieren",
  "Mit DeepSeek normalisieren",
  "Mit DeepSeek prüfen",
]) {
  const deepSeekNode = worker.nodes.find((node) => node.name === deepSeekNodeName);
  assert(deepSeekNode?.retryOnFail === true, `${deepSeekNodeName} must retry transient failures`);
  assert(deepSeekNode?.maxTries === 3, `${deepSeekNodeName} must try at most three times`);
  assert(deepSeekNode?.waitBetweenTries >= 20_000, `${deepSeekNodeName} must delay retries`);
}

for (const terminal of ["Bestätigung per Outlook", "Ergebnis per Outlook senden"]) {
  const targets = worker.connections[terminal]?.main?.[0]?.map((entry) => entry.node) ?? [];
  assert(targets.includes("Outlook-Mail erfolgreich abschließen"), `${terminal} must mark its email complete`);
}
const reviewCreate = worker.nodes.find((node) => node.name === "Dokumentenreview anlegen");
assert(reviewCreate?.parameters?.jsonBody === "={{ $json.reviewCreateRequest }}", "Document review retries must use the stable mail-based clientRequestId");

console.log("Outlook queue regression checks passed.");
