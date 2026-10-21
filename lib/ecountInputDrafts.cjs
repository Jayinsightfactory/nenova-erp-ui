'use strict';
// ECOUNT 입력 화면 7종의 웹 전용 저장 계약 (순수 함수, DB/ERP/ECOUNT 호출 없음).
// 근거: data/ecount-workbench/evidence/2026-10-21-source-survey-p008-p019.json (읽기 전용 설문, 저장 클릭 없음).
// 저장소: ecount_work.InputDraftHead / InputDraftLine / InputDraftAudit (docs/migrations/2026-10-21_ecount_work_input_drafts.sql).
// ECOUNT 원본 저장은 미승인·미실행이다. ERP 공유 원장(OrderMaster/ShipmentMaster/Stock/Warehouse 등)은 읽거나 쓰지 않는다.
const crypto = require('node:crypto');
const survey = require('../data/ecount-workbench/evidence/2026-10-21-source-survey-p008-p019.json');

const EVIDENCE_FILE = 'data/ecount-workbench/evidence/2026-10-21-source-survey-p008-p019.json';
const TABLES = Object.freeze({
  head: 'ecount_work.InputDraftHead',
  line: 'ecount_work.InputDraftLine',
  audit: 'ecount_work.InputDraftAudit',
});
const WRITE_ALLOWLIST = Object.freeze([TABLES.head, TABLES.line, TABLES.audit]);
const STATUSES = Object.freeze(['draft', 'reviewed', 'cancelled']);
const ACTIONS = Object.freeze(['create', 'correct', 'review', 'cancel']);
const MAX_LINES = 200;
const REF_RE = /^[A-Za-z0-9._/-]{1,60}$/;
const DECIMAL_RE = /^-?\d{1,18}(\.\d{1,8})?$/;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const UUID_RE = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

// 화면 7종. kind: trade(거래처+창고+금액) / move(창고이동) / consume(자가사용) / defect(불량처리)
const PROGRAMS = Object.freeze({
  E040203: { title: '주문서입력', kind: 'trade', menuId: 'MENUTREE_000488' },
  E040205: { title: '판매입력', kind: 'trade', menuId: 'MENUTREE_000490' },
  E040253: { title: '판매입력 II', kind: 'trade', menuId: 'MENUTREE_002880' },
  E040301: { title: '발주서입력', kind: 'trade', menuId: 'MENUTREE_000508' },
  E040501: { title: '창고이동입력', kind: 'move', menuId: null },
  E040503: { title: '자가사용입력', kind: 'consume', menuId: null },
  E040507: { title: '불량처리입력', kind: 'defect', menuId: null },
});
const PROGRAM_IDS = Object.freeze(Object.keys(PROGRAMS));

