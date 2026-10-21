'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const d = require('../lib/ecountInputDrafts.cjs');

const ROOT = path.join(__dirname, '..');
const survey = require('../data/ecount-workbench/evidence/2026-10-21-source-survey-p008-p019.json');
const SEVEN = ['E040203', 'E040205', 'E040253', 'E040301', 'E040501', 'E040503', 'E040507'];
const opts = (over = {}) => ({ actor: 'synthetic-user', now: '2026-10-21T03:00:00.000Z', draftId: '0f0f0f0f-1111-4222-8333-444444444444', ...over });
const tradePayload = { head: { docDate: '2026-10-21', customerRef: 'CUST-001', managerRef: 'MGR-01', shipWarehouseRef: 'WH-A', reference: '샘플 참조', applyVatRate: true },
  lines: [{ itemRef: 'ROSE-RED-50', quantity: '12.5', unitPrice: '1000', supplyAmt: '12500', vat: '1250', remark: '첫 행' }, { itemRef: 'CARN-PINK', quantity: '0' }] };

test('7개 입력 화면 스키마가 설문 fields/body controls 에서 그대로 생성된다', () => {
  assert.deepEqual(d.PROGRAM_IDS, SEVEN);
  const schemas = d.allSchemas();
  assert.equal(schemas.length, 7);
  let surveyFieldTotal = 0;
  for (const s of schemas) {
    const entry = survey.results[s.program];
    const bodyControls = entry.controls.filter((c) => c[3] === 'body').length;
    surveyFieldTotal += entry.fields.length;
    assert.equal(s.head.length, entry.fields.length + bodyControls, `${s.program} head field count`);
    assert.equal(s.title, entry.title);
    assert.equal(s.evidence.saveClicked, false);
    assert.ok(s.evidence.saveControlsObserved.includes('저장(F8)'));
    assert.equal(s.sourceSave.approved, false);
    assert.equal(s.sourceSave.executed, false);
    assert.equal(s.lines.observed, false, '라인 그리드는 미관측으로 표시');
    for (const f of s.head) {
      assert.equal(f.required, null, `${s.program}.${f.key} 미관측 필수여부는 null`);
      assert.ok(['date', 'text', 'ref', 'boolean'].includes(f.valueType));
      assert.equal(f.defaultValue, null);
    }
    assert.equal(s.head[0].key, 'docDate');
    assert.equal(s.head[0].observedLabel, '26');
    assert.equal(s.head[0].draftRequired, true);
    const refs = s.head.filter((f) => f.valueType === 'ref');
    assert.ok(refs.every((f) => f.privacy === 'opaque-ref'));
    assert.ok(s.head.filter((f) => f.valueType === 'text').every((f) => f.privacy === 'masked-text' && f.maxLength <= 200));
  }
  assert.equal(surveyFieldTotal, 46);
  assert.equal(schemas.reduce((n, s) => n + s.head.length, 0), 55);
  assert.equal(d.fieldSchema('E040507').head.find((f) => f.key === 'disposal').label, '폐기');
  assert.equal(d.fieldSchema('E040501').head.some((f) => f.key === 'customerRef'), false, '창고이동은 거래처 칸 미관측');
  assert.deepEqual(d.fieldSchema('E040501').lines.fields.map((f) => f.key), ['itemRef', 'quantity', 'remark']);
  assert.deepEqual(d.fieldSchema('E040205').lines.fields.map((f) => f.key), ['itemRef', 'quantity', 'unitPrice', 'supplyAmt', 'vat', 'remark']);
  assert.throws(() => d.fieldSchema('E040207'), /UNKNOWN_PROGRAM/);
});

