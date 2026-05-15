// pages/api/shipment/fix-status.js
// GET  : 차수별 출고 확정 현황 + 확정 시 음수재고 예상 품목
// POST : 선택 구간 확정취소 (높은 차수부터 낮은 차수 순서)

import { query, sql } from '../../../lib/db';
import { withAuth } from '../../../lib/auth';

function parseWeek(input) {
  const raw = String(input || '').trim();
  const full = raw.match(/^(\d{4})-(\d{2}-\d{2})$/);
  if (full) return { year: full[1], week: full[2], key: full[1] + full[2].replace('-', '') };
  const short = raw.match(/^(\d{2}-\d{2})$/);
  const year = String(new Date().getFullYear());
  if (short) return { year, week: short[1], key: year + short[1].replace('-', '') };
  return null;
}

function normalizeRange(fromWeek, toWeek) {
  const from = parseWeek(fromWeek);
  const to = parseWeek(toWeek || fromWeek);
  if (!from || !to) throw new Error('차수 형식은 15-01 또는 2026-15-01 이어야 합니다.');
  return from.key <= to.key ? { from, to } : { from: to, to: from };
}

async function loadWeekStatus(from, to) {
  return await query(
    `WITH week_set AS (
       SELECT DISTINCT
              ISNULL(CAST(OrderYear AS NVARCHAR(4)), @defaultYear) AS OrderYear,
              OrderWeek,
              ISNULL(CAST(OrderYear AS NVARCHAR(4)), @defaultYear) + REPLACE(OrderWeek, '-', '') AS WeekKey
       FROM ShipmentMaster
       WHERE isDeleted = 0
       UNION
       SELECT DISTINCT
              ISNULL(CAST(OrderYear AS NVARCHAR(4)), @defaultYear) AS OrderYear,
              OrderWeek,
              ISNULL(CAST(OrderYear AS NVARCHAR(4)), @defaultYear) + REPLACE(OrderWeek, '-', '') AS WeekKey
       FROM StockMaster
       WHERE ISNULL(isDeleted, 0) = 0
     ),
     ship AS (
       SELECT
         ISNULL(CAST(sm.OrderYear AS NVARCHAR(4)), @defaultYear) + REPLACE(sm.OrderWeek, '-', '') AS WeekKey,
         COUNT(DISTINCT sm.ShipmentKey) AS masterCount,
         SUM(CASE WHEN ISNULL(sm.isFix, 0) = 1 THEN 1 ELSE 0 END) AS fixedMasterCount,
         COUNT(sd.SdetailKey) AS detailCount,
         SUM(CASE WHEN ISNULL(sd.isFix, 0) = 1 THEN 1 ELSE 0 END) AS fixedDetailCount,
         SUM(CASE WHEN ISNULL(sd.isFix, 0) = 0 AND ISNULL(sd.OutQuantity, 0) > 0 THEN 1 ELSE 0 END) AS unfixedDetailCount,
         COUNT(DISTINCT p.CountryFlower) AS categoryCount,
         COUNT(DISTINCT CASE WHEN ISNULL(sd.isFix, 0) = 1 THEN p.CountryFlower END) AS fixedCategoryCount
       FROM ShipmentMaster sm
       LEFT JOIN ShipmentDetail sd ON sd.ShipmentKey = sm.ShipmentKey
       LEFT JOIN Product p ON p.ProdKey = sd.ProdKey
       WHERE sm.isDeleted = 0
       GROUP BY ISNULL(CAST(sm.OrderYear AS NVARCHAR(4)), @defaultYear) + REPLACE(sm.OrderWeek, '-', '')
     ),
     stock AS (
       SELECT
         ISNULL(CAST(OrderYear AS NVARCHAR(4)), @defaultYear) + REPLACE(OrderWeek, '-', '') AS WeekKey,
         MAX(CASE WHEN ISNULL(isFix, 0) = 1 THEN 1 ELSE 0 END) AS stockFixed,
         COUNT(*) AS stockMasterCount
       FROM StockMaster
       WHERE ISNULL(isDeleted, 0) = 0
       GROUP BY ISNULL(CAST(OrderYear AS NVARCHAR(4)), @defaultYear) + REPLACE(OrderWeek, '-', '')
     )
     SELECT
       w.OrderYear,
       w.OrderWeek,
       w.WeekKey,
       ISNULL(ship.masterCount, 0) AS masterCount,
       ISNULL(ship.fixedMasterCount, 0) AS fixedMasterCount,
       ISNULL(ship.detailCount, 0) AS detailCount,
       ISNULL(ship.fixedDetailCount, 0) AS fixedDetailCount,
       ISNULL(ship.unfixedDetailCount, 0) AS unfixedDetailCount,
       ISNULL(ship.categoryCount, 0) AS categoryCount,
       ISNULL(ship.fixedCategoryCount, 0) AS fixedCategoryCount,
       ISNULL(stock.stockFixed, 0) AS stockFixed,
       ISNULL(stock.stockMasterCount, 0) AS stockMasterCount
     FROM week_set w
     LEFT JOIN ship ON ship.WeekKey = w.WeekKey
     LEFT JOIN stock ON stock.WeekKey = w.WeekKey
     WHERE w.WeekKey BETWEEN @fromKey AND @toKey
     ORDER BY w.WeekKey DESC`,
    {
      defaultYear: { type: sql.NVarChar, value: from.year },
      fromKey:     { type: sql.NVarChar, value: from.key },
      toKey:       { type: sql.NVarChar, value: to.key },
    }
  );
}

