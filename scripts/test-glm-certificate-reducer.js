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

async function validate(row, { poNumber = row.customerOrderNumber, evidence = { chunks: [] }, criticalSource = "", siblingRows = [] } = {}) {
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
    first: () => ({ json: { choices: [{ message: { content: JSON.stringify({ results: [row, ...siblingRows] }) } }] } }),
  };
  const factory = new Function("$input", "$", `return async function () {\n${code}\n}`);
  return (await factory(input, selectNode)())[0].json.results[0];
}

function assertEqual(label, actual, expected) {
  if (actual !== expected) throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

function assertDeepEqual(label, actual, expected) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
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
assertDeepEqual("B+K paired tensile tests", bk.tensileTests.map((test) => ({
  yieldStrengths: test.yieldStrengths,
  tensileStrengthMPa: test.tensileStrengthMPa,
  elongations: test.elongations,
})), [
  { yieldStrengths: [{ type: "Rp0.2", valueMPa: 284 }, { type: "Rp1.0", valueMPa: 317 }], tensileStrengthMPa: 547, elongations: [{ type: "A5", valuePercent: 52.5 }] },
  { yieldStrengths: [{ type: "Rp0.2", valueMPa: 271 }, { type: "Rp1.0", valueMPa: 306 }], tensileStrengthMPa: 547, elongations: [{ type: "A5", valuePercent: 52.5 }] },
]);

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
      { comparableGroupId: "block2-test1", testBlockId: "block2", specimenId: "Q5113", gaugeLengthType: "5D", isPrimaryAcceptanceBlock: false, yieldStrength02: 512, tensileStrength: 679, elongation: 26 },
      { comparableGroupId: "block2-test2", testBlockId: "block2", specimenId: "Q5114", gaugeLengthType: "5D", isPrimaryAcceptanceBlock: false, yieldStrength02: 509, tensileStrength: 679, elongation: 28 },
    ],
  },
});
assertEqual("Silcotub yieldStrength02", silcotub.yieldStrength02, 509);
assertEqual("Silcotub tensileStrength", silcotub.tensileStrength, 679);
assertEqual("Silcotub elongation", silcotub.elongation, 26);
assertDeepEqual("Silcotub per-specimen Rm", silcotub.tensileTests.map((test) => test.tensileStrengthMPa), [679, 683, 679, 679]);
assertDeepEqual("Silcotub per-specimen elongation", silcotub.tensileTests.map((test) => test.elongations[0]?.valuePercent), [37.5, 40, 26, 28]);

const silcotubNestedEvidence = await validate({
  ...baseRow,
  heatNumber: "938166",
  yieldStrength02: 512,
  tensileStrength: 679,
  elongation: 37.5,
  mechanicalSelection: {
    selectedComparableGroupId: "UPPER-2IN",
    gaugeLengthType: "2IN",
    tests: [
      { comparableGroupId: "UPPER-2IN", specimenId: "Q5115", gaugeLengthType: "2IN", isPrimaryAcceptanceBlock: true, yieldStrength02: 512, tensileStrength: 679, elongation: 37.5 },
      { comparableGroupId: "UPPER-2IN", specimenId: "Q5116", gaugeLengthType: "2IN", isPrimaryAcceptanceBlock: true, yieldStrength02: 511, tensileStrength: 683, elongation: 40 },
    ],
  },
}, {
  evidence: {
    chunks: [{
      certificate: {
        heats: [{
          heatNumber: { value: "938166" },
          tensileTests: [
            { comparableGroupId: "LOWER-5D", testBlockId: "LOWER-5D", specimenId: "Q5113", gaugeLengthType: "5D", isPrimaryAcceptanceBlock: true, temperatureC: 20, yieldStrength02: 512, tensileStrength: 679, elongation: 26 },
            { comparableGroupId: "LOWER-5D", testBlockId: "LOWER-5D", specimenId: "Q5114", gaugeLengthType: "5D", isPrimaryAcceptanceBlock: true, temperatureC: 20, yieldStrength02: 509, tensileStrength: 679, elongation: 28 },
          ],
        }],
      },
    }],
  },
});
assertEqual("nested Silcotub yieldStrength02", silcotubNestedEvidence.yieldStrength02, 509);
assertEqual("nested Silcotub tensileStrength", silcotubNestedEvidence.tensileStrength, 679);
assertEqual("nested Silcotub elongation", silcotubNestedEvidence.elongation, 26);
assertEqual("nested Silcotub selected test count", silcotubNestedEvidence.tensileTests.length, 2);