test('필수 누락·형식 오류는 한글 메시지로 보고하고 빈칸과 0을 구분한다', () => {
  const r = d.validateDraft('E040205', { head: { docDate: '', customerRef: '네노바 꽃집', extra: 1 }, lines: [{ itemRef: 'P-1', quantity: '' }, { itemRef: '', quantity: '1,000' }, { itemRef: 'P-3', quantity: '1e3' }, { itemRef: 'P-4', quantity: 'abc', bogus: true }] });
  assert.equal(r.ok, false);
  const codes = r.errors.map((e) => `${e.lineNo || 0}:${e.field}:${e.code}`);
  assert.ok(codes.includes('0:docDate:REQUIRED'));
  assert.ok(codes.includes('0:customerRef:INVALID_REF'), '거래처명(한글)은 참조코드가 아니므로 거부');
  assert.ok(codes.includes('0:extra:UNKNOWN_FIELD'));
  assert.ok(codes.includes('1:quantity:REQUIRED'), '빈 수량은 누락');
  assert.ok(codes.includes('2:itemRef:REQUIRED'));
  assert.ok(codes.includes('2:quantity:INVALID_DECIMAL'));
  assert.ok(codes.includes('3:quantity:INVALID_DECIMAL'));
  assert.ok(codes.includes('4:bogus:UNKNOWN_FIELD'));
  assert.ok(r.errors.every((e) => /[가-힣]/.test(e.message)), '모든 메시지는 한글');
  assert.match(r.errors.find((e) => e.code === 'REQUIRED' && e.field === 'docDate').message, /일자.*필수/);
  const zero = d.validateDraft('E040205', { head: { docDate: '2026-10-21' }, lines: [{ itemRef: 'P-1', quantity: '0' }, { itemRef: 'P-2', quantity: 0 }] });
  assert.equal(zero.ok, true);
  assert.equal(zero.normalized.lines[0].quantity, '0');
  assert.equal(zero.normalized.lines[1].quantity, '0');
  assert.ok(zero.warnings.some((w) => w.code === 'REQUIRED_UNOBSERVED' && w.field === 'customerRef'));
  const precise = d.validateDraft('E040205', { head: { docDate: '2026-10-21' }, lines: [{ itemRef: 'P', quantity: '123456789012345678.12345678' }] });
  assert.equal(precise.normalized.lines[0].quantity, '123456789012345678.12345678', '정밀도 보존(문자열)');
  assert.equal(d.validateDraft('E040205', { head: { docDate: '2026-10-21' }, lines: [{ itemRef: 'P', quantity: '1.123456789' }] }).ok, false, '소수 9자리 거부');
  for (const bad of ['2026-02-30', '2026/10/21', '26-10-21', '2026-13-01', 20261021]) {
    const v = d.validateDraft('E040203', { head: { docDate: bad }, lines: [{ itemRef: 'P', quantity: '1' }] });
    assert.ok(v.errors.some((e) => e.code === 'INVALID_DATE'), `날짜 거부: ${bad}`);
  }
  const bools = d.validateDraft('E040203', { head: { docDate: '2026-10-21', applyVatRate: 'maybe' }, lines: [{ itemRef: 'P', quantity: '1' }] });
  assert.ok(bools.errors.some((e) => e.code === 'INVALID_BOOLEAN'));
  const longText = d.validateDraft('E040203', { head: { docDate: '2026-10-21', reference: 'x'.repeat(101) }, lines: [{ itemRef: 'P', quantity: '1' }] });
  assert.ok(longText.errors.some((e) => e.code === 'TOO_LONG' && /100자/.test(e.message)));
  assert.ok(d.validateDraft('E040203', { head: { docDate: '2026-10-21' }, lines: [] }).errors.some((e) => e.code === 'LINES_EMPTY'));
  assert.ok(d.validateDraft('E040203', { head: { docDate: '2026-10-21' } }).errors.some((e) => e.code === 'LINES_REQUIRED'));
  assert.ok(d.validateDraft('E040203', { head: { docDate: '2026-10-21' }, lines: Array.from({ length: 201 }, () => ({ itemRef: 'P', quantity: '1' })) }).errors.some((e) => e.code === 'TOO_MANY_LINES'));
  assert.ok(d.validateDraft('E040501', { head: { docDate: '2026-10-21' }, lines: [{ itemRef: 'P', quantity: '1', unitPrice: '1' }] }).errors.some((e) => e.code === 'UNKNOWN_FIELD'), '창고이동 라인에 단가 열 없음');
  assert.equal(d.validateDraft('E040207', tradePayload).errors[0].code, 'UNKNOWN_PROGRAM');
});

