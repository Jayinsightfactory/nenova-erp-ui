import { normalizeChinaUnit } from './chinaOrderDownload.js';

const numberText = value => new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 3 }).format(value);
const positive = value => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : null;

export function chinaBoxConversion(order) {
  const unit = normalizeChinaUnit(order.unit);
  const unitsPerBox = unit === '박스' ? 1 : positive(unit === '단' ? order.bunchOf1Box : order.steamOf1Box);
  return { unit, unitsPerBox, source: unit === '박스' ? 'OutUnit' : unit === '단' ? 'Product.BunchOf1Box' : 'Product.SteamOf1Box' };
}

export function chinaBoxQuantity(quantity, conversion) {
  if (quantity === 0) return 0;
  if (!Number.isFinite(quantity) || !conversion?.unitsPerBox) return null;
  const boxes = quantity / conversion.unitsPerBox;
  return Number.isFinite(boxes) ? boxes : null;
}

export function chinaQuantityText(quantity, boxes) {
  return `${numberText(quantity)}(${boxes === null || boxes === undefined ? '—' : numberText(boxes)})`;
}

export function chinaClientCodeGroup(code) {
  const value = String(code ?? '').trim().toUpperCase();
  if (!value) return null;
  const match = value.match(/^([A-Z]*)CL/);
  return match ? match[1] || 'CL' : value.match(/^[A-Z]+/)?.[0] || '#';
}

export function compareChinaCustomers(a, b) {
  const aa = chinaClientCodeGroup(a.custOrderCode), bb = chinaClientCodeGroup(b.custOrderCode);
  if (aa === null || bb === null) return aa === bb ? a.custKey - b.custKey : aa === null ? 1 : -1;
  return aa.localeCompare(bb, 'en') || String(a.custOrderCode).localeCompare(String(b.custOrderCode), 'en', { numeric: true, sensitivity: 'base' }) || a.custKey - b.custKey;
}
