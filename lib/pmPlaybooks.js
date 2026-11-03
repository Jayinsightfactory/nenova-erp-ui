// lib/pmPlaybooks.js — /pm "재발 학습 카드" 패널 순수함수(정렬·요약·KST 표기).
// 데이터: pm-office 피드의 playbooks = { total, learned, hits, resolved:{auto,investigated,escalated}, cards:[...] }
// playbooks 가 없거나 형식이 틀리면 null → 패널 숨김(구버전 피드 호환).

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const ts = (iso) => { const t = Date.parse(iso || ''); return Number.isFinite(t) ? t : 0; };

export function normalizePlaybooks(pb) {
  if (!pb || typeof pb !== 'object' || !Array.isArray(pb.cards)) return null;
  return pb;
}

// 상단 요약 줄 숫자. 피드 값 우선, 없으면 카드에서 계산.
export function playbookSummary(pb) {
  const p = normalizePlaybooks(pb);
  if (!p) return null;
  const cards = p.cards.filter((c) => c && typeof c === 'object');
  const r = p.resolved || {};
  return {
    total: p.total != null ? num(p.total) : cards.length,
    learned: p.learned != null ? num(p.learned) : cards.filter((c) => c.learnedAt).length,
    hits: p.hits != null ? num(p.hits) : cards.reduce((s, c) => s + num(c.hits), 0),
    auto: num(r.auto), investigated: num(r.investigated), escalated: num(r.escalated),
  };
}

// 적중 많은 순 → 학습 최신순 → 마지막 적중 최신순 → id.
export function sortPlaybookCards(cards) {
  return (Array.isArray(cards) ? cards : []).filter((c) => c && typeof c === 'object').slice().sort((a, b) =>
    (num(b.hits) - num(a.hits)) || (ts(b.learnedAt) - ts(a.learnedAt)) || (ts(b.lastHit) - ts(a.lastHit))
    || String(a.id || '').localeCompare(String(b.id || '')));
}

// ISO → 'MM-DD HH:mm' (KST). 잘못된 값은 ''.
export function kstDateTime(iso) {
  const t = ts(iso);
  if (!t) return '';
  const d = new Date(t + 9 * 3600 * 1000);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}
