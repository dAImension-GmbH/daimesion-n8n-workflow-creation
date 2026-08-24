#!/usr/bin/env node

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workflow = JSON.parse(readFileSync(path.join(ROOT, "workflows/outlook-certificate-analysis.json"), "utf8"));
const code = workflow.nodes.find((node) => node.name === "Ergebnis validieren und Dokumentenreview vorbereiten")?.parameters?.jsCode;
if (!code) throw new Error("Final certificate validation node is missing.");

const baseRow = {
  heatNumber: "TEST",
  chemicals: {},
  yieldStrength02: -1,
  yieldStrength10: -1,
  tensileStrength: -1,
  elongation: -1,
  certificateNumber: "CERT",
  rawMaterialCertificate: "-1",
  quantity: 1,
  creditor: "Manufacturer",
  product: "Product",
  humanRequired: false,
  customerOrderNumber: "PO",
  dimensions: "100 x 10 mm",
  werkstoff1: "1.0000",
  werkstoff2: "-1",
  werkstoff3: "-1",
  werkstoff4: "-1",
  werkstoff5: "-1",
  norm1: "-1",
  norm2: "-1",
  norm3: "-1",
  norm4: "-1",
  norm5: "-1",
};

async function validate(row, { poNumber = row.customerOrderNumber, evidence = { chunks: [] }, criticalSource = "" } = {}) {
  const context = {
    correlationKey: poNumber,
    replyMailId: "reducer-test",
    orderData: { poNumber },
    evidence,
    criticalSource,
    pair: {
      certificate: {
        mineruEndpoint: "test",
        mineruModel: "test",
        mailId: "reducer-test",
        subject: "Reducer test",
        fileName: "test.pdf",
      },
      additionalInfo: null,
    },
  };
  const nodes = {
    "Qualitätsprüfung vorbereiten": [{ json: context }],
  };
  const selectNode = (name) => ({
    first: () => {
      const item = nodes[name]?.[0];
      if (!item) throw new Error(`Node ${name} did not execute.`);
      return item;
    },
  });
  const input = {
    first: () => ({ json: { choices: [{ message: { content: JSON.stringify({ results: [row] }) } }] } }),
  };
  const factory = new Function("$input", "$", `return async function () {\n${code}\n}`);
  return (await factory(input, selectNode)())[0].json.results[0];
}

