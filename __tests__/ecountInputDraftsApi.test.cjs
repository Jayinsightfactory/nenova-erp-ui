'use strict';
// InputDraft API: db 모듈 모킹(실제 DB 접속 없음). ERP 원장 테이블 접근·DDL 이 없음을 SQL 텍스트로 검증한다.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const sql = require('mssql');
const drafts = require('../lib/ecountInputDrafts.cjs');

const MIGRATION = 'docs/migrations/2026-10-21_ecount_work_input_drafts.sql';
const ERP_NAMES = /OrderMaster|OrderDetail|ShipmentMaster|ShipmentDetail|ShipmentDate|ShipmentFarm|StockMaster|ProductStock|WarehouseMaster|WarehouseDetail|Estimate|WebProfitReport|WebEcountSnapshot|WebEcountRow|ecount_work\.(Version|Head|Audit)\b/i;

function load({ ready = true, headRow = null, lineRows = [], rowsAffected = 1 } = {}) {
  const log = [];
  const run = async (q) => {
    log.push(q);
    if (/OBJECT_ID/.test(q)) return { recordset: [{ ready: ready ? 1 : 0 }] };
    if (/FROM ecount_work\.InputDraftHead/.test(q)) return { recordset: headRow ? [headRow] : [] };
    if (/FROM ecount_work\.InputDraftLine/.test(q)) return { recordset: lineRows };
    if (/^UPDATE/.test(q)) return { rowsAffected: [rowsAffected], recordset: [] };
    return { rowsAffected: [1], recordset: [] };
  };
  const context = {
    console, Date, JSON, Error, URL, Number, String, Object, Array, Promise, sql, drafts,
    withAuth: (fn) => fn,
    query: (q) => run(q),
    withTransaction: (fn) => fn((q) => run(q)),
  };
  const source = fs.readFileSync(path.join(__dirname, '../pages/api/ecount/input-drafts.js'), 'utf8')
    .replace(/^import[^\n]*\n/gm, '')
    .replace('export default withAuth(handle);', 'globalThis.route = withAuth(handle);');
  vm.runInNewContext(source, context);
  const call = async (req) => {
    const res = { statusCode: 200, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; }, setHeader() {} };
    await context.route({ headers: {}, query: {}, user: { userId: 'tester' }, ...req }, res);
    return res;
  };
  return { call, log };
}

const BODY = { program: 'E040205', header: { docDate: '2026-10-21', customerRef: 'C-001' }, lines: [{ itemRef: 'P-1', quantity: '3', unitPrice: '1000' }] };
function storedRow(status = 'draft') {
  const d = drafts.createDraft('E040205', { head: BODY.header, lines: BODY.lines }, { actor: 'tester' });
  const row = { DraftId: d.draftId, Program: d.program, Status: status, Revision: 1, FieldsJson: JSON.stringify(d.head), CreatedBy: d.createdBy, CreatedAt: new Date(d.createdAt), UpdatedAt: new Date(d.updatedAt), CancelledReason: null };
  return { row, lines: d.lines.map((l) => { const { lineNo, ...f } = l; return { LineNo: lineNo, FieldsJson: JSON.stringify(f) }; }), id: d.draftId };
}

test('테이블 없음 -> 503 MIGRATION_PENDING, DDL/쓰기 없음', async () => {
  const { call, log } = load({ ready: false });
  const res = await call({ method: 'POST', body: BODY });
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.code, 'MIGRATION_PENDING');
  assert.equal(res.body.migration, MIGRATION);
  assert.equal(log.length, 1);
  assert.ok(!log.some((q) => /^\s*(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP)/i.test(q)));
});

