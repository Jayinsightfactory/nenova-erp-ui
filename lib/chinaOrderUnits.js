import { normalizeOrderUnit } from './orderUtils.js';

// FormOrderAdd's edited unit columns + UnitQuantity(true/false), unrounded.
// Used only for new China-board orders; existing orders are never repaired.
export function chinaOrderUnits(quantity, product = {}) {
  const qty = Number(quantity);
  const outUnit = normalizeOrderUnit(product.OutUnit, '');
  const estUnit = normalizeOrderUnit(product.EstUnit, outUnit);
  if (!Number.isFinite(qty) || qty < 0 || !['박스','단','송이'].includes(outUnit) || !['박스','단','송이'].includes(estUnit)) throw new Error('신규 주문 수량·단위를 확인하세요.');
  const b = Number(product.BunchOf1Box || 0);
  const s = Number(product.SteamOf1Bunch || 0);
  const sb = Number(product.SteamOf1Box || 0);
  let box = 0, bunch = 0, steam = 0;
  if (outUnit === '박스') {
    box = qty;
    if (b > 0) bunch = box * b;
    if (s > 0) steam = bunch * s;
    if (sb > 0) steam = box * sb;
  } else if (outUnit === '단') {
    bunch = qty;
    if (b > 0) box = bunch / b;
    if (s > 0) steam = bunch * s;
  } else {
    steam = qty;
    if (s > 0) bunch = steam / s;
    if (b > 0) box = bunch / b;
    if (sb > 0) box = steam / sb;
  }
  const estQty = estUnit === '박스' ? box : estUnit === '단' ? bunch : steam;
  if (![box,bunch,steam,estQty].every(Number.isFinite) || (qty > 0 && estQty <= 0)) throw new Error('신규 주문의 견적단위 환산값을 확인할 수 없습니다. 품목 환산정보를 확인하세요.');
  return { box, bunch, steam, outQty: qty, estQty };
}
