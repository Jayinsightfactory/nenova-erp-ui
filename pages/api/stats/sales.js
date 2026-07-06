// pages/api/stats/sales.js — 통계 공통 API
import { query, sql } from '../../../lib/db';
import { withAuth } from '../../../lib/auth';
import { useExeParityFlag } from '../../../lib/exeParity/common.js';
import { loadSalesDefectViewData } from '../../../lib/exeParity/loadSalesDefectView.js';
import {
  sqlSalesViewByArea,
  sqlSalesViewByCustomer,
  sqlSalesViewByManager,
  sqlSalesViewByProduct,
} from '../../../lib/exeSalesViewSql.js';
import {
  sqlAreaSalesByArea,
  sqlAreaSalesCountries,
  sqlAreaSalesPivot,
} from '../../../lib/exeAreaSalesViewSql.js';
import { sqlSalesManagerViewGetData } from '../../../lib/exeSalesManagerViewSql.js';
import { resolveOrderYearWeekFromBaseYmd } from '../../../lib/exeParity/common.js';
import {
  mapManagerSalesRow,
  mapAreaSalesRow,
  mapAreaPivotRows,
  mapAnalysisDefectRow,
  mapAnalysisFlowerRow,
  mapAnalysisTrendRow,
} from '../../../lib/exeParity/mapResponses.js';

export default withAuth(async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();
  const { type, week, month, year, manager, area, exeParity, searchDate } = req.query;
  const useExe = useExeParityFlag(exeParity);

  try {
    if (type === 'monthly')  return await getMonthly(req, res, { month, year, useExe });
    if (type === 'area')     return await getAreaSales(req, res, { week, searchDate: req.query.searchDate, useExe });
    if (type === 'manager')  return await getManagerSales(req, res, { week, manager, area, searchDate, useExe });
    if (type === 'analysis') return await getAnalysis(req, res, { week, searchDate, useExe });
    if (type === 'pivot')    return await getPivot(req, res, { week, useExe });
    return res.status(400).json({ success: false, error: 'type 파라미터 필요 (monthly|area|manager|analysis|pivot)' });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ── 월별 판매 현황 ─────────────────────────────────
async function getMonthly(req, res, { month, year, useExe }) {
  const curMonthNum = month || new Date().getMonth() + 1;
  const curYear  = year  || new Date().getFullYear();
  const prevMonthNum = curMonthNum === 1 ? 12 : curMonthNum - 1;
  const prevYear  = curMonthNum === 1 ? curYear - 1 : curYear;
  const curMonth = `${curYear}-${String(curMonthNum).padStart(2, '0')}`;
  const prevMonth = `${prevYear}-${String(prevMonthNum).padStart(2, '0')}`;
  const monthParams = {
    curMonth: { type: sql.NVarChar, value: curMonth },
    prevMonth: { type: sql.NVarChar, value: prevMonth },
  };

  if (useExe) {
    const [prodResult, custResult, areaResult, mgrResult] = await Promise.all([
      query(sqlSalesViewByProduct(), monthParams),
      query(sqlSalesViewByCustomer(), monthParams),
      query(sqlSalesViewByArea(), monthParams),
      query(sqlSalesViewByManager(), monthParams),
    ]);
    return res.status(200).json({
      success: true,
      source: 'real_db_exe_parity',
      month: curMonthNum,
      year: curYear,
      byProduct: prodResult.recordset.map((r) => ({
        prodName: r.CountryFlower,
        curSales: r.Amount1,
        prevSales: r.Amount2,
        qty: r.OutQuantity,
        rate: r.Rate,
      })),
      byCustomer: custResult.recordset.map((r) => ({
        area: r.CustArea,
        CustName: r.CustName,
        curSales: r.Amount1,
        prevSales: r.Amount2,
        rate: r.Rate,
      })),
      byArea: areaResult.recordset.map((r) => ({
        area: r.CustArea,
        curSales: r.Amount1,
        prevSales: r.Amount2,
        rate: r.Rate,
      })),
      byManager: mgrResult.recordset.map((r) => ({
        Manager: r.Manager,
        curSales: r.Amount1,
        prevSales: r.Amount2,
        rate: r.Rate,
      })),
    });
  }

  const prevMonthLegacy = prevMonthNum;
  const prevYearLegacy = prevYear;

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
      cm: { type: sql.Int, value: parseInt(curMonthNum) },
      cy: { type: sql.Int, value: parseInt(curYear) },
      pm: { type: sql.Int, value: parseInt(prevMonthLegacy) },
      py: { type: sql.Int, value: parseInt(prevYearLegacy) },
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
      cm: { type: sql.Int, value: parseInt(curMonthNum) },
      cy: { type: sql.Int, value: parseInt(curYear) },
      pm: { type: sql.Int, value: parseInt(prevMonthLegacy) },
      py: { type: sql.Int, value: parseInt(prevYearLegacy) },
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
      cm: { type: sql.Int, value: parseInt(curMonthNum) }, cy: { type: sql.Int, value: parseInt(curYear) },
      pm: { type: sql.Int, value: parseInt(prevMonthLegacy) }, py: { type: sql.Int, value: parseInt(prevYearLegacy) },
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
      cm: { type: sql.Int, value: parseInt(curMonthNum) }, cy: { type: sql.Int, value: parseInt(curYear) },
      pm: { type: sql.Int, value: parseInt(prevMonthLegacy) }, py: { type: sql.Int, value: parseInt(prevYearLegacy) },
    }
  );

  return res.status(200).json({
    success: true, source: 'real_db',
    month: curMonthNum, year: curYear,
    byProduct: prodResult.recordset,
    byCustomer: custResult.recordset,
    byArea: areaResult.recordset,
    byManager: mgrResult.recordset,
  });
}

