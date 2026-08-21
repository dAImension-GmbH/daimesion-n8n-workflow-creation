#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_BASE_URL = "http://localhost:5678";
const API_PREFIX = "/api/v1";

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});

async function main() {
  loadDotEnv(path.join(ROOT, ".env"));

  const [command, ...args] = process.argv.slice(2);

  switch (command) {
    case "check":
      await check();
      break;
    case "list":
      await list();
      break;
    case "validate":
      await validateCommand(args[0] ?? "workflows");
      break;
    case "deploy":
      await deploy(args);
      break;
    case "update":
      await update(args);
      break;
    case "sync":
      await sync(args);
      break;
    case "pull":
      await pull(args[0] ?? "workflows/exported");
      break;
    case "workflow":
      await printWorkflow(args[0]);
      break;
    case "pull-workflow":
      await pullWorkflow(args[0], args[1]);
      break;
    case "data-table-rows":
      await listDataTableRows(args[0], args[1], args.includes("--raw"));
      break;
    case "activate":
      await setActive(args[0], true);
      break;
    case "deactivate":
      await setActive(args[0], false);
      break;
    case "publish":
      await publishWorkflow(args[0]);
      break;
    case "executions":
      await listExecutions(args[0], args[1]);
      break;
    case "execution-summary":
      await executionSummary(args[0]);
      break;
    case "test-runs":
      await listTestRuns(args[0], args[1]);
      break;
    case "start-test-run":
      await startTestRun(args[0]);
      break;
    case "cancel-test-run":
      await cancelTestRun(args[0], args[1]);
      break;
    case "test-run-summary":
      await testRunSummary(args[0], args[1]);
      break;
    case "watch-test-run":
      await watchTestRun(args[0], args[1], args[2]);
      break;
    case "test-cases":
      await listTestCases(args[0], args[1], args[2], args.includes("--raw"));
      break;
    default:
      printUsage();
      process.exit(command ? 1 : 0);
  }
}

