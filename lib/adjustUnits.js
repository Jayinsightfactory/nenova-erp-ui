// 출고분배 ADD/CANCEL 단위 환산 (DB 의존 없음 — 단위 테스트 가능)
//
// ShipmentDetail.OutQuantity 는 OutUnit(박스 품목=박스수) 기준 단일값(exe 호환).
// 사용자 입력 delta 는 userUnit(박스/단/송이) 기준이므로, 기존 OutQuantity(=OutUnit)
// 에 더하기 전에 반드시 OutUnit 기준으로 환산해야 한다.
//   예) 장미 OutUnit=박스, BunchOf1Box=10 → '10단 ADD' 는 OutQuantity +1박스 (not +10).
// (OrderDetail 측은 같은 핸들러에서 이미 userUnit 일관 처리되므로 이 환산으로 단위를 통일한다.)
import { normalizeOrderUnit } from './orderUtils.js';
import { toOrderUnits } from './shipmentImportQty.js';

/** OutUnit 기준 수량(박스 품목=박스수) → box/bunch/steam 전개. exe 호환: OutQuantity 단일값. */
export function toShipmentUnits(outQty, bunchOf1Box, steamOf1Box) {
  const qty = Number(outQty || 0);
  const b1b = Number(bunchOf1Box || 0);
  const s1b = Number(steamOf1Box || 0);
  return {
    box: qty,
    bunch: b1b > 0 ? qty * b1b : 0,
    steam: s1b > 0 ? qty * s1b : 0,
    outQ: qty,
  };
}

/** 금액 기준수량(EstQuantity) — 단>송이>박스. 환산품목은 단/송이 금액 기준(강제 동기화 아님). */
export function estimateQuantityFromShipmentUnits(units) {
  if (Number(units.bunch || 0) > 0) return Number(units.bunch || 0);
  if (Number(units.steam || 0) > 0) return Number(units.steam || 0);
  return Number(units.box || 0);
}

/**
 * ShipmentDetail ADD/CANCEL 누적 후 환산 단위 산출 (순수).
 * delta(userUnit) 를 OutUnit 기준으로 환산한 뒤 기존 OutQuantity 에 가/감산한다.
 *
 * @param {object} a
 * @param {number} a.curOut      기존 OutQuantity (OutUnit 기준)
 * @param {number} a.delta       사용자 입력 수량 (a.unit 기준, 양수)
 * @param {'ADD'|'CANCEL'} a.type
 * @param {string} a.unit        사용자 단위 (박스/단/송이)
 * @param {string} a.outUnit     Product.OutUnit
 * @param {number} a.bunchOf1Box BunchOf1Box
 * @param {number} a.steamOf1Box SteamOf1Box
 * @returns {{ deltaOut:number, qtyBefore:number, qtyAfter:number, units:object, estQty:number }}
 */
export function computeShipmentAdjustUnits({
  curOut = 0, delta = 0, type = 'ADD', unit, outUnit,
  bunchOf1Box = 0, steamOf1Box = 0,
}) {
  const prodOutUnit = normalizeOrderUnit(outUnit, '박스');
  const userUnit = normalizeOrderUnit(unit, prodOutUnit);
  const b1b = Number(bunchOf1Box || 0);
  const s1b = Number(steamOf1Box || 0);
  // delta(userUnit) → OutUnit 기준. userUnit==OutUnit 이면 그대로(무해), 단→박스면 /B1B.
  const deltaOut = toOrderUnits(Number(delta || 0), userUnit, {
    OutUnit: prodOutUnit, BunchOf1Box: b1b, SteamOf1Box: s1b,
  }).outQty;
  const before = Number(curOut || 0);
  const qtyAfter = type === 'CANCEL' ? before - deltaOut : before + deltaOut;
  const units = toShipmentUnits(qtyAfter, b1b, s1b);
  const estQty = estimateQuantityFromShipmentUnits(units);
  return { deltaOut, qtyBefore: before, qtyAfter, units, estQty };
}
