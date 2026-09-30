// lib/profitWorkbook.js — 매출원가 양식 원천시트 DB 계층. 계약: docs/contracts/profit-workbook.json
//  - ERP 테이블(ShipmentMaster/Detail, Estimate, WarehouseMaster/Detail, Customer, Product, CodeInfo)은 SELECT만.
//  - 쓰기는 웹 전용 ProfitWorkbookSnapshot / ProfitWorkbookSnapshotRow INSERT만(행 불변 — DB 트리거가 UPDATE/DELETE 차단).
//  - 스키마 생성은 migration(docs/migrations/2026-09-30_profit_workbook_snapshot.sql)만. 런타임은 존재 확인만.
import crypto from 'crypto';
import { query, sql, withTransaction } from './db.js';
import { assertWebSchemaContract } from './webSchemaContract.js';
import { CASE_CATEGORY, nonValueWeightSql } from './profitReport.js';
import {
  PURCHASE_COUNTRIES, buildSalesRows, buildDeductionRows, buildPurchaseRows, sheetTotals, defaultRegionFor,
} from './profitWorkbookRules.js';

export function assertWorkbookSchema() {
  return assertWebSchemaContract('profit-workbook@1', [
    { table: 'ProfitWorkbookSnapshot', columns: ['SnapshotKey', 'OrderYear', 'MajorWeek', 'VersionNo', 'Kind', 'BaseSnapshotKey', 'CreatedBy', 'CreatedAt', 'RowCnt', 'TotalsJson', 'SourceHash', 'Note'] },
    { table: 'ProfitWorkbookSnapshotRow', columns: ['SnapshotKey', 'Sheet', 'RowKey', 'SortNo', 'IsManual', 'DataJson', 'ManualJson', 'ManualBy', 'ManualAt'] },
  ]);
}

const weekParams = (major, orderYear) => ({
  yr: { type: sql.NVarChar, value: String(orderYear) },
  pfx: { type: sql.NVarChar, value: `${major}-%` },
  yw: { type: sql.NVarChar, value: `${orderYear}${major}` },
});