// 관측 라벨 → 저장 키. 개인정보가 될 수 있는 칸(거래처/담당자/부서/창고)은 불투명 참조코드(ref)만 저장한다.
const LABEL_MAP = Object.freeze({
  '거래처': { key: 'customerRef', valueType: 'ref', privacy: 'opaque-ref', note: '거래처명 저장 금지, 참조코드만' },
  '담당자': { key: 'managerRef', valueType: 'ref', privacy: 'opaque-ref', note: '이름 저장 금지, 참조코드만' },
  '부서': { key: 'departmentRef', valueType: 'ref', privacy: 'opaque-ref' },
  '출하창고': { key: 'shipWarehouseRef', valueType: 'ref', privacy: 'opaque-ref' },
  '입고창고': { key: 'inWarehouseRef', valueType: 'ref', privacy: 'opaque-ref' },
  '보내는창고': { key: 'fromWarehouseRef', valueType: 'ref', privacy: 'opaque-ref' },
  '받는창고': { key: 'toWarehouseRef', valueType: 'ref', privacy: 'opaque-ref' },
  '창고': { key: 'warehouseRef', valueType: 'ref', privacy: 'opaque-ref' },
  '발견창고': { key: 'foundWarehouseRef', valueType: 'ref', privacy: 'opaque-ref' },
  '참조': { key: 'reference', valueType: 'text', maxLength: 100, privacy: 'masked-text' },
  '비고': { key: 'remark', valueType: 'text', maxLength: 200, privacy: 'masked-text' },
  '결제조건': { key: 'paymentTerms', valueType: 'text', maxLength: 100, privacy: 'masked-text' },
  '검색창내용': { key: 'searchText', valueType: 'text', maxLength: 100, privacy: 'masked-text', note: '화면 검색창 입력, 저장 시 마스킹' },
  '유효기간': { key: 'validUntil', valueType: 'date', privacy: 'none' },
});
// 본문(body) 토글 컨트롤 — 설문의 controls 에서 ctx 'body' 로 관측된 입력성 컨트롤
const BODY_TOGGLE_MAP = Object.freeze({
  '부가세율 적용': { key: 'applyVatRate', valueType: 'boolean' },
  '내자': { key: 'domestic', valueType: 'boolean', note: '내자/외자 구분 토글로 관측, 기본값 미관측' },
  '폐기': { key: 'disposal', valueType: 'boolean' },
});
// 라인 그리드(품목 행)는 설문에서 열 단위로 관측되지 않았다 → 웹 초안 잠정(provisional) 열만 허용한다.
const LINE_FIELDS = Object.freeze({
  trade: ['itemRef', 'quantity', 'unitPrice', 'supplyAmt', 'vat', 'remark'],
  move: ['itemRef', 'quantity', 'remark'],
  consume: ['itemRef', 'quantity', 'remark'],
  defect: ['itemRef', 'quantity', 'remark'],
});
const LINE_FIELD_DEFS = Object.freeze({
  itemRef: { label: '품목(참조코드)', valueType: 'ref', privacy: 'opaque-ref', draftRequired: true },
  quantity: { label: '수량', valueType: 'decimal', draftRequired: true },
  unitPrice: { label: '단가', valueType: 'decimal' },
  supplyAmt: { label: '공급가액', valueType: 'decimal' },
  vat: { label: '부가세', valueType: 'decimal' },
  remark: { label: '적요', valueType: 'text', maxLength: 100, privacy: 'masked-text' },
});

function fail(code, status = 400, detail) {
  const e = new Error(code);
  e.status = status;
  if (detail) e.detail = detail;
  throw e;
}

// ── 설문 → 필드 스키마 ──────────────────────────────────────────────────────
function surveyEntry(program) {
  const entry = survey.results && survey.results[program];
  if (!entry) fail('SURVEY_PROGRAM_NOT_OBSERVED', 500, { program });
  return entry;
}
// required 는 설문의 required 플래그가 1 일 때만 true. 0 은 "미관측" 이므로 null 로 보존한다.
const observedRequired = (flag) => (flag === 1 || flag === true ? true : null);

function buildHeadFields(program) {
  const entry = surveyEntry(program);
  const fields = [];
  let unlabeledText = 0;
  let unlabeledCheckbox = 0;
  for (const tuple of entry.fields || []) {
    const [label, type, , requiredFlag] = tuple;
    const required = observedRequired(requiredFlag);
    if (label === '26' || /^\d{2}$/.test(label)) {
      // 날짜 위젯의 연도 토큰(26=2026)만 라벨로 관측됨 → 전표 일자 칸
      fields.push({ key: 'docDate', label: '일자', observedLabel: label, observedType: type, valueType: 'date', required, draftRequired: true,
        defaultValue: null, observedDefault: `연도 토큰 ${label} 만 관측(월·일 미판독)`, privacy: 'none', source: 'survey.fields' });
      continue;
    }
    if (label === '' && type === 'text') {
      unlabeledText += 1;
      fields.push({ key: `unlabeledText${unlabeledText}`, label: '', labelKnown: false, observedType: type, valueType: 'text', maxLength: 100, required,
        draftRequired: false, defaultValue: null, privacy: 'masked-text', source: 'survey.fields', note: '라벨 미관측 텍스트 칸' });
      continue;
    }
    if (label === '' && type === 'checkbox') {
      unlabeledCheckbox += 1;
      fields.push({ key: `unlabeledCheckbox${unlabeledCheckbox}`, label: '', labelKnown: false, observedType: type, valueType: 'boolean', required,
        draftRequired: false, defaultValue: null, privacy: 'none', source: 'survey.fields', note: '라벨 미관측 체크박스' });
      continue;
    }
    const mapped = LABEL_MAP[label];
    if (!mapped) fail('SURVEY_LABEL_UNMAPPED', 500, { program, label });
    fields.push({ key: mapped.key, label, observedType: type, valueType: mapped.valueType, required, draftRequired: false, defaultValue: null,
      privacy: mapped.privacy, source: 'survey.fields', ...(mapped.maxLength ? { maxLength: mapped.maxLength } : {}), ...(mapped.note ? { note: mapped.note } : {}) });
  }
  for (const control of entry.controls || []) {
    const [label, , disabled, ctx] = control;
    if (ctx !== 'body') continue;
    const toggle = BODY_TOGGLE_MAP[label];
    if (!toggle) fail('SURVEY_BODY_CONTROL_UNMAPPED', 500, { program, label });
    fields.push({ key: toggle.key, label, observedType: 'toggle', valueType: 'boolean', required: null, draftRequired: false, defaultValue: null,
      privacy: 'none', source: 'survey.controls(body)', observedDisabled: disabled === 1, ...(toggle.note ? { note: toggle.note } : {}) });
  }
  return fields;
}

