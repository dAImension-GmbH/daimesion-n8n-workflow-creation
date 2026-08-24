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

async function plan(messages, executionId = "queue-regression") {
  const input = { all: () => messages.map((json) => ({ json })) };
  const staticData = () => state;
  const execution = { id: executionId };
  const factory = new Function("$input", "$getWorkflowStaticData", "$execution", `return async function () {\n${planner}\n}`);
  return factory(input, staticData, execution)();
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
assert(!Object.hasOwn(dispatcher.settings ?? {}, "concurrency"), "Dispatcher must not use the unsupported workflow concurrency setting");
assert(planner.includes("DISPATCHER_LOCK_MS = 55 * 1000"), "Dispatcher must use a schedule-overlap lease");
const overlapping = await plan([message(70)], "overlapping-execution");
assert(overlapping.length === 0, "An overlapping dispatcher execution must not claim messages");
state.dispatcherLock.expiresAt = Date.now() - 1;
const afterLockExpiry = await plan([message(71)], "next-scheduled-execution");
assert(afterLockExpiry.some((item) => item.json.action === "claim"), "A later schedule must claim after the dispatcher lease expires");

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

const confirmationTargets = worker.connections["Bestätigung per Outlook"]?.main?.[0]?.map((entry) => entry.node) ?? [];
assert(confirmationTargets.includes("Outlook-Mail erfolgreich abschließen"), "Bestätigung per Outlook must mark its email complete");
const resultTargets = worker.connections["Ergebnis per Outlook senden"]?.main?.[0]?.map((entry) => entry.node) ?? [];
assert(resultTargets.includes("Ergebnisantwort merken"), "Result email must persist its idempotency marker");
const rememberedTargets = worker.connections["Ergebnisantwort merken"]?.main?.[0]?.map((entry) => entry.node) ?? [];
assert(rememberedTargets.includes("Outlook-Mail erfolgreich abschließen"), "Remembered result email must mark its Outlook message complete");
const reviewCreate = worker.nodes.find((node) => node.name === "Dokumentenreview anlegen");
assert(reviewCreate?.parameters?.jsonBody === "={{ $json.reviewCreateRequest }}", "Document review retries must use the stable mail-based clientRequestId");

const reviewPrepare = worker.nodes.find((node) => node.name === "Dokumentenreview-Upload vorbereiten");
assert(reviewPrepare?.parameters?.jsCode, "Document review upload preparation is missing");
const chemicalKeys = ["C", "SI", "S", "P", "SN", "MN", "CR", "NI", "MO", "TI", "CO", "CU", "N", "AL", "V", "NB", "B", "Zr", "W", "Sb", "As", "AL/N", "Nb+(V2,5)", "Nb+V+Ti", "Mn/C", "CEV", "V+NB", "Ni+Cu", "Cu+Ni+Cr+Mo+V", "Cr+Cu+Mo+Ni", "Cu+Mo"];
const reviewAnalysisKeys = [
  "heatNumber", "chemicals", "yieldStrength02", "yieldStrength10", "tensileStrength", "elongation",
  "certificateNumber", "quantity", "creditor", "product", "humanRequired", "customerOrderNumber",
  "orderLine", "dimensions", "werkstoff1", "werkstoff2", "werkstoff3", "werkstoff4", "werkstoff5",
  "norm1", "norm2", "norm3", "norm4", "norm5",
].sort();
const fixturePdf = Buffer.from("%PDF-document-review-contract-fixture");
const sharedOutlookPrefix = "AAMkAGY1MjQ0ZmM5LTVjZGYtNDE2ZS05MGU4LWQwYzQ5MzUyM2Y3ZABGAAAAAABUEV3A5KOGQrRpvxJuKU2_BwB-Nq-JOOcxR52dAYWe";

async function prepareReview(mailId, orderLine) {
  const resultRow = {
    heatNumber: "760491",
    chemicals: Object.fromEntries(chemicalKeys.map((key) => [key, key === "C" ? 0.18 : -1])),
    yieldStrength02: 334,
    yieldStrength10: -1,
    tensileStrength: 521,
    elongation: 27.5,
    certificateNumber: "02-26-15374",
    rawMaterialCertificate: "RAW-123",
    quantity: 207.67,
    creditor: "Silcotub S.A. Plant",
    product: "Seamless hot finished steel tubes for boilers",
    humanRequired: false,
    customerOrderNumber: "PO-26-RFS004402",
    ...(orderLine === undefined ? {} : { orderLine }),
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
  const inputItems = [
    { json: {}, binary: { data: { fileName: "Review fixture.pdf", mimeType: "application/pdf" } } },
    {
      json: {
        correlationKey: "PO-26-RFS004402",
        sourceMails: { certificate: { id: mailId, fileName: "Review fixture.pdf" } },
        results: [resultRow],
      },
    },
  ];
  const input = { all: () => inputItems };
  const helpers = {
    getBinaryDataBuffer: async (index, propertyName) => {
      assert(index === 0 && propertyName === "data", "Review preparation must read the original PDF binary");
      return fixturePdf;
    },
    prepareBinaryData: async (buffer, fileName, mimeType) => ({
      data: buffer.toString("base64"), fileName, mimeType,
    }),
  };
  const factory = new Function("$input", `return async function () {\n${reviewPrepare.parameters.jsCode}\n}`);
  return factory(input).call({ helpers });
}

const firstReview = (await prepareReview(`${sharedOutlookPrefix}-FIRST`))[0];
const firstReviewRepeat = (await prepareReview(`${sharedOutlookPrefix}-FIRST`))[0];
const secondReview = (await prepareReview(`${sharedOutlookPrefix}-SECOND`, "00020"))[0];
const firstRequest = firstReview.json.reviewCreateRequest;
const secondRequest = secondReview.json.reviewCreateRequest;
assert(firstRequest.fileName === "Review fixture.pdf", "Document review must preserve a safe PDF filename");
assert(firstRequest.sizeBytes === fixturePdf.length, "Document review must declare the exact PDF size");
assert(firstRequest.analysis[0].quantity === "207.67", "Document review quantity must be serialized as text");
assert(firstRequest.analysis[0].orderLine === "-1", "Missing document review orderLine must use the -1 sentinel");
assert(secondRequest.analysis[0].orderLine === "00020", "Document review must preserve an available orderLine");
assert(firstRequest.analysis[0].humanRequired === true, "Document review rows must require human confirmation");
assert(!Object.hasOwn(firstRequest.analysis[0], "rawMaterialCertificate"), "Unsupported rawMaterialCertificate must not be sent to Document Review");
assert(JSON.stringify(Object.keys(firstRequest.analysis[0]).sort()) === JSON.stringify(reviewAnalysisKeys), "Document review analysis must contain exactly the API contract fields");
assert(firstReview.json.results[0].quantity === 207.67, "Internal results must preserve numeric quantity");
assert(firstReview.json.results[0].rawMaterialCertificate === "RAW-123", "Internal results must preserve rawMaterialCertificate");
assert(firstRequest.clientRequestId === firstReviewRepeat.json.reviewCreateRequest.clientRequestId, "Document review idempotency key must be stable for the same mail");
assert(firstRequest.clientRequestId !== secondRequest.clientRequestId, "Document review idempotency keys must distinguish long Outlook IDs with a shared prefix");
assert(firstRequest.clientRequestId.startsWith("n8n-certificate-") && firstRequest.clientRequestId.length <= 120, "Document review idempotency key must satisfy the API length contract");

for (const retryNodeName of [
  "MinerU-Status prüfen",
  "PDF mit MinerU lesen",
  "Dokumentenreview anlegen",
  "Original-PDF in Review-Speicher hochladen",
  "Dokumentenreview-Upload abschließen",
  "MinerU-Ausgabe an Absender",
  "Ergebnis per Outlook senden",
]) {
  const node = worker.nodes.find((entry) => entry.name === retryNodeName);
  assert(node?.retryOnFail === true && node.maxTries === 3, `${retryNodeName} must retry three times`);
}

const pollingLimit = worker.nodes.find((node) => node.name === "MinerU-Polling begrenzen");
assert(pollingLimit?.parameters?.jsCode.includes("10 minutes"), "MinerU polling must have a ten-minute deadline");
assert(worker.connections["MinerU-Status prüfen"]?.main?.[0]?.some((entry) => entry.node === "MinerU-Polling begrenzen"), "MinerU status must pass through the polling deadline");

const notificationState = {};
async function runNotificationNode(name, item, outputs = {}) {
  const code = worker.nodes.find((node) => node.name === name)?.parameters?.jsCode;
  assert(code, `${name} is missing`);
  const input = { first: () => item, all: () => [item] };
  const selectNode = (nodeName) => ({ first: () => outputs[nodeName]?.[0] });
  const staticData = () => notificationState;
  const factory = new Function("$input", "$", "$getWorkflowStaticData", `return async function () {\n${code}\n}`);
  return factory(input, selectNode, staticData)();
}
const resultItem = { json: { replyMailId: "mail-idempotency", correlationKey: "PO-IDEMPOTENCY" } };
const firstGate = await runNotificationNode("Ergebnisantwortstatus prüfen", resultItem);
assert(firstGate[0].json.notificationAlreadySent === false, "First result notification must be sent");
await runNotificationNode("Ergebnisantwort merken", resultItem, { "Ergebnisantwortstatus prüfen": firstGate });
const secondGate = await runNotificationNode("Ergebnisantwortstatus prüfen", resultItem);
assert(secondGate[0].json.notificationAlreadySent === true, "A retried result notification must be suppressed");
const resultIf = worker.connections["Ergebnisantwort bereits gesendet?"]?.main ?? [];
assert(resultIf[0]?.some((entry) => entry.node === "Outlook-Mail erfolgreich abschließen"), "Suppressed duplicate result must still complete the Outlook mail");
assert(resultIf[1]?.some((entry) => entry.node === "Ergebnis per Outlook senden"), "First result must be sent through Outlook");

assert(worker.nodes.some((node) => node.name === "Evaluation deterministisch bewerten"), "Evaluations must use deterministic scoring");
assert(!worker.nodes.some((node) => node.name === "Mit DeepSeek bewerten"), "Extraction model must not judge its own evaluation output");

console.log("Outlook queue regression checks passed.");
