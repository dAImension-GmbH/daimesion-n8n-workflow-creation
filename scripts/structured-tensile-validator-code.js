const structuredMechanicalCorrectionCode = String.raw`  const extendCreditorFromDeckHeader = () => {
    const current = String(row.creditor ?? '').trim();
    if (!current || current === '-1') return;
    const headerLines = String(criticalSource ?? '').slice(0, 5000)
      .replace(/<br\s*\/?\s*>/gi, '\n')
      .replace(/<[^>]+>/g, '\n')
      .replace(/&amp;/gi, '&')
      .replace(/&nbsp;|&#160;/gi, ' ')
      .split(/\n+/)
      .map((line) => line.replace(/\s+/g, ' ').trim())
      .filter(Boolean);
    const currentKey = canonicalEvidence(current);
    for (let index = 0; index + 1 < headerLines.length; index++) {
      const organization = headerLines[index];
      const descriptor = headerLines[index + 1];
      if (canonicalEvidence(organization) !== currentKey) continue;
      if (descriptor.length > 80 || /\d|str(?:asse|aße)|street|road|avenue|inspection|certificate|manufacturer|customer|report|phone|telefon|www\.|@/i.test(descriptor)) continue;
      if (!/[A-Za-zÄÖÜäöüß]/.test(descriptor)) continue;
      row.creditor = organization + ' ' + descriptor;
      return;
    }
  };
  extendCreditorFromDeckHeader();
  const correctLabeledDuplicatedCertificateSuffix = () => {
    const current = String(row.certificateNumber ?? '').replace(/\s+/g, '').trim();
    const match = current.match(/^W(\d{7})$/i);
    if (!match || match[1].at(-1) !== match[1].at(-2)) return;
    const labelWindow = String(criticalSource ?? '').match(/(?:ABNAHMEPRÜFZEUGNIS|INSPECTION\s+CERTIFICATE)[\s\S]{0,240}?(?:\bNR\.?|\bNO\.?:?)[\s\S]{0,80}?W\s*\d{7}/i);
    if (!labelWindow || canonicalEvidence(labelWindow[0]).indexOf(canonicalEvidence(current)) < 0) return;
    row.certificateNumber = current.slice(0, -1);
    row.humanRequired = true;
    row.identifierOcrCorrection = 'A duplicated terminal digit in an explicitly labeled W-certificate number was removed.';
  };
  correctLabeledDuplicatedCertificateSuffix();
  const normalizeMaterialSlots = () => {
    const slotNames = ['werkstoff1','werkstoff2','werkstoff3','werkstoff4','werkstoff5'];
    for (const slotName of slotNames) {
      const value = String(row[slotName] ?? '').trim();
      const withoutCategory = value.replace(/^(?:STEEL|STAHL)\s+/i, '').trim();
      if (/\d/.test(withoutCategory)) row[slotName] = withoutCategory;
    }
    const materialPair = String(criticalSource ?? '').match(/(?:MATERIAL|WERKSTOFF)[\s\S]{0,260}?([A-Z]{1,5}\s*\d+[A-Z0-9-]*)\s*\/\s*([A-Z]{1,5}\s*\d+[A-Z0-9-]*)/i);
    if (!materialPair) return;
    const pairKeys = materialPair.slice(1).map(canonicalEvidence);
    const firstIndex = slotNames.findIndex((slotName) => canonicalEvidence(row[slotName]) === pairKeys[0]);
    const secondIndex = slotNames.findIndex((slotName) => canonicalEvidence(row[slotName]) === pairKeys[1]);
    if (firstIndex < 0 || secondIndex < 0 || firstIndex === secondIndex) return;
    const normalizeGrade = (value) => String(value).replace(/\s+/g, '');
    row[slotNames[Math.min(firstIndex, secondIndex)]] = normalizeGrade(materialPair[1]) + '/' + normalizeGrade(materialPair[2]);
    row[slotNames[Math.max(firstIndex, secondIndex)]] = '-1';
  };
  normalizeMaterialSlots();
  const splitConcatenatedPair = (value, minimum, maximum) => {
    const text = decodeHtmlCell(value).replace(/\s+/g, '').replace(/,/g, '.');
    const direct = text.match(/^(\d+(?:\.\d+)?)\s*[|;/]\s*(\d+(?:\.\d+)?)$/);
    if (direct) {
      const values = direct.slice(1).map(Number);
      if (values.every((number) => Number.isFinite(number) && number >= minimum && number <= maximum)) return values;
    }
    const candidates = [];
    for (let index = 1; index < text.length; index++) {
      const leftText = text.slice(0, index);
      const rightText = text.slice(index);
      if (!/^\d{2,4}(?:\.\d{1,3})?$/.test(leftText) || !/^\d{2,4}(?:\.\d{1,3})?$/.test(rightText)) continue;
      const values = [Number(leftText), Number(rightText)];
      if (values.every((number) => Number.isFinite(number) && number >= minimum && number <= maximum)) {
        const decimalPenalty = Math.abs((leftText.split('.')[1]?.length ?? 0) - (rightText.split('.')[1]?.length ?? 0));
        const integerPenalty = Math.abs(leftText.split('.')[0].length - rightText.split('.')[0].length);
        candidates.push({ values, penalty: decimalPenalty * 10 + integerPenalty });
      }
    }
    candidates.sort((left, right) => left.penalty - right.penalty);
    return candidates[0]?.values ?? [];
  };
  const splitElongationValues = (value) => {
    const text = decodeHtmlCell(value).replace(/,/g, '.');
    return [...text.matchAll(/\d{1,3}(?:\.\d{1,2})?/g)]
      .map((match) => Number(match[0]))
      .filter((number) => Number.isFinite(number) && number > 0 && number <= 100);
  };
  const sourceExplicitMechanicalTests = (sourceText) => {
    const source = String(sourceText ?? '');
    const parsed = [];
    const cellNumber = (value) => {
      const match = decodeHtmlCell(value).replace(/,/g, '.').match(/-?\d+(?:\.\d+)?/);
      if (!match) return undefined;
      const number = Number(match[0]);
      return Number.isFinite(number) ? number : undefined;
    };
    const elongationHeaderType = (value) => {
      const raw = decodeHtmlCell(value).normalize('NFKD').replace(/\p{M}/gu, '').toUpperCase();
      const compact = raw.replace(/\s+/g, '');
      if (/50MM|G\.?L\.?50/.test(compact)) return '50MM';
      if (/A?2[\"”]|A?2IN(CH)?/.test(compact)) return '2IN';
      if (/A?4D/.test(compact)) return '4D';
      if (/A?5D|5[.,]?(?:65|85).*S(?:O|0)/.test(compact)) return '5D';
      if (/^A5(?:\[%\])?/.test(compact)) return 'A5';
      return null;
    };
    for (const tableMatch of source.matchAll(/<table\b[^>]*>[\s\S]*?<\/table>/gi)) {
      const grid = expandHtmlTable(tableMatch[0]).map((rowCells) => rowCells.map(decodeHtmlCell));
      const nearbyText = decodeHtmlCell(source.slice(Math.max(0, tableMatch.index - 4000), tableMatch.index + tableMatch[0].length + 4000));
      const orientationMatch = nearbyText.match(/(?:DIRECTION|ORIENTATION|RICHTUNG)[\s\S]{0,300}?\b(LONGITUDINAL|L[ÄA]NGS|LAENGS|TRANSVERSE|QUER)\b/i);
      const nearbyOrientation = orientationMatch ? (/TRANSVERSE|QUER/i.test(orientationMatch[1]) ? 'transverse' : 'longitudinal') : undefined;
      for (let headerIndex = 0; headerIndex < grid.length; headerIndex++) {
        const followingHeader = grid[headerIndex + 1] ?? [];
        const header = grid[headerIndex].map((cell, column) => [cell, followingHeader[column]].filter(Boolean).join(' '));
        const keys = header.map(canonicalEvidence);
        const columns = {
          heat: keys.findIndex((key) => /HEAT|COULEE|SCHMELZE/.test(key)),
          sample: keys.findIndex((key) => /SPECIMENNO|PROBENNR|SAMPLE(NO|NUMBER)|TESTPIECE|PRUFSTUCK/.test(key)),
          dimension: keys.findIndex((key) => /C10|SPECIMENDIMENSION|PROBENABM|ABMESSUNG/.test(key)),
          yield02: keys.findIndex((key) => /RP02|YS02|OFFSET02/.test(key)),
          yieldGeneric: keys.findIndex((key) => /REH|REL|YIELDPOINT|YIELDSTRENGTH|STRECKGRENZE/.test(key)),
          yield10: keys.findIndex((key) => /RP1(?:0|O)|YS10|OFFSET10/.test(key)),
          tensile: keys.findIndex((key) => /C12|^RM|TENSILESTRENGTH|ZUGFEST/.test(key)),
          reduction: keys.findIndex((key) => key === 'Z' || /REDOFAREA|REDUCTIONOFAREA/.test(key)),
        };
        const elongationColumns = header
          .map((cell, column) => ({ column, type: elongationHeaderType(cell) }))
          .filter((entry) => entry.type);
        const primaryYieldColumn = columns.yield02 >= 0 ? columns.yield02 : columns.yieldGeneric;
        if (columns.tensile < 0 || primaryYieldColumn < 0 || !elongationColumns.length) continue;
        const primaryYieldHeader = keys[primaryYieldColumn] ?? '';
        const primaryYieldType = columns.yield02 >= 0
          ? 'Rp0.2'
          : (/REH|YIELDPOINT|STRECKGRENZE/.test(primaryYieldHeader) ? 'ReH' : (/REL/.test(primaryYieldHeader) ? 'ReL' : 'Rp0.2'));
        for (const cells of grid.slice(headerIndex + 1)) {
          const sourceHeat = columns.heat < 0 ? '' : canonicalEvidence(cells[columns.heat]);
          const heatMatches = sourceHeat === heatKey
            || (sourceHeat.startsWith(heatKey) && /^\d+$/.test(sourceHeat.slice(heatKey.length)));
          if (columns.heat >= 0 && !heatMatches) continue;
          const tensileStrengthMPa = cellNumber(cells[columns.tensile]);
          const primaryYield = cellNumber(cells[primaryYieldColumn]);
          const yield10 = columns.yield10 < 0 ? undefined : cellNumber(cells[columns.yield10]);
          if (tensileStrengthMPa === undefined || primaryYield === undefined || primaryYield >= tensileStrengthMPa) continue;
          if (yield10 !== undefined && (yield10 < primaryYield || yield10 >= tensileStrengthMPa)) continue;
          const elongations = elongationColumns.flatMap(({ column, type }) => {
            const valuePercent = cellNumber(cells[column]);
            return valuePercent !== undefined && valuePercent > 0 && valuePercent <= 100 ? [{ type, valuePercent }] : [];
          });
          if (!elongations.length) continue;
          const sampleNumber = columns.sample < 0 ? '' : decodeHtmlCell(cells[columns.sample]).trim();
          const specimenDimensions = columns.dimension < 0 ? '' : decodeHtmlCell(cells[columns.dimension]).trim();
          const reductionOfAreaPercent = columns.reduction < 0 ? undefined : cellNumber(cells[columns.reduction]);
          parsed.push({
            ...(sampleNumber ? { sampleNumber } : {}),
            yieldStrengths: [
              { type: primaryYieldType, valueMPa: primaryYield },
              ...(yield10 === undefined ? [] : [{ type: 'Rp1.0', valueMPa: yield10 }]),
            ],
            tensileStrengthMPa,
            elongations,
            ...(nearbyOrientation ? { orientation: nearbyOrientation } : {}),
            ...(specimenDimensions ? { specimenDimensions } : {}),
            ...(reductionOfAreaPercent === undefined || reductionOfAreaPercent > 100 ? {} : { reductionOfAreaPercent }),
            _heatBound: columns.heat >= 0,
          });
        }
        break;
      }
    }
    return parsed;
  };
  const sourcePairedMechanicalTests = (sourceText) => {
    const source = String(sourceText ?? '');
    for (const tableMatch of source.matchAll(/<table\b[^>]*>[\s\S]*?<\/table>/gi)) {
      const tableHtml = tableMatch[0];
      const tableText = decodeHtmlCell(tableHtml);
      const tableKey = canonicalEvidence(tableText);
      if (!tableKey.includes('TENSILESTRENGTH') || !tableKey.includes('YIELDSTRENGTH') || !tableKey.includes('ELONGATION')) continue;
      const grid = expandHtmlTable(tableHtml);
      for (const rowCells of grid) {
        const cells = rowCells.map(decodeHtmlCell);
        for (let column = 0; column + 3 < cells.length; column++) {
          const tensilePair = splitConcatenatedPair(cells[column], 100, 2500);
          const yield02Pair = splitConcatenatedPair(cells[column + 1], 50, 2000);
          const yield10Pair = splitConcatenatedPair(cells[column + 2], 50, 2000);
          const elongationValues = splitElongationValues(cells[column + 3]);
          if (tensilePair.length !== 2 || yield02Pair.length !== 2 || yield10Pair.length !== 2 || elongationValues.length !== 4) continue;
          const plausible = [0, 1].every((index) => yield02Pair[index] < yield10Pair[index] && yield10Pair[index] < tensilePair[index]);
          if (!plausible) continue;
          const fullSectionContext = /\bFS\s*=\s*FULL\s*SECTION\b/i.test(tableText) || /FULL\s*SECTION/i.test(tableText);
          if (!fullSectionContext) continue;
          return [0, 1].map((index) => ({
            yieldStrengths: [
              { type: 'Rp0.2', valueMPa: yield02Pair[index] },
              { type: 'Rp1.0', valueMPa: yield10Pair[index] },
            ],
            tensileStrengthMPa: tensilePair[index],
            elongations: [
              { type: '50MM', valuePercent: elongationValues[index * 2] },
              { type: '5D', valuePercent: elongationValues[index * 2 + 1] },
            ],
            sourceType: 'product',
          }));
        }
      }
    }
    return [];
  };
  const sourceRecoveredTests = sourcePairedMechanicalTests(criticalSource);
  const sourceExplicitTests = sourceExplicitMechanicalTests(criticalSource);
  const modelTests = Array.isArray(row.tensileTests)
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
  const selectedTests = authoritativeEvidenceTests.length ? authoritativeEvidenceTests : modelTests;
  const yieldFromTest = (test, expectedType) => {
    const measurement = (Array.isArray(test?.yieldStrengths) ? test.yieldStrengths : []).find((entry) => {
      const key = canonicalEvidence(entry?.type);
      return expectedType === 'Rp0.2'
        ? ['RP02','02','YS02','REH','REL','YIELDPOINT','YIELDSTRENGTH','STRECKGRENZE'].includes(key)
        : ['RP10','RP1O','1','10','YS10'].includes(key);
    });
    return evidenceNumber(measurement?.valueMPa ?? measurement?.value ?? (expectedType === 'Rp0.2' ? test?.yieldStrength02 : test?.yieldStrength10));
  };
  const sameStrengthCore = (selected, candidate) => {
    const selectedRm = evidenceNumber(selected?.tensileStrengthMPa ?? selected?.tensileStrength);
    const selectedRp02 = yieldFromTest(selected, 'Rp0.2');
    const sourceRm = evidenceNumber(candidate?.tensileStrengthMPa ?? candidate?.tensileStrength);
    const sourceRp02 = yieldFromTest(candidate, 'Rp0.2');
    const selectedRp10 = yieldFromTest(selected, 'Rp1.0');
    const sourceRp10 = yieldFromTest(candidate, 'Rp1.0');
    return selectedRm !== null && selectedRp02 !== null && sourceRm === selectedRm && sourceRp02 === selectedRp02 && (selectedRp10 === null || sourceRp10 === selectedRp10);
  };
  const enrichWithExplicitSourceColumns = (inputTests) => {
    const enriched = inputTests.map((test) => {
    const selectedRm = evidenceNumber(test?.tensileStrengthMPa ?? test?.tensileStrength);
    const selectedSampleKey = canonicalEvidence(test?.sampleNumber ?? test?.specimenId);
    if (selectedRm === null) return test;
    const sourceTest = sourceExplicitTests.find((candidate) => {
      if (sameStrengthCore(test, candidate)) return true;
      const sourceRm = evidenceNumber(candidate?.tensileStrengthMPa ?? candidate?.tensileStrength);
      const sourceSampleKey = canonicalEvidence(candidate?.sampleNumber ?? candidate?.specimenId);
      return Boolean(selectedSampleKey) && sourceSampleKey === selectedSampleKey && sourceRm === selectedRm;
    });
    if (!sourceTest) return test;
    const elongations = Array.isArray(test.elongations) ? test.elongations.map((entry) => ({ ...entry })) : [];
    for (const measurement of sourceTest.elongations) {
      if (!elongations.some((entry) => canonicalEvidence(entry?.type) === canonicalEvidence(measurement.type) && evidenceNumber(entry?.valuePercent ?? entry?.value) === measurement.valuePercent)) {
        elongations.push({ ...measurement });
      }
    }
    const yieldStrengths = Array.isArray(test.yieldStrengths) ? test.yieldStrengths.map((entry) => ({ ...entry })) : [];
    for (const measurement of sourceTest.yieldStrengths) {
      const sourceType = canonicalEvidence(measurement?.type);
      const sourceValue = evidenceNumber(measurement?.valueMPa ?? measurement?.value);
      if (sourceType && sourceValue !== null && !yieldStrengths.some((entry) => canonicalEvidence(entry?.type) === sourceType && evidenceNumber(entry?.valueMPa ?? entry?.value) === sourceValue)) {
        yieldStrengths.push({ ...measurement });
      }
    }
    return { ...test, yieldStrengths, elongations };
    });
    for (const sourceTest of sourceExplicitTests) {
      if (sourceTest._heatBound && !enriched.some((test) => sameStrengthCore(test, sourceTest))) enriched.push(sourceTest);
    }
    return enriched;
  };
  const enrichWithSourceConfirmedModelYields = (inputTests) => {
    const tableRows = [...String(criticalSource ?? '').matchAll(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi)]
      .map((match) => decodeHtmlCell(match[0]));
    const rowContainsNumber = (text, expected) => {
      const number = evidenceNumber(expected);
      if (number === null) return false;
      return (String(text).replace(/,/g, '.').match(/-?\d+(?:\.\d+)?/g) ?? [])
        .map(Number)
        .some((candidate) => Number.isFinite(candidate) && Math.abs(candidate - number) <= 0.0001);
    };
    return inputTests.map((test) => {
      const sampleKey = canonicalEvidence(test?.sampleNumber ?? test?.specimenId);
      const tensileStrength = evidenceNumber(test?.tensileStrengthMPa ?? test?.tensileStrength);
      if (!sampleKey || tensileStrength === null) return test;
      const modelTest = modelTests.find((candidate) => {
        const candidateSampleKey = canonicalEvidence(candidate?.sampleNumber ?? candidate?.specimenId);
        const candidateTensileStrength = evidenceNumber(candidate?.tensileStrengthMPa ?? candidate?.tensileStrength);
        return candidateSampleKey === sampleKey && candidateTensileStrength === tensileStrength;
      });
      const modelYields = Array.isArray(modelTest?.yieldStrengths) ? modelTest.yieldStrengths : [];
      if (!modelYields.length) return test;
      const sourceRow = tableRows.find((rowText) => {
        if (!canonicalEvidence(rowText).includes(sampleKey) || !rowContainsNumber(rowText, tensileStrength)) return false;
        return modelYields.every((measurement) => rowContainsNumber(rowText, measurement?.valueMPa ?? measurement?.value));
      });
      if (!sourceRow) return test;
      const existingYields = Array.isArray(test?.yieldStrengths) ? test.yieldStrengths : [];
      const mergedYields = existingYields.map((measurement) => ({ ...measurement }));
      for (const measurement of modelYields) {
        const typeKey = canonicalEvidence(measurement?.type);
        const valueMPa = evidenceNumber(measurement?.valueMPa ?? measurement?.value);
        if (!typeKey || valueMPa === null) continue;
        if (!mergedYields.some((entry) => canonicalEvidence(entry?.type) === typeKey && evidenceNumber(entry?.valueMPa ?? entry?.value) === valueMPa)) {
          mergedYields.push({ ...measurement });
        }
      }
      return { ...test, yieldStrengths: mergedYields };
    });
  };
  let tests = sourceRecoveredTests.length
    ? sourceRecoveredTests
    : repairCollapsedPairedTests(enrichWithExplicitSourceColumns(enrichWithSourceConfirmedModelYields(selectedTests)));
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
    if (compact === 'A5') return 'A5';
    return canonicalEvidence(value) || 'A';
  };
  const mechanicsSourceText = String(criticalSource ?? '');
  const mechanicsSourceKey = canonicalEvidence(mechanicsSourceText);
  const explicitSourceGaugeTypes = new Set();
  if (/\b(?:I|L)[O0]\s*=\s*4D(?:[O0])?\b/i.test(mechanicsSourceText)) explicitSourceGaugeTypes.add('4D');
  if (/\b(?:I|L)[O0]\s*=\s*(?:5D(?:[O0])?|5[.,](?:65|85)\s*√?\s*S[O0])\b/i.test(mechanicsSourceText)) explicitSourceGaugeTypes.add('5D');
  if (/\b(?:I|L)[O0]\s*=\s*50\s*MM\b/i.test(mechanicsSourceText)) explicitSourceGaugeTypes.add('50MM');
  const soleSourceGaugeType = explicitSourceGaugeTypes.size === 1 ? [...explicitSourceGaugeTypes][0] : undefined;
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
      const typeKey = canonicalEvidence(type);
      let normalizedType = gaugeLengthMm === 50 && ['A50','50MM','GL50'].includes(typeKey) ? '50MM' : canonicalElongationType(type);
      if (soleSourceGaugeType && ['A','ELONGATION','PERCENTELONGATION'].includes(typeKey)) normalizedType = soleSourceGaugeType;
      const normalized = { type: normalizedType, valuePercent, ...(gaugeLengthMm === undefined ? {} : { gaugeLengthMm }) };
      if (!elongations.some((entry) => canonicalEvidence(entry.type) === canonicalEvidence(normalizedType) && entry.valuePercent === valuePercent)) elongations.push(normalized);
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
    const rawSpecimenLocation = optionalString(test.specimenLocation);
    const specimenLocation = rawSpecimenLocation?.replace(/^(?:at|bei)\s+/i, '').trim();
    const rawSpecimenDimensions = optionalString(test.specimenDimensions ?? test.specimenDimension);
    const normalizeSpecimenDimensions = (value) => {
      if (!value) return undefined;
      const normalized = value.replace(/(\d),(\d)/g, '$1.$2').replace(/\s*[x×]\s*/gi, ' x ').replace(/\s+/g, ' ').trim();
      const pair = normalized.match(/([Ø⌀]?\s*\d+(?:\.\d+)?)\s+x\s+(\d+(?:\.\d+)?)/i);
      if (pair) return pair[1].trim() + ' x ' + pair[2] + ' mm';
      const sizeAndArea = normalized.match(/(?:SIZE\s*)?([Ø⌀]?\s*\d+(?:\.\d+)?)\s*MM[\s,;/-]*(?:(?:AREA|FLÄCHE|FLAECHE)\s*)?(\d+(?:\.\d+)?)\s*MM(?:2|²)/i);
      if (sizeAndArea) return sizeAndArea[1].trim() + ' mm / ' + sizeAndArea[2] + ' mm2';
      if (/(?:mm|cm|µm|inch|\bin\b|[\"”])/i.test(normalized)) return normalized;
      if (/^[Ø⌀]?\s*\d+(?:\.\d+)?(?:\s*[x×]\s*\d+(?:\.\d+)?)*$/i.test(normalized)) return normalized + ' mm';
      return normalized;
    };
    const specimenDimensions = normalizeSpecimenDimensions(rawSpecimenDimensions);
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
  const endMarker = "  return row;\n};";
  const correctionStart = code.indexOf("const correctCertificateRow =");
  const startMarkers = ["  const extendCreditorFromDeckHeader = ", "  const modelTests = "];
  const starts = startMarkers.map((marker) => code.indexOf(marker, correctionStart)).filter((index) => index >= 0);
  const start = starts.length ? Math.min(...starts) : -1;
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
