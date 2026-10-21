// 거래처별 이익 순수 함수(DB 없음). 차수 보고서의 카테고리 행(C 매출·J 이익)을 거래처 출고 매출 비중으로 배분하고
// 합계 보존(Σ거래처 == 보고서 총이익)을 보장한다. 금액은 센트(0.01원) 정수로 최대잉여법 배분.
import { orderWeekToDateRange } from '../orderWeekDate.js';

export const UNALLOCATED_KEY = 0; // 출고 거래처 근거가 없는 카테고리 금액(차수 공통)
export const TOLERANCE_KRW = 0.5;

const toCents = (v) => Math.round(Number(v || 0) * 100);
const fromCents = (c) => c / 100;

/** 정수 센트 total 을 weights 비율로 배분(최대잉여법). Σ결과 == total. weights 합이 0이면 null. */
export function allocateCents(totalCents, weights) {
  const ws = weights.map((w) => Math.max(Number(w) || 0, 0));
  const sum = ws.reduce((s, w) => s + w, 0);
  if (!(sum > 0)) return null;
  const sign = totalCents < 0 ? -1 : 1;
  const abs = Math.abs(totalCents);
  const raw = ws.map((w) => (abs * w) / sum);
  const out = raw.map((r) => Math.floor(r));
  let rest = abs - out.reduce((s, v) => s + v, 0);
  const order = raw.map((r, i) => ({ i, f: r - Math.floor(r) })).sort((a, b) => (b.f - a.f) || (a.i - b.i));
  for (let k = 0; rest > 0; k = (k + 1) % order.length, rest -= 1) out[order[k].i] += 1;
  return out.map((v) => sign * v);
}

/**
 * 한 차수 배분.
 * @param categoryRows [{category, C, J}] 보고서 카테고리 계산값(총계 제외 카테고리는 호출자가 제거)
 * @param custSales [{custKey, category, amount}] 확정 출고 거래처×카테고리 저장 Amount
 * @returns Map<custKey, {salesCents, profitCents}>, 근거 없는 카테고리는 UNALLOCATED_KEY
 */
export function allocateWeek(categoryRows, custSales) {
  const byCat = new Map();
  for (const s of custSales || []) {
    if (!byCat.has(s.category)) byCat.set(s.category, new Map());
    const m = byCat.get(s.category);
    m.set(s.custKey, (m.get(s.custKey) || 0) + (Number(s.amount) || 0));
  }
  const out = new Map();
  const add = (k, sales, profit) => {
    const cur = out.get(k) || { salesCents: 0, profitCents: 0 };
    cur.salesCents += sales;
    cur.profitCents += profit;
    out.set(k, cur);
  };
  for (const r of categoryRows || []) {
    const cs = toCents(r.C);
    const js = toCents(r.J);
    if (cs === 0 && js === 0) continue;
    const m = byCat.get(r.category);
    const keys = m ? [...m.keys()] : [];
    const weights = keys.map((k) => m.get(k));
    const aSales = keys.length ? allocateCents(cs, weights) : null;
    const aProfit = keys.length ? allocateCents(js, weights) : null;
    if (!aSales || !aProfit) { add(UNALLOCATED_KEY, cs, js); continue; }
    keys.forEach((k, i) => add(k, aSales[i], aProfit[i]));
  }
  return out;
}

export function mergeAllocations(list) {
  const out = new Map();
  for (const m of list) {
    for (const [k, v] of m) {
      const cur = out.get(k) || { salesCents: 0, profitCents: 0 };
      cur.salesCents += v.salesCents;
      cur.profitCents += v.profitCents;
      out.set(k, cur);
    }
  }
  return out;
}

