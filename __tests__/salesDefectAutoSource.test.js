import assert from 'node:assert/strict';
import './salesDefectSourceReconciliation.test.js';
import './defectSourceRelease.test.js';
import './salesDefectRegistrationProvenance.test.js';
import fs from 'node:fs';
import {
  AUTO_SOURCE_ESTIMATE_CONFLICT,
  AUTO_SOURCE_REVIEW_REQUIRED,
  assertNotDefectAutoSource,
  autoSourceStateFromRow,
  buildDefectAutoSourceSql,
  detectDefectAutoSource,
} from '../lib/salesDefectAutoSource.js';
import { evaluateDefectRegistrationEligibility } from '../lib/defectEstimateTargetScope.js';
import { planDeductionRegistration, planManualProcessingComplete } from '../lib/salesDefectDeductionState.js';
import { canEditManualCost, saveManualCost } from '../lib/salesDefectManualCost.js';
import {
  preflightRegistration,
  registerDeductions,
  registrationPreview,
  saveDraftRows,
  syncLinkedEstimate,
} from '../lib/salesDefectDeductions.js';
import {
  deriveSupportProcessingStatus,
  isSupportManualCompleteSelectable,
  supportRegistrationDecisionLabel,
} from '../lib/salesDefectSupportStatus.js';

const manual = {
  DeductionKey: 11, OrderYear: 2026, OrderWeek: '41', CustKey: 101, ProdKey: 201,
  Quantity: 3, RemainingQuantity: 3, SourceUnit: '단', Status: 'DRAFT', IsDeleted: 0,
  EstimateKey: null, AutoSourceExcluded: 0,
};
const auto = { ...manual, DeductionKey: 12, SourceFileName: '  KAKAO-DEFECT:chat-12', AutoSourceExcluded: 0 };

assert.equal(detectDefectAutoSource({ row: auto }).excluded, true, 'current source marker is case-insensitive and trimmed');
assert.equal(autoSourceStateFromRow(auto).excluded, true, 'a false projected flag cannot override a current marker');
assert.equal(detectDefectAutoSource({ row: { Note: 'kakao-defect: pasted message' } }).evidence, 'KAKAO_SOURCE');
assert.equal(detectDefectAutoSource({
  row: { SourceFileName: 'manual.xlsx', Note: 'edited' },
  histories: [{ BeforeJson: '{bad json', AfterJson: JSON.stringify({ sourceFileName: 'kakao-defect:history' }) }],
}).evidence, 'HISTORY_SOURCE', 'malformed JSON is skipped while another valid snapshot remains sticky');
assert.equal(detectDefectAutoSource({
  row: { SourceFileName: 'manual.xlsx', Note: '' },
  histories: [{ BeforeJson: JSON.stringify({ SourceFileName: 'KAKAO-DEFECT:legacy' }), AfterJson: '{}' }],
}).excluded, true, 'legacy uppercase snapshot keys remain detectable');
assert.equal(detectDefectAutoSource({
  row: { SourceFileName: 'manual.xlsx', Note: 'ordinary memo', CreatedBy: 'kakao-defect:actor', ImportConfirmed: true },
  histories: [{ BeforeJson: JSON.stringify({ createdBy: 'kakao-defect:not-source' }) }],
}).excluded, false, 'actor and confirmation metadata are never source evidence');

for (const row of [
  auto,
  { ...manual, AutoSourceExcluded: 1, AutoSourceEvidence: 'HISTORY_SOURCE', ImportConfirmed: true },
  { ...manual, AutoSourceExcluded: 1, OrderYear: 2025, OrderWeek: '41', IsCarryoverLedger: 1 },
]) {
  assert.throws(() => assertNotDefectAutoSource(row), (error) => error.code === AUTO_SOURCE_REVIEW_REQUIRED);
  assert.equal(planDeductionRegistration({
    row, targetYear: 2026, targetWeek: '41', customerShipmentExists: true, shipmentKey: 1, cost: 1000,
    requestKey: 'automatic-history-carryover',
  }).action, 'APPLY');
  assert.throws(() => planManualProcessingComplete({ row, targetYear: 2026, targetWeek: '41' }), (error) => error.code === AUTO_SOURCE_REVIEW_REQUIRED);
  assert.equal(canEditManualCost(row), false);
}