const silcotubChemistryTable = [
  "CHEMICAL COMPOSITION / CHEMISCHE ZUSAMMENSETZUNG",
  '<table><tr><td rowspan="5" colspan="4"></td><td colspan="21">Composition %</td></tr>',
  '<tr><td colspan="9">X 100</td><td colspan="7">X 1000</td><td colspan="5">X 10000</td></tr>',
  '<tr><td>C</td><td>Mn</td><td>Si</td><td>Ni</td><td>Cr</td><td>Mo</td><td>V</td><td>Cu</td><td>F1</td><td>P</td><td>S</td><td>Sn</td><td>Al</td><td>Ti</td><td>Nb</td><td>As</td><td>N</td><td>B</td><td>Sb</td><td>W</td><td>Zr</td></tr>',
  '<tr><td rowspan="2">H Max Min</td><td>12</td><td>50</td><td>40</td><td>20</td><td>950</td><td>105</td><td>25</td><td>10</td><td>--</td><td>20</td><td>5</td><td>10</td><td>20</td><td>10</td><td>100</td><td>10</td><td>700</td><td>10</td><td>30</td><td>500</td><td>100</td></tr>',
  '<tr><td>8</td><td>30</td><td>20</td><td>--</td><td>800</td><td>85</td><td>18</td><td>--</td><td>400</td><td>--</td><td>--</td><td>--</td><td>--</td><td>--</td><td>60</td><td>--</td><td>350</td><td>--</td><td>--</td><td>--</td><td>--</td></tr>',
  '<tr><td rowspan="2">Heat N°</td><td rowspan="2">Sample N°</td><td rowspan="2">Lot N°</td><td rowspan="2">P Max Min</td><td>12</td><td>50</td><td>40</td><td>20</td><td>950</td><td>105</td><td>25</td><td>10</td><td>--</td><td>20</td><td>5</td><td>10</td><td>20</td><td>10</td><td>100</td><td>10</td><td>700</td><td>10</td><td>30</td><td>500</td><td>100</td></tr>',
  '<tr><td>8</td><td>30</td><td>20</td><td>--</td><td>800</td><td>85</td><td>18</td><td>--</td><td>400</td><td>--</td><td>--</td><td>--</td><td>--</td><td>--</td><td>60</td><td>--</td><td>350</td><td>--</td><td>--</td><td>--</td><td>--</td></tr>',
  '<tr><td>938166</td><td></td><td></td><td>H</td><td>11</td><td>40</td><td>28</td><td>8</td><td>862</td><td>90</td><td>20</td><td>7</td><td>980</td><td>12</td><td>3</td><td>4</td><td>6</td><td>1</td><td>66</td><td>5</td><td>588</td><td>3</td><td>18</td><td>3</td><td>26</td></tr>',
  '<tr><td>938166</td><td>Q5113</td><td>8</td><td>P</td><td>9</td><td>41</td><td>27</td><td>8</td><td>872</td><td>92</td><td>21</td><td>7</td><td>535.5</td><td>11</td><td>1</td><td>7</td><td>11</td><td>2</td><td>68</td><td>6</td><td>589</td><td>4</td><td>15</td><td>65</td><td>28</td></tr></table>',
].join("\n");
const silcotubChemistry = await validate({
  ...baseRow,
  heatNumber: "938166",
  chemicals: { C: 0.11, N: 0.0588, B: 0.003, Sb: 0.018, W: 0.003, Zr: 0.026 },
}, {
  criticalSource: silcotubChemistryTable,
  evidence: { chunks: [{ heats: [{ heatNumber: { value: "938166" }, chemistry: [
    { element: "N", analysisType: "H", rawValue: 588, scale: 10000, value: 0.0588 },
    { element: "B", analysisType: "H", rawValue: 3, scale: 1000, value: 0.003 },
    { element: "Sb", analysisType: "H", rawValue: 18, scale: 1000, value: 0.018 },
    { element: "W", analysisType: "H", rawValue: 3, scale: 1000, value: 0.003 },
    { element: "Zr", analysisType: "H", rawValue: 26, scale: 1000, value: 0.026 },
  ] }] }] },
});
for (const [element, expected] of Object.entries({ C: 0.11, MN: 0.4, SI: 0.28, N: 0.0588, B: 0.0003, Sb: 0.0018, W: 0.0003, Zr: 0.0026 })) {
  assertEqual("Silcotub chemistry " + element, silcotubChemistry.chemicals[element], expected);
}

