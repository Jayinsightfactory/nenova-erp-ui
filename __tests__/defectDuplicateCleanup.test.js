import assert from 'node:assert/strict';
import { REVIEWED_DEFECT_DUPLICATE_PAIRS, validateReviewedDefectDuplicate } from '../lib/defectDuplicateCleanup.js';

function fixture(pair = REVIEWED_DEFECT_DUPLICATE_PAIRS[0]) {
  const duplicate = { DeductionKey: pair.duplicateKey, OrderYear: 2026, OrderWeek: '40',
    Status: 'DRAFT', RowVersionNo: 1, CustKey: 640, ProdKey: 1268, Quantity: 10,
    SourceUnit: '단', CreatedBy: '정재훈', CreatedAt: '2026-10-02T13:59:28Z', DeductionType: '불량차감' };
  const canonical = { ...duplicate, DeductionKey: pair.canonicalKey, Status: 'REGISTERED',
    RowVersionNo: 3, CreatedAt: '2026-10-02T13:59:18Z', EstimateKey: 9835, EstimateCost: 12700,
    AppliedOrderYear: 2026, AppliedOrderWeek: '40', AppliedShipmentKey: 6514 };
  const estimate = { EstimateKey: 9835, ShipmentKey: 6514, OrderYear: 2026, OrderWeek: '40-01',
    CustKey: 640, ProdKey: 1268, Quantity: -10, Unit: '단', Cost: 12700, EstimateType: 'FEE03-KR0010' };
  return { duplicate, canonical, estimate };
}
for (const pair of REVIEWED_DEFECT_DUPLICATE_PAIRS) {
  const f = fixture(pair), before = JSON.stringify(f);
  assert.equal(validateReviewedDefectDuplicate(f).duplicateKey, pair.duplicateKey);
  assert.equal(JSON.stringify(f), before, 'policy cannot mutate original records');
}
for (const mutate of [
  f => { f.duplicate.OrderYear = 2025; },
  f => { f.estimate.OrderYear = 2025; },
  f => { f.duplicate.Quantity = 7; },
  f => { f.duplicate.DeductionKey = 731; },
  f => { f.duplicate.Status = 'CARRYOVER'; },
  f => { f.duplicate.EstimateKey = 9835; },
  f => { f.duplicate.RowVersionNo = 2; },
  f => { f.duplicate.ImportConfirmed = true; },
  f => { f.applications = [{ DeductionKey: 690 }]; },
  f => { f.canonical.EstimateCost = 1; },
  f => { f.estimate.EstimateType = 'FEE03-KR0013'; },
  f => { f.duplicate.Note = '다른 원문'; },
  f => { f.duplicate.SourceUnit = '박스'; },
  f => { f.duplicate.FarmName = '다른 농장'; },
  f => { f.duplicate.CreatedAt = '2026-10-03T13:59:28Z'; },
]) { const f = fixture(); mutate(f); assert.throws(() => validateReviewedDefectDuplicate(f)); }
const aliased = fixture(); aliased.duplicate.SourceUnit = '스팀(대)';
aliased.canonical.SourceUnit = '스팀(대)'; aliased.estimate.Unit = '송이';
assert.equal(validateReviewedDefectDuplicate(aliased).estimateKey, 9835);
console.log('defect duplicate cleanup: reviewed eight repeats and preservation guards passed');
