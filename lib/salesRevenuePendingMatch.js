// lib/salesRevenuePendingMatch.js
// 업로드 미리보기(pending) 단계 — 이카운트 거래처 ↔ 매출비교표 기준 업체 매칭 (클라이언트·서버 공용)

import { BUILT_IN_ALIASES, baseCustomersForChannel } from './salesRevenueConfig';
import { normalizeCustomerToken } from './normalizeCustomerToken';

export function normalizeRevenueToken(name) {
  return normalizeCustomerToken(name);
}

function builtInCanonical(ecountName) {
  const token = normalizeRevenueToken(ecountName);
  for (const [alias, canonical] of Object.entries(BUILT_IN_ALIASES)) {
    if (normalizeRevenueToken(alias) === token) return canonical;
  }
  return BUILT_IN_ALIASES[ecountName] || null;
}

function savedCanonical(ecountName, mappings) {
  const token = normalizeRevenueToken(ecountName);
  const saved = mappings?.[token];
  if (saved?.canonicalName) return { canonicalName: saved.canonicalName, status: '확정', source: 'saved' };
  return null;
}

/** pending.rows 에서 거래처명 단위 매칭 항목 생성 */
export function buildUploadMatchItems(rows, mappings, channel, sessionConfirmed = {}) {
  const baseSet = new Set(baseCustomersForChannel(channel));
  const map = new Map();

  for (const r of rows || []) {
    const name = r.ecountCustName || '';
    if (!name) continue;
    if (!map.has(name)) {
      const saved = savedCanonical(name, mappings);
      const builtIn = builtInCanonical(name);
      const session = sessionConfirmed[name];
      let status = '미매칭';
      let canonicalName = name;
      let resolved = false;

      if (session) {
        canonicalName = session.canonicalName || name;
        status = session.status === 'new' ? '신규' : '확정';
        resolved = true;
      } else if (saved) {
        canonicalName = saved.canonicalName;
        status = '확정';
        resolved = true;
      } else if (builtIn) {
        canonicalName = builtIn;
        status = '후보';
      }

      map.set(name, {
        ecountName: name,
        canonicalName,
        status,
        resolved,
        isBase: baseSet.has(canonicalName),
        amount: 0,
        rowCount: 0,
        products: new Set(),
        suggestedBase: builtIn && baseSet.has(builtIn) ? builtIn : null,
      });
    }
    const item = map.get(name);
    item.amount += Number(r.totalAmount || 0);
    item.rowCount += 1;
    if (r.productName) item.products.add(r.productName);
  }

  return Array.from(map.values())
    .map(x => ({ ...x, products: Array.from(x.products) }))
    .sort((a, b) => {
      if (a.resolved !== b.resolved) return a.resolved ? 1 : -1;
      if (a.status !== b.status) {
        const order = { 미매칭: 0, 후보: 1, 신규: 2, 확정: 3 };
        return (order[a.status] ?? 9) - (order[b.status] ?? 9);
      }
      return b.amount - a.amount;
    });
}

export function allUploadMatchesResolved(items) {
  return (items || []).length > 0 && items.every(it => it.resolved);
}

export function uploadMatchProgress(items) {
  const total = (items || []).length;
  const resolved = (items || []).filter(it => it.resolved).length;
  return { total, resolved, pending: total - resolved };
}
