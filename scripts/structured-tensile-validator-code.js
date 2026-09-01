const structuredMechanicalCorrectionCode = String.raw`  const modelTests = Array.isArray(row.tensileTests)
    ? row.tensileTests
    : (Array.isArray(row.mechanicalSelection?.tests) ? row.mechanicalSelection.tests : []);
  const tensileHeatsForChunk = (chunk) => [
    ...(Array.isArray(chunk?.heats) ? chunk.heats : []),
    ...(Array.isArray(chunk?.certificate?.heats) ? chunk.certificate.heats : []),
  ];
  const evidenceTests = chunks.flatMap((chunk, chunkIndex) => {
    const role = canonicalEvidence(chunk?.certificate?.documentRole);
    const inferredSourceType = role === 'RAWMATERIAL' ? 'base-material' : 'product';
    return tensileHeatsForChunk(chunk)
      .filter((heat) => canonicalEvidence(heat?.heatNumber) === heatKey)
      .flatMap((heat) => (Array.isArray(heat.tensileTests) ? heat.tensileTests : []).map((test) => ({ ...test, _chunkIndex: chunkIndex, _sourceType: inferredSourceType })));
  });
  const baseMaterialEvidenceTests = evidenceTests.filter((test) => test._sourceType === 'base-material');
  const authoritativeEvidenceTests = baseMaterialEvidenceTests.length ? baseMaterialEvidenceTests : evidenceTests;
  let tests = repairCollapsedPairedTests(authoritativeEvidenceTests.length ? authoritativeEvidenceTests : modelTests);
  const optionalString = (value) => {
    const text = String(evidenceValue(value) ?? '').trim();
    return text && text !== '-1' && text.toLowerCase() !== 'null' ? text : undefined;
  };
  const optionalNumber = (value) => {
    const number = evidenceNumber(value);
    return number === null ? undefined : number;
  };
  const optionalSignedNumber = (value) => {
    const raw = evidenceValue(value);
    if (raw === null || raw === undefined || String(raw).trim() === '') return undefined;
    const number = Number(String(raw).trim().replace(',', '.').replace(/\s*°?C$/i, ''));
    return Number.isFinite(number) ? number : undefined;
  };
  const yieldType = (value) => {
    const key = canonicalEvidence(value);
    if (key === 'RP02' || key === '02' || key === 'YS02') return 'Rp0.2';
    if (key === 'RP10' || key === '1' || key === '10' || key === 'YS10') return 'Rp1.0';
    if (key === 'REH') return 'ReH';
    if (['YIELDSTRENGTH','YIELDPOINT','STRECKGRENZE','YS'].includes(key)) return sourceHasExplicitRp02 ? 'Rp0.2' : 'ReH';
    if (key === 'REL') return 'ReL';
    return null;
  };
  const legacyElongationType = (test) => {
    const explicit = optionalString(test.gaugeLengthType ?? test.elongationColumnType ?? test.elongationType);
    if (explicit && !['OTHER', 'UNKNOWN', 'PRIMARY', 'SECONDARY'].includes(explicit.toUpperCase())) return explicit.toUpperCase();
    return gaugeType(test) === 'UNKNOWN' ? 'A' : gaugeType(test);
  };
  const canonicalElongationType = (value) => {
    const raw = String(value ?? '').normalize('NFKD').replace(/\p{M}/gu, '').toUpperCase().replace(/,/g, '.');
    const compact = raw.replace(/\s+/g, '');
    if (/50MM|50M M|G\.L\.?50/.test(raw) || /50MM/.test(compact)) return '50MM';
    if (/A?2["”]|2IN(CH)?/.test(compact) && !/5D/.test(compact)) return '2IN';
    if (/A?4D|4D/.test(compact)) return '4D';
    if (/A?5D|5D|5[.,]?6?5|5[.,]?8?5/.test(compact)) return '5D';
    if (compact === 'A5') return '5D';
    return canonicalEvidence(value) || 'A';
  };
  const mechanicsSourceText = String(criticalSource ?? '');
  const mechanicsSourceKey = canonicalEvidence(mechanicsSourceText);
  const sourceHasExplicitRp02 = mechanicsSourceKey.includes('RP02') || mechanicsSourceKey.includes('OFFSET02') || /0\s*[.,]\s*2\s*%/i.test(mechanicsSourceText);
  const sourceUsesGenericYieldPoint = /YIELD\s*POINT|STRECKGRENZE/i.test(mechanicsSourceText);
  const normalizeTest = (test) => {
    const yieldStrengths = [];
    for (const measurement of Array.isArray(test.yieldStrengths) ? test.yieldStrengths : []) {
      const type = yieldType(measurement?.type);
      const valueMPa = optionalNumber(measurement?.valueMPa ?? measurement?.value);
      if (type && valueMPa !== undefined && !yieldStrengths.some((entry) => entry.type === type)) yieldStrengths.push({ type, valueMPa });
    }
    const legacyYield02 = optionalNumber(test.yieldStrength02);
    const legacyYield10 = optionalNumber(test.yieldStrength10);
    if (legacyYield02 !== undefined && !yieldStrengths.some((entry) => entry.type === 'Rp0.2')) yieldStrengths.push({ type: 'Rp0.2', valueMPa: legacyYield02 });
    if (legacyYield10 !== undefined && (test.yieldStrength10Explicit === true || /RP\s*1(?:[.,]0)?|1\s*%/i.test(String(test.columnHeaders ?? test.sourceQuote ?? ''))) && !yieldStrengths.some((entry) => entry.type === 'Rp1.0')) yieldStrengths.push({ type: 'Rp1.0', valueMPa: legacyYield10 });
    if (!sourceHasExplicitRp02 && sourceUsesGenericYieldPoint) {
      for (const measurement of yieldStrengths) if (measurement.type === 'Rp0.2') measurement.type = 'ReH';
      for (let index = yieldStrengths.length - 1; index >= 0; index--) {
        if (yieldStrengths.findIndex(entry => entry.type === yieldStrengths[index].type && entry.valueMPa === yieldStrengths[index].valueMPa) !== index) yieldStrengths.splice(index, 1);
      }
    }
    const elongations = [];
    for (const measurement of Array.isArray(test.elongations) ? test.elongations : []) {
      const type = optionalString(measurement?.type);
      const valuePercent = optionalNumber(measurement?.valuePercent ?? measurement?.value);
      const gaugeLengthMm = optionalNumber(measurement?.gaugeLengthMm);
      if (!type || valuePercent === undefined) continue;
      const normalized = { type, valuePercent, ...(gaugeLengthMm === undefined ? {} : { gaugeLengthMm }) };
      if (!elongations.some((entry) => canonicalEvidence(entry.type) === canonicalEvidence(type) && entry.valuePercent === valuePercent)) elongations.push(normalized);
    }
    if (!elongations.length) {
      for (const [value, type] of [[test.elongation, legacyElongationType(test)], [test.elongationA5, 'A5'], [test.elongationA4, 'A4']]) {
        const valuePercent = optionalNumber(value);
        if (valuePercent !== undefined && !elongations.some((entry) => canonicalEvidence(entry.type) === canonicalEvidence(type) && entry.valuePercent === valuePercent)) elongations.push({ type, valuePercent });
      }
    }
    const tensileStrengthMPa = optionalNumber(test.tensileStrengthMPa ?? test.tensileStrength);
    const sampleNumber = optionalString(test.sampleNumber ?? test.specimenId);
    const testTemperatureC = optionalSignedNumber(test.testTemperatureC ?? test.temperatureC);
    const reductionOfAreaPercent = optionalNumber(test.reductionOfAreaPercent ?? test.reductionOfArea);
    const orientation = optionalString(test.orientation);
    const specimenLocation = optionalString(test.specimenLocation);
    const specimenDimensions = optionalString(test.specimenDimensions ?? test.specimenDimension);
    const rawSourcePage = optionalNumber(test.sourcePage);
    const sourcePage = rawSourcePage === undefined ? undefined : Math.max(1, Math.round(rawSourcePage));
    const rawSourceType = optionalString(test.sourceType ?? test._sourceType);
    const sourceTypeKey = String(rawSourceType ?? '').toLowerCase().replace(/[_\s]+/g, '-');
    const sourceType = ['product', 'base-material', 'retest'].includes(sourceTypeKey) ? sourceTypeKey : undefined;
    const normalized = {
      ...(sampleNumber === undefined ? {} : { sampleNumber }),
      ...(testTemperatureC === undefined ? {} : { testTemperatureC }),
      yieldStrengths,
      ...(tensileStrengthMPa === undefined ? {} : { tensileStrengthMPa }),
      elongations,
      ...(reductionOfAreaPercent === undefined || reductionOfAreaPercent > 100 ? {} : { reductionOfAreaPercent }),
      ...(orientation === undefined ? {} : { orientation }),
      ...(specimenLocation === undefined ? {} : { specimenLocation }),
      ...(specimenDimensions === undefined ? {} : { specimenDimensions }),
      ...(sourcePage === undefined ? {} : { sourcePage }),
      ...(sourceType === undefined ? {} : { sourceType }),
    };
    const rp02 = normalized.yieldStrengths.find((measurement) => measurement.type === 'Rp0.2');
    const rp10 = normalized.yieldStrengths.find((measurement) => measurement.type === 'Rp1.0');
    if (rp02 && rp10 && rp10.valueMPa < rp02.valueMPa) {
      normalized.yieldStrengths = normalized.yieldStrengths.filter((measurement) => measurement !== rp10);
      row.humanRequired = true;
      row.mechanicalValidationError = 'Rp1.0 is lower than Rp0.2 within one tensile test; Rp1.0 was withheld for review.';
    }
    if (normalized.tensileStrengthMPa !== undefined && normalized.yieldStrengths.some((measurement) => measurement.valueMPa > normalized.tensileStrengthMPa)) {
      delete normalized.tensileStrengthMPa;
      row.humanRequired = true;
      row.mechanicalValidationError = 'A yield-strength value exceeds Rm within one tensile test; Rm was withheld for review.';
    }
    return normalized;
  };
  const normalizedCandidates = tests.map(normalizeTest).filter((test) => test.yieldStrengths.length || test.tensileStrengthMPa !== undefined || test.elongations.length || test.reductionOfAreaPercent !== undefined);
  const normalizedTests = [];
  const normalizedTestIndexes = new Map();
  for (const test of normalizedCandidates) {
    const key = JSON.stringify([
      test.testTemperatureC ?? null,
      [...test.yieldStrengths].sort((a, b) => a.type.localeCompare(b.type)).map((measurement) => [measurement.type, measurement.valueMPa]),
      test.tensileStrengthMPa ?? null,
      [...test.elongations].map((measurement) => [measurement.valuePercent, measurement.gaugeLengthMm ?? null]).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
      test.reductionOfAreaPercent ?? null,
    ]);
    const existingIndex = normalizedTestIndexes.get(key);
    if (existingIndex === undefined) {
      normalizedTestIndexes.set(key, normalizedTests.length);
      normalizedTests.push(test);
      continue;
    }
    const existing = normalizedTests[existingIndex];
    for (const field of ['sampleNumber','orientation','specimenLocation','specimenDimensions','sourcePage','sourceType']) {
      if (existing[field] === undefined && test[field] !== undefined) existing[field] = test[field];
    }
  }
  const consolidatedTests = [];
  const consolidatedTestIndexes = new Map();
  const elongationValues = test => new Set(test.elongations.map(measurement => measurement.valuePercent));
  const isSubset = (left, right) => [...left].every(value => right.has(value));
  for (const test of normalizedTests) {
    const coreKey = JSON.stringify([
      canonicalEvidence(test.sampleNumber) || null,
      test.testTemperatureC ?? null,
      [...test.yieldStrengths].sort((a, b) => a.type.localeCompare(b.type)).map(measurement => [measurement.type, measurement.valueMPa]),
      test.tensileStrengthMPa ?? null,
      test.reductionOfAreaPercent ?? null,
    ]);
    const existingIndex = consolidatedTestIndexes.get(coreKey);
    if (existingIndex === undefined) {
      consolidatedTestIndexes.set(coreKey, consolidatedTests.length);
      consolidatedTests.push(test);
      continue;
    }
    const existing = consolidatedTests[existingIndex];
    const existingValues = elongationValues(existing);
    const candidateValues = elongationValues(test);
    let retained = existing;
    let discarded = test;
    if (candidateValues.size < existingValues.size && isSubset(candidateValues, existingValues)) {
      retained = test;
      discarded = existing;
      consolidatedTests[existingIndex] = retained;
    } else if (!isSubset(existingValues, candidateValues) && !isSubset(candidateValues, existingValues)) {
      for (const measurement of test.elongations) {
        if (!retained.elongations.some(entry => entry.valuePercent === measurement.valuePercent && (entry.gaugeLengthMm ?? null) === (measurement.gaugeLengthMm ?? null))) retained.elongations.push(measurement);
      }
    }
    for (const field of ['sampleNumber','orientation','specimenLocation','specimenDimensions','sourcePage','sourceType']) {
      if (retained[field] === undefined && discarded[field] !== undefined) retained[field] = discarded[field];
    }
  }
  if (consolidatedTests.length > 12) row.humanRequired = true;
  row.tensileTests = consolidatedTests.slice(0, 12);
  if (!row.tensileTests.length) row.tensileTests = [{ yieldStrengths: [], elongations: [] }];
  const yieldValues = (type) => row.tensileTests.flatMap((test) => test.yieldStrengths.filter((measurement) => measurement.type === type).map((measurement) => measurement.valueMPa));
  const tensileValues = row.tensileTests.map((test) => test.tensileStrengthMPa).filter((value) => value !== undefined);
  const preferredElongations = row.tensileTests.flatMap((test) => test.elongations.slice(0, 1).map((measurement) => measurement.valuePercent));
  const yield02Values = yieldValues('Rp0.2').concat(yieldValues('ReH'), yieldValues('ReL'));
  const yield10Values = yieldValues('Rp1.0');
  row.yieldStrength02 = yield02Values.length ? Math.min(...yield02Values) : -1;
  row.yieldStrength10 = yield10Values.length ? Math.min(...yield10Values) : -1;
  row.tensileStrength = tensileValues.length ? Math.min(...tensileValues) : -1;
  row.elongation = preferredElongations.length ? Math.min(...preferredElongations) : -1;
  return row;
};`;

export function applyStructuredTensileValidatorCode(code) {
  if (typeof code !== "string") throw new TypeError("Final validator code must be a string");
  const startMarker = "  const modelTests = ";
  const endMarker = "  return row;\n};";
  const start = code.indexOf(startMarker, code.indexOf("const correctCertificateRow ="));
  const end = start < 0 ? -1 : code.indexOf(endMarker, start);
  if (start < 0 || end < 0) throw new Error("Final validator mechanical correction block is missing");
  const updated = code.slice(0, start) + structuredMechanicalCorrectionCode + code.slice(end + endMarker.length);
  return updated.replace(
    "heatNumber: toString(row.heatNumber), chemicals, yieldStrength02:",
    "heatNumber: toString(row.heatNumber), chemicals, tensileTests: row.tensileTests, yieldStrength02:",
  ).replace(
    "heatNumber: toString(row.heatNumber), chemicals, tensileTests: row.tensileTests, tensileTests: row.tensileTests, yieldStrength02:",
    "heatNumber: toString(row.heatNumber), chemicals, tensileTests: row.tensileTests, yieldStrength02:",
  );
}
