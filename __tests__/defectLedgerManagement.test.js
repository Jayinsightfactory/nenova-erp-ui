import assert from 'node:assert/strict';
import { normalizeManagementRequest, planDefectLedgerManagement, hasDefectProcessingHistory } from '../lib/defectLedgerManagement.js';
import { manageDeductions } from '../lib/salesDefectDeductions.js';
const user = { userId: 'support', userName: '지원', authority: 2 };
const raw = { DeductionKey: 252, OrderYear: 2026, OrderWeek: '36', RowVersionNo: 7,
  CustKey: 31, CustName: '영남', ProdKey: 2820, ProdName: 'Altair', Quantity: 15, SourceUnit: '단',
  Status: 'DRAFT', IsDeleted: false, CreatedBy: '영업담당', SourceFileName: '원문', Note: '원비고',
  ImportConfirmed: true, EstimateKey: null, OriginalQuantity: 15, RemainingQuantity: 15 };
const selection = { deductionKey: 252, sourceYear: 2026, sourceWeek: 36, expectedRowVersionNo: 7 };
const input = { action: 'manage-edit', year: 2026, week: 40, rows: [selection], user, changes: { quantity: 20 } };
const request = normalizeManagementRequest(input);
const planned = planDefectLedgerManagement({ request, selection, row: raw });
assert.equal(planned.after.Quantity, 20); assert.equal(planned.after.ImportConfirmed, false);
assert.equal(planned.after.CreatedBy, raw.CreatedBy); assert.equal(planned.after.SourceFileName, '원문');
for (const changes of [{ custKey: 32 }, { customerName: '업체 정정' }, { prodKey: 2821 }, { productName: '품명 정정' }]) {
  assert.equal(planDefectLedgerManagement({ request: { ...request, changes }, selection, row: raw }).importReset, true);
}
const app = [{ DeductionKey: 252, EstimateKey: 9471 }];
assert.throws(() => planDefectLedgerManagement({ request, selection, row: raw, applications: app }), /비고만/);
const preview = normalizeManagementRequest({ ...input, preview: true, changes: {} });
assert.equal(planDefectLedgerManagement({ request: preview, selection, row: raw, applications: app }).noteOnly, true);
const unlinkedHistory = [{ ActionType: 'ESTIMATE_UNLINK', BeforeJson: '{"estimateKey":9471}' }];
assert.throws(() => planDefectLedgerManagement({ request, selection, row: raw, histories: unlinkedHistory }), /비고만/);
assert.equal(planDefectLedgerManagement({ request: { ...request, changes: { note: '삭제 후 확인' } }, selection, row: raw, histories: unlinkedHistory }).noteOnly, true);
assert.equal(hasDefectProcessingHistory([{ ActionType: 'CREATE', AfterJson: '{"quantity":15}' }]), false);
assert.equal(hasDefectProcessingHistory([{ ActionType: 'INCOMING_CONFIRM', AfterJson: 'invalid JSON' }]), false);
assert.equal(hasDefectProcessingHistory([{ ActionType: 'UPDATE', BeforeJson: '{"EstimateKey":1}' }]), true);
const unappliedCarryover = planDefectLedgerManagement({ request, selection,
  row: { ...raw, Status: 'CARRYOVER', IsCarryoverLedger: true },
  histories: [{ ActionType: 'CARRYOVER_REGISTER', AfterJson: '{"status":"CARRYOVER","estimateKey":null}' }] });
assert.equal(unappliedCarryover.noteOnly, false);
assert.equal(unappliedCarryover.after.OriginalQuantity, 20);
assert.equal(unappliedCarryover.after.RemainingQuantity, 20);
for (const modify of [
  x => { x.user = { authority: 6 }; }, x => { x.year = 2025; },
  x => { x.rows = [{ ...selection, sourceWeek: 41 }]; },
  x => { x.rows = [selection, selection]; }, x => { x.changes = { EstimateKey: 1 }; },
  x => { x.rows = [{ ...selection, sourceWeek: '2025-36' }]; },
  x => { x.week = '2025-40'; },
]) { const x = structuredClone(input); modify(x); assert.throws(() => normalizeManagementRequest(x)); }
for (const row of [{ ...raw, RowVersionNo: 8 }, { ...raw, OrderYear: 2025 }, { ...raw, IsDeleted: true }]) {
  assert.throws(() => planDefectLedgerManagement({ request, selection, row }), /版本|버전|삭제/);
}
for (const status of ['REGISTERED', 'COMPLETED', 'MANUAL_COMPLETED']) {
  assert.throws(() => planDefectLedgerManagement({ request, selection, row: { ...raw, Status: status } }), /비고만/);
}
assert.throws(() => planDefectLedgerManagement({ request: { ...request, changes: { quantity: -1 } }, selection, row: raw }), /양수/);
assert.throws(() => planDefectLedgerManagement({ request: { ...request, changes: { sourceUnit: '알수없음' } }, selection, row: raw }), /단위/);
for (const quantity of [1e-8, 1.12345, 1e14, Infinity, true, null]) {
  assert.throws(() => planDefectLedgerManagement({ request: { ...request, changes: { quantity } }, selection, row: raw }));
}
assert.equal(planDefectLedgerManagement({ request: { ...request, changes: { quantity: 0.0001 } }, selection, row: raw }).after.Quantity, 0.0001);
assert.throws(() => planDefectLedgerManagement({ request: { ...request, changes: { custKey: true } }, selection, row: raw }));

