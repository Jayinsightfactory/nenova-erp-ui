// pages/api/shipment/fix.js
// POST { week, action: 'fix' | 'unfix' }
// 확정: isFix=1 + ProductStock 업데이트 + StockHistory 기록
// 확정취소: isFix=0

import { query, withTransaction, sql } from '../../../lib/db';
import { withAuth } from '../../../lib/auth';
import { reconcileWeekAfterScopedOperation } from '../../../lib/shipmentFixReconcile';
import { evaluatePartialCategoryFixBlock, labelsFromCategoryTargets } from '../../../lib/shipmentFixGuards';
import {
  evaluateCheckFixCancel,
  evaluateUnfixStockCalcResult,
  retryWithDelays,
} from '../../../lib/shipmentFixCancelGuard';
import { calculateStockShortage, roundStockQuantity } from '../../../lib/stockShortage.js';
import { requireOrderYear } from '../../../lib/orderUtils';
import { assertErpEditGuard, advanceErpEditGuard, editErrorResponse } from '../../../lib/erpEditPresence.js';
import { normalizeEstimateEditProdKeys, resolveEstimateEditCategories } from '../../../lib/estimateCategoryCycle.js';
import { lockStockGateOperation, clearStockGateOperation } from '../../../lib/stockGateOperation.js';

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function toOrderYearWeekKey(orderYear, orderWeek) {
  return `${orderYear}${String(orderWeek || '').replace(/-/g, '')}`;
}

async function loadCheckFixCancel(orderYear, orderWeek, allowedCountryFlowers) {
  const oyw = toOrderYearWeekKey(orderYear, orderWeek);
  const nextRes = await query(
    `SELECT TOP 1 OrderYear, OrderWeek, OrderYearWeek
       FROM StockMaster
      WHERE OrderYearWeek > @oyw
      ORDER BY OrderYearWeek, OrderWeek`,
    { oyw: { type: sql.NVarChar, value: oyw } }
  );
  const next = nextRes.recordset[0];
  if (!next) return evaluateCheckFixCancel({ nextWeek: null, products: [] });

  const cfList = allowedCountryFlowers ? [...allowedCountryFlowers] : [];
  const cfSql = cfList.length
    ? `AND vs.CountryFlower IN (${cfList.map((_, i) => `@cf${i}`).join(',')})`
    : '';
  const params = { nextOyw: { type: sql.NVarChar, value: next.OrderYearWeek } };
  cfList.forEach((name, i) => {
    params[`cf${i}`] = { type: sql.NVarChar, value: name };
  });
  const prodRes = await query(
    `SELECT vs.ProdKey AS prodKey, MAX(vs.ProdName) AS prodName, COUNT(*) AS fixCount
       FROM ViewShipment vs
      WHERE vs.OrderYearWeek2 = @nextOyw
        AND ISNULL(vs.DetailFix, 0) = 1
        ${cfSql}
      GROUP BY vs.ProdKey
     HAVING COUNT(*) > 0`,
    params
  );
  return evaluateCheckFixCancel({
    nextWeek: {
      orderYear: next.OrderYear,
      orderWeek: next.OrderWeek,
      orderYearWeek: next.OrderYearWeek,
    },
    products: prodRes.recordset,
  });
}

async function retryStockCalculationForProducts(orderYear, orderWeek, uid, prodKeys, logContext = {}) {
  return retryWithDelays(async (attempt) => {
    if (attempt > 0) {
      await logFix('stock_calc_retry', `${orderYear}/${orderWeek} attempt=${attempt + 1}`);
    }
    const stock = await runStockCalculationForProducts(orderYear, orderWeek, uid, prodKeys, logContext);
    return { ok: stock.errors.length === 0, results: stock.results, errors: stock.errors };
  });
}

function isDeadlockError(err) {
  return Number(err?.number || err?.originalError?.number || err?.precedingErrors?.[0]?.number || 0) === 1205 ||
    /deadlocked on lock resources|deadlock victim/i.test(String(err?.message || ''));
}

async function queryWithDeadlockRetry(q, params = {}, options = {}) {
  const baseDelay = Number(options.baseDelay ?? 250);
  const queryFn = options.queryFn || query;
  // Transaction-bound requests are retried by withTransaction as a whole;
  // retrying a statement inside a doomed transaction is unsafe.
  const retries = options.queryFn ? 0 : Number(options.retries ?? 3);
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await queryFn(q, params);
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
  if (req.method === 'GET') {
    try {
      req.erpWeek = requireOrderYear(req.query?.week || '', req.query?.orderYear || req.query?.year || '');
    } catch (error) {
      return res.status(400).json({ success: false, code: error.code, error: error.message });
    }
    if (req.query.editScope === '1') {
      try {
        const groups = await loadEstimateEditGroups(req.query.editProdKeys);
        return res.status(200).json({ success: true, orderYear: req.erpWeek.orderYear, orderWeek: req.erpWeek.orderWeek, groups });
      } catch (error) {
        return res.status(400).json({ success: false, code: 'ESTIMATE_CATEGORY_SCOPE_INVALID', error: error.message });
      }
    }
    return await validate(req, res);
  }
  if (req.method !== 'POST') return res.status(405).end();
  const { week, prodKey, action, countryFlowers } = req.body;
  if (!week) return res.status(400).json({ success: false, error: 'week 필요' });
  if (!['fix', 'unfix'].includes(action)) return res.status(400).json({ success: false, error: 'action은 fix 또는 unfix' });

  try {
    req.erpWeek = requireOrderYear(week, req.body?.orderYear || req.body?.year || '');
  } catch (error) {
    return res.status(400).json({ success: false, code: error.code, error: error.message });
  }

  try {
    if (action === 'unfix') return await unfix(req, res, week, prodKey, countryFlowers);
    return await fix(req, res, week, prodKey, countryFlowers);
  } catch (err) {
    const response = editErrorResponse(err);
    return res.status(response.statusCode).json(response.body);
  }
});

async function assertOptionalFixEditGuard(req) {
  if (!req.body?.editGuard) return;
  const custKey = Number(req.body?.custKey);
  if (!Number.isInteger(custKey) || custKey <= 0) {
    const error = new Error('확정 작업의 편집 보호에는 선택 업체가 필요합니다.');
    error.code = 'ERP_EDIT_SCOPE_INVALID';
    error.statusCode = 400;
    throw error;
  }
  // fix/unfix is a whole-week EXE stored-procedure operation.  When the web
  // page opted into a customer lease, validate that customer scope before the
  // procedure starts; legacy EXE/API callers remain unchanged.
  await withTransaction((tQ) => assertErpEditGuard(tQ, {
    orderYear: req.erpWeek.orderYear,
    orderWeek: req.erpWeek.orderWeek,
    custKey,
  }, req.user, req.body));
}

async function loadEstimateEditGroups(rawKeys, requestedCategories, q = query, lock = false) {
  const keys = normalizeEstimateEditProdKeys(rawKeys);
  const params = Object.fromEntries(keys.map((key, i) => [`pk${i}`, { type: sql.Int, value: key }]));
  const result = await q(`SELECT ProdKey, CountryFlower, isDeleted FROM Product ${lock ? 'WITH (UPDLOCK,HOLDLOCK)' : ''}
    WHERE ProdKey IN (${keys.map((_, i) => `@pk${i}`).join(',')})`, params);
  return resolveEstimateEditCategories(keys, result.recordset || [], requestedCategories);
}