function buildLineFields(program) {
  const kind = PROGRAMS[program].kind;
  return LINE_FIELDS[kind].map((key) => ({ key, ...LINE_FIELD_DEFS[key], required: null, draftRequired: LINE_FIELD_DEFS[key].draftRequired === true,
    defaultValue: null, privacy: LINE_FIELD_DEFS[key].privacy || 'none', source: 'web-draft-provisional', evidence: 'unobserved' }));
}

function fieldSchema(program) {
  if (!PROGRAMS[program]) fail('UNKNOWN_PROGRAM', 400, { program });
  const entry = surveyEntry(program);
  const saveControls = (entry.controls || []).map((c) => c[0]).filter((l) => /저장/.test(l));
  return {
    program,
    title: PROGRAMS[program].title,
    kind: PROGRAMS[program].kind,
    menuId: PROGRAMS[program].menuId,
    evidence: { file: EVIDENCE_FILE, observedOn: survey.observedOn, note: entry.note || null, saveControlsObserved: saveControls, saveClicked: false },
    head: buildHeadFields(program),
    lines: { observed: false, note: '품목 행 그리드 열은 설문 미관측. 웹 초안 잠정 열만 허용하며 원본 열과의 동등성은 미검증.', maxLines: MAX_LINES, fields: buildLineFields(program) },
    sourceSave: { approved: false, executed: false, note: 'ECOUNT 원본 저장(F8/F7)은 별도 승인 전 미실행' },
  };
}
const allSchemas = () => PROGRAM_IDS.map(fieldSchema);

// ── 값 정규화 (빈칸과 0 구분) ─────────────────────────────────────────────────
const isBlank = (v) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '');
function normalizeDecimal(v) {
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return null;
    const s = String(v);
    return DECIMAL_RE.test(s) ? s : null;
  }
  if (typeof v !== 'string') return null;
  const s = v.trim();
  return DECIMAL_RE.test(s) ? s : null;
}
function normalizeDate(v) {
  if (typeof v !== 'string') return null;
  const m = DATE_RE.exec(v.trim());
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d, 12));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return `${m[1]}-${m[2]}-${m[3]}`;
}
function normalizeBoolean(v) {
  if (typeof v === 'boolean') return v;
  if (v === 1 || v === '1' || v === 'true' || v === 'Y') return true;
  if (v === 0 || v === '0' || v === 'false' || v === 'N') return false;
  return null;
}
// 자유텍스트 마스킹: 이메일·전화/사업자번호·7자리 이상 숫자열·주민번호형을 토큰으로 대체
function maskFreeText(s) {
  return String(s)
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[이메일]')
    .replace(/\d{6}-\d{7}/g, '[식별번호]')
    .replace(/\d{3}-\d{2}-\d{5}/g, '[사업자번호]')
    .replace(/0\d{1,2}[-. ]?\d{3,4}[-. ]?\d{4}/g, '[전화]')
    .replace(/\d{7,}/g, '[번호]');
}

