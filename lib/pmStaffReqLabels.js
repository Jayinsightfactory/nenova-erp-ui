// lib/pmStaffReqLabels.js — /pm 직원 요청 게시판 분류·상태 이름(화면·서버 공용, fs 없음)
export const STAFF_REQ_CATEGORIES = Object.freeze([['error', '오류'], ['feature', '기능요청'], ['data', '데이터 이상'], ['etc', '기타']]);
export const STAFF_REQ_STATUSES = Object.freeze([
  ['received', '접수'], ['triaged', '분류됨'], ['working', '처리중'], ['pr', 'PR 올라감'],
  ['deployed', '배포됨'], ['answered', '답변완료'], ['needs-human', '사람 확인 필요'], ['rejected', '반려'],
]);
export const STAFF_REQ_DONE = Object.freeze(['deployed', 'answered', 'rejected']);
export const statusLabel = (s) => (STAFF_REQ_STATUSES.find(([k]) => k === s) || [s, s])[1];
export const categoryLabel = (c) => (STAFF_REQ_CATEGORIES.find(([k]) => k === c) || [c, c])[1];