const starofitChemistryTables = [
  "Chargen-Analyse (aus Vormaterialzeugnis) / Chem. composition of cast",
  "<table><tr><td>Ident Nr.</td><td>Charge Nr.</td><td>Menge</td><td>Artikel</td></tr>",
  "<tr><td>P0745</td><td>333691</td><td>5</td><td>T-Stücke</td></tr>",
  '<tr><td colspan="14">Chargen-Analyse (aus Vormaterialzeugnis)</td></tr>',
  "<tr><td>C</td><td>SI</td><td>Mn</td><td>P</td><td>S</td><td>AI</td><td>Cu</td><td>Cr</td><td>Mo</td><td>NI</td><td>TI</td><td>V</td><td>Nb</td><td>Cr+Cu+Mo+NI</td></tr>",
  "<tr><td>0,14</td><td>0,2</td><td>0,56</td><td>0,012</td><td>0,001</td><td>0,027</td><td>0,04</td><td>0,07</td><td>0,02</td><td>0,06</td><td>0,002</td><td>0,001</td><td>0,001</td><td>0,19</td></tr></table>",
  "HEAT CHEMICAL ANALYSIS / SCHMELZANALYSE",
  "X".repeat(700),
  "<table><tr><td>Heat No.</td><td>V %</td><td>Ti %</td><td>Nb(Cb) %</td><td>N %</td><td>EF 10 %</td><td>EF 76 %</td></tr>",
  "<tr><td>min</td><td>-</td><td>-</td><td>-</td><td>-</td><td>-</td><td>0.020</td></tr>",
  "<tr><td>max</td><td>0.020</td><td>0.040</td><td>0.020</td><td>-</td><td>0.70</td><td>-</td></tr>",
  "<tr><td>333691</td><td>0.001</td><td>0.002</td><td>0.001</td><td>0.0072</td><td>0.19</td><td>0.028</td></tr></table>",
].join("\n");
const starofitChemistry = await validate({
  ...baseRow,
  heatNumber: "333691",
  chemicals: { C: 0.14, SI: 0.2, MN: 0.56, N: -1, Ti: 0.02 },
}, {
  criticalSource: starofitChemistryTables,
  evidence: { chunks: [{ heats: [{ heatNumber: { value: "333691" }, chemistry: [
    { element: "TI", analysisType: "H", rawValue: 0.002, scale: 1, value: 0.002 },
  ] }] }] },
});
for (const [element, expected] of Object.entries({ C: 0.14, SI: 0.2, MN: 0.56, AL: 0.027, TI: 0.002, V: 0.001, NB: 0.001, N: 0.0072, "Cr+Cu+Mo+Ni": 0.19 })) {
  assertEqual("Starofit chemistry " + element, starofitChemistry.chemicals[element], expected);
}

