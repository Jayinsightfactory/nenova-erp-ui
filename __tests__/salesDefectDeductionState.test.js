import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  applyDeductionRegistrationPlan,
  assertDeductionMutationOwnership,
  assertIncomingConfirmed,
  collectDeductionEstimateKeys,
  ensureRegistrationRequestKey,
  isDeductionOwnedByUser,
  planDeductionRegistration,
  runIsolatedRegistrationTransaction,
} from '../lib/salesDefectDeductionState.js';
import {
  buildDefectEstimateTargetCandidatesSql,
  evaluateDefectRegistrationEligibility,
  isExeEstimateTargetCandidate,
  selectExeEstimateTargetCandidate,
} from '../lib/defectEstimateTargetScope.js';

const estimateTargetSql = buildDefectEstimateTargetCandidatesSql();
assert.match(estimateTargetSql, /vs\.OrderYear=@yr/);
assert.match(estimateTargetSql, /vs\.ProdKey=@pk/);
assert.match(estimateTargetSql, /vs\.OrderWeek LIKE @prefix/);
assert.match(estimateTargetSql, /JOIN ViewOrder vo/);
assert.match(estimateTargetSql, /JOIN ShipmentDate sdd/);
assert.match(estimateTargetSql, /JOIN PeriodDay pd/);
assert.doesNotMatch(estimateTargetSql, /sdd\.EstQuantity[^,\n]*>/, 'GetDetail에 없는 출고일 EstQuantity 양수 필터를 추가하면 안 된다.');
const customerTargetSql = buildDefectEstimateTargetCandidatesSql({ customerOnly: true });
assert.doesNotMatch(customerTargetSql, /vs\.ProdKey=@pk/, '차감 품목이 대상 차수에 없어도 같은 업체의 확정 출고가 있으면 등록할 수 있어야 한다.');

const cheonghwaVisibleTarget = {
  ShipmentKey: 3301, DetailFix: 1, ShipmentEstimateQuantity: 20,
  ShipmentDateEstimateQuantity: 0,
};
assert.equal(isExeEstimateTargetCandidate(cheonghwaVisibleTarget), true, '견적 상세에 보이는 출고일 EstQuantity 0행도 등록 대상이어야 한다.');
assert.equal(selectExeEstimateTargetCandidate([
  { ...cheonghwaVisibleTarget, ShipmentKey: 3300, DetailFix: 0 },
  cheonghwaVisibleTarget,
])?.ShipmentKey, 3301, '미확정 near-miss를 건너뛰고 EXE 상세 노출 행을 선택해야 한다.');
assert.equal(isExeEstimateTargetCandidate({ ...cheonghwaVisibleTarget, DetailFix: 0 }), false, '미확정 출고는 제외해야 한다.');
assert.equal(isExeEstimateTargetCandidate({ ...cheonghwaVisibleTarget, ShipmentEstimateQuantity: 0 }), false, '출고 환산수량 0행은 제외해야 한다.');

const confirmedRow = { importConfirmed: true, importReviewRequired: false, status: 'CARRYOVER', estimateKey: null };
assert.equal(evaluateDefectRegistrationEligibility({ row: confirmedRow, context: { shipmentKey: 5809, cost: 5900 } }).eligible, true, '같은 업체의 확정 출고와 품목별 단가가 있으면 등록 가능해야 한다.');
const customerNoShipment = evaluateDefectRegistrationEligibility({ row: confirmedRow, context: { shipmentKey: null, cost: 5900 } });
assert.equal(customerNoShipment.eligible, false, '선택 차수에 업체 출고가 없으면 등록할 수 없어야 한다.');
assert.equal(customerNoShipment.code, 'CUSTOMER_SALE_MISSING');
assert.match(customerNoShipment.error, /업체.*확정 출고/);
assert.equal(evaluateDefectRegistrationEligibility({ row: { ...confirmedRow, importConfirmed: false }, context: { shipmentKey: 5809, cost: 5900 } }).eligible, false);
assert.equal(evaluateDefectRegistrationEligibility({ row: confirmedRow, context: { shipmentKey: 5809, cost: 0 } }).code, 'COST_MISSING');

const reviewPageSource = fs.readFileSync('pages/sales/defect-deduction-register-review.js', 'utf8');
const deductionServiceSource = fs.readFileSync('lib/salesDefectDeductions.js', 'utf8');
const migrationSource = fs.readFileSync('docs/migrations/2026-07-22_web_sales_defect_deduction.sql', 'utf8');

const confirmedCarryover = {
  DeductionKey: 101, OrderYear: 2026, OrderWeek: '32', CustKey: 10, ProdKey: 20,
  Quantity: 10, OriginalQuantity: 10, RemainingQuantity: 10, IsCarryoverLedger: 1,
  ImportConfirmed: 1, ImportReviewRequired: 0,
  CreatedBy: 'sales-a', CreatedByName: '영업A',
};

