export const deterministicEvaluationCode = String.raw`const actual = $('Ergebnis validieren und Dokumentenreview vorbereiten').first().json;
let evaluationRow = {};
try { evaluationRow = $('When fetching a dataset row').first().json; } catch {}
let manualEvaluationRow = {};
try { manualEvaluationRow = $('Evaluationsfall manuell laden').first().json; } catch {}
const expectedRaw = evaluationRow.expectedAnswer ?? manualEvaluationRow.expectedAnswer;
if (!expectedRaw) throw new Error('The evaluation row has no expectedAnswer.');
let expected = expectedRaw;
if (typeof expectedRaw === 'string') {
  try { expected = JSON.parse(expectedRaw); } catch { throw new Error('expectedAnswer is not valid JSON.'); }
}
const actualAnswer = JSON.stringify(actual);
const expectedAnswer = typeof expectedRaw === 'string' ? expectedRaw : JSON.stringify(expectedRaw);
const normalizeString = value => String(value ?? '').normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g, '');
const exactStringMatches = (actualValue, expectedValue) => {
  const actualNormalized = normalizeString(actualValue);
  const expectedNormalized = normalizeString(expectedValue);
  const alternatives = String(expectedValue ?? '').split(/\s+\/\s+/).map(normalizeString).filter(Boolean);
  return Boolean(actualNormalized) && (actualNormalized === expectedNormalized || alternatives.some(value => actualNormalized === value));
};
const containsExpectedString = (actualValue, expectedValue) => {
  const actualNormalized = normalizeString(actualValue);
  const alternatives = String(expectedValue ?? '').split(/\s+\/\s+/).map(normalizeString).filter(Boolean);
  return Boolean(actualNormalized) && alternatives.some(value => actualNormalized === value || actualNormalized.includes(value));
};
const productTokens = value => {
  const aliases = { exzentrisch: 'eccentric', exzentrisches: 'eccentric', reduzierstuck: 'reducer', reduzierstueck: 'reducer', typ: 'type', rf: 'raisedface', raised: 'raisedface', face: '', zoll: 'inch', stuck: 'piece', stueck: 'piece', stick: 'piece' };
  return String(value ?? '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/).map(token => aliases[token] ?? token).filter(Boolean);
};
const productMatches = (actualValue, expectedValue) => {
  if (containsExpectedString(actualValue, expectedValue)) return true;
  const actualTokens = new Set(productTokens(actualValue));
  return String(expectedValue ?? '').split(/\s+\/\s+/).some(alternative => {
    const expectedTokens = productTokens(alternative);
    return expectedTokens.length > 0 && expectedTokens.every(token => actualTokens.has(token));
  });
};
const numberMatches = (actualValue, expectedValue) => {
  const left = Number(actualValue);
  const right = Number(expectedValue);
  const tolerance = Math.max(0.01, Math.abs(right) * 0.0001);
  return Number.isFinite(left) && Number.isFinite(right) && Math.abs(left - right) <= tolerance;
};
const chemicalNumberMatches = (actualValue, expectedValue) => {
  const left = Number(actualValue);
  const right = Number(expectedValue);
  const tolerance = Math.max(0.000001, Math.abs(right) * 0.0001);
  return Number.isFinite(left) && Number.isFinite(right) && left >= 0 && Math.abs(left - right) <= tolerance;
};
const dimensionsMatch = (actualValue, expectedValue) => normalizeString(actualValue) === normalizeString(expectedValue);
const normalizeOrientation = value => {
  const compact = normalizeString(value);
  if (/^(l|langs|laengs|longitudinal)/.test(compact) || compact.includes('longitudinal')) return 'longitudinal';
  if (/^(q|quer|transverse|transversal)/.test(compact) || compact.includes('transverse') || compact.includes('transversal')) return 'transverse';
  return compact;
};
const orientationMatches = (actualValue, expectedValue) => normalizeOrientation(actualValue) === normalizeOrientation(expectedValue);
const normalizeLocation = value => String(value ?? '')
  .normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/,/g, '.')
  .replace(/aussenradius|außenradius|outer\s*radius|surface/g, ' surface ')
  .replace(/\b(from|the|vom|von|der|des)\b/g, ' ')
  .replace(/[^a-z0-9.]+/g, '');
const locationMatches = (actualValue, expectedValue) => normalizeLocation(actualValue) === normalizeLocation(expectedValue);
const canonicalElongationType = value => {
  const raw = String(value ?? '').normalize('NFKD').replace(/\p{M}/gu, '').toUpperCase().replace(/,/g, '.');
  const compact = raw.replace(/\s+/g, '');
  if (/50MM|G\.L\.?50/.test(raw) || compact.includes('50MM')) return '50MM';
  if (/A?2["”]|2IN(CH)?/.test(compact) && !compact.includes('5D')) return '2IN';
  if (/A?4D/.test(compact)) return '4D';
  if (/A?5D|5D|5[.,]?6?5|5[.,]?8?5/.test(compact) || compact === 'A5') return '5D';
  if (/^(?:%?ELONGATION|DEHNUNG)(?:\((?:WERT|VALUE)\d+\)|(?:WERT|VALUE)\d+)?$/.test(compact)) return 'A';
  if (/(?:ELONGATION|DEHNG)/.test(compact)) return 'A';
  if (/^A(?:\W|$)/.test(raw)) return 'A';
  return normalizeString(value).toUpperCase() || 'A';
};
const elongationTypeMatches = (actualValue, expectedValue) => {
  const actualType = canonicalElongationType(actualValue);
  const expectedType = canonicalElongationType(expectedValue);
  return actualType === expectedType;
};
const actualRows = Array.isArray(actual.results) ? actual.results : [];
const expectedRows = Array.isArray(expected.positions) ? expected.positions : [];
const matchedFacts = [];
const missingOrWrongFacts = [];
const matchedChemistryFacts = [];
const missingOrWrongChemistryFacts = [];
const matchedTensileFacts = [];
const missingOrWrongTensileFacts = [];
let checkedFacts = 0;
let checkedChemistryFacts = 0;
let checkedTensileFacts = 0;
const record = (path, ok, detail) => {
  checkedFacts++;
  (ok ? matchedFacts : missingOrWrongFacts).push(ok ? path : path + ': ' + detail);
};
const recordChemistry = (path, ok, detail) => {
  checkedChemistryFacts++;
  (ok ? matchedChemistryFacts : missingOrWrongChemistryFacts).push(ok ? path : path + ': ' + detail);
  record(path, ok, detail);
};
const recordTensile = (path, ok, detail) => {
  checkedTensileFacts++;
  (ok ? matchedTensileFacts : missingOrWrongTensileFacts).push(ok ? path : path + ': ' + detail);
  record(path, ok, detail);
};
for (const [key, actualKey] of [['certificateNumber','certificateNumber'], ['customerOrderNumber','customerOrderNumber']]) {
  if (expected[key] === undefined) continue;
  const values = actualRows.map(row => row[actualKey]);
  record(key, values.some(value => exactStringMatches(value, expected[key])), 'expected ' + JSON.stringify(expected[key]) + ', got ' + JSON.stringify(values));
}
if (expected.creditor !== undefined) {
  const values = actualRows.map(row => row.creditor);
  record('creditor', values.some(value => containsExpectedString(value, expected.creditor)), 'expected ' + JSON.stringify(expected.creditor) + ', got ' + JSON.stringify(values));
}
if (expected.rawMaterialCertificate !== undefined) {
  const values = actualRows.map(row => row.rawMaterialCertificate);
  record('rawMaterialCertificate', values.some(value => exactStringMatches(value, expected.rawMaterialCertificate)), 'expected ' + JSON.stringify(expected.rawMaterialCertificate) + ', got ' + JSON.stringify(values));
}
const unusedRows = new Set(actualRows.map((_, index) => index));
for (let expectedIndex = 0; expectedIndex < expectedRows.length; expectedIndex++) {
  const expectedRow = expectedRows[expectedIndex];
  const candidates = [...unusedRows].filter(index => exactStringMatches(actualRows[index].heatNumber, expectedRow.heatNumber));
  let rowIndex = candidates.find(index => expectedRow.dimensions === undefined || dimensionsMatch(actualRows[index].dimensions, expectedRow.dimensions));
  if (rowIndex === undefined) rowIndex = candidates[0];
  const prefix = 'positions[' + expectedIndex + ']';
  if (rowIndex === undefined) {
    record(prefix, false, 'no row for heat ' + expectedRow.heatNumber);
    for (const [element, expectedValue] of Object.entries(expectedRow.chemicals ?? {})) {
      recordChemistry(prefix + '.chemicals.' + element, false, 'no row for heat ' + expectedRow.heatNumber + '; expected ' + expectedValue);
    }
    if (Array.isArray(expectedRow.tensileTests)) {
      recordTensile(prefix + '.tensileTests', false, 'no row for heat ' + expectedRow.heatNumber);
    }
    continue;
  }
  unusedRows.delete(rowIndex);
  const row = actualRows[rowIndex];
  record(prefix + '.heatNumber', exactStringMatches(row.heatNumber, expectedRow.heatNumber), 'expected ' + expectedRow.heatNumber + ', got ' + row.heatNumber);
  if (expectedRow.quantity !== undefined) record(prefix + '.quantity', numberMatches(row.quantity, expectedRow.quantity), 'expected ' + JSON.stringify(expectedRow.quantity) + ', got ' + row.quantity);
  for (const field of ['product','dimensions']) {
    if (expectedRow[field] === undefined) continue;
    const ok = field === 'dimensions' ? dimensionsMatch(row[field], expectedRow[field]) : productMatches(row[field], expectedRow[field]);
    record(prefix + '.' + field, ok, 'expected ' + JSON.stringify(expectedRow[field]) + ', got ' + JSON.stringify(row[field]));
  }
  if (expectedRow.material !== undefined) {
    const materials = [row.werkstoff1,row.werkstoff2,row.werkstoff3,row.werkstoff4,row.werkstoff5].filter(value => value && value !== '-1');
    record(prefix + '.material', materials.some(value => exactStringMatches(value, expectedRow.material)), 'expected ' + JSON.stringify(expectedRow.material) + ', got ' + JSON.stringify(materials));
  }
  if (expectedRow.standards !== undefined) {
    const norms = [row.norm1,row.norm2,row.norm3,row.norm4,row.norm5].filter(value => value && value !== '-1').join(' / ');
    const standards = Array.isArray(expectedRow.standards) ? expectedRow.standards : [expectedRow.standards];
    for (let standardIndex = 0; standardIndex < standards.length; standardIndex++) {
      record(prefix + '.standards[' + standardIndex + ']', containsExpectedString(norms, standards[standardIndex]), 'expected ' + JSON.stringify(standards[standardIndex]) + ', got ' + JSON.stringify(norms));
    }
  }
  const expectedTests = Array.isArray(expectedRow.tensileTests) ? expectedRow.tensileTests : [];
  const actualTests = Array.isArray(row.tensileTests) ? row.tensileTests : [];
  recordTensile(prefix + '.tensileTests.length', actualTests.length === expectedTests.length, 'expected ' + expectedTests.length + ', got ' + actualTests.length);
  for (let testIndex = 0; testIndex < expectedTests.length; testIndex++) {
    const expectedTest = expectedTests[testIndex] ?? {};
    const actualTest = actualTests[testIndex] ?? {};
    const testPrefix = prefix + '.tensileTests[' + testIndex + ']';
    for (const field of ['sampleNumber','orientation','specimenLocation','specimenDimensions','sourceType']) {
      if (expectedTest[field] === undefined) continue;
      const matches = field === 'orientation'
        ? orientationMatches(actualTest[field], expectedTest[field])
        : field === 'specimenLocation'
          ? locationMatches(actualTest[field], expectedTest[field])
          : exactStringMatches(actualTest[field], expectedTest[field]);
      recordTensile(testPrefix + '.' + field, matches, 'expected ' + JSON.stringify(expectedTest[field]) + ', got ' + JSON.stringify(actualTest[field]));
    }
    for (const field of ['testTemperatureC','tensileStrengthMPa','reductionOfAreaPercent','sourcePage']) {
      if (expectedTest[field] === undefined) continue;
      recordTensile(testPrefix + '.' + field, numberMatches(actualTest[field], expectedTest[field]), 'expected ' + JSON.stringify(expectedTest[field]) + ', got ' + JSON.stringify(actualTest[field]));
    }
    const actualYields = Array.isArray(actualTest.yieldStrengths) ? actualTest.yieldStrengths : [];
    for (let yieldIndex = 0; yieldIndex < (expectedTest.yieldStrengths ?? []).length; yieldIndex++) {
      const expectedYield = expectedTest.yieldStrengths[yieldIndex];
      const actualYield = actualYields.find(measurement => normalizeString(measurement.type) === normalizeString(expectedYield.type));
      recordTensile(testPrefix + '.yieldStrengths.' + expectedYield.type, Boolean(actualYield) && numberMatches(actualYield.valueMPa, expectedYield.valueMPa), 'expected ' + JSON.stringify(expectedYield) + ', got ' + JSON.stringify(actualYields));
    }
    const actualElongations = Array.isArray(actualTest.elongations) ? actualTest.elongations : [];
    for (let elongationIndex = 0; elongationIndex < (expectedTest.elongations ?? []).length; elongationIndex++) {
      const expectedElongation = expectedTest.elongations[elongationIndex];
      const actualElongation = actualElongations.find(measurement => elongationTypeMatches(measurement.type, expectedElongation.type) && numberMatches(measurement.valuePercent, expectedElongation.valuePercent));
      recordTensile(testPrefix + '.elongations.' + expectedElongation.type, Boolean(actualElongation), 'expected ' + JSON.stringify(expectedElongation) + ', got ' + JSON.stringify(actualElongations));
      if (expectedElongation.gaugeLengthMm !== undefined && actualElongation) {
        recordTensile(testPrefix + '.elongations.' + expectedElongation.type + '.gaugeLengthMm', numberMatches(actualElongation.gaugeLengthMm, expectedElongation.gaugeLengthMm), 'expected ' + expectedElongation.gaugeLengthMm + ', got ' + actualElongation.gaugeLengthMm);
      }
    }
  }
  const actualChemicals = row.chemicals && typeof row.chemicals === 'object' && !Array.isArray(row.chemicals) ? row.chemicals : {};
  const actualChemicalEntries = Object.entries(actualChemicals);
  for (const [element, expectedValue] of Object.entries(expectedRow.chemicals ?? {})) {
    const actualEntry = actualChemicalEntries.find(([actualElement]) => String(actualElement).toUpperCase() === String(element).toUpperCase());
    const actualValue = actualEntry?.[1];
    recordChemistry(prefix + '.chemicals.' + element, chemicalNumberMatches(actualValue, expectedValue), 'expected ' + expectedValue + ', got ' + JSON.stringify(actualValue));
  }
}
if (checkedChemistryFacts === 0) recordChemistry('chemistryGroundTruth', false, 'no expected chemical measurements configured');
if (checkedTensileFacts === 0) recordTensile('tensileGroundTruth', false, 'no expected structured tensile tests configured');
record('rowCount', actualRows.length === expectedRows.length, 'expected ' + expectedRows.length + ', got ' + actualRows.length);
const correctness = checkedFacts ? matchedFacts.length / checkedFacts : 0;
const chemistryScore = checkedChemistryFacts ? matchedChemistryFacts.length / checkedChemistryFacts : 0;
const chemistryPassed = checkedChemistryFacts > 0 && missingOrWrongChemistryFacts.length === 0 ? 1 : 0;
const tensileScore = checkedTensileFacts ? matchedTensileFacts.length / checkedTensileFacts : 0;
const tensilePassed = checkedTensileFacts > 0 && missingOrWrongTensileFacts.length === 0 ? 1 : 0;
const baseScore = missingOrWrongFacts.length === 0 ? 5 : correctness >= 0.95 ? 4 : correctness >= 0.8 ? 3 : correctness >= 0.5 ? 2 : 1;
const score = chemistryPassed && tensilePassed ? baseScore : Math.min(baseScore, 3);
const passed = missingOrWrongFacts.length === 0 && chemistryPassed === 1 && tensilePassed === 1 ? 1 : 0;
const reasoning = passed ? 'All ' + checkedFacts + ' expected facts matched deterministically.' : missingOrWrongFacts.join('; ');
const chemistryReasoning = chemistryPassed ? 'All ' + checkedChemistryFacts + ' expected chemical measurements matched their heat.' : missingOrWrongChemistryFacts.join('; ');
const tensileReasoning = tensilePassed ? 'All ' + checkedTensileFacts + ' expected tensile-test facts remained paired per specimen.' : missingOrWrongTensileFacts.join('; ');
return [{ json: { actualAnswer, expectedAnswer, score, correctness, passed, reasoning, matchedFacts, missingOrWrongFacts, chemistryScore, chemistryPassed, chemistryReasoning, matchedChemistryFacts, missingOrWrongChemistryFacts, tensileScore, tensilePassed, tensileReasoning, matchedTensileFacts, missingOrWrongTensileFacts } }];`;
