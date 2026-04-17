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