assert.equal(evaluateDefectRegistrationEligibility({
  row: { ...manual, autoSourceExcluded: true }, context: { shipmentKey: 1, cost: 1000 },
}).eligible, true);
assert.equal(evaluateDefectRegistrationEligibility({
  row: manual, context: { shipmentKey: 1, cost: 1000 }, exactExistingEstimate: true, exactExistingAutoSource: true,
}).code, AUTO_SOURCE_ESTIMATE_CONFLICT);
assert.equal(evaluateDefectRegistrationEligibility({ row: manual, context: { shipmentKey: 1, cost: 1000 } }).eligible, true);
for (const customer of [533, 565]) {
  const row = { ...manual, custKey: customer, orderYear: 2026, orderWeek: '43', autoSourceExcluded: true };
  assert.equal(evaluateDefectRegistrationEligibility({ row, context: { shipmentKey: 1, cost: 1000 } }).eligible, true);
  assert.equal(evaluateDefectRegistrationEligibility({ row, context: { cost: 1000 } }).code, 'CUSTOMER_SALE_MISSING');
  assert.equal(evaluateDefectRegistrationEligibility({ row, context: { shipmentKey: 1, cost: 0 } }).code, 'COST_MISSING');
  assert.equal(evaluateDefectRegistrationEligibility({ row, context: { shipmentKey: 1, cost: 1000 }, exactExistingEstimate: true }).code, 'EXISTING_ESTIMATE');
}

const priorYearCarryover = planDeductionRegistration({
  row: { ...manual, OrderYear: 2025, OrderWeek: '41', IsCarryoverLedger: 1, OriginalQuantity: 3 },
  targetYear: 2026, targetWeek: '41', applyQuantity: 2, requestKey: 'manual-carryover-2026-41',
  customerShipmentExists: true, shipmentKey: 5001, cost: 1200,
});
assert.equal(priorYearCarryover.action, 'APPLY', 'marker-free prior-year manual carryover remains supported');

const autoUi = { ...manual, deductionKey: 12, autoSourceExcluded: true, registrationEligibilityCode: AUTO_SOURCE_REVIEW_REQUIRED };
assert.equal(deriveSupportProcessingStatus(autoUi).processingStatus, 'UNREGISTERED');
assert.equal(isSupportManualCompleteSelectable(autoUi), false);
assert.equal(supportRegistrationDecisionLabel(autoUi), '자동수집 자료 · 별도 검토');

let linkedWrites = 0;
await assert.rejects(
  syncLinkedEstimate(async (statement) => {
    if (/\b(?:INSERT|UPDATE|DELETE)\b/i.test(String(statement))) linkedWrites += 1;
    return { recordset: [] };
  }, { year: 2026, week: '41', item: {}, estimateKey: 901, autoSourceRow: auto }),
  (error) => error.code === AUTO_SOURCE_REVIEW_REQUIRED,
);
assert.equal(linkedWrites, 0, 'linked Estimate guard runs before any query/write');

const autoDbRow = {
  ...auto, AutoSourceExcluded: 1, AutoSourceEvidence: 'KAKAO_SOURCE', RowVersionNo: 1,
  CustName: '자동 업체', ProdName: '자동 품목', ImportConfirmed: 1,
};
const autoReadOnlyQueries = [];
const autoReadOnlyQuery = async (statement) => {
  autoReadOnlyQueries.push(String(statement));
  if (/CodeInfo/.test(statement)) return { recordset: [{ DetailCode: '불량차감' }] };
  if (/FROM WebSalesDefectDeduction d/.test(statement)) return { recordset: [autoDbRow] };
  if (/FROM Product/.test(statement)) return { recordset: [{ ProdKey: 201, ProdName: '자동 품목', EstUnit: '단' }] };
  if (/FROM Estimate/.test(statement)) return { recordset: [] };
  throw new Error(`unexpected auto read query: ${statement}`);
};
const autoPreflight = await preflightRegistration({ year: 2026, week: '41', rows: [{ deductionKey: 12 }] }, autoReadOnlyQuery);
assert.notEqual(autoPreflight[0].errorCode, AUTO_SOURCE_REVIEW_REQUIRED);
const autoPreview = await registrationPreview({ year: 2026, week: '41', ids: [12] }, autoReadOnlyQuery);
assert.notEqual(autoPreview[0].errorCode, AUTO_SOURCE_REVIEW_REQUIRED, 'direct preview URL uses the same registration eligibility rules');
assert.equal(autoReadOnlyQueries.some((statement) => /\b(?:INSERT|UPDATE|DELETE)\b/i.test(statement)), false);

