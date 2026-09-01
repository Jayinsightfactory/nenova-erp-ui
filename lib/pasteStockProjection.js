function fallbackNormalize(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^0-9a-z가-힣]/g, '');
}

export function resolveStockProjectionIdentity(name, resolvedMatches, normalize = fallbackNormalize) {
  const normalizedName = normalize(name);
  const match = normalizedName ? resolvedMatches?.get(normalizedName) : null;
  const prodKey = Number(match?.prodKey);
  return {
    key: Number.isInteger(prodKey) && prodKey > 0 ? `prod:${prodKey}` : `name:${normalizedName}`,
    normalizedName,
    prodKey: Number.isInteger(prodKey) && prodKey > 0 ? prodKey : null,
    match: match || null,
  };
}

export function summarizeStockProjection(historyRows = []) {
  const summaries = new Map();
  for (const row of historyRows) {
    const key = row.identityKey || `name:${fallbackNormalize(row.productName)}`;
    const previous = summaries.get(key);
    const changes = row.changes || [];
    const cancelled = changes.reduce(
      (sum, change) => sum + (Number(change.delta) < 0 ? Math.abs(Number(change.delta)) : 0),
      0,
    );
    const added = changes.reduce(
      (sum, change) => sum + (Number(change.delta) > 0 ? Number(change.delta) : 0),
      0,
    );
    const start = previous ? previous.start : Number(row.start || 0);
    const totalCancelled = Number(previous?.cancelled || 0) + cancelled;
    const totalAdded = Number(previous?.added || 0) + added;
    const expected = start + totalCancelled - totalAdded;
    summaries.set(key, {
      identityKey: key,
      prodKey: row.match?.prodKey || previous?.prodKey || null,
      productName: row.match?.names?.[0] || previous?.productName || row.productName,
      inputNames: [...new Set([...(previous?.inputNames || []), row.productName].filter(Boolean))],
      unit: row.unit || previous?.unit || '',
      start,
      cancelled: totalCancelled,
      added: totalAdded,
      expected,
      warnings: [...new Set([...(previous?.warnings || []), ...(row.warnings || [])])],
    });
  }
  return [...summaries.values()];
}
