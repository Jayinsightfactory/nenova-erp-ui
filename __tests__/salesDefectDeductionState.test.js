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
  shouldResetIncomingConfirmation,
} from '../lib/salesDefectDeductionState.js';

assert.equal(shouldResetIncomingConfirmation(
  { custKey: 10, prodKey: 20, quantity: 4, sourceUnit: '단', creditApplied: true, farmName: 'Farm A', note: '확인' },
  { custKey: 11, prodKey: 21, quantity: 4, sourceUnit: '단', creditApplied: true, farmName: 'Farm A', note: '확인' },
), false, '업체·품목 매칭만 변경하면 수입부 확정 감사정보를 유지해야 한다.');
assert.equal(shouldResetIncomingConfirmation(
  { prodKey: 20, quantity: 4, sourceUnit: '단', creditApplied: true, farmName: 'Farm A', note: '확인' },
  { prodKey: 21, quantity: 5, sourceUnit: '단', creditApplied: true, farmName: 'Farm A', note: '확인' },
), true, '매칭과 수량이 함께 변경되면 수입부 재확인이 필요하다.');
import {
  buildDefectEstimateTargetCandidatesSql,
  evaluateDefectRegistrationEligibility,
  isExeEstimateTargetCandidate,
  selectExeEstimateTargetCandidate,
} from '../lib/defectEstimateTargetScope.js';

const estimateTargetSql = buildDefectEstimateTargetCandidatesSql();
assert.match(estimateTargetSql, /sm\.OrderYear=@yr/);
assert.match(estimateTargetSql, /sm\.OrderWeek LIKE @prefix/);
assert.match(estimateTargetSql, /FROM ShipmentMaster sm/);
assert.match(estimateTargetSql, /JOIN ShipmentDetail sd/);
assert.match(estimateTargetSql, /JOIN ShipmentDate sdd/);
assert.match(estimateTargetSql, /JOIN PeriodDay pd/);
assert.match(estimateTargetSql, /sd\.ProdKey AS ShipmentProdKey/);
assert.match(estimateTargetSql, /ISNULL\(sm\.isFix,0\) AS MasterFix/);
assert.match(estimateTargetSql, /ISNULL\(sd\.isFix,0\) AS ShipmentDetailFix/);
assert.doesNotMatch(estimateTargetSql, /ViewShipment|ViewOrder|@pk/, '적용 출고 eligibility는 불량 원장 품목 및 ViewShipment.DetailFix와 독립된 업체 확정출고 기준이어야 한다.');
assert.doesNotMatch(estimateTargetSql, /sdd\.EstQuantity[^,\n]*>/, 'GetDetail에 없는 출고일 EstQuantity 양수 필터를 추가하면 안 된다.');
const customerTargetSql = buildDefectEstimateTargetCandidatesSql({ customerOnly: true });
assert.doesNotMatch(customerTargetSql, /vs\.ProdKey=@pk/, '차감 품목이 대상 차수에 없어도 같은 업체의 확정 출고가 있으면 등록할 수 있어야 한다.');

const cheonghwaVisibleTarget = {
  ShipmentKey: 3301, MasterFix: 1, ShipmentDetailFix: 1,
  ShipmentDateEstimateQuantity: 0,
};
assert.equal(isExeEstimateTargetCandidate(cheonghwaVisibleTarget), true, '견적 상세에 보이는 출고일 EstQuantity 0행도 등록 대상이어야 한다.');
assert.equal(selectExeEstimateTargetCandidate([
  { ...cheonghwaVisibleTarget, ShipmentKey: 3300, MasterFix: 0 },
  cheonghwaVisibleTarget,
])?.ShipmentKey, 3301, '미확정 near-miss를 건너뛰고 실제 확정 출고를 선택해야 한다.');
assert.equal(isExeEstimateTargetCandidate({ ...cheonghwaVisibleTarget, MasterFix: 0 }), false, 'Master 미확정 출고는 제외해야 한다.');
assert.equal(isExeEstimateTargetCandidate({ ...cheonghwaVisibleTarget, ShipmentDetailFix: 0 }), false, 'Detail 미확정 출고는 제외해야 한다.');

const confirmedRow = { importConfirmed: true, importReviewRequired: false, status: 'CARRYOVER', estimateKey: null };
const sanghee33ConfirmedShipment = {
  ShipmentKey: 5808, TargetOrderYear: 2026, OrderWeek: '33-01', ShipmentProdKey: 447,
  MasterFix: 1, ShipmentDetailFix: 1, DetailFix: 0, ShipmentDateEstimateQuantity: 0,
};
assert.equal(selectExeEstimateTargetCandidate([
  sanghee33ConfirmedShipment,
])?.ShipmentKey, 5808, '교차연도 fixture에서 SQL의 OrderYear predicate를 통과한 2026 업체 출고키만 안정적으로 선택한다.');
assert.equal(isExeEstimateTargetCandidate(sanghee33ConfirmedShipment), true, '상희꽃상사 2026/33-01 fixture는 ViewShipment.DetailFix=false여도 raw Master/Detail 확정이면 대상이다.');
assert.equal(evaluateDefectRegistrationEligibility({
  row: { ...confirmedRow, prodKey: 456 },
  context: { shipmentKey: sanghee33ConfirmedShipment.ShipmentKey, shipmentProductKey: sanghee33ConfirmedShipment.ShipmentProdKey, cost: 5900 },
}).eligible, true, '상희꽃상사 2026/33 fixture처럼 Novia#456 원장도 Moon Light#447 확정 출고를 적용키로 사용해 등록 가능해야 한다.');
const customerShipmentMissing = evaluateDefectRegistrationEligibility({ row: confirmedRow, context: { shipmentKey: null, cost: 5900 } });
assert.equal(customerShipmentMissing.eligible, false, '같은 연도·적용 부모차수에 업체 확정 출고가 없으면 등록할 수 없다.');
assert.equal(customerShipmentMissing.code, 'CUSTOMER_SALE_MISSING');
assert.match(customerShipmentMissing.error, /업체/);
assert.equal(evaluateDefectRegistrationEligibility({ row: { ...confirmedRow, importConfirmed: false }, context: { shipmentKey: 5809, cost: 5900 } }).eligible, false);
assert.equal(evaluateDefectRegistrationEligibility({ row: confirmedRow, context: { shipmentKey: 5809, cost: 0 } }).code, 'COST_MISSING');

