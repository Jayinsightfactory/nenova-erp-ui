import assert from 'node:assert/strict';
import { planDeductionRegistration } from '../lib/salesDefectDeductionState.js';
import { evaluateDefectRegistrationEligibility } from '../lib/defectEstimateTargetScope.js';
import { deriveSupportProcessingStatus, supportRegistrationDecisionLabel } from '../lib/salesDefectSupportStatus.js';

// Source and customer identity must never change batch-registration eligibility.
// A requirement change must preserve these positive business cases in CI.
const provenance = [
  {},
  { SourceFileName: 'kakao-defect:current', autoSourceExcluded: true },
  { Note: '  KAKAO-DEFECT:note', autoSourceExcluded: true },
  { SourceFileName: 'manual.xlsx', autoSourceExcluded: true, AutoSourceExcluded: 1, AutoSourceEvidence: 'HISTORY_SOURCE' },
];
let cases = 0;
for (const custKey of [1, 77, 533, 565, 682, 9999]) {
  for (const sourceYear of [2025, 2026]) {
    for (const importConfirmed of [false, true]) {
      const baseline = { DeductionKey: 1, OrderYear: sourceYear, OrderWeek: '43', CustKey: custKey,
        ProdKey: 201, Quantity: 3, RemainingQuantity: 3, IsCarryoverLedger: sourceYear < 2026,
        status: 'DRAFT', custKey, prodKey: 201, quantity: 3, importConfirmed };
      const args = { targetYear: 2026, targetWeek: '43', requestKey: 'provenance-test', customerShipmentExists: true, shipmentKey: 8001, cost: 1200 };
      const baselinePlan = planDeductionRegistration({ ...args, row: baseline });
      for (const origin of provenance) {
        const row = { ...baseline, ...origin };
        assert.deepEqual(planDeductionRegistration({ ...args, row }), baselinePlan);
        const decision = evaluateDefectRegistrationEligibility({ row, context: { shipmentKey: 8001, cost: 1200 } });
        assert.equal(decision.eligible, true);
        assert.equal(supportRegistrationDecisionLabel({ ...row, registrationEligible: true, registrationEligibilityCode: decision.code }), '등록 가능');
        assert.notEqual(deriveSupportProcessingStatus(row).processingStatus, 'AUTO_SOURCE_REVIEW');
        assert.throws(() => planDeductionRegistration({ ...args, row, customerShipmentExists: false }), /출고/);
        assert.throws(() => planDeductionRegistration({ ...args, row, cost: 0 }), /단가/);
        assert.throws(() => planDeductionRegistration({ ...args, row: { ...row, CustKey: null, custKey: null } }), /거래처/);
        assert.throws(() => planDeductionRegistration({ ...args, row: { ...row, ProdKey: null, prodKey: null } }), /품목/);
        assert.equal(evaluateDefectRegistrationEligibility({ row, context: { shipmentKey: 8001, cost: 1200 }, exactExistingEstimate: true }).code, 'EXISTING_ESTIMATE');
        assert.equal(evaluateDefectRegistrationEligibility({ row, context: { shipmentKey: 8001, cost: 1200 }, exactExistingEstimate: true, exactExistingAutoSource: true }).code, 'AUTO_SOURCE_ESTIMATE_CONFLICT');
        cases++;
      }
    }
  }
}
assert.throws(() => planDeductionRegistration({ row: { OrderYear: 2027, OrderWeek: '43', SourceFileName: 'kakao-defect:future' }, targetYear: 2026, targetWeek: '43' }), /뒤|이후|이월/);
console.log(`registration provenance: ${cases} customer/year/confirmation/source combinations and negative guards passed`);