// ── 지역별 판매 비교 ────────────────────────────────
async function getAreaSales(req, res, { week, searchDate, useExe }) {
  if (useExe) {
    const base = searchDate ? new Date(searchDate) : new Date();
    const week1 = await resolveOrderYearWeekFromBaseYmd(query, sql, base);
    const prev = new Date(base);
    prev.setDate(prev.getDate() - 7);
    const week2 = await resolveOrderYearWeekFromBaseYmd(query, sql, prev);
    if (!week1) return res.status(200).json({ success: true, source: 'real_db_exe_parity', data: [] });
    const wk = {
      week1: { type: sql.NVarChar, value: week1 },
      week2: { type: sql.NVarChar, value: week2 || week1 },
    };
    const [area, countries, pivot] = await Promise.all([
      query(sqlAreaSalesByArea(), wk),
      query(sqlAreaSalesCountries(), { week1: wk.week1 }),
      query(sqlAreaSalesPivot(base.getFullYear()), {}),
    ]);
    return res.status(200).json({
      success: true,
      source: 'real_db_exe_parity',
      orderYearWeek1: week1,
      orderYearWeek2: week2,
      curWeek: week1?.substring(4) || '',
      prevWeek: week2?.substring(4) || '',
      byArea: area.recordset.map(mapAreaSalesRow),
      countries: countries.recordset,
      allWeeks: mapAreaPivotRows(pivot.recordset),
    });
  }

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

// ── 영업사원 실적 (FormSalesManagerView) ─────────────────
async function getManagerSales(req, res, { week, manager, area, searchDate, useExe }) {
  if (useExe) {
    const base = searchDate ? new Date(searchDate) : new Date();
    const week1 = await resolveOrderYearWeekFromBaseYmd(query, sql, base);
    const prev = new Date(base);
    prev.setDate(prev.getDate() - 7);
    const week2 = await resolveOrderYearWeekFromBaseYmd(query, sql, prev);
    if (!week1) {
      return res.status(200).json({ success: true, source: 'real_db_exe_parity', data: [] });
    }
    const params = {
      week1: { type: sql.NVarChar, value: week1 },
      week2: { type: sql.NVarChar, value: week2 || week1 },
    };
    if (manager) params.manager = { type: sql.NVarChar, value: manager };
    if (area) params.area = { type: sql.NVarChar, value: area };
    const result = await query(
      sqlSalesManagerViewGetData({ managerFilter: !!manager, areaFilter: !!area }),
      params
    );
    return res.status(200).json({
      success: true,
      source: 'real_db_exe_parity',
      orderYearWeek1: week1,
      orderYearWeek2: week2,
      curWeek: week1.substring(4),
      prevWeek: (week2 || week1).substring(4),
      data: result.recordset.map(mapManagerSalesRow),
    });
  }

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

// ── 매출/물량 분석 (FormSalesDefectView) ─────────────
async function getAnalysis(req, res, { week, searchDate, useExe }) {
  if (useExe) {
    const data = await loadSalesDefectViewData(query, sql, searchDate || new Date().toISOString().slice(0, 10));
    const salesRow = data.profit[0] || {};
    return res.status(200).json({
      success: true,
      source: 'real_db_exe_parity',
      orderYearWeek1: data.week1,
      orderYearWeek2: data.week2,
      curWeek: data.week1?.substring(4) || '',
      prevWeek: data.week2?.substring(4) || '',
      sales: { curSales: salesRow.Amount1, prevSales: salesRow.Amount2 },
      defects: data.defect
        .filter((r) => r.Type !== '매출액' && r.Descr !== '매출액')
        .map(mapAnalysisDefectRow),
      byFlower: data.profitPivot.map(mapAnalysisFlowerRow),
      defectPivot: data.defectPivot,
      trend: data.trend.map(mapAnalysisTrendRow),
    });
  }

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
