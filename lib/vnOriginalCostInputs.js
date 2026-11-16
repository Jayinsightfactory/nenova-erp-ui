import { deriveTruckPlan, truckPlanAmount } from './colombiaTruck.js';

// Current user-authorized weight policy, not a claim that old N8 was a formula.
export const VN_TRUCK_RATES = Object.freeze({ Truck1t: 99000, Truck2_5t: 187000, Truck5t: 275000 });
export const VN_CUSTOMS_SOURCE = '베트남 원본 CW×460 + 통관33,000 + 품목×10,000 · 국내운송 GW 차량조합(2026-11-13 지시) · 추정/실청구 아님';
export function vnInvoiceTariffDefault(document, line) {
  if(document?.orderYear!=='2026'||document?.reviewedMetadata?.country!=='VN'||document?.reviewedMetadata?.transportMode!=='AIR'
    ||!/^\d{2}-\d{2}$/.test(document.orderWeek)||Number(document.orderWeek.replace('-',''))<3701
    ||line?.country!=='VN'||line.productDeleted||!(Number(line.prodKey)>0))return null;
  const name=String(line.originalName||'').trim().replace(/\s+/g,' ').toLowerCase();
  if(name!=='orchid vietnam / 호접란 화이트 8 (party grade white 8)')return null;
  return {tariffRate:0.05,sourceHash:'6795346a4621b0b0d4b200d8955e9c18884252316954552422eab4545c348d0e',
    label:'기존 베트남 원가자료 37-1 · I19=H19×5% · 참고 세율(실제 신고 인증 아님)',sourceWeek:'37-01'};
}
const positive = v => (typeof v === 'number' || typeof v === 'string' && v.trim() !== '') && Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : null;

export function vnDomesticTransport(gw) {
  const weight = positive(gw);
  if (weight === null) return null; // Never substitute CW, a missing/zero GW, or infinity.
  const plan = deriveTruckPlan(weight);
  return { amount: truckPlanAmount(plan, VN_TRUCK_RATES), plan };
}

// Excel expression is the same capacity decomposition as deriveTruckPlan.
export function vnDomesticTransportFormula(gwRef) {
  const rem = `MOD(${gwRef},5000)`;
  return `IF(AND(ISNUMBER(${gwRef}),${gwRef}>0),INT(${gwRef}/5000)*275000+IF(${rem}=0,0,IF(${rem}<=1000,99000,IF(${rem}<=2500,187000,187000+ROUNDUP((${rem}-2500)/1000,0)*99000))),"GW 확인 필요")`;
}

export function calculateVnOriginalCustoms({ gw, cw, itemCount } = {}) {
  const weight = positive(cw), transport = vnDomesticTransport(gw);
  const count = Number.isInteger(itemCount) && itemCount > 0 ? itemCount : null;
  const missing = [...(!transport ? ['GW'] : []), ...(weight === null ? ['CW'] : []), ...(count === null ? ['품목수'] : [])];
  return { total: missing.length ? null : weight * 460 + 33000 + count * 10000 + transport.amount,
    domestic: transport?.amount ?? null, plan: transport?.plan ?? null, missing };
}
