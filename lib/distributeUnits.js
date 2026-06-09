// 출고분배/견적 환산 — usp_DistributeOne + nenova.exe FormEstimateView(GetDetail) 과 동일.
// 입력 qty 는 OutUnit 기준(박스 품목=박스수, ShipmentDate.ShipmentQuantity).
import { normalizeOrderUnit } from './orderUtils.js';

function asNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * @param {number} qty OutUnit 기준 수량 (출고일별이면 ShipmentDate.ShipmentQuantity)
 * @param {object} product Product 행 (OutUnit, EstUnit, BunchOf1Box, SteamOf1Bunch, SteamOf1Box)
 */
export function distributeUnits(qty, product = {}) {
  const out = asNumber(qty);
  const outUnit = normalizeOrderUnit(product.OutUnit, '박스');
  const estUnit = normalizeOrderUnit(product.EstUnit, outUnit);
  const b1b = Number(product.BunchOf1Box || 0);
  const s1bunch = Number(product.SteamOf1Bunch || 0);
  const s1box = Number(product.SteamOf1Box || 0);

  let box = 0;
  let bunch = 0;
  let steam = 0;
  if (outUnit === '박스') {
    box = out;
    if (b1b > 0) bunch = out * b1b;
    if (b1b > 0 && s1bunch > 0) steam = out * b1b * s1bunch;
    if (s1box > 0) steam = out * s1box;
  } else if (outUnit === '단') {
    bunch = out;
    if (b1b > 0) box = out / b1b;
    if (s1bunch > 0) steam = out * s1bunch;
    if (b1b > 0 && s1bunch > 0) box = out / (b1b * s1bunch);
  } else {
    steam = out;
    if (s1bunch > 0) bunch = out / s1bunch;
    if (b1b > 0 && s1bunch > 0) box = out / (s1bunch * b1b);
    if (s1box > 0) box = out / s1box;
  }

  let estRaw;
  if (estUnit === '박스') estRaw = box || bunch || steam;
  else if (estUnit === '단') estRaw = bunch || steam || box;
  else estRaw = steam || bunch || box;
  const estQty = Math.round(estRaw || out);

  return { box, bunch, steam, outQty: out, estQty };
}

/** nenova 견적 금액 산식 (usp_DistributeOne) */
export function amountVatFromCostEst(cost, estQty) {
  const c = Number(cost) || 0;
  const e = Number(estQty) || 0;
  const gross = c * e;
  const amount = Math.round(gross / 1.1, 0);
  const vat = gross - amount;
  return { amount, vat };
}