async function loadNegativeRows(from, to) {
  return await query(
    `WITH week_set AS (
       SELECT DISTINCT
              ISNULL(CAST(OrderYear AS NVARCHAR(4)), @defaultYear) AS OrderYear,
              OrderWeek,
              ISNULL(CAST(OrderYear AS NVARCHAR(4)), @defaultYear) + REPLACE(OrderWeek, '-', '') AS WeekKey
       FROM ShipmentMaster
       WHERE isDeleted = 0
     ),
     out_qty AS (
       SELECT
         ISNULL(CAST(sm.OrderYear AS NVARCHAR(4)), @defaultYear) + REPLACE(sm.OrderWeek, '-', '') AS WeekKey,
         sm.OrderWeek,
         sd.ProdKey,
         SUM(ISNULL(sd.OutQuantity, 0)) AS outQty
       FROM ShipmentMaster sm
       JOIN ShipmentDetail sd ON sd.ShipmentKey = sm.ShipmentKey
       WHERE sm.isDeleted = 0 AND ISNULL(sd.OutQuantity, 0) > 0
       GROUP BY ISNULL(CAST(sm.OrderYear AS NVARCHAR(4)), @defaultYear) + REPLACE(sm.OrderWeek, '-', ''), sm.OrderWeek, sd.ProdKey
     ),
     in_qty AS (
       SELECT
         ISNULL(CAST(wm.OrderYear AS NVARCHAR(4)), @defaultYear) + REPLACE(wm.OrderWeek, '-', '') AS WeekKey,
         wd.ProdKey,
         SUM(ISNULL(wd.OutQuantity, 0)) AS inQty
       FROM WarehouseMaster wm
       JOIN WarehouseDetail wd ON wd.WarehouseKey = wm.WarehouseKey
       WHERE wm.isDeleted = 0
       GROUP BY ISNULL(CAST(wm.OrderYear AS NVARCHAR(4)), @defaultYear) + REPLACE(wm.OrderWeek, '-', ''), wd.ProdKey
     )
     SELECT TOP 500
       w.OrderYear,
       w.OrderWeek,
       oq.ProdKey,
       p.ProdName,
       p.FlowerName,
       p.CounName,
       ISNULL(prev.prevStock, 0) AS prevStock,
       ISNULL(iq.inQty, 0) AS inQty,
       ISNULL(oq.outQty, 0) AS outQty,
       ISNULL(prev.prevStock, 0) + ISNULL(iq.inQty, 0) - ISNULL(oq.outQty, 0) AS remain
     FROM out_qty oq
     JOIN week_set w ON w.WeekKey = oq.WeekKey
     JOIN Product p ON p.ProdKey = oq.ProdKey AND p.isDeleted = 0
     LEFT JOIN in_qty iq ON iq.WeekKey = oq.WeekKey AND iq.ProdKey = oq.ProdKey
     OUTER APPLY (
       SELECT TOP 1 ps.Stock AS prevStock
       FROM ProductStock ps
       JOIN StockMaster sm2 ON sm2.StockKey = ps.StockKey
       WHERE ps.ProdKey = oq.ProdKey
         AND ISNULL(CAST(sm2.OrderYear AS NVARCHAR(4)), @defaultYear) + REPLACE(sm2.OrderWeek, '-', '') < oq.WeekKey
       ORDER BY ISNULL(CAST(sm2.OrderYear AS NVARCHAR(4)), @defaultYear) + REPLACE(sm2.OrderWeek, '-', '') DESC
     ) prev
     WHERE oq.WeekKey BETWEEN @fromKey AND @toKey
       AND ISNULL(prev.prevStock, 0) + ISNULL(iq.inQty, 0) - ISNULL(oq.outQty, 0) < 0
     ORDER BY w.WeekKey DESC, p.FlowerName, p.ProdName`,
    {
      defaultYear: { type: sql.NVarChar, value: from.year },
      fromKey:     { type: sql.NVarChar, value: from.key },
      toKey:       { type: sql.NVarChar, value: to.key },
    }
  );
}

