// lib/orderImportSheetView.js
// 업로드 주문등록 「원본 Excel 시트 + 행별 ERP 매칭」 표시용 순수 로직 (DB/브라우저 의존 없음)

const isBlank = (v) => v === null || v === undefined || String(v).trim() === '';

export function isEmptySheetRow(row) {
  return !(row?.cells || []).some(cell => !isBlank(cell));
}

// 연속 빈 행을 gap 한 덩어리로 접는다. keepRowNos(헤더·매칭된 행 등)는 비어 있어도 항상 행으로 유지.
// 반환: [{ type:'row', row } | { type:'gap', rowNos:[...] }]
export function collapseEmptySheetRows(rows, keepRowNos = []) {
  const keep = new Set((keepRowNos || []).map(Number));
  const out = [];
  let gap = null;
  for (const row of rows || []) {
    if (isEmptySheetRow(row) && !keep.has(Number(row.rowNo))) {
      if (!gap) { gap = { type: 'gap', rowNos: [] }; out.push(gap); }
      gap.rowNos.push(row.rowNo);
    } else {
      gap = null;
      out.push({ type: 'row', row });
    }
  }
  return out;
}

// 선택 세부차수들의 분배상세에서 품목의 현재 분배단가를 찾는다.
// 반환: { status:'none' } | { status:'ok'|'multi', cost, orderWeek, count }
export function lookupCurrentCost(subWeeks, selectedSubWeeks, prodKey) {
  const pk = Number(prodKey);
  if (!(pk > 0)) return { status: 'none' };
  const selected = new Set(selectedSubWeeks || []);
  const hits = [];
  for (const sw of subWeeks || []) {
    if (!selected.has(sw.orderWeek)) continue;
    for (const d of sw.details || []) {
      if (Number(d.prodKey) === pk) hits.push({ cost: Number(d.cost), orderWeek: sw.orderWeek });
    }
  }
  if (!hits.length) return { status: 'none' };
  return { status: hits.length > 1 ? 'multi' : 'ok', cost: hits[0].cost, orderWeek: hits[0].orderWeek, count: hits.length };
}

// 수정 단가가 현재 분배단가와 다른가 (둘 다 있을 때만, 0.5원 미만 차이는 같음)
export function isPriceChanged(current, unitPrice) {
  const p = Number(unitPrice);
  if (!current || current.status === 'none' || !(p > 0)) return false;
  return Math.abs(Number(current.cost) - p) >= 0.5;
}
