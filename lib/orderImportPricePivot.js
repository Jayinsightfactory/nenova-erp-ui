// lib/orderImportPricePivot.js
// 업로드 주문등록 「직접 수정」 탭 — 업체×품목 분배단가 피벗의 순수 로직 (DB/브라우저 의존 없음)

export const cellKey = (custKey, prodKey) => `${custKey}:${prodKey}`;

// 세부차수 앞뒤 N개 (같은 연도 안, 1~52 대차수 / 세부 -01 -02 유지)
export function nearbyWeeks(current, span = 5) {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(String(current || '').trim());
  if (!m) return [];
  const year = m[1];
  const sub = String(m[3]).padStart(2, '0');
  const major = Number(m[2]);
  const out = [];
  for (let w = major - span; w <= major + span; w += 1) {
    if (w < 1 || w > 53) continue;
    out.push(`${year}-${String(w).padStart(2, '0')}-${sub}`);
  }
  return out;
}

// '2026-44-01' → { orderYear:'2026', orderWeek:'44-01' }
export function splitFullWeek(full) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(full || '').trim());
  return m ? { orderYear: m[1], orderWeek: `${m[2]}-${m[3]}` } : null;
}

// 화면 표시용 셀 맵: 서버 cells → Map(cellKey → cell)
export function indexCells(cells) {
  const map = new Map();
  for (const c of cells || []) map.set(cellKey(c.custKey, c.prodKey), c);
  return map;
}

// 드래그 직사각형 → 존재하는(분배 있는) 셀 key 목록
export function rectSelection(customers, products, cellMap, a, b) {
  if (!a || !b) return [];
  const r0 = Math.min(a.row, b.row);
  const r1 = Math.max(a.row, b.row);
  const c0 = Math.min(a.col, b.col);
  const c1 = Math.max(a.col, b.col);
  const keys = [];
  for (let r = r0; r <= r1; r += 1) {
    for (let c = c0; c <= c1; c += 1) {
      const cu = customers[r];
      const pr = products[c];
      if (!cu || !pr) continue;
      const k = cellKey(cu.custKey, pr.prodKey);
      if (cellMap.has(k)) keys.push(k);
    }
  }
  return keys;
}

// 입력값 → 유효한 단가(0 이상 유한 숫자) 또는 null
export function parsePrice(v) {
  if (v === '' || v == null) return null;
  const n = Number(String(v).replace(/,/g, ''));
  return Number.isFinite(n) && n >= 0 ? n : null;
}

// edits: { [cellKey]: number } 중 실제로 조회값과 다른 것만
export function changedCells(cellMap, edits) {
  const out = [];
  for (const [k, v] of Object.entries(edits || {})) {
    const c = cellMap.get(k);
    const price = parsePrice(v);
    if (!c || price == null) continue;
    if (c.details.every(d => Math.abs(Number(d.cost) - price) < 0.005)) continue;
    out.push({ key: k, cell: c, newCost: price });
  }
  return out;
}

// 변경 셀 → 업체별 update-cost 요청 (셀 하나가 대표하는 모든 sdetailKey 포함)
export function buildCostRequests(changed, orderYear) {
  const byCust = new Map();
  for (const { cell, newCost } of changed) {
    if (!byCust.has(cell.custKey)) byCust.set(cell.custKey, []);
    for (const d of cell.details) {
      if (Math.abs(Number(d.cost) - newCost) < 0.005) continue;
      byCust.get(cell.custKey).push({
        shipmentKey: d.shipmentKey,
        sdetailKey: d.sdetailKey,
        cost: newCost,
        expectedOldCost: Number(d.cost),
      });
    }
  }
  return [...byCust.entries()]
    .filter(([, items]) => items.length)
    .map(([custKey, items]) => ({
      custKey,
      body: { items, mode: 'once', orderYear: String(orderYear), custKey, source: 'import-direct-pivot' },
    }));
}

// 확인창용 요약
export function summarizeChanges(changed, customers, products) {
  const custName = new Map(customers.map(c => [c.custKey, c.custName]));
  const prodName = new Map(products.map(p => [p.prodKey, p.displayName]));
  const custSet = new Set(changed.map(c => c.cell.custKey));
  const fixedCells = changed.filter(c => c.cell.isFix).length;
  const lines = changed.slice(0, 15).map(({ cell, newCost }) => {
    const old = cell.cost;
    return `${custName.get(cell.custKey) || cell.custKey} / ${prodName.get(cell.prodKey) || cell.prodKey}: ${old.toLocaleString()} → ${newCost.toLocaleString()}`;
  });
  if (changed.length > 15) lines.push(`… 외 ${changed.length - 15}셀`);
  return { custCount: custSet.size, cellCount: changed.length, fixedCells, lines };
}
