/**
 * 출고 확정 API 가드 — nenova.exe 운영 규칙
 * - 이전 차수: 전 카테고리 미확정이면 막음
 * - 같은 차수: 미확정 카테고리가 2개 이상이면 일부만 fix 불가
 */

export function targetMatchesCountryFlowerFilter(target, allowedCountryFlowers) {
  if (!allowedCountryFlowers || allowedCountryFlowers.size === 0) return true;
  const cf = String(target?.countryFlower || '');
  const label = String(target?.label || '');
  return allowedCountryFlowers.has(cf) || allowedCountryFlowers.has(label);
}

/**
 * 카테고리 필터로 fix 시, 미확정 카테고리를 일부만 고르면 차단
 * @param {Array<{countryFlower,label}>} allUnfixedTargets — 차수 내 미확정 전체
 * @param {Set<string>|null} allowedCountryFlowers — 요청 필터
 */
export function evaluatePartialCategoryFixBlock(allUnfixedTargets, allowedCountryFlowers) {
  const unfixed = allUnfixedTargets || [];
  if (!allowedCountryFlowers || allowedCountryFlowers.size === 0) {
    return { blocked: false };
  }
  if (unfixed.length <= 1) {
    return { blocked: false };
  }

  const matching = unfixed.filter((t) => targetMatchesCountryFlowerFilter(t, allowedCountryFlowers));
  if (matching.length === 0) {
    return { blocked: false };
  }
  if (matching.length >= unfixed.length) {
    return { blocked: false };
  }

  const remaining = unfixed
    .filter((t) => !targetMatchesCountryFlowerFilter(t, allowedCountryFlowers))
    .map((t) => t.label || t.countryFlower || '(분류없음)');

  return {
    blocked: true,
    code: 'PARTIAL_CATEGORY_FIX_BLOCKED',
    unfixedCount: unfixed.length,
    requestedCount: matching.length,
    remainingCategories: remaining,
    error:
      `[확정 불가] 이 차수에 미확정 카테고리가 ${unfixed.length}개 있습니다. ` +
      `일부만 확정하면 exe 재고가 어긋날 수 있어, 미확정 카테고리를 한 번에 확정해야 합니다.\n\n` +
      `아직 확정되지 않은 카테고리: ${remaining.join(', ')}\n\n` +
      `→ 확정현황에서 카테고리 선택을 해제(전체)하거나, 위 카테고리를 모두 포함해 확정하세요.`,
  };
}

export function labelsFromCategoryTargets(targets) {
  return (targets || []).map((t) => t.label || t.countryFlower || '(분류없음)');
}

export function formatFixApiErrorMessage(data, week) {
  if (data?.code === 'PARTIAL_CATEGORY_FIX_BLOCKED') {
    const rest = (data.remainingCategories || []).join(', ');
    return `${week}: 미확정 카테고리를 일부만 확정할 수 없습니다.${rest ? ` 남은 카테고리: ${rest}` : ''}`;
  }
  if (data?.code === 'LOWER_UNFIXED_EXISTS') {
    const lower = (data.lowerWeeks || []).map((w) => `${w.OrderYear}-${w.OrderWeek}`).join(', ');
    return `${week}: 이전 차수 미확정(전 카테고리) — 먼저 ${lower} 확정`;
  }
  return data?.error || data?.message || `${week} 실패`;
}