async function resolveFixCategoryScope(req, countryFlowersFilter) {
  if (req.body?.editProdKeys === undefined) return normalizeCountryFlowerFilter(countryFlowersFilter);
  if (!Array.isArray(countryFlowersFilter) || countryFlowersFilter.length !== 1) {
    const error = new Error('견적서 수정은 확인한 품종 한 개씩 처리합니다. 수정 품종을 다시 조회하세요.');
    error.code = 'ESTIMATE_CATEGORY_SCOPE_INVALID'; error.statusCode = 400; throw error;
  }
  if (!req.body.editGuard || !(Number(req.body.custKey) > 0)) {
    const error = new Error('견적서 품종별 저장에는 선택 업체의 편집 보호가 필요합니다. 다시 조회하세요.');
    error.code = 'ERP_EDIT_SCOPE_INVALID'; error.statusCode = 400; throw error;
  }
  if (req.body.autoStockAdd || req.body.confirmAutoStockAdd) {
    const error = new Error('견적서 수정에서는 재고를 자동 보충하지 않습니다. 재고조정 화면에서 확인하세요.');
    error.code = 'ESTIMATE_CATEGORY_SCOPE_INVALID'; error.statusCode = 400; throw error;
  }
  try {
    req.estimateEditGroups = await loadEstimateEditGroups(req.body.editProdKeys, countryFlowersFilter);
    return new Set(req.estimateEditGroups.map(g => g.countryFlower));
  } catch (error) {
    error.code = 'ESTIMATE_CATEGORY_SCOPE_INVALID'; error.statusCode = 400; throw error;
  }
}

async function runFixTargetProcedure(name, shape, orderYear, orderWeek, uid, cf, req, skipStockCalc) {
  if (req.estimateEditGroups && !shape.hasCountryFlower) throw new Error('전산의 품종별 확정 기능을 확인하지 못했습니다. 전체 품종을 대신 변경하지 않습니다.');
  // One category + its lease baseline commit together. A failed SP rolls back
  // this category, not earlier successful categories reported to the client.
  return withTransaction(async (tQ) => {
    const gateOperation = await lockStockGateOperation(tQ, sql, {
      orderYear, orderWeek, action: name === 'usp_ShipmentFixCancel' ? 'CANCEL' : 'FIX',
    });
    const scope = { orderYear, orderWeek, custKey: Number(req.body.custKey) };
    if (req.body?.editGuard) await assertErpEditGuard(tQ, scope, req.user, req.body);
    if (req.estimateEditGroups) await loadEstimateEditGroups(req.body.editProdKeys, [cf], tQ, true);
    const result = await runShipmentProcedure(name, shape, orderYear, orderWeek, uid, cf, tQ);
    const row = result.recordset?.[0];
    if (!row || row.result !== 0 || (row.returnCode !== undefined && row.returnCode !== 0)) throw new Error(row?.message || '품종별 확정 처리 결과를 확인하지 못했습니다.');
    if (skipStockCalc) {
      await clearStockGateOperation(tQ, sql, gateOperation, { nativeResult: row.result, nativeReturnCode: row.returnCode });
    }
    if (req.body?.editGuard) await advanceErpEditGuard(tQ, scope, req.user, req.body);
    return result;
  });
}

// usp_ShipmentFix/Cancel may run several independent transactions.  Advance
// only after the complete operation reports success; a partial failure stays
// stale and forces a fresh ERP read rather than concealing changed rows.
async function advanceOptionalFixEditGuard(req) {
  if (!req.body?.editGuard) return null;
  const custKey = Number(req.body?.custKey);
  return withTransaction((tQ) => advanceErpEditGuard(tQ, {
    orderYear: req.erpWeek.orderYear,
    orderWeek: req.erpWeek.orderWeek,
    custKey,
  }, req.user, req.body));
}