const reviewPageSource = fs.readFileSync('pages/sales/defect-deduction-register-review.js', 'utf8');
const deductionServiceSource = fs.readFileSync('lib/salesDefectDeductions.js', 'utf8');
const migrationSource = fs.readFileSync('docs/migrations/2026-07-22_web_sales_defect_deduction.sql', 'utf8');

// 품목 매칭은 표시/등록 대상의 키만 바꾸는 작업이다. 이미 수입부에서
// 확정한 Farm/Credit/Note/ImportConfirmed 감사 상태를 매칭 변경만으로
// 되돌리면 영업지원 목록에서 해당 행이 사라지는 회귀가 발생한다.
const draftSaveSource = fs.readFileSync('lib/salesDefectDeductionState.js', 'utf8');
assert.doesNotMatch(
  draftSaveSource,
  /before\.custKey[\s\S]*before\.prodKey|before\.prodKey[\s\S]*before\.custKey/,
  '품목/거래처 매칭 키 변경만으로 ImportConfirmed 해제 조건을 만들면 안 된다.',
);
assert.match(draftSaveSource, /before\.quantity[\s\S]*before\.sourceUnit[\s\S]*before\.creditApplied[\s\S]*before\.farmName[\s\S]*before\.note/, '실제 영업값 변경 조건은 매칭 변경과 분리해 보존해야 한다.');

// 등록 후 재조회는 최초 미리보기의 before가 아니라 등록 전 원본 행을
// 기준으로 비교해야 한다. 신규 EstimateKey는 발급된 양수 키를 허용하고,
// 이월행은 남은 수량과 연결 견적키를 검증한다.
assert.match(reviewPageSource, /const originalRowByKey = new Map\(rows\.map/);
assert.match(reviewPageSource, /verifyAppliedRow\(row, originalRowByKey\.get/);
assert.match(reviewPageSource, /originalRow\?\.isCarryoverLedger/);
assert.match(reviewPageSource, /Number\(actual\.EstimateKey \|\| 0\) > 0/);
assert.match(reviewPageSource, /expectedRemaining/);

const confirmedCarryover = {
  DeductionKey: 101, OrderYear: 2026, OrderWeek: '32', CustKey: 10, ProdKey: 20,
  Quantity: 10, OriginalQuantity: 10, RemainingQuantity: 10, IsCarryoverLedger: 1,
  ImportConfirmed: 1, ImportReviewRequired: 0,
  CreatedBy: 'sales-a', CreatedByName: '영업A',
};

assert.throws(() => assertIncomingConfirmed({ ...confirmedCarryover, ImportConfirmed: 0 }), /수입부 확정/);
assert.throws(() => planDeductionRegistration({
  row: { ...confirmedCarryover, ImportConfirmed: 0 }, targetYear: 2026, targetWeek: '33',
  requestKey: 'req-unconfirmed', customerShipmentExists: true, shipmentKey: 300, cost: 1100,
}), /수입부 확정/);
assert.throws(() => planDeductionRegistration({
  row: { ...confirmedCarryover, ImportReviewRequired: 1 }, targetYear: 2026, targetWeek: '33',
  requestKey: 'req-review', customerShipmentExists: true, shipmentKey: 300, cost: 1100,
}), /보완 필요/);

const firstPlan = planDeductionRegistration({
  row: confirmedCarryover, targetYear: 2026, targetWeek: '33', applyQuantity: 4,
  requestKey: 'req-partial-33', customerShipmentExists: true, shipmentKey: 3300, cost: 1100,
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
  customerShipmentExists: true, shipmentKey: 3400, cost: 1200,
});
const secondApplied = applyDeductionRegistrationPlan(firstApplied.row, secondPlan);
assert.equal(secondApplied.row.RemainingQuantity, 0);
assert.equal(secondApplied.row.Status, 'COMPLETED');
assert.equal(secondApplied.application.AppliedOrderWeek, '34');

const duplicatePlan = planDeductionRegistration({
  row: firstApplied.row, targetYear: 2026, targetWeek: '33', applyQuantity: 4,
  requestKey: 'req-partial-33', existingRequestKeys: ['req-partial-33'],
  customerShipmentExists: true, shipmentKey: 3300, cost: 1100,
});
assert.deepEqual(duplicatePlan, { action: 'IDEMPOTENT', writeCount: 0, requestKey: 'req-partial-33' });
assert.equal(applyDeductionRegistrationPlan(firstApplied.row, duplicatePlan).writeCount, 0);

const completedPlan = planDeductionRegistration({
  row: secondApplied.row, targetYear: 2026, targetWeek: '35', requestKey: 'req-after-complete',
  customerShipmentExists: true, shipmentKey: 3500, cost: 1250,
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