/** 현재 ERP 원천 → 시트 행(판매현황·불량차감·그 외 매출액·구매현황). SELECT만. */
export async function loadLiveRows(major, orderYear) {
  const p = weekParams(major, orderYear);
  // 판매현황: 본표 N(salesByCategory)과 같은 필터 — 확정(sm/sd.isFix) 출고, 저장 Amount/Vat, 수량 EstQuantity
  const salesQ = query(
    `SELECT sm.CustKey, c.CustName, c.CustArea, sd.ProdKey, p.ProdName, ${CASE_CATEGORY} AS Category,
            SUM(ISNULL(sd.EstQuantity,0)) AS EstQuantity, SUM(ISNULL(sd.Amount,0)) AS Amount, SUM(ISNULL(sd.Vat,0)) AS Vat
       FROM ShipmentDetail sd
       JOIN ShipmentMaster sm ON sd.ShipmentKey=sm.ShipmentKey
       JOIN Customer c ON c.CustKey=sm.CustKey
       LEFT JOIN Product p ON sd.ProdKey=p.ProdKey
      WHERE sm.OrderYear=@yr AND sm.OrderWeek LIKE @pfx AND ISNULL(sm.OrderYearWeek,'')=@yw AND ISNULL(sm.isDeleted,0)=0
        AND ISNULL(sm.isFix,0)=1 AND ISNULL(sd.isFix,0)=1 AND ISNULL(sd.OutQuantity,0)<>0
        AND ${nonValueWeightSql('p')}
      GROUP BY sm.CustKey, c.CustName, c.CustArea, sd.ProdKey, p.ProdName, ${CASE_CATEGORY}`, p);
  // 차감: 본표 L/O(estimateByCategory)와 같은 필터, Estimate 행 단위(품목 조인)
  const deductQ = query(
    `SELECT e.EstimateKey, CONVERT(NVARCHAR(10), e.EstimateDtm, 111) AS EstimateDate, sm.CustKey, c.CustName, c.CustArea,
            ci.Descr AS TypeName, ci.Descr2 AS TypeGroup, e.Quantity, e.Cost, e.Amount, e.Vat, e.Descr,
            e.ProdKey, p.ProdName, ${CASE_CATEGORY} AS Category
       FROM Estimate e
       JOIN ShipmentMaster sm ON e.ShipmentKey=sm.ShipmentKey
       JOIN Customer c ON c.CustKey=sm.CustKey
       LEFT JOIN Product p ON e.ProdKey=p.ProdKey
       LEFT JOIN CodeInfo ci ON ci.Category=N'EstimateType' AND ci.DetailCode=e.EstimateType
      WHERE sm.OrderYear=@yr AND sm.OrderWeek LIKE @pfx AND ISNULL(sm.OrderYearWeek,'')=@yw AND ISNULL(sm.isDeleted,0)=0
        AND ISNULL(sm.isFix,0)=1 AND ${nonValueWeightSql('p')}`, p);
  // 구매현황: 입고 상세(WarehouseDetail엔 isDeleted 없음 — 마스터로만 필터)
  const purchaseQ = query(
    `SELECT wm.WarehouseKey, CONVERT(NVARCHAR(10), wm.InputDate, 111) AS InputDate, wm.OrderWeek, wm.FarmName, wm.InvoiceNo,
            wd.ProdKey, p.ProdName, p.CounName, ${CASE_CATEGORY} AS Category,
            SUM(ISNULL(wd.EstQuantity,0)) AS EstQuantity, SUM(ISNULL(wd.BoxQuantity,0)) AS BoxQuantity,
            MAX(ISNULL(wd.UPrice,0)) AS UPrice, SUM(ISNULL(wd.TPrice,0)) AS TPrice
       FROM WarehouseDetail wd
       JOIN WarehouseMaster wm ON wd.WarehouseKey=wm.WarehouseKey
       LEFT JOIN Product p ON wd.ProdKey=p.ProdKey
      WHERE wm.OrderYear=@yr AND wm.OrderWeek LIKE @pfx AND ISNULL(wm.isDeleted,0)=0 AND ${nonValueWeightSql('p')}
      GROUP BY wm.WarehouseKey, wm.InputDate, wm.OrderWeek, wm.FarmName, wm.InvoiceNo, wd.ProdKey, p.ProdName, p.CounName, ${CASE_CATEGORY}`, p);
  const [s, d, w] = await Promise.all([salesQ, deductQ, purchaseQ]);
  return [
    ...buildSalesRows(s.recordset),
    ...buildDeductionRows(d.recordset),
    ...buildPurchaseRows(w.recordset, PURCHASE_COUNTRIES),
  ];
}

export async function loadDefaultRegion(userName) {
  if (!userName) return '전체';
  const r = await query(
    `SELECT CustArea, COUNT(*) AS n FROM Customer WHERE ISNULL(isDeleted,0)=0 AND Manager=@m GROUP BY CustArea`,
    { m: { type: sql.NVarChar, value: String(userName) } });
  return defaultRegionFor(r.recordset);
}

const parseJson = (s, fb) => { try { return s ? JSON.parse(s) : fb; } catch { return fb; } };

export async function listSnapshots(major, orderYear) {
  const r = await query(
    `SELECT SnapshotKey, VersionNo, Kind, BaseSnapshotKey, CreatedBy, CreatedAt, RowCnt, TotalsJson, Note
       FROM dbo.ProfitWorkbookSnapshot WHERE OrderYear=@yr AND MajorWeek=@mw ORDER BY VersionNo DESC`,
    { yr: { type: sql.NVarChar, value: String(orderYear) }, mw: { type: sql.NVarChar, value: String(major) } });
  return r.recordset.map((x) => ({ ...x, totals: parseJson(x.TotalsJson, {}), TotalsJson: undefined }));
}

