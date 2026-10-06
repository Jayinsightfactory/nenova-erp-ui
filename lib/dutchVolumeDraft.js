export const DUTCH_DRAFT_VERSION = 3;
export const DUTCH_DRAFT_CURRENCY = 'KRW';
export const DUTCH_DRAFT_PREFIX = 'nenova.dutch-volume-krw.v3:';

// A content identity, not merely filename/mtime: an old saved mapping must not
// override a different workbook that reuses the same cell addresses.
export function dutchSourceIdentity(base, entries, year, week) {
  const source = JSON.stringify((entries || []).map(row => row.sourceCustKey
    ? [row.id, row.product, row.color, row.sourceColor || '', row.customer, row.quantity, row.layoutVersion || 2, `source-customer:${row.sourceCustKey}`]
    : [row.id, row.product, row.color, row.sourceColor || '', row.customer, row.quantity, row.layoutVersion || 2]));
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) hash = Math.imul(hash ^ source.charCodeAt(index), 16777619) >>> 0;
  return `${base}:schema3:${year}:${week}:${source.length}:${hash.toString(16)}`;
}

export function readDutchDraft(storage, identity, sourceEntries, migratePrices) {
  const current = safeParse(storage?.getItem(`${DUTCH_DRAFT_PREFIX}${identity}`));
  if (current?.version === DUTCH_DRAFT_VERSION && current.currency === DUTCH_DRAFT_CURRENCY) {
    const byId = new Map((current.entries || []).map(entry => [entry.id, entry]));
    const entries = sourceEntries.map(entry => {
      const saved = byId.get(entry.id);
      if (!saved) return entry;
      const next = { ...entry };
      for (const field of ['quantity', 'unit', 'prodKey', 'custKey']) {
        if (Object.prototype.hasOwnProperty.call(saved, field)) next[field] = saved[field];
      }
      if (Number(saved.prodKey) > 0) next.product = String(saved.product || entry.product);
      if (Number(saved.custKey) > 0) next.customer = String(saved.customer || entry.customer);
      return next;
    });
    for (const entry of current.entries || []) {
      if ((entry.added || entry.sourceCellDraft) && !entries.some(row => row.id === entry.id)) entries.push(entry);
    }
    return { entries, prices: current.prices || {}, dayEdits: current.dayEdits || {}, legacyCurrency: '' };
  }
  const oldIdentity = identity.split(':schema3:')[0];
  const previous = safeParse(storage?.getItem(`nenova.dutch-volume-krw.v2:${oldIdentity}`));
  if (previous) return { entries: sourceEntries, prices: {}, dayEdits: {}, legacyCurrency: '', draftReset: true };
  const legacy = safeParse(storage?.getItem(`nenova.dutch-volume-prices.v1:${oldIdentity}`));
  // Only explicitly KRW-labelled legacy values are safe to carry over.
  const prices = legacy?.currency === 'KRW' ? migratePrices(sourceEntries, legacy.prices || {}) : {};
  return { entries: sourceEntries, prices, dayEdits: {}, legacyCurrency: legacy && legacy.currency !== 'KRW' ? (legacy.currency || 'UNKNOWN') : '' };
}

export function writeDutchDraft(storage, identity, entries, prices, dayEdits = {}) {
  if (!identity) return;
  storage?.setItem(`${DUTCH_DRAFT_PREFIX}${identity}`, JSON.stringify({ version: DUTCH_DRAFT_VERSION, currency: DUTCH_DRAFT_CURRENCY, entries, prices, dayEdits }));
}

function safeParse(raw) {
  try { return raw ? JSON.parse(raw) : null; } catch { return null; }
}

export function buildDutchPreviewEntries(entries, prices, priceKey) {
  return (entries || []).map(entry => {
    const quantity = Number(entry.quantity);
    if (entry.quantity === '' || !Number.isFinite(quantity) || quantity < 0) throw new Error(`${entry.product || '추가행'} / ${entry.customer || '업체 미선택'}: 수량은 0 이상의 숫자여야 합니다.`);
    const priceValue = prices?.[priceKey(entry)];
    const result = {
      id: entry.id, product: String(entry.product || '').trim(), color: String(entry.color || '').trim(),
      customer: String(entry.customer || '').trim(), quantity, unit: String(entry.unit || '').trim(),
    };
    if (Number(entry.custKey || entry.sourceCustKey) > 0) result.custKey = Number(entry.custKey || entry.sourceCustKey);
    if (Number(entry.prodKey) > 0) result.prodKey = Number(entry.prodKey);
    if (priceValue !== '' && priceValue !== null && priceValue !== undefined) {
      const unitPrice = Number(priceValue);
      if (!Number.isFinite(unitPrice) || unitPrice < 0) throw new Error(`${result.product}: 원화 단가는 0 이상의 숫자여야 합니다.`);
      result.unitPrice = unitPrice;
    }
    return result;
  });
}

export function isDutchPreviewCurrent(preview, revision, year, week, sourceIdentity) {
  return !!(preview?.planToken && isDutchValidationCurrent(preview, revision, year, week, sourceIdentity));
}

export function isDutchValidationCurrent(preview, revision, year, week, sourceIdentity) {
  return !!(preview && preview.revision === revision && preview.year === year && preview.week === week && preview.sourceIdentity === sourceIdentity);
}

export function editDutchDraftEntry(entries, id, change) {
  return (entries || []).map(entry => entry.id === id ? { ...entry, ...change } : entry);
}

export function newDutchDraftEntry(id) {
  return { id, added: true, sheetName: '', cellAddress: '', product: '', color: '', customer: '', quantity: 0, unit: '' };
}

export function dutchPreviewRowKind(row) {
  if (row.fixBlocked) return 'blocked';
  if (row.missingFromExcel) return 'missing';
  if (row.priceChanged && !Number(row.shipmentDiffQty || 0)) return 'price';
  if (Number(row.shipmentDiffQty || 0)) return 'quantity';
  return 'same';
}