const manualDbRow = {
  ...manual, DeductionKey: 13, CustName: '수동 업체', ProdName: '수동 품목', RowVersionNo: 1,
  AutoSourceExcluded: 0, AutoSourceEvidence: '', ImportConfirmed: 0,
};
const registerRows = new Map([[12, { ...autoDbRow }], [13, { ...manualDbRow }]]);
const registerWrites = [];
const value = (params, name) => params?.[name]?.value;
const fakeRegisterQuery = async (statement, params = {}) => {
  const source = String(statement);
  if (/\b(?:INSERT|UPDATE|DELETE)\b/i.test(source)) registerWrites.push({ source, key: value(params, 'key') });
  if (/sp_getapplock/.test(source)) return { recordset: [{ LockResult: 0 }] };
  if (/CodeInfo/.test(source)) return { recordset: [{ DetailCode: '불량차감' }] };
  if (/FROM WebSalesDefectDeduction d/.test(source)) return { recordset: [{ ...registerRows.get(Number(value(params, 'key'))) }] };
  if (/FROM ShipmentMaster sm/.test(source) && /TargetOrderYear/.test(source)) {
    return { recordset: [{ ShipmentKey: 8001, OrderWeek: '41-01', ShipmentProdKey: 999, ShipmentOutQuantity: 2, ShipmentDtm: '2026-10-13', MasterFix: 0, ShipmentDetailFix: 0 }] };
  }
  if (/SourceOrderYear/.test(source) && /CostSource/.test(source)) {
    return { recordset: [{ Cost: 1200, CostSource: 'ShipmentDetail.Cost', SourceOrderYear: 2026, SourceOrderWeek: '40-01', SourceShipmentKey: 7999 }] };
  }
  if (/SELECT TOP 1 EstUnit, OutUnit FROM Product/.test(source)) return { recordset: [{ EstUnit: '단', OutUnit: '단' }] };
  if (/ActionType=@action/.test(source)) return { recordset: [] };
  if (/SELECT e\.EstimateKey/.test(source)) return { recordset: [] };
  if (/INSERT INTO Estimate/.test(source)) return { recordset: [{ EstimateKey: 9101 }] };
  if (/UPDATE WebSalesDefectDeduction/.test(source)) {
    const row = registerRows.get(Number(value(params, 'key')));
    row.EstimateKey = Number(value(params, 'ek'));
    row.EstimateCost = Number(value(params, 'cost'));
    row.Status = 'REGISTERED';
    row.AppliedOrderYear = Number(value(params, 'appliedYear'));
    row.AppliedOrderWeek = String(value(params, 'appliedWeek'));
    row.AppliedShipmentKey = Number(value(params, 'appliedShipmentKey'));
    return { rowsAffected: [1], recordset: [] };
  }
  if (/INSERT INTO WebSalesDefectDeductionHistory/.test(source)) return { recordset: [] };
  throw new Error(`unexpected registration query: ${source}`);
};
const mixed = await registerDeductions({
  year: 2026, week: '41', ids: [12, 13], user: { userId: 'support', userName: '지원' },
}, {
  ensureTables: async () => {},
  withTransaction: async (callback) => callback(fakeRegisterQuery, { attempt: 0 }),
});
assert.equal(mixed.registered.length, 2);
assert.equal(mixed.registered.some((row) => row.deductionKey === 12), true, 'auto-source row can register when ordinary eligibility passes');
assert.equal(mixed.skipped.length, 0);
assert.equal(registerWrites.some((entry) => entry.key === 12), true, 'eligible auto row is written through the normal guarded path');
assert.equal(registerWrites.some((entry) => /INSERT INTO Estimate/.test(entry.source)), true, 'marker-free manual row still registers');
registerRows.set(12, { ...autoDbRow });
const eligibleAutoPreflight = await preflightRegistration({ year: 2026, week: '41', rows: [{ deductionKey: 12 }] }, fakeRegisterQuery);
assert.equal(eligibleAutoPreflight[0].error, '', 'automatic source passes actual service preflight with valid shipment and cost');
assert.equal(Number(eligibleAutoPreflight[0].shipmentKey), 8001);
assert.equal(Number(eligibleAutoPreflight[0].cost), 1200);

