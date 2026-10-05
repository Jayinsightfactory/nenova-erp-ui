function fallbackNormalize(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^0-9a-z가-힣]/g, '');
}

function normalizeUnit(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (/^(box|boxes|박스)$/.test(raw)) return '박스';
  if (/^(bunch|bunches|단)$/.test(raw)) return '단';
  if (/^(steam|stem|stems|송이|스팀|스템)$/.test(raw)) return '송이';
  return String(value || '').trim();
}

export function parseBaseStockQuantityLine(value) {
  const cleaned = String(value || '').trim().replace(/^[-*•]\s*/, '').replace(/\s*\([^()]*\)\s*$/, '').trim();
  const mixed = cleaned.match(/^(.+?)[\s:：]*(\d+(?:\.\d+)?)\s*(?:박스)?\s*\+\s*(\d+(?:\.\d+)?)\s*(스팀|송이|단|개|stem|stems|bunch|ea)$/i);
  if (mixed) {
    const boxQty = Number(mixed[2]);
    const detailQty = Number(mixed[3]);
    return {
      name: mixed[1].trim(),
      qty: boxQty,
      boxQty,
      detailQty,
      detailUnit: mixed[4],
      unit: '박스',
    };
  }
  const match = cleaned.match(/^(.+?)[\s:：]*(-?\d+(?:\.\d+)?)\s*(박스|단|송이|개)?$/);
  if (!match) return null;
  const qty = Number(match[2]);
  if (!match[1].trim() || !Number.isFinite(qty)) return null;
  return { name: match[1].trim(), qty, unit: match[3] || '' };
}

export function chooseStockProductCandidate(scoredCandidates, isManagedProduct) {
  const scored = scoredCandidates || [];
  const managed = scored.filter(candidate => isManagedProduct(candidate.prod));
  const pool = managed.length > 0 ? managed : scored;
  if (pool.length === 1) {
    return { prod: pool[0].prod, matchStatus: managed.length === 1 ? 'auto' : 'outside' };
  }
  if (pool.length > 1) {
    return { prod: null, matchStatus: 'ambiguous', candidates: pool.slice(0, 8).map(candidate => candidate.prod) };
  }
  return { prod: null, matchStatus: 'unmatched', candidates: scored.slice(0, 5).map(candidate => candidate.prod) };
}

export function formatStockVector(mainQty, detailQty, mainUnit = '', detailUnit = '') {
  const parts = [];
  const main = Number(mainQty);
  if (Number.isFinite(main)) parts.push(`${main}${mainUnit || ''}`);
  const detail = Number(detailQty);
  if (detailUnit && Number.isFinite(detail)) parts.push(`${detail}${detailUnit}`);
  return parts.length ? parts.join(' + ') : '미계산';
}

export function formatStockDelta(mainQty, detailQty, mainUnit = '', detailUnit = '', sign = '+') {
  const parts = [];
  if (Number(mainQty) > 0) parts.push(`${sign}${Number(mainQty)}${mainUnit || ''}`);
  if (detailUnit && Number(detailQty) > 0) parts.push(`${sign}${Number(detailQty)}${detailUnit}`);
  return parts.length ? parts.join(' ') : `0${mainUnit || ''}`;
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
    const mainUnitLabel = String(row.baseUnit || row.unit || previous?.unit || '').trim();
    const detailUnitLabel = String(row.detailUnit || previous?.detailUnit || '').trim();
    const mainUnit = normalizeUnit(mainUnitLabel);
    const detailUnit = normalizeUnit(detailUnitLabel);
    const mainDelta = () => changes.reduce((sum, change) => {
      const unit = normalizeUnit(change.unit || row.unit || mainUnit);
      if (detailUnit && unit === detailUnit) return sum;
      if (unit && mainUnit && unit !== mainUnit) return sum;
      return sum + (Number(change.delta) || 0);
    }, 0);
    const detailDelta = () => changes.reduce((sum, change) => {
      const unit = normalizeUnit(change.unit || row.unit || mainUnit);
      return unit === detailUnit && detailUnit ? sum + (Number(change.delta) || 0) : sum;
    }, 0);
    const mainChange = mainDelta();
    const detailChange = detailDelta();
    const start = previous ? previous.start : Number(row.baseStart ?? row.start ?? 0);
    const startDetail = previous ? previous.startDetail : (row.baseDetailQty == null ? null : Number(row.baseDetailQty));
    const totalCancelled = Number(previous?.cancelled || 0) + Math.max(0, -mainChange);
    const totalAdded = Number(previous?.added || 0) + Math.max(0, mainChange);
    const totalCancelledDetail = Number(previous?.cancelledDetail || 0) + Math.max(0, -detailChange);
    const totalAddedDetail = Number(previous?.addedDetail || 0) + Math.max(0, detailChange);
    const expected = start + totalCancelled - totalAdded;
    const expectedDetail = startDetail == null ? null : startDetail + totalCancelledDetail - totalAddedDetail;
    const warnings = [...new Set([...(previous?.warnings || []), ...(row.warnings || [])])];
    const unresolved = (!row.match?.prodKey && !previous?.prodKey)
      || warnings.some(w => /후보|매칭|품목 선택|기초재고 없음|단위 확인|세부단위 불일치/.test(w));
    if (unresolved && !warnings.some(w => /후보|매칭|품목 선택/.test(w))) warnings.push('품목·기초재고·단위 확인 후 계산할 수 있습니다.');
    summaries.set(key, {
      identityKey: key,
      prodKey: row.match?.prodKey || previous?.prodKey || null,
      // The stock list is an input ledger: preserve the user's base-stock text as its label.
      // DB Product names remain matching metadata and must not replace the visible source name.
      productName: row.baseInputName || previous?.productName || row.productName,
      inputNames: [...new Set([...(previous?.inputNames || []), row.productName].filter(Boolean))],
      unit: mainUnitLabel,
      detailUnit: detailUnitLabel,
      start,
      startDetail,
      cancelled: totalCancelled,
      added: totalAdded,
      expected,
      cancelledDetail: totalCancelledDetail,
      addedDetail: totalAddedDetail,
      expectedDetail,
      unresolved,
      warnings,
    });
  }
  return [...summaries.values()];
}
