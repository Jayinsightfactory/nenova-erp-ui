// lib/orderUtils.js — 주문 공통 유틸리티

/**
 * 품목 단위 결정 — 우선순위:
 * 1. DB 주문이력에서 집계한 단위 (prodUnitMap[prodKey])
 * 2. fallback (Claude 파싱값 또는 기본값 '박스')
 *
 * @param {object|null} prod  - Product 객체 (ProdKey 포함)
 * @param {string}      fallback - 이력 없을 때 사용할 값
 * @param {object}      prodUnitMap - { [ProdKey]: '박스'|'단'|'송이' }
 */
export function defaultUnit(prod, fallback, prodUnitMap = {}) {
  // 1순위: Product.OutUnit (사용자 수동 설정)
  if (prod?.OutUnit) return prod.OutUnit;
  // 2순위: OrderDetail 이력 집계
  if (prod?.ProdKey && prodUnitMap[prod.ProdKey]) return prodUnitMap[prod.ProdKey];
  const u = fallback || '박스';
  return u === '개' ? '송이' : u;
}

/**
 * OrderWeek 형식 검증 + 정규화
 * - 허용: 'NN-NN' (예: '17-02') 또는 'YYYY-NN-NN' (예: '2026-17-02')
 * - 거부: '17-01B', '470-01', '17-2', '', null, 빈문자 등
 *
 * 운영 데이터에 박힌 형식 오류 행 ('17-01B', '470-01') 의 신규 생성을 차단하기 위함.
 * 전산 SP 들이 OrderYearWeek = OrderYear + REPLACE(OrderWeek,'-','') 로 키를 만들어
 * 형식이 깨지면 전산-웹 매칭이 어긋남.
 *
 * @param {string} week 입력
 * @returns {{ year: string|null, week: string }} 정규화 결과
 * @throws {Error} 형식 오류
 */
export function validateOrderWeek(week) {
  if (!week || typeof week !== 'string') {
    const e = new Error(`OrderWeek 형식 오류: 빈 값 또는 비문자열 (받음: ${JSON.stringify(week)})`);
    e.code = 'INVALID_ORDER_WEEK';
    throw e;
  }
  const w = week.trim();
  // YYYY-NN-NN 형식
  const m1 = w.match(/^(\d{4})-(\d{2}-\d{2})$/);
  if (m1) return { year: m1[1], week: m1[2] };
  // NN-NN 형식
  const m2 = w.match(/^(\d{2}-\d{2})$/);
  if (m2) return { year: null, week: m2[1] };
  // 거부
  const e = new Error(
    `OrderWeek 형식 오류: 'NN-NN' 또는 'YYYY-NN-NN' 만 허용 (받음: '${w}'). ` +
    `예: '17-02' 또는 '2026-17-02'. ` +
    `차수에 알파벳/3자리/대시 누락 등 포함되면 전산 프로그램과 매칭이 깨집니다.`
  );
  e.code = 'INVALID_ORDER_WEEK';
  throw e;
}

/**
 * OrderYearWeek (전산 결합 키) 생성 — 'YYYYNNNN' (예: '20261702')
 */
export function buildOrderYearWeek(year, week) {
  return String(year) + (week || '').replace('-', '');
}
