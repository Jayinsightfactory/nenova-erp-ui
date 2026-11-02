import { NL_FREIGHT_DEFAULT_CUSTOMS } from './freightCalc.js';
import { nlQuarantineDeduction, nlQuarantineGroup } from './nlQuarantineDeduction.js';

// Calculation-only company template, never an invoice bill or ERP stock action.
export function nlCompanyTemplateCost(lines, { gw, freight, exchangeRate } = {}) {
  if (!(typeof gw === 'number' && gw > 0 && Number.isFinite(gw)))
    return { ready: false, reason: 'GW 중량 확인 필요' };
  const c = NL_FREIGHT_DEFAULT_CUSTOMS;
  const active = lines.filter(line => Number(line.stemQuantity) > 0 && Number(line.lineAmount) > 0);
  const kindCount = new Set(active.map(nlQuarantineGroup)).size;
  const bakSang = gw * c.bakSangRate;
  const quarantineFee = kindCount * c.quarantinePerItem;
  const grossCustoms = bakSang + c.handlingFee + quarantineFee + c.domesticFreight + c.extraFee;
  const sample = nlQuarantineDeduction(lines, { freight, exchangeRate,
    customsBeforeDeduction: grossCustoms });
  if (!sample.ready) return sample;
  const costs = { bakSang, handling:c.handlingFee, quarantine:quarantineFee,
    domestic:c.domesticFreight, extra:c.extraFee, deduct:sample.deduction,
    kindCount, selections:sample.selected, excluded:sample.excluded };
  return { ready:true, total:grossCustoms-sample.deduction, costs,
    estimateSource:`네덜란드 원본 서식: GW×460 + 33,000 + 검역 종류수×10,000 + 국내운송90,000 + 소독220,000 - 종류별 최저 도착원가 품목의 원본 차감 송이수×FOB×환율. 원본 샘플표에 없는 종류는 차감0: ${sample.excluded.map(row=>row.kind).join(', ') || '없음'}. 실제 청구액이 아닌 계산본.` };
}
