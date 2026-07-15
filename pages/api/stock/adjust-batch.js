// pages/api/stock/adjust-batch.js
// POST { week, edits: [{ prodKey, afterStock, descr? }], force? }
//   여러 품목의 재고를 목표값(afterStock)으로 한 번에 조정 — 각 건 StockHistory INSERT + usp_StockCalculation.
//   확정된 차수(ShipmentMaster/ShipmentDetail/StockMaster isFix=1)는 기본 차단 —
//   프론트는 lib/fixCycleClient.js 의 runEditWithFixCycle 로 확정해제→적용(force=true)→재확정 사이클을 태울 것.
//   (docs/CONFIRMED_WEEK_EDIT_SAFETY_CHECKLIST.md C-1/C-3)

import { query, withTransaction, sql } from '../../../lib/db';
import { withAuth } from '../../../lib/auth';
import { normalizeOrderWeek, resolveActiveOrderYear } from '../../../lib/orderUtils';

async function isWeekFixed(orderWeek) {
  const r = await query(
    `SELECT TOP 1 1 AS x FROM (
       SELECT 1 AS x FROM ShipmentMaster WHERE OrderWeek=@wk AND isDeleted=0 AND ISNULL(isFix,0)=1
       UNION ALL
       SELECT 1 AS x FROM ShipmentMaster sm JOIN ShipmentDetail sd ON sd.ShipmentKey=sm.ShipmentKey
        WHERE sm.OrderWeek=@wk AND sm.isDeleted=0 AND ISNULL(sd.isFix,0)=1
       UNION ALL
       SELECT 1 AS x FROM StockMaster WHERE OrderWeek=@wk AND ISNULL(isFix,0)=1
     ) t`,
    { wk: { type: sql.NVarChar, value: orderWeek } }
  );
  return r.recordset.length > 0;
}

async function resolveOrderYear(week) {
  const r = await query(
    `SELECT TOP 1 OrderYear FROM StockMaster WHERE OrderWeek=@week AND OrderYear IS NOT NULL ORDER BY OrderYear DESC`,
    { week: { type: sql.NVarChar, value: week || '' } }
  );
  return String(r.recordset[0]?.OrderYear || new Date().getFullYear());
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

  const { week: rawWeek, edits, force } = req.body || {};
  if (!rawWeek) return res.status(400).json({ success: false, error: 'week 필요' });
  if (!Array.isArray(edits) || edits.length === 0) {
    return res.status(400).json({ success: false, error: 'edits 필요' });
  }

  const week = normalizeOrderWeek(rawWeek);
  const uid = req.user?.userId || 'admin';

  try {
    if (!force && await isWeekFixed(week)) {
      return res.status(409).json({
        success: false,
        code: 'WEEK_FIXED',
        error: `[${week}] 확정된 차수입니다. 먼저 확정을 해제한 뒤 재고를 수정하세요.`,
      });
    }

    const orderYear = resolveActiveOrderYear(rawWeek, '', await resolveOrderYear(week));
    const results = [];
    const errors = [];

    for (const e of edits) {
      const pk = Number(e.prodKey);
      const after = Number(e.afterStock);
      if (!Number.isFinite(pk) || !Number.isFinite(after)) {
        errors.push({ prodKey: e.prodKey, message: '잘못된 값' });
        continue;
      }
      try {
        const applied = await withTransaction(async (tQuery) => {
          const beforeResult = await tQuery(
            `SELECT ISNULL(Stock,0) AS Stock FROM Product WHERE ProdKey=@pk`,
            { pk: { type: sql.Int, value: pk } }
          );
          const before = Number(beforeResult.recordset[0]?.Stock || 0);
          if (Math.abs(after - before) < 0.0001) return false;

          await tQuery(
            `INSERT INTO StockHistory
               (ChangeDtm, OrderYear, OrderWeek, ChangeID, ChangeType, ColumName, BeforeValue, AfterValue, Descr, ProdKey)
             VALUES (GETDATE(), @year, @week, @uid, N'재고조정', N'재고수량', @before, @after, @descr, @pk)`,
            {
              year:   { type: sql.NVarChar, value: orderYear },
              week:   { type: sql.NVarChar, value: week },
              uid:    { type: sql.NVarChar, value: uid },
              pk:     { type: sql.Int,      value: pk },
              before: { type: sql.Float,    value: before },
              after:  { type: sql.Float,    value: after },
              descr:  { type: sql.NVarChar, value: e.descr || '재고관리 일괄수정' },
            }
          );
          // nenova.exe FormStockAdd.btnSave_Click 과 동일 순서 — usp_StockCalculation은
          // ProductStock(차수별 스냅샷)만 갱신하고 Product.Stock은 절대 건드리지 않는다(SP 본문 확인).
          // 이 UPDATE를 빠뜨리면 exe 재고조정 화면 "현재고"·확정검증(fix-status.js negativeLiveCount)이
          // 웹에서 바꾼 값을 못 보고 옛 Product.Stock 기준으로 계속 동작한다.
          await tQuery(
            `UPDATE Product SET Stock = ROUND(@after, 2) WHERE ProdKey = @pk`,
            { after: { type: sql.Float, value: after }, pk: { type: sql.Int, value: pk } }
          );
          await tQuery(stockCalculationSql(), {
            year: { type: sql.NVarChar, value: orderYear },
            week: { type: sql.NVarChar, value: week },
            uid:  { type: sql.NVarChar, value: uid },
            pk:   { type: sql.Int, value: pk },
          });
          return true;
        });
        results.push({ prodKey: pk, ok: true, changed: applied });
      } catch (err) {
        errors.push({ prodKey: pk, message: err.message });
      }
    }

    return res.status(errors.length ? 207 : 200).json({
      success: errors.length === 0,
      message: `재고 일괄수정 — 성공 ${results.length}건${errors.length ? ` / 실패 ${errors.length}건` : ''}`,
      results,
      errors,
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});