const overrideWrites = [];
const overrideMarkerResult = await registerDeductions({
  year: 2026, week: '41', ids: [13], user: { userId: 'support', userName: '지원' },
  overrides: { 13: { quantity: 3, note: 'kakao-defect:direct-override', sourceUnit: '단' } },
}, {
  ensureTables: async () => {},
  withTransaction: async (callback) => callback(async (statement, params = {}) => {
    const source = String(statement);
    if (/\b(?:INSERT|UPDATE|DELETE)\b/i.test(source)) overrideWrites.push(source);
    if (/CodeInfo/.test(source)) return { recordset: [{ DetailCode: '불량차감' }] };
    if (/FROM WebSalesDefectDeduction d/.test(source)) return { recordset: [{ ...manualDbRow }] };
    throw new Error(`unexpected override marker query: ${source}`);
  }, { attempt: 0 }),
});
assert.notEqual(overrideMarkerResult.skipped[0]?.errorCode, AUTO_SOURCE_REVIEW_REQUIRED);

let finalReadCount = 0;
const finalRereadWrites = [];
const finalRereadResult = await registerDeductions({
  year: 2026, week: '41', ids: [13], user: { userId: 'support', userName: '지원' },
  overrides: { 13: { quantity: 3, note: 'ordinary review', sourceUnit: '단' } },
}, {
  ensureTables: async () => {},
  withTransaction: async (callback) => callback(async (statement, params = {}) => {
    const source = String(statement);
    if (/\b(?:INSERT|UPDATE|DELETE)\b/i.test(source)) finalRereadWrites.push(source);
    if (/sp_getapplock/.test(source)) return { recordset: [{ LockResult: 0 }] };
    if (/CodeInfo/.test(source)) return { recordset: [{ DetailCode: '불량차감' }] };
    if (/FROM WebSalesDefectDeduction d/.test(source)) {
      finalReadCount += 1;
      return { recordset: [{ ...registerRows.get(13), AutoSourceExcluded: finalReadCount >= 2 ? 1 : 0,
        AutoSourceEvidence: finalReadCount >= 2 ? 'HISTORY_SOURCE' : '' }] };
    }
    if (/FROM ShipmentMaster sm/.test(source) && /TargetOrderYear/.test(source)) {
      return { recordset: [{ ShipmentKey: 8001, OrderWeek: '41-01', ShipmentProdKey: 999,
        ShipmentOutQuantity: 2, ShipmentDtm: '2026-10-13', MasterFix: 0, ShipmentDetailFix: 0 }] };
    }
    if (/SourceOrderYear/.test(source) && /CostSource/.test(source)) {
      return { recordset: [{ Cost: 1200, CostSource: 'ShipmentDetail.Cost', SourceOrderYear: 2026,
        SourceOrderWeek: '40-01', SourceShipmentKey: 7999 }] };
    }
    if (/SELECT TOP 1 EstUnit, OutUnit FROM Product/.test(source)) return { recordset: [{ EstUnit: '단', OutUnit: '단' }] };
    if (/ActionType=@action/.test(source)) return { recordset: [] };
    if (/SELECT e\.EstimateKey/.test(source)) return { recordset: [] };
    return fakeRegisterQuery(statement, params);
  }, { attempt: 0 }),
});
assert.equal(finalRereadResult.registered.length, 1);
assert.ok(finalReadCount >= 2, 'final locked reread retains provenance without excluding registration');
assert.ok(finalRereadWrites.length > 0, 'eligible automatic history uses the normal write path');