test('개인정보 필드는 참조코드만 저장하고 자유텍스트는 마스킹된다', () => {
  const draft = d.createDraft('E040301', { head: { docDate: '2026-10-21', customerRef: 'SUP-7', reference: '연락 010-1234-5678 / mail test.user@example.com', remark: '사업자 123-45-67890 주민 900101-1234567 계좌 1234567890123' },
    lines: [{ itemRef: 'LILY-W', quantity: '3', remark: '전화 02-555-1234 로 확인' }] }, opts());
  const json = JSON.stringify(draft);
  for (const secret of ['010-1234-5678', 'test.user@example.com', '123-45-67890', '900101-1234567', '1234567890123', '02-555-1234', 'synthetic-user']) assert.ok(!json.includes(secret), `유출 금지: ${secret}`);
  assert.equal(draft.head.reference, '연락 [전화] / mail [이메일]');
  assert.equal(draft.head.remark, '사업자 [사업자번호] 주민 [식별번호] 계좌 [번호]');
  assert.equal(draft.lines[0].remark, '전화 [전화] 로 확인');
  assert.match(draft.createdBy, /^[a-f0-9]{64}$/);
  assert.equal(draft.createdBy, d.actorHash('synthetic-user'));
  assert.equal(d.maskFreeText('plain 123456'), 'plain 123456', '6자리 이하 숫자는 유지');
  assert.throws(() => d.createDraft('E040203', { head: { docDate: '2026-10-21', customerRef: '홍길동 상회' }, lines: [{ itemRef: 'P', quantity: '1' }] }, opts()), /VALIDATION_FAILED/);
  assert.throws(() => d.createDraft('E040203', tradePayload, { now: '2026-10-21T00:00:00.000Z' }), /ACTOR_REQUIRED/);
});

test('저장 계획은 ecount_work 세 테이블만 가리키고 회계반영·원본저장·하드삭제가 없다', () => {
  const draft = d.createDraft('E040203', tradePayload, opts());
  const plan = d.buildSavePlan('E040203', draft);
  assert.deepEqual(plan.tables, ['ecount_work.InputDraftHead', 'ecount_work.InputDraftLine', 'ecount_work.InputDraftAudit']);
  assert.equal(plan.accountingPosted, false);
  assert.equal(plan.sideEffects, 'none (web-only draft)');
  assert.equal(plan.erpLedgerWrites, 'none');
  assert.match(plan.sourceWrites, /^none/);
  assert.equal(plan.hardDelete, false);
  assert.equal(plan.executed, false);
  assert.equal(plan.action, 'create');
  assert.deepEqual(plan.keys, { head: ['DraftId'], line: ['DraftId', 'Revision', 'LineNo'], audit: ['DraftId', 'Revision'] });
  assert.equal(plan.rows.head.Program, 'E040203');
  assert.equal(plan.rows.head.Status, 'draft');
  assert.equal(plan.rows.head.Revision, 1);
  assert.equal(plan.rows.head.LineCount, 2);
  assert.deepEqual(JSON.parse(plan.rows.head.FieldsJson), draft.head);
  assert.equal(plan.rows.lines.length, 2);
  assert.deepEqual(plan.rows.lines.map((l) => l.LineNo), [1, 2]);
  assert.deepEqual(JSON.parse(plan.rows.lines[1].FieldsJson), { itemRef: 'CARN-PINK', quantity: '0' });
  assert.equal(plan.rows.audit.Action, 'create');
  assert.equal(plan.statements.filter((s) => s.op === 'INSERT' && s.table === plan.tables[0]).length, 1);
  assert.equal(plan.statements.filter((s) => s.table === plan.tables[1]).length, 2);
  for (const s of plan.statements) {
    assert.ok(plan.tables.includes(s.table), `allowlist 밖 테이블: ${s.table}`);
    assert.ok(['INSERT', 'UPDATE'].includes(s.op), 'DELETE 없음');
  }
  const planJson = JSON.stringify(plan);
  for (const forbidden of ['OrderMaster', 'OrderDetail', 'ShipmentMaster', 'ShipmentDetail', 'StockMaster', 'WarehouseMaster', 'WebEcountSnapshot', 'WebEcountRow', 'ecount_work.Version', 'ecount_work.Head', 'ecount_work.Audit']) {
    assert.ok(!planJson.includes(forbidden), `ERP/ECOUNT 테이블 접근 금지: ${forbidden}`);
  }
  assert.throws(() => d.buildSavePlan('E040205', draft), /PROGRAM_MISMATCH/);
  assert.throws(() => d.buildSavePlan('E040203', draft, { action: 'cancel' }), /ACTION_MISMATCH/);
});

