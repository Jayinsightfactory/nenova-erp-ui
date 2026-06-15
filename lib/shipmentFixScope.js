// 출고 확정 범위 — 차수(OrderYear+OrderWeek) + 품종(CountryFlower) 기준 (nenova.exe 동일)
import { query, sql } from './db';
import { evaluateImportRowFixBlock } from './shipmentFixScopeCore';

export { evaluateImportRowFixBlock, categoryScopeKey } from './shipmentFixScopeCore';

function weekKeySql(alias, defaultYearParam = '@yr') {
  return `ISNULL(CAST(${alias}.OrderYear AS NVARCHAR(4)), ${defaultYearParam}) + REPLACE(${alias}.OrderWeek, '-', '')`;
}

export async function getProductFixScope(q, prodKey) {
  const prod = await q(
    `SELECT TOP 1 ProdKey, ProdName, CountryFlower, CounName, FlowerName
       FROM Product
      WHERE ProdKey=@pk AND ISNULL(isDeleted,0)=0`,
    { pk: { type: sql.Int, value: Number(prodKey) } },
  );
  return prod.recordset[0] || null;
}

/**
 * @returns {Promise<Map<string, { countryFlower: string, fixedLines: number, unfixedLines: number, status: 'FULLY_FIXED'|'PARTIAL'|'UNFIXED' }>>}
 */
export async function loadCategoryFixStates(q, orderYear, orderWeek) {
  const yr = String(orderYear || new Date().getFullYear());
  const wk = String(orderWeek || '');
  const weekKey = yr + wk.replace('-', '');
  const r = await q(
    `SELECT ISNULL(NULLIF(LTRIM(RTRIM(p.CountryFlower)), N''), N'') AS CountryFlower,
            SUM(CASE WHEN ISNULL(sd.isFix,0)=1 THEN 1 ELSE 0 END) AS fixedLines,
            SUM(CASE WHEN ISNULL(sd.isFix,0)=0 AND ISNULL(sd.OutQuantity,0)>0 THEN 1 ELSE 0 END) AS unfixedLines
       FROM ShipmentMaster sm
       JOIN ShipmentDetail sd ON sd.ShipmentKey=sm.ShipmentKey
       JOIN Product p ON p.ProdKey=sd.ProdKey AND p.isDeleted=0
      WHERE sm.isDeleted=0
        AND ${weekKeySql('sm')} = @weekKey
      GROUP BY ISNULL(NULLIF(LTRIM(RTRIM(p.CountryFlower)), N''), N'')`,
    {
      yr: { type: sql.NVarChar, value: yr },
      weekKey: { type: sql.NVarChar, value: weekKey },
    },
  );

  const map = new Map();
  for (const row of r.recordset || []) {
    const cf = String(row.CountryFlower || '');
    const fixedLines = Number(row.fixedLines || 0);
    const unfixedLines = Number(row.unfixedLines || 0);
    let status = 'UNFIXED';
    if (fixedLines > 0 && unfixedLines === 0) status = 'FULLY_FIXED';
    else if (fixedLines > 0 && unfixedLines > 0) status = 'PARTIAL';
    map.set(cf, { countryFlower: cf, fixedLines, unfixedLines, status });
  }
  return map;
}

/** @returns {Promise<Map<string, { lineFixed: boolean, masterFixed: boolean }>>} */
export async function loadLineFixStates(q, orderYear, orderWeek) {
  const yr = String(orderYear || new Date().getFullYear());
  const wk = String(orderWeek || '');
  const weekKey = yr + wk.replace('-', '');
  const r = await q(
    `SELECT sm.CustKey, sd.ProdKey,
            MAX(CASE WHEN ISNULL(sd.isFix,0)=1 AND ISNULL(sd.OutQuantity,0)>0 THEN 1 ELSE 0 END) AS lineFixed,
            MAX(CASE WHEN ISNULL(sm.isFix,0)=1 THEN 1 ELSE 0 END) AS masterFixed
       FROM ShipmentMaster sm
       JOIN ShipmentDetail sd ON sd.ShipmentKey=sm.ShipmentKey
      WHERE sm.isDeleted=0
        AND ${weekKeySql('sm')} = @weekKey
      GROUP BY sm.CustKey, sd.ProdKey`,
    {
      yr: { type: sql.NVarChar, value: yr },
      weekKey: { type: sql.NVarChar, value: weekKey },
    },
  );
  const map = new Map();
  for (const row of r.recordset || []) {
    map.set(`${row.CustKey}|${row.ProdKey}`, {
      lineFixed: Number(row.lineFixed || 0) === 1,
      masterFixed: Number(row.masterFixed || 0) === 1,
    });
  }
  return map;
}

export async function assertImportRowNotFixed(q, { orderYear, orderWeek, custKey, prodKey }) {
  const prod = await getProductFixScope(q, prodKey);
  if (!prod) return { fixBlocked: false, fixBlockReason: null };

  const [categoryFixStates, lineFixStates] = await Promise.all([
    loadCategoryFixStates(q, orderYear, orderWeek),
    loadLineFixStates(q, orderYear, orderWeek),
  ]);

  return evaluateImportRowFixBlock({
    orderWeek,
    countryFlower: prod.CountryFlower,
    prodName: prod.ProdName,
    custKey,
    prodKey,
    categoryFixStates,
    lineFixStates,
  });
}
