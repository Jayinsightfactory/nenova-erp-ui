// pages/api/stock/adjust-batch.js
// POST { week, orderYear, edits: [{ prodKey, afterStock, descr? }] }
//   여러 품목의 재고를 목표값(afterStock)으로 한 번에 조정 — 각 건 StockHistory INSERT + usp_StockCalculation.
//   확정된 차수(ShipmentMaster/ShipmentDetail/StockMaster isFix=1)는 기본 차단 —
//   프론트는 lib/fixCycleClient.js 의 runEditWithFixCycle 로 확정해제→적용→재확정 사이클을 태운다.
//   (docs/CONFIRMED_WEEK_EDIT_SAFETY_CHECKLIST.md C-1/C-3)

import { query, withTransaction, sql } from '../../../lib/db';
import { withAuth } from '../../../lib/auth';
import { requireOrderYear } from '../../../lib/orderUtils';
import { resolveStockTargetAdjustment } from '../../../lib/stockTargetAdjustment';

async function isWeekFixed(orderYear, orderWeek) {
  const r = await query(
    `SELECT TOP 1 1 AS x FROM (
       SELECT 1 AS x FROM ShipmentMaster WHERE OrderYear=@yr AND OrderWeek=@wk AND isDeleted=0 AND ISNULL(isFix,0)=1
       UNION ALL
       SELECT 1 AS x FROM ShipmentMaster sm JOIN ShipmentDetail sd ON sd.ShipmentKey=sm.ShipmentKey
        WHERE sm.OrderYear=@yr AND sm.OrderWeek=@wk AND sm.isDeleted=0 AND ISNULL(sd.isFix,0)=1
       UNION ALL
       SELECT 1 AS x FROM StockMaster WHERE OrderYear=@yr AND OrderWeek=@wk AND ISNULL(isFix,0)=1
     ) t`,
    {
      yr: { type: sql.NVarChar, value: orderYear },
      wk: { type: sql.NVarChar, value: orderWeek },
    }
  );
  return r.recordset.length > 0;
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
                 @OrderYear = @year, @OrderWeek = @week, @ProdKey = @pk, @iUserID = @uid,
                 @oResult = @r OUTPUT, @oMessage = @m OUTPUT;
            IF ISNULL(@r,0) <> 0
            BEGIN
              SET @m = COALESCE(NULLIF(@m,N''),N'재고 재계산 실패');
              THROW 51000, @m, 1;
            END
            SELECT @r AS result, @m AS message;
          END
          ELSE
          BEGIN
            EXEC dbo.usp_StockCalculation
                 @OrderYear = @year, @OrderWeek = @week, @ProdKey = @pk, @iUserID = @uid;
          END`;
}

export default withAuth(async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'POST만 지원' });

  const { week: rawWeek, orderYear: requestedYear, year, edits } = req.body || {};
  if (!rawWeek) return res.status(400).json({ success: false, error: 'week 필요' });
  if (!Array.isArray(edits) || edits.length === 0) {
    return res.status(400).json({ success: false, error: 'edits 필요' });
  }

  let orderYear;
  let week;
  try {
    ({ orderYear, orderWeek: week } = requireOrderYear(rawWeek, requestedYear || year || ''));
  } catch (error) {
    return res.status(400).json({ success: false, code: error.code, error: error.message });
  }
  const uid = req.user?.userId || 'admin';

  try {
    if (await isWeekFixed(orderYear, week)) {
      return res.status(409).json({
        success: false,
        code: 'WEEK_FIXED',
        error: `[${week}] 확정된 차수입니다. 먼저 확정을 해제한 뒤 재고를 수정하세요.`,
      });
    }

    const normalizedEdits = [];
    const seenProdKeys = new Set();
    for (const e of edits) {
      const pk = Number(e.prodKey);
      const after = Number(e.afterStock);
      if (!Number.isFinite(pk) || !Number.isFinite(after)) {
        return res.status(400).json({ success: false, error: '잘못된 재고 수정값이 포함되어 있습니다.' });
      }
      if (seenProdKeys.has(pk)) {
        return res.status(400).json({ success: false, error: `중복 품목이 포함되어 있습니다. (${pk})` });
      }
      seenProdKeys.add(pk);
      normalizedEdits.push({ ...e, pk, after });
    }

    const results = await withTransaction(async (tQuery) => {
      const appliedResults = [];
      for (const e of normalizedEdits) {
          const liveResult = await tQuery(
            `SELECT ISNULL(Stock,0) AS Stock
               FROM Product WITH (UPDLOCK, HOLDLOCK)
              WHERE ProdKey=@pk AND ISNULL(isDeleted,0)=0`,
            { pk: { type: sql.Int, value: e.pk } }
          );
          if (!liveResult.recordset[0]) throw new Error(`품목을 찾을 수 없습니다. (${e.pk})`);

          // usp_StockCalculation과 같은 원천으로 선택 차수의 현재 재고를 계산한다.
          // Product.Stock은 최신 라이브 재고이므로 과거 차수 목표값과 직접 비교하면 안 된다.
          const selectedResult = await tQuery(
            `SELECT
               ISNULL((
                 SELECT TOP 1 ps.Stock
                   FROM StockMaster sm
                   JOIN ProductStock ps ON ps.StockKey=sm.StockKey AND ps.ProdKey=@pk
                  WHERE sm.OrderYear=@year AND sm.OrderWeek < @week
                  ORDER BY sm.OrderWeek DESC, sm.StockKey DESC
               ),0)
               + ISNULL((
                 SELECT SUM(wd.OutQuantity)
                   FROM WarehouseDetail wd
                   JOIN WarehouseMaster wm ON wm.WarehouseKey=wd.WarehouseKey
                  WHERE wd.ProdKey=@pk AND wm.OrderYear=@year AND wm.OrderWeek=@week
                    AND ISNULL(wm.isDeleted,0)=0
               ),0)
               - ISNULL((
                 SELECT SUM(sd.OutQuantity)
                   FROM ShipmentDetail sd
                   JOIN ShipmentMaster sm ON sm.ShipmentKey=sd.ShipmentKey
                  WHERE sd.ProdKey=@pk AND sm.OrderYear=@year AND sm.OrderWeek=@week
                    AND ISNULL(sm.isDeleted,0)=0 AND ISNULL(sd.isFix,0)=1
               ),0)
               + ISNULL((
                 SELECT SUM(ISNULL(sh.AfterValue,0)-ISNULL(sh.BeforeValue,0))
                   FROM StockHistory sh
                  WHERE sh.ProdKey=@pk AND sh.OrderYear=@year AND sh.OrderWeek=@week
               ),0) AS SelectedStock`,
            {
              year: { type: sql.NVarChar, value: orderYear },
              week: { type: sql.NVarChar, value: week },
              pk: { type: sql.Int, value: e.pk },
            }
          );
          const plan = resolveStockTargetAdjustment({
            liveStock: liveResult.recordset[0].Stock,
            selectedStock: selectedResult.recordset[0]?.SelectedStock || 0,
            targetStock: e.after,
          });
          if (Math.abs(plan.delta) < 0.0001) {
            appliedResults.push({ prodKey: e.pk, ok: true, changed: false, ...plan });
            continue;
          }

          await tQuery(
            `INSERT INTO StockHistory
               (ChangeDtm, OrderYear, OrderWeek, ChangeID, ChangeType, ColumName, BeforeValue, AfterValue, Descr, ProdKey)
             VALUES (GETDATE(), @year, @week, @uid, N'재고조정', N'재고수량', @before, @after, @descr, @pk)`,
            {
              year:   { type: sql.NVarChar, value: orderYear },
              week:   { type: sql.NVarChar, value: week },
              uid:    { type: sql.NVarChar, value: uid },
              pk:     { type: sql.Int,      value: e.pk },
              before: { type: sql.Float,    value: plan.liveBefore },
              after:  { type: sql.Float,    value: plan.liveAfter },
              descr:  { type: sql.NVarChar, value: e.descr || '재고관리 일괄수정' },
            }
          );
          // nenova.exe FormStockAdd.btnSave_Click 과 동일 순서 — usp_StockCalculation은
          // ProductStock(차수별 스냅샷)만 갱신하고 Product.Stock은 절대 건드리지 않는다(SP 본문 확인).
          // 이 UPDATE를 빠뜨리면 exe 재고조정 화면 "현재고"·확정검증(fix-status.js negativeLiveCount)이
          // 웹에서 바꾼 값을 못 보고 옛 Product.Stock 기준으로 계속 동작한다.
          await tQuery(
            `UPDATE Product SET Stock = ROUND(@after, 2) WHERE ProdKey = @pk`,
            { after: { type: sql.Float, value: plan.liveAfter }, pk: { type: sql.Int, value: e.pk } }
          );
          await tQuery(stockCalculationSql(), {
            year: { type: sql.NVarChar, value: orderYear },
            week: { type: sql.NVarChar, value: week },
            uid:  { type: sql.NVarChar, value: uid },
            pk:   { type: sql.Int, value: e.pk },
          });
          appliedResults.push({ prodKey: e.pk, ok: true, changed: true, ...plan });
      }
      return appliedResults;
    });

    return res.status(200).json({
      success: true,
      message: `재고 일괄수정 — 성공 ${results.length}건`,
      results,
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});
