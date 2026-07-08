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

/**
 * OutQuantity(OutUnit) → EstQuantity/Amount/Vat — nenova.exe FormEstimateView·usp_DistributeOne 동일.
 * ShipmentDetail·ShipmentDate 모두 이 규칙을 써야 sync 후 불일치(희경 유형)가 나지 않음.
 */
export function estimateFromOutQuantity(outQty, cost, product = {}) {
  const { estQty } = distributeUnits(outQty, product);
  const { amount, vat } = amountVatFromCostEst(cost, estQty);
  return { estQty, amount, vat };
}

/** exe(OutQuantity 소수 2자리 저장)와 동일 반올림 — 분수 박스(155송이÷30=5.1666…)가
 * OutQuantity(5.17)와 ShipmentDate.ShipmentQuantity(5.166667)로 갈리는 것을 원천 차단. */
function roundQty2(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

/**
 * 견적/출고 수량 UI 입력(박스·단·송이) → exe distributeUnits 와 동일한 box/bunch/steam/outQuantity/estQty.
 * Product 마스터(BunchOf1Box 등)만 사용 — ShipmentDetail 기존 bunch 비율·기본값 10 폴백 금지.
 */
export function shipmentUnitsFromUserInput(quantity, unit, product = {}) {
  const q = asNumber(quantity);
  const outUnit = normalizeOrderUnit(product.OutUnit, '박스');
  const userUnit = normalizeOrderUnit(unit, outUnit);
  const b1b = Number(product.BunchOf1Box || 0);
  const s1box = Number(product.SteamOf1Box || 0);
  const s1bunch = Number(product.SteamOf1Bunch || 0);

  let box = 0;
  let bunch = 0;
  let steam = 0;
  if (userUnit === '단') {
    bunch = q;
    box = b1b > 0 ? q / b1b : 0;
    steam = s1bunch > 0 ? q * s1bunch : (s1box > 0 && box > 0 ? box * s1box : 0);
  } else if (userUnit === '송이') {
    steam = q;
    box = s1box > 0 ? q / s1box : (s1bunch > 0 && b1b > 0 ? q / (s1bunch * b1b) : 0);
    bunch = s1bunch > 0 ? q / s1bunch : (b1b > 0 && box > 0 ? box * b1b : 0);
  } else {
    box = q;
    bunch = b1b > 0 ? q * b1b : 0;
    steam = s1box > 0 ? q * s1box : 0;
  }

  // exe 저장 규칙과 동일: 사용자 입력 단위 값은 그대로(155송이=155), 환산 파생값은 소수 2자리
  // (155÷30 → Box=Out=5.17). OutQuantity 를 반올림해 확정해야 ShipmentDate.ShipmentQuantity 와
  // full-precision(5.166667)으로 갈리지 않는다. estQty 는 확정된 OutQuantity 기준 재산출(=exe GetDetail).
  const outQuantity = roundQty2(outUnit === '단' ? bunch : outUnit === '송이' ? steam : box);
  const distributed = distributeUnits(outQuantity, product);
  return {
    box: roundQty2(box),
    bunch: roundQty2(bunch),
    steam: roundQty2(steam),
    outQuantity,
    estQty: distributed.estQty,
  };
}