test('정정은 expectedRevision 충돌을 거부하고 감사 diff 와 새 revision 을 만든다', () => {
  assert.throws(() => d.createDraft('E040205', tradePayload, opts()), (e) => e.message === 'VALIDATION_FAILED' && e.detail[0].field === 'reference', '판매입력에는 참조 칸이 없음(화면별 스키마)');
  const v1 = d.createDraft('E040203', tradePayload, opts());
  assert.throws(() => d.applyCorrection(v1, { head: { reference: 'x' } }, 2, opts()), (e) => e.message === 'REVISION_CONFLICT' && e.status === 409);
  assert.throws(() => d.applyCorrection(v1, { head: { reference: 'x' } }, 0, opts()), /EXPECTED_REVISION_REQUIRED/);
  assert.throws(() => d.applyCorrection(v1, {}, 1, opts()), /EMPTY_PATCH/);
  assert.throws(() => d.applyCorrection(v1, { head: { customerRef: '한글이름' } }, 1, opts()), /VALIDATION_FAILED/);
  assert.throws(() => d.applyCorrection(v1, { head: { customerRef: 'CUST-001' } }, 1, opts()), /NO_CHANGE/);
  const v2 = d.applyCorrection(v1, { head: { customerRef: 'CUST-002', reference: null }, lines: [{ itemRef: 'ROSE-RED-50', quantity: '13' }] }, 1, opts({ actor: 'second-user', now: '2026-10-21T04:00:00.000Z' }));
  assert.equal(v1.revision, 1, '원본 불변');
  assert.equal(v1.head.customerRef, 'CUST-001');
  assert.equal(v2.revision, 2);
  assert.equal(v2.status, 'draft');
  assert.equal(v2.head.customerRef, 'CUST-002');
  assert.equal(Object.hasOwn(v2.head, 'reference'), false, 'null 패치는 칸 비우기');
  assert.equal(v2.lines.length, 1);
  assert.equal(v2.updatedAt, '2026-10-21T04:00:00.000Z');
  assert.equal(v2.createdAt, v1.createdAt);
  assert.notEqual(v2.contentHash, v1.contentHash);
  const audit = v2.audit[1];
  assert.equal(audit.action, 'correct');
  assert.equal(audit.revision, 2);
  assert.equal(audit.actor, d.actorHash('second-user'));
  assert.deepEqual(audit.diff.head.customerRef, { from: 'CUST-001', to: 'CUST-002' });
  assert.deepEqual(audit.diff.head.reference, { from: '샘플 참조', to: null });
  assert.deepEqual(audit.diff.lines.changed.map((c) => `${c.lineNo}:${c.kind}`), ['1:changed', '2:removed']);
  assert.deepEqual(audit.diff.lines.changed[0].fields.quantity, { from: '12.5', to: '13' });
  const plan = d.buildSavePlan('E040203', v2);
  const headUpdate = plan.statements.find((s) => s.op === 'UPDATE');
  assert.deepEqual(headUpdate.where, { DraftId: v2.draftId, Revision: 1 }, 'optimistic revision 조건');
  assert.equal(headUpdate.set.Revision, 2);
  assert.equal(plan.statements.filter((s) => s.table === plan.tables[1]).length, 1, '새 revision 라인 집합 추가(삭제 없음)');
  // 오래된 스냅샷(v1)에 또 정정하면 순수 함수는 revision 2 를 만들지만, 저장 계획의 UPDATE 조건이 Revision=1 이므로
  // v2 가 이미 저장된 DB 에서는 0행 갱신 → 서버가 REVISION_CONFLICT(409) 로 처리한다.
  const stale = d.applyCorrection(v1, { head: { reference: 'late' } }, 1, opts());
  assert.equal(stale.revision, 2);
  assert.deepEqual(d.buildSavePlan('E040203', stale).statements.find((s) => s.op === 'UPDATE').where, { DraftId: v1.draftId, Revision: 1 });
});

