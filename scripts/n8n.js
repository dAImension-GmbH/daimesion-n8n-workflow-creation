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
    case "pull":
      await pull(args[0] ?? "workflows/exported");
      break;
    case "activate":
      await setActive(args[0], true);
      break;
    case "deactivate":
      await setActive(args[0], false);
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
  const activateAfterDeploy = args.includes("--activate");
  const target = args.find((arg) => !arg.startsWith("--")) ?? "workflows";
  const files = await workflowFiles(target);
  const existing = await getAllWorkflows();

  for (const file of files) {
    const workflow = await readWorkflow(file);
    validateWorkflow(workflow, file);

    const id = workflow.id ?? findExistingWorkflowId(existing, workflow.name);
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

    console.log(`${id ? "Updated" : "Created"} ${saved.id}\t${workflow.name}`);
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

async function setActive(id, active) {
  if (!id) {
    throw new Error(`Missing workflow id. Usage: node scripts/n8n.js ${active ? "activate" : "deactivate"} WORKFLOW_ID`);
  }

  await api(`/workflows/${encodeURIComponent(id)}/${active ? "activate" : "deactivate"}`, {
    method: "POST",
  });

  console.log(`${active ? "Activated" : "Deactivated"} ${id}`);
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
    throw new Error(`Multiple existing workflows named "${name}". Add an id to the JSON file before deploying.`);
  }
  return matches[0]?.id;
}

function toApiPayload(workflow) {
  const allowed = ["name", "nodes", "connections", "settings", "staticData", "tags"];
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
  node scripts/n8n.js deploy [file-or-dir] [--activate]
  node scripts/n8n.js pull [output-dir]
  node scripts/n8n.js activate WORKFLOW_ID
  node scripts/n8n.js deactivate WORKFLOW_ID`);
}
