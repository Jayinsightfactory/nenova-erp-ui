import assert from 'node:assert/strict';
import {
  executeEstimateDeductionDelete,
  normalizeEstimateDeductionDeleteRequest,
} from '../lib/estimateDeductionDelete.js';
import { assertIdempotentApplicationEstimateLive } from '../lib/salesDefectDeductions.js';

const sql = {
  Int: 'Int', NVarChar: 'NVarChar', DateTime: 'DateTime',
  Decimal: () => 'Decimal',
};
const guard = { token: 'guard', clientId: 'browser' };

const clone = (value) => JSON.parse(JSON.stringify(value));
const value = (params, name) => params?.[name]?.value;

function estimate({ estimateKey, shipmentKey, prodKey, orderYear = '2026', orderWeek = '34-01', custKey = 77, estimateType = 'KR0010', typeDescr2 = '불량차감', quantity = -2, cost = 1100, amount = -2000, vat = -200, unit = '단', descr = '', estimateDate = '2026-08-20' }) {
  return { EstimateKey: estimateKey, ShipmentKey: shipmentKey, ProdKey: prodKey, OrderYear: orderYear, OrderWeek: orderWeek, CustKey: custKey, EstimateType: estimateType, TypeDescr: '', TypeDescr2: typeDescr2, Quantity: quantity, Cost: cost, Amount: amount, Vat: vat, Unit: unit, Descr: descr, EstimateDate: estimateDate, RawEstimateDtm: estimateDate ? `${estimateDate}T13:45:00` : null, isDeleted: 0 };
}

function entry(row) {
  return {
    estimateKey: row.EstimateKey, shipmentKey: row.ShipmentKey, prodKey: row.ProdKey,
    expected: { quantity: row.Quantity, cost: row.Cost, amount: row.Amount, vat: row.Vat, unit: row.Unit, estimateType: row.EstimateType, descr: row.Descr, estimateDate: row.EstimateDate },
  };
}

function baseState() {
  return {
    estimates: [
      estimate({ estimateKey: 101, shipmentKey: 7101, prodKey: 9001 }),
      estimate({ estimateKey: 102, shipmentKey: 7102, prodKey: 9002, estimateType: 'KR0013', typeDescr2: '검역 차감', quantity: -3, cost: 1200, amount: -3273, vat: -327 }),
      estimate({ estimateKey: 201, shipmentKey: 7201, prodKey: 9001, orderYear: '2025' }),
      estimate({ estimateKey: 103, shipmentKey: 7103, prodKey: 9003, quantity: 2 }),
      estimate({ estimateKey: 104, shipmentKey: 7104, prodKey: 9004, estimateType: 'KR0014', typeDescr2: '판매요청' }),
    ],
    ledgers: [
      { DeductionKey: 301, CustKey: 77, ProdKey: 9001, EstimateKey: 101, EstimateCost: 1100, EstimateDtm: '2026-08-20', AppliedOrderYear: 2026, AppliedOrderWeek: '34', AppliedShipmentKey: 7101, Quantity: 2, OriginalQuantity: 2, RemainingQuantity: 2, IsCarryoverLedger: 0, IsDeleted: 0, Status: 'REGISTERED', RowVersionNo: 4, SourceUnit: '단', CreatedBy: 'sales-a', ImportConfirmed: 1 },
      { DeductionKey: 302, CustKey: 77, ProdKey: 9002, EstimateKey: 102, EstimateCost: 1200, EstimateDtm: '2026-08-20', AppliedOrderYear: 2026, AppliedOrderWeek: '34', AppliedShipmentKey: 7102, Quantity: 10, OriginalQuantity: 10, RemainingQuantity: 4, IsCarryoverLedger: 1, IsDeleted: 0, Status: 'CARRYOVER', RowVersionNo: 8, SourceUnit: '단', CreatedBy: 'sales-a', ImportConfirmed: 1 },
    ],
    applications: [
      { ApplicationKey: 1, DeductionKey: 302, EstimateKey: 102, AppliedOrderYear: 2026, AppliedOrderWeek: '34', AppliedShipmentKey: 7102, AppliedQuantity: 3, AppliedCost: 1200, AppliedAt: '2026-08-20T10:00:00' },
      { ApplicationKey: 2, DeductionKey: 302, EstimateKey: 777, AppliedOrderYear: 2026, AppliedOrderWeek: '35', AppliedShipmentKey: 7770, AppliedQuantity: 3, AppliedCost: 1300, AppliedAt: '2026-08-21T10:00:00' },
    ],
    history: [], audit: [], writes: [],
  };
}

