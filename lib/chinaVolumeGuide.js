export const CHINA_GUIDE_KEY = 'nenova.china-volume-guide.v1';
export const chinaGuideEnabled = value => value !== 'false';

export function chinaGuideStep(s) {
  if (s.busy) return { id: 'busy', text: '처리 중입니다. 완료 응답을 기다려 주세요.' };
  if (!s.scopeCurrent) return s.scopeConfirmed
    ? { id: 'load', target: 'load', text: '② 중국 물량표 조회를 눌러 선택 차수를 불러오세요.' }
    : { id: 'scope', target: 'week', text: '① 작업할 연도·차수를 선택해 주세요.', next: '차수 확인' };
  if (s.error) return { id: 'error', target: 'error', text: '오류 내용을 확인하세요. 작업 이력에서 처리 결과를 확인한 뒤 진행하세요.' };
  if (s.applied) return { id: 'done', target: 'download', text: '등록·분배 저장이 완료됐습니다. 엑셀을 다운로드할 수 있습니다. 다시 수정하면 재검토하세요.' };
  if (s.preview) return s.canApply
    ? { id: 'apply', target: 'apply', text: '⑥ 변경량과 경고를 확인한 뒤 확인 후 등록·분배 저장을 누르세요. 자동 저장하지 않습니다.' }
    : { id: 'blocked', target: 'preview', text: '⑥ 검증 사유·수량 경고를 확인하세요. 적용 조건을 충족하기 전에는 저장할 수 없습니다.' };
  if (s.packingReview) return s.unmatched
    ? { id: 'match', target: 'match', text: '③ 패킹리스트의 미매칭 업체·품목을 수정하세요.' }
    : !s.canMatch
      ? { id: 'split', target: 'reconcile', text: '③ 인보이스 수량과 업체별 박스 분할을 확인하세요. 분할 합계가 원문 수량과 같아야 합니다.' }
      : { id: 'packing', target: 'packing', text: '③ 원문·매칭·수량을 확인하고 매칭 적용을 누르세요. 아직 ERP 분배는 저장되지 않습니다.' };
  if (!s.editReady) return { id: 'edit', target: 'matrix', text: '③ 업체별 수량·박스번호와 주문·입고·잔량을 확인하세요. 패킹리스트 업로드는 필요한 경우만 사용하세요.', next: '편집 완료' };
  if (!s.saved) return { id: 'save', target: 'save', text: '④ 작업 저장을 눌러 작업본을 보관하세요. 작업 저장과 ERP 분배 저장은 별개입니다.' };
  return { id: 'review', target: 'review', text: '⑤ 등록·분배 저장을 눌러 현재 DB와 변경량을 검토하세요. 확인창에서 최종 저장합니다.' };
}
