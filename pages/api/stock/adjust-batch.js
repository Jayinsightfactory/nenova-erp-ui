// pages/api/stock/adjust-batch.js
// POST { week, orderYear, edits: [{ prodKey, afterStock, descr? }] }
//   여러 품목의 재고를 목표값(afterStock)으로 한 번에 조정 — 각 건 StockHistory INSERT + usp_StockCalculation.
//   확정된 차수(ShipmentMaster/ShipmentDetail/StockMaster isFix=1)는 기본 차단 —
//   프론트는 lib/fixCycleClient.js 의 runEditWithFixCycle 로 확정해제→적용→재확정 사이클을 태운다.
//   (docs/CONFIRMED_WEEK_EDIT_SAFETY_CHECKLIST.md C-1/C-3)

import { query, withTransaction, sql } from '../../../lib/db';
import { withAuth } from '../../../lib/auth';
import { requireOrderYear } from '../../../lib/orderUtils';
import { resolveLaterSnapshotPreservation, resolveStockTargetAdjustment } from '../../../lib/stockTargetAdjustment';

async function loadFixedEditedProdKeys(orderYear, orderWeek, prodKeys) {
  const keys = [...new Set((prodKeys || []).map(Number).filter(Number.isFinite))];
  if (!keys.length) return [];
  const values = keys.map((_, i) => `(@pk${i})`).join(',');
  const params = {
    yr: { type: sql.NVarChar, value: orderYear },
    wk: { type: sql.NVarChar, value: orderWeek },
  };
  keys.forEach((pk, i) => { params[`pk${i}`] = { type: sql.Int, value: pk }; });
  const r = await query(
    `WITH edited(ProdKey) AS (SELECT v.ProdKey FROM (VALUES ${values}) v(ProdKey))
     SELECT DISTINCT e.ProdKey
       FROM edited e
       JOIN ShipmentDetail sd ON sd.ProdKey=e.ProdKey AND ISNULL(sd.isFix,0)=1
       JOIN ShipmentMaster sm ON sm.ShipmentKey=sd.ShipmentKey
      WHERE sm.OrderYear=@yr AND sm.OrderWeek=@wk AND ISNULL(sm.isDeleted,0)=0`,
    params
  );
  return r.recordset.map(row => Number(row.ProdKey));
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
    const requestedProdKeys = edits.map(e => Number(e?.prodKey)).filter(Number.isFinite);
    const fixedEditedProdKeys = await loadFixedEditedProdKeys(orderYear, week, requestedProdKeys);
    if (fixedEditedProdKeys.length > 0) {
      return res.status(409).json({
        success: false,
        code: 'WEEK_FIXED',
        error: `[${week}] 수정 대상 품목이 아직 확정 상태입니다. 먼저 해당 카테고리 확정을 해제하세요. (${fixedEditedProdKeys.join(', ')})`,
      });
    }

    const normalizedEdits = [];
    const seenProdKeys = new Set();
    for (const e of edits) {
      const pk = Number(e.prodKey);
      const after = Number(e.afterStock);
      const expectedSelectedStock = Number(e.expectedSelectedStock);
      if (!Number.isFinite(pk) || !Number.isFinite(after) || !Number.isFinite(expectedSelectedStock)) {
        return res.status(400).json({ success: false, error: '잘못된 재고 수정값이 포함되어 있습니다.' });
      }
      if (seenProdKeys.has(pk)) {
        return res.status(400).json({ success: false, error: `중복 품목이 포함되어 있습니다. (${pk})` });
      }
      seenProdKeys.add(pk);
      normalizedEdits.push({ ...e, pk, after, expectedSelectedStock });
    }

    const results = await withTransaction(async (tQuery) => {
      const appliedResults = [];
      const nextResult = await tQuery(
        `SELECT TOP 1 OrderYear, OrderWeek
           FROM StockMaster WITH (UPDLOCK, HOLDLOCK)
          WHERE OrderYear > @year OR (OrderYear=@year AND OrderWeek>@week)
          ORDER BY OrderYear, OrderWeek`,
        { year: { type: sql.NVarChar, value: orderYear }, week: { type: sql.NVarChar, value: week } },
      );
      const nextWeek = nextResult.recordset[0]
        ? { orderYear: nextResult.recordset[0].OrderYear, orderWeek: nextResult.recordset[0].OrderWeek }
        : null;
      for (const e of normalizedEdits) {
          const liveResult = await tQuery(
            `SELECT ISNULL(Stock,0) AS Stock
               FROM Product WITH (UPDLOCK, HOLDLOCK)
              WHERE ProdKey=@pk AND ISNULL(isDeleted,0)=0`,
            { pk: { type: sql.Int, value: e.pk } }
          );
          if (!liveResult.recordset[0]) throw new Error(`품목을 찾을 수 없습니다. (${e.pk})`);

          // 화면이 확정해제 전에 계산한 선택 차수 재고를 기준으로 delta를 고정한다.
          // 자동 확정해제 후 서버에서 다시 계산하면 확정출고가 빠져 delta가 왜곡된다.
          const plan = resolveStockTargetAdjustment({
            liveStock: liveResult.recordset[0].Stock,
            selectedStock: e.expectedSelectedStock,
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
          // 과거 스냅샷만 수정할 때 Product.Stock delta가 이후 모든 차수로 번지는 것을
          // 다음 실제 StockMaster 경계에서 반대 delta로 상쇄한다. 선택 차수는 바뀌고
          // 다음 차수 이후 스냅샷과 현재 Product.Stock은 수정 전 값을 보존한다.
          const preservation = resolveLaterSnapshotPreservation({
            liveStock: plan.liveBefore,
            delta: plan.delta,
            nextWeek,
          });
          if (preservation) {
            await tQuery(
              `INSERT INTO StockHistory
                 (ChangeDtm, OrderYear, OrderWeek, ChangeID, ChangeType, ColumName, BeforeValue, AfterValue, Descr, ProdKey)
               VALUES (GETDATE(), @year, @week, @uid, N'재고조정', N'재고수량', @before, @after,
                       N'과거차수 수정 후속스냅샷 보존', @pk)`,
              {
                year: { type: sql.NVarChar, value: preservation.orderYear },
                week: { type: sql.NVarChar, value: preservation.orderWeek },
                uid: { type: sql.NVarChar, value: uid },
                pk: { type: sql.Int, value: e.pk },
                before: { type: sql.Float, value: preservation.liveBefore },
                after: { type: sql.Float, value: preservation.liveAfter },
              },
            );
            await tQuery(
              `UPDATE Product SET Stock=ROUND(@after,2) WHERE ProdKey=@pk`,
              { after: { type: sql.Float, value: preservation.liveAfter }, pk: { type: sql.Int, value: e.pk } },
            );
            await tQuery(stockCalculationSql(), {
              year: { type: sql.NVarChar, value: preservation.orderYear },
              week: { type: sql.NVarChar, value: preservation.orderWeek },
              uid: { type: sql.NVarChar, value: uid },
              pk: { type: sql.Int, value: e.pk },
            });
          }
          appliedResults.push({ prodKey: e.pk, ok: true, changed: true, preservation, ...plan });
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