function fakeQuery(state, { failAudit = false, schema = [1, 1, 1], corruptLedger = false } = {}) {
  return async (text, params = {}) => {
    if (text.includes('AS DeductionReady')) return { recordset: [{ DeductionReady: schema[0], ApplicationReady: schema[1], HistoryReady: schema[2] }] };
    if (text.includes('FROM Estimate e WITH') && text.includes('JOIN ShipmentMaster')) {
      const row = state.estimates.find((item) => item.EstimateKey === value(params, 'ek')
        && item.ShipmentKey === value(params, 'sk') && item.ProdKey === value(params, 'pk')
        && item.OrderYear === String(value(params, 'year')) && item.CustKey === value(params, 'cust')
        && Number(item.OrderWeek.split('-')[0]) === value(params, 'week'));
      return { recordset: row ? [clone(row)] : [] };
    }
    if (text.startsWith('DECLARE @Deleted')) {
      const key = value(params, 'ek');
      const index = state.estimates.findIndex((item) => item.EstimateKey === key && item.ShipmentKey === value(params, 'sk') && item.ProdKey === value(params, 'pk'));
      if (index < 0) return { recordset: [], rowsAffected: [0] };
      state.estimates.splice(index, 1);
      state.writes.push(`delete:${key}`);
      return { recordset: [{ EstimateKey: key }], rowsAffected: [1] };
    }
    if (text.startsWith('SELECT EstimateKey FROM Estimate WITH')) {
      return { recordset: state.estimates.filter((item) => item.EstimateKey === value(params, 'ek')).map(clone) };
    }
    if (text.includes('FROM WebSalesDefectDeduction WITH') && text.includes('WHERE DeductionKey=@key')) {
      return { recordset: state.ledgers.filter((row) => row.DeductionKey === value(params, 'key')).map(clone) };
    }
    if (text.includes('FROM WebSalesDefectDeduction WITH')) {
      const key = value(params, 'ek');
      return { recordset: state.ledgers.filter((row) => !row.IsDeleted && row.EstimateKey === key).map(clone) };
    }
    if (text.includes('FROM WebSalesDefectDeduction d WITH') && text.includes('WebSalesCarryoverApplication')) {
      const key = value(params, 'ek');
      const deductionKeys = new Set(state.applications.filter((row) => row.EstimateKey === key).map((row) => row.DeductionKey));
      return { recordset: state.ledgers.filter((row) => !row.IsDeleted && deductionKeys.has(row.DeductionKey)).map(clone) };
    }
    if (text.includes('FROM WebSalesCarryoverApplication a WITH')) {
      const key = value(params, 'key');
      return { recordset: state.applications.filter((row) => row.DeductionKey === key).map((row) => ({
        ...clone(row), EstimateLive: row.EstimateKey === 777 ? 1 : state.estimates.some((e) => e.EstimateKey === row.EstimateKey) ? 1 : 0,
        EstimateDtm: row.EstimateKey === 777 ? '2026-08-21' : null,
      })).sort((a, b) => b.ApplicationKey - a.ApplicationKey) };
    }
    if (text.startsWith('UPDATE WebSalesDefectDeduction')) {
      const row = state.ledgers.find((item) => item.DeductionKey === value(params, 'key'));
      assert.ok(row, '연결 원장 행을 갱신해야 한다.');
      if (text.includes("Status=N'DRAFT'")) {
        row.EstimateKey = null; row.EstimateCost = null; row.EstimateDtm = null; row.AppliedOrderYear = null; row.AppliedOrderWeek = null; row.AppliedShipmentKey = null; row.AppliedCostSourceYear = null; row.AppliedCostSourceWeek = null; row.Status = 'DRAFT';
      } else {
        row.EstimateKey = value(params, 'estimateKey'); row.EstimateCost = value(params, 'cost'); row.EstimateDtm = value(params, 'date'); row.AppliedOrderYear = value(params, 'year'); row.AppliedOrderWeek = value(params, 'week') || null; row.AppliedShipmentKey = value(params, 'shipment'); row.AppliedCostSourceYear = value(params, 'sourceYear'); row.AppliedCostSourceWeek = value(params, 'sourceWeek') || null; row.RemainingQuantity = value(params, 'remaining'); row.Status = value(params, 'status');
      }
      row.RowVersionNo += 1; state.writes.push(`ledger:${row.DeductionKey}`);
      if (corruptLedger) row.RowVersionNo += 1;
      return { recordset: [], rowsAffected: [1] };
    }
    if (text.includes('INSERT INTO WebSalesDefectDeductionHistory')) {
      state.history.push({ key: value(params, 'key'), before: value(params, 'before'), after: value(params, 'after') });
      return { recordset: [], rowsAffected: [1] };
    }
    if (text.includes('INSERT INTO SystemActionLog')) {
      if (failAudit) throw new Error('감사 로그 저장 실패');
      state.audit.push(JSON.parse(value(params, 'payload'))); state.writes.push('audit');
      return { recordset: [], rowsAffected: [1] };
    }
    throw new Error(`fixture가 처리하지 못한 SQL: ${text.slice(0, 80)}`);
  };
}

