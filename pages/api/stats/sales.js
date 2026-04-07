// pages/api/stats/sales.js — 통계 공통 API
import { query, sql } from '../../../lib/db';
import { withAuth } from '../../../lib/auth';

export default withAuth(async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();
  const { type, week, month, year, manager, area } = req.query;

  try {
    if (type === 'monthly')  return await getMonthly(req, res, { month, year });
    if (type === 'area')     return await getAreaSales(req, res, { week });
    if (type === 'manager')  return await getManagerSales(req, res, { week, manager, area });
    if (type === 'analysis') return await getAnalysis(req, res, { week });
    if (type === 'pivot')    return await getPivot(req, res, { week });
    return res.status(400).json({ success: false, error: 'type 파라미터 필요 (monthly|area|manager|analysis|pivot)' });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ── 월별 판매 현황 ─────────────────────────────────
async function getMonthly(req, res, { month, year }) {
  const curMonth = month || new Date().getMonth() + 1;
  const curYear  = year  || new Date().getFullYear();
  const prevMonth = curMonth === 1 ? 12 : curMonth - 1;
  const prevYear  = curMonth === 1 ? curYear - 1 : curYear;

  // 품목별 판매 현황
  const prodResult = await query(
    `SELECT p.CountryFlower AS prodName,
      SUM(CASE WHEN MONTH(sd.ShipmentDtm)=@cm AND YEAR(sd.ShipmentDtm)=@cy THEN sd.Amount ELSE 0 END) AS curSales,
      SUM(CASE WHEN MONTH(sd.ShipmentDtm)=@pm AND YEAR(sd.ShipmentDtm)=@py THEN sd.Amount ELSE 0 END) AS prevSales,
      SUM(CASE WHEN MONTH(sd.ShipmentDtm)=@cm AND YEAR(sd.ShipmentDtm)=@cy THEN sd.OutQuantity ELSE 0 END) AS qty
     FROM ShipmentDetail sd
     JOIN Product p ON sd.ProdKey = p.ProdKey
     WHERE (MONTH(sd.ShipmentDtm)=@cm AND YEAR(sd.ShipmentDtm)=@cy)
        OR (MONTH(sd.ShipmentDtm)=@pm AND YEAR(sd.ShipmentDtm)=@py)
     GROUP BY p.CountryFlower
     ORDER BY curSales DESC`,
    {
      cm: { type: sql.Int, value: parseInt(curMonth) },
      cy: { type: sql.Int, value: parseInt(curYear) },
      pm: { type: sql.Int, value: parseInt(prevMonth) },
      py: { type: sql.Int, value: parseInt(prevYear) },
    }
  );

  // 거래처별 TOP 15
  const custResult = await query(
    `SELECT TOP 15
      c.CustArea AS area, c.CustName, c.Manager,
      SUM(CASE WHEN MONTH(sd.ShipmentDtm)=@cm AND YEAR(sd.ShipmentDtm)=@cy THEN sd.Amount ELSE 0 END) AS curSales,
      SUM(CASE WHEN MONTH(sd.ShipmentDtm)=@pm AND YEAR(sd.ShipmentDtm)=@py THEN sd.Amount ELSE 0 END) AS prevSales
     FROM ShipmentDetail sd
     JOIN ShipmentMaster sm ON sd.ShipmentKey = sm.ShipmentKey
     JOIN Customer c ON sm.CustKey = c.CustKey
     WHERE (MONTH(sd.ShipmentDtm)=@cm AND YEAR(sd.ShipmentDtm)=@cy)
        OR (MONTH(sd.ShipmentDtm)=@pm AND YEAR(sd.ShipmentDtm)=@py)
     GROUP BY c.CustArea, c.CustName, c.Manager
     ORDER BY curSales DESC`,
    {
      cm: { type: sql.Int, value: parseInt(curMonth) },
      cy: { type: sql.Int, value: parseInt(curYear) },
      pm: { type: sql.Int, value: parseInt(prevMonth) },
      py: { type: sql.Int, value: parseInt(prevYear) },
    }
  );

  // 지역별
  const areaResult = await query(
    `SELECT c.CustArea AS area,
      SUM(CASE WHEN MONTH(sd.ShipmentDtm)=@cm AND YEAR(sd.ShipmentDtm)=@cy THEN sd.Amount ELSE 0 END) AS curSales,
      SUM(CASE WHEN MONTH(sd.ShipmentDtm)=@pm AND YEAR(sd.ShipmentDtm)=@py THEN sd.Amount ELSE 0 END) AS prevSales
     FROM ShipmentDetail sd
     JOIN ShipmentMaster sm ON sd.ShipmentKey = sm.ShipmentKey
     JOIN Customer c ON sm.CustKey = c.CustKey
     WHERE ((MONTH(sd.ShipmentDtm)=@cm AND YEAR(sd.ShipmentDtm)=@cy)
        OR (MONTH(sd.ShipmentDtm)=@pm AND YEAR(sd.ShipmentDtm)=@py))
       AND c.CustArea IS NOT NULL AND c.CustArea != ''
     GROUP BY c.CustArea ORDER BY curSales DESC`,
    {
      cm: { type: sql.Int, value: parseInt(curMonth) }, cy: { type: sql.Int, value: parseInt(curYear) },
      pm: { type: sql.Int, value: parseInt(prevMonth) }, py: { type: sql.Int, value: parseInt(prevYear) },
    }
  );

  // 담당자별
  const mgrResult = await query(
    `SELECT c.Manager,
      SUM(CASE WHEN MONTH(sd.ShipmentDtm)=@cm AND YEAR(sd.ShipmentDtm)=@cy THEN sd.Amount ELSE 0 END) AS curSales,
      SUM(CASE WHEN MONTH(sd.ShipmentDtm)=@pm AND YEAR(sd.ShipmentDtm)=@py THEN sd.Amount ELSE 0 END) AS prevSales
     FROM ShipmentDetail sd
     JOIN ShipmentMaster sm ON sd.ShipmentKey = sm.ShipmentKey
     JOIN Customer c ON sm.CustKey = c.CustKey
     WHERE (MONTH(sd.ShipmentDtm)=@cm AND YEAR(sd.ShipmentDtm)=@cy)
        OR (MONTH(sd.ShipmentDtm)=@pm AND YEAR(sd.ShipmentDtm)=@py)
     GROUP BY c.Manager ORDER BY curSales DESC`,
    {
      cm: { type: sql.Int, value: parseInt(curMonth) }, cy: { type: sql.Int, value: parseInt(curYear) },
      pm: { type: sql.Int, value: parseInt(prevMonth) }, py: { type: sql.Int, value: parseInt(prevYear) },
    }
  );

  return res.status(200).json({
    success: true, source: 'real_db',
    month: curMonth, year: curYear,
    byProduct: prodResult.recordset,
    byCustomer: custResult.recordset,
    byArea: areaResult.recordset,
    byManager: mgrResult.recordset,
  });
}

// ── 지역별 판매 비교 ────────────────────────────────
async function getAreaSales(req, res, { week }) {
  // 현재 차수
  const curWeekResult = await query(
    `SELECT TOP 1 OrderWeek FROM ShipmentMaster WHERE isDeleted=0 ORDER BY CreateDtm DESC`
  );
  const curWeek = week || curWeekResult.recordset[0]?.OrderWeek || '';
  const prevWeekResult = await query(
    `SELECT TOP 1 OrderWeek FROM ShipmentMaster WHERE OrderWeek < @w AND isDeleted=0 ORDER BY OrderWeek DESC`,
    { w: { type: sql.NVarChar, value: curWeek } }
  );
  const prevWeek = prevWeekResult.recordset[0]?.OrderWeek || '';

  const areaResult = await query(
    `SELECT c.CustArea AS area,
      SUM(CASE WHEN sm.OrderWeek=@cur THEN sd.Amount ELSE 0 END) AS curSales,
      SUM(CASE WHEN sm.OrderWeek=@prev THEN sd.Amount ELSE 0 END) AS prevSales
     FROM ShipmentDetail sd
     JOIN ShipmentMaster sm ON sd.ShipmentKey = sm.ShipmentKey
     JOIN Customer c ON sm.CustKey = c.CustKey
     WHERE sm.OrderWeek IN (@cur, @prev) AND sm.isDeleted=0
       AND c.CustArea IS NOT NULL AND c.CustArea != ''
     GROUP BY c.CustArea ORDER BY curSales DESC`,
    { cur: { type: sql.NVarChar, value: curWeek }, prev: { type: sql.NVarChar, value: prevWeek } }
  );

  // 전체차수 피벗
  const allWeeksResult = await query(
    `SELECT c.CustArea AS area, sm.OrderWeek AS week, SUM(sd.Amount) AS sales
     FROM ShipmentDetail sd
     JOIN ShipmentMaster sm ON sd.ShipmentKey = sm.ShipmentKey
     JOIN Customer c ON sm.CustKey = c.CustKey
     WHERE sm.isDeleted=0 AND c.CustArea IS NOT NULL
     GROUP BY c.CustArea, sm.OrderWeek ORDER BY sm.OrderWeek`
  );

  return res.status(200).json({
    success: true, source: 'real_db',
    curWeek, prevWeek,
    byArea: areaResult.recordset,
    allWeeks: allWeeksResult.recordset,
  });
}

// ── 영업사원 실적 ───────────────────────────────────
async function getManagerSales(req, res, { week, manager, area }) {
  const curWeekResult = await query(
    `SELECT TOP 1 OrderWeek FROM ShipmentMaster WHERE isDeleted=0 ORDER BY CreateDtm DESC`
  );
  const curWeek = week || curWeekResult.recordset[0]?.OrderWeek || '';
  const prevWeekResult = await query(
    `SELECT TOP 1 OrderWeek FROM ShipmentMaster WHERE OrderWeek < @w AND isDeleted=0 ORDER BY OrderWeek DESC`,
    { w: { type: sql.NVarChar, value: curWeek } }
  );
  const prevWeek = prevWeekResult.recordset[0]?.OrderWeek || '';

  let where = 'WHERE sm.OrderWeek IN (@cur, @prev) AND sm.isDeleted=0';
  const params = { cur: { type: sql.NVarChar, value: curWeek }, prev: { type: sql.NVarChar, value: prevWeek } };
  if (manager) { where += ' AND c.Manager = @mgr'; params.mgr = { type: sql.NVarChar, value: manager }; }
  if (area)    { where += ' AND c.CustArea = @area'; params.area = { type: sql.NVarChar, value: area }; }

  const result = await query(
    `SELECT c.CustArea AS area, c.Manager AS manager, c.CustName,
      SUM(CASE WHEN sm.OrderWeek=@cur THEN sd.Amount ELSE 0 END) AS curSales,
      SUM(CASE WHEN sm.OrderWeek=@prev THEN sd.Amount ELSE 0 END) AS prevSales
     FROM ShipmentDetail sd
     JOIN ShipmentMaster sm ON sd.ShipmentKey = sm.ShipmentKey
     JOIN Customer c ON sm.CustKey = c.CustKey
     ${where}
     GROUP BY c.CustArea, c.Manager, c.CustName
     ORDER BY c.CustArea, c.Manager, curSales DESC`, params
  );

  return res.status(200).json({
    success: true, source: 'real_db',
    curWeek, prevWeek,
    data: result.recordset,
  });
}

// ── 매출/물량 분석 ──────────────────────────────────
async function getAnalysis(req, res, { week }) {
  const curWeekResult = await query(
    `SELECT TOP 1 OrderWeek FROM ShipmentMaster WHERE isDeleted=0 ORDER BY CreateDtm DESC`
  );
  const curWeek = week || curWeekResult.recordset[0]?.OrderWeek || '';
  const prevWeekResult = await query(
    `SELECT TOP 1 OrderWeek FROM ShipmentMaster WHERE OrderWeek < @w AND isDeleted=0 ORDER BY OrderWeek DESC`,
    { w: { type: sql.NVarChar, value: curWeek } }
  );
  const prevWeek = prevWeekResult.recordset[0]?.OrderWeek || '';

  // 매출 + 불량차감
  const salesResult = await query(
    `SELECT
      SUM(CASE WHEN sm.OrderWeek=@cur THEN sd.Amount ELSE 0 END) AS curSales,
      SUM(CASE WHEN sm.OrderWeek=@prev THEN sd.Amount ELSE 0 END) AS prevSales
     FROM ShipmentDetail sd
     JOIN ShipmentMaster sm ON sd.ShipmentKey = sm.ShipmentKey
     WHERE sm.OrderWeek IN (@cur, @prev) AND sm.isDeleted=0`,
    { cur: { type: sql.NVarChar, value: curWeek }, prev: { type: sql.NVarChar, value: prevWeek } }
  );

  const defectResult = await query(
    `SELECT e.EstimateType,
      SUM(CASE WHEN sm.OrderWeek=@cur THEN e.Amount ELSE 0 END) AS curAmount,
      SUM(CASE WHEN sm.OrderWeek=@prev THEN e.Amount ELSE 0 END) AS prevAmount
     FROM Estimate e
     JOIN ShipmentMaster sm ON e.ShipmentKey = sm.ShipmentKey
     WHERE sm.OrderWeek IN (@cur, @prev) AND sm.isDeleted=0
     GROUP BY e.EstimateType`,
    { cur: { type: sql.NVarChar, value: curWeek }, prev: { type: sql.NVarChar, value: prevWeek } }
  );

  // 꽃 종류별 매출
  const flowerResult = await query(
    `SELECT p.FlowerName,
      SUM(CASE WHEN sm.OrderWeek=@cur THEN sd.Amount ELSE 0 END) AS curSales
     FROM ShipmentDetail sd
     JOIN ShipmentMaster sm ON sd.ShipmentKey = sm.ShipmentKey
     JOIN Product p ON sd.ProdKey = p.ProdKey
     WHERE sm.OrderWeek=@cur AND sm.isDeleted=0
     GROUP BY p.FlowerName ORDER BY curSales DESC`,
    { cur: { type: sql.NVarChar, value: curWeek }, prev: { type: sql.NVarChar, value: prevWeek } }
  );

  // 전체 차수 추이
  const trendResult = await query(
    `SELECT sm.OrderWeek AS week,
      SUM(sd.Amount) AS sales
     FROM ShipmentDetail sd
     JOIN ShipmentMaster sm ON sd.ShipmentKey = sm.ShipmentKey
     WHERE sm.isDeleted=0
     GROUP BY sm.OrderWeek ORDER BY sm.OrderWeek`
  );

  return res.status(200).json({
    success: true, source: 'real_db',
    curWeek, prevWeek,
    sales: salesResult.recordset[0],
    defects: defectResult.recordset,
    byFlower: flowerResult.recordset,
    trend: trendResult.recordset,
  });
}

// ── Pivot 통계 ─────────────────────────────────────
async function getPivot(req, res, { week }) {
  const curWeekResult = await query(
    `SELECT TOP 1 OrderWeek FROM StockMaster ORDER BY CreateDtm DESC`
  );
  const curWeek = week || curWeekResult.recordset[0]?.OrderWeek || '';

  const result = await query(
    `SELECT
      p.CounName AS country, p.FlowerName AS flower, p.ProdName AS name,
      ISNULL(ps.Stock, 0) AS prevStock,
      ISNULL((SELECT SUM(wd.OutQuantity) FROM WarehouseDetail wd
               JOIN WarehouseMaster wm ON wd.WarehouseKey=wm.WarehouseKey
               WHERE wd.ProdKey=p.ProdKey AND wm.OrderWeek=@week AND wm.isDeleted=0),0) AS inQty,
      ISNULL((SELECT SUM(sd.OutQuantity) FROM ShipmentDetail sd
               JOIN ShipmentMaster sm ON sd.ShipmentKey=sm.ShipmentKey
               WHERE sd.ProdKey=p.ProdKey AND sm.OrderWeek=@week AND sm.isDeleted=0),0) AS outQty,
      ISNULL((SELECT SUM(od.NoneOutQuantity) FROM OrderDetail od
               JOIN OrderMaster om ON od.OrderMasterKey=om.OrderMasterKey
               WHERE od.ProdKey=p.ProdKey AND om.OrderWeek=@week AND om.isDeleted=0),0) AS noneOutQty
     FROM Product p
     LEFT JOIN StockMaster sm2 ON sm2.OrderWeek = @week
     LEFT JOIN ProductStock ps ON p.ProdKey=ps.ProdKey AND ps.StockKey=sm2.StockKey
     WHERE p.isDeleted=0
     ORDER BY p.CounName, p.FlowerName, p.ProdName`,
    { week: { type: sql.NVarChar, value: curWeek } }
  );

  return res.status(200).json({
    success: true, source: 'real_db',
    week: curWeek,
    data: result.recordset,
  });
}