const unicornCompoundChemistry = [
  "Schmelzen-Nr./Heat No.: 475670",
  "Chemische Zusammensetzung / Chemical Composition",
  "<table><tr><td></td><td>C</td><td>Si</td><td>Mn</td><td>P</td><td>S</td><td>Cr</td><td>Mo</td><td>Ni</td></tr>",
  "<tr><td>Ist/Actual</td><td>0.044</td><td>0.24</td><td>1.27</td><td>0.036</td><td>0.005</td><td>17.60</td><td>0.42</td><td>9.84</td></tr></table>",
  "<table><tr><td colspan=\"9\">CHEMISCHE ZUSAMMENSETZUNG GUSS U: % CHARGEN°. : 901972</td></tr>",
  "<tr><td></td><td>C</td><td>Mn</td><td>Si</td><td>P</td><td>S</td><td>Cr</td><td>Ni</td><td>Co</td></tr>",
  "<tr><td>Cer.</td><td>0.043</td><td>1.590</td><td>0.406</td><td>0.031</td><td>0.021</td><td>17.110</td><td>9.060</td><td>0.249</td></tr></table>",
].join("\n");
const unicornFirstHeat = await validate({
  ...baseRow,
  heatNumber: "475670",
  chemicals: { C: 0.043, SI: 0.406, MN: 1.59 },
}, { criticalSource: unicornCompoundChemistry });
for (const [element, expected] of Object.entries({ C: 0.044, SI: 0.24, MN: 1.27, P: 0.036, S: 0.005, CR: 17.6, MO: 0.42, NI: 9.84 })) {
  assertEqual("Unicorn first-heat chemistry " + element, unicornFirstHeat.chemicals[element], expected);
}

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
assertDeepEqual("Dalmine paired tensile tests", dalmine.tensileTests.map((test) => [
  test.yieldStrengths[0]?.valueMPa,
  test.tensileStrengthMPa,
  test.elongations[0]?.valuePercent,
]), [[367, 499, 25.5], [364, 498, 27], [369, 507, 23.5]]);

const duplicatedTensileEvidence = await validate({ ...baseRow, heatNumber: "DEDUP", yieldStrength02: 367, tensileStrength: 499, elongation: 25.5 }, {
  evidence: {
    chunks: [
      { sourceBlock: { index: 1 }, heats: [{ heatNumber: { value: "DEDUP" }, tensileTests: [{
        sampleNumber: "N7438/C", testTemperatureC: 20,
        yieldStrengths: [{ type: "Rp0.2", valueMPa: 367 }], tensileStrengthMPa: 499,
        elongations: [{ type: "5D (Lo 5D = 5.65√So)", valuePercent: 25.5, gaugeLengthMm: 90 }],
        specimenDimensions: "20.48 x 12.78 mm",
      }] }] },
      { sourceBlock: { index: 2 }, heats: [{ heatNumber: { value: "DEDUP" }, tensileTests: [{
        sampleNumber: "N7438/C", testTemperatureC: 20,
        yieldStrengths: [{ type: "Rp0.2", valueMPa: 367 }], tensileStrengthMPa: 499,
        elongations: [{ type: "A", valuePercent: 25.5, gaugeLengthMm: 90 }],
        specimenDimensions: "Ss 20.48 x 12.78 mm, 262.50 mm²",
      }] }] },
    ],
  },
});
assertEqual("overlapping tensile evidence is deduplicated", duplicatedTensileEvidence.tensileTests.length, 1);

const requirementElongationNoise = await validate({ ...baseRow, heatNumber: "REQNOISE", yieldStrength02: 512, tensileStrength: 679, elongation: 37.5 }, {
  evidence: {
    chunks: [
      { sourceBlock: { index: 1 }, heats: [{ heatNumber: { value: "REQNOISE" }, tensileTests: [{
        sampleNumber: "Q5115/AA", testTemperatureC: 20,
        yieldStrengths: [{ type: "Rp0.2", valueMPa: 512 }], tensileStrengthMPa: 679,
        elongations: [{ type: "2IN", valuePercent: 37.5, gaugeLengthMm: 50 }],
      }] }] },
      { sourceBlock: { index: 2 }, heats: [{ heatNumber: { value: "REQNOISE" }, tensileTests: [{
        sampleNumber: "Q5115/AA", testTemperatureC: 20,
        yieldStrengths: [{ type: "Rp0.2", valueMPa: 512 }], tensileStrengthMPa: 679,
        elongations: [
          { type: "A (Obt., Lo=2\")", valuePercent: 30.6, gaugeLengthMm: 50 },
          { type: "unlabeled (2. Dehnungsspalte)", valuePercent: 37.5 },
        ],
      }] }] },
    ],
  },
});
assertEqual("requirement elongation does not create a duplicate specimen", requirementElongationNoise.tensileTests.length, 1);
assertDeepEqual("requirement elongation is excluded in favor of the clean measured value", requirementElongationNoise.tensileTests[0].elongations.map(entry => entry.valuePercent), [37.5]);

