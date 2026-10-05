export function parseDutchSheetQuantity(value) {
  const text = String(value ?? '').trim();
  if (!text) return { ok: false, reason: 'empty' };
  const quantity = Number(text);
  if (!Number.isFinite(quantity)) return { ok: false, reason: 'not-finite' };
  if (quantity < 0) return { ok: false, reason: 'negative' };
  return { ok: true, quantity };
}