function assertEqual(label, actual, expected) {
  if (actual !== expected) throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

const bk = await validate({
  ...baseRow,
  heatNumber: "245086",
  certificateNumber: "146907582-02",
  customerOrderNumber: "PO-23-0013327",
  quantity: 47,
  product: "Seamless Pipe",
  yieldStrength02: 284,
  yieldStrength10: 271,
  tensileStrength: 547,
  elongation: 52.5,
  mechanicalSelection: {
    selectedComparableGroupId: "BK-MAIN",
    gaugeLengthType: "A5",
    tests: [
      { comparableGroupId: "BK-MAIN", specimenId: "1", gaugeLengthType: "A5", columnHeaders: "Rp0.2 Rp1.0 Rm A5", yieldStrength02: 284, yieldStrength10: 317, yieldStrength10Explicit: true, tensileStrength: 547, elongation: 52.5 },
      { comparableGroupId: "BK-MAIN", specimenId: "2", gaugeLengthType: "A5", columnHeaders: "Rp0.2 Rp1.0 Rm A5", yieldStrength02: 271, yieldStrength10: 306, yieldStrength10Explicit: true, tensileStrength: 547, elongation: 52.5 },
    ],
  },
}, {
  poNumber: "PO-25-0012289",
  evidence: {
    chunks: [
      {
        sourceBlock: { index: 1 },
        certificate: {
          documentRole: { value: "DECK" },
          deckIndicators: { customerOrder: true, finishedProduct: true, finishedQuantity: true, finishedDimensions: true },
          certificateNumber: { value: "W089986" },
          customerOrderNumber: { value: "PO-25-0012289" },
          manufacturer: { value: "B+K" },
          product: { value: "T-STÜCK" },
          dimensions: { value: "-1" },
          materials: [{ value: "1.4541" }],
        },
        heats: [{ heatNumber: { value: "245086" }, quantity: { value: 12, unit: "pcs" }, tensileTests: [
          { comparableGroupId: "1", gaugeLengthType: "A5", temperatureC: 23, yieldStrength02: 284, yieldStrength10: 271, yieldStrength10Explicit: true, tensileStrength: 547, elongation: 52.5, sourceQuote: "47257 U; T; RT; 284/317271/306; 547,00547,00; 52,552,5" },
          { comparableGroupId: "1", gaugeLengthType: "A5", temperatureC: 23, yieldStrength02: 317, yieldStrength10: 306, yieldStrength10Explicit: true, tensileStrength: 547, elongation: 52.5, sourceQuote: "47257 U; T; RT; 284/317271/306; 547,00547,00; 52,552,5" },
        ] }],
      },
      {
        sourceBlock: { index: 2 },
        certificate: {
          documentRole: { value: "RAW_MATERIAL" },
          certificateNumber: { value: "146907582-02" },
          customerOrderNumber: { value: "PO-23-0013327" },
          product: { value: "Seamless Pipe" },
        },
        heats: [{ heatNumber: { value: "245086" }, quantity: { value: 47, unit: "pcs" }, tensileTests: [
          { comparableGroupId: "deck-1", gaugeLengthType: "A5", temperatureC: 23, yieldStrength02: 284, yieldStrength10: 317, yieldStrength10Explicit: true, tensileStrength: 547, elongation: 52.5, sourceQuote: "Rp 0.2/1.0: 284/317" },
          { comparableGroupId: "deck-1", gaugeLengthType: "A5", temperatureC: 23, yieldStrength02: 271, yieldStrength10: 306, yieldStrength10Explicit: true, tensileStrength: 547, elongation: 52.5, sourceQuote: "Rp 0.2/1.0: 271/306" },
        ] }],
      },
    ],
  },
});
for (const [field, expected] of Object.entries({
  certificateNumber: "W089986",
  customerOrderNumber: "PO-25-0012289",
  quantity: 12,
  product: "T-STÜCK",
  yieldStrength02: 271,
  yieldStrength10: 306,
  tensileStrength: 547,
  elongation: 52.5,
})) assertEqual(`B+K ${field}`, bk[field], expected);

const silcotub = await validate({
  ...baseRow,
  heatNumber: "938166",
  yieldStrength02: 512,
  tensileStrength: 679,
  elongation: 37.5,
  mechanicalSelection: {
    selectedComparableGroupId: "",
    gaugeLengthType: "5D",
    tests: [
      { comparableGroupId: "UPPER-2IN", specimenId: "Q5115", gaugeLengthType: "2IN", isPrimaryAcceptanceBlock: true, yieldStrength02: 512, tensileStrength: 679, elongation: 37.5 },
      { comparableGroupId: "UPPER-2IN", specimenId: "Q5116", gaugeLengthType: "2IN", isPrimaryAcceptanceBlock: true, yieldStrength02: 511, tensileStrength: 683, elongation: 40 },
      { comparableGroupId: "LOWER-5D", specimenId: "Q5113", gaugeLengthType: "5D", isPrimaryAcceptanceBlock: false, yieldStrength02: 512, tensileStrength: 679, elongation: 26 },
      { comparableGroupId: "LOWER-5D", specimenId: "Q5114", gaugeLengthType: "5D", isPrimaryAcceptanceBlock: false, yieldStrength02: 509, tensileStrength: 679, elongation: 28 },
    ],
  },
});
assertEqual("Silcotub yieldStrength02", silcotub.yieldStrength02, 509);
assertEqual("Silcotub tensileStrength", silcotub.tensileStrength, 679);
assertEqual("Silcotub elongation", silcotub.elongation, 26);

const dalmine = await validate({
  ...baseRow,
  heatNumber: "956643",
  yieldStrength02: 367,
  tensileStrength: 499,
  elongation: 25.5,
  mechanicalSelection: {
    selectedComparableGroupId: "DALMINE-5D",
    gaugeLengthType: "5D",
    tests: [
      { comparableGroupId: "DALMINE-5D", specimenId: "N7438/C", gaugeLengthType: "5D", temperatureC: 20, yieldStrength02: 367, tensileStrength: 499, elongation: 25.5 },
      { comparableGroupId: "DALMINE-5D", specimenId: "N7439", gaugeLengthType: "5D", temperatureC: 20, yieldStrength02: 364, tensileStrength: 498, elongation: 27 },
      { comparableGroupId: "DALMINE-5D", specimenId: "N7440/C", gaugeLengthType: "5D", temperatureC: 20, yieldStrength02: 369, tensileStrength: 507, elongation: 23.5 },
    ],
  },
});
assertEqual("Dalmine yieldStrength02", dalmine.yieldStrength02, 364);
assertEqual("Dalmine tensileStrength", dalmine.tensileStrength, 498);
assertEqual("Dalmine elongation", dalmine.elongation, 23.5);

const invalidOffset = await validate({ ...baseRow, yieldStrength02: 300, yieldStrength10: 250 });
assertEqual("invalid Rp1.0 reset", invalidOffset.yieldStrength10, -1);
assertEqual("invalid Rp1.0 review", invalidOffset.humanRequired, true);

const missingMechanicalCell = await validate({
  ...baseRow,
  yieldStrength02: 306,
  tensileStrength: 447,
  elongation: 35,
  mechanicalSelection: {
    tests: [{ comparableGroupId: "STAROFIT", gaugeLengthType: "A5", yieldStrength02: null, tensileStrength: 447, elongation: 35 }],
  },
});
assertEqual("empty mechanical cell does not become zero", missingMechanicalCell.yieldStrength02, 306);

const evidencePreferred = await validate({
  ...baseRow,
  heatNumber: "57495K",
  yieldStrength02: 368,
  tensileStrength: 464,
  elongation: 27.4,
  mechanicalSelection: {
    selectedComparableGroupId: "WRONG",
    tests: [{ comparableGroupId: "WRONG", gaugeLengthType: "5D", temperatureC: 20, yieldStrength02: 368, tensileStrength: 464, elongation: 27.4 }],
  },
}, {
  evidence: {
    chunks: [{
      sourceBlock: { index: 1 },
      heats: [{
        heatNumber: { value: "57495K" },
        tensileTests: [{ comparableGroupId: "PRIMARY", gaugeLengthType: "5D", temperatureC: 20, yieldStrength02: 303, tensileStrength: 425, elongation: 35.4 }],
      }],
    }],
  },
});
assertEqual("evidence-preferred yieldStrength02", evidencePreferred.yieldStrength02, 303);
assertEqual("evidence-preferred tensileStrength", evidencePreferred.tensileStrength, 425);
assertEqual("evidence-preferred elongation", evidencePreferred.elongation, 35.4);

const acceptanceRowPreferred = await validate({ ...baseRow, heatNumber: "901972", yieldStrength02: 255, yieldStrength10: 290, tensileStrength: 569, elongation: 50.4 }, {
  evidence: {
    chunks: [{
      heats: [{
        heatNumber: { value: "901972" },
        tensileTests: [
          { comparableGroupId: "SAME", testBlockId: "SAME", gaugeLengthType: "5D", temperatureC: 20, isPrimaryAcceptanceBlock: true, yieldStrength02: 259, yieldStrength10: 293, yieldStrength10Explicit: true, tensileStrength: 573, elongation: 50.1, sourceQuote: "Ts(500/700MPA):573; Rp0.2 >=190MPA:259; 1% >=225MPA:293; 5d >=40%:50.1" },
          { comparableGroupId: "SAME", testBlockId: "SAME", gaugeLengthType: "5D", temperatureC: 20, isPrimaryAcceptanceBlock: true, yieldStrength02: 255, yieldStrength10: 290, yieldStrength10Explicit: true, tensileStrength: 569, elongation: 50.4, sourceQuote: "Longitudinal Ts:569; Rp0.2:255; 1%:290; 5d:50.4" },
        ],
      }],
    }],
  },
});
assertEqual("acceptance row yieldStrength02", acceptanceRowPreferred.yieldStrength02, 259);
assertEqual("acceptance row yieldStrength10", acceptanceRowPreferred.yieldStrength10, 293);
assertEqual("acceptance row tensileStrength", acceptanceRowPreferred.tensileStrength, 573);
assertEqual("acceptance row elongation", acceptanceRowPreferred.elongation, 50.1);

const sourceBlockScoped = await validate({ ...baseRow, heatNumber: "333691", yieldStrength02: 301, tensileStrength: 435, elongation: 37.5 }, {
  evidence: {
    chunks: [
      { sourceBlock: { index: 1 }, heats: [{ heatNumber: { value: "333691" }, tensileTests: [{ comparableGroupId: "333691-1", gaugeLengthType: "A5", isPrimaryAcceptanceBlock: true, yieldStrength02: 306, tensileStrength: 447, elongation: 35, sourceQuote: "ReH min.235 306 | Rm min.360-500 447 | A5 min.25 35" }] }] },
      { sourceBlock: { index: 7 }, heats: [{ heatNumber: { value: "333691" }, tensileTests: [{ comparableGroupId: "333691-1", gaugeLengthType: "5D", temperatureC: 23, isPrimaryAcceptanceBlock: true, yieldStrength02: 301, tensileStrength: 435, elongation: 37.5, sourceQuote: "333691 | 3102 | 301 | 435 | 37.5" }] }] },
    ],
  },
});
assertEqual("source-block scoped yieldStrength02", sourceBlockScoped.yieldStrength02, 306);
assertEqual("source-block scoped tensileStrength", sourceBlockScoped.tensileStrength, 447);
assertEqual("source-block scoped elongation", sourceBlockScoped.elongation, 35);

const venusQuote = "608.63613.85 | 279.26327.21 | 301.87358.29 | 63.0 / 57.5364.0 / 58.44";
const venus = await validate({ ...baseRow, heatNumber: "N3164", yieldStrength02: 279.26, yieldStrength10: -1, tensileStrength: 608.63, elongation: 57.5 }, {
  evidence: {
    chunks: [{
      heats: [{
        heatNumber: { value: "N3164" },
        tensileTests: [
          { comparableGroupId: "N3164-1", gaugeLengthType: "UNKNOWN", temperatureC: 20, yieldStrength02: 279.26, yieldStrength10: null, tensileStrength: 608.63, elongation: 63, isPrimaryAcceptanceBlock: true, sourceQuote: venusQuote },
          { comparableGroupId: "N3164-1", gaugeLengthType: "UNKNOWN", temperatureC: 20, yieldStrength02: 327.21, yieldStrength10: null, tensileStrength: 613.85, elongation: 57.5, isPrimaryAcceptanceBlock: true, sourceQuote: venusQuote },
          { comparableGroupId: "N3164-2", gaugeLengthType: "UNKNOWN", temperatureC: 20, yieldStrength02: 301.87, yieldStrength10: null, tensileStrength: 608.63, elongation: 64, isPrimaryAcceptanceBlock: true, sourceQuote: venusQuote },
          { comparableGroupId: "N3164-2", gaugeLengthType: "UNKNOWN", temperatureC: 20, yieldStrength02: 358.29, yieldStrength10: null, tensileStrength: 613.85, elongation: 58.44, isPrimaryAcceptanceBlock: true, sourceQuote: venusQuote },
        ],
      }],
    }],
  },
});
assertEqual("Venus yieldStrength02", venus.yieldStrength02, 279.26);
assertEqual("Venus yieldStrength10", venus.yieldStrength10, 301.87);
assertEqual("Venus tensileStrength", venus.tensileStrength, 608.63);
assertEqual("Venus preferred elongation", venus.elongation, 63);

const lindemann = await validate({
  ...baseRow,
  heatNumber: "57495K",
  certificateNumber: "PU-26-RFS001721",
  customerOrderNumber: "AB-26-00096",
}, {
  poNumber: "PO-26-RFS001721",
  criticalSource: "INSPECTION CERTIFICATE EN 10204 - 3.2 No. WZ-00063408 Bestell-Nr./Order-No.: PO-26-RFS001721 Auftrags-Nr./Order-No.: AB-26-00096",
});
assertEqual("Lindemann certificate label", lindemann.certificateNumber, "WZ-00063408");
assertEqual("Lindemann customer order label", lindemann.customerOrderNumber, "PO-26-RFS001721");

const jmd = await validate({
  ...baseRow,
  heatNumber: "Z4195",
  werkstoff1: "2-F 316/F 316L - ASTM A 182M-24 / ASME SA-182M-23",
  norm1: "DIN EN 10204 :2005",
  norm2: "ASME B 16.5-2020",
  norm3: "NACE MR0175-2021",
  norm4: "ASME BPVC Section II Part A",
  norm5: "ASTM A262 Practice E",
}, {
  criticalSource: "Material(B02; B05) 2-F 316/F 316L - ASTM A 182M-24 / ASME SA-182M-23 Requirements ASME B 16.5-2020",
});
assertEqual("JMD material standard 1", jmd.norm1, "ASTM A182M-24");
assertEqual("JMD material standard 2", jmd.norm2, "ASME SA-182M-23");

console.log("DeepSeek traces and deterministic reducer passed B+K, Silcotub, Dalmine, Venus, Lindemann, empty-cell, evidence-precedence, and Rp1.0 tests.");