const dalminePieceQuantity = await validate({
  ...baseRow,
  heatNumber: "956643",
  customerOrderNumber: "PO-25-BBT000155",
  quantity: 6.64,
  deckSelection: {
    documentRole: "DECK",
    sourceBlockIndex: 1,
    customerOrderNumber: "PO-25-BBT000155",
    certificateNumber: "01-26-02987",
    quantity: 6.64,
  },
}, {
  poNumber: "",
  evidence: {
    chunks: [{
      sourceBlock: { index: 1 },
      certificate: {
        documentRole: { value: "DECK" },
        deckIndicators: { customerOrder: true, finishedProduct: true, finishedQuantity: true, finishedDimensions: true },
        certificateNumber: { value: "01-26-02987" },
        customerOrderNumber: { value: "PO-25-BBT000155" },
      },
      heats: [{
        heatNumber: { value: "956643" },
        quantity: { value: 1, unit: "pcs", sourceQuote: "Quantity / Menge: 1Pcs/Pz 6.64 mt 315 kg" },
      }],
    }],
  },
});
assertEqual("Dalmine piece quantity without order context", dalminePieceQuantity.quantity, 1);

const unicornPositionDimensions = await validate({
  ...baseRow,
  heatNumber: "475670",
  customerOrderNumber: "PO-25-RFS003046",
  quantity: 2,
  product: "Hülse 193,7 x 22,2 mm",
  dimensions: "193.7 x 22.2 mm",
}, {
  poNumber: "",
  siblingRows: [{
    ...baseRow,
    heatNumber: "901972",
    customerOrderNumber: "PO-25-RFS003046",
    quantity: 2,
    product: "Hülse 133,0 x 14,2 mm",
    dimensions: "133.0 x 14.2 mm",
  }],
  evidence: {
    chunks: [{
      sourceBlock: { index: 1 },
      certificate: {
        documentRole: { value: "DECK" },
        deckIndicators: { customerOrder: true, finishedProduct: true, finishedQuantity: true, finishedDimensions: true },
        certificateNumber: { value: "2026-102898" },
        customerOrderNumber: { value: "PO-25-RFS003046" },
        product: { value: "Hülse 193,7 x 22,2 mm / Hülse 133,0 x 14,2 mm" },
        dimensions: { value: "193.7 x 22.2 / 133.0 x 14.2 mm" },
      },
      heats: [{ heatNumber: { value: "475670" }, quantity: { value: 4, unit: "pcs" } }],
    }],
  },
});
assertEqual("Unicorn position-specific dimensions", unicornPositionDimensions.dimensions, "193.7 x 22.2 mm");
assertEqual("Unicorn position-specific product", unicornPositionDimensions.product, "Hülse 193,7 x 22,2 mm");
assertEqual("Unicorn position-specific quantity", unicornPositionDimensions.quantity, 2);

const invalidOffset = await validate({
  ...baseRow,
  tensileTests: [{
    yieldStrengths: [{ type: "Rp0.2", valueMPa: 300 }, { type: "Rp1.0", valueMPa: 250 }],
    tensileStrengthMPa: 400,
    elongations: [],
  }],
});
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
assertEqual("empty mechanical cell does not become zero", missingMechanicalCell.yieldStrength02, -1);
assertEqual("empty mechanical cell remains absent", missingMechanicalCell.tensileTests[0].yieldStrengths.length, 0);

const genericYieldPoint = await validate({
  ...baseRow,
  tensileTests: [{ yieldStrengths: [{ type: "Yield Point", valueMPa: 303 }], tensileStrengthMPa: 425, elongations: [{ type: "5D", valuePercent: 35.4 }] }],
}, { criticalSource: "Streckgrenze / Yield strength / Yield Point MPa 303" });
assertEqual("generic yield-point header normalizes to ReH", genericYieldPoint.tensileTests[0].yieldStrengths[0].type, "ReH");