const linkedDraftWrites = [];
const linkedManualRow = {
  ...manualDbRow, EstimateKey: 9100, CreatedBy: 'support', CreatedByName: '지원',
  AppliedOrderYear: 2026, AppliedOrderWeek: '41', AppliedShipmentKey: 8001,
};
await assert.rejects(saveDraftRows({
  year: 2026, week: '41', user: { userId: 'support', userName: '지원' },
  managerId: 'support', managerName: '지원',
  rows: [{ ...linkedManualRow, note: 'kakao-defect:linked-draft-tamper' }],
}, {
  ensure: async () => {},
  transaction: async (callback) => callback(async (statement) => {
    const source = String(statement);
    if (/\b(?:INSERT|UPDATE|DELETE)\b/i.test(source)) linkedDraftWrites.push(source);
    if (/FROM WebSalesDefectDeduction d/.test(source)) return { recordset: [{ ...linkedManualRow }] };
    throw new Error(`unexpected linked draft query: ${source}`);
  }),
}), (error) => error.code === AUTO_SOURCE_REVIEW_REQUIRED);
assert.equal(linkedDraftWrites.length, 0,
  'a new marker on a linked manual draft is rejected before ledger/Estimate/History writes');

for (const blockedRow of [auto, { ...manual, AutoSourceExcluded: 1, AutoSourceEvidence: 'HISTORY_SOURCE' }]) {
  const calls = [];
  await assert.rejects(
    saveManualCost({
      year: 2026, week: '41', deductionKey: blockedRow.DeductionKey, cost: 1000,
      expectedRowVersionNo: 1, expectedEstimateUnit: '단', custKey: blockedRow.CustKey,
      prodKey: blockedRow.ProdKey, user: { userId: 'support', userName: '지원' },
    }, async (callback) => callback(async (statement) => {
      calls.push(String(statement));
      return { recordset: [{ ...blockedRow, RowVersionNo: 1 }] };
    })),
    (error) => error.code === AUTO_SOURCE_REVIEW_REQUIRED,
  );
  assert.equal(calls.filter((statement) => /\b(?:INSERT|UPDATE|DELETE)\b/i.test(statement)).length, 0,
    'manual cost guard blocks current/history-only auto sources before writes');
}

const sql = buildDefectAutoSourceSql('d');
assert.match(sql.predicate, /SourceFileName/);
assert.match(sql.predicate, /BeforeJson/);
assert.match(sql.predicate, /AfterJson/);
assert.match(sql.predicate, /ISJSON\(autoHistory\.BeforeJson\)/);
assert.doesNotMatch(sql.predicate, /CreatedBy|ImportConfirmed|ChangedBy|CreatedAt/);

const serviceSource = fs.readFileSync('lib/salesDefectDeductions.js', 'utf8');
const estimateLookupSource = serviceSource.slice(
  serviceSource.indexOf('async function loadExistingEstimateDeductions'),
  serviceSource.indexOf('async function assertNoExactUnlinkedEstimate'),
);
const archivedAutoLinkProjection = estimateLookupSource.slice(
  estimateLookupSource.indexOf('CASE WHEN EXISTS', estimateLookupSource.indexOf('AS WebLinked')),
  estimateLookupSource.indexOf('AS AutoSourceLinked'),
);
assert.match(archivedAutoLinkProjection, /wd\.EstimateKey=e\.EstimateKey[\s\S]*AUTO_SOURCE_WD\.predicate/,
  'automatic provenance remains linked to its Estimate after ledger archive');
assert.doesNotMatch(archivedAutoLinkProjection, /IsDeleted/,
  'archived automatic ledgers still cause AUTO_SOURCE_ESTIMATE_CONFLICT');
const saveSource = serviceSource.slice(serviceSource.indexOf('export async function saveDraftRows'), serviceSource.indexOf('export async function confirmIncomingDeductions'));
assert.doesNotMatch(saveSource, /SET[\s\S]{0,500}SourceFileName=@file/, 'existing draft update preserves original SourceFileName');
assert.ok(saveSource.indexOf('assertNotDefectAutoSource(before)') < saveSource.indexOf('UPDATE WebSalesDefectDeduction'),
  'linked auto source is rejected before the web ledger update');
const registerSource = serviceSource.slice(serviceSource.indexOf('export async function registerDeductions'), serviceSource.indexOf('export async function manageDeductions'));
assert.doesNotMatch(registerSource, /assertNotDefectAutoSource\(dbRow\)/,
  'automatic provenance alone cannot block ordinary registration');

console.log('salesDefectAutoSource tests passed');