function loadDotEnv(filePath) {
  try {
    const text = readFileSync(filePath, "utf8");
    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const index = line.indexOf("=");
      if (index === -1) continue;

      const key = line.slice(0, index).trim();
      const value = line.slice(index + 1).trim().replace(/^['"]|['"]$/g, "");
      if (key && process.env[key] === undefined) {
        process.env[key] = value;
      }
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

function config() {
  const baseUrl = (process.env.N8N_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, "");
  const apiKey = process.env.N8N_API_KEY;

  if (!apiKey) {
    throw new Error("Missing N8N_API_KEY. Copy .env.example to .env and set your local API key.");
  }

  return { baseUrl, apiKey };
}

async function api(pathname, options = {}) {
  const { baseUrl, apiKey } = config();
  const response = await fetch(`${baseUrl}${API_PREFIX}${pathname}`, {
    ...options,
    headers: {
      "Accept": "application/json",
      "Content-Type": "application/json",
      "X-N8N-API-KEY": apiKey,
      ...options.headers,
    },
  });

  const text = await response.text();
  const body = text ? parseJson(text, text) : null;

  if (!response.ok) {
    const detail = typeof body === "string" ? body : JSON.stringify(body, null, 2);
    throw new Error(`n8n API ${response.status} ${response.statusText}: ${detail}`);
  }

  return body;
}

async function check() {
  const { baseUrl } = config();
  await api("/workflows?limit=1");
  console.log(`Connected to n8n at ${baseUrl}`);
}

async function list() {
  const workflows = await getAllWorkflows();

  if (workflows.length === 0) {
    console.log("No workflows found.");
    return;
  }

  for (const workflow of workflows) {
    const status = workflow.active ? "active" : "inactive";
    console.log(`${workflow.id}\t${status}\t${workflow.name}`);
  }
}

async function validateCommand(target) {
  const files = await workflowFiles(target);
  for (const file of files) {
    const workflow = await readWorkflow(file);
    validateWorkflow(workflow, file);
  }

  console.log(`Validated ${files.length} workflow file${files.length === 1 ? "" : "s"}.`);
}

async function deploy(args) {
  await pushWorkflows(args, {
    createMissing: true,
    writeBack: false,
  });
}

async function update(args) {
  await pushWorkflows(args, {
    createMissing: false,
    writeBack: false,
  });
}

async function sync(args) {
  await pushWorkflows(args, {
    createMissing: true,
    writeBack: true,
  });
}

async function pushWorkflows(args, options) {
  const activateAfterDeploy = args.includes("--activate");
  const publishAfterDeploy = args.includes("--publish");
  const target = args.find((arg) => !arg.startsWith("--")) ?? "workflows";
  const files = await workflowFiles(target);
  const existing = await getAllWorkflows();

  for (const file of files) {
    const workflow = await readWorkflow(file);
    validateWorkflow(workflow, file);

    const id = workflow.id ?? findExistingWorkflowId(existing, workflow.name);
    if (!id && !options.createMissing) {
      throw new Error(
        `${path.relative(ROOT, file)}: no existing workflow found for "${workflow.name}". Add an id or deploy it first.`,
      );
    }

    const payload = toApiPayload(workflow);
    const saved = id
      ? await api(`/workflows/${encodeURIComponent(id)}`, {
          method: "PUT",
          body: JSON.stringify(payload),
        })
      : await api("/workflows", {
          method: "POST",
          body: JSON.stringify(payload),
        });

    if (activateAfterDeploy) {
      await api(`/workflows/${encodeURIComponent(saved.id)}/activate`, { method: "POST" });
    }

    if (publishAfterDeploy) {
      await api(`/workflows/${encodeURIComponent(saved.id)}/publish`, { method: "POST" });
    }

    if (options.writeBack) {
      const fullWorkflow = await api(`/workflows/${encodeURIComponent(saved.id)}`);
      await writeFile(file, `${JSON.stringify(fullWorkflow, null, 2)}\n`);
      console.log(`${id ? "Updated" : "Created"} ${saved.id}\t${workflow.name}\t-> ${path.relative(ROOT, file)}`);
    } else {
      const action = id ? "Updated" : "Created";
      console.log(`${action} ${saved.id}\t${workflow.name}`);
    }
  }
}

async function pull(targetDir) {
  const outDir = path.resolve(ROOT, targetDir);
  await mkdir(outDir, { recursive: true });

  const workflows = await getAllWorkflows();
  for (const workflow of workflows) {
    const fullWorkflow = await api(`/workflows/${encodeURIComponent(workflow.id)}`);
    const fileName = `${slugify(fullWorkflow.name)}.${fullWorkflow.id}.json`;
    const filePath = path.join(outDir, fileName);
    await writeFile(filePath, `${JSON.stringify(fullWorkflow, null, 2)}\n`);
    console.log(`Wrote ${path.relative(ROOT, filePath)}`);
  }
}

async function printWorkflow(id) {
  if (!id) {
    throw new Error("Missing workflow id. Usage: node scripts/n8n.js workflow WORKFLOW_ID");
  }

  const workflow = await api(`/workflows/${encodeURIComponent(id)}`);
  console.log(JSON.stringify(workflow, null, 2));
}

async function pullWorkflow(id, targetFile) {
  if (!id) {
    throw new Error("Usage: node scripts/n8n.js pull-workflow WORKFLOW_ID [TARGET_FILE]");
  }

  const workflow = await api(`/workflows/${encodeURIComponent(id)}`);
  const resolved = path.resolve(
    ROOT,
    targetFile ?? path.join("workflows", `${slugify(workflow.name)}.json`),
  );
  await mkdir(path.dirname(resolved), { recursive: true });
  await writeFile(resolved, `${JSON.stringify(workflow, null, 2)}\n`);
  console.log(`Wrote ${path.relative(ROOT, resolved)}`);
}

async function listDataTableRows(tableId, rawLimit, printRaw = false) {
  if (!tableId) {
    throw new Error("Usage: node scripts/n8n.js data-table-rows TABLE_ID [LIMIT] [--raw]");
  }

  const limit = Math.min(100, Math.max(1, Number.parseInt(rawLimit ?? "100", 10) || 100));
  const page = await api(`/data-tables/${encodeURIComponent(tableId)}/rows?limit=${limit}`);
  if (printRaw) {
    console.log(JSON.stringify(page, null, 2));
    return;
  }

  const rows = (page.data ?? page ?? []).map((row) => Object.fromEntries(
    Object.entries(row)
      .filter(([key]) => key !== "pdfBase64")
      .map(([key, value]) => [
        key,
        typeof value === "string" && value.length > 500
          ? `${value.slice(0, 500)}… [${value.length} chars]`
          : value,
      ]),
  ));
  console.log(JSON.stringify({ data: rows, nextCursor: page.nextCursor ?? null }, null, 2));
}

async function setActive(id, active) {
  if (!id) {
    throw new Error(`Missing workflow id. Usage: node scripts/n8n.js ${active ? "activate" : "deactivate"} WORKFLOW_ID`);
  }

  await api(`/workflows/${encodeURIComponent(id)}/${active ? "activate" : "deactivate"}`, {
    method: "POST",
  });

  console.log(`${active ? "Activated" : "Deactivated"} ${id}`);
}

async function publishWorkflow(id) {
  if (!id) {
    throw new Error("Missing workflow id. Usage: node scripts/n8n.js publish WORKFLOW_ID");
  }

  await api(`/workflows/${encodeURIComponent(id)}/publish`, { method: "POST" });
  console.log(`Published ${id}`);
}

async function listExecutions(workflowId, rawLimit) {
  if (!workflowId) {
    throw new Error("Missing workflow id. Usage: node scripts/n8n.js executions WORKFLOW_ID [LIMIT]");
  }

  const limit = Math.min(100, Math.max(1, Number.parseInt(rawLimit ?? "10", 10) || 10));
  const query = new URLSearchParams({ workflowId, limit: String(limit) });
  const page = await api(`/executions?${query}`);
  for (const execution of page.data ?? []) {
    console.log([
      execution.id,
      execution.status,
      execution.mode,
      execution.startedAt ?? "-",
      execution.stoppedAt ?? "-",
    ].join("\t"));
  }
}

async function executionSummary(id) {
  if (!id) {
    throw new Error("Missing execution id. Usage: node scripts/n8n.js execution-summary EXECUTION_ID");
  }

  const execution = await api(`/executions/${encodeURIComponent(id)}?includeData=true`);
  const runData = execution.data?.resultData?.runData ?? {};
  const nodes = {};

  for (const [nodeName, runs] of Object.entries(runData)) {
    const latest = runs.at(-1) ?? {};
    const items = latest.data?.main?.flat() ?? [];
    nodes[nodeName] = {
      runs: runs.length,
      itemCount: items.length,
      jsonKeys: [...new Set(items.flatMap((item) => Object.keys(item?.json ?? {})))].sort(),
      binaryKeys: [...new Set(items.flatMap((item) => Object.keys(item?.binary ?? {})))].sort(),
      error: latest.error?.message ?? latest.error?.description ?? null,
    };
  }

  console.log(JSON.stringify({
    id: execution.id,
    workflowId: execution.workflowId,
    status: execution.status,
    mode: execution.mode,
    startedAt: execution.startedAt,
    stoppedAt: execution.stoppedAt,
    lastNodeExecuted: execution.data?.resultData?.lastNodeExecuted ?? null,
    executionError: execution.data?.resultData?.error?.message ?? null,
    nodes,
  }, null, 2));
}

async function listTestRuns(workflowId, rawLimit) {
  if (!workflowId) {
    throw new Error("Missing workflow id. Usage: node scripts/n8n.js test-runs WORKFLOW_ID [LIMIT]");
  }

  const limit = Math.min(100, Math.max(1, Number.parseInt(rawLimit ?? "20", 10) || 20));
  const query = new URLSearchParams({ limit: String(limit) });
  const page = await api(`/workflows/${encodeURIComponent(workflowId)}/test-runs?${query}`);
  const runs = page.data ?? [];
  if (runs.length === 0) {
    console.log("No Evaluation test runs found.");
    return;
  }
  for (const run of runs) {
    console.log([
      run.id,
      run.status,
      run.runAt ?? run.startedAt ?? run.createdAt ?? "-",
      run.completedAt ?? run.stoppedAt ?? "-",
    ].join("\t"));
  }
}

async function startTestRun(workflowId) {
  if (!workflowId) {
    throw new Error("Missing workflow id. Usage: node scripts/n8n.js start-test-run WORKFLOW_ID");
  }

  const run = await api(`/workflows/${encodeURIComponent(workflowId)}/test-runs`, {
    method: "POST",
  });
  console.log(JSON.stringify(run, null, 2));
}

async function cancelTestRun(workflowId, runId) {
  if (!workflowId || !runId) {
    throw new Error("Usage: node scripts/n8n.js cancel-test-run WORKFLOW_ID RUN_ID");
  }

  const run = await api(
    `/workflows/${encodeURIComponent(workflowId)}/test-runs/${encodeURIComponent(runId)}/cancel`,
    { method: "POST" },
  );
  console.log(JSON.stringify(run, null, 2));
}

async function testRunSummary(workflowId, runId) {
  if (!workflowId || !runId) {
    throw new Error("Usage: node scripts/n8n.js test-run-summary WORKFLOW_ID RUN_ID");
  }
  const result = await api(`/workflows/${encodeURIComponent(workflowId)}/test-runs/${encodeURIComponent(runId)}`);
  console.log(JSON.stringify(result, null, 2));
}

async function watchTestRun(workflowId, runId, rawIntervalSeconds) {
  if (!workflowId || !runId) {
    throw new Error("Usage: node scripts/n8n.js watch-test-run WORKFLOW_ID RUN_ID [INTERVAL_SECONDS]");
  }

  const intervalSeconds = Math.min(
    300,
    Math.max(5, Number.parseInt(rawIntervalSeconds ?? "30", 10) || 30),
  );
  const terminalStatuses = new Set(["completed", "error", "cancelled"]);
  let lastSignature = "";

  while (true) {
    const [run, casePage] = await Promise.all([
      api(`/workflows/${encodeURIComponent(workflowId)}/test-runs/${encodeURIComponent(runId)}`),
      api(`/workflows/${encodeURIComponent(workflowId)}/test-runs/${encodeURIComponent(runId)}/test-cases?limit=100`),
    ]);
    const testCases = casePage.data ?? [];
    const counts = Object.fromEntries(
      [...new Set(testCases.map((testCase) => testCase.status))]
        .sort()
        .map((status) => [status, testCases.filter((testCase) => testCase.status === status).length]),
    );
    const current = testCases.find((testCase) => testCase.status === "running");
    const signature = JSON.stringify({ status: run.status, counts, current: current?.inputs?.fileName ?? null });

    if (signature !== lastSignature || terminalStatuses.has(run.status)) {
      console.log(JSON.stringify({
        checkedAt: new Date().toISOString(),
        runId,
        status: run.status,
        counts,
        current: current ? {
          caseId: current.inputs?.caseId ?? null,
          fileName: current.inputs?.fileName ?? null,
        } : null,
        metrics: run.metrics ?? null,
        errorCode: run.errorCode ?? null,
        errorDetails: run.errorDetails ?? null,
      }));
      lastSignature = signature;
    }

    if (terminalStatuses.has(run.status)) return;
    await new Promise((resolve) => setTimeout(resolve, intervalSeconds * 1000));
  }
}

async function listTestCases(workflowId, runId, rawLimit, printRaw = false) {
  if (!workflowId || !runId) {
    throw new Error("Usage: node scripts/n8n.js test-cases WORKFLOW_ID RUN_ID [LIMIT]");
  }
  const limit = Math.min(100, Math.max(1, Number.parseInt(rawLimit ?? "100", 10) || 100));
  const query = new URLSearchParams({ limit: String(limit) });
  const result = await api(`/workflows/${encodeURIComponent(workflowId)}/test-runs/${encodeURIComponent(runId)}/test-cases?${query}`);
  if (printRaw) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  const cases = (result.data ?? result ?? []).map((testCase) => ({
    id: testCase.id,
    status: testCase.status,
    caseId: testCase.inputs?.caseId ?? null,
    fileName: testCase.inputs?.fileName ?? null,
    correlationKey: testCase.inputs?.correlationKey ?? null,
    runAt: testCase.runAt ?? null,
    completedAt: testCase.completedAt ?? null,
    metrics: testCase.metrics ?? null,
    errorCode: testCase.errorCode ?? null,
    errorDetails: testCase.errorDetails ?? null,
    executionId: testCase.executionId ?? null,
    outputKeys: Object.keys(testCase.outputs ?? {}),
  }));
  console.log(JSON.stringify({ data: cases, nextCursor: result.nextCursor ?? null }, null, 2));
}

async function getAllWorkflows() {
  const workflows = [];
  let cursor = undefined;

  do {
    const query = new URLSearchParams({ limit: "100" });
    if (cursor) query.set("cursor", cursor);

    const page = await api(`/workflows?${query}`);
    workflows.push(...(page.data ?? []));
    cursor = page.nextCursor;
  } while (cursor);

  return workflows;
}

async function workflowFiles(target) {
  const resolved = path.resolve(ROOT, target);
  const stat = await statSafe(resolved);

  if (!stat) {
    throw new Error(`Workflow path does not exist: ${target}`);
  }

  if (stat.isFile()) {
    if (!resolved.endsWith(".json")) {
      throw new Error(`Workflow file must be JSON: ${target}`);
    }
    return [resolved];
  }

  const entries = await readdir(resolved, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => path.join(resolved, entry.name))
    .sort();

  if (files.length === 0) {
    throw new Error(`No workflow JSON files found in ${target}`);
  }

  return files;
}

async function statSafe(filePath) {
  try {
    const fs = await import("node:fs/promises");
    return await fs.stat(filePath);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function readWorkflow(filePath) {
  const text = await readFile(filePath, "utf8");
  return parseJson(text, filePath);
}

function parseJson(text, source) {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`Invalid JSON in ${source}: ${error.message}`);
  }
}

function validateWorkflow(workflow, source) {
  if (!workflow || typeof workflow !== "object" || Array.isArray(workflow)) {
    throw new Error(`${source}: workflow must be a JSON object`);
  }
  if (!workflow.name || typeof workflow.name !== "string") {
    throw new Error(`${source}: workflow.name must be a string`);
  }
  if (!Array.isArray(workflow.nodes)) {
    throw new Error(`${source}: workflow.nodes must be an array`);
  }
  if (!workflow.connections || typeof workflow.connections !== "object" || Array.isArray(workflow.connections)) {
    throw new Error(`${source}: workflow.connections must be an object`);
  }
}

function findExistingWorkflowId(workflows, name) {
  const matches = workflows.filter((workflow) => workflow.name === name);
  if (matches.length > 1) {
    throw new Error(`Multiple existing workflows named "${name}". Add an id to the JSON file.`);
  }
  return matches[0]?.id;
}

function toApiPayload(workflow) {
  // Tags are read-only in newer n8n public API versions and must be managed
  // through the dedicated tags endpoints instead of workflow create/update.
  const allowed = ["name", "nodes", "connections", "settings", "staticData"];
  const payload = {};

  for (const key of allowed) {
    if (workflow[key] !== undefined) {
      payload[key] = workflow[key];
    }
  }

  payload.settings ??= {};
  payload.staticData ??= null;

  return payload;
}

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "workflow";
}

function printUsage() {
  console.log(`Usage:
  node scripts/n8n.js check
  node scripts/n8n.js list
  node scripts/n8n.js validate [file-or-dir]
  node scripts/n8n.js deploy [file-or-dir] [--activate] [--publish]
  node scripts/n8n.js update [file-or-dir] [--activate] [--publish]
  node scripts/n8n.js sync [file-or-dir] [--activate] [--publish]
  node scripts/n8n.js pull [output-dir]
  node scripts/n8n.js workflow WORKFLOW_ID
  node scripts/n8n.js pull-workflow WORKFLOW_ID [TARGET_FILE]
  node scripts/n8n.js data-table-rows TABLE_ID [LIMIT] [--raw]
  node scripts/n8n.js activate WORKFLOW_ID
  node scripts/n8n.js deactivate WORKFLOW_ID
  node scripts/n8n.js publish WORKFLOW_ID
  node scripts/n8n.js executions WORKFLOW_ID [LIMIT]
  node scripts/n8n.js execution-summary EXECUTION_ID
  node scripts/n8n.js test-runs WORKFLOW_ID [LIMIT]
  node scripts/n8n.js start-test-run WORKFLOW_ID
  node scripts/n8n.js cancel-test-run WORKFLOW_ID RUN_ID
  node scripts/n8n.js test-run-summary WORKFLOW_ID RUN_ID
  node scripts/n8n.js watch-test-run WORKFLOW_ID RUN_ID [INTERVAL_SECONDS]
  node scripts/n8n.js test-cases WORKFLOW_ID RUN_ID [LIMIT] [--raw]`);
}
