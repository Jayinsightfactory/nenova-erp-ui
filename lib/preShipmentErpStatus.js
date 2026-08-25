import { query, sql } from './db.js';
import { normalizePreShipmentScope } from './preShipmentWorkbook.js';

const p = (type, value) => ({ type, value });

/**
 * 주광 계획의 ERP 거래처를 명시적으로 해석한다. 부분 LIKE나 첫 행 fallback은 쓰지 않는다.
 * 현재 계획 기본명 `주광`은 실제 전산명 `주광농원`만 보조 exact 후보로 허용한다.
 */
export async function resolvePreShipmentCustomer(customerName = '주광') {
  const name = String(customerName || '').trim();
  if (!name) return null;
  const aliases = [...new Set([name, name === '주광' ? '주광농원' : null].filter(Boolean))];
  const params = {};
  const clauses = aliases.map((alias, index) => {
    params[`name${index}`] = p(sql.NVarChar, alias);
    return `c.CustName=@name${index}`;
  });
  const result = await query(
    `SELECT c.CustKey,c.CustName,c.OrderCode
       FROM Customer c
      WHERE ISNULL(c.isDeleted,0)=0 AND (${clauses.join(' OR ')})
      ORDER BY CASE WHEN c.CustName=@name0 THEN 0 ELSE 1 END,c.CustKey`,
    params,
  );
  const rows = result.recordset || [];
  if (rows.length !== 1) return null;
  return rows[0];
}

export function buildPreShipmentErpStatusSql(prodParamNames = []) {
  if (!prodParamNames.length) return '';
  const prodList = prodParamNames.map(name => `@${name}`).join(',');
  return `
WITH ScopedDetail AS (
  SELECT sm.OrderWeek,sm.ShipmentKey,ISNULL(sm.isFix,0) AS MasterFix,
         sd.SdetailKey,sd.ProdKey,ISNULL(sd.OutQuantity,0) AS OutQuantity,
         ISNULL(sd.isFix,0) AS DetailFix
    FROM ShipmentMaster sm
    JOIN ShipmentDetail sd ON sd.ShipmentKey=sm.ShipmentKey
   WHERE sm.OrderYear=@orderYear
     AND sm.OrderWeek LIKE @majorPrefix
     AND sm.CustKey=@custKey
     AND ISNULL(sm.isDeleted,0)=0
     AND sd.ProdKey IN (${prodList})
),
DetailSummary AS (
  SELECT ProdKey,
         SUM(OutQuantity) AS DistributedQuantity,
         SUM(CASE WHEN DetailFix=1 THEN OutQuantity ELSE 0 END) AS ConfirmedQuantity,
         SUM(CASE WHEN DetailFix=0 THEN OutQuantity ELSE 0 END) AS PendingQuantity,
         COUNT(DISTINCT ShipmentKey) AS ShipmentCount,
         MIN(CAST(MasterFix AS int)) AS AllMasterFixed,
         MIN(CAST(DetailFix AS int)) AS AllDetailFixed
    FROM ScopedDetail
   GROUP BY ProdKey
),
DateSummary AS (
  SELECT scoped.ProdKey,scoped.OrderWeek,CONVERT(date,sdd.ShipmentDtm) AS ShipmentDate,
         SUM(ISNULL(sdd.ShipmentQuantity,0)) AS ShipmentDateQuantity,
         SUM(CASE WHEN scoped.DetailFix=1 THEN ISNULL(sdd.ShipmentQuantity,0) ELSE 0 END) AS ConfirmedDateQuantity
    FROM ScopedDetail scoped
    JOIN ShipmentDate sdd ON sdd.SdetailKey=scoped.SdetailKey
   GROUP BY scoped.ProdKey,scoped.OrderWeek,CONVERT(date,sdd.ShipmentDtm)
)
SELECT N'SUMMARY' AS RowType,d.ProdKey,CAST(NULL AS varchar(20)) AS OrderWeek,
       CAST(NULL AS date) AS ShipmentDate,d.DistributedQuantity,d.ConfirmedQuantity,d.PendingQuantity,
       d.ShipmentCount,d.AllMasterFixed,d.AllDetailFixed,
       ISNULL((SELECT SUM(ds.ShipmentDateQuantity) FROM DateSummary ds WHERE ds.ProdKey=d.ProdKey),0) AS ShipmentDateQuantity,
       CAST(NULL AS decimal(18,4)) AS ConfirmedDateQuantity
  FROM DetailSummary d
UNION ALL
SELECT N'DATE',ds.ProdKey,ds.OrderWeek,ds.ShipmentDate,
       CAST(NULL AS decimal(18,4)),CAST(NULL AS decimal(18,4)),CAST(NULL AS decimal(18,4)),
       CAST(NULL AS int),CAST(NULL AS int),CAST(NULL AS int),
       ds.ShipmentDateQuantity,ds.ConfirmedDateQuantity
  FROM DateSummary ds
ORDER BY ProdKey,RowType DESC,ShipmentDate,OrderWeek`;
}

export async function loadPreShipmentErpStatus({ orderYear, majorWeek, custKey, prodKeys = [] }) {
  const scope = normalizePreShipmentScope(orderYear, majorWeek);
  const customerKey = Number(custKey);
  if (!Number.isInteger(customerKey) || customerKey <= 0) return { summaries: {}, dates: {} };
  const keys = [...new Set(prodKeys.map(Number).filter(key => Number.isInteger(key) && key > 0))];
  if (!keys.length) return { summaries: {}, dates: {} };
  const params = {
    orderYear: p(sql.Char, scope.orderYear),
    majorPrefix: p(sql.NVarChar, `${String(scope.majorWeek).padStart(2, '0')}-%`),
    custKey: p(sql.Int, customerKey),
  };
  const names = keys.map((key, index) => {
    const name = `prod${index}`;
    params[name] = p(sql.Int, key);
    return name;
  });
  const result = await query(buildPreShipmentErpStatusSql(names), params);
  const summaries = {};
  const dates = {};
  for (const row of result.recordset || []) {
    const key = String(row.ProdKey);
    if (row.RowType === 'SUMMARY') summaries[key] = row;
    else (dates[key] ||= []).push(row);
  }
  return { summaries, dates };
}
