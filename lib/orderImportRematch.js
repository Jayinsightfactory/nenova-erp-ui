import { buildOrderImportMatchName } from './orderImportParse.js';
import { matchImportRows } from './orderImportMatch.js';

// Older drafts omitted matchName, but retained the original category/detail label.
export function restoreImportMatchContext(row) {
  return {
    ...row,
    matchName: row.matchName || buildOrderImportMatchName(row.category || row.detailLabel || '', row.inputName, ''),
  };
}

export function reapplyImportSavedMappings(items, context) {
  const source = items.map(restoreImportMatchContext);
  const matches = matchImportRows(source, { ...context, savedOnly: true });
  let restoredCount = 0;
  const next = source.map((row, index) => {
    const match = matches[index];
    // Recovery uses only existing reviewed exact aliases, never a new fuzzy guess.
    if (row.skip || !match.fromMapping || !match.mappingManual
      || !['exact', 'compact'].includes(match.mappingMatchType)) return row;
    if (Number(row.prodKey) !== Number(match.prodKey)) restoredCount += 1;
    return {
      ...row,
      prodKey: match.prodKey, prodName: match.prodName, displayName: match.displayName,
      flowerName: match.flowerName, counName: match.counName,
      fromMapping: true, mappingManual: true, mappingScope: match.mappingScope,
      mappingMatchType: match.mappingMatchType, mappingMatchKey: match.mappingMatchKey,
      confidence: match.confidence, confidenceLabel: match.confidenceLabel,
    };
  });
  return { items: next, restoredCount };
}
