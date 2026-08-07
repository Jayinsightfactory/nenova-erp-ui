// pages/api/stock/index.js
// GET/POST → 실제 전산 StockHistory + usp_StockCalculation 기준

import { query, withTransaction, sql } from '../../../lib/db';
import { withAuth } from '../../../lib/auth';
import { normalizeOrderWeek, requireOrderYear } from '../../../lib/orderUtils';
import { useExeParityFlag, normalizeOrderYearWeek2, resolveBeforeOrderYearWeek } from '../../../lib/exeParity/common.js';
import { sqlStockViewGetData } from '../../../lib/exeStockViewSql.js';
import { mapStockViewRow } from '../../../lib/exeParity/mapResponses.js';
import {
  calculateStockPosition,
  normalizeStockHistoryRow,
  rankSubstituteCandidates,
  STOCK_HISTORY_SQL,
  STOCK_POSITION_SQL,
} from '../../../lib/stockManagement.js';

export default withAuth(async function handler(req, res) {
  if (req.method === 'GET')  return await getStock(req, res);
  if (req.method === 'POST') return await adjustStock(req, res);
  return res.status(405).end();
});

async function getStock(req, res) {
  const { week: rawWeek, orderYear: requestedYear, year, prodName, type, prodKey, countryFlower, exeParity } = req.query;
  const week = rawWeek ? normalizeOrderWeek(rawWeek) : '';
  let selected = null;
  if (rawWeek) {
    try { selected = requireOrderYear(rawWeek, requestedYear || year || ''); }
    catch (error) { return res.status(400).json({ success: false, code: error.code, error: error.message }); }
  }
  const useExe = useExeParityFlag(exeParity);

  // 확정 스냅샷과 아직 스냅샷에 반영되지 않은 미확정 분배를 분리한 웹/MOYI 공용 조회.
  if (type === 'management' || type === 'substitutes' || type === 'moyiWeek') {
    if (!selected) return res.status(400).json({ success: false, error: 'week와 orderYear 필요' });
    try {
      const stockMaster = await query(
        `SELECT TOP 1 sm.StockKey
           FROM StockMaster sm
          WHERE sm.OrderYear=@year AND sm.OrderWeek=@week
            AND EXISTS (SELECT 1 FROM ProductStock ps WHERE ps.StockKey=sm.StockKey)
          ORDER BY (SELECT COUNT(*) FROM ProductStock ps WHERE ps.StockKey=sm.StockKey) DESC,
                   sm.StockKey DESC`,
        {
          year: { type: sql.NVarChar, value: selected.orderYear },
          week: { type: sql.NVarChar, value: week },
        }
      );
      const stockKey = Number(stockMaster.recordset[0]?.StockKey || 0);
      if (!stockKey) return res.status(200).json({ success: true, orderYear: selected.orderYear, orderWeek: week, stock: [] });
      const result = await query(STOCK_POSITION_SQL, {
        stockKey: { type: sql.Int, value: stockKey },
        year: { type: sql.NVarChar, value: selected.orderYear },
        week: { type: sql.NVarChar, value: week },
      });
      const rows = result.recordset.map((row) => ({
        ...row,
        ...calculateStockPosition({ confirmedStock: row.ConfirmedStock, pendingAllocation: row.PendingAllocation }),
      }));
      if (type === 'substitutes') {
        const targetKey = Number(prodKey);
        const target = rows.find((row) => Number(row.ProdKey) === targetKey);
        if (!target) return res.status(404).json({ success: false, error: '대상 품목 없음' });
        return res.status(200).json({
          success: true,
          orderYear: selected.orderYear,
          orderWeek: week,
          targetProdKey: targetKey,
          candidates: rankSubstituteCandidates(rows, {
            prodKey: targetKey,
            countryFlower: target.CountryFlower,
            outUnit: target.OutUnit,
          }),
        });
      }
      return res.status(200).json({
        success: true,
        profile: type === 'moyiWeek' ? 'MOYI_STOCK_WEEK_V1' : 'STOCK_MANAGEMENT_V1',
        orderYear: selected.orderYear,
        orderWeek: week,
        stockKey,
        stock: rows,
      });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  // ── 재고 입/출고 내역 (FormStockView focus)
  if (type === 'history') {
    if (!prodKey) return res.status(400).json({ success: false, error: 'prodKey 필요' });
    if (!selected) return res.status(400).json({ success: false, error: 'week와 orderYear 필요' });
    try {
      const result = await query(
        `SELECT * FROM (${STOCK_HISTORY_SQL}) h ORDER BY EventDtm ASC`,
        {
          week: { type: sql.NVarChar, value: week },
          year: { type: sql.NVarChar, value: selected.orderYear },
          pk:   { type: sql.Int,      value: parseInt(prodKey) },
        }
      );
      const history = result.recordset.map(normalizeStockHistoryRow).map((row) => ({
        ...row,
        구분: row.type,
        일자: row.date,
        변경수량: row.delta,
        비고: row.descr,
      }));
      return res.status(200).json({ success: true, source: 'stock_management_ledger', history });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  // ── 차수별 재고 피벗 — 지정 차수 이하 최근 N개 차수의 ProductStock 스냅샷
  //    (StockMaster 중복행은 bit isFix 시절 잔재 — ProductStock 행이 가장 많은 StockKey를 대표로 선택)
  if (type === 'weekPivot') {
    try {
      const back = Math.min(Math.max(parseInt(req.query.back || '6', 10) || 6, 2), 12);
      const orderYear = selected.orderYear;
      const oyw = orderYear + String(week || '').replace('-', '');
      const weeksResult = await query(
        `WITH wk AS (
           SELECT sm.OrderWeek, sm.OrderYearWeek, sm.StockKey,
                  ROW_NUMBER() OVER (PARTITION BY sm.OrderYearWeek
                    ORDER BY (SELECT COUNT(*) FROM ProductStock ps WHERE ps.StockKey = sm.StockKey) DESC,
                             sm.StockKey DESC) AS rn
             FROM StockMaster sm
            WHERE sm.OrderYear=@orderYear AND sm.OrderYearWeek <= @oyw AND sm.OrderWeek LIKE '__-__'
         )
         SELECT TOP (@back) OrderWeek, OrderYearWeek, StockKey
           FROM wk WHERE rn = 1
          ORDER BY OrderYearWeek DESC`,
        {
          oyw:  { type: sql.NVarChar, value: oyw },
          orderYear: { type: sql.NVarChar, value: orderYear },
          back: { type: sql.Int, value: back },
        }
      );
      const weeks = weeksResult.recordset.reverse(); // 오래된 차수 → 최신 차수
      if (weeks.length === 0) return res.status(200).json({ success: true, weeks: [], stocks: {} });

      const keyList = weeks.map(w => Number(w.StockKey)).filter(Boolean);
      const stocksResult = await query(
        `SELECT ps.StockKey, ps.ProdKey, ISNULL(ps.Stock, 0) AS Stock
           FROM ProductStock ps
          WHERE ps.StockKey IN (${keyList.map((_, i) => `@k${i}`).join(',')})`,
        Object.fromEntries(keyList.map((k, i) => [`k${i}`, { type: sql.Int, value: k }]))
      );
      const weekByKey = Object.fromEntries(weeks.map(w => [Number(w.StockKey), w.OrderWeek]));
      const stocks = {};
      for (const r of stocksResult.recordset) {
        const wkLabel = weekByKey[Number(r.StockKey)];
        if (!wkLabel) continue;
        (stocks[r.ProdKey] ||= {})[wkLabel] = Number(r.Stock);
      }
      return res.status(200).json({
        success: true,
        weeks: weeks.map(w => w.OrderWeek),
        stocks,
      });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  // ── 재고 목록 조회
  let where = 'WHERE p.isDeleted = 0';
  const params = {};
  if (prodName) {
    where += ' AND (p.ProdName LIKE @name OR p.FlowerName LIKE @name)';
    params.name = { type: sql.NVarChar, value: `%${prodName}%` };
  }
  try {
    if (useExe && week) {
      const requestedYear = selected.orderYear;
      const oyw = normalizeOrderYearWeek2(
        (await query(
          `SELECT TOP 1 OrderYearWeek
             FROM StockMaster
            WHERE OrderWeek=@week AND OrderYear=@year
            ORDER BY StockKey DESC`,
          {
            week: { type: sql.NVarChar, value: week },
            year: { type: sql.NVarChar, value: requestedYear },
          }
        )).recordset[0]?.OrderYearWeek || `${requestedYear}${week.replace(/-/g, '')}`
      );
      const before = await resolveBeforeOrderYearWeek(query, sql, oyw);
      const params = {
        orderYearWeek: { type: sql.NVarChar, value: oyw },
        beforeOrderYearWeek: { type: sql.NVarChar, value: before || oyw },
      };
      if (countryFlower) params.countryFlower = { type: sql.NVarChar, value: countryFlower };
      let sqlText = sqlStockViewGetData({ countryFlower: countryFlower || null });
      if (prodName) {
        sqlText = `SELECT * FROM (${sqlText}) s WHERE s.ProdName LIKE @name OR s.FlowerName LIKE @name`;
        params.name = { type: sql.NVarChar, value: `%${prodName}%` };
      }
      const result = await query(sqlText, params);
      return res.status(200).json({
        success: true,
        source: 'real_db_exe_parity',
        orderYearWeek: oyw,
        count: result.recordset.length,
        stock: result.recordset.map(mapStockViewRow),
      });
    }

    const listParams = { ...params, week: { type: sql.NVarChar, value: week || '' }, orderYear: { type: sql.NVarChar, value: selected?.orderYear || '' } };
    const result = await query(
      `SELECT
        p.ProdKey, p.ProdName, p.FlowerName, p.CounName, p.OutUnit,
        ISNULL(sm2.StockKey, 0) AS StockKey,
        ISNULL(ps.Stock, 0) AS prevStock,
        ISNULL(
          (SELECT SUM(wd.OutQuantity) FROM WarehouseDetail wd
           JOIN WarehouseMaster wm ON wd.WarehouseKey = wm.WarehouseKey
           WHERE wd.ProdKey = p.ProdKey
             AND wm.OrderYear=@orderYear AND wm.OrderWeek = @week AND wm.isDeleted = 0), 0) AS inQty,
        ISNULL(
          (SELECT SUM(sd.OutQuantity) FROM ShipmentDetail sd
           JOIN ShipmentMaster sm ON sd.ShipmentKey = sm.ShipmentKey
           WHERE sd.ProdKey = p.ProdKey
             AND sm.OrderYear=@orderYear AND sm.OrderWeek = @week AND sm.isDeleted = 0), 0) AS outQty,
        ISNULL(
          (SELECT SUM(ISNULL(sh.AfterValue,0) - ISNULL(sh.BeforeValue,0)) FROM StockHistory sh
           WHERE sh.ProdKey = p.ProdKey AND sh.OrderYear=@orderYear AND sh.OrderWeek = @week), 0) AS adjustQty
       FROM Product p
       LEFT JOIN StockMaster sm2 ON sm2.OrderYear=@orderYear AND sm2.OrderWeek = @week
       LEFT JOIN ProductStock ps ON p.ProdKey = ps.ProdKey AND ps.StockKey = sm2.StockKey
       ${where}
       ORDER BY p.CounName, p.FlowerName, p.ProdName`,
      listParams
    );
    return res.status(200).json({
      success: true,
      source: 'real_db',
      count: result.recordset.length,
      stock: result.recordset,
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}

async function adjustStock(req, res) {
  const { week: rawWeek, orderYear: requestedYear, year, prodKey, prodName, qty, delta, adjustType, descr } = req.body;
  try {
    const selected = requireOrderYear(rawWeek, requestedYear || year || '');
    const week = selected.orderWeek;
    let pk = prodKey;
    if (!pk && prodName) {
      const r = await query(
        `SELECT TOP 1 ProdKey FROM Product WHERE ProdName LIKE @n AND isDeleted = 0`,
        { n: { type: sql.NVarChar, value: `%${prodName}%` } }
      );
      if (!r.recordset[0]) return res.status(404).json({ success: false, error: '품목 없음' });
      pk = r.recordset[0].ProdKey;
    }
    const stockQty = parseFloat(qty);
    const signedDelta = delta !== undefined ? parseFloat(delta) : -stockQty;
    if (!Number.isFinite(signedDelta) || Math.abs(signedDelta) < 0.0001) {
      return res.status(400).json({ success: false, error: '0이 아닌 signed delta가 필요합니다.' });
    }

    // 재고조정은 현재 운영 차수 기준 — NN-NN→2025 레거시 규칙 금지 (StockHistory 연도 오염 방지)
    const orderYear = selected.orderYear;
    const uid = req.user?.userId || 'admin';
    const beforeResult = await query(
      `SELECT ISNULL(Stock,0) AS Stock FROM Product WHERE ProdKey=@pk`,
      { pk: { type: sql.Int, value: pk } }
    );
    const before = Number(beforeResult.recordset[0]?.Stock || 0);
    const after = Math.round((before + signedDelta) * 1000) / 1000;
    if (after < 0) return res.status(409).json({ success: false, code: 'NEGATIVE_AFTER_VALUE', error: '조정 후 재고는 음수가 될 수 없습니다.' });

    await withTransaction(async (tQuery) => {
      await tQuery(
        `INSERT INTO StockHistory
           (ChangeDtm, OrderYear, OrderWeek, ChangeID, ChangeType, ColumName,
            BeforeValue, AfterValue, Descr, ProdKey)
         VALUES (GETDATE(), @year, @week, @uid, @type, N'재고수량',
           @before, @after, @descr, @pk)`,
        {
          year:   { type: sql.NVarChar, value: orderYear },
          week:   { type: sql.NVarChar, value: week || '' },
          uid:    { type: sql.NVarChar, value: uid },
          type:   { type: sql.NVarChar, value: adjustType },
          pk:     { type: sql.Int,      value: pk },
          before: { type: sql.Float,    value: before },
          after:  { type: sql.Float,    value: after },
          descr:  { type: sql.NVarChar, value: descr || '' },
        }
      );

      // nenova.exe FormStockAdd.btnSave_Click 과 동일 순서 — usp_StockCalculation은 ProductStock
      // (차수별 스냅샷)만 갱신하고 Product.Stock은 절대 건드리지 않는다(SP 본문 직접 확인, 2026-07-14).
      // 이 UPDATE가 빠지면 exe 재고조정 화면 "현재고"·확정검증(negativeLiveCount)이 웹 조정을 못 보고
      // 옛 값 기준으로 계속 동작한다 — 이 파일 최초 작성 시점부터 있던 사전 존재 버그였음.
      await tQuery(
        `UPDATE Product SET Stock = ROUND(@after, 2) WHERE ProdKey = @pk`,
        { after: { type: sql.Float, value: after }, pk: { type: sql.Int, value: pk } }
      );

      await tQuery(
        stockCalculationSql(),
        {
          year: { type: sql.NVarChar, value: orderYear },
          week: { type: sql.NVarChar, value: week || '' },
          uid:  { type: sql.NVarChar, value: uid },
          pk:   { type: sql.Int, value: pk },
        }
      );
    });

    return res.status(200).json({
      success: true,
      source: 'real_db',
      message: `재고 조정 등록 완료 — ${adjustType}: ${signedDelta > 0 ? '+' : ''}${signedDelta}`,
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}

function stockCalculationSql() {
  return `IF EXISTS (
            SELECT 1 FROM sys.parameters
             WHERE object_id = OBJECT_ID(N'dbo.usp_StockCalculation')
               AND name = N'@oResult'
          )
          BEGIN
            DECLARE @r INT, @m NVARCHAR(MAX);
            EXEC dbo.usp_StockCalculation
                 @OrderYear = @year,
                 @OrderWeek = @week,
                 @ProdKey   = @pk,
                 @iUserID   = @uid,
                 @oResult   = @r OUTPUT,
                 @oMessage  = @m OUTPUT;
            SELECT @r AS result, @m AS message;
          END
          ELSE
          BEGIN
            EXEC dbo.usp_StockCalculation
                 @OrderYear = @year,
                 @OrderWeek = @week,
                 @ProdKey   = @pk,
                 @iUserID   = @uid;
          END`;
}
