// 거래처별 이익·월 목표 데이터 접근. 읽기: 보고서 스냅샷(WebProfitReportSnapshot 최신 버전)·ShipmentDetail(isFix=1 저장 Amount).
// 쓰기: web_mgmt.CustomerTarget 추가 전용.
import { sql } from '../db.js';
import { mgmtQuery } from './safeQuery.js';
import { ensureMgmtSchema } from './schema.js';
import { qualified } from './schemaMeta.js';
import { listCustomersBasic } from './sources.js';
import { latestSnapshot } from '../profitReportSnapshot.js';
import { loadCustomerProductSales } from '../profitReportCustomerMixSql.js';
import { computeProfitRow, computeProfitTotals, TOTALS_EXCLUDED_CATEGORIES } from '../profitReportCalc.js';
import { allocateWeek, mergeAllocations, weeksOfMonth, buildRows, latestTargets } from './customerProfitCore.js';

const T = qualified('CustomerTarget');

export async function listTargets(month) {
  await ensureMgmtSchema();
  const r = await mgmtQuery(
    `SELECT TargetKey, CustKey, TargetSalesKRW, TargetProfitKRW FROM ${T} WHERE TargetMonth = @m`,
    { m: { type: sql.Char(7), value: month } },
  );
  return latestTargets(r?.recordset || []);
}

export async function appendTarget({ custKey, targetMonth, targetSalesKRW, targetProfitKRW, actorId }) {
  await ensureMgmtSchema();
  const r = await mgmtQuery(
    `INSERT INTO ${T} (CustKey, TargetMonth, TargetSalesKRW, TargetProfitKRW, CreatedBy)
     OUTPUT INSERTED.TargetKey VALUES (@c, @m, @s, @p, @by)`,
    {
      c: { type: sql.Int, value: custKey },
      m: { type: sql.Char(7), value: targetMonth },
      s: { type: sql.Decimal(18, 0), value: targetSalesKRW },
      p: { type: sql.Decimal(18, 0), value: targetProfitKRW },
      by: { type: sql.NVarChar(100), value: actorId || '' },
    },
  );
  return r?.recordset?.[0]?.TargetKey;
}

/** 월 단위 거래처별 이익. 스냅샷 없는 차수는 missingWeeks 로 보고하고 합계에서 제외(보고서 총이익도 같은 차수만 합산). */
export async function loadCustomerProfitMonth(month) {
  const weeks = weeksOfMonth(month);
  const allocs = [];
  const weekMeta = [];
  const missingWeeks = [];
  let reportTotal = 0;
  for (const w of weeks) {
    const snap = await latestSnapshot(w.orderYear, w.major);
    if (!snap?.payload?.rows?.length) { missingWeeks.push(`${w.orderYear}-${w.major}`); continue; }
    const calcRows = snap.payload.rows.map((row) => ({ ...row, calc: computeProfitRow(row) }));
    const weekTotal = Number(computeProfitTotals(calcRows).J || 0);
    const catRows = calcRows
      .filter((r) => !TOTALS_EXCLUDED_CATEGORIES.includes(r.category))
      .map((r) => ({ category: r.category, C: r.calc.C, J: r.calc.J }));
    const sales = await loadCustomerProductSales(w.orderYear, w.major, { withCategory: true });
    allocs.push(allocateWeek(catRows, sales.map((s) => ({ custKey: s.custKey ?? 0, category: s.category, amount: s.amount }))));
    reportTotal += weekTotal;
    weekMeta.push({ ...w, snapshotVersion: snap.versionNo, reportProfit: weekTotal });
  }
  const customers = await listCustomersBasic();
  const nameOf = new Map(customers.map((c) => [c.custKey, c.signboard]));
  const targetOf = await listTargets(month);
  const built = buildRows(mergeAllocations(allocs), nameOf, targetOf, reportTotal);
  return {
    month,
    ...built,
    meta: {
      source: 'snapshot-category-allocation',
      sourceNote: '보고서 스냅샷은 카테고리 단위(거래처 축 없음). 카테고리별 매출(C)·이익(J)을 확정 출고(isFix=1) 저장 Amount 의 거래처 비중으로 배분. 단품 단위원가는 스냅샷에 없음.',
      weeks: weekMeta,
      missingWeeks,
    },
  };
}