function checkValue(def, raw, where, errors) {
  const name = def.label || def.key;
  if (isBlank(raw)) {
    if (def.draftRequired) errors.push({ ...where, field: def.key, code: 'REQUIRED', message: `${name}은(는) 필수 입력입니다(웹 초안 최소 요건)` });
    return undefined;
  }
  switch (def.valueType) {
    case 'date': {
      const v = normalizeDate(raw);
      if (v === null) errors.push({ ...where, field: def.key, code: 'INVALID_DATE', message: `${name}은(는) YYYY-MM-DD 형식의 실제 날짜여야 합니다` });
      return v;
    }
    case 'decimal': {
      const v = normalizeDecimal(raw);
      if (v === null) errors.push({ ...where, field: def.key, code: 'INVALID_DECIMAL', message: `${name} 형식이 올바르지 않습니다(정수 18자리·소수 8자리 이내, 지수·쉼표 불가)` });
      return v;
    }
    case 'boolean': {
      const v = normalizeBoolean(raw);
      if (v === null) errors.push({ ...where, field: def.key, code: 'INVALID_BOOLEAN', message: `${name}은(는) 예/아니오 값이어야 합니다` });
      return v;
    }
    case 'ref': {
      const s = typeof raw === 'string' ? raw.trim() : '';
      if (!REF_RE.test(s)) {
        errors.push({ ...where, field: def.key, code: 'INVALID_REF', message: `${name} 참조코드 형식이 올바르지 않습니다(영문·숫자·._/- 60자 이내). 이름·상호는 저장하지 않습니다` });
        return null;
      }
      return s;
    }
    case 'text': {
      if (typeof raw !== 'string') { errors.push({ ...where, field: def.key, code: 'INVALID_TEXT', message: `${name}은(는) 문자열이어야 합니다` }); return null; }
      const s = raw.trim();
      if (s.length > def.maxLength) { errors.push({ ...where, field: def.key, code: 'TOO_LONG', message: `${name}은(는) ${def.maxLength}자를 넘을 수 없습니다` }); return null; }
      return maskFreeText(s);
    }
    default:
      errors.push({ ...where, field: def.key, code: 'UNSUPPORTED_TYPE', message: `${name} 유형을 처리할 수 없습니다` });
      return null;
  }
}

// ── 검증 ─────────────────────────────────────────────────────────────────────
function validateDraft(program, payload) {
  const errors = [];
  const warnings = [];
  if (!PROGRAMS[program]) return { ok: false, errors: [{ field: 'program', code: 'UNKNOWN_PROGRAM', message: `지원하지 않는 화면입니다: ${String(program)}` }], warnings, normalized: null };
  const schema = fieldSchema(program);
  const headIn = payload && typeof payload.head === 'object' && payload.head !== null ? payload.head : {};
  const linesIn = payload && Array.isArray(payload.lines) ? payload.lines : null;
  if (!payload || typeof payload !== 'object') errors.push({ field: 'payload', code: 'INVALID_PAYLOAD', message: '입력 본문이 객체가 아닙니다' });
  const headKeys = new Set(schema.head.map((f) => f.key));
  for (const key of Object.keys(headIn)) if (!headKeys.has(key)) errors.push({ field: key, code: 'UNKNOWN_FIELD', message: `허용되지 않은 입력 칸입니다: ${key}` });
  const head = {};
  for (const def of schema.head) {
    const v = checkValue(def, headIn[def.key], {}, errors);
    if (v !== undefined) head[def.key] = v;
    else if (def.required === null && !def.draftRequired) warnings.push({ field: def.key, code: 'REQUIRED_UNOBSERVED', message: `${def.label || def.key}: 원본 필수 여부 미관측(빈칸 허용)` });
  }
  const lines = [];
  if (!linesIn) errors.push({ field: 'lines', code: 'LINES_REQUIRED', message: '품목 행(lines) 배열이 필요합니다' });
  else {
    if (linesIn.length === 0) errors.push({ field: 'lines', code: 'LINES_EMPTY', message: '품목 행이 최소 1개 필요합니다(웹 초안 최소 요건)' });
    if (linesIn.length > MAX_LINES) errors.push({ field: 'lines', code: 'TOO_MANY_LINES', message: `품목 행은 ${MAX_LINES}개를 넘을 수 없습니다` });
    const lineKeys = new Set(schema.lines.fields.map((f) => f.key));
    linesIn.slice(0, MAX_LINES).forEach((lineIn, idx) => {
      const lineNo = idx + 1;
      const where = { lineNo };
      if (!lineIn || typeof lineIn !== 'object') { errors.push({ ...where, field: 'line', code: 'INVALID_LINE', message: `${lineNo}행이 객체가 아닙니다` }); return; }
      for (const key of Object.keys(lineIn)) if (!lineKeys.has(key) && key !== 'lineNo') errors.push({ ...where, field: key, code: 'UNKNOWN_FIELD', message: `${lineNo}행: 허용되지 않은 열입니다: ${key}` });
      const line = { lineNo };
      for (const def of schema.lines.fields) {
        const v = checkValue(def, lineIn[def.key], where, errors);
        if (v !== undefined) line[def.key] = v;
      }
      lines.push(line);
    });
  }
  return { ok: errors.length === 0, errors, warnings, normalized: errors.length === 0 ? { program, head, lines } : null };
}

