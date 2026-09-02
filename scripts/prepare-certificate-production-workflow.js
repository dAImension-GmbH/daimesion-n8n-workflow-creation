#!/usr/bin/env node

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { applyStructuredTensileValidatorCode } from "./structured-tensile-validator-code.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workflowPath = path.join(ROOT, "workflows/outlook-certificate-analysis.json");
const workflow = JSON.parse(readFileSync(workflowPath, "utf8"));

const replacements = [
  [
    "Bevorzuge eine PO-Nummer wie PO-26-RFS004402, danach Bestell- oder Auftragsnummern. Verwende conversationId nur als letzte Möglichkeit.",
    "Bevorzuge eine ausdrücklich als PO-/Bestellnummer beschriftete Referenz, danach eine ausdrücklich beschriftete Auftragsnummer. Verwende conversationId nur als letzte Möglichkeit.",
  ],
  [
    "Werkstoffspezifikationen, die in der Material-/B02-Zeile stehen, bleiben zusätzlich eigenständige Normen und stehen vor allgemeinen Prüfanforderungen. Beispiel: F316/F316L - ASTM A 182M-24 / ASME SA-182M-23 ergibt werkstoff=F316/F316L sowie norm1=ASTM A182M-24 und norm2=ASME SA-182M-23.",
    "Werkstoffspezifikationen in einer Material-/B02-Zeile werden in Werkstoffbezeichnung und jede separat genannte Werkstoffnorm zerlegt. Die Werkstoffbezeichnung bleibt werkstoff; jede durch Trennzeichen oder einen neuen Normpräfix beginnende Referenz bleibt eine eigenständige Norm und steht vor allgemeinen Prüfanforderungen.",
  ],
  [
    "Skalierungsbeispiele: raw 18 unter X 100 ergibt 0.18; raw 13 unter X 1000 ergibt 0.013; raw 92 unter X 10000 ergibt 0.0092. Gib rawValue, scale, value und analysisType aus.",
    "Bei einer ausdrücklich über derselben Elementspalte ausgewiesenen X-Skala gilt value = rawValue / scale. Wende die Skala genau einmal und nur auf die von derselben Überschrift überspannten Spalten an. Gib rawValue, scale, value und analysisType aus.",
  ],
  [
    "Direkte Dezimal-Prozentwerte unverändert übernehmen; ausgewiesene X-Skalen genau einmal anwenden: 18/X100=0.18, 13/X1000=0.013, 92/X10000=0.0092.",
    "Direkte Dezimal-Prozentwerte unverändert übernehmen; bei einer ausdrücklich zugeordneten X-Skala value = rawValue / scale rechnen und die Skala genau einmal anwenden.",
  ],
  [
    "Direkte Dezimalwerte nicht skalieren; ausgewiesene Skalen genau einmal anwenden: 18/X100=0.18, 13/X1000=0.013, 92/X10000=0.0092.",
    "Direkte Dezimalwerte nicht skalieren; bei einer ausdrücklich zugeordneten X-Skala value = rawValue / scale rechnen und die Skala genau einmal anwenden.",
  ],
  [
    "Mehrzeilige Tabellenzellen sind mehrere Prüfzeilen: Stehen unter einer gemeinsamen Proben-Nr. beispielsweise 284/317 und darunter 271/306, erzeuge zwei Tests desselben comparableGroupId und erhalte beide Rp0.2/Rp1.0-Paare.",
    "Mehrzeilige Tabellenzellen sind mehrere Prüfzeilen: Stehen unter einer gemeinsamen Proben-Nr. in mehreren Zeilen jeweils gekoppelte Rp0.2/Rp1.0-Werte, erzeuge pro Zeile einen Test desselben comparableGroupId und erhalte jedes Wertepaar.",
  ],
  [
    "Bei parallel angeordneten Mechanikspalten niemals Spalten als neue Proben ausgeben. Beispiel: Rm=[608.63,613.85], Rp0.2=[279.26,327.21], Rp1.0=[301.87,358.29] sind genau zwei Probenzeilen: 608.63/279.26/301.87 und 613.85/327.21/358.29.",
    "Bei parallel angeordneten Mechanikspalten niemals Spalten als neue Proben ausgeben. Kopple für jede Tabellenzeile Rm, Rp0.2 und Rp1.0 anhand derselben Zeilenposition zu genau einem Prüfkörper.",
  ],
  [
    "Bei parallel angeordneten Mechanikspalten niemals Spalten als neue Proben ausgeben. Rm=[608.63,613.85], Rp0.2=[279.26,327.21] und Rp1.0=[301.87,358.29] ergeben genau zwei gekoppelte tensileTests.",
    "Bei parallel angeordneten Mechanikspalten niemals Spalten als neue Proben ausgeben. Kopple Rm, Rp0.2 und Rp1.0 derselben Tabellenzeile zu genau einem tensileTests-Eintrag.",
  ],
  [
    "Bei parallel angeordneten Mechanikspalten niemals Spalten als neue Proben ausgeben. Beispiel: Rm=[608.63,613.85], Rp0.2=[279.26,327.21], Rp1.0=[301.87,358.29] sind genau zwei Prüfkörper: 608.63/279.26/301.87 und 613.85/327.21/358.29.",
    "Bei parallel angeordneten Mechanikspalten niemals Spalten als neue Proben ausgeben. Kopple für jede Tabellenzeile Rm, Rp0.2 und Rp1.0 anhand derselben Zeilenposition zu genau einem Prüfkörper.",
  ],
  [
    "Bei parallel angeordneten Mechanikspalten niemals Spalten als neue Proben ausgeben. Beispiel: Rm=[608.63,613.85], Rp0.2=[279.26,327.21], Rp1.0=[301.87,358.29] sind genau zwei Prüfkörper: 608.63/279.26/301.87 und 613.85/327.21/358.29;",
    "Bei parallel angeordneten Mechanikspalten niemals Spalten als neue Proben ausgeben. Kopple für jede Tabellenzeile Rm, Rp0.2 und Rp1.0 anhand derselben Zeilenposition zu genau einem Prüfkörper;",
  ],
  [
    "Bei Rohrzeugnissen Produkt aus Note 1 und Normen vollständig aus Note 2 übernehmen; AD2000 W4+TEMPLATE BUHLMANN-007 REV.10 in AD2000 W4+ und TEMPLATE BUHLMANN-007 REV.10 trennen.",
    "Bei Rohrzeugnissen Produkt aus einer ausdrücklich als Produktbeschreibung gekennzeichneten Note und Normen vollständig aus der zugehörigen Normen-Note übernehmen. Aneinandergeratene Referenzen an einem neuen Norm-, Richtlinien- oder Template-Präfix in getrennte Normen aufteilen.",
  ],
  [
    "Bei Rohrzeugnissen Note 2 vollständig prüfen und AD2000 W4+TEMPLATE BUHLMANN-007 REV.10 in AD2000 W4+ und TEMPLATE BUHLMANN-007 REV.10 trennen.",
    "Bei Rohrzeugnissen die zugehörige Normen-Note vollständig prüfen und aneinandergeratene Referenzen an einem neuen Norm-, Richtlinien- oder Template-Präfix in getrennte Normen aufteilen.",
  ],
];

