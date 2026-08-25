// 손익 행의 전산 품목 매칭 표시. 저장본은 ProdKey만 있고 품목명은 Product JOIN으로 채운다.

export function raumPnlMatchDisplay(item) {
  if (!item || item.isCustom) return { matched: false, kind: 'custom', label: '', hint: '수동 행' };
  if (item.consigned) return { matched: false, kind: 'consigned', label: '사입', hint: '사입은 전산 분배 매칭 대상이 아닙니다' };
  const name = String(item.prodName || '').trim();
  if (name) {
    const type = String(item.matchType || '').trim();
    return {
      matched: true,
      kind: 'named',
      label: name,
      hint: type ? `전산 매칭: ${name} (${type})` : `전산 매칭: ${name}`,
    };
  }
  if (item.prodKey != null && Number.isFinite(Number(item.prodKey))) {
    return { matched: true, kind: 'key', label: `전산키 ${Number(item.prodKey)}`, hint: '전산 품목은 연결됐으나 이름이 없습니다' };
  }
  return { matched: false, kind: 'none', label: '미매칭', hint: '전산 품목과 매칭되지 않아 도착원가 자동입력을 확인할 수 없습니다' };
}

export function raumPnlMatchCounts(items) {
  const rows = (items || []).filter(it => it && !it.isCustom && !it.consigned);
  let matched = 0;
  let missing = 0;
  for (const it of rows) {
    if (raumPnlMatchDisplay(it).matched) matched += 1;
    else missing += 1;
  }
  return { matched, missing, total: rows.length };
}
