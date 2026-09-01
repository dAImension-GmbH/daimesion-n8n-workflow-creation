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

The certificate automation is split into a one-minute Outlook dispatcher and a
single-message worker. The dispatcher treats unread messages as its queue,
claims at most five messages with the `DAIMENSION-PROCESSING` Outlook category,
and starts one asynchronous worker execution for each claimed message. Overflow
stays unread until a slot becomes free. A worker renews its lease during long
MinerU and GLM 5.3 Flash stages. A 55-second dispatcher lease prevents overlapping
schedule ticks from claiming the same unread message.
A message without a heartbeat for 15 minutes is
retried up to three times; after the third stale attempt it remains unread with the
`DAIMENSION-FAILED` category. On first activation, the dispatcher includes the
unread backlog from the preceding 24 hours. Successful messages are marked read
and have the queue categories removed. MinerU polling stops after ten minutes;
transient MinerU, document-review, and Outlook operations retry three times.
Successful intermediate and final sender notifications are recorded for 30 days
so a later worker retry does not send the same response twice.

The certificate worker analyzes each Outlook message independently. PDF
attachments are uploaded to dataset `4037` through
`https://pdf.daimension.ai/api/v1/documents/pdf`. A stable numeric case number
is derived from the mail correlation key. Before upload, the workflow rewrites
object-stream PDFs and repairs classic XRef tables whose in-use entries point
to missing or incorrect object offsets; valid classic PDFs remain unchanged.
The workflow polls the asynchronous
MinerU job and retrieves its Markdown, plain text, and page results. As soon as
a certificate's PDF-to-text extraction succeeds, the extracted text passes
through evidence extraction, schema normalization, and final review with
`glm-5.3-flash` at dAImension.ai. Evidence blocks are processed one at
a time with a short pause, and transient GLM 5.3 Flash failures are retried up to
three times with a delay. GLM thinking uses the `high` reasoning level plus an
explicit bounded-reasoning instruction; classification uses an 8K output budget,
evidence extraction 16K, and normalization plus final review 32K so the
structured JSON still fits after reasoning without exceeding the synchronous
proxy window. At the end, the workflow creates a
review in the BUHLMANN Document Review Tool and uploads both the original PDF
in sequential 256 KiB multipart chunks, plus the complete normalized analysis.
The chunk fields and upload order match the Document Review app's upload
contract, avoiding the proxy's single-request body limit. Reviewers can compare the source
document and extracted values side by side at `/document-review`, correct the
editable review payload, add comments, and approve the result. The original
extraction remains preserved as the immutable source payload. Every imported
row starts with `humanRequired=true`, so human confirmation is required;
materials and norms remain part of the fields being checked. Tensile tests use
the Document Review schema-v2 structure: up to twelve tests stay in document
order, with sample number, temperature, typed yield strengths, tensile strength,
all elongation definitions, and specimen metadata coupled per specimen. Values
from different specimens are never collapsed into field-wise minima. Immediately after successful PDF
extraction, the certificate sender receives the detected text, Markdown, or
JSON in the reply body and as a complete attachment; the final structured JSON
is sent in a separate Outlook reply. There is no pairing with a counterpart
mail: separately arriving additional-order-data (Zusatzinfo) emails are stored
and confirmed to the sender, but they never delay or gate the certificate
analysis. Composite certificates are resolved position by position: values from
the issuing cover certificate are combined with heat-specific chemistry and
mechanics from attached raw-material certificates. A heat number may therefore
appear in multiple result rows when it belongs to multiple pipe positions. Each
composite row also retains the linked source certificate number in
`rawMaterialCertificate`.

Run the local certificate regression against a source PDF without uploading it
to an external service:

```sh
npm run test:certificate -- "/absolute/path/to/certificate.pdf"
```

Validate the dispatcher burst, queue, retry, and worker hand-off behavior
without connecting to Outlook:

```sh
npm run test:email-queue
```

Run the deterministic schema and scoring checks for all nine evaluation PDFs:

```sh
npm run test:certificate-suite
```

Run all portable local checks together:

```sh
npm test
```

These checks validate source markers, normalization, graph behavior, and scoring.
They do not replace a live MinerU/GLM 5.3 Flash evaluation run; the two image-only
certificates are exercised end to end only when n8n and its credentials are
available.

## Certificate evaluations

The worker contains a configured n8n Evaluation Trigger named
`When fetching a dataset row`. It reads every row from the
`Certificate OCR and Extraction Evaluation` Data Table and passes the PDF to
`Evaluations-PDF vorbereiten`. The PDF then joins the production path directly
before `PDF-Upload vorbereiten`, so evaluations use the same
`pdf.daimension.ai` MinerU/OCR endpoint and the same dAImension LLM extraction
as real email certificates.

