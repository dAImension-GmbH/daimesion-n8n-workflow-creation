# n8n workflow creation

This project contains a small local workflow-development loop for an n8n instance running at `http://localhost:5678`.

## Setup

1. Create local environment config:

   ```sh
   cp .env.example .env
   ```

2. Put your local n8n API key in `.env`:

   ```env
   N8N_BASE_URL=http://localhost:5678
   N8N_API_KEY=your-api-key
   ```

3. Confirm the local API is reachable:

   ```sh
   npm run check
   ```

No dependencies are required beyond Node.js 18 or newer.

## Workflow commands

Validate checked-in workflow JSON:

```sh
npm run validate
```

List workflows from the local n8n instance:

```sh
npm run list
```

Deploy all workflows under `workflows/`:

```sh
npm run deploy
```

Deploy a single workflow:

```sh
node scripts/n8n.js deploy workflows/hello-manual.json
```

Deploy and activate:

```sh
node scripts/n8n.js deploy workflows/hello-manual.json --activate
```

Pull all workflows from n8n into `workflows/exported/`:

```sh
npm run pull
```

Activate or deactivate a workflow by id:

```sh
node scripts/n8n.js activate WORKFLOW_ID
node scripts/n8n.js deactivate WORKFLOW_ID
```

## File layout

- `workflows/` contains source workflow JSON files.
- `workflows/exported/` is ignored and used for pulled copies from the local n8n instance.
- `scripts/n8n.js` is the local CLI wrapper around the n8n public API.
- `.env` is ignored so local API keys are not committed.

## Deploy behavior

`deploy` validates JSON files before sending them to n8n. If a workflow file contains an `id`, it updates that workflow. If no `id` exists, the script looks for exactly one workflow with the same name and updates it; otherwise it creates a new workflow.

