// lib/productSearchLimits.js
// 품목 검색 드롭다운 공통 상한. 품목 점수 계산은 전체 카탈로그(수천 건)를 훑기 때문에
// 키 입력마다 계산하면 화면이 멈춘다. 모든 품목 검색 UI가 같은 값을 쓴다.

// 타이핑이 멈춘 뒤에만 점수를 계산한다.
export const PRODUCT_SEARCH_DEBOUNCE_MS = 250;

// 드롭다운에 실제로 그리는 최대 행 수. 검색어가 없을 때 전체 목록을 그리면
// DOM 노드가 수천 개가 되어 드롭다운을 여는 것만으로 멈춘다.
export const PRODUCT_SEARCH_RESULT_LIMIT = 200;