const explicitOffsetYield = await validate({
  ...baseRow,
  tensileTests: [{ yieldStrengths: [{ type: "Yield Point", valueMPa: 303 }], tensileStrengthMPa: 425, elongations: [] }],
}, { criticalSource: "Yield Strength \\(R_{p0,2}\\) MPa 303" });
assertEqual("explicit 0.2 percent offset remains Rp0.2", explicitOffsetYield.tensileTests[0].yieldStrengths[0].type, "Rp0.2");

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
assertEqual("acceptance row yieldStrength02", acceptanceRowPreferred.yieldStrength02, 255);
assertEqual("acceptance row yieldStrength10", acceptanceRowPreferred.yieldStrength10, 290);
assertEqual("acceptance row tensileStrength", acceptanceRowPreferred.tensileStrength, 569);
assertEqual("acceptance row elongation", acceptanceRowPreferred.elongation, 50.1);
assertEqual("acceptance row preserves both specimens", acceptanceRowPreferred.tensileTests.length, 2);

const sourceBlockScoped = await validate({ ...baseRow, heatNumber: "333691", yieldStrength02: 301, tensileStrength: 435, elongation: 37.5 }, {
  evidence: {
    chunks: [
      { sourceBlock: { index: 1 }, heats: [{ heatNumber: { value: "333691" }, tensileTests: [{ comparableGroupId: "333691-1", gaugeLengthType: "A5", isPrimaryAcceptanceBlock: true, yieldStrength02: 306, tensileStrength: 447, elongation: 35, sourceQuote: "ReH min.235 306 | Rm min.360-500 447 | A5 min.25 35" }] }] },
      { sourceBlock: { index: 7 }, heats: [{ heatNumber: { value: "333691" }, tensileTests: [{ comparableGroupId: "333691-1", gaugeLengthType: "5D", temperatureC: 23, isPrimaryAcceptanceBlock: true, yieldStrength02: 301, tensileStrength: 435, elongation: 37.5, sourceQuote: "333691 | 3102 | 301 | 435 | 37.5" }] }] },
    ],
  },
});
assertEqual("source-block scoped yieldStrength02", sourceBlockScoped.yieldStrength02, 301);
assertEqual("source-block scoped tensileStrength", sourceBlockScoped.tensileStrength, 435);
assertEqual("source-block scoped elongation", sourceBlockScoped.elongation, 35);
assertEqual("source-block scoped preserves both tests", sourceBlockScoped.tensileTests.length, 2);

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

const venusLiveShape = await validate({ ...baseRow, heatNumber: "N3164", yieldStrength02: 279.26, yieldStrength10: 301.87, tensileStrength: 608.63, elongation: 57.5 }, {
  criticalSource: "<table><tr><td>Mechanical tests @ Room temperature</td><td>% Elongation</td></tr><tr><td>608.63613.85</td><td>63.0 / 57.5364.0 / 58.44</td></tr></table>",
  evidence: { chunks: [{ heats: [{ heatNumber: { value: "N3164" }, tensileTests: [
    { comparableGroupId: "N3164-1", testBlockId: "N3164-1", testTemperatureC: 20, yieldStrengths: [{ type: "Rp0.2", valueMPa: 279.26 }, { type: "Rp1.0", valueMPa: 301.87 }], tensileStrengthMPa: 608.63, elongations: [{ type: "50MM", valuePercent: 63 }, { type: "5D", valuePercent: 57.53 }], isPrimaryAcceptanceBlock: true, sourceQuote: "608.63 / 279.26 / 301.87 / 63.0 / 57.53" },
    { comparableGroupId: "N3164-1", testBlockId: "N3164-1", testTemperatureC: 20, yieldStrengths: [{ type: "Rp0.2", valueMPa: 327.21 }, { type: "Rp1.0", valueMPa: 358.29 }], tensileStrengthMPa: 613.85, elongations: [{ type: "50MM", valuePercent: 64 }, { type: "5D", valuePercent: 58.44 }], isPrimaryAcceptanceBlock: true, sourceQuote: "613.85 / 327.21 / 358.29 / 64.0 / 58.44" },
  ] }] }] },
});
assertEqual("Venus live-shape preferred elongation", venusLiveShape.elongation, 63);
assertDeepEqual("Venus live-shape paired elongations", venusLiveShape.tensileTests.map((test) => test.elongations.map((entry) => entry.valuePercent)), [[63, 57.53], [64, 58.44]]);

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

console.log("GLM 5.3 Flash traces and deterministic reducer passed B+K, Silcotub chemistry scaling, Starofit chemistry merging, Unicorn multi-heat isolation, Dalmine, Venus, Lindemann, empty-cell, evidence-precedence, and Rp1.0 tests.");