async function loadUnfixTargets(from, to) {
  return await query(
    `SELECT
       ISNULL(CAST(sm.OrderYear AS NVARCHAR(4)), @defaultYear) AS OrderYear,
       sm.OrderWeek,
       ISNULL(CAST(sm.OrderYear AS NVARCHAR(4)), @defaultYear) + REPLACE(sm.OrderWeek, '-', '') AS WeekKey,
       p.CountryFlower
     FROM ShipmentMaster sm
     JOIN ShipmentDetail sd ON sd.ShipmentKey = sm.ShipmentKey
     JOIN Product p ON p.ProdKey = sd.ProdKey AND p.isDeleted = 0
     WHERE sm.isDeleted = 0
       AND ISNULL(sd.isFix, 0) = 1
       AND p.CountryFlower IS NOT NULL
       AND LTRIM(RTRIM(p.CountryFlower)) <> ''
       AND ISNULL(CAST(sm.OrderYear AS NVARCHAR(4)), @defaultYear) + REPLACE(sm.OrderWeek, '-', '') BETWEEN @fromKey AND @toKey
     GROUP BY ISNULL(CAST(sm.OrderYear AS NVARCHAR(4)), @defaultYear), sm.OrderWeek, p.CountryFlower
     ORDER BY WeekKey DESC, p.CountryFlower`,
    {
      defaultYear: { type: sql.NVarChar, value: from.year },
      fromKey:     { type: sql.NVarChar, value: from.key },
      toKey:       { type: sql.NVarChar, value: to.key },
    }
  );
}

async function loadLaterFixed(to) {
  return await query(
    `SELECT TOP 10
       ISNULL(CAST(sm.OrderYear AS NVARCHAR(4)), @defaultYear) AS OrderYear,
       sm.OrderWeek,
       ISNULL(CAST(sm.OrderYear AS NVARCHAR(4)), @defaultYear) + REPLACE(sm.OrderWeek, '-', '') AS WeekKey
     FROM ShipmentMaster sm
     JOIN ShipmentDetail sd ON sd.ShipmentKey = sm.ShipmentKey
     WHERE sm.isDeleted = 0
       AND ISNULL(sd.isFix, 0) = 1
       AND ISNULL(CAST(sm.OrderYear AS NVARCHAR(4)), @defaultYear) + REPLACE(sm.OrderWeek, '-', '') > @toKey
     GROUP BY ISNULL(CAST(sm.OrderYear AS NVARCHAR(4)), @defaultYear), sm.OrderWeek
     ORDER BY WeekKey ASC`,
    {
      defaultYear: { type: sql.NVarChar, value: to.year },
      toKey:       { type: sql.NVarChar, value: to.key },
    }
  );
}