test('취소는 사유가 필수이고 소프트 상태 전이만 한다', () => {
  const v1 = d.createDraft('E040503', { head: { docDate: '2026-10-21', warehouseRef: 'WH-1' }, lines: [{ itemRef: 'SAMPLE', quantity: '1' }] }, opts());
  for (const bad of ['', '   ', null, undefined, 42]) assert.throws(() => d.cancel(v1, bad, 1, opts()), /CANCEL_REASON_REQUIRED/);
  assert.throws(() => d.cancel(v1, 'x'.repeat(201), 1, opts()), /CANCEL_REASON_TOO_LONG/);
  assert.throws(() => d.cancel(v1, '사유', 2, opts()), /REVISION_CONFLICT/);
  const cancelled = d.cancel(v1, '샘플 입력 종료 010-9999-8888', 1, opts());
  assert.equal(cancelled.status, 'cancelled');
  assert.equal(cancelled.revision, 2);
  assert.equal(cancelled.cancelledReason, '샘플 입력 종료 [전화]');
  assert.equal(cancelled.audit[1].action, 'cancel');
  assert.deepEqual(cancelled.lines, v1.lines, '취소해도 행은 보존');
  assert.throws(() => d.cancel(cancelled, '다시', 2, opts()), /ALREADY_CANCELLED/);
  assert.throws(() => d.applyCorrection(cancelled, { head: { remark: 'x' } }, 2, opts()), /DRAFT_CANCELLED/);
  assert.throws(() => d.review(cancelled, 2, opts()), /DRAFT_CANCELLED/);
  const plan = d.buildSavePlan('E040503', cancelled);
  assert.equal(plan.action, 'cancel');
  assert.equal(plan.rows.head.Status, 'cancelled');
  assert.equal(plan.rows.head.CancelledReason, '샘플 입력 종료 [전화]');
  assert.deepEqual(plan.statements.map((s) => `${s.op} ${s.table}`), ['UPDATE ecount_work.InputDraftHead', 'INSERT ecount_work.InputDraftAudit']);
  assert.equal(plan.hardDelete, false);
});

test('왕복(생성→조회→검토→정정→취소) 상태 전이와 교차연도 일자 구분', () => {
  const create = d.createDraft('E040507', { head: { docDate: '2026-10-21', foundWarehouseRef: 'WH-Q', disposal: true }, lines: [{ itemRef: 'DMG-1', quantity: '2', remark: '불량 2박스' }] }, opts());
  const view1 = d.readDraft(create);
  assert.equal(view1.status, 'draft');
  assert.equal(view1.title, '불량처리입력');
  assert.equal(view1.accountingPosted, false);
  assert.equal(view1.sourceSaved, false);
  assert.equal(view1.deletable, false);
  assert.equal(view1.cancellable, true);
  assert.deepEqual(view1.head, create.head);
  const reviewed = d.review(create, 1, opts({ actor: 'reviewer' }));
  assert.equal(reviewed.status, 'reviewed');
  assert.equal(reviewed.revision, 2);
  assert.throws(() => d.review(reviewed, 2, opts()), /ALREADY_REVIEWED/);
  assert.equal(d.buildSavePlan('E040507', reviewed).action, 'review');
  assert.equal(d.buildSavePlan('E040507', reviewed).statements.some((s) => s.table === 'ecount_work.InputDraftLine'), false, '검토는 라인 재기록 없음');
  const corrected = d.applyCorrection(reviewed, { lines: [{ itemRef: 'DMG-1', quantity: '3' }] }, 2, opts());
  assert.equal(corrected.status, 'draft', '정정하면 재검토 필요');
  assert.equal(corrected.revision, 3);
  assert.equal(corrected.audit[2].diff.statusFrom, 'reviewed');
  const cancelled = d.cancel(corrected, '왕복 검증 종료', 3, opts());
  assert.equal(cancelled.status, 'cancelled');
  assert.equal(cancelled.revision, 4);
  assert.deepEqual(cancelled.audit.map((a) => `${a.revision}:${a.action}`), ['1:create', '2:review', '3:correct', '4:cancel']);
  const view2 = d.readDraft(cancelled);
  assert.equal(view2.cancellable, false);
  assert.equal(view2.deletable, false);
  assert.equal(view2.cancelledReason, '왕복 검증 종료');
  assert.ok(new Set(cancelled.audit.map((a) => a.revision)).size === 4, 'DraftId+Revision 유일');
  const y2025 = d.createDraft('E040507', { head: { docDate: '2025-10-21', foundWarehouseRef: 'WH-Q', disposal: true }, lines: [{ itemRef: 'DMG-1', quantity: '2', remark: '불량 2박스' }] }, opts({ draftId: '0f0f0f0f-1111-4222-8333-555555555555' }));
  assert.notEqual(y2025.contentHash, create.contentHash, '같은 월일의 2025/2026 초안은 구분');
  assert.equal(y2025.head.docDate, '2025-10-21');
});