assert.throws(() => assertIncomingConfirmed({ ...confirmedCarryover, ImportConfirmed: 0 }), /수입부 확정/);
assert.throws(() => planDeductionRegistration({
  row: { ...confirmedCarryover, ImportConfirmed: 0 }, targetYear: 2026, targetWeek: '33',
  requestKey: 'req-unconfirmed', productSalesRowExists: true, shipmentKey: 300, cost: 1100,
}), /수입부 확정/);
assert.throws(() => planDeductionRegistration({
  row: { ...confirmedCarryover, ImportReviewRequired: 1 }, targetYear: 2026, targetWeek: '33',
  requestKey: 'req-review', productSalesRowExists: true, shipmentKey: 300, cost: 1100,
}), /보완 필요/);

const firstPlan = planDeductionRegistration({
  row: confirmedCarryover, targetYear: 2026, targetWeek: '33', applyQuantity: 4,
  requestKey: 'req-partial-33', productSalesRowExists: true, shipmentKey: 3300, cost: 1100,
});
assert.deepEqual(
  { action: firstPlan.action, remaining: firstPlan.remainingQuantity, status: firstPlan.status },
  { action: 'APPLY', remaining: 6, status: 'CARRYOVER' },
);
const firstApplied = applyDeductionRegistrationPlan(confirmedCarryover, firstPlan);
assert.equal(firstApplied.application.AppliedOrderWeek, '33');
assert.equal(firstApplied.row.RemainingQuantity, 6);

const secondPlan = planDeductionRegistration({
  row: firstApplied.row, targetYear: 2026, targetWeek: '34', applyQuantity: 6,
  requestKey: 'req-complete-34', existingRequestKeys: ['req-partial-33'],
  productSalesRowExists: true, shipmentKey: 3400, cost: 1200,
});
const secondApplied = applyDeductionRegistrationPlan(firstApplied.row, secondPlan);
assert.equal(secondApplied.row.RemainingQuantity, 0);
assert.equal(secondApplied.row.Status, 'COMPLETED');
assert.equal(secondApplied.application.AppliedOrderWeek, '34');

const duplicatePlan = planDeductionRegistration({
  row: firstApplied.row, targetYear: 2026, targetWeek: '33', applyQuantity: 4,
  requestKey: 'req-partial-33', existingRequestKeys: ['req-partial-33'],
  productSalesRowExists: true, shipmentKey: 3300, cost: 1100,
});
assert.deepEqual(duplicatePlan, { action: 'IDEMPOTENT', writeCount: 0, requestKey: 'req-partial-33' });
assert.equal(applyDeductionRegistrationPlan(firstApplied.row, duplicatePlan).writeCount, 0);

const completedPlan = planDeductionRegistration({
  row: secondApplied.row, targetYear: 2026, targetWeek: '35', requestKey: 'req-after-complete',
  productSalesRowExists: true, shipmentKey: 3500, cost: 1250,
});
assert.equal(completedPlan.action, 'COMPLETE_NOOP');
assert.equal(completedPlan.writeCount, 0);

assert.throws(() => planDeductionRegistration({
  row: confirmedCarryover, targetYear: 2026, targetWeek: '33', requestKey: 'req-no-product-sale',
  customerExists: true, productSalesRowExists: false, customerShipmentExists: false, shipmentKey: 3300, cost: 1100,
}), /대상 차수.*업체의 EXE 확정 출고/);
assert.doesNotThrow(() => planDeductionRegistration({
  row: confirmedCarryover, targetYear: 2026, targetWeek: '33', requestKey: 'req-customer-sale',
  customerExists: true, productSalesRowExists: false, customerShipmentExists: true, shipmentKey: 3300, cost: 1100,
}), '차감 품목 판매행이 없어도 같은 업체 확정 출고가 있으면 등록해야 한다.');

const editedByB = { ...confirmedCarryover, UpdatedBy: 'sales-b', UpdatedByName: '영업B' };
assert.equal(isDeductionOwnedByUser(editedByB, { userId: 'sales-a', userName: '영업A', authority: 5 }), true);
assert.equal(isDeductionOwnedByUser(editedByB, { userId: 'sales-b', userName: '영업B', authority: 5 }), false);
assert.throws(() => assertDeductionMutationOwnership(editedByB, { userId: 'sales-b', authority: 5 }), /다른 담당자/);
const legacyRow = { ...editedByB, CreatedBy: '', CreatedByName: '' };
assert.equal(isDeductionOwnedByUser(legacyRow, { userId: 'sales-b', authority: 5 }), true);
assert.equal(isDeductionOwnedByUser(editedByB, { userId: 'admin', authority: 1 }), true);

assert.deepEqual(collectDeductionEstimateKeys(
  { EstimateKey: 9003 },
  [{ EstimateKey: 9001 }, { EstimateKey: 9002 }, { EstimateKey: 9003 }, { EstimateKey: null }],
), [9003, 9001, 9002]);

