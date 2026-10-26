export const DUTCH_GUIDE_KEY = 'nenova.dutch-volume-guide.v1';
export const dutchGuideEnabled = value => value !== 'false';

export function dutchGuideStep(s) {
  if (s.busy) return { id: 'busy', text: '처리 중입니다. 완료 응답을 기다려 주세요.' };
  if (s.applied) return { id: 'done', text: 'ERP 적용과 DB 검증이 완료됐습니다. 새로 수정하면 다시 저장·검토하세요.' };
  if (!s.hasWork) return s.scopeConfirmed
    ? { id: 'load', target: 'load', text: '② 물량을 불러오세요. 엑셀 업로드로 시작해도 됩니다.' }
    : { id: 'scope', target: 'week', text: '① 작업할 연도·차수를 선택해 주세요.', next: '차수 확인' };
  if (!s.editReady && !s.saved) return { id: 'edit', target: 'matrix', text: '③ 업체·품목·수량을 편집하세요. 주문 합계와 예상 잔량도 함께 확인하세요.', next: '편집 완료' };
  if (!s.saved) return { id: 'save', target: 'save', text: '④ 작업을 저장하세요. 작업 저장만으로 ERP에 반영되지는 않습니다.' };
  if (!s.reviewed || !s.validationCurrent) return { id: 'review', target: 'review', text: '⑤ 작업 완료·업로드 검토로 현재 DB를 다시 검증하세요.' };
  if (!s.canApply) return { id: 'blocked', target: 'review-result', text: '⑤ 미매칭·확정·검증 사유를 확인하고 해결 후 다시 검토하세요. 아직 적용할 수 없습니다.' };
  return { id: 'apply', target: 'apply', text: '⑥ 변경량·누락→0 범위를 확인하고 동의한 뒤 ERP 적용을 누르세요. 자동으로 적용하지 않습니다.' };
}
