// 출고 확정 범위 — 순수 판정 (DB 없음, node 단독 테스트 가능)

export function categoryScopeKey(countryFlower) {
  return String(countryFlower || '').trim();
}

/**
 * 엑셀 import 행 1건 — 차수+품종 확정 차단 여부
 */
export function evaluateImportRowFixBlock({
  orderWeek,
  countryFlower,
  prodName,
  custKey,
  prodKey,
  categoryFixStates,
  lineFixStates,
}) {
  const cf = categoryScopeKey(countryFlower);
  const scopeLabel = cf || prodName || `ProdKey ${prodKey}`;
  const cat = categoryFixStates?.get(cf) || { status: 'UNFIXED', fixedLines: 0, unfixedLines: 0 };
  const line = lineFixStates?.get(`${custKey}|${prodKey}`) || { lineFixed: false, masterFixed: false };

  if (cat.status === 'FULLY_FIXED') {
    return {
      fixBlocked: true,
      fixBlockReason: `${orderWeek}차 ${scopeLabel} 품종은 확정되어 수정할 수 없습니다. 해당 품종 확정취소 후 다시 진행하세요.`,
      categoryStatus: cat.status,
      lineFixed: line.lineFixed,
    };
  }

  if (line.lineFixed || (line.masterFixed && cat.status !== 'UNFIXED')) {
    return {
      fixBlocked: true,
      fixBlockReason: `${orderWeek}차 ${scopeLabel} — 이미 확정된 출고라인입니다 (거래처/품목). 확정취소 후 다시 진행하세요.`,
      categoryStatus: cat.status,
      lineFixed: true,
    };
  }

  return {
    fixBlocked: false,
    fixBlockReason: null,
    categoryStatus: cat.status,
    lineFixed: false,
  };
}