// ── 초안 수명주기 (순수, 불변 객체 반환) ───────────────────────────────────────
const actorHash = (actor) => crypto.createHash('sha256').update('ecount-input-draft:' + String(actor)).digest('hex');
function nowIso(opts) {
  const at = opts && opts.now ? opts.now : new Date().toISOString();
  if (typeof at !== 'string' || Number.isNaN(Date.parse(at))) fail('INVALID_NOW', 500);
  return at;
}
function requireActor(opts) {
  if (!opts || isBlank(opts.actor)) fail('ACTOR_REQUIRED', 401);
  return actorHash(opts.actor);
}
const contentHash = (head, lines) => crypto.createHash('sha256').update(JSON.stringify({ head, lines })).digest('hex');

function createDraft(program, payload, opts) {
  const actor = requireActor(opts);
  const at = nowIso(opts);
  const result = validateDraft(program, payload);
  if (!result.ok) fail('VALIDATION_FAILED', 400, result.errors);
  const draftId = opts.draftId ? String(opts.draftId).toLowerCase() : crypto.randomUUID();
  if (!UUID_RE.test(draftId)) fail('INVALID_DRAFT_ID');
  const { head, lines } = result.normalized;
  return Object.freeze({
    draftId, program, status: 'draft', revision: 1, createdBy: actor, createdAt: at, updatedAt: at, cancelledReason: null,
    head, lines, contentHash: contentHash(head, lines),
    audit: [{ revision: 1, action: 'create', actor, at, diff: { head: { added: Object.keys(head) }, lines: { count: lines.length } } }],
  });
}

function assertRevision(draft, expectedRevision) {
  if (!Number.isInteger(expectedRevision) || expectedRevision < 1) fail('EXPECTED_REVISION_REQUIRED', 400);
  if (draft.revision !== expectedRevision) fail('REVISION_CONFLICT', 409, { current: draft.revision, expected: expectedRevision });
}
function diffHead(before, after) {
  const changed = {};
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) changed[key] = { from: before[key] === undefined ? null : before[key], to: after[key] === undefined ? null : after[key] };
  }
  return changed;
}
function diffLines(before, after) {
  const max = Math.max(before.length, after.length);
  const changed = [];
  for (let i = 0; i < max; i += 1) {
    const b = before[i];
    const a = after[i];
    if (!b) changed.push({ lineNo: i + 1, kind: 'added', to: a });
    else if (!a) changed.push({ lineNo: i + 1, kind: 'removed', from: b });
    else if (JSON.stringify(b) !== JSON.stringify(a)) changed.push({ lineNo: i + 1, kind: 'changed', fields: diffHead(b, a) });
  }
  return { before: before.length, after: after.length, changed };
}

