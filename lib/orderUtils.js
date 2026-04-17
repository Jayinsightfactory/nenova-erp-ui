// lib/orderUtils.js — 주문 공통 유틸리티

/**
 * 품목·국가 기준 기본 단위 결정
 * - 장미(ROSE) → 단 (국가 무관)
 * - 네덜란드산 → 단 (꽃 무관)
 * - 그 외 → 박스
 */
export function defaultUnit(prod, fallback) {
  if (prod) {
    const flower  = (prod.FlowerName || prod.flowerName || '').toUpperCase();
    const country = (prod.CounName   || prod.counName   || '').toUpperCase();
    if (flower.includes('ROSE') || flower === '장미') return '단';
    if (country.includes('네덜란드') || country.includes('NETHERLANDS') || country.includes('HOLLAND')) return '단';
  }
  const u = fallback || '박스';
  return u === '개' ? '송이' : u;
}