// ── 확정 전 사전검증 (GET ?week=16-01)
// 1. 주문 없는데 출고 있는 품목 (ghost)
// 2. 같은 거래처+품목에 중복 출고 레코드
// 3. 마이너스 잔량 품목
async function validate(req, res) {
  const { week } = req.query;
  if (!week) return res.status(400).json({ success: false, error: 'week 필요' });
  try {
    const { orderYear, orderWeek } = req.erpWeek;
    const orderYearWeek = orderYear + String(orderWeek || '').replace('-', '');
    const wk = { type: sql.NVarChar, value: orderWeek };
    const yr = { type: sql.NVarChar, value: orderYear };

    // 1. 주문 없는 출고 (OrderDetail 없는데 ShipmentDetail 있음)
    const ghostResult = await query(
      `SELECT DISTINCT p.ProdName, c.CustName, sd.OutQuantity,
         sm.ShipmentKey, sm.isFix, sm.WebCreated
       FROM ShipmentDetail sd
       JOIN ShipmentMaster sm ON sd.ShipmentKey = sm.ShipmentKey
       JOIN Product p ON sd.ProdKey = p.ProdKey
       JOIN Customer c ON sm.CustKey = c.CustKey
      WHERE sm.OrderYear = @yr AND sm.OrderWeek = @wk AND sm.isDeleted = 0 AND sd.OutQuantity > 0
         AND NOT EXISTS (
           SELECT 1 FROM OrderDetail od
           JOIN OrderMaster om ON od.OrderMasterKey = om.OrderMasterKey
           WHERE om.OrderYear = @yr AND om.CustKey = sm.CustKey AND om.OrderWeek = @wk
             AND od.ProdKey = sd.ProdKey AND om.isDeleted = 0 AND od.isDeleted = 0
         )
       ORDER BY c.CustName, p.ProdName`,
      { wk, yr }
    );

    // 2. 중복 출고 (같은 거래처+품목+차수에 ShipmentDetail 2건 이상)
    const dupResult = await query(
      `SELECT p.ProdName, c.CustName,
         COUNT(sd.SdetailKey) AS cnt,
         SUM(sd.OutQuantity) AS totalQty,
         STUFF((
           SELECT ',' + CAST(sm2.ShipmentKey AS NVARCHAR(20))
             FROM ShipmentDetail sd2
             JOIN ShipmentMaster sm2 ON sd2.ShipmentKey = sm2.ShipmentKey
            WHERE sm2.OrderYear = @yr AND sm2.OrderWeek = @wk
              AND sm2.isDeleted = 0
              AND sm2.CustKey = sm.CustKey
              AND sd2.ProdKey = sd.ProdKey
              AND sd2.OutQuantity > 0
            FOR XML PATH(''), TYPE
         ).value('.', 'NVARCHAR(MAX)'), 1, 1, '') AS shipKeys
       FROM ShipmentDetail sd
       JOIN ShipmentMaster sm ON sd.ShipmentKey = sm.ShipmentKey
       JOIN Product p ON sd.ProdKey = p.ProdKey
       JOIN Customer c ON sm.CustKey = c.CustKey
       WHERE sm.OrderYear = @yr AND sm.OrderWeek = @wk AND sm.isDeleted = 0 AND sd.OutQuantity > 0
       GROUP BY sm.CustKey, sd.ProdKey, p.ProdName, c.CustName
       HAVING COUNT(sd.SdetailKey) > 1
       ORDER BY c.CustName, p.ProdName`,
      { wk, yr }
    );

    // 3. 마이너스 잔량
    const negResult = await query(
      `WITH out_qty AS (
         SELECT sd.ProdKey, SUM(ISNULL(sd.OutQuantity, 0)) AS outQty
         FROM ShipmentMaster sm
         JOIN ShipmentDetail sd ON sd.ShipmentKey = sm.ShipmentKey
         WHERE sm.OrderYear = @yr AND sm.OrderWeek = @wk AND sm.isDeleted = 0 AND ISNULL(sd.OutQuantity, 0) > 0
         GROUP BY sd.ProdKey
       ),
       in_qty AS (
         SELECT wd.ProdKey, SUM(ISNULL(wd.OutQuantity, 0)) AS inQty
         FROM WarehouseMaster wm
         JOIN WarehouseDetail wd ON wd.WarehouseKey = wm.WarehouseKey
         WHERE wm.OrderYear = @yr AND wm.OrderWeek = @wk AND wm.isDeleted = 0
         GROUP BY wd.ProdKey
       ),
       adjust_qty AS (
         SELECT sh.ProdKey, SUM(ISNULL(sh.AfterValue,0) - ISNULL(sh.BeforeValue,0)) AS adjustQty
         FROM StockHistory sh
         WHERE sh.OrderYear = @yr AND sh.OrderWeek = @wk
           AND (sh.ChangeType IS NULL OR sh.ChangeType NOT IN (N'확정', N'확정취소', N'입고', N'출고'))
         GROUP BY sh.ProdKey
       )
       SELECT
         p.ProdKey,
         p.ProdName,
         p.FlowerName,
         p.CounName,
         ISNULL(prev.prevStock, 0) AS prevStock,
         ISNULL(iq.inQty, 0) + ISNULL(aq.adjustQty, 0) AS inQty,
         ISNULL(aq.adjustQty, 0) AS adjustQty,
         ISNULL(oq.outQty, 0) AS outQty,
         ISNULL(prev.prevStock, 0) + ISNULL(iq.inQty, 0) + ISNULL(aq.adjustQty, 0) - ISNULL(oq.outQty, 0) AS remain
       FROM out_qty oq
       JOIN Product p ON p.ProdKey = oq.ProdKey AND p.isDeleted = 0
       LEFT JOIN in_qty iq ON iq.ProdKey = oq.ProdKey
       LEFT JOIN adjust_qty aq ON aq.ProdKey = oq.ProdKey
       OUTER APPLY (
         SELECT TOP 1 ps.Stock AS prevStock
         FROM ProductStock ps
         JOIN StockMaster sm2 ON ps.StockKey = sm2.StockKey
         WHERE ps.ProdKey = p.ProdKey
           AND ISNULL(CAST(sm2.OrderYear AS NVARCHAR(4)), @yr) = @yr
           AND ISNULL(CAST(sm2.OrderYear AS NVARCHAR(4)), @yr) + REPLACE(sm2.OrderWeek, '-', '') < @ywk
         ORDER BY ISNULL(CAST(sm2.OrderYear AS NVARCHAR(4)), @yr) + REPLACE(sm2.OrderWeek, '-', '') DESC
       ) prev
       WHERE ISNULL(prev.prevStock, 0) + ISNULL(iq.inQty, 0) + ISNULL(aq.adjustQty, 0) - ISNULL(oq.outQty, 0) < 0
       ORDER BY p.FlowerName, p.ProdName`,
      {
        wk,
        yr,
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

    // 4. 입고/수동재고조정 반영 후 가용수량 없는 출고
    //    이 케이스가 견적서에서 "입고 0인데 출고 5" 처럼 보여 작업 오류 유발
    const noInResult = await query(
      `WITH out_qty AS (
         SELECT sd.ProdKey, SUM(ISNULL(sd.OutQuantity, 0)) AS outQty
         FROM ShipmentDetail sd
         JOIN ShipmentMaster sm ON sd.ShipmentKey = sm.ShipmentKey
         WHERE sm.OrderYear = @yr AND sm.OrderWeek = @wk AND sm.isDeleted = 0 AND sd.OutQuantity > 0
         GROUP BY sd.ProdKey
       ),
       in_qty AS (
         SELECT ProdKey, SUM(qty) AS inQty
         FROM (
           SELECT wd.ProdKey, ISNULL(wd.OutQuantity, 0) AS qty
           FROM WarehouseDetail wd
           JOIN WarehouseMaster wm ON wd.WarehouseKey = wm.WarehouseKey
           WHERE wm.OrderYear = @yr AND wm.OrderWeek = @wk AND wm.isDeleted = 0
           UNION ALL
           SELECT sh.ProdKey, ISNULL(sh.AfterValue,0) - ISNULL(sh.BeforeValue,0) AS qty
           FROM StockHistory sh
           WHERE sh.OrderYear = @yr AND sh.OrderWeek = @wk
             AND (sh.ChangeType IS NULL OR sh.ChangeType NOT IN (N'확정', N'확정취소', N'입고', N'출고'))
         ) x
         GROUP BY ProdKey
       )
       SELECT p.ProdName, p.FlowerName, p.CounName,
         oq.outQty,
         ISNULL(iq.inQty, 0) AS inQty
       FROM out_qty oq
       JOIN Product p ON oq.ProdKey = p.ProdKey
       LEFT JOIN in_qty iq ON iq.ProdKey = oq.ProdKey
       WHERE ISNULL(iq.inQty, 0) <= 0
       ORDER BY p.FlowerName, p.ProdName`,
      { wk, yr }
    );

    // 5. 음수 이월 (검증 사각지대) — 그 차수 스냅샷이 음수인데 그 주 출고가 없어
    //    확정 잔량검사(미확정 출고 있는 품목만 검사)를 아예 안 타는 품목. 경고 전용(차단 안 함).
    //    2026-07-14 조사: "음수인데 확정됨"의 실체 — 23~26차에 쌓인 이월 음수가 이 경로로 통과.
    const carryResult = await query(
      `SELECT p.ProdKey, p.ProdName, p.FlowerName, p.CounName, ps.Stock
         FROM ProductStock ps
         JOIN StockMaster smk ON smk.StockKey = ps.StockKey
         JOIN Product p ON p.ProdKey = ps.ProdKey AND p.isDeleted = 0
        WHERE smk.OrderYear = @yr AND smk.OrderWeek = @wk
          AND ISNULL(CAST(smk.OrderYear AS NVARCHAR(4)), @yr) = @yr
          AND ps.Stock < -0.01
          AND NOT EXISTS (
            SELECT 1 FROM ShipmentDetail sd
            JOIN ShipmentMaster sm3 ON sm3.ShipmentKey = sd.ShipmentKey
            WHERE sd.ProdKey = p.ProdKey AND sm3.OrderYear = @yr AND sm3.OrderWeek = @wk
              AND sm3.isDeleted = 0 AND ISNULL(sd.OutQuantity, 0) > 0
          )
        ORDER BY ps.Stock ASC`,
      { wk, yr }
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
      negativeCarry: carryResult.recordset, // 음수 이월 (그 주 출고 없음 → 잔량검사 사각) — 경고 전용
    });
  } catch (err) {
    const response = editErrorResponse(err);
    return res.status(response.statusCode).json(response.body);
  }
}

async function loadNegativeGuardRows(orderYear, orderWeek) {
  // EXE 재고 화면과 동일 공식: 전차수 재고 + 입고 + 조정 - 출고.
  // 현재차수 ProductStock은 확정/재계산 시점에 따라 이미 출고가 반영됐을 수 있으므로
  // 다시 출고를 빼는 기준으로 사용하지 않는다. 전차수 음수 이월도 반드시 차단한다.
  const result = await query(
    `DECLARE @ywk NVARCHAR(20) = @yr + REPLACE(@wk, '-', '');
     WITH incoming AS (
       SELECT ProdKey, SUM(OutQuantity) qty FROM ViewWarehouse
        WHERE OrderYear = @yr AND OrderWeek = @wk GROUP BY ProdKey
     ), outgoing AS (
       SELECT ProdKey, SUM(OutQuantity) qty FROM ViewShipment
        WHERE OrderYear = @yr AND OrderWeek = @wk GROUP BY ProdKey
     ), adjustment AS (
       SELECT sh.ProdKey, SUM(sh.AfterValue - sh.BeforeValue) qty
         FROM StockHistory sh
         JOIN CodeInfo ci ON ci.Category=N'StockType' AND ci.Descr=sh.ChangeType
        WHERE sh.OrderYear=@yr AND sh.OrderWeek=@wk GROUP BY sh.ProdKey
     )
     SELECT p.ProdKey, p.ProdName, p.FlowerName, p.CounName, p.CountryFlower,
            ISNULL(prev.Stock,0) productStock, ISNULL(prev.Stock,0) prevStock,
            ISNULL(i.qty,0) + ISNULL(a.qty,0) inQty,
            ISNULL(o.qty,0) outQty,
            ISNULL(prev.Stock,0)+ISNULL(i.qty,0)+ISNULL(a.qty,0)-ISNULL(o.qty,0) remain,
            -(ISNULL(prev.Stock,0)+ISNULL(i.qty,0)+ISNULL(a.qty,0)-ISNULL(o.qty,0)) shortage
       FROM Product p
       OUTER APPLY (
         SELECT TOP 1 ps.Stock FROM StockMaster sm
         JOIN ProductStock ps ON ps.StockKey=sm.StockKey AND ps.ProdKey=p.ProdKey
         WHERE sm.OrderYear=@yr
           AND CAST(sm.OrderYear AS NVARCHAR(4)) + REPLACE(sm.OrderWeek,'-','') < @ywk
         ORDER BY sm.OrderYearWeek DESC, sm.StockKey DESC
       ) prev
       LEFT JOIN incoming i ON i.ProdKey=p.ProdKey
       LEFT JOIN outgoing o ON o.ProdKey=p.ProdKey
       LEFT JOIN adjustment a ON a.ProdKey=p.ProdKey
      WHERE p.isDeleted=0
        AND (i.ProdKey IS NOT NULL OR o.ProdKey IS NOT NULL OR ISNULL(prev.Stock,0)<0)
        AND ROUND(ISNULL(prev.Stock,0)+ISNULL(i.qty,0)+ISNULL(a.qty,0)-ISNULL(o.qty,0),2) < 0
      ORDER BY p.FlowerName,p.ProdName`,
    {
      yr: { type: sql.NVarChar, value: orderYear },
      wk: { type: sql.NVarChar, value: orderWeek },
    }
  );

  return result.recordset.map(r => ({
    ...r,
    remain: Math.round(Number(r.remain || 0) * 1000) / 1000,
    shortage: Math.round(Number(r.shortage || 0) * 1000) / 1000,
    productRemain: Math.round(Number(r.remain || 0) * 1000) / 1000,
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
    return `DECLARE @r INT, @m NVARCHAR(MAX), @ret INT;
         EXEC @ret=dbo.${procedureName}
              @OrderYear     = @yr,
              @OrderWeek     = @wk,${countryArg}
              @iUserID       = @uid,
              @oResult       = @r OUTPUT,
              @oMessage      = @m OUTPUT;
         SELECT @r AS result, @m AS message, @ret AS returnCode;`;
  }
  return `EXEC dbo.${procedureName}
              @OrderYear     = @yr,
              @OrderWeek     = @wk,${countryArg}
              @iUserID       = @uid;
          SELECT 0 AS result, N'' AS message;`;
}

async function runShipmentProcedure(procedureName, shape, orderYear, orderWeek, uid, countryFlower, queryFn) {
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
    queryFn,
  });
}

async function loadShipmentProdKeys(orderYear, orderWeek, countryFlower, targetMode = 'CATEGORY') {
  const result = await query(
    `SELECT DISTINCT sd.ProdKey
       FROM ShipmentMaster sm
       JOIN ShipmentDetail sd ON sd.ShipmentKey = sm.ShipmentKey
       JOIN Product p ON p.ProdKey = sd.ProdKey AND p.isDeleted = 0
      WHERE sm.OrderYear = @yr
        AND sm.OrderWeek = @wk
        AND sm.isDeleted = 0
        AND ISNULL(sd.OutQuantity, 0) > 0
        AND (
          @mode = N'ALL'
          OR (@mode = N'BLANK' AND NULLIF(LTRIM(RTRIM(ISNULL(p.CountryFlower, N''))), N'') IS NULL)
          OR (@mode = N'CATEGORY' AND p.CountryFlower = @cf)
        )
      ORDER BY sd.ProdKey`,
    {
      yr: { type: sql.NVarChar, value: orderYear },
      wk: { type: sql.NVarChar, value: orderWeek },
      cf: { type: sql.NVarChar, value: countryFlower || null },
      mode: { type: sql.NVarChar, value: targetMode },
    }
  );
  return result.recordset.map(r => Number(r.ProdKey)).filter(Boolean);
}

function normalizeStockProdKeys(stockProdKeys) {
  const values = Array.isArray(stockProdKeys)
    ? stockProdKeys
    : String(stockProdKeys || '').split(',');
  const keys = values.map(v => Number(v)).filter(Number.isFinite);
  return [...new Set(keys)];
}

function narrowStockProdKeys(prodKeys, stockProdKeys) {
  // usp_ShipmentFix/Cancel works at CountryFlower scope and changes Product.Stock
  // for every shipment detail in that category. Even though usp_StockCalculation
  // accepts a ProdKey, post-fix recalculation must keep the same category scope.
  return prodKeys;
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
  // Native EXE FIX/CANCEL commits a pending calculation then opens a separate
  // connection for ProdKey=0. The owner-aware gate permits that exact handoff;
  // a pending week must not be released by an incomplete one-product calculation.
  const gate = await (logContext.queryFn || query)(
    `SELECT Mode, OrderYear, OrderWeek FROM dbo.NenovaStockWeekGate WHERE GateKey='1'`
  );
  const pending = gate.recordset?.[0];
  const fullPendingHandoff = pending?.Mode === 'WAIT_CALC'
    && String(pending.OrderYear) === String(orderYear) && String(pending.OrderWeek) === String(orderWeek);

  // 2026-07-14: 품목이 많으면 exe 방식(ProdKey=0 전 품목 단일 호출) — nenova.exe 는 모든 흐름에서
  // uspStockCalculation(yr, wk, 0) 한 번만 부른다(디컴파일 확인). 품목별 순차 호출은 호출마다
  // 이후 차수 전체를 cascade 재계산해 카테고리당 수 분씩 걸리던 병목. prodKey=0 결과 마커를 보고
  // reconcileWeekAfterScopedOperation 이 중복 재계산을 건너뛴다.
  if (uniqueKeys.length > 5 || fullPendingHandoff) {
    try {
      await logFix(`${logPrefix}_all_start`, `${orderYear}/${orderWeek} ${logLabel} 전품목 단일호출 (요청 ${total}품목)`);
      const r = await queryWithDeadlockRetry(
        `DECLARE @r INT, @m NVARCHAR(200), @ret INT;
         EXEC @ret=dbo.usp_StockCalculation
              @OrderYear = @yr,
              @OrderWeek = @wk,
              @ProdKey   = 0,
              @iUserID   = @uid,
              @oResult   = @r OUTPUT,
              @oMessage  = @m OUTPUT;
         SELECT @r AS result, @m AS message, @ret AS returnCode;`,
        {
          yr:  { type: sql.NVarChar, value: orderYear },
          wk:  { type: sql.NVarChar, value: orderWeek },
          uid: { type: sql.NVarChar, value: uid },
        },
        { retries: 4, baseDelay: 300, queryFn: logContext.queryFn }
      );
      const row = r.recordset?.[0] || {};
      if (row.result === 0 && row.returnCode === 0) {
        results.push({ prodKey: 0, ok: true, all: true, message: row.message || '' });
        await logFix(`${logPrefix}_all_done`, `${orderYear}/${orderWeek} ${logLabel} 전품목 OK`);
      } else {
        errors.push({ prodKey: 0, code: row.result ?? row.returnCode ?? -1, message: row.message || '재고 계산 완료 응답을 확인하지 못했습니다.' });
        await logFix(`${logPrefix}_all_error`, `${orderYear}/${orderWeek} ${logLabel} ${row.message || ''}`, true);
      }
    } catch (e) {
      errors.push({ prodKey: 0, code: -1, message: e.message });
      await logFix(`${logPrefix}_all_error`, `${orderYear}/${orderWeek} ${logLabel} ${e.message}`, true);
    }
    return { results, errors };
  }

  await runLimited(uniqueKeys, 1, async (prodKey) => {
    try {
      await logFix(`${logPrefix}_item_start`, `${orderYear}/${orderWeek} ${logLabel} pk=${prodKey} ${completed + 1}/${total}`);
      const r = await queryWithDeadlockRetry(
        `DECLARE @r INT, @m NVARCHAR(200), @ret INT;
         EXEC @ret=dbo.usp_StockCalculation
              @OrderYear = @yr,
              @OrderWeek = @wk,
              @ProdKey   = @pk,
              @iUserID   = @uid,
              @oResult   = @r OUTPUT,
              @oMessage  = @m OUTPUT;
         SELECT @r AS result, @m AS message, @ret AS returnCode;`,
        {
          yr:  { type: sql.NVarChar, value: orderYear },
          wk:  { type: sql.NVarChar, value: orderWeek },
          pk:  { type: sql.Int, value: prodKey },
          uid: { type: sql.NVarChar, value: uid },
        },
        { retries: 4, baseDelay: 300, queryFn: logContext.queryFn }
      );
      const row = r.recordset?.[0] || {};
      if (row.result === 0 && row.returnCode === 0) {
        results.push({ prodKey, ok: true, message: row.message || '' });
      } else {
        const error = { prodKey, code: row.result ?? row.returnCode ?? -1, message: row.message || '재고 계산 완료 응답을 확인하지 못했습니다.' };
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

async function loadShipmentCategoryTargets(orderYear, orderWeek, detailFixValue, allowedCountryFlowers) {
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
      WHERE sm.OrderYear=@yr AND sm.OrderWeek=@wk AND sm.isDeleted = 0
        AND ISNULL(sd.isFix, 0) = @detailFix
        AND sd.OutQuantity > 0`,
    {
      yr: { type: sql.NVarChar, value: orderYear },
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
  };
  countryFlowers.forEach((cf, i) => {
    params[`cf${i}`] = { type: sql.NVarChar, value: cf };
  });
  const result = await query(
    `SELECT TOP 20
       CAST(sm.OrderYear AS NVARCHAR(4)) AS OrderYear,
       sm.OrderWeek,
       COUNT(sd.SdetailKey) AS detailCount
     FROM ShipmentMaster sm
     JOIN ShipmentDetail sd ON sd.ShipmentKey = sm.ShipmentKey
     JOIN Product p ON p.ProdKey = sd.ProdKey AND p.isDeleted = 0
     WHERE sm.isDeleted = 0
       AND ISNULL(sd.OutQuantity, 0) > 0
       AND ISNULL(sd.isFix, 0) = 0
       AND CAST(sm.OrderYear AS NVARCHAR(4)) = @orderYear
       AND CAST(sm.OrderYear AS NVARCHAR(4)) + REPLACE(sm.OrderWeek, '-', '') < @currentKey
       ${cfWhere}
     GROUP BY CAST(sm.OrderYear AS NVARCHAR(4)), sm.OrderWeek
     ORDER BY CAST(sm.OrderYear AS NVARCHAR(4)), sm.OrderWeek`,
    params
  );
  return result.recordset || [];
}

async function loadLowerUnfixedDetails(orderYear, orderWeek) {
  const currentKey = String(orderYear) + String(orderWeek || '').replace('-', '');
  const label = countryFlowerLabelSql('p');
  const result = await query(
    `WITH targetWeeks AS (
       SELECT TOP 20 CAST(sm.OrderYear AS NVARCHAR(4)) AS OrderYear, sm.OrderWeek
         FROM ShipmentMaster sm
         JOIN ShipmentDetail sd ON sd.ShipmentKey=sm.ShipmentKey
        WHERE sm.isDeleted=0 AND ISNULL(sd.OutQuantity,0)>0 AND ISNULL(sd.isFix,0)=0
          AND CAST(sm.OrderYear AS NVARCHAR(4))=@orderYear
          AND CAST(sm.OrderYear AS NVARCHAR(4))+REPLACE(sm.OrderWeek,'-','') < @currentKey
        GROUP BY CAST(sm.OrderYear AS NVARCHAR(4)), sm.OrderWeek
        ORDER BY CAST(sm.OrderYear AS NVARCHAR(4)), sm.OrderWeek
     )
     SELECT tw.OrderYear,tw.OrderWeek,${label} AS category,
            p.ProdKey,p.ProdName,p.FlowerName,p.CounName,
            COUNT(sd.SdetailKey) AS detailCount,SUM(ISNULL(sd.OutQuantity,0)) AS outQty
       FROM targetWeeks tw
       JOIN ShipmentMaster sm ON CAST(sm.OrderYear AS NVARCHAR(4))=tw.OrderYear AND sm.OrderWeek=tw.OrderWeek AND sm.isDeleted=0
       JOIN ShipmentDetail sd ON sd.ShipmentKey=sm.ShipmentKey AND ISNULL(sd.OutQuantity,0)>0 AND ISNULL(sd.isFix,0)=0
       JOIN Product p ON p.ProdKey=sd.ProdKey AND p.isDeleted=0
      GROUP BY tw.OrderYear,tw.OrderWeek,${label},p.ProdKey,p.ProdName,p.FlowerName,p.CounName
      ORDER BY tw.OrderYear,tw.OrderWeek,${label},p.ProdName`,
    {
      currentKey: { type: sql.NVarChar, value: currentKey },
      orderYear: { type: sql.NVarChar, value: orderYear },
    }
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

  const { orderYear, orderWeek } = req.erpWeek;
  await assertOptionalFixEditGuard(req);
  const uid       = req.user?.userId || 'admin';
  const allowedCountryFlowers = await resolveFixCategoryScope(req, countryFlowersFilter);
  const requestedStockProdKeys = normalizeStockProdKeys(req.body?.stockProdKeys);
  // skipStockCalc: 확정/해제 SP는 항상 실행한다. 이 플래그는 usp_StockCalculation
  // 품목별 합산만 생략한다. 확정차수 편집 사이클이 수량 이상을 막은 뒤 중간 합산을
  // 건너뛸 때 클라이언트가 보낸다. 음수재고 보정 경로는 이 플래그를 쓰지 않는다.
  const skipStockCalc = req.body?.skipStockCalc === true;
  await logFix('fix_start', `${orderYear}/${orderWeek} uid=${uid} filter=${allowedCountryFlowers ? [...allowedCountryFlowers].join(',') : 'ALL'}${skipStockCalc ? ' skipStockCalc' : ''}`);

  const lowerUnfixedWeeks = await loadLowerUnfixedWeeks(orderYear, orderWeek, req.estimateEditGroups ? allowedCountryFlowers : null);
  if (lowerUnfixedWeeks.length > 0) {
    const lowerDetails = (await loadLowerUnfixedDetails(orderYear, orderWeek))
      .filter(row => !req.estimateEditGroups || allowedCountryFlowers.has(row.category));
    const labels = lowerUnfixedWeeks.map(w => `${w.OrderYear}-${w.OrderWeek}`).join(', ');
    await logFix('lower_unfixed_block', `${orderYear}/${orderWeek} blocked by ${labels} (all-categories)`, true);
    return res.status(409).json({
      success: false,
      code: 'LOWER_UNFIXED_EXISTS',
      lowerWeeks: lowerUnfixedWeeks,
      lowerDetails,
      error: `[${week}] 확정 불가: 이전 차수에 미확정 출고가 남아 있습니다 (${req.estimateEditGroups ? '수정 품종' : '전 카테고리'} 기준). 먼저 ${labels} 차수를 낮은 차수부터 확정하세요.`,
    });
  }

  const allUnfixedTargets = await loadShipmentCategoryTargets(orderYear, orderWeek, 0, null);
  // EXE permits selected CountryFlower fix. Keep the legacy full-week UI
  // policy separate; validated Estimate edits must not include unrelated rows.
  const partialFixGuard = req.estimateEditGroups ? { blocked: false } : evaluatePartialCategoryFixBlock(allUnfixedTargets, allowedCountryFlowers);
  if (partialFixGuard.blocked) {
    await logFix('partial_category_fix_block', `${orderYear}/${orderWeek} remaining=${partialFixGuard.remainingCategories?.join(',')}`, true);
    return res.status(409).json({
      success: false,
      code: partialFixGuard.code,
      unfixedCount: partialFixGuard.unfixedCount,
      remainingCategories: partialFixGuard.remainingCategories,
      error: partialFixGuard.error,
    });
  }

  // 사용자가 음수재고 경고 화면에서 명시적으로 확인한 경우에만 실행한다.
  // 환경변수만으로 켜지지 않으며, 일반 확정 요청에는 절대 적용하지 않는다.
  const autoStockAddRequested = req.body?.autoStockAdd === true && req.body?.confirmAutoStockAdd === true;
  let stockAdjustments = [];
  if (autoStockAddRequested) {
    const negForAdd = (await loadNegativeGuardRows(orderYear, orderWeek))
      .filter(r => Number(r.remain) < 0)
      .map(r => ({ ...r, addQty: calculateStockShortage(r) }))
      .filter(r => r.addQty > 0);
    if (negForAdd.length) {
      const committedAdjustments = [];
      try {
        await withTransaction(async (tQuery) => {
          const pendingAdjustments = [];
          for (const r of negForAdd) {
            // StockHistory의 Before/After는 전산 재고관리와 동일하게 Product.Stock 기준으로 기록한다.
            const beforeResult = await tQuery(
              'SELECT ISNULL(Stock, 0) AS Stock FROM Product WITH (UPDLOCK, HOLDLOCK) WHERE ProdKey=@pk',
              { pk: { type: sql.Int, value: Number(r.ProdKey) } },
            );
            const before = roundStockQuantity(beforeResult.recordset?.[0]?.Stock ?? 0);
            const after = roundStockQuantity(before + r.addQty);
            await tQuery(
              `INSERT INTO StockHistory
                 (ChangeDtm, OrderYear, OrderWeek, ChangeID, ChangeType, ColumName, BeforeValue, AfterValue, Descr, ProdKey)
               VALUES (GETDATE(), @yr, @wk, @uid, N'재고조정', N'재고수량', @before, @after, @descr, @pk)`,
              {
                yr: { type: sql.NVarChar, value: orderYear },
                wk: { type: sql.NVarChar, value: orderWeek },
                uid: { type: sql.NVarChar, value: uid },
                before: { type: sql.Float, value: before },
                after: { type: sql.Float, value: after },
                descr: { type: sql.NVarChar, value: `[확정용 재고조정 +${r.addQty}] ${r.ProdName} 부족분 보충` },
                pk: { type: sql.Int, value: Number(r.ProdKey) },
              },
            );
            // FormStockAdd.btnSave_Click 순서와 동일하게 실시간 재고를 먼저 갱신한다.
            // usp_StockCalculation은 ProductStock 스냅샷만 계산하며 Product.Stock은 바꾸지 않는다.
            await tQuery(
              'UPDATE Product SET Stock=ROUND(@after, 2) WHERE ProdKey=@pk',
              {
                after: { type: sql.Float, value: after },
                pk: { type: sql.Int, value: Number(r.ProdKey) },
              },
            );
            pendingAdjustments.push({
              prodKey: Number(r.ProdKey),
              prodName: r.ProdName,
              shortage: Number(r.shortage || r.addQty),
              added: r.addQty,
              before,
              after,
            });
          }

          const stock = await runStockCalculationForProducts(
            orderYear,
            orderWeek,
            uid,
            negForAdd.map(r => Number(r.ProdKey)),
            { prefix: 'auto_stock_add', label: '재고부족분보정후확정', queryFn: tQuery },
          );
          if (stock.errors.length > 0) {
            const error = new Error('재고 부족분 보정 후 재계산에 실패했습니다. 재고조정은 롤백되었습니다.');
            error.code = 'AUTO_STOCK_CALC_FAILED';
            error.stockErrors = stock.errors;
            throw error;
          }
          committedAdjustments.push(...pendingAdjustments);
        });
        stockAdjustments = committedAdjustments;
        await logFix(
          'auto_stock_add',
          `${orderYear}/${orderWeek} added exact shortage for ${stockAdjustments.length} products ` +
            `(${stockAdjustments.map(r => `${r.ProdKey}:${r.added}`).join(',')})`,
        );
      } catch (error) {
        const stockErrors = error.stockErrors || [{ prodKey: null, code: error.code || -1, message: error.message }];
        await logFix(
          'auto_stock_add_error',
          `${orderYear}/${orderWeek} 재고부족분 보정 롤백: ${stockErrors.map(e => e.message).join(' / ')}`,
          true,
        );
        return res.status(409).json({
          success: false,
          code: error.code || 'AUTO_STOCK_ADJUST_FAILED',
          error: error.message || '재고 부족분 보정에 실패했습니다. 재고조정은 롤백되었습니다.',
          stockAdjustments: [],
          stockErrors,
        });
      }
    }
  }

  // 1. 이미 전체 확정된 경우 안내
  const already = await query(
    `SELECT COUNT(*) AS cnt FROM ShipmentMaster
      WHERE OrderYear=@yr AND OrderWeek=@wk AND isFix=1 AND isDeleted=0`,
    {
      yr: { type: sql.NVarChar, value: orderYear },
      wk: { type: sql.NVarChar, value: orderWeek },
    }
  );

  // 2. 미확정(DetailFix=0) 출고가 있는 CountryFlower 목록
  const categoryTargets = await loadShipmentCategoryTargets(orderYear, orderWeek, 0, allowedCountryFlowers);

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
  const wholeWeekNegativeRows = (await loadNegativeGuardRows(orderYear, orderWeek))
    .filter(row => !req.estimateEditGroups || allowedCountryFlowers.has(String(row.CountryFlower || '').trim()));
  if (wholeWeekNegativeRows.length > 0) {
    return res.status(400).json({
      success: false,
      error: `[${week}] 확정 불가: 전차수재고 + 입고 + 재고조정 - 출고가 음수인 품목 ${wholeWeekNegativeRows.length}건`,
      code: 'NEGATIVE_STOCK',
      negative: wholeWeekNegativeRows,
    });
  }
  const targets = procedureShape.hasCountryFlower
    ? categoryTargets
    : [{ countryFlower: null, label: 'ALL', mode: 'ALL', isBlank: false }];
  if (req.estimateEditGroups && !procedureShape.hasCountryFlower) throw new Error('품종별 확정 범위를 지원하지 않는 전산입니다. 전체 확정으로 변경하지 않았습니다.');
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
      const categoryProdKeys = await loadShipmentProdKeys(orderYear, orderWeek, cf, target.mode);
      const prodKeys = narrowStockProdKeys(categoryProdKeys, requestedStockProdKeys);
      await logFix('fix_sp_start', `${orderYear}/${orderWeek} ${label} prod=${prodKeys.length}`);
      const r = await runFixTargetProcedure('usp_ShipmentFix', procedureShape, orderYear, orderWeek, uid, cf, req, skipStockCalc);
      const row = r.recordset?.[0] || {};
      if (row.result === 0) {
        if (skipStockCalc) {
          results.push({ countryFlower: label, ok: true, message: row.message });
        } else {
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
        }
      } else {
        // skipStockCalc여도 확정 실패(스냅샷이 출고를 이미 뺀 기말인 경우)는 재계산 후 재시도한다.
        let retryRow = null;
        await logFix('fix_retry_stock_calc_start', `${orderYear}/${orderWeek} ${label} prod=${prodKeys.length}`);
        const preStock = await runStockCalculationForProducts(orderYear, orderWeek, uid, prodKeys, {
          prefix: 'fix_retry_stock_calc',
          label,
        });
        stockResults.push(...preStock.results);
        stockErrors.push(...preStock.errors);
        await logFix('fix_retry_stock_calc_done', `${orderYear}/${orderWeek} ${label} ok=${preStock.results.length} err=${preStock.errors.length}`, preStock.errors.length > 0);
        const retry = await runFixTargetProcedure('usp_ShipmentFix', procedureShape, orderYear, orderWeek, uid, cf, req, skipStockCalc);
        retryRow = retry.recordset?.[0] || {};

        if (retryRow && retryRow.result === 0) {
          await logFix('fix_sp_retry_ok', `${orderYear}/${orderWeek} ${label}`);
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
          results.push({ countryFlower: label, ok: true, message: retryRow.message });
        } else {
          const finalRow = retryRow || row;
          await logFix('fix_sp_error', `${orderYear}/${orderWeek} ${label} code=${finalRow.result} msg=${finalRow.message || ''}`, true);
          errors.push({ countryFlower: label, code: finalRow.result, message: finalRow.message || 'unknown' });
        }
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

  const alreadyCalculatedProdKeys = stockResults.map((r) => r.prodKey);
  const reconcile = skipStockCalc
    ? { weekProdKeyCount: 0, recalculatedCount: 0, stockErrors: [], parity: { status: 'RECALC_SKIPPED', exeAligned: true, warnings: [] } }
    : await reconcileWeekAfterScopedOperation({
        q: query,
        sqlTypes: sql,
        orderYear,
        orderWeek,
        uid,
        logFix,
        alreadyCalculatedProdKeys,
        scopeLabel: allowedCountryFlowers ? `scoped:${[...allowedCountryFlowers].join(',')}` : 'fix',
        forceFullWeekRecalc: Boolean(allowedCountryFlowers),
      });

  await logFix(
    'fix_done',
    `${orderYear}/${orderWeek} success=${results.length} errors=${errors.length} stockErrors=${stockErrors.length} reconcile=${reconcile.recalculatedCount}`,
    errors.length > 0 || stockErrors.length > 0 || !reconcile.parity.exeAligned,
  );
  const success = errors.length === 0 && stockErrors.length === 0 && reconcile.stockErrors.length === 0;
  const editGuardAfter = success && !req.estimateEditGroups ? await advanceOptionalFixEditGuard(req) : null;
  return res.status(200).json({
    success,
    message: `[${week}] ${procedureShape.hasCountryFlower ? `${results.length}개 카테고리` : '차수 전체'} 확정 완료` +
             (errors.length > 0 || stockErrors.length > 0 ? ` (${errors.length + stockErrors.length}개 실패)` : '') +
             (reconcile.parity.exeAligned ? '' : ' · exe 정합 미완(재고마감/음수재고 확인)'),
    results,
    errors,
    stockResults,
    stockErrors,
    stockAdjustments,
    autoStockAddUsed: stockAdjustments.length > 0,
    reconcile,
    parity: reconcile.parity,
    editDigestAfter: editGuardAfter?.editDigestAfter,
    revision: editGuardAfter?.revision,
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

  const { orderYear, orderWeek } = req.erpWeek;
  await assertOptionalFixEditGuard(req);
  const uid       = req.user?.userId || 'admin';
  const allowedCountryFlowers = await resolveFixCategoryScope(req, countryFlowersFilter);
  const requestedStockProdKeys = normalizeStockProdKeys(req.body?.stockProdKeys);
  // skipStockCalc: 확정해제 SP는 항상 실행하고, 곧바로 재확정될 사이클의
  // 중간 스냅샷 합산만 생략한다.
  const skipStockCalc = req.body?.skipStockCalc === true;
  await logFix('unfix_start', `${orderYear}/${orderWeek} uid=${uid} filter=${allowedCountryFlowers ? [...allowedCountryFlowers].join(',') : 'ALL'}${skipStockCalc ? ' skipStockCalc' : ''}`);

  try {
    const laterGuard = await loadCheckFixCancel(orderYear, orderWeek, allowedCountryFlowers);
    if (laterGuard.blocked) {
      return res.status(409).json({
        success: false,
        code: laterGuard.code,
        warning: laterGuard.code,
        nextWeek: laterGuard.nextWeek,
        products: laterGuard.products,
        error: laterGuard.error,
      });
    }

    const categoryTargets = await loadShipmentCategoryTargets(orderYear, orderWeek, 1, allowedCountryFlowers);

    if (categoryTargets.length === 0) {
      if (req.estimateEditGroups) {
        return res.status(200).json({ success: true, message: `[${week}] 수정 품종은 이미 미확정 상태입니다.`, results: [] });
      } else if (!skipStockCalc) {
        const prodKeys = await loadShipmentProdKeys(orderYear, orderWeek, null, 'ALL');
        const stock = await retryStockCalculationForProducts(orderYear, orderWeek, uid, prodKeys, {
          prefix: 'unfix_stock_calc',
          label: 'already-unfixed',
        });
        const calcCheck = evaluateUnfixStockCalcResult({ stockErrors: stock.errors });
        if (!calcCheck.ok) {
          return res.status(409).json({
            success: false,
            code: calcCheck.code,
            warning: calcCheck.code,
            error: calcCheck.error,
            stockErrors: stock.errors,
          });
        }
      }
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
    if (req.estimateEditGroups && !procedureShape.hasCountryFlower) throw new Error('품종별 확정취소 범위를 지원하지 않는 전산입니다. 전체 취소로 변경하지 않았습니다.');
    await logFix('unfix_targets', `${orderYear}/${orderWeek} targets=${targets.length} shapeCountry=${procedureShape.hasCountryFlower ? 1 : 0}`);

    const results = [];
    const errors = [];
    const stockResults = [];
    const stockErrors = [];
    for (const target of targets) {
      const cf = target.countryFlower;
      const label = target.label || cf || 'ALL';
      try {
        const categoryProdKeys = await loadShipmentProdKeys(orderYear, orderWeek, cf, target.mode);
        const prodKeys = narrowStockProdKeys(categoryProdKeys, requestedStockProdKeys);
        await logFix('unfix_sp_start', `${orderYear}/${orderWeek} ${label} prod=${prodKeys.length}`);
        const r = await runFixTargetProcedure('usp_ShipmentFixCancel', procedureShape, orderYear, orderWeek, uid, cf, req, skipStockCalc);
        const row = r.recordset?.[0] || {};
        if (row.result === 0) {
          if (skipStockCalc) {
            results.push({ countryFlower: label, ok: true, message: row.message });
          } else {
          await logFix('unfix_stock_calc_start', `${orderYear}/${orderWeek} ${label} prod=${prodKeys.length}`);
          const stock = await retryStockCalculationForProducts(orderYear, orderWeek, uid, prodKeys, {
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
          }
        } else {
          await logFix('unfix_sp_error', `${orderYear}/${orderWeek} ${label} code=${row.result} msg=${row.message || ''}`, true);
          errors.push({ countryFlower: label, code: row.result, message: row.message || 'unknown' });
        }
      } catch (e) {
        await logFix('unfix_exception', `${orderYear}/${orderWeek} ${label} ${e.message}`, true);
        errors.push({ countryFlower: label, code: -1, message: e.message });
      }
    }

    const alreadyCalculatedProdKeys = stockResults.map((r) => r.prodKey);
    const reconcile = skipStockCalc
      ? { weekProdKeyCount: 0, recalculatedCount: 0, stockErrors: [], parity: { status: 'RECALC_SKIPPED', exeAligned: true, warnings: [] } }
      : await reconcileWeekAfterScopedOperation({
          q: query,
          sqlTypes: sql,
          orderYear,
          orderWeek,
          uid,
          logFix,
          alreadyCalculatedProdKeys,
          scopeLabel: allowedCountryFlowers ? `scoped:${[...allowedCountryFlowers].join(',')}` : 'unfix',
          forceFullWeekRecalc: Boolean(allowedCountryFlowers),
        });

    const pendingUnfixed = await loadShipmentCategoryTargets(orderYear, orderWeek, 0, req.estimateEditGroups ? allowedCountryFlowers : null);
    const pendingUnfixedLabels = labelsFromCategoryTargets(pendingUnfixed);
    const requiresAllCategoryFix = !req.estimateEditGroups && pendingUnfixed.length > 1;


    const calcCheck = evaluateUnfixStockCalcResult({
      skipStockCalc,
      stockErrors,
      reconcileStockErrors: reconcile.stockErrors,
    });
    const hasStockWarning = stockErrors.length > 0 || reconcile.stockErrors.length > 0;
    await logFix(
      'unfix_done',
      `${orderYear}/${orderWeek} success=${results.length} errors=${errors.length} stockErrors=${stockErrors.length} reconcile=${reconcile.recalculatedCount} pendingUnfixed=${pendingUnfixed.length}`,
      errors.length > 0 || hasStockWarning,
    );
    if (!calcCheck.ok) {
      return res.status(409).json({
        success: false,
        code: calcCheck.code,
        warning: calcCheck.code,
        error: calcCheck.error,
        results,
        errors,
        stockResults,
        stockErrors,
        reconcile,
      });
    }
    const success = errors.length === 0;
    const editGuardAfter = success && !req.estimateEditGroups ? await advanceOptionalFixEditGuard(req) : null;
    return res.status(200).json({
      success,
      message: `[${week}] ${results.length}개 카테고리 확정 취소` +
               (errors.length > 0 ? ` (${errors.length}개 실패)` : '') +
               (requiresAllCategoryFix
                 ? ` · 재확정 시 미확정 ${pendingUnfixed.length}개 카테고리를 한 번에 확정하세요 (${pendingUnfixedLabels.join(', ')})`
                 : '') +
               (reconcile.parity.exeAligned ? '' : ' · exe 정합 미완(재고마감/음수재고 확인)'),
      results,
      errors,
      stockResults,
      stockErrors,
      reconcile,
      parity: reconcile.parity,
      pendingUnfixedCategories: pendingUnfixedLabels,
      requiresAllCategoryFix,
      editDigestAfter: editGuardAfter?.editDigestAfter,
      revision: editGuardAfter?.revision,
    });
  } catch (err) {
    const response = editErrorResponse(err);
    return res.status(response.statusCode).json(response.body);
  }
}
