// Only a bounded, scalar allowlist is retained: never editGuard, tokens or raw text.
const scalar = value => typeof value === 'string' ? value.slice(0, 300)
  : typeof value === 'number' && Number.isFinite(value) ? value : null;
const sourceIdentity = value => typeof value === 'string' ? value.slice(0, 512) : null;
const pick = (value, keys) => Object.fromEntries(keys
  .filter(key => value?.[key] != null).map(key => [key, scalar(value[key])]));
const pickEntry = entry => ({
  ...pick(entry, ['type', 'custKey', 'prodKey', 'custName', 'prodName', 'qty', 'unit']),
  ...(sourceIdentity(entry?.sourceIdentity) ? { sourceIdentity: sourceIdentity(entry.sourceIdentity) } : {}),
});

export function buildPasteOperationAudit(body = {}, response = null) {
  const entries = Array.isArray(body.entries) ? body.entries : [];
  const results = Array.isArray(response?.results) ? response.results : [];
  return {
    schema: 'paste-operation-v1',
    year: scalar(body.year), week: scalar(body.week),
    preflightOnly: body.preflightOnly === true || response?.preflight === true,
    entries: entries.slice(0, 1000).map(pickEntry),
    incomplete: entries.length > 1000,
    committedCount: response?.committedCount == null ? null : scalar(response.committedCount),
    verified: response?.verified === true,
    results: results.slice(0, 1000).map(row => pick(row, ['type', 'custKey', 'prodKey', 'qty', 'unit', 'orderBefore', 'orderAfter', 'shipmentBefore', 'shipmentAfter'])),
  };
}

export function actionLogPayload(actionType, body, response) {
  if (['SHIPMENT_ADJUST_BATCH', 'SHIPMENT_ADJUST_BATCH_UNDO'].includes(actionType)) return JSON.stringify(buildPasteOperationAudit(body, response));
  if (actionType === 'ERP_EDIT_TAKEOVER') return JSON.stringify(pick(body, ['action', 'year', 'week', 'custKey', 'pageCode', 'expectedLeaseStamp']));
  try { return JSON.stringify(body).slice(0, 4000); } catch { return ''; }
}
