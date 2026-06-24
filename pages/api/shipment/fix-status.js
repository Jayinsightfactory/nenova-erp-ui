// pages/api/shipment/fix-status.js
// GET  : 차수별 출고 확정 현황 + 확정 시 음수재고 예상 품목
// POST : 선택 구간 확정취소 (높은 차수부터 낮은 차수 순서)

import { query, sql } from '../../../lib/db';
import { withAuth } from '../../../lib/auth';
import {
  deriveExeAlignedStatus,
  deriveShipmentDetailStatus,
  deriveStockFixStatus,
  reconcileWeekAfterScopedOperation,
} from '../../../lib/shipmentFixReconcile';

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

async function loadProcedureShape(procedureName) {
  const result = await query(
    `SELECT LOWER(name) AS name
       FROM sys.parameters
      WHERE object_id = OBJECT_ID(@procedureName)`,
    { procedureName: { type: sql.NVarChar, value: `dbo.${procedureName}` } }
  );
  const names = new Set(result.recordset.map(r => r.name));
  return {
    hasCountryFlower: names.has('@countryflower'),
    hasOutput: names.has('@oresult') || names.has('@omessage'),
  };
}

function shipmentCancelSql(shape) {
  const countryArg = shape.hasCountryFlower ? `\n                  @CountryFlower = @cf,` : '';
  if (shape.hasOutput) {
    return `DECLARE @r INT, @m NVARCHAR(MAX);
             EXEC dbo.usp_ShipmentFixCancel
                  @OrderYear     = @yr,
                  @OrderWeek     = @wk,${countryArg}
                  @iUserID       = @uid,
                  @oResult       = @r OUTPUT,
                  @oMessage      = @m OUTPUT;
             SELECT ISNULL(@r, 0) AS result, @m AS message;`;
  }
  return `EXEC dbo.usp_ShipmentFixCancel
                  @OrderYear     = @yr,
                  @OrderWeek     = @wk,${countryArg}
                  @iUserID       = @uid;
          SELECT 0 AS result, N'' AS message;`;
}

async function loadShipmentProdKeys(orderWeek, countryFlower) {
  const result = await query(
    `SELECT DISTINCT sd.ProdKey
       FROM ShipmentMaster sm
       JOIN ShipmentDetail sd ON sd.ShipmentKey = sm.ShipmentKey
       JOIN Product p ON p.ProdKey = sd.ProdKey AND p.isDeleted = 0
      WHERE sm.OrderWeek = @wk
        AND sm.isDeleted = 0
        AND ISNULL(sd.OutQuantity, 0) > 0
        AND (@cf IS NULL OR p.CountryFlower = @cf)`,
    {
      wk: { type: sql.NVarChar, value: orderWeek },
      cf: { type: sql.NVarChar, value: countryFlower || null },
    }
  );
  return result.recordset.map(r => Number(r.ProdKey)).filter(Boolean);
}

