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

/**
 * 엑셀 분배 검증 결과에서 사용자가 즉시 확인해야 할 확정 차단 알림을 만든다.
 * preview와 실제 apply가 공유하는 evaluateImportRowFixBlock 결과만 사용해
 * 화면이 별도의 확정 기준을 추정하지 않게 한다.
 */
export function buildImportFixBlockedAlert({ orderYear, week, fixBlockedRows } = {}) {
  const rows = Array.isArray(fixBlockedRows) ? fixBlockedRows.filter(Boolean) : [];
  if (!rows.length) return '';

  const scope = [String(orderYear || '').trim(), String(week || '').trim()].filter(Boolean).join('-');
  const samples = rows.slice(0, 5).map((row) => {
    const target = [row.custName, row.prodName].filter(Boolean).join(' / ') || '확정 출고행';
    return `· ${target}: ${row.reason || '확정되어 수정할 수 없습니다.'}`;
  });
  if (rows.length > samples.length) samples.push(`· ... 외 ${rows.length - samples.length}건`);

  return [
    `🔒 ${scope || '선택 차수'}에 확정된 출고가 있어 ${rows.length}건은 작업할 수 없습니다.`,
    '확정차단 행은 이번 적용 대상에서 제외됩니다.',
    ...samples,
    '',
    '견적서관리의 확정 현황에서 해당 품종/출고를 확정취소한 뒤 다시 검증하세요.',
  ].join('\n');
}