const nodeCollections = [workflow.nodes, workflow.activeVersion?.nodes].filter(Array.isArray);
for (const nodes of nodeCollections) {
  for (const node of nodes) {
    if (typeof node.parameters?.jsCode !== "string") continue;
    for (const [from, to] of replacements) {
      node.parameters.jsCode = node.parameters.jsCode.replaceAll(from, to);
    }
  }
}

const fullManufacturerRule = "creditor/manufacturer vollständig und wörtlich aus der Ausstellerzeile des Deckzeugnisses übernehmen, einschließlich unmittelbar zugehöriger Geschäftsbereichs-, Division- oder Markenbezeichnung. Den Namen nicht auf die Rechtsform oder den ersten Namensteil kürzen.";
const pairedColumnRecoveryRule = "Wenn OCR die Unterüberschriften einer Mechaniktabelle verliert, aber drei benachbarte Spalten je Zeile eindeutig Rm sowie zwei steigende Dehngrenzen enthalten, rekonstruiere die Zeilen nur bei der Plausibilitätsfolge erste Dehngrenze < zweite Dehngrenze < Rm. Zwei Dehnungen derselben Zeile bleiben gekoppelt; ihre Typen nur aus dem Tabellen- oder Full-Section-Kontext bestimmen, niemals anhand der Messwerte.";
for (const nodes of nodeCollections) {
  for (const node of nodes) {
    if (!["Zeugnis in Belegblöcke teilen", "Belege sammeln und Normalisierung bauen", "Qualitätsprüfung vorbereiten"].includes(node.name)) continue;
    if (!node.parameters.jsCode.includes(fullManufacturerRule)) {
      node.parameters.jsCode = node.parameters.jsCode.replace(
        "  'Antworte nur als JSON-Objekt",
        `  '${fullManufacturerRule}',\n  'Antworte nur als JSON-Objekt`,
      );
    }
    if (!node.parameters.jsCode.includes(pairedColumnRecoveryRule)) {
      node.parameters.jsCode = node.parameters.jsCode.replace(
        "  'Antworte nur als JSON-Objekt",
        `  '${pairedColumnRecoveryRule}',\n  'Antworte nur als JSON-Objekt`,
      );
    }
  }

}

const finalValidation = workflow.nodes.find((node) => node.name === "Ergebnis validieren und Dokumentenreview vorbereiten");
if (!finalValidation) throw new Error("Final certificate validator node is missing");
finalValidation.parameters.jsCode = applyStructuredTensileValidatorCode(finalValidation.parameters.jsCode);

writeFileSync(workflowPath, `${JSON.stringify(workflow, null, 2)}\n`);
console.log(`Prepared production prompts in ${workflowPath}`);