After extraction, `Evaluation deterministisch bewerten` compares only the facts
in `expectedAnswer` with the actual structured result. Numeric values use a
small explicit tolerance. Structured tensile tests are compared in document
order and per specimen, including typed yield-strength and elongation
measurements, so numerically correct but incorrectly paired values fail the
evaluation. Multi-position rows are matched by heat and dimensions. Every
evaluation position also contains the
expected heat-analysis chemistry. Chemical measurements are compared element
by element with a strict numeric tolerance and must remain assigned to the
correct heat. Missing, incorrectly scaled, or wrong-heat chemical values set
`chemistryPassed=0` and always invalidate the complete evaluation run.
`Evaluation – Ergebnis speichern` writes `actualAnswer`, `judgeScore`,
`judgeReasoning`, `chemistryScore`, `chemistryReasoning`, `chemistryPassed`, and
`tensileScore`, `tensileReasoning`, `tensilePassed`, and `passed` back to the
dataset. `Evaluation – Metriken setzen` records `correctness`, `Chemistry score`,
`Chemistry pass rate`, `Tensile-test score`, `Tensile-test pass rate`, and `Pass rate` in
n8n's Evaluations tab. The extraction model does not grade its own answer.
Evaluation executions
do not create document reviews or send/update Outlook messages.

For a manual canvas test, execute from `Evaluations-Eingang (manuell)`. The
intermediate `Evaluationsfall manuell laden` node loads the oldest dataset row;
executing the preparation Code node without either that loader or an Evaluation
test run has no dataset input and is intentionally rejected.
Manual evaluation-path runs terminate at `Evaluations-Ergebnis (manuell)` and
do not create a document review or send/update Outlook messages. Set Outputs
is skipped during a manual execution because only a real Evaluation Trigger run
has a dataset row identity to update.

Provision or refresh the nine PDF rows, inject the actual Data Table ID into the
workflow, and then prepare the evaluation nodes:

```sh
npm run setup:evaluations
npm run prepare:evaluations
```

To update corrected expected answers without reading or uploading the PDFs again:

```sh
npm run setup:evaluations -- --expected-only
```

Setup upserts every case by `caseId`, so changed PDFs and expected answers replace
stale table data. For offline preparation, set
`CERTIFICATE_EVALUATION_TABLE_ID` explicitly.

The workflow is fully configured after these commands. Start the nine-case run
from the Evaluations tab or through the repository helper:

```sh
node scripts/n8n.js start-test-run oLtOyTcKU11RrNJC
node scripts/n8n.js test-runs oLtOyTcKU11RrNJC
```

To prepare a temporary single-case trigger for debugging or retrying one row,
set `EVALUATION_CASE_ID` while preparing and publish that draft. Run
`npm run prepare:evaluations` again without the variable afterward to restore
the normal all-row trigger.

```sh
EVALUATION_CASE_ID=silcotub-02-25-25339 npm run prepare:evaluations
```

Set `CERTIFICATE_PDF_DIR` if the nine source PDFs are not in
`/Users/mdklause/Downloads`. Re-running setup updates rows by `caseId` and does
not duplicate them.

The regression checks the source values, compiles every n8n Code node, executes
the evidence-block and critical-source selection, repairs common malformed LLM
JSON responses, and verifies position-preserving chemical and dimension
normalization. The nine-case suite additionally rejects missing chemical
elements, decimal-scale errors, chemistry assigned to the wrong heat, missing
tensile tests, and tensile measurements assigned to the wrong specimen.

Before activation, configure the Microsoft Outlook OAuth2 credential on the
dispatcher and all worker reply/update nodes. The credential needs
`Mail.ReadWrite` and `Mail.Send` so the automation can claim messages with
categories and mark only successfully processed messages as read. Also verify
the token stored in the n8n Bearer
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
`https://llm-inference.daimension.ai/v1/chat/completions` with model `qwen3.8`.
The HTTP Request node uses the n8n Bearer Auth credential `Daimension LLM Bearer
Auth`; do not store the API token directly in workflow JSON.

Deploy and activate:

```sh
node scripts/n8n.js deploy workflows/hello-manual.json --activate
```

For the Outlook automation, deploy the worker first, then deploy and activate
the dispatcher. The worker keeps its existing workflow id and is called by the
dispatcher; it no longer polls Outlook directly.

```sh
node scripts/n8n.js update workflows/outlook-certificate-analysis.json --activate --publish
node scripts/n8n.js deploy workflows/outlook-certificate-dispatcher.json --activate --publish
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

Add `--publish` when the synchronized draft must immediately become the
published production version:

```sh
node scripts/n8n.js sync workflows/outlook-certificate-analysis.json --publish
```

Inspect or back up one workflow without overwriting others:

```sh
node scripts/n8n.js workflow WORKFLOW_ID
node scripts/n8n.js pull-workflow WORKFLOW_ID workflows/workflow-name.json
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
