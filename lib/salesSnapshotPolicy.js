// 판매등록 히스토리 — 클라이언트/테스트용 순수 정책.
// DB import 금지 (페이지 번들에 mssql이 섞이지 않게).

/** 판매등록확정 — 재확정 가능. SnapshotType NVARCHAR(12) 한도. */
export const SALES_CONFIRM_TYPE = 'REG_CONFIRM';

export function salesCaptureYearPredicateSql() {
  return `(sm.OrderYear = @yr OR (ISNULL(sm.OrderYear,'') = '' AND LEFT(ISNULL(sm.OrderYearWeek,''), 4) = @yr))`;
}

export function pickLatestSalesConfirm(snapshots = [], week = '') {
  const wantWeek = String(week || '').trim();
  return (snapshots || [])
    .filter((s) => s?.SnapshotType === SALES_CONFIRM_TYPE && (!wantWeek || s.OrderWeek === wantWeek))
    .sort((a, b) => Number(b.SnapshotKey) - Number(a.SnapshotKey))[0] || null;
}

export function latestSalesConfirmByWeek(snapshots = []) {
  const map = new Map();
  for (const s of snapshots || []) {
    if (s?.SnapshotType !== SALES_CONFIRM_TYPE) continue;
    const prev = map.get(s.OrderWeek);
    if (!prev || Number(s.SnapshotKey) > Number(prev.SnapshotKey)) map.set(s.OrderWeek, s);
  }
  return [...map.values()].sort((a, b) => String(a.OrderWeek).localeCompare(String(b.OrderWeek)));
}

/** 기준 우선순위: [적용 확인] 행 → 최신 판매등록확정 → 화요일 최종분배 */
export function resolveSalesHistoryBaseline({ snapshots = [], week, confirmed } = {}) {
  const snaps = snapshots || [];
  if (confirmed?.snapshotKey) {
    const snap = snaps.find((s) => Number(s.SnapshotKey) === Number(confirmed.snapshotKey));
    if (snap) {
      return {
        snapshotKey: snap.SnapshotKey,
        takenAt: snap.takenAt,
        type: snap.SnapshotType,
        confirmedBy: confirmed.confirmedBy || '',
        confirmedDtm: confirmed.confirmedDtm || '',
        source: 'confirmed',
      };
    }
  }
  const salesConfirm = pickLatestSalesConfirm(snaps, week);
  if (salesConfirm) {
    return {
      snapshotKey: salesConfirm.SnapshotKey,
      takenAt: salesConfirm.takenAt,
      type: SALES_CONFIRM_TYPE,
      source: 'sales-confirm',
    };
  }
  const tue = snaps.find((s) => s.SnapshotType === 'TUE_FINAL');
  if (tue) {
    return {
      snapshotKey: tue.SnapshotKey,
      takenAt: tue.takenAt,
      type: 'TUE_FINAL',
      source: 'default',
    };
  }
  return null;
}

export function diffRowSets(baseRows, currRows) {
  const key = (r) => `${r.RowType}|${r.RefKey}`;
  const baseMap = new Map((baseRows || []).map(r => [key(r), r]));
  const currMap = new Map((currRows || []).map(r => [key(r), r]));
  const FIELDS = ['OutQuantity', 'EstQuantity', 'Cost', 'Amount', 'Vat'];
  const changed = [];
  const added = [];
  const removed = [];
  for (const [k, cur] of currMap) {
    const base = baseMap.get(k);
    if (!base) { added.push(cur); continue; }
    const diffs = {};
    let has = false;
    for (const f of FIELDS) {
      const a = Number(base[f] || 0);
      const b = Number(cur[f] || 0);
      if (Math.abs(a - b) > 0.001) { diffs[f] = { before: a, after: b }; has = true; }
    }
    if (has) changed.push({ ...cur, diffs, base });
  }
  for (const [k, base] of baseMap) {
    if (!currMap.has(k)) removed.push(base);
  }
  const amtDelta = (currRows || []).reduce((s, r) => s + Number(r.Amount || 0) + Number(r.Vat || 0), 0)
    - (baseRows || []).reduce((s, r) => s + Number(r.Amount || 0) + Number(r.Vat || 0), 0);
  const byCust = buildCustGroups(baseRows, currRows);
  return { changed, added, removed, amtDelta, byCust, hasDiff: changed.length + added.length + removed.length > 0 };
}

export function buildCustGroups(baseRows, currRows) {
  const num = v => Number(v || 0);
  const rowKey = r => `${r.RowType}|${r.RefKey}`;
  const custKeyOf = r => (r.CustKey != null ? `K${r.CustKey}` : `N${r.CustName || ''}`);
  const unitPrice = r => { const q = num(r.EstQuantity); return q ? Math.round(num(r.Amount) / q) : num(r.Amount); };
  const side = r => r == null ? null : {
    prodName: r.ProdName || '', estType: r.EstimateType || '', unit: r.EstUnit || '',
    outQty: num(r.OutQuantity), estQty: num(r.EstQuantity), unitPrice: unitPrice(r),
    amount: num(r.Amount), vat: num(r.Vat), total: num(r.Amount) + num(r.Vat),
  };

  const map = new Map();
  const ensure = (r) => {
    const k = custKeyOf(r);
    if (!map.has(k)) map.set(k, { custKey: r.CustKey ?? null, custName: r.CustName || '(미지정)', baseTotal: 0, currTotal: 0, items: new Map() });
    return map.get(k);
  };
  for (const r of (baseRows || [])) { const g = ensure(r); g.baseTotal += num(r.Amount) + num(r.Vat); const it = g.items.get(rowKey(r)) || {}; it.base = r; g.items.set(rowKey(r), it); }
  for (const r of (currRows || [])) { const g = ensure(r); g.currTotal += num(r.Amount) + num(r.Vat); const it = g.items.get(rowKey(r)) || {}; it.curr = r; g.items.set(rowKey(r), it); }

  const groups = [];
  for (const g of map.values()) {
    const items = [];
    let changedCnt = 0, addedCnt = 0, removedCnt = 0;
    for (const { base, curr } of g.items.values()) {
      let kind = 'same';
      if (base && !curr) { kind = 'removed'; removedCnt += 1; }
      else if (!base && curr) { kind = 'added'; addedCnt += 1; }
      else {
        const changed = ['OutQuantity', 'EstQuantity', 'Amount', 'Vat', 'Cost'].some(f => Math.abs(num(base[f]) - num(curr[f])) > 0.001);
        if (changed) { kind = 'changed'; changedCnt += 1; }
      }
      items.push({ kind, prodName: (curr || base).ProdName || '', before: side(base), after: side(curr) });
    }
    if (changedCnt + addedCnt + removedCnt === 0) continue;
    const order = { changed: 0, added: 1, removed: 2, same: 3 };
    items.sort((a, b) => (order[a.kind] - order[b.kind]) || String(a.prodName).localeCompare(String(b.prodName), 'ko'));
    groups.push({
      custKey: g.custKey, custName: g.custName,
      baseTotal: Math.round(g.baseTotal), currTotal: Math.round(g.currTotal), delta: Math.round(g.currTotal - g.baseTotal),
      changedCnt, addedCnt, removedCnt, items,
    });
  }
  groups.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta) || (b.currTotal - a.currTotal));
  return groups;
}