async function run(state, request, options = {}) {
  const staged = clone(state);
  const tQ = fakeQuery(staged, options);
  const result = await executeEstimateDeductionDelete(tQ, request, {
    sql, user: { userId: 'sales-a', userName: '영업A', sessionId: 'session-1' },
    assertEditGuard: async () => {},
    advanceEditGuard: async () => ({ editDigestAfter: 'after-digest', revision: 12 }),
  });
  Object.assign(state, staged);
  return result;
}

const state = baseState();
const request = normalizeEstimateDeductionDeleteRequest({ orderYear: '2026', orderWeek: '34', custKey: 77, editGuard: { token: 'guard', clientId: 'browser' }, entries: [entry(state.estimates[0]), entry(state.estimates[1])] });
const result = await run(state, request);
assert.deepEqual(result.deletedEstimateKeys, [101, 102]);
assert.equal(result.deletedCount, 2);
assert.equal(result.linkedRegistrationCount, 2);
assert.equal(result.editDigestAfter, 'after-digest');
assert.equal(result.revision, 12);
assert.ok(state.estimates.some((row) => row.EstimateKey === 201), '2025 같은 34차 견적은 삭제하면 안 된다.');
assert.ok(state.estimates.some((row) => row.EstimateKey === 103), '정상 출고는 선택 삭제에 포함되면 안 된다.');
assert.equal(state.ledgers.find((row) => row.DeductionKey === 301).Status, 'DRAFT');
const carryover = state.ledgers.find((row) => row.DeductionKey === 302);
assert.equal(carryover.RemainingQuantity, 7, '삭제된 이월 application 수량 3만 복원해야 한다.');
assert.equal(carryover.EstimateKey, 777, '다른 차수의 최신 살아있는 application 연결은 유지해야 한다.');
assert.equal(carryover.AppliedOrderWeek, '35');
assert.equal(state.applications.length, 2, '이월 application 과거 이력은 삭제하면 안 된다.');
assert.equal(state.history.length, 2);
assert.equal(state.audit.length, 1);
assert.equal(state.audit[0].selected[0].estimateType, 'KR0010', '표시명 대신 원본 EstimateType 코드를 감사해야 한다.');
assert.equal(state.audit[0].selected[0].estimateDtm, '2026-08-20T13:45:00', '감사 스냅샷은 EstimateDtm의 원본 시각을 보존해야 한다.');

const staleState = baseState();
const stale = entry(staleState.estimates[0]);
stale.expected.cost = 999;
await assert.rejects(() => run(staleState, normalizeEstimateDeductionDeleteRequest({ orderYear: '2026', orderWeek: '34', custKey: 77, editGuard: { token: 'guard', clientId: 'browser' }, entries: [stale] })), /조회 이후 변경/);
assert.equal(staleState.writes.length, 0, '스냅샷 불일치는 어떤 삭제도 시작하면 안 된다.');