async function runStockCalculationForProducts(orderYear, orderWeek, uid, prodKeys) {
  const uniqueKeys = [...new Set((prodKeys || []).map(Number).filter(Boolean))];
  const results = [];
  const errors = [];
  for (const prodKey of uniqueKeys) {
    try {
      const r = await query(
        `DECLARE @r INT, @m NVARCHAR(200);
         EXEC dbo.usp_StockCalculation
              @OrderYear = @yr,
              @OrderWeek = @wk,
              @ProdKey   = @pk,
              @iUserID   = @uid,
              @oResult   = @r OUTPUT,
              @oMessage  = @m OUTPUT;
         SELECT ISNULL(@r, 0) AS result, @m AS message;`,
        {
          yr:  { type: sql.NVarChar, value: orderYear },
          wk:  { type: sql.NVarChar, value: orderWeek },
          pk:  { type: sql.Int, value: prodKey },
          uid: { type: sql.NVarChar, value: uid },
        }
      );
      const row = r.recordset?.[0] || {};
      if (Number(row.result || 0) === 0) {
        results.push({ prodKey, ok: true, message: row.message || '' });
      } else {
        errors.push({ prodKey, code: row.result, message: row.message || 'unknown' });
      }
    } catch (e) {
      errors.push({ prodKey, code: -1, message: e.message });
    }
  }
  return { results, errors };
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
     unfixed_category AS (
       SELECT
         x.WeekKey,
         STUFF((
           SELECT DISTINCT N', ' + ISNULL(NULLIF(p2.CountryFlower, N''), ISNULL(p2.CounName, N'') + N' ' + ISNULL(p2.FlowerName, N''))
           FROM ShipmentMaster sm2
           JOIN ShipmentDetail sd2 ON sd2.ShipmentKey = sm2.ShipmentKey
           LEFT JOIN Product p2 ON p2.ProdKey = sd2.ProdKey
           WHERE sm2.isDeleted = 0
             AND ISNULL(CAST(sm2.OrderYear AS NVARCHAR(4)), @defaultYear) + REPLACE(sm2.OrderWeek, '-', '') = x.WeekKey
             AND ISNULL(sd2.isFix, 0) = 0
             AND ISNULL(sd2.OutQuantity, 0) > 0
             AND (p2.CountryFlower IS NOT NULL OR p2.CounName IS NOT NULL OR p2.FlowerName IS NOT NULL)
           FOR XML PATH(''), TYPE
         ).value('.', 'NVARCHAR(MAX)'), 1, 2, N'') AS unfixedCategories
       FROM (
         SELECT DISTINCT
           ISNULL(CAST(sm.OrderYear AS NVARCHAR(4)), @defaultYear) + REPLACE(sm.OrderWeek, '-', '') AS WeekKey
         FROM ShipmentMaster sm
         JOIN ShipmentDetail sd ON sd.ShipmentKey = sm.ShipmentKey
         WHERE sm.isDeleted = 0
           AND ISNULL(sd.isFix, 0) = 0
           AND ISNULL(sd.OutQuantity, 0) > 0
       ) x
     ),
     stock AS (
       SELECT
         ISNULL(CAST(OrderYear AS NVARCHAR(4)), @defaultYear) + REPLACE(OrderWeek, '-', '') AS WeekKey,
         MAX(CASE WHEN ISNULL(isFix, 0) = 1 THEN 1 ELSE 0 END) AS stockFixed,
         COUNT(*) AS stockMasterCount
       FROM StockMaster
       WHERE OrderWeek IS NOT NULL
       GROUP BY ISNULL(CAST(OrderYear AS NVARCHAR(4)), @defaultYear) + REPLACE(OrderWeek, '-', '')
     ),
     mismatch AS (
       SELECT
         ISNULL(CAST(sm.OrderYear AS NVARCHAR(4)), @defaultYear) + REPLACE(sm.OrderWeek, '-', '') AS WeekKey,
         SUM(CASE WHEN ISNULL(sm.isFix,0)<>ISNULL(sd.isFix,0) AND ISNULL(sd.OutQuantity,0)>0 THEN 1 ELSE 0 END) AS masterDetailMismatchCount
       FROM ShipmentMaster sm
       JOIN ShipmentDetail sd ON sd.ShipmentKey = sm.ShipmentKey
       WHERE sm.isDeleted = 0
       GROUP BY ISNULL(CAST(sm.OrderYear AS NVARCHAR(4)), @defaultYear) + REPLACE(sm.OrderWeek, '-', '')
     ),
     neg_live AS (
       SELECT
         ISNULL(CAST(sm.OrderYear AS NVARCHAR(4)), @defaultYear) + REPLACE(sm.OrderWeek, '-', '') AS WeekKey,
         COUNT(DISTINCT p.ProdKey) AS negativeLiveCount
       FROM ShipmentMaster sm
       JOIN ShipmentDetail sd ON sd.ShipmentKey = sm.ShipmentKey
       JOIN Product p ON p.ProdKey = sd.ProdKey AND p.isDeleted = 0
       WHERE sm.isDeleted = 0 AND ISNULL(sd.OutQuantity,0) > 0 AND ISNULL(p.Stock,0) < 0
       GROUP BY ISNULL(CAST(sm.OrderYear AS NVARCHAR(4)), @defaultYear) + REPLACE(sm.OrderWeek, '-', '')
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
       ISNULL(unfixed_category.unfixedCategories, N'') AS unfixedCategories,
       ISNULL(stock.stockFixed, 0) AS stockFixed,
       ISNULL(stock.stockMasterCount, 0) AS stockMasterCount,
       ISNULL(mismatch.masterDetailMismatchCount, 0) AS masterDetailMismatchCount,
       ISNULL(neg_live.negativeLiveCount, 0) AS negativeLiveCount
     FROM week_set w
     LEFT JOIN ship ON ship.WeekKey = w.WeekKey
     LEFT JOIN unfixed_category ON unfixed_category.WeekKey = w.WeekKey
     LEFT JOIN stock ON stock.WeekKey = w.WeekKey
     LEFT JOIN mismatch ON mismatch.WeekKey = w.WeekKey
     LEFT JOIN neg_live ON neg_live.WeekKey = w.WeekKey
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
     ),
     adjust_qty AS (
       SELECT
         ISNULL(CAST(sh.OrderYear AS NVARCHAR(4)), @defaultYear) + REPLACE(sh.OrderWeek, '-', '') AS WeekKey,
         sh.ProdKey,
         SUM(ISNULL(sh.AfterValue,0) - ISNULL(sh.BeforeValue,0)) AS adjustQty
       FROM StockHistory sh
       WHERE sh.OrderWeek LIKE '__-__'
         AND (sh.ChangeType IS NULL OR sh.ChangeType NOT IN (N'확정', N'확정취소', N'입고', N'출고'))
       GROUP BY ISNULL(CAST(sh.OrderYear AS NVARCHAR(4)), @defaultYear) + REPLACE(sh.OrderWeek, '-', ''), sh.ProdKey
     )
     SELECT TOP 500
       w.OrderYear,
       w.OrderWeek,
       oq.ProdKey,
       p.ProdName,
       p.FlowerName,
       p.CounName,
       ISNULL(prev.prevStock, 0) AS prevStock,
       ISNULL(iq.inQty, 0) + ISNULL(aq.adjustQty, 0) AS inQty,
       ISNULL(aq.adjustQty, 0) AS adjustQty,
       ISNULL(oq.outQty, 0) AS outQty,
       ISNULL(prev.prevStock, 0) + ISNULL(iq.inQty, 0) + ISNULL(aq.adjustQty, 0) - ISNULL(oq.outQty, 0) AS remain
     FROM out_qty oq
     JOIN week_set w ON w.WeekKey = oq.WeekKey
     JOIN Product p ON p.ProdKey = oq.ProdKey AND p.isDeleted = 0
     LEFT JOIN in_qty iq ON iq.WeekKey = oq.WeekKey AND iq.ProdKey = oq.ProdKey
     LEFT JOIN adjust_qty aq ON aq.WeekKey = oq.WeekKey AND aq.ProdKey = oq.ProdKey
     OUTER APPLY (
       SELECT TOP 1 ps.Stock AS prevStock
       FROM ProductStock ps
       JOIN StockMaster sm2 ON sm2.StockKey = ps.StockKey
       WHERE ps.ProdKey = oq.ProdKey
         AND ISNULL(CAST(sm2.OrderYear AS NVARCHAR(4)), @defaultYear) + REPLACE(sm2.OrderWeek, '-', '') < oq.WeekKey
       ORDER BY ISNULL(CAST(sm2.OrderYear AS NVARCHAR(4)), @defaultYear) + REPLACE(sm2.OrderWeek, '-', '') DESC
     ) prev
     WHERE oq.WeekKey BETWEEN @fromKey AND @toKey
       AND ISNULL(prev.prevStock, 0) + ISNULL(iq.inQty, 0) + ISNULL(aq.adjustQty, 0) - ISNULL(oq.outQty, 0) < 0
     ORDER BY w.WeekKey DESC, p.FlowerName, p.ProdName`,
    {
      defaultYear: { type: sql.NVarChar, value: from.year },
      fromKey:     { type: sql.NVarChar, value: from.key },
      toKey:       { type: sql.NVarChar, value: to.key },
    }
  );
}

async function loadCategoriesInRange(from, to) {
  return await query(
    `SELECT DISTINCT LTRIM(RTRIM(p.CountryFlower)) AS CountryFlower
       FROM ShipmentMaster sm
       JOIN ShipmentDetail sd ON sd.ShipmentKey = sm.ShipmentKey
       JOIN Product p ON p.ProdKey = sd.ProdKey AND p.isDeleted = 0
      WHERE sm.isDeleted = 0
        AND ISNULL(sd.OutQuantity, 0) > 0
        AND p.CountryFlower IS NOT NULL
        AND LTRIM(RTRIM(p.CountryFlower)) <> ''
        AND ISNULL(CAST(sm.OrderYear AS NVARCHAR(4)), @defaultYear) + REPLACE(sm.OrderWeek, '-', '') BETWEEN @fromKey AND @toKey
      ORDER BY LTRIM(RTRIM(p.CountryFlower))`,
    {
      defaultYear: { type: sql.NVarChar, value: from.year },
      fromKey:     { type: sql.NVarChar, value: from.key },
      toKey:       { type: sql.NVarChar, value: to.key },
    }
  );
}

function normalizeCountryFlowerFilter(countryFlowers) {
  const values = Array.isArray(countryFlowers)
    ? countryFlowers
    : String(countryFlowers || '').split(',');
  return [...new Set(values.map(v => String(v || '').trim()).filter(Boolean))];
}

async function loadUnfixTargets(from, to, countryFlowersFilter = null) {
  const countryFlowers = normalizeCountryFlowerFilter(countryFlowersFilter);
  const cfWhere = countryFlowers.length
    ? `AND LTRIM(RTRIM(p.CountryFlower)) IN (${countryFlowers.map((_, i) => `@cf${i}`).join(', ')})`
    : '';
  const params = {
    defaultYear: { type: sql.NVarChar, value: from.year },
    fromKey:     { type: sql.NVarChar, value: from.key },
    toKey:       { type: sql.NVarChar, value: to.key },
  };
  countryFlowers.forEach((cf, i) => {
    params[`cf${i}`] = { type: sql.NVarChar, value: cf };
  });
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
       ${cfWhere}
     GROUP BY ISNULL(CAST(sm.OrderYear AS NVARCHAR(4)), @defaultYear), sm.OrderWeek, p.CountryFlower
     ORDER BY WeekKey DESC, p.CountryFlower`,
    params
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
      const [statusRes, negativeRes, categoryRes] = await Promise.all([
        loadWeekStatus(from, to),
        loadNegativeRows(from, to),
        loadCategoriesInRange(from, to),
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
        const shipmentStatus = deriveShipmentDetailStatus({ detailCount, fixedDetailCount, unfixedDetailCount });
        const stockFixStatus = deriveStockFixStatus({
          stockMasterCount: Number(w.stockMasterCount) || 0,
          stockFixed: Number(w.stockFixed) || 0,
        });
        const parity = deriveExeAlignedStatus({
          shipmentStatus,
          stockFixStatus,
          negativeLiveCount: Number(w.negativeLiveCount) || 0,
          masterDetailMismatchCount: Number(w.masterDetailMismatchCount) || 0,
        });
        return {
          ...w,
          status: parity.status,
          shipmentStatus,
          stockFixStatus,
          exeAligned: parity.exeAligned,
          parityWarnings: parity.warnings,
          negativeCount,
        };
      });

      return res.status(200).json({
        success: true,
        fromWeek: `${from.year}-${from.week}`,
        toWeek: `${to.year}-${to.week}`,
        weeks,
        negative: negativeRes.recordset,
        categories: categoryRes.recordset.map(r => r.CountryFlower).filter(Boolean),
      });
    }

    if (req.method === 'POST') {
      const { fromWeek, toWeek, force, countryFlowers } = req.body || {};
      const { from, to } = normalizeRange(fromWeek, toWeek);
      const cfFilter = normalizeCountryFlowerFilter(countryFlowers);
      const later = await loadLaterFixed(to);
      if (later.recordset.length > 0 && !force) {
        return res.status(409).json({
          success: false,
          warning: 'LATER_FIXED_EXISTS',
          laterWeeks: later.recordset,
          error: `선택 구간 이후에 이미 확정된 차수가 있습니다. (${later.recordset.map(r => `${r.OrderYear}-${r.OrderWeek}`).join(', ')})`,
        });
      }

      const targetRes = await loadUnfixTargets(from, to, cfFilter.length ? cfFilter : null);
      const targets = targetRes.recordset;
      if (targets.length === 0) {
        return res.status(200).json({ success: true, message: '확정 취소 대상이 없습니다.', results: [], errors: [] });
      }

      const uid = req.user?.userId || 'admin';
      const procedureShape = await loadProcedureShape('usp_ShipmentFixCancel');
      const callTargets = procedureShape.hasCountryFlower
        ? targets
        : Object.values(targets.reduce((acc, t) => {
            acc[`${t.OrderYear}-${t.OrderWeek}`] ||= { ...t, CountryFlower: null };
            return acc;
      }, {}));
      const results = [];
      const errors = [];
      const stockResults = [];
      const stockErrors = [];
      const stockByWeek = {};
      for (const t of callTargets) {
        try {
          const prodKeys = await loadShipmentProdKeys(t.OrderWeek, procedureShape.hasCountryFlower ? t.CountryFlower : null);
          const r = await query(
            shipmentCancelSql(procedureShape),
            {
              yr:  { type: sql.NVarChar, value: t.OrderYear },
              wk:  { type: sql.NVarChar, value: t.OrderWeek },
              ...(procedureShape.hasCountryFlower ? { cf: { type: sql.NVarChar, value: t.CountryFlower } } : {}),
              uid: { type: sql.NVarChar, value: uid },
            }
          );
          const row = r.recordset?.[0] || {};
          if (row.result === 0) {
            const stock = await runStockCalculationForProducts(t.OrderYear, t.OrderWeek, uid, prodKeys);
            stockResults.push(...stock.results);
            stockErrors.push(...stock.errors);
            const weekLabel = `${t.OrderYear}-${t.OrderWeek}`;
            if (!stockByWeek[weekLabel]) {
              stockByWeek[weekLabel] = { orderYear: t.OrderYear, orderWeek: t.OrderWeek, prodKeys: [] };
            }
            stockByWeek[weekLabel].prodKeys.push(...stock.results.map((s) => s.prodKey));
            results.push({ week: weekLabel, countryFlower: t.CountryFlower || 'ALL', message: row.message || '' });
          } else {
            errors.push({ week: `${t.OrderYear}-${t.OrderWeek}`, countryFlower: t.CountryFlower || 'ALL', code: row.result, message: row.message || 'unknown' });
          }
        } catch (e) {
          errors.push({ week: `${t.OrderYear}-${t.OrderWeek}`, countryFlower: t.CountryFlower || 'ALL', code: -1, message: e.message });
        }
      }

      const reconcileByWeek = {};
      for (const [weekLabel, info] of Object.entries(stockByWeek)) {
        reconcileByWeek[weekLabel] = await reconcileWeekAfterScopedOperation({
          q: query,
          sqlTypes: sql,
          orderYear: info.orderYear,
          orderWeek: info.orderWeek,
          uid,
          alreadyCalculatedProdKeys: info.prodKeys,
          scopeLabel: cfFilter.length ? `bulk-unfix:${cfFilter.join(',')}` : 'bulk-unfix',
          forceFullWeekRecalc: cfFilter.length > 0,
        });
      }

      const reconcileStockErrors = Object.values(reconcileByWeek).flatMap((r) => r.stockErrors || []);
      const hasStockWarning = stockErrors.length > 0 || reconcileStockErrors.length > 0;
      return res.status(errors.length ? 207 : 200).json({
        success: errors.length === 0 && reconcileStockErrors.length === 0,
        message: `${from.year}-${from.week} ~ ${to.year}-${to.week} 구간 확정취소: 성공 ${results.length}건 / 실패 ${errors.length}건` +
                 (hasStockWarning ? ` · 재고 재계산 경고 ${stockErrors.length + reconcileStockErrors.length}건` : ''),
        results,
        errors,
        stockResults,
        stockErrors,
        stockWarning: hasStockWarning,
        reconcileByWeek,
      });
    }

    return res.status(405).json({ success: false, error: 'Method Not Allowed' });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});