export default withAuth(async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const { fromWeek, toWeek } = req.query;
      const { from, to } = normalizeRange(fromWeek, toWeek);
      const [statusRes, negativeRes] = await Promise.all([
        loadWeekStatus(from, to),
        loadNegativeRows(from, to),
      ]);

      const negativeByWeek = {};
      for (const row of negativeRes.recordset) {
        negativeByWeek[row.WeekKey] = (negativeByWeek[row.WeekKey] || 0) + 1;
      }

      const weeks = statusRes.recordset.map(w => {
        const detailCount = Number(w.detailCount) || 0;
        const fixedDetailCount = Number(w.fixedDetailCount) || 0;
        const unfixedDetailCount = Number(w.unfixedDetailCount) || 0;
        const negativeCount = negativeByWeek[w.WeekKey] || 0;
        let status = 'NO_SHIPMENT';
        if (detailCount > 0 && unfixedDetailCount === 0) status = 'FIXED';
        else if (fixedDetailCount > 0 && unfixedDetailCount > 0) status = 'PARTIAL';
        else if (unfixedDetailCount > 0) status = 'UNFIXED';
        return { ...w, status, negativeCount };
      });

      return res.status(200).json({
        success: true,
        fromWeek: `${from.year}-${from.week}`,
        toWeek: `${to.year}-${to.week}`,
        weeks,
        negative: negativeRes.recordset,
      });
    }

    if (req.method === 'POST') {
      const { fromWeek, toWeek, force } = req.body || {};
      const { from, to } = normalizeRange(fromWeek, toWeek);
      const later = await loadLaterFixed(to);
      if (later.recordset.length > 0 && !force) {
        return res.status(409).json({
          success: false,
          warning: 'LATER_FIXED_EXISTS',
          laterWeeks: later.recordset,
          error: `선택 구간 이후에 이미 확정된 차수가 있습니다. (${later.recordset.map(r => `${r.OrderYear}-${r.OrderWeek}`).join(', ')})`,
        });
      }

      const targetRes = await loadUnfixTargets(from, to);
      const targets = targetRes.recordset;
      if (targets.length === 0) {
        return res.status(200).json({ success: true, message: '확정 취소 대상이 없습니다.', results: [], errors: [] });
      }

      const uid = req.user?.userId || 'admin';
      const results = [];
      const errors = [];
      for (const t of targets) {
        try {
          const r = await query(
            `DECLARE @r INT, @m NVARCHAR(MAX);
             EXEC dbo.usp_ShipmentFixCancel
                  @OrderYear     = @yr,
                  @OrderWeek     = @wk,
                  @CountryFlower = @cf,
                  @iUserID       = @uid,
                  @oResult       = @r OUTPUT,
                  @oMessage      = @m OUTPUT;
             SELECT @r AS result, @m AS message;`,
            {
              yr:  { type: sql.NVarChar, value: t.OrderYear },
              wk:  { type: sql.NVarChar, value: t.OrderWeek },
              cf:  { type: sql.NVarChar, value: t.CountryFlower },
              uid: { type: sql.NVarChar, value: uid },
            }
          );
          const row = r.recordset?.[0] || {};
          if (row.result === 0) {
            results.push({ week: `${t.OrderYear}-${t.OrderWeek}`, countryFlower: t.CountryFlower, message: row.message || '' });
          } else {
            errors.push({ week: `${t.OrderYear}-${t.OrderWeek}`, countryFlower: t.CountryFlower, code: row.result, message: row.message || 'unknown' });
          }
        } catch (e) {
          errors.push({ week: `${t.OrderYear}-${t.OrderWeek}`, countryFlower: t.CountryFlower, code: -1, message: e.message });
        }
      }

      return res.status(errors.length ? 207 : 200).json({
        success: errors.length === 0,
        message: `${from.year}-${from.week} ~ ${to.year}-${to.week} 구간 확정취소: 성공 ${results.length}건 / 실패 ${errors.length}건`,
        results,
        errors,
      });
    }

    return res.status(405).json({ success: false, error: 'Method Not Allowed' });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

