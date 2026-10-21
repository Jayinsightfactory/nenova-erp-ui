// 단가 스냅샷 diff 순수 함수(DB 의존 없음).
// 행: { custKey: number|null, prodKey: number, priceKind: string, value: number|null }
const round4 = (v) => (v == null || Number.isNaN(Number(v)) ? null : Math.round(Number(v) * 10000) / 10000);

export function priceKey(r) {
  return `${r.priceKind}|${r.custKey == null ? '' : Number(r.custKey)}|${Number(r.prodKey)}`;
}

// 반환: [{ type:'new'|'changed'|'deleted', custKey, prodKey, priceKind, before, after }]. 동일값은 포함하지 않는다.
export function diffPriceSnapshots(prevRows, nextRows) {
  const prev = new Map();
  for (const r of prevRows || []) prev.set(priceKey(r), r);
  const out = [];
  const seen = new Set();
  for (const r of nextRows || []) {
    const k = priceKey(r);
    if (seen.has(k)) continue;
    seen.add(k);
    const p = prev.get(k);
    const after = round4(r.value);
    if (!p) {
      out.push({ type: 'new', custKey: r.custKey ?? null, prodKey: Number(r.prodKey), priceKind: r.priceKind, before: null, after });
    } else if (round4(p.value) !== after) {
      out.push({ type: 'changed', custKey: r.custKey ?? null, prodKey: Number(r.prodKey), priceKind: r.priceKind, before: round4(p.value), after });
    }
  }
  for (const [k, p] of prev) {
    if (!seen.has(k)) out.push({ type: 'deleted', custKey: p.custKey ?? null, prodKey: Number(p.prodKey), priceKind: p.priceKind, before: round4(p.value), after: null });
  }
  return out;
}