test('라이브러리는 DB/ERP/ECOUNT 원본을 호출하지 않고 마이그레이션은 세 테이블·소프트삭제·불변 트리거를 선언한다', () => {
  const src = fs.readFileSync(path.join(ROOT, 'lib', 'ecountInputDrafts.cjs'), 'utf8');
  assert.ok(!/require\(['"]\.\/db/.test(src) && !/ecountWorkspaceStore|ecountIngest|mssql|fetch\(/.test(src), 'DB·ERP·네트워크 호출 없음');
  for (const forbidden of ['OrderDetail', 'ShipmentDetail', 'ShipmentDate', 'WebEcountRow', 'INSERT INTO', 'UPDATE ecount_work', 'DELETE']) assert.ok(!src.includes(forbidden), `lib 내 금지 토큰: ${forbidden}`);
  const sqlFile = path.join(ROOT, 'docs', 'migrations', '2026-10-21_ecount_work_input_drafts.sql');
  const sqlText = fs.readFileSync(sqlFile, 'utf8');
  for (const t of ['ecount_work.InputDraftHead', 'ecount_work.InputDraftLine', 'ecount_work.InputDraftAudit']) assert.ok(sqlText.includes(`IF OBJECT_ID(N'${t}',N'U') IS NULL`), `idempotent create: ${t}`);
  assert.match(sqlText, /CHECK\(Status IN \('draft','reviewed','cancelled'\)\)/);
  assert.match(sqlText, /CHECK\(Program IN \('E040203','E040205','E040253','E040301','E040501','E040503','E040507'\)\)/);
  assert.match(sqlText, /INSTEAD OF DELETE AS BEGIN THROW 51011/);
  assert.match(sqlText, /InputDraftLine_Immutable .* INSTEAD OF UPDATE, DELETE/);
  assert.match(sqlText, /InputDraftAudit_Immutable .* INSTEAD OF UPDATE, DELETE/);
  assert.match(sqlText, /UNIQUE\(DraftId,Revision\)/);
  assert.match(sqlText, /PRIMARY KEY\(DraftId,Revision,LineNo\)/);
  assert.match(sqlText, /ISJSON\(FieldsJson\)=1/);
  for (const forbidden of ['OrderMaster', 'ShipmentMaster', 'StockMaster', 'WarehouseMaster', 'WebEcount', 'DROP TABLE', 'TRUNCATE']) assert.ok(!sqlText.includes(forbidden), `마이그레이션 금지 토큰: ${forbidden}`);
  const contract = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs', 'contracts', 'ecount-input-drafts.json'), 'utf8'));
  assert.equal(contract.id, 'ecount-input-drafts');
  for (const action of contract.actions) {
    assert.equal(action.orderDetail, 'preserve');
    assert.equal(action.shipmentDetail, 'preserve');
    assert.deepEqual(action.writeAllowlist, d.WRITE_ALLOWLIST);
  }
  assert.deepEqual(contract.actions.map((a) => a.name), ['CREATE_INPUT_DRAFT', 'CORRECT_INPUT_DRAFT', 'REVIEW_INPUT_DRAFT', 'CANCEL_INPUT_DRAFT']);
  assert.equal(contract.sourceWrites, 'Forbidden');
  assert.ok(contract.requiredTestFiles.includes('__tests__/ecountInputDrafts.test.cjs'));
  const doc = fs.readFileSync(path.join(ROOT, 'docs', 'ECOUNT_WORKSPACE_CONTRACT.md'), 'utf8');
  assert.ok(doc.includes('## 입력 초안(InputDraft) 계약'));
  for (const id of SEVEN) assert.ok(doc.includes(id), `계약 문서에 ${id} 표`);
  assert.match(doc, /ECOUNT 원본 저장.*미승인/);
});
