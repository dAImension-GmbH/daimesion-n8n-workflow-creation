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
   DAIMENSION_API_KEY=your-daimension-api-key
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

Deploy the Google News daily summary workflow:

```sh
node scripts/n8n.js deploy workflows/google-news-daily-summary.json
```

Deploy the Outlook certificate analysis workflow:

```sh
node scripts/n8n.js sync workflows/outlook-certificate-analysis.json
```

The certificate workflow analyzes each Outlook message independently. PDF
attachments are uploaded to dataset `4037` through
`https://pdf.daimension.ai/api/v1/documents/pdf`. A stable numeric case number
is derived from the mail correlation key. The workflow polls the asynchronous
MinerU job and retrieves its Markdown, plain text, and page results. As soon as
a certificate's PDF-to-text extraction succeeds, the extracted text passes
through evidence extraction, schema normalization, and final review with
`deepseek-v4-flash-3107` at dAImension.ai. At the end, the workflow creates a
review in the BUHLMANN Document Review Tool and uploads both the original PDF
and the complete normalized analysis. Reviewers can compare the source
document and extracted values side by side at `/document-review`, correct the
editable review payload, add comments, and approve the result. The original
extraction remains preserved as the immutable source payload. Every imported
row starts with `humanRequired=true`, so human confirmation is required;
materials and norms remain part of the fields being checked. Immediately after successful PDF
extraction, the certificate sender receives the detected text, Markdown, or
JSON in the reply body and as a complete attachment; the final structured JSON
is sent in a separate Outlook reply. There is no pairing with a counterpart
mail: separately arriving additional-order-data (Zusatzinfo) emails are stored
and confirmed to the sender, but they never delay or gate the certificate
analysis.

Before activation, configure the Microsoft Outlook OAuth2 credential on the
trigger and all reply nodes. Also verify the token stored in the n8n Bearer
credential `Daimension LLM Bearer Auth`. If its HTTP Request domains are
restricted, allow both hostnames `llm-inference.daimension.ai` and
`pdf.daimension.ai` without URL schemes or paths. Create a second n8n Bearer
Auth credential named `Buhlmann Document Review Bearer Auth`, store the DRT
service key with `document:read` and `document:write` scopes there, and allow the hostname
`buhlmann-document-review.daimension.ai`. The service key must never be stored
directly in workflow JSON.

The Google News workflow reads the German Google News RSS feed, keeps today's
items in the `Europe/Berlin` timezone, and sends a summary prompt to the
OpenAI-compatible Daimension endpoint
`https://llm-inference.daimension.ai/v1/chat/completions` with model `qwen3.6`.
The HTTP Request node uses the n8n Bearer Auth credential `Daimension LLM Bearer
Auth`; do not store the API token directly in workflow JSON.

Deploy and activate:

```sh
node scripts/n8n.js deploy workflows/hello-manual.json --activate
```

Update existing workflows in n8n without creating missing ones:

```sh
npm run update
```

Update a single existing workflow:

```sh
node scripts/n8n.js update workflows/hello-manual.json
```

Synchronize local workflows with n8n. This deploys local workflow JSON and writes the saved n8n workflow, including generated ids, back to the same local files:

```sh
npm run sync
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

`update` uses the same matching behavior, but it requires every local workflow to already exist in n8n. It fails instead of creating a new workflow.

`sync` also uses the same matching behavior as `deploy`, then fetches the saved workflow from n8n and writes it back to the source JSON file. Use this after creating workflows so local files keep the n8n-generated `id`.