export async function loadSnapshotRows(snapshotKey) {
  const r = await query(
    `SELECT Sheet, RowKey, SortNo, IsManual, DataJson, ManualJson, ManualBy, ManualAt
       FROM dbo.ProfitWorkbookSnapshotRow WHERE SnapshotKey=@k ORDER BY Sheet, SortNo`,
    { k: { type: sql.Int, value: Number(snapshotKey) } });
  return r.recordset.map((x) => ({
    sheet: x.Sheet, rowKey: x.RowKey, isManual: Boolean(x.IsManual),
    data: parseJson(x.DataJson, {}), manual: parseJson(x.ManualJson, {}),
    manualBy: x.ManualBy || null, manualAt: x.ManualAt || null,
  }));
}

export function sourceHash(rows) {
  const h = crypto.createHash('sha256');
  for (const r of rows) h.update(`${r.sheet}|${r.rowKey}|${JSON.stringify(r.data)}|${JSON.stringify(r.manual || {})}\n`);
  return h.digest('hex');
}

/** 새 버전 INSERT(행 불변). kind: CONFIRM(첫 확정) / REFRESH(최신화) / EDIT(수기 저장). */
export async function insertSnapshot({ major, orderYear, kind, baseSnapshotKey = null, rows, actor, note = '' }) {
  const totals = sheetTotals(rows);
  const hash = sourceHash(rows);
  const P = (type, value) => ({ type, value });
  return withTransaction(async (tQuery) => {
    const yr = P(sql.NVarChar, String(orderYear)); const mw = P(sql.NVarChar, String(major));
    const v = await tQuery(`SELECT ISNULL(MAX(VersionNo),0)+1 AS nv FROM dbo.ProfitWorkbookSnapshot WITH (UPDLOCK, HOLDLOCK) WHERE OrderYear=@yr AND MajorWeek=@mw`, { yr, mw });
    const versionNo = v.recordset[0].nv;
    const ins = await tQuery(
      `INSERT INTO dbo.ProfitWorkbookSnapshot (OrderYear, MajorWeek, VersionNo, Kind, BaseSnapshotKey, CreatedBy, RowCnt, TotalsJson, SourceHash, Note)
       OUTPUT INSERTED.SnapshotKey VALUES (@yr, @mw, @vn, @kind, @base, @by, @cnt, @tj, @hash, @note)`,
      {
        yr, mw, vn: P(sql.Int, versionNo), kind: P(sql.NVarChar, kind), base: P(sql.Int, baseSnapshotKey),
        by: P(sql.NVarChar, String(actor || 'user')), cnt: P(sql.Int, rows.length), tj: P(sql.NVarChar(sql.MAX), JSON.stringify(totals)),
        hash: P(sql.NVarChar, hash), note: P(sql.NVarChar, String(note || '').slice(0, 500)),
      });
    const snapshotKey = ins.recordset[0].SnapshotKey;
    const CHUNK = 150;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const part = rows.slice(i, i + CHUNK);
      const params = { k: P(sql.Int, snapshotKey) };
      const values = part.map((row, j) => {
        params[`s${j}`] = P(sql.NVarChar, row.sheet);
        params[`rk${j}`] = P(sql.NVarChar, row.rowKey);
        params[`o${j}`] = P(sql.Int, i + j);
        params[`m${j}`] = P(sql.Bit, row.isManual || String(row.rowKey).startsWith('M:') ? 1 : 0);
        params[`d${j}`] = P(sql.NVarChar(sql.MAX), JSON.stringify(row.data || {}));
        params[`mj${j}`] = P(sql.NVarChar(sql.MAX), row.manual && Object.keys(row.manual).length ? JSON.stringify(row.manual) : null);
        params[`mb${j}`] = P(sql.NVarChar, row.manualBy || null);
        params[`ma${j}`] = P(sql.NVarChar, row.manualAt || null);
        return `(@k, @s${j}, @rk${j}, @o${j}, @m${j}, @d${j}, @mj${j}, @mb${j}, @ma${j})`;
      });
      await tQuery(`INSERT INTO dbo.ProfitWorkbookSnapshotRow (SnapshotKey, Sheet, RowKey, SortNo, IsManual, DataJson, ManualJson, ManualBy, ManualAt) VALUES ${values.join(',')}`, params);
    }
    return { snapshotKey, versionNo, totals, rowCount: rows.length };
  });
}
