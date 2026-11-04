import { normalizeDefectUnit } from './salesDefectDeductionCore.js';
import { defectSourceReview } from './salesDefectAutoSource.js';

// Display the original defect period, never the selected registration/cost period.
export function defectSourcePeriodLabel(row = {}) {
  const year = String(row.orderYear ?? '').trim();
  const week = String(row.orderWeek ?? '').trim();
  if (!/^\d{4}$/.test(year) || !/^\d{1,2}(?:-\d{1,2})?$/.test(week) || Number(week.split('-')[0]) < 1) return '원불량 차수 미확인';
  return `${year}년 ${week}차 불량`;
}

// UI actions describe server decisions; they never grant eligibility.
export function isDefectRegistrationHeld(row = {}) {
  return Boolean(defectSourceReview(row)) || (Number(row.custKey ?? row.CustKey) > 0 && Number(row.prodKey ?? row.ProdKey) > 0 && (row.registrationEligibilityCode || row.errorCode) === 'CUSTOMER_SALE_MISSING');
}

export function defectResolution(row = {}) {
  const code = defectSourceReview(row)?.code || row.errorCode || row.registrationEligibilityCode || '';
  if (code === 'MANUAL_HOLD') return {kind:'held',title:'담당자 보류',action:'본창 보류 목록에서 이 항목을 체크하고 보류 해제를 누르세요. 출고·단가·중복 조건을 다시 확인합니다.'};
  if (code === 'PERMANENT_OMITTED') return { kind: 'omitted', title: '누락 처리된 자료', action: '본창의 누락 처리 내역·취소에서 복원하세요.' };
  if (!(Number(row.custKey) > 0) || !(Number(row.prodKey) > 0)) return { kind: 'match', title: '업체·품목을 선택하세요', action: '원본 이름과 전산 검색 결과를 비교해 매칭하세요.' };
  if (['AUTO_SOURCE_ESTIMATE_CONFLICT', 'EXISTING_ESTIMATE', 'ALREADY_REGISTERED'].includes(code)) return { kind: 'existing', title: '이미 반영된 차감과 대조하세요', action: '아래 기존 견적의 차수·품목·수량을 확인하세요. 같은 신고라면 이번 등록에서 보류하세요. 기존 견적은 유지됩니다.' };
  if (code === 'SOURCE_UNIT_CONVERSION_REQUIRED') return { kind: 'unit', title: '단위 환산 근거가 필요합니다', action: '단·송이 환산을 임의 추정할 수 없습니다. 담당자와 실제 수량을 확인하고, 그동안 이 항목은 보류하세요.' };
  if (code === 'LINKED_ESTIMATE_MISSING') return { kind: 'held', title: '보류 · 이전 차감 견적 없음', action: '예전 등록번호의 실제 차감 견적을 찾지 못했습니다. 출고분배 유무와는 별개입니다. 취소 의도를 확인할 때까지 보류 목록에 보관합니다.' };
  if (defectSourceReview(row)) return { kind: 'source', title: code === 'SOURCE_FACT_REVIEW_REQUIRED' ? '신고 원문과 수량을 맞춰주세요' : code === 'LINKED_ESTIMATE_MISSING' ? '이전 등록 내역과 원문을 대조하세요' : code === 'REJECTED_AUTO_SOURCE' ? '과거 취소 사유와 원문을 대조하세요' : '신고 원문을 연결하세요', action: '업체·품목·수량을 먼저 정정하고, 불량방 원문 파일에서 해당 메시지를 선택해 대조하세요. 과거 등록·부분처리 이력이 있으면 원본 수량을 덮어쓰지 않습니다.' };
  if (code === 'CUSTOMER_SALE_MISSING') return { kind: 'defer', title: '이번 차수 업체 분배 없음', action: '이번 등록에서는 보류됩니다. 다음 차수에 이 업체의 분배가 생기면 다시 등록할 수 있습니다.' };
  if (code === 'COST_MISSING') return { kind: 'cost', title: '단가를 입력하세요', action: '현재 연결 품목의 단가가 없습니다. 아래 출고 품목·업체·차수·단가를 확인하세요. 품목번호나 규격이 다르면 매칭을 정정한 뒤 자동단가를 다시 조회합니다.' };
  if (row.registrationEligible === true && !row.error) return { kind: 'ready', title: '등록 준비 완료', action: '' };
  return { kind: 'other', title: '입력 내용을 확인하세요', action: row.registrationError || row.error || '다시 조회한 뒤 업체·품목·수량을 확인하세요.' };
}

export function resolutionDuplicateGroups(rows = [], excluded = new Set()) {
  const groups = [];
  for (const row of rows) {
    if (excluded.has(Number(row.deductionKey)) || row.error || !row.after) continue;
    const a = row.after, quantity = Math.abs(Number(row.editQuantity ?? row.quantity));
    if (!(quantity > 0)) continue;
    const group = groups.find(g => {
      const b = g[0].after;
      return Number(a.AppliedOrderYear) === Number(b.AppliedOrderYear) && String(a.AppliedOrderWeek) === String(b.AppliedOrderWeek)
        && Number(a.ShipmentKey) === Number(b.ShipmentKey) && Number(a.ProdKey) === Number(b.ProdKey)
        && normalizeDefectUnit(a.Unit) === normalizeDefectUnit(b.Unit)
        && Math.abs(quantity - Math.abs(Number(g[0].editQuantity ?? g[0].quantity))) < 0.0001;
    });
    if (group) group.push(row); else groups.push([row]);
  }
  return groups.filter(g => g.length > 1);
}

export function resolutionReadyRows(rows, excluded = new Set()) {
  const duplicateKeys = new Set(resolutionDuplicateGroups(rows, excluded).flat().map(r => Number(r.deductionKey)));
  return rows.filter(r => !excluded.has(Number(r.deductionKey)) && !duplicateKeys.has(Number(r.deductionKey)) && !r.error && r.after && Number(r.editQuantity ?? r.quantity) > 0);
}

export const resolutionDescriptor = row => ({ deductionKey: Number(row.deductionKey), sourceYear: Number(row.orderYear), sourceWeek: String(row.orderWeek), expectedRowVersionNo: Number(row.rowVersionNo) });
