// 카탈로그 — 최신 차수 조회 + 품목별 최근 도착원가(fallback)

import { query, sql } from './db';
import { buildOrderYearWeek, shiftOrderWeek, normalizeOrderWeek } from './orderUtils';
import { getArrivalCostsForWeekRange } from './pivotFreightArrival';

const DEFAULT_LOOKBACK = 52;

/** 입고 데이터 기준 최신 차수 */
export async function getLatestWarehouseWeek(orderYear) {
  const year = String(orderYear || new Date().getFullYear());
  let r = await query(
    `SELECT TOP 1 OrderYear, OrderWeek
     FROM WarehouseMaster
     WHERE isDeleted = 0
       AND OrderWeek IS NOT NULL AND OrderWeek <> ''
       AND OrderYear = @y
     ORDER BY OrderYear + REPLACE(OrderWeek, '-', '') DESC`,
    { y: { type: sql.NVarChar, value: year } },
  );
  if (r.recordset[0]) {
    return {
      orderYear: String(r.recordset[0].OrderYear),
      weekStart: normalizeOrderWeek(r.recordset[0].OrderWeek),
    };
  }
  r = await query(
    `SELECT TOP 1 OrderYear, OrderWeek
     FROM WarehouseMaster
     WHERE isDeleted = 0 AND OrderWeek IS NOT NULL AND OrderWeek <> ''
     ORDER BY OrderYear + REPLACE(OrderWeek, '-', '') DESC`,
  );
  if (!r.recordset[0]) return null;
  return {
    orderYear: String(r.recordset[0].OrderYear),
    weekStart: normalizeOrderWeek(r.recordset[0].OrderWeek),
  };
}

/** anchor 이하 입고가 있는 차수 목록 (최신순) */
export async function listWarehouseWeeksBackward(orderYear, anchorWeek, limit = DEFAULT_LOOKBACK) {
  const year = String(orderYear);
  const anchor = normalizeOrderWeek(anchorWeek);
  if (!anchor) return [];

  const ywa = buildOrderYearWeek(year, anchor);
  const r = await query(
    `SELECT DISTINCT OrderYear, OrderWeek
     FROM WarehouseMaster
     WHERE isDeleted = 0
       AND OrderWeek IS NOT NULL AND OrderWeek <> ''
       AND OrderYear = @y
       AND (OrderYear + REPLACE(OrderWeek, '-', '')) <= @ywa
     ORDER BY OrderYear + REPLACE(OrderWeek, '-', '') DESC`,
    {
      y: { type: sql.NVarChar, value: year },
      ywa: { type: sql.NVarChar, value: ywa },
    },
  );

  const fromDb = r.recordset.map(row => normalizeOrderWeek(row.OrderWeek)).filter(Boolean);
  if (fromDb.length > 0) return fromDb.slice(0, limit);

  const out = [];
  let cur = anchor;
  for (let i = 0; i < limit; i += 1) {
    out.push(cur);
    const prev = shiftOrderWeek(cur, -1);
    if (prev === cur) break;
    cur = prev;
  }
  return out;
}

/**
 * anchor 차수부터 과거로 내려가며 품목별 최근 도착원가를 채운다.
 * @returns {{ map: Record<number, object>, weeksScanned: number, fromFallback: number }}
 */
export async function getArrivalCostsWithFallback({
  orderYear,
  anchorWeek,
  maxWeeks = DEFAULT_LOOKBACK,
}) {
  const weeks = await listWarehouseWeeksBackward(orderYear, anchorWeek, maxWeeks);
  if (!weeks.length) {
    return { map: {}, weeksScanned: 0, fromFallback: 0, anchorWeek: anchorWeek || null };
  }

  const merged = {};
  const anchorNorm = normalizeOrderWeek(anchorWeek);
  let weeksScanned = 0;
  let staleRuns = 0;

  for (const week of weeks) {
    weeksScanned += 1;
    let added = 0;
    const chunk = await getArrivalCostsForWeekRange({
      weekStart: week,
      weekEnd: week,
      orderYear,
    });
    for (const [pk, arr] of Object.entries(chunk)) {
      const key = Number(pk);
      const cost = Number(arr.arrivalCost || 0);
      if (cost > 0 && !merged[key]) {
        merged[key] = {
          ...arr,
          arrivalWeek: week,
          isFallback: week !== anchorNorm,
        };
        added += 1;
      }
    }
    if (added === 0) {
      staleRuns += 1;
      if (staleRuns >= 8 && Object.keys(merged).length > 0) break;
    } else {
      staleRuns = 0;
    }
  }

  const fromFallback = Object.values(merged).filter(v => v.isFallback).length;
  return {
    map: merged,
    weeksScanned,
    fromFallback,
    anchorWeek: anchorNorm,
  };
}
