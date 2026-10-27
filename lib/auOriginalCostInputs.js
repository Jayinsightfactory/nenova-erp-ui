// Historical PREMIUM GREENS 38-1 worksheet defaults, not current confirmed bills.
export const AU_ORIGINAL_DEFAULTS = Object.freeze({ baeksangRateKRW: 460, clearanceFeeKRW: 33000,
  inspectionRateKRW: 10000, domesticTransportKRW: 90000 });
export const AU_ORIGINAL_SOURCE = 'PREMIUM GREENS 38-1 · N5:N9 원본 기본값';
export const auNumber = value => (typeof value === 'number' || typeof value === 'string' && value.trim() !== '')
  && Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : null;
export function initialAuOriginalInputs(document, saved = {}) {
  const lines = document.receiptLines || document.lines || [];
  return { ...AU_ORIGINAL_DEFAULTS, gw: document.reviewedMetadata?.gw ?? '',
    itemCount: new Set(lines.filter(line => Number(line.prodKey) > 0).map(line => Number(line.prodKey))).size,
    ...(saved.auOriginal || {}) };
}
export function calculateAuOriginalCustoms(values) {
  const keys = ['gw', 'itemCount', ...Object.keys(AU_ORIGINAL_DEFAULTS)];
  const inputs = Object.fromEntries(keys.map(key => [key, auNumber(values?.[key])]));
  const missing = keys.filter(key => inputs[key] === null);
  if (inputs.itemCount !== null && !Number.isInteger(inputs.itemCount)) missing.push('itemCount');
  const total = missing.length ? null : inputs.gw * inputs.baeksangRateKRW + inputs.clearanceFeeKRW
    + inputs.itemCount * inputs.inspectionRateKRW + inputs.domesticTransportKRW;
  return {inputs, missing, total: Number.isFinite(total) ? total : null};
}
