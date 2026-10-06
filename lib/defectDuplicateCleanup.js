import { normalizeDefectUnit, normalizeParentWeek } from './salesDefectDeductionCore.js';

// Reviewed 2026/40 repeats. This is an explicit repair allowlist, never a general
// same-product deletion rule: distinct reports and carryovers must survive.
export const REVIEWED_DEFECT_DUPLICATE_PAIRS = Object.freeze([
  [690, 688], [714, 697], [715, 698], [716, 699], [717, 700],
  [718, 701], [719, 702], [720, 703],
].map(([duplicateKey, canonicalKey]) => Object.freeze({ duplicateKey, canonicalKey })));

const equalNumber = (a, b) => Number.isFinite(Number(a)) && Number.isFinite(Number(b))
  && Math.abs(Number(a) - Number(b)) < 0.0001;
const fail = (message) => { throw new Error(`중복 초안 정리 보류: ${message}`); };

export function validateReviewedDefectDuplicate({ duplicate, canonical, estimate, applications = [] }) {
  if (!duplicate || !canonical || !estimate) fail('원본·정상 행·견적 근거 누락');
  const pair = REVIEWED_DEFECT_DUPLICATE_PAIRS.find((p) => p.duplicateKey === Number(duplicate.DeductionKey)
    && p.canonicalKey === Number(canonical.DeductionKey));
  if (!pair) fail('검토된 저장번호 쌍이 아님');
  if (duplicate.IsDeleted || canonical.IsDeleted || estimate.MasterDeleted) fail('삭제 상태 변경');
  if (duplicate.Status !== 'DRAFT' || Number(duplicate.RowVersionNo) !== 1
    || duplicate.EstimateKey || duplicate.AppliedShipmentKey || duplicate.AppliedOrderYear
    || duplicate.AppliedOrderWeek || duplicate.ImportConfirmed || duplicate.CreditApplied
    || duplicate.IsCarryoverLedger || duplicate.FarmKey || String(duplicate.FarmName || '').trim()
    || applications.some((a) => Number(a.DeductionKey) === pair.duplicateKey)) {
    fail('중복 초안에 처리·수입확인·이월 이력 또는 버전 변경');
  }
  if (!['REGISTERED', 'COMPLETED'].includes(canonical.Status)
    || Number(canonical.EstimateKey) !== Number(estimate.EstimateKey)
    || Number(canonical.AppliedShipmentKey) !== Number(estimate.ShipmentKey)) fail('정상 원장의 견적 연결 변경');
  for (const row of [duplicate, canonical]) {
    if (Number(row.OrderYear) !== 2026 || normalizeParentWeek(row.OrderWeek) !== 40) fail('2026/40 범위 변경');
  }
  if (Number(estimate.OrderYear) !== 2026 || normalizeParentWeek(estimate.OrderWeek) !== 40
    || Number(canonical.AppliedOrderYear) !== 2026 || normalizeParentWeek(canonical.AppliedOrderWeek) !== 40) fail('견적 적용 연도·차수 변경');
  for (const name of ['CustKey', 'ProdKey']) {
    if (!(Number(duplicate[name]) > 0) || Number(duplicate[name]) !== Number(canonical[name])
      || Number(duplicate[name]) !== Number(estimate[name])) fail(`${name} 불일치`);
  }
  if (duplicate.CreatedBy !== canonical.CreatedBy || duplicate.DeductionType !== canonical.DeductionType
    || String(duplicate.Note || '').trim() || String(duplicate.SourceFileName || '').trim()) fail('반복 입력 근거 변경');
  const elapsed = new Date(duplicate.CreatedAt).getTime() - new Date(canonical.CreatedAt).getTime();
  if (!Number.isFinite(elapsed) || elapsed <= 0 || elapsed > 15 * 60 * 1000) fail('검토된 반복 입력 시간 범위 변경');
  const unit = normalizeDefectUnit(duplicate.SourceUnit);
  if (!unit || unit !== normalizeDefectUnit(canonical.SourceUnit) || unit !== normalizeDefectUnit(estimate.Unit)) fail('단위 불일치');
  if (!(Number(duplicate.Quantity) > 0) || !(Number(estimate.Quantity) < 0)
    || !equalNumber(duplicate.Quantity, canonical.Quantity)
    || !equalNumber(duplicate.Quantity, -Number(estimate.Quantity))) fail('수량 불일치');
  if (!equalNumber(canonical.EstimateCost, estimate.Cost)
    || (duplicate.EstimateCost != null && !equalNumber(duplicate.EstimateCost, estimate.Cost))) fail('단가 불일치');
  if (estimate.EstimateType !== 'FEE03-KR0010') fail('불량차감 견적 종류 불일치');
  return { ...pair, estimateKey: Number(estimate.EstimateKey), action: 'DUPLICATE_CLEANUP' };
}
