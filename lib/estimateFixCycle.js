// 견적서 저장 시 확정 해제 사이클 대상 차수 산출

export function parseSubWeeksFix(subWeeksFix) {
  return String(subWeeksFix || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((entry) => {
      const [week, fix] = entry.split(':');
      return { week, fixed: Number(fix || 0) === 1 };
    })
    .filter((x) => x.week && x.fixed)
    .map((x) => x.week);
}

export function sortWeeksAsc(weeks) {
  return [...new Set((weeks || []).filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b)));
}

/**
 * 수정 저장 전 확정해제/재확정할 세부차수 목록.
 * - 수정한 모든 OrderWeek 포함 (SubWeeksFix 메타 누락 대비)
 * - exe 정책: 최초 수정 차수 이후 확정된 세부차수도 포함
 */
export function getFixCycleWeeksForEditedItems(editedItems, ship) {
  const editedWeeks = sortWeeksAsc((editedItems || []).map((it) => it.OrderWeek));
  if (editedWeeks.length === 0) return [];

  const firstEditedWeek = editedWeeks[0];
  const fixedWeeks = parseSubWeeksFix(ship?.SubWeeksFix);
  const fallbackWeeks = String(ship?.SubWeeks || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const knownFixed = fixedWeeks.length > 0 ? fixedWeeks : fallbackWeeks;
  const trailingFixed = knownFixed.filter(
    (wk) => String(wk).localeCompare(String(firstEditedWeek)) >= 0,
  );

  return sortWeeksAsc([...new Set([...editedWeeks, ...trailingFixed])]);
}