/** 차수 기준 수요일이 속한 월 'YYYY-MM'. orderWeekToDateRange 의 start 는 해당 차수 시작 수요일. */
export function monthOfWeek(orderYear, major) {
  const r = orderWeekToDateRange(orderYear, major, 1);
  if (!r) return null;
  return `${r.start.getUTCFullYear()}-${String(r.start.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** 월에 속한 차수 [{orderYear, major}] — 연말/연초 경계는 인접 OrderYear 까지 확인(OrderYear 를 명시 보존). */
export function weeksOfMonth(month) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(month || ''));
  if (!m) return [];
  const y = Number(m[1]);
  const out = [];
  for (const oy of [y - 1, y, y + 1]) {
    for (let w = 1; w <= 53; w += 1) {
      if (monthOfWeek(oy, w) === month) out.push({ orderYear: String(oy), major: String(w).padStart(2, '0') });
    }
  }
  return out;
}

/** 달성률 % (목표 없거나 0이면 null) */
export function achievementPct(actual, target) {
  const t = Number(target);
  if (!Number.isFinite(t) || t <= 0) return null;
  return Math.round((Number(actual || 0) / t) * 1000) / 10;
}

export function marginPct(profit, sales) {
  const s = Number(sales);
  if (!s) return null;
  return Math.round((Number(profit || 0) / s) * 1000) / 10;
}

/** 거래처별 행 + 합계 + 골든 대조. reportTotal 은 보고서 총이익(스냅샷). */
export function buildRows(allocation, nameOf, targetOf, reportTotal) {
  const rows = [];
  let salesCents = 0;
  let profitCents = 0;
  for (const [custKey, v] of allocation) {
    salesCents += v.salesCents;
    profitCents += v.profitCents;
    const sales = fromCents(v.salesCents);
    const profit = fromCents(v.profitCents);
    const t = targetOf.get(custKey) || {};
    rows.push({
      custKey,
      name: custKey === UNALLOCATED_KEY ? '(거래처 미배분·차수 공통)' : (nameOf.get(custKey) || `거래처 ${custKey}`),
      salesKRW: sales,
      costKRW: Math.round((sales - profit) * 100) / 100,
      profitKRW: profit,
      marginPct: marginPct(profit, sales),
      targetSalesKRW: t.targetSalesKRW ?? null,
      targetProfitKRW: t.targetProfitKRW ?? null,
      salesAchievePct: achievementPct(sales, t.targetSalesKRW),
      profitAchievePct: achievementPct(profit, t.targetProfitKRW),
    });
  }
  rows.sort((a, b) => b.profitKRW - a.profitKRW);
  const sumByCustomer = fromCents(profitCents);
  const rt = Math.round(Number(reportTotal || 0) * 100) / 100;
  const diff = Math.round((rt - sumByCustomer) * 100) / 100;
  return {
    rows,
    totals: { salesKRW: fromCents(salesCents), profitKRW: sumByCustomer },
    golden: { reportTotal: rt, sumByCustomer, diff, ok: Math.abs(diff) <= TOLERANCE_KRW },
  };
}

/** 목표 입력 검증. 빈 값은 null(해당 목표 없음). */
export function validateTargetInput(body) {
  const custKey = Number.parseInt(body?.custKey, 10);
  if (!Number.isInteger(custKey) || custKey <= 0) return { error: 'custKey 오류' };
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(body?.targetMonth || ''))) return { error: 'targetMonth 형식 YYYY-MM' };
  const num = (v) => {
    if (v === '' || v == null) return null;
    const n = Number(String(v).replace(/,/g, ''));
    return Number.isFinite(n) ? Math.round(n) : NaN;
  };
  const targetSalesKRW = num(body.targetSalesKRW);
  const targetProfitKRW = num(body.targetProfitKRW);
  if (Number.isNaN(targetSalesKRW) || Number.isNaN(targetProfitKRW)) return { error: '목표 금액은 숫자' };
  if (targetSalesKRW == null && targetProfitKRW == null) return { error: '목표 매출 또는 이익 중 하나는 필요' };
  if ((targetSalesKRW != null && targetSalesKRW < 0) || (targetProfitKRW != null && targetProfitKRW < 0)) return { error: '목표는 0 이상' };
  return { custKey, targetMonth: String(body.targetMonth), targetSalesKRW, targetProfitKRW };
}

/** 최신 행이 현재 목표: TargetKey 가 큰 행 우선. */
export function latestTargets(rows) {
  const m = new Map();
  for (const r of rows || []) {
    const cur = m.get(Number(r.CustKey));
    if (!cur || Number(r.TargetKey) > cur.targetKey) {
      m.set(Number(r.CustKey), {
        targetKey: Number(r.TargetKey),
        targetSalesKRW: r.TargetSalesKRW == null ? null : Number(r.TargetSalesKRW),
        targetProfitKRW: r.TargetProfitKRW == null ? null : Number(r.TargetProfitKRW),
      });
    }
  }
  return m;
}