test('POST 정상 -> Head/Line/Audit INSERT 만, ERP 테이블 이름 없음', async () => {
  const { call, log } = load();
  const res = await call({ method: 'POST', body: BODY });
  assert.equal(res.statusCode, 201);
  assert.equal(res.body.revision, 1);
  assert.equal(res.body.sourceSaved, false);
  const writes = log.filter((q) => /^\s*(INSERT|UPDATE|DELETE)/i.test(q));
  assert.equal(writes.length, 3);
  assert.ok(writes.every((q) => /^INSERT INTO ecount_work\.InputDraft(Head|Line|Audit) /.test(q)));
  assert.deepEqual(writes.map((q) => q.match(/InputDraft(Head|Line|Audit)/)[1]).sort(), ['Audit', 'Head', 'Line']);
  for (const q of log) { assert.ok(!ERP_NAMES.test(q), q); assert.ok(!/\b(CREATE|ALTER|DROP)\s+(TABLE|SCHEMA|TRIGGER)/i.test(q)); }
});

test('POST 검증 오류 -> 400 한글 메시지, 쓰기 없음', async () => {
  const { call, log } = load();
  const res = await call({ method: 'POST', body: { program: 'E040205', header: {}, lines: [] } });
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, 'VALIDATION_FAILED');
  assert.ok(res.body.details.some((e) => /필수|최소/.test(e.message)));
  assert.ok(!log.some((q) => /^\s*INSERT/i.test(q)));
});

test('PATCH revision 불일치 -> 409, 쓰기 없음', async () => {
  const s = storedRow();
  const { call, log } = load({ headRow: s.row, lineRows: s.lines });
  const res = await call({ method: 'PATCH', body: { draftId: s.id, expectedRevision: 5, header: { customerRef: 'C-002' } } });
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.error, 'REVISION_CONFLICT');
  assert.ok(!log.some((q) => /^\s*(INSERT|UPDATE)/i.test(q)));
});

test('PATCH 정상 -> Head UPDATE(revision 조건) + Line/Audit INSERT', async () => {
  const s = storedRow();
  const { call, log } = load({ headRow: s.row, lineRows: s.lines });
  const res = await call({ method: 'PATCH', body: { draftId: s.id, expectedRevision: 1, header: { customerRef: 'C-002' }, reason: '거래처 정정' } });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.revision, 2);
  const upd = log.filter((q) => /^UPDATE/.test(q));
  assert.equal(upd.length, 1);
  assert.match(upd[0], /WHERE DraftId=@draftId AND Revision=@prevRevision/);
  for (const q of log) assert.ok(!ERP_NAMES.test(q));
});

test('cancel 사유 없음 -> 400, DB 접근 전 거부', async () => {
  const s = storedRow();
  const { call, log } = load({ headRow: s.row, lineRows: s.lines });
  const res = await call({ method: 'POST', body: { action: 'cancel', draftId: s.id, expectedRevision: 1, reason: '  ' } });
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, 'CANCEL_REASON_REQUIRED');
  assert.equal(log.length, 0);
});

test('cancel 정상 / review 정상', async () => {
  const s = storedRow();
  const a = load({ headRow: s.row, lineRows: s.lines });
  const c = await a.call({ method: 'POST', body: { action: 'cancel', draftId: s.id, expectedRevision: 1, reason: '중복 입력' } });
  assert.equal(c.statusCode, 200); assert.equal(c.body.status, 'cancelled');
  assert.ok(!a.log.some((q) => /DELETE/i.test(q)));
  const b = load({ headRow: s.row, lineRows: s.lines });
  const r = await b.call({ method: 'POST', body: { action: 'review', draftId: s.id, expectedRevision: 1 } });
  assert.equal(r.statusCode, 200); assert.equal(r.body.status, 'reviewed');
});

test('GET 목록/단건/스키마, 비허용 메서드', async () => {
  const s = storedRow();
  const { call } = load({ headRow: s.row, lineRows: s.lines });
  const one = await call({ method: 'GET', query: { program: 'E040205', draftId: s.id } });
  assert.equal(one.statusCode, 200); assert.equal(one.body.draft.accountingPosted, false); assert.equal(one.body.draft.mine, true);
  const schema = await call({ method: 'GET', query: { program: 'E040205', view: 'schema' } });
  assert.equal(schema.body.schema.program, 'E040205');
  assert.equal((await call({ method: 'DELETE' })).statusCode, 405);
  assert.equal((await call({ method: 'GET', query: { program: 'X' } })).statusCode, 400);
});