// Execute the actual storage core against a transactional fixture. No production DB.
function fixture({ failHistory = false, failSecond = false, unmapped = false, invalidMatch = false } = {}) {
  let committed = { ledger: [{ ...raw, ...(unmapped ? { DeductionKey: 254, CustKey: null, ProdKey: null } : {}) }, { ...raw, DeductionKey: 253 }],
    histories: [], Estimate: [{ EstimateKey: 9471 }], applications: app,
    Order: ['preserve'], Shipment: ['preserve'], Stock: ['preserve'] };
  const queries = [];
  return { state: () => committed, queries, withTransaction: async (run) => {
    const state = structuredClone(committed);
    const query = async (sql, params = {}) => {
      queries.push(sql);
      const key = params.key?.value;
      if (/SELECT \* FROM WebSalesDefectDeduction/.test(sql)) return { recordset: structuredClone(state.ledger.filter((r) => r.DeductionKey === key)) };
      if (/SELECT \* FROM WebSalesCarryoverApplication/.test(sql)) return { recordset: state.applications.filter((r) => r.DeductionKey === key) };
      if (/SELECT ActionType,BeforeJson,AfterJson FROM WebSalesDefectDeductionHistory/.test(sql)) return { recordset: [] };
      if (/FROM (Customer|Product)/.test(sql)) return { recordset: invalidMatch ? [] : [{ id: params.id.value }] };
      if (/UPDATE WebSalesDefectDeduction/.test(sql)) {
        if (failSecond && key === 253) throw new Error('second update failure');
        const row = state.ledger.find((r) => r.DeductionKey === key);
        if (params.version.value !== row.RowVersionNo) return { recordset: [] };
        if (/IsDeleted=1/.test(sql)) Object.assign(row, { IsDeleted: true, Status: 'DELETED' });
        else { row.Note = params.note.value; if (params.qty) row.Quantity = params.qty.value; }
        row.RowVersionNo++; return { recordset: [{ DeductionKey: key }] };
      }
      if (/INSERT INTO WebSalesDefectDeductionHistory/.test(sql)) {
        if (failHistory) throw new Error('history failure'); state.histories.push(params); return { recordset: [] };
      }
      throw new Error(`Unexpected fixture query: ${sql}`);
    };
    const result = await run(query); committed = state; return result;
  } };
}
const archive = { ...input, action: 'manage-archive', changes: {}, rows: [selection, { ...selection, deductionKey: 253 }] };
const f = fixture(), before = structuredClone(f.state());
const result = await manageDeductions(archive, f);
assert.equal(result.archived, 2); assert.equal(f.state().histories.length, 2);
assert.equal(JSON.parse(f.state().histories[0].before.value).IsDeleted, false);
assert.equal(JSON.parse(f.state().histories[0].after.value).IsDeleted, true);
for (const name of ['Estimate', 'applications', 'Order', 'Shipment', 'Stock']) assert.deepEqual(f.state()[name], before[name]);
assert.equal(f.state().ledger[0].CreatedBy, before.ledger[0].CreatedBy);
for (const flags of [{ failHistory: true }, { failSecond: true }]) {
  const t = fixture(flags), previous = structuredClone(t.state());
  await assert.rejects(manageDeductions(archive, t)); assert.deepEqual(t.state(), previous, 'whole batch rollback');
}
const p = fixture(); await manageDeductions({ ...input, preview: true, changes: {} }, p);
assert.equal(p.queries.some((q) => /UPDATE|INSERT|ALTER|CREATE|DELETE/.test(q)), false, 'preview must be SELECT-only');
const noteFixture = fixture(), noteBefore = structuredClone(noteFixture.state());
await manageDeductions({ ...input, changes: { note: '지원 확인' } }, noteFixture);
assert.equal(noteFixture.state().ledger[0].Note, '지원 확인');
for (const name of ['Estimate', 'applications', 'Order', 'Shipment', 'Stock']) assert.deepEqual(noteFixture.state()[name], noteBefore[name]);
assert.equal(noteFixture.state().ledger[0].Quantity, 15);
const noteSql = noteFixture.queries.find((q) => /UPDATE WebSalesDefectDeduction/.test(q));
assert.equal(/Quantity=|CustKey=|ProdKey=|SourceUnit=/.test(noteSql), false, 'linked note-only update cannot rewrite protected fields');
const unmatched = fixture({ unmapped: true });
await manageDeductions({ ...input, rows: [{ ...selection, deductionKey: 254 }], changes: { note: '미매칭 원문 확인' } }, unmatched);
assert.equal(unmatched.state().ledger[0].Note, '미매칭 원문 확인');
assert.equal(unmatched.state().ledger[0].CustKey, null);
assert.equal(unmatched.queries.some((q) => /FROM (Customer|Product)/.test(q)), false);
const missingMatch = fixture({ invalidMatch: true, unmapped: true });
await assert.rejects(manageDeductions({ ...input, rows: [{ ...selection, deductionKey: 254 }], changes: { custKey: 999999 } }, missingMatch), /활성 전산/);
console.log('defect ledger management: policy, actual core preservation, preview and atomic rollback passed');
