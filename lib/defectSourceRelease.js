import { isDefectAdmin, normalizeDefectUnit, normalizeParentWeek, normalizeYear } from './salesDefectDeductionCore.js';

function fail(message, code = 'SOURCE_RELEASE_INVALID') {
  const error = new Error(message); error.code = code; error.statusCode = 409; throw error;
}

// Explicit, audited review is different from client-supplied eligibility flags.
// This action releases a candidate only; the normal registration transaction still
// validates price, EXE sales scope, duplicates and quantities before any Estimate write.
export function planReviewedSourceRelease({ year, week, user, selection, row, applications = [], mode = 'release' }) {
  if (!isDefectAdmin(user)) fail('원문 재검토는 관리자만 처리할 수 있습니다.', 'SOURCE_RELEASE_FORBIDDEN');
  const y = normalizeYear(year), w = normalizeParentWeek(week), e = selection?.evidence;
  if (!y || !w || !row || row.IsDeleted || Number(row.OrderYear) !== y
    || !Number.isInteger(selection?.expectedRowVersionNo) || selection.expectedRowVersionNo < 1
    || normalizeParentWeek(row.OrderWeek) > w || Number(selection.deductionKey) !== Number(row.DeductionKey)
    || Number(selection.expectedRowVersionNo) !== Number(row.RowVersionNo)) fail('원장 범위·버전이 변경됐습니다. 다시 대조하세요.');
  if (!e || !/^[a-f0-9]{64}$/.test(e.sourceSha256 || '') || !/^[a-f0-9]{64}$/.test(e.messageSha256 || '')
    || !(Number(row.CustKey)>0) || !(Number(row.ProdKey)>0) || !(Number(row.Quantity)>0) || !normalizeDefectUnit(row.SourceUnit)
    || !Number.isInteger(e.messageOrdinal) || e.messageOrdinal < 1 || normalizeYear(e.sourceYear) !== y
    || !normalizeParentWeek(e.sourceWeek) || normalizeParentWeek(e.sourceWeek) > w
    || Number(e.custKey) !== Number(row.CustKey) || Number(e.prodKey) !== Number(row.ProdKey)
    || Number(e.quantity) !== Number(row.Quantity) || normalizeDefectUnit(e.sourceUnit) !== normalizeDefectUnit(row.SourceUnit)
    || typeof e.reason !== 'string' || e.reason.trim().length < 10 || e.reason.length > 1000) fail('동일 업체·품목·수량·단위의 원문 검토 근거가 필요합니다.');
  if (!['release','confirm-linked','manual-provenance'].includes(mode)) fail('검토 동작을 확인하세요.');
  if (!row.RejectedAutoSource && !row.MissingLinkedEstimate && !row.IncompleteAutoSource && !row.SourceFactReview) fail('검토 차단 상태가 변경됐습니다.');
  if (applications.length || row.IsCarryoverLedger) fail('부분 적용 원장은 별도 수량 대조가 필요합니다.', 'SOURCE_RELEASE_APPLIED');
  // A valid linked Estimate, including a positive replacement, is never detached.
  if (mode === 'manual-provenance') {
    if(e.kind!=='USER_CONFIRMED_MANUAL_INPUT')fail('사용자 수기입력 확인 근거가 필요합니다.');
  } else if (mode === 'confirm-linked') {
    const linked = selection.linkedEstimate;
    if (!linked || linked.MasterDeleted || Number(linked.CustKey)!==Number(row.CustKey) || Number(linked.ProdKey)!==Number(row.ProdKey)
      || Number(linked.OrderYear)!==y || normalizeParentWeek(linked.OrderWeek)!==w || !(Number(linked.Quantity)<0)
      || Math.abs(Number(linked.Quantity))!==Number(row.Quantity) || normalizeDefectUnit(linked.Unit)!==normalizeDefectUnit(row.SourceUnit)) fail('같은 현재 차수의 실제 음수 견적과 원문 수량·단위가 일치해야 합니다.');
  } else if (selection.linkedEstimateExists) fail('실제 견적이 있는 연결은 이 작업으로 해제할 수 없습니다.', 'SOURCE_RELEASE_LIVE_ESTIMATE');
  return {reviewedRowVersionNo:Number(row.RowVersionNo)+(mode==='manual-provenance'?0:1),evidence:e,retainLinked:mode!=='release',manualProvenance:mode==='manual-provenance'};
}
