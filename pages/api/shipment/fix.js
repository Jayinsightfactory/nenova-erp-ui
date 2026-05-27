// pages/api/shipment/fix.js
// POST { week, action: 'fix' | 'unfix' }
// 확정: isFix=1 + ProductStock 업데이트 + StockHistory 기록
// 확정취소: isFix=0

import { query, sql } from '../../../lib/db';
import { withAuth } from '../../../lib/auth';

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isDeadlockError(err) {
  return Number(err?.number || err?.originalError?.number || err?.precedingErrors?.[0]?.number || 0) === 1205 ||
    /deadlocked on lock resources|deadlock victim/i.test(String(err?.message || ''));
}

async function queryWithDeadlockRetry(q, params = {}, options = {}) {
  const retries = Number(options.retries ?? 3);
  const baseDelay = Number(options.baseDelay ?? 250);
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await query(q, params);
    } catch (err) {
      if (!isDeadlockError(err) || attempt >= retries) throw err;
      await sleep(baseDelay * Math.pow(2, attempt));
    }
  }
}

async function logFix(step, detail, isError = false) {
  try {
    await query(
      `INSERT INTO AppLog (Category, Step, Detail, IsError)
       VALUES (N'shipmentFix', @step, @detail, @err)`,
      {
        step:   { type: sql.NVarChar, value: String(step || '').slice(0, 100) },
        detail: { type: sql.NVarChar, value: String(detail || '').slice(0, 1000) },
        err:    { type: sql.Bit, value: isError ? 1 : 0 },
      }
    );
  } catch {
    // AppLog가 없거나 쓰기 실패해도 확정 작업은 계속 진행한다.
  }
}

async function runLimited(items, limit, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await worker(items[currentIndex], currentIndex);
    }
  });
  await Promise.all(workers);
  return results;
}