const batchState = baseState();
await assert.rejects(() => run(batchState, normalizeEstimateDeductionDeleteRequest({ orderYear: '2026', orderWeek: '34', custKey: 77, editGuard: { token: 'guard', clientId: 'browser' }, entries: [entry(batchState.estimates[0]), entry(batchState.estimates.find((row) => row.EstimateKey === 104))] })), /불량차감 또는 검역차감/);
assert.equal(batchState.writes.length, 0, '부분 배치가 부적격이면 첫 행도 삭제하면 안 된다.');

const rollbackState = baseState();
await assert.rejects(() => run(rollbackState, normalizeEstimateDeductionDeleteRequest({ orderYear: '2026', orderWeek: '34', custKey: 77, editGuard: { token: 'guard', clientId: 'browser' }, entries: [entry(rollbackState.estimates[0])] }), { failAudit: true }), /감사 로그 저장 실패/);
assert.equal(rollbackState.estimates.length, 5, '감사 실패는 실제 트랜잭션에서 전체 rollback 되어야 한다.');
assert.equal(rollbackState.ledgers.find((row) => row.DeductionKey === 301).EstimateKey, 101);

const readbackRollbackState = baseState();
await assert.rejects(() => run(readbackRollbackState, normalizeEstimateDeductionDeleteRequest({ orderYear: '2026', orderWeek: '34', custKey: 77, editGuard: { token: 'guard', clientId: 'browser' }, entries: [entry(readbackRollbackState.estimates[0])] }), { corruptLedger: true }), /버전 확인/);
assert.ok(readbackRollbackState.estimates.some((row) => row.EstimateKey === 101), '저장 후 원장 재조회 불일치도 전체 rollback 되어야 한다.');

const partialSchemaState = baseState();
await assert.rejects(() => run(partialSchemaState, normalizeEstimateDeductionDeleteRequest({ orderYear: '2026', orderWeek: '34', custKey: 77, editGuard: { token: 'guard', clientId: 'browser' }, entries: [entry(partialSchemaState.estimates[0])] }), { schema: [1, 0, 1] }), /스키마가 일부만/);
assert.equal(partialSchemaState.writes.length, 0, '부분 스키마는 Estimate 삭제 전에 503으로 중단해야 한다.');

const mismatchedLinkState = baseState();
mismatchedLinkState.ledgers[0].CustKey = 88;
await assert.rejects(() => run(mismatchedLinkState, normalizeEstimateDeductionDeleteRequest({ orderYear: '2026', orderWeek: '34', custKey: 77, editGuard: { token: 'guard', clientId: 'browser' }, entries: [entry(mismatchedLinkState.estimates[0])] })), /업체 또는 품목/);
assert.equal(mismatchedLinkState.writes.length, 0, '손상된 타 업체 웹 원장을 갱신하면 안 된다.');

const fractionalState = baseState();
fractionalState.ledgers[1].RemainingQuantity = 1.1;
fractionalState.ledgers[1].OriginalQuantity = 2;
fractionalState.applications[0].AppliedQuantity = 0.2;
await run(fractionalState, normalizeEstimateDeductionDeleteRequest({ orderYear: '2026', orderWeek: '34', custKey: 77, editGuard: guard, entries: [entry(fractionalState.estimates.find((row) => row.EstimateKey === 102))] }));
assert.equal(fractionalState.ledgers.find((row) => row.DeductionKey === 302).RemainingQuantity, 1.3, '소수 이월 복원은 DECIMAL(18,4) 기준으로 반올림해야 한다.');

const sourcePreserveState = baseState();
sourcePreserveState.ledgers[1].EstimateKey = 777;
sourcePreserveState.ledgers[1].AppliedCostSourceYear = 2026;
sourcePreserveState.ledgers[1].AppliedCostSourceWeek = '31';
sourcePreserveState.applications[0].EstimateKey = 102;
sourcePreserveState.applications[0].AppliedQuantity = 1;
await run(sourcePreserveState, normalizeEstimateDeductionDeleteRequest({ orderYear: '2026', orderWeek: '34', custKey: 77, editGuard: guard, entries: [entry(sourcePreserveState.estimates.find((row) => row.EstimateKey === 102))] }));
assert.equal(sourcePreserveState.ledgers[1].EstimateKey, 777);
assert.equal(sourcePreserveState.ledgers[1].AppliedCostSourceYear, 2026, '살아있는 현재 연결 포인터가 유지되면 단가 원천도 보존해야 한다.');

