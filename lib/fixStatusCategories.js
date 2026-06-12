// 견적서 확정현황 — 카테고리(CountryFlower) 필터 헬퍼

/** UI 프리셋: 꽃/품종 키워드 → CountryFlower 목록에서 매칭 */
export const FIX_CATEGORY_PRESETS = [
  { id: 'all', label: '전체', match: () => true },
  { id: 'carnation', label: '카네이션', match: (cf) => /카네이션|carnation/i.test(cf) },
  { id: 'rose', label: '장미', match: (cf) => /장미|rose/i.test(cf) },
  { id: 'hydrangea', label: '수국', match: (cf) => /수국|hydrangea|ruscus|루스커스/i.test(cf) },
  { id: 'alstro', label: '알스트로', match: (cf) => /알스트로|alstro/i.test(cf) },
  { id: 'netherlands', label: '네덜란드', match: (cf) => /네덜란드|netherlands/i.test(cf) },
];

export function normalizeCategoryList(categories) {
  return [...new Set((categories || [])
    .map(c => String(c || '').trim())
    .filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, 'ko'));
}

/** 선택된 카테고리 → API countryFlowers (빈 배열 = 전체) */
export function resolveCountryFlowerFilter(selectedCategories, availableCategories) {
  const available = normalizeCategoryList(availableCategories);
  const selected = normalizeCategoryList(selectedCategories);
  if (!selected.length) return [];
  const allowed = new Set(available);
  return selected.filter(cf => allowed.has(cf));
}

export function categoriesForPreset(presetId, availableCategories) {
  const preset = FIX_CATEGORY_PRESETS.find(p => p.id === presetId);
  const available = normalizeCategoryList(availableCategories);
  if (!preset || preset.id === 'all') return [];
  return available.filter(cf => preset.match(cf));
}

export function parseUnfixedCategoryLabels(text) {
  return String(text || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
}