export default withAuth(async function handler(req, res) {
  if (req.method === 'GET') return await validate(req, res);
  if (req.method !== 'POST') return res.status(405).end();
  const { week, prodKey, action, countryFlowers } = req.body;
  if (!week) return res.status(400).json({ success: false, error: 'week 필요' });
  if (!['fix', 'unfix'].includes(action)) return res.status(400).json({ success: false, error: 'action은 fix 또는 unfix' });

  try {
    if (action === 'unfix') return await unfix(req, res, week, prodKey, countryFlowers);
    return await fix(req, res, week, prodKey, countryFlowers);
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ── 확정 전 사전검증 (GET ?week=16-01)
// 1. 주문 없는데 출고 있는 품목 (ghost)
// 2. 같은 거래처+품목에 중복 출고 레코드
// 3. 마이너스 잔량 품목
async function validate(req, res) {
  const { week } = req.query;
  if (!week) return res.status(400).json({ success: false, error: 'week 필요' });
  try {
    const orderYear = deriveOrderYear(week);
    const orderWeek = deriveOrderWeek(week);
    const orderYearWeek = orderYear + String(orderWeek || '').replace('-', '');
    const wk = { type: sql.NVarChar, value: orderWeek };

    // 1. 주문 없는 출고 (OrderDetail 없는데 ShipmentDetail 있음)
    const ghostResult = await query(
      `SELECT DISTINCT p.ProdName, c.CustName, sd.OutQuantity,
         sm.ShipmentKey, sm.isFix, sm.WebCreated
       FROM ShipmentDetail sd
       JOIN ShipmentMaster sm ON sd.ShipmentKey = sm.ShipmentKey
       JOIN Product p ON sd.ProdKey = p.ProdKey
       JOIN Customer c ON sm.CustKey = c.CustKey
       WHERE sm.OrderWeek = @wk AND sm.isDeleted = 0 AND sd.OutQuantity > 0
         AND NOT EXISTS (
           SELECT 1 FROM OrderDetail od
           JOIN OrderMaster om ON od.OrderMasterKey = om.OrderMasterKey
           WHERE om.CustKey = sm.CustKey AND om.OrderWeek = @wk
             AND od.ProdKey = sd.ProdKey AND om.isDeleted = 0 AND od.isDeleted = 0
         )
       ORDER BY c.CustName, p.ProdName`,
      { wk }
    );

    // 2. 중복 출고 (같은 거래처+품목+차수에 ShipmentDetail 2건 이상)
    const dupResult = await query(
      `SELECT p.ProdName, c.CustName,
         COUNT(sd.SdetailKey) AS cnt,
         SUM(sd.OutQuantity) AS totalQty,
         STRING_AGG(CAST(sd.ShipmentKey AS NVARCHAR(20)), ',') AS shipKeys
       FROM ShipmentDetail sd
       JOIN ShipmentMaster sm ON sd.ShipmentKey = sm.ShipmentKey
       JOIN Product p ON sd.ProdKey = p.ProdKey
       JOIN Customer c ON sm.CustKey = c.CustKey
       WHERE sm.OrderWeek = @wk AND sm.isDeleted = 0 AND sd.OutQuantity > 0
       GROUP BY sm.CustKey, sd.ProdKey, p.ProdName, c.CustName
       HAVING COUNT(sd.SdetailKey) > 1
       ORDER BY c.CustName, p.ProdName`,
      { wk }
    );

    // 3. 마이너스 잔량
    const negResult = await query(
      `WITH out_qty AS (
         SELECT sd.ProdKey, SUM(ISNULL(sd.OutQuantity, 0)) AS outQty
         FROM ShipmentMaster sm
         JOIN ShipmentDetail sd ON sd.ShipmentKey = sm.ShipmentKey
         WHERE sm.OrderWeek = @wk AND sm.isDeleted = 0 AND ISNULL(sd.OutQuantity, 0) > 0
         GROUP BY sd.ProdKey
       ),
       in_qty AS (
         SELECT wd.ProdKey, SUM(ISNULL(wd.OutQuantity, 0)) AS inQty
         FROM WarehouseMaster wm
         JOIN WarehouseDetail wd ON wd.WarehouseKey = wm.WarehouseKey
         WHERE wm.OrderWeek = @wk AND wm.isDeleted = 0
         GROUP BY wd.ProdKey
       )
       SELECT
         p.ProdKey,
         p.ProdName,
         p.FlowerName,
         p.CounName,
         ISNULL(prev.prevStock, 0) AS prevStock,
         ISNULL(iq.inQty, 0) AS inQty,
         ISNULL(oq.outQty, 0) AS outQty,
         ISNULL(prev.prevStock, 0) + ISNULL(iq.inQty, 0) - ISNULL(oq.outQty, 0) AS remain
       FROM out_qty oq
       JOIN Product p ON p.ProdKey = oq.ProdKey AND p.isDeleted = 0
       LEFT JOIN in_qty iq ON iq.ProdKey = oq.ProdKey
       OUTER APPLY (
         SELECT TOP 1 ps.Stock AS prevStock
         FROM ProductStock ps
         JOIN StockMaster sm2 ON ps.StockKey = sm2.StockKey
         WHERE ps.ProdKey = p.ProdKey
           AND ISNULL(CAST(sm2.OrderYear AS NVARCHAR(4)), @yr) + REPLACE(sm2.OrderWeek, '-', '') < @ywk
         ORDER BY ISNULL(CAST(sm2.OrderYear AS NVARCHAR(4)), @yr) + REPLACE(sm2.OrderWeek, '-', '') DESC
       ) prev
       WHERE ISNULL(prev.prevStock, 0) + ISNULL(iq.inQty, 0) - ISNULL(oq.outQty, 0) < 0
       ORDER BY p.FlowerName, p.ProdName`,
      {
        wk,
        yr:  { type: sql.NVarChar, value: orderYear },
        ywk: { type: sql.NVarChar, value: orderYearWeek },
      }
    );

    const calcNegRows = negResult.recordset.map(r => ({
      ...r,
      remain: Math.round((Number(r.prevStock || 0) + Number(r.inQty || 0) - Number(r.outQty || 0)) * 1000) / 1000,
    }));
    const guardNegRows = await loadNegativeGuardRows(orderYear, orderWeek);
    const negMap = new Map();
    for (const row of [...calcNegRows, ...guardNegRows]) {
      negMap.set(Number(row.ProdKey), row);
    }
    const negRows = [...negMap.values()];

    // 4. 입고 없는 출고 (WarehouseDetail 없는데 ShipmentDetail.OutQuantity > 0)
    //    이 케이스가 견적서에서 "입고 0인데 출고 5" 처럼 보여 작업 오류 유발
    const noInResult = await query(
      `SELECT DISTINCT p.ProdName, p.FlowerName, p.CounName,
         SUM(sd.OutQuantity) AS outQty,
         ISNULL((SELECT SUM(wd.OutQuantity) FROM WarehouseDetail wd
           JOIN WarehouseMaster wm ON wd.WarehouseKey = wm.WarehouseKey
           WHERE wd.ProdKey = p.ProdKey AND wm.OrderWeek = @wk AND wm.isDeleted = 0), 0) AS inQty
       FROM ShipmentDetail sd
       JOIN ShipmentMaster sm ON sd.ShipmentKey = sm.ShipmentKey
       JOIN Product p ON sd.ProdKey = p.ProdKey
       WHERE sm.OrderWeek = @wk AND sm.isDeleted = 0 AND sd.OutQuantity > 0
       GROUP BY p.ProdKey, p.ProdName, p.FlowerName, p.CounName
       HAVING ISNULL((SELECT SUM(wd.OutQuantity) FROM WarehouseDetail wd
           JOIN WarehouseMaster wm ON wd.WarehouseKey = wm.WarehouseKey
           WHERE wd.ProdKey = p.ProdKey AND wm.OrderWeek = @wk AND wm.isDeleted = 0), 0) = 0
       ORDER BY p.FlowerName, p.ProdName`,
      { wk }
    );

    const issues = ghostResult.recordset.length + dupResult.recordset.length + negRows.length + noInResult.recordset.length;
    return res.status(200).json({
      success: true,
      week: `${orderYear}-${orderWeek}`,
      issueCount: issues,
      ghost:    ghostResult.recordset,    // 주문 없는 출고
      noIncoming: noInResult.recordset,   // 입고 없는 출고 (4번째 검증)
      duplicate: dupResult.recordset,     // 중복 출고
      negative: negRows,                  // 마이너스 잔량
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}

// ── OrderYear 추출 헬퍼: '2026-17-02' / '17-02' 둘 다 지원
function deriveOrderYear(week) {
  const m = (week || '').match(/^(\d{4})-/);
  if (m) return m[1];
  return String(new Date().getFullYear());
}
function deriveOrderWeek(week) {
  const m = (week || '').match(/^\d{4}-(\d{2}-\d{2})$/);
  return m ? m[1] : week;
}

async function loadNegativeGuardRows(orderYear, orderWeek) {
  const orderYearWeek = orderYear + String(orderWeek || '').replace('-', '');
  const result = await query(
    `WITH out_qty AS (
       SELECT sd.ProdKey, SUM(ISNULL(sd.OutQuantity, 0)) AS outQty
       FROM ShipmentMaster sm
       JOIN ShipmentDetail sd ON sd.ShipmentKey = sm.ShipmentKey
       WHERE sm.OrderWeek = @wk AND sm.isDeleted = 0 AND ISNULL(sd.OutQuantity, 0) > 0
       GROUP BY sd.ProdKey
     ),
     in_qty AS (
       SELECT wd.ProdKey, SUM(ISNULL(wd.OutQuantity, 0)) AS inQty
       FROM WarehouseMaster wm
       JOIN WarehouseDetail wd ON wd.WarehouseKey = wm.WarehouseKey
       WHERE wm.OrderWeek = @wk AND wm.isDeleted = 0
       GROUP BY wd.ProdKey
     ),
     stock_base AS (
       SELECT
         p.ProdKey,
         p.ProdName,
         p.FlowerName,
         p.CounName,
         ISNULL(prev.prevStock, ISNULL(p.Stock, 0)) AS prevStock,
         ISNULL(p.Stock, 0) AS productStock,
         ISNULL(iq.inQty, 0) AS inQty,
         ISNULL(oq.outQty, 0) AS outQty
       FROM out_qty oq
       JOIN Product p ON p.ProdKey = oq.ProdKey AND p.isDeleted = 0
       LEFT JOIN in_qty iq ON iq.ProdKey = oq.ProdKey
       OUTER APPLY (
         SELECT TOP 1 ps.Stock AS prevStock
         FROM ProductStock ps
         JOIN StockMaster sm2 ON ps.StockKey = sm2.StockKey
         WHERE ps.ProdKey = p.ProdKey
           AND ISNULL(CAST(sm2.OrderYear AS NVARCHAR(4)), @yr) + REPLACE(sm2.OrderWeek, '-', '') < @ywk
           AND (sm2.isFix IS NULL OR sm2.isFix = 1)
         ORDER BY ISNULL(CAST(sm2.OrderYear AS NVARCHAR(4)), @yr) + REPLACE(sm2.OrderWeek, '-', '') DESC
       ) prev
     )
     SELECT
       ProdKey,
       ProdName,
       FlowerName,
       CounName,
       prevStock,
       productStock,
       inQty,
       outQty,
       prevStock + inQty - outQty AS remain,
       productStock + inQty - outQty AS productRemain
     FROM stock_base
     WHERE prevStock + inQty - outQty < 0
        OR productStock + inQty - outQty < 0
     ORDER BY FlowerName, ProdName`,
    {
      wk:  { type: sql.NVarChar, value: orderWeek },
      yr:  { type: sql.NVarChar, value: orderYear },
      ywk: { type: sql.NVarChar, value: orderYearWeek },
    }
  );

  return result.recordset.map(r => ({
    ...r,
    remain: Math.round(Number(r.remain || 0) * 1000) / 1000,
    productRemain: Math.round(Number(r.productRemain || 0) * 1000) / 1000,
  }));
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

function shipmentProcedureSql(procedureName, shape) {
  if (!['usp_ShipmentFix', 'usp_ShipmentFixCancel'].includes(procedureName)) {
    throw new Error('Unsupported shipment procedure');
  }
  const countryArg = shape.hasCountryFlower ? `\n              @CountryFlower = @cf,` : '';
  if (shape.hasOutput) {
    return `DECLARE @r INT, @m NVARCHAR(MAX);
         EXEC dbo.${procedureName}
              @OrderYear     = @yr,
              @OrderWeek     = @wk,${countryArg}
              @iUserID       = @uid,
              @oResult       = @r OUTPUT,
              @oMessage      = @m OUTPUT;
         SELECT ISNULL(@r, 0) AS result, @m AS message;`;
  }
  return `EXEC dbo.${procedureName}
              @OrderYear     = @yr,
              @OrderWeek     = @wk,${countryArg}
              @iUserID       = @uid;
          SELECT 0 AS result, N'' AS message;`;
}

async function runShipmentProcedure(procedureName, shape, orderYear, orderWeek, uid, countryFlower) {
  const params = {
    yr:  { type: sql.NVarChar, value: orderYear },
    wk:  { type: sql.NVarChar, value: orderWeek },
    uid: { type: sql.NVarChar, value: uid },
  };
  if (shape.hasCountryFlower) {
    params.cf = { type: sql.NVarChar, value: countryFlower || '' };
  }
  return await queryWithDeadlockRetry(shipmentProcedureSql(procedureName, shape), params, {
    retries: 4,
    baseDelay: 300,
  });
}

async function loadShipmentProdKeys(orderWeek, countryFlower, targetMode = 'CATEGORY') {
  const result = await query(
    `SELECT DISTINCT sd.ProdKey
       FROM ShipmentMaster sm
       JOIN ShipmentDetail sd ON sd.ShipmentKey = sm.ShipmentKey
       JOIN Product p ON p.ProdKey = sd.ProdKey AND p.isDeleted = 0
      WHERE sm.OrderWeek = @wk
        AND sm.isDeleted = 0
        AND ISNULL(sd.OutQuantity, 0) > 0
        AND (
          @mode = N'ALL'
          OR (@mode = N'BLANK' AND NULLIF(LTRIM(RTRIM(ISNULL(p.CountryFlower, N''))), N'') IS NULL)
          OR (@mode = N'CATEGORY' AND p.CountryFlower = @cf)
        )
      ORDER BY sd.ProdKey`,
    {
      wk: { type: sql.NVarChar, value: orderWeek },
      cf: { type: sql.NVarChar, value: countryFlower || null },
      mode: { type: sql.NVarChar, value: targetMode },
    }
  );
  return result.recordset.map(r => Number(r.ProdKey)).filter(Boolean);
}

async function runStockCalculationForProducts(orderYear, orderWeek, uid, prodKeys, logContext = {}) {
  const uniqueKeys = [...new Set((prodKeys || []).map(Number).filter(Boolean))]
    .sort((a, b) => a - b);
  const results = [];
  const errors = [];
  let completed = 0;
  const total = uniqueKeys.length;
  const logPrefix = logContext.prefix || 'stock_calc';
  const logLabel = logContext.label || '';
  await runLimited(uniqueKeys, 3, async (prodKey) => {
    try {
      const r = await queryWithDeadlockRetry(
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
        },
        { retries: 4, baseDelay: 300 }
      );
      const row = r.recordset?.[0] || {};
      if (Number(row.result || 0) === 0) {
        results.push({ prodKey, ok: true, message: row.message || '' });
      } else {
        const error = { prodKey, code: row.result, message: row.message || 'unknown' };
        errors.push(error);
        await logFix(`${logPrefix}_item_error`, `${orderYear}/${orderWeek} ${logLabel} pk=${prodKey} ${error.message}`, true);
      }
    } catch (e) {
      const error = { prodKey, code: -1, message: e.message };
      errors.push(error);
      await logFix(`${logPrefix}_item_error`, `${orderYear}/${orderWeek} ${logLabel} pk=${prodKey} ${error.message}`, true);
    } finally {
      completed += 1;
      if (completed === total || completed % 10 === 0) {
        await logFix(`${logPrefix}_progress`, `${orderYear}/${orderWeek} ${logLabel} ${completed}/${total}`);
      }
    }
  });
  return { results, errors };
}

function normalizeCountryFlowerFilter(countryFlowers) {
  const values = Array.isArray(countryFlowers)
    ? countryFlowers
    : String(countryFlowers || '').split(',');
  const clean = values.map(v => String(v || '').trim()).filter(Boolean);
  return clean.length ? new Set(clean) : null;
}

function countryFlowerNameSql(alias = 'p') {
  return `NULLIF(LTRIM(RTRIM(ISNULL(${alias}.CountryFlower, N''))), N'')`;
}

function countryFlowerLabelSql(alias = 'p') {
  const cf = countryFlowerNameSql(alias);
  return `ISNULL(${cf}, ISNULL(NULLIF(LTRIM(RTRIM(ISNULL(${alias}.CounName, N''))), N''), ISNULL(NULLIF(LTRIM(RTRIM(ISNULL(${alias}.FlowerName, N''))), N''), N'(분류없음)')))`;
}

function matchesCountryFlowerFilter(row, allowedCountryFlowers) {
  if (!allowedCountryFlowers) return true;
  return allowedCountryFlowers.has(row.countryFlower) || allowedCountryFlowers.has(row.label);
}

async function loadShipmentCategoryTargets(orderWeek, detailFixValue, allowedCountryFlowers) {
  const cf = countryFlowerNameSql('p');
  const label = countryFlowerLabelSql('p');
  const result = await query(
    `SELECT DISTINCT
            ISNULL(${cf}, N'') AS countryFlower,
            ${label} AS label,
            CASE WHEN ${cf} IS NULL THEN 1 ELSE 0 END AS isBlank
       FROM ShipmentDetail sd
       JOIN ShipmentMaster sm ON sd.ShipmentKey = sm.ShipmentKey
       JOIN Product p          ON sd.ProdKey = p.ProdKey AND p.isDeleted = 0
      WHERE sm.OrderWeek=@wk AND sm.isDeleted = 0
        AND ISNULL(sd.isFix, 0) = @detailFix
        AND sd.OutQuantity > 0`,
    {
      wk: { type: sql.NVarChar, value: orderWeek },
      detailFix: { type: sql.Int, value: detailFixValue },
    }
  );

  return result.recordset
    .map(r => ({
      countryFlower: String(r.countryFlower || ''),
      label: String(r.label || r.countryFlower || '(분류없음)'),
      isBlank: Number(r.isBlank || 0) === 1,
      mode: Number(r.isBlank || 0) === 1 ? 'BLANK' : 'CATEGORY',
    }))
    .filter(row => matchesCountryFlowerFilter(row, allowedCountryFlowers))
    .sort((a, b) => Number(a.isBlank) - Number(b.isBlank) || a.label.localeCompare(b.label, 'ko'));
}

async function loadLowerUnfixedWeeks(orderYear, orderWeek, countryFlowersFilter) {
  const currentKey = String(orderYear) + String(orderWeek || '').replace('-', '');
  const countryFlowers = countryFlowersFilter ? [...countryFlowersFilter] : [];
  const cf = countryFlowerNameSql('p');
  const label = countryFlowerLabelSql('p');
  const cfWhere = countryFlowers.length
    ? `AND (ISNULL(${cf}, N'') IN (${countryFlowers.map((_, i) => `@cf${i}`).join(', ')})
            OR ${label} IN (${countryFlowers.map((_, i) => `@cf${i}`).join(', ')}))`
    : '';
  const params = {
    currentKey: { type: sql.NVarChar, value: currentKey },
    orderYear: { type: sql.NVarChar, value: orderYear },
    defaultYear: { type: sql.NVarChar, value: orderYear },
  };
  countryFlowers.forEach((cf, i) => {
    params[`cf${i}`] = { type: sql.NVarChar, value: cf };
  });
  const result = await query(
    `SELECT TOP 20
       ISNULL(CAST(sm.OrderYear AS NVARCHAR(4)), @defaultYear) AS OrderYear,
       sm.OrderWeek,
       COUNT(sd.SdetailKey) AS detailCount
     FROM ShipmentMaster sm
     JOIN ShipmentDetail sd ON sd.ShipmentKey = sm.ShipmentKey
     JOIN Product p ON p.ProdKey = sd.ProdKey AND p.isDeleted = 0
     WHERE sm.isDeleted = 0
       AND ISNULL(sd.OutQuantity, 0) > 0
       AND ISNULL(sd.isFix, 0) = 0
       AND ISNULL(CAST(sm.OrderYear AS NVARCHAR(4)), @defaultYear) = @orderYear
       AND ISNULL(CAST(sm.OrderYear AS NVARCHAR(4)), @defaultYear) + REPLACE(sm.OrderWeek, '-', '') < @currentKey
       ${cfWhere}
     GROUP BY ISNULL(CAST(sm.OrderYear AS NVARCHAR(4)), @defaultYear), sm.OrderWeek
     ORDER BY ISNULL(CAST(sm.OrderYear AS NVARCHAR(4)), @defaultYear), sm.OrderWeek`,
    params
  );
  return result.recordset || [];
}

// ── 확정 — 전산 SP usp_ShipmentFix 를 CountryFlower 단위 호출
//    (전산프로그램과 100% 동일 동작: Product.Stock 차감 + 잔량 마이너스 검증 + 출고일 검증)
async function fix(req, res, week, prodKeyFilter, countryFlowersFilter) {
  if (prodKeyFilter) {
    return res.status(400).json({
      success: false,
      error: '품목 단위 부분 확정은 지원하지 않습니다. 차수 전체를 확정하세요.',
    });
  }

  const orderYear = deriveOrderYear(week);
  const orderWeek = deriveOrderWeek(week);
  const uid       = req.user?.userId || 'admin';
  const allowedCountryFlowers = normalizeCountryFlowerFilter(countryFlowersFilter);
  await logFix('fix_start', `${orderYear}/${orderWeek} uid=${uid} filter=${allowedCountryFlowers ? [...allowedCountryFlowers].join(',') : 'ALL'}`);

  const lowerUnfixedWeeks = await loadLowerUnfixedWeeks(orderYear, orderWeek, allowedCountryFlowers);
  if (lowerUnfixedWeeks.length > 0) {
    const labels = lowerUnfixedWeeks.map(w => `${w.OrderYear}-${w.OrderWeek}`).join(', ');
    await logFix('lower_unfixed_block', `${orderYear}/${orderWeek} blocked by ${labels}`, true);
    return res.status(409).json({
      success: false,
      code: 'LOWER_UNFIXED_EXISTS',
      lowerWeeks: lowerUnfixedWeeks,
      error: `[${week}] 확정 불가: 이전 차수 미확정 출고가 남아 있습니다. 먼저 ${labels} 차수를 낮은 차수부터 확정하세요.`,
    });
  }

  // 1. 이미 전체 확정된 경우 안내
  const already = await query(
    `SELECT COUNT(*) AS cnt FROM ShipmentMaster
      WHERE OrderWeek=@wk AND isFix=1 AND isDeleted=0`,
    { wk: { type: sql.NVarChar, value: orderWeek } }
  );

  // 2. 미확정(DetailFix=0) 출고가 있는 CountryFlower 목록
  const categoryTargets = await loadShipmentCategoryTargets(orderWeek, 0, allowedCountryFlowers);

  if (categoryTargets.length === 0) {
    if (allowedCountryFlowers) {
      return res.status(200).json({
        success: true,
        message: `[${week}] 요청 카테고리 확정 대상 없음 (${[...allowedCountryFlowers].join(', ')})`,
        results: [],
      });
    }
    return res.status(400).json({
      success: false,
      error: already.recordset[0].cnt > 0
        ? `[${week}] 이미 모두 확정 상태입니다. 변경하려면 먼저 확정 취소 후 진행하세요.`
        : `[${week}] 확정할 미확정 출고가 없습니다.`,
    });
  }

  const procedureShape = await loadProcedureShape('usp_ShipmentFix');
  if (!procedureShape.hasCountryFlower) {
    const wholeWeekNegativeRows = await loadNegativeGuardRows(orderYear, orderWeek);
    if (wholeWeekNegativeRows.length > 0) {
      return res.status(400).json({
        success: false,
        error: `[${week}] 확정 불가: 현재재고 + 입고 - 출고가 음수인 품목 ${wholeWeekNegativeRows.length}건`,
        code: 'NEGATIVE_STOCK',
        negative: wholeWeekNegativeRows,
      });
    }
  }
  const targets = procedureShape.hasCountryFlower
    ? categoryTargets
    : [{ countryFlower: null, label: 'ALL', mode: 'ALL', isBlank: false }];
  await logFix('fix_targets', `${orderYear}/${orderWeek} targets=${targets.length} shapeCountry=${procedureShape.hasCountryFlower ? 1 : 0}`);

  // 3. SP 호출 — DB 프로시저 구조에 맞춰 카테고리별/차수전체 자동 선택
  const results = [];
  const errors = [];
  const stockResults = [];
  const stockErrors = [];
  for (const target of targets) {
    const cf = target.countryFlower;
    const label = target.label || cf || 'ALL';
    try {
      const prodKeys = await loadShipmentProdKeys(orderWeek, cf, target.mode);
      await logFix('fix_sp_start', `${orderYear}/${orderWeek} ${label} prod=${prodKeys.length}`);
      const r = await runShipmentProcedure('usp_ShipmentFix', procedureShape, orderYear, orderWeek, uid, cf);
      const row = r.recordset?.[0] || {};
      if (row.result === 0) {
        await logFix('stock_calc_start', `${orderYear}/${orderWeek} ${label} prod=${prodKeys.length}`);
        const stock = await runStockCalculationForProducts(orderYear, orderWeek, uid, prodKeys, {
          prefix: 'stock_calc',
          label,
        });
        stockResults.push(...stock.results);
        stockErrors.push(...stock.errors);
        await logFix('stock_calc_done', `${orderYear}/${orderWeek} ${label} ok=${stock.results.length} err=${stock.errors.length}`, stock.errors.length > 0);
        if (stock.errors.length > 0) {
          await logFix(
            'stock_calc_error',
            `${orderYear}/${orderWeek} ${label} ` +
              stock.errors.slice(0, 5).map(e => `pk=${e.prodKey}:${e.message}`).join(' / '),
            true
          );
        }
        results.push({ countryFlower: label, ok: true, message: row.message });
      } else {
        await logFix('fix_sp_error', `${orderYear}/${orderWeek} ${label} code=${row.result} msg=${row.message || ''}`, true);
        errors.push({ countryFlower: label, code: row.result, message: row.message || 'unknown' });
      }
    } catch (e) {
      await logFix('fix_exception', `${orderYear}/${orderWeek} ${label} ${e.message}`, true);
      errors.push({ countryFlower: label, code: -1, message: e.message });
    }
  }

  if (errors.length > 0 && results.length === 0) {
    return res.status(400).json({
      success: false,
      error: '확정 실패 — ' + errors.map(e => `[${e.countryFlower}] ${e.message}`).join(' / '),
      errors,
    });
  }

  await logFix('fix_done', `${orderYear}/${orderWeek} success=${results.length} errors=${errors.length} stockErrors=${stockErrors.length}`, errors.length > 0 || stockErrors.length > 0);
  return res.status(200).json({
    success: errors.length === 0 && stockErrors.length === 0,
    message: `[${week}] ${procedureShape.hasCountryFlower ? `${results.length}개 카테고리` : '차수 전체'} 확정 완료` +
             (errors.length > 0 || stockErrors.length > 0 ? ` (${errors.length + stockErrors.length}개 실패)` : ''),
    results,
    errors,
    stockResults,
    stockErrors,
  });
}

// ── 확정 취소 — 전산 SP usp_ShipmentFixCancel 를 CountryFlower 단위 호출
async function unfix(req, res, week, prodKeyFilter, countryFlowersFilter) {
  if (prodKeyFilter) {
    return res.status(400).json({
      success: false,
      error: '품목 단위 부분 취소는 지원하지 않습니다. 차수 전체를 취소하세요.',
    });
  }

  const orderYear = deriveOrderYear(week);
  const orderWeek = deriveOrderWeek(week);
  const uid       = req.user?.userId || 'admin';
  const allowedCountryFlowers = normalizeCountryFlowerFilter(countryFlowersFilter);
  await logFix('unfix_start', `${orderYear}/${orderWeek} uid=${uid} filter=${allowedCountryFlowers ? [...allowedCountryFlowers].join(',') : 'ALL'}`);

  try {
    // 후속 차수 확정 상태 경고 (웹 자체 안전장치, SP 와 무관)
    const laterFix = await query(
      `SELECT TOP 5 OrderWeek FROM StockMaster
        WHERE OrderWeek > @wk AND isFix=1
        ORDER BY OrderWeek`,
      { wk: { type: sql.NVarChar, value: orderWeek } }
    );
    const laterFixed = laterFix.recordset.map(r => r.OrderWeek);
    if (laterFixed.length > 0 && !req.body.force) {
      return res.status(400).json({
        success: false,
        warning: 'LATER_FIXED_EXISTS',
        laterWeeks: laterFixed,
        error: `후속 차수가 확정 상태입니다: ${laterFixed.join(', ')}\n` +
               `이 차수만 풀면 후속 차수 재고가 옛 값 기반으로 남습니다.\n` +
               `강제 진행: body.force=true 추가`,
      });
    }

    // 확정(DetailFix=1) 상태인 CountryFlower 목록
    const categoryTargets = await loadShipmentCategoryTargets(orderWeek, 1, allowedCountryFlowers);

    if (categoryTargets.length === 0) {
      return res.status(200).json({
        success: true,
        message: `[${week}] 확정 취소 대상 없음 (이미 모두 미확정 상태)`,
        results: [],
      });
    }

    // 카테고리별 SP 호출
    const procedureShape = await loadProcedureShape('usp_ShipmentFixCancel');
    const targets = procedureShape.hasCountryFlower
      ? categoryTargets
      : [{ countryFlower: null, label: 'ALL', mode: 'ALL', isBlank: false }];
    await logFix('unfix_targets', `${orderYear}/${orderWeek} targets=${targets.length} shapeCountry=${procedureShape.hasCountryFlower ? 1 : 0}`);

    const results = [];
    const errors = [];
    const stockResults = [];
    const stockErrors = [];
    for (const target of targets) {
      const cf = target.countryFlower;
      const label = target.label || cf || 'ALL';
      try {
        const prodKeys = await loadShipmentProdKeys(orderWeek, cf, target.mode);
        await logFix('unfix_sp_start', `${orderYear}/${orderWeek} ${label} prod=${prodKeys.length}`);
        const r = await runShipmentProcedure('usp_ShipmentFixCancel', procedureShape, orderYear, orderWeek, uid, cf);
        const row = r.recordset?.[0] || {};
        if (row.result === 0) {
          await logFix('unfix_stock_calc_start', `${orderYear}/${orderWeek} ${label} prod=${prodKeys.length}`);
          const stock = await runStockCalculationForProducts(orderYear, orderWeek, uid, prodKeys, {
            prefix: 'unfix_stock_calc',
            label,
          });
          stockResults.push(...stock.results);
          stockErrors.push(...stock.errors);
          await logFix('unfix_stock_calc_done', `${orderYear}/${orderWeek} ${label} ok=${stock.results.length} err=${stock.errors.length}`, stock.errors.length > 0);
          if (stock.errors.length > 0) {
            await logFix(
              'unfix_stock_calc_error',
              `${orderYear}/${orderWeek} ${label} ` +
                stock.errors.slice(0, 5).map(e => `pk=${e.prodKey}:${e.message}`).join(' / '),
              true
            );
          }
          results.push({ countryFlower: label, ok: true, message: row.message });
        } else {
          await logFix('unfix_sp_error', `${orderYear}/${orderWeek} ${label} code=${row.result} msg=${row.message || ''}`, true);
          errors.push({ countryFlower: label, code: row.result, message: row.message || 'unknown' });
        }
      } catch (e) {
        await logFix('unfix_exception', `${orderYear}/${orderWeek} ${label} ${e.message}`, true);
        errors.push({ countryFlower: label, code: -1, message: e.message });
      }
    }

    const hasStockWarning = stockErrors.length > 0;
    await logFix('unfix_done', `${orderYear}/${orderWeek} success=${results.length} errors=${errors.length} stockErrors=${stockErrors.length}`, errors.length > 0 || stockErrors.length > 0);
    return res.status(200).json({
      success: errors.length === 0,
      message: `[${week}] ${results.length}개 카테고리 확정 취소` +
               (errors.length > 0 ? ` (${errors.length}개 실패)` : '') +
               (hasStockWarning ? ` · 재고 재계산 경고 ${stockErrors.length}건` : '') +
               (laterFixed.length > 0 ? ` ⚠ 후속차수 ${laterFixed.join(',')} 재확정 권장` : ''),
      results,
      errors,
      stockResults,
      stockErrors,
      stockWarning: hasStockWarning,
      laterFixed,
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}