let requestKeyGenerations = 0;
const generatedRequestKey = ensureRegistrationRequestKey('', () => {
  requestKeyGenerations += 1;
  return 'defect-request-001';
});
assert.equal(ensureRegistrationRequestKey(generatedRequestKey, () => {
  requestKeyGenerations += 1;
  return 'must-not-replace';
}), 'defect-request-001');
assert.equal(requestKeyGenerations, 1, '실패·재시도 중에는 같은 등록 요청키를 유지해야 한다.');
assert.match(reviewPageSource, /useRef\(''\)[\s\S]*ensureRegistrationRequestKey/, '검토창은 재시도 동안 등록 요청키를 ref에 유지해야 한다.');
assert.match(reviewPageSource, /action: 'register'[\s\S]*requestKey: registerRequestKeyRef\.current/, '등록 POST에 안정된 요청키를 포함해야 한다.');
const requestPostIndex = reviewPageSource.indexOf("const data = await apiPost('/api/sales/defect-deductions'");
const requestResetIndex = reviewPageSource.indexOf("registerRequestKeyRef.current = '';", requestPostIndex);
const catchIndex = reviewPageSource.indexOf('} catch (e)', requestPostIndex);
assert.ok(requestPostIndex >= 0 && requestResetIndex > requestPostIndex, '요청 성공 전 등록키를 초기화하면 안 된다.');
assert.ok(catchIndex > requestResetIndex, '실패 catch 경로는 등록 요청키 초기화 전에 실행되면 안 된다.');

const preflightSource = deductionServiceSource.slice(
  deductionServiceSource.indexOf('export async function preflightRegistration'),
  deductionServiceSource.indexOf('async function loadEstimatePreview'),
);
const previewSource = deductionServiceSource.slice(
  deductionServiceSource.indexOf('export async function registrationPreview'),
  deductionServiceSource.indexOf('export async function registerDeductions'),
);
const registerSource = deductionServiceSource.slice(
  deductionServiceSource.indexOf('export async function registerDeductions'),
  deductionServiceSource.indexOf('export async function deleteDeductions'),
);
const deleteSource = deductionServiceSource.slice(deductionServiceSource.indexOf('export async function deleteDeductions'));
assert.match(preflightSource, /assertConfirmedForRegistration\(dbRow\)/, '사전검증도 저장 원장의 수입부 확정 상태를 서버에서 확인해야 한다.');
assert.match(previewSource, /assertConfirmedForRegistration\(dbRow\)/, '검토 미리보기도 저장 원장의 수입부 확정 상태를 서버에서 확인해야 한다.');
assert.match(registerSource, /runIsolatedRegistrationTransaction\(withTransaction/, 'deadlock 재시도 결과는 commit된 attempt만 반환해야 한다.');
assert.match(registerSource, /DeductionKey=@key AND RequestKey=@requestKey/, '동일 요청키를 Estimate INSERT 전에 조회해야 한다.');
assert.ok(
  registerSource.indexOf('DeductionKey=@key AND RequestKey=@requestKey')
    < registerSource.indexOf('assertRemainingForRegistration(dbRow)'),
  '완료된 이월행의 동일 요청 재전송도 잔여수량 검사 전에 멱등 응답해야 한다.',
);
assert.match(deleteSource, /FROM WebSalesCarryoverApplication[\s\S]*collectDeductionEstimateKeys/, '삭제 시 모든 부분처리 application의 EstimateKey를 수집해야 한다.');
assert.match(migrationSource, /COL_LENGTH\(N'dbo\.WebSalesCarryoverApplication', N'RequestKey'\)[\s\S]*ADD RequestKey NVARCHAR\(100\) NULL/, '기존 운영 application 원장에 nullable 요청키를 안전하게 추가해야 한다.');
assert.match(migrationSource, /CREATE UNIQUE INDEX UX_WebSalesCarryoverApplication_Request[\s\S]*\(DeductionKey, RequestKey\)[\s\S]*WHERE RequestKey IS NOT NULL/, 'DB가 이월 동일 요청의 중복 application을 최종 차단해야 한다.');
assert.match(deductionServiceSource, /EXEC\(N'CREATE UNIQUE INDEX UX_WebSalesCarryoverApplication_Request/, '기존 운영 DB에 RequestKey를 추가하는 배치는 ALTER 이후 동적 SQL로 인덱스를 컴파일해야 한다.');
assert.match(migrationSource, /EXEC\(N'CREATE UNIQUE INDEX UX_WebSalesCarryoverApplication_Request/, '명시 migration도 신규 RequestKey 컬럼을 같은 배치에서 안전하게 인덱싱해야 한다.');

let callbacks = 0;
const deadlockRetryTransaction = async (callback) => {
  callbacks += 1;
  await callback(async () => ({}), { attempt: 0 });
  callbacks += 1;
  return callback(async () => ({}), { attempt: 1 });
};
const committed = await runIsolatedRegistrationTransaction(
  deadlockRetryTransaction,
  async (_query, result, meta) => {
    result.registered.push({ attempt: meta.attempt, estimateKey: meta.attempt ? 200 : 100 });
  },
);
assert.equal(callbacks, 2);
assert.deepEqual(committed.registered, [{ attempt: 1, estimateKey: 200 }]);

await assert.rejects(
  runIsolatedRegistrationTransaction(
    async (callback) => {
      await callback(async () => ({}), { attempt: 0 });
      throw new Error('forced rollback');
    },
    async (_query, result) => result.registered.push({ estimateKey: 999 }),
  ),
  /forced rollback/,
);

console.log('salesDefectDeductionState tests passed');
