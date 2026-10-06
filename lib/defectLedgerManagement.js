import { canUseDefectSupport, canUseDefectIncoming, normalizeParentWeek, normalizeYear, normalizeDefectUnit } from './salesDefectDeductionCore.js';
import { shouldResetIncomingConfirmation } from './salesDefectDeductionState.js';

function fail(message, statusCode = 400) { const e = new Error(message); e.statusCode = statusCode; throw e; }
export function canManageDefectLedger(user) { return canUseDefectSupport(user) || canUseDefectIncoming(user); }
export function normalizeManagementRequest({ action, year, week, rows, changes = {}, user, preview = false }) {
  if (!canManageDefectLedger(user)) fail('영업지원 또는 수입부 원장 정리 권한이 필요합니다.', 403);
  const y = normalizeYear(year), w = normalizeParentWeek(week);
  if (!y || !w || !['manage-edit', 'manage-archive'].includes(action)) fail('관리 작업의 연도·차수·동작을 확인하세요.');
  const weekYear = String(week).match(/^(\d{4})-/)?.[1];
  if (weekYear && Number(weekYear) !== y) fail('차수 문자열과 선택 연도가 다릅니다.');
  if (!Array.isArray(rows) || !rows.length || rows.length > 500 || (action === 'manage-edit' && rows.length !== 1)) fail('수정은 한 행, 정리는 1~500행을 선택하세요.');
  const seen = new Set();
  const selected = rows.map((r) => {
    const key = Number(r.deductionKey), sourceYear = normalizeYear(r.sourceYear), sourceWeek = normalizeParentWeek(r.sourceWeek), version = Number(r.expectedRowVersionNo);
    const sourceWeekYear = String(r.sourceWeek).match(/^(\d{4})-/)?.[1];
    if (sourceWeekYear && Number(sourceWeekYear) !== sourceYear) fail('원차수 문자열과 원연도가 다릅니다.');
    if (!Number.isInteger(key) || key <= 0 || seen.has(key) || sourceYear !== y || !sourceWeek || sourceWeek > w || !Number.isInteger(version) || version <= 0) fail('중복 선택·다른 연도·미래 원차수 또는 조회 버전을 확인하세요.');
    seen.add(key); return { deductionKey: key, sourceYear, sourceWeek, expectedRowVersionNo: version };
  });
  const fields = ['custKey', 'customerName', 'prodKey', 'productName', 'quantity', 'sourceUnit', 'note'];
  if (!changes || typeof changes !== 'object' || Array.isArray(changes) || Object.keys(changes).some((k) => !fields.includes(k))) fail('수정할 수 없는 필드가 포함됐습니다.');
  if (action === 'manage-edit' && !preview && !Object.keys(changes).length) fail('수정할 내용을 입력하세요.');
  if (preview !== true && preview !== false) fail('미리보기 여부를 확인하세요.');
  return { action, year: y, week: w, rows: selected, changes, preview };
}

export function hasDefectProcessingHistory(histories = []) {
  return histories.some((history) => {
    if (['REGISTER_ESTIMATE', 'REGISTER', 'CARRYOVER_APPLY', 'MANUAL_COMPLETE', 'ESTIMATE_UNLINK'].includes(history.ActionType)) return true;
    return ['BeforeJson', 'AfterJson'].some((field) => {
      try { const value = JSON.parse(history[field] || '{}');
        return Number(value.EstimateKey ?? value.estimateKey) > 0
          || ['REGISTERED', 'COMPLETED', 'MANUAL_COMPLETED'].includes(value.Status ?? value.status);
      } catch { return false; }
    });
  });
}
export function planDefectLedgerManagement({ request, selection, row, applications = [], histories = [] }) {
  if (!row || row.IsDeleted) fail('원장이 삭제되었거나 없습니다.', 409);
  if (Number(row.DeductionKey) !== selection.deductionKey || Number(row.OrderYear) !== selection.sourceYear || normalizeParentWeek(row.OrderWeek) !== selection.sourceWeek
    || Number(row.RowVersionNo) !== selection.expectedRowVersionNo) fail('원차수 또는 조회 버전이 변경됐습니다. 다시 조회하세요.', 409);
  const noteOnly = Boolean(row.EstimateKey || applications.length || hasDefectProcessingHistory(histories)
    || ['REGISTERED', 'COMPLETED', 'MANUAL_COMPLETED'].includes(row.Status));
  if (request.action === 'manage-archive') return { deductionKey: selection.deductionKey, noteOnly, action: 'ARCHIVE_PRESERVE_ESTIMATE', before: row, after: { ...row, IsDeleted: true, Status: 'DELETED' } };
  const change = request.changes;
  const names = { custKey: 'CustKey', customerName: 'CustName', prodKey: 'ProdKey', productName: 'ProdName', quantity: 'Quantity', sourceUnit: 'SourceUnit', note: 'Note' };
  const after = { ...row };
  for (const [key, raw] of Object.entries(change)) {
    let value = raw;
    if (['custKey', 'prodKey', 'quantity'].includes(key)) {
      if (!['number', 'string'].includes(typeof raw) || (typeof raw === 'string' && !raw.trim())) fail('업체·품목·수량 숫자 형식을 확인하세요.');
      value = Number(raw);
      if (!Number.isFinite(value) || value <= 0 || (key !== 'quantity' && !Number.isInteger(value))) fail('업체·품목·수량은 유효한 양수여야 합니다.');
      if (key === 'quantity' && (value >= 1e14 || Math.round(value * 1e4) / 1e4 !== value)) fail('차감수량은 소수점 4자리 이내이며 100조 미만이어야 합니다.');
    } else if (key === 'sourceUnit') {
      value = normalizeDefectUnit(raw); if (!value) fail('단위는 단·박스·스팀(대) 중 선택하세요.');
    } else {
      if (typeof raw !== 'string') fail('이름·비고 형식을 확인하세요.');
      value = raw.trim(); if (value.length > (key === 'note' ? 1000 : key === 'customerName' ? 200 : 300)) fail('이름·비고 길이를 확인하세요.');
      if (key !== 'note' && !value) fail('업체명·품목명을 입력하세요.');
    }
    if (noteOnly && key !== 'note' && String(value) !== String(row[names[key]] ?? '')) fail('견적 등록·이월 적용·처리완료 원장은 비고만 수정할 수 있습니다. 수량·매칭 변경은 견적서관리에서 처리하세요.', 409);
    after[names[key]] = value;
  }
  if (noteOnly && !request.preview && !Object.prototype.hasOwnProperty.call(change, 'note')) fail('처리된 원장은 비고만 수정할 수 있습니다.');
  const importReset = !noteOnly && (shouldResetIncomingConfirmation(row, after)
    || ['CustKey', 'CustName', 'ProdKey', 'ProdName'].some((field) => String(row[field] ?? '') !== String(after[field] ?? '')));
  if (importReset) Object.assign(after, { ImportConfirmed: false, ImportConfirmedBy: '', ImportConfirmedByName: '', ImportConfirmedAt: null });
  // Unapplied carryover balance follows its source quantity; applied ledgers are note-only.
  if (!noteOnly && row.IsCarryoverLedger && Object.prototype.hasOwnProperty.call(change, 'quantity')) {
    after.OriginalQuantity = after.Quantity; after.RemainingQuantity = after.Quantity;
  }
  return { deductionKey: selection.deductionKey, noteOnly, action: 'MANAGE_EDIT', before: row, after, importReset };
}