const legacySuffixState = baseState();
const legacySuffixes = ['단', '박스', '송이', '스팀', '스팀(대)', '대', '개', '봉지'];
const legacyRows = legacySuffixes.map((suffix, index) => estimate({
  estimateKey: 500 + index, shipmentKey: 7500 + index, prodKey: 9500 + index,
  estimateType: `${index % 2 ? '검역차감' : '불량차감'}/${suffix}`, typeDescr2: '',
}));
legacySuffixState.estimates.push(...legacyRows);
const legacySuffixResult = await run(legacySuffixState, normalizeEstimateDeductionDeleteRequest({
  orderYear: '2026', orderWeek: '34', custKey: 77, editGuard: guard, entries: legacyRows.map(entry),
}));
assert.equal(legacySuffixResult.deletedCount, legacySuffixes.length, '단·박스·송이·스팀·스팀(대)·대·개·봉지 레거시 접미사는 모두 삭제 대상이어야 한다.');
assert.ok(legacyRows.every((row) => !legacySuffixState.estimates.some((stored) => stored.EstimateKey === row.EstimateKey)));

const invalidSuffixState = baseState();
const invalidSuffixRow = estimate({ estimateKey: 600, shipmentKey: 7600, prodKey: 9600, estimateType: '불량차감/임의단위', typeDescr2: '' });
invalidSuffixState.estimates.push(invalidSuffixRow);
await assert.rejects(
  () => run(invalidSuffixState, normalizeEstimateDeductionDeleteRequest({ orderYear: '2026', orderWeek: '34', custKey: 77, editGuard: guard, entries: [entry(invalidSuffixRow)] })),
  /불량차감 또는 검역차감/,
);
assert.equal(invalidSuffixState.writes.length, 0, '임의 접미사 유형은 삭제 쓰기를 시작하면 안 된다.');

await assert.rejects(
  () => assertIdempotentApplicationEstimateLive(async () => ({ recordset: [] }), { EstimateKey: 101 }),
  /기존 견적서 등록이 취소되었습니다/,
  '삭제된 Estimate를 가리키는 동일 이월 요청은 성공 재생하면 안 된다.',
);
await assert.doesNotReject(
  () => assertIdempotentApplicationEstimateLive(async () => ({ recordset: [{ EstimateKey: 101 }] }), { EstimateKey: 101 }),
  '살아있는 Estimate의 동일 요청만 기존 멱등 응답을 허용해야 한다.',
);

assert.throws(() => normalizeEstimateDeductionDeleteRequest({ orderYear: '2026', orderWeek: '34', custKey: 77, editGuard: guard, entries: [entry(baseState().estimates[0]), entry(baseState().estimates[0])] }), /중복 선택/);
assert.throws(() => normalizeEstimateDeductionDeleteRequest({ orderYear: '2026', orderWeek: '34', custKey: 77, editGuard: guard, entries: [{ ...entry(baseState().estimates[0]), estimateKey: '101' }] }), /정수/);
assert.doesNotThrow(() => normalizeEstimateDeductionDeleteRequest({ orderYear: '2026', orderWeek: '34', custKey: 77, editGuard: guard, entries: [{ ...entry(baseState().estimates[0]), expected: { ...entry(baseState().estimates[0]).expected, estimateDate: null } }] }), 'EstimateDtm NULL 원본 스냅샷은 허용해야 한다.');
const nullDateState = baseState();
nullDateState.estimates[0].EstimateDate = null;
await run(nullDateState, normalizeEstimateDeductionDeleteRequest({ orderYear: '2026', orderWeek: '34', custKey: 77, editGuard: guard, entries: [entry(nullDateState.estimates[0])] }));
assert.ok(!nullDateState.estimates.some((row) => row.EstimateKey === 101), 'EstimateDtm NULL은 fallback 날짜 없이 null 스냅샷과 대조해야 한다.');

console.log('estimate deduction delete tests passed');