// patch: { head?: {key: value|null}, lines?: [...] } — head 는 부분 병합(null 로 칸 비우기), lines 는 전체 교체
function applyCorrection(draft, patch, expectedRevision, opts) {
  const actor = requireActor(opts);
  const at = nowIso(opts);
  if (!draft || !PROGRAMS[draft.program]) fail('INVALID_DRAFT');
  if (draft.status === 'cancelled') fail('DRAFT_CANCELLED', 409);
  assertRevision(draft, expectedRevision);
  if (!patch || typeof patch !== 'object' || (patch.head === undefined && patch.lines === undefined)) fail('EMPTY_PATCH');
  const mergedHead = { ...draft.head };
  if (patch.head !== undefined) {
    if (!patch.head || typeof patch.head !== 'object') fail('INVALID_PATCH_HEAD');
    for (const [key, value] of Object.entries(patch.head)) {
      if (value === null) delete mergedHead[key];
      else mergedHead[key] = value;
    }
  }
  const result = validateDraft(draft.program, { head: mergedHead, lines: patch.lines !== undefined ? patch.lines : draft.lines });
  if (!result.ok) fail('VALIDATION_FAILED', 400, result.errors);
  const { head, lines } = result.normalized;
  const diff = { head: diffHead(draft.head, head), lines: diffLines(draft.lines, lines), statusFrom: draft.status, statusTo: 'draft' };
  if (Object.keys(diff.head).length === 0 && diff.lines.changed.length === 0 && draft.status === 'draft') fail('NO_CHANGE', 409);
  const revision = draft.revision + 1;
  return Object.freeze({
    ...draft, status: 'draft', revision, updatedAt: at, head, lines, contentHash: contentHash(head, lines),
    audit: [...draft.audit, { revision, action: 'correct', actor, at, diff }],
  });
}

function review(draft, expectedRevision, opts) {
  const actor = requireActor(opts);
  const at = nowIso(opts);
  if (!draft || !PROGRAMS[draft.program]) fail('INVALID_DRAFT');
  if (draft.status === 'cancelled') fail('DRAFT_CANCELLED', 409);
  if (draft.status === 'reviewed') fail('ALREADY_REVIEWED', 409);
  assertRevision(draft, expectedRevision);
  const revision = draft.revision + 1;
  return Object.freeze({ ...draft, status: 'reviewed', revision, updatedAt: at,
    audit: [...draft.audit, { revision, action: 'review', actor, at, diff: { statusFrom: draft.status, statusTo: 'reviewed' } }] });
}

function cancel(draft, reason, expectedRevision, opts) {
  const actor = requireActor(opts);
  const at = nowIso(opts);
  if (!draft || !PROGRAMS[draft.program]) fail('INVALID_DRAFT');
  if (draft.status === 'cancelled') fail('ALREADY_CANCELLED', 409);
  if (typeof reason !== 'string' || reason.trim() === '') fail('CANCEL_REASON_REQUIRED', 400, { message: '취소 사유는 필수입니다' });
  if (reason.trim().length > 200) fail('CANCEL_REASON_TOO_LONG', 400, { message: '취소 사유는 200자를 넘을 수 없습니다' });
  assertRevision(draft, expectedRevision);
  const cancelledReason = maskFreeText(reason.trim());
  const revision = draft.revision + 1;
  return Object.freeze({ ...draft, status: 'cancelled', revision, updatedAt: at, cancelledReason,
    audit: [...draft.audit, { revision, action: 'cancel', actor, at, diff: { statusFrom: draft.status, statusTo: 'cancelled', reason: cancelledReason } }] });
}

// 조회 투영: 저장된 값 그대로(이미 마스킹/참조코드) + 상태. 하드 삭제 경로 없음.
function readDraft(draft) {
  if (!draft || !PROGRAMS[draft.program]) fail('INVALID_DRAFT');
  return { draftId: draft.draftId, program: draft.program, title: PROGRAMS[draft.program].title, status: draft.status, revision: draft.revision,
    createdAt: draft.createdAt, updatedAt: draft.updatedAt, cancelledReason: draft.cancelledReason, head: { ...draft.head }, lines: draft.lines.map((l) => ({ ...l })),
    contentHash: draft.contentHash, accountingPosted: false, sourceSaved: false, deletable: false, cancellable: draft.status !== 'cancelled' };
}

// ── 저장 계획 (SQL 실행 없음, 세 테이블만 가리킴) ─────────────────────────────
function buildSavePlan(program, draft, options) {
  if (!PROGRAMS[program]) fail('UNKNOWN_PROGRAM');
  if (!draft || draft.program !== program) fail('PROGRAM_MISMATCH');
  if (!STATUSES.includes(draft.status)) fail('INVALID_STATUS');
  const last = draft.audit[draft.audit.length - 1];
  if (!last || last.revision !== draft.revision || !ACTIONS.includes(last.action)) fail('AUDIT_OUT_OF_SYNC', 500);
  const action = (options && options.action) || last.action;
  if (action !== last.action) fail('ACTION_MISMATCH');
  const headRow = { DraftId: draft.draftId, Program: program, Status: draft.status, Revision: draft.revision, FieldsJson: JSON.stringify(draft.head), LineCount: draft.lines.length,
    CreatedBy: draft.createdBy, CreatedAt: draft.createdAt, UpdatedAt: draft.updatedAt, CancelledReason: draft.cancelledReason };
  const lineRows = draft.lines.map((line) => { const { lineNo, ...fields } = line; return { DraftId: draft.draftId, Revision: draft.revision, LineNo: lineNo, FieldsJson: JSON.stringify(fields) }; });
  const auditRow = { DraftId: draft.draftId, Revision: draft.revision, Action: last.action, Actor: last.actor, At: last.at, DiffJson: JSON.stringify(last.diff) };
  const statements = [];
  if (action === 'create') {
    statements.push({ op: 'INSERT', table: TABLES.head, row: headRow });
    for (const row of lineRows) statements.push({ op: 'INSERT', table: TABLES.line, row });
  } else {
    // 헤더 UPDATE 는 revision 재검사(optimistic) 조건을 포함한다. 라인은 삭제 없이 새 revision 집합을 추가한다.
    statements.push({ op: 'UPDATE', table: TABLES.head, where: { DraftId: draft.draftId, Revision: draft.revision - 1 },
      set: { Status: headRow.Status, Revision: headRow.Revision, FieldsJson: headRow.FieldsJson, LineCount: headRow.LineCount, UpdatedAt: headRow.UpdatedAt, CancelledReason: headRow.CancelledReason } });
    if (action === 'correct') for (const row of lineRows) statements.push({ op: 'INSERT', table: TABLES.line, row });
  }
  statements.push({ op: 'INSERT', table: TABLES.audit, row: auditRow });
  for (const s of statements) if (!WRITE_ALLOWLIST.includes(s.table) || !['INSERT', 'UPDATE'].includes(s.op)) fail('WRITE_OUTSIDE_ALLOWLIST', 500);
  return Object.freeze({
    program, draftId: draft.draftId, action, status: draft.status, revision: draft.revision,
    tables: [...WRITE_ALLOWLIST],
    rows: { head: headRow, lines: lineRows, audit: auditRow },
    keys: { head: ['DraftId'], line: ['DraftId', 'Revision', 'LineNo'], audit: ['DraftId', 'Revision'] },
    statements,
    hardDelete: false,
    accountingPosted: false,
    sourceWrites: 'none (ECOUNT 원본 저장 미승인·미실행)',
    erpLedgerWrites: 'none',
    sideEffects: 'none (web-only draft)',
    executed: false,
  });
}

module.exports = Object.freeze({
  EVIDENCE_FILE, TABLES, WRITE_ALLOWLIST, STATUSES, ACTIONS, MAX_LINES, PROGRAMS, PROGRAM_IDS, LABEL_MAP, BODY_TOGGLE_MAP,
  fieldSchema, allSchemas, validateDraft, maskFreeText, createDraft, applyCorrection, review, cancel, readDraft, buildSavePlan, actorHash,
});
