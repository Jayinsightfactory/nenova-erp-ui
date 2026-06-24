/**
 * 출고 확정(카테고리/차수) 후 nenova.exe 와의 정합 — 재고 재계산·상태 판정
 *
 * - usp_ShipmentFix/Cancel 은 Product.Stock 을 갱신
 * - usp_StockCalculation 은 ProductStock·StockMaster 를 갱신
 * - 카테고리만 unfix/fix 하면 해당 카테고리 품목만 stock calc 할 때
 *   차수 전체 ProductStock·StockMaster 가 어긋날 수 있음 → 차수 전체 prod 재계산
 */

// ── 순수 판정 (DB 없음) ─────────────────────────────────────────────

export function deriveShipmentDetailStatus({ detailCount = 0, fixedDetailCount = 0, unfixedDetailCount = 0 } = {}) {
  if (detailCount <= 0) return 'NO_SHIPMENT';
  if (unfixedDetailCount === 0) return 'FIXED';
  if (fixedDetailCount > 0 && unfixedDetailCount > 0) return 'PARTIAL';
  return 'UNFIXED';
}

export function deriveStockFixStatus({ stockMasterCount = 0, stockFixed = 0 } = {}) {
  if (stockMasterCount <= 0) return 'NONE';
  return Number(stockFixed) === 1 ? 'FIXED' : 'OPEN';
}

/**
 * nenova.exe 체감과 맞춘 복합 확정 상태
 * @returns {{ status, exeAligned, warnings, shipmentStatus, stockFixStatus }}
 */
export function deriveExeAlignedStatus(input = {}) {
  const shipmentStatus = input.shipmentStatus
    || deriveShipmentDetailStatus(input);
  const stockFixStatus = input.stockFixStatus
    || deriveStockFixStatus({
      stockMasterCount: input.stockMasterCount,
      stockFixed: input.stockFixed,
    });

  const negativeLiveCount = Number(input.negativeLiveCount || 0);
  const masterDetailMismatchCount = Number(input.masterDetailMismatchCount || 0);
  const warnings = [];

  if (masterDetailMismatchCount > 0) {
    warnings.push(`출고 Master/Detail 불일치 ${masterDetailMismatchCount}건`);
  }
  if (shipmentStatus === 'FIXED' && stockFixStatus === 'OPEN') {
    warnings.push('출고는 확정됐으나 재고 마감(StockMaster) 미완료 — exe 재고 화면과 다를 수 있음');
  }
  if (negativeLiveCount > 0) {
    warnings.push(`Product.Stock 음수 ${negativeLiveCount}품목 — exe 실시간 재고`);
  }
  if (shipmentStatus === 'PARTIAL') {
    warnings.push('카테고리별 부분 확정 — 미확정 출고가 남아 있음');
  }

  let status = shipmentStatus;
  let exeAligned = false;

  if (shipmentStatus === 'NO_SHIPMENT') {
    exeAligned = true;
  } else if (shipmentStatus === 'UNFIXED') {
    exeAligned = stockFixStatus !== 'FIXED';
  } else if (shipmentStatus === 'PARTIAL') {
    exeAligned = false;
  } else if (shipmentStatus === 'FIXED') {
    exeAligned = stockFixStatus === 'FIXED'
      && negativeLiveCount === 0
      && masterDetailMismatchCount === 0;
    if (!exeAligned) {
      status = 'FIXED_PENDING_STOCK';
    }
  }

  return {
    status,
    exeAligned,
    warnings,
    shipmentStatus,
    stockFixStatus,
  };
}

export function prodKeysNeedingRecalc(allWeekProdKeys, alreadyCalculated = []) {
  const done = new Set((alreadyCalculated || []).map(Number).filter(Boolean));
  return [...new Set((allWeekProdKeys || []).map(Number).filter(Boolean))]
    .filter((pk) => !done.has(pk))
    .sort((a, b) => a - b);
}

// ── DB 연동 ─────────────────────────────────────────────────────────

export async function loadWeekOutboundProdKeys(q, orderWeek, sqlTypes) {
  const result = await q(
    `SELECT DISTINCT sd.ProdKey
       FROM ShipmentMaster sm
       JOIN ShipmentDetail sd ON sd.ShipmentKey = sm.ShipmentKey
       JOIN Product p ON p.ProdKey = sd.ProdKey AND p.isDeleted = 0
      WHERE sm.isDeleted = 0
        AND sm.OrderWeek = @wk
        AND ISNULL(sd.OutQuantity, 0) > 0
      ORDER BY sd.ProdKey`,
    { wk: { type: sqlTypes.NVarChar, value: orderWeek } },
  );
  return (result.recordset || []).map((r) => Number(r.ProdKey)).filter(Boolean);
}

export async function loadWeekParityMetrics(q, sqlTypes, orderYear, orderWeek) {
  const params = {
    yr: { type: sqlTypes.NVarChar, value: String(orderYear) },
    wk: { type: sqlTypes.NVarChar, value: String(orderWeek) },
  };

  const summary = await q(
    `SELECT
       COUNT(sd.SdetailKey) AS detailCount,
       SUM(CASE WHEN ISNULL(sd.isFix,0)=1 AND ISNULL(sd.OutQuantity,0)>0 THEN 1 ELSE 0 END) AS fixedDetailCount,
       SUM(CASE WHEN ISNULL(sd.isFix,0)=0 AND ISNULL(sd.OutQuantity,0)>0 THEN 1 ELSE 0 END) AS unfixedDetailCount,
       SUM(CASE WHEN ISNULL(sm.isFix,0)<>ISNULL(sd.isFix,0) AND ISNULL(sd.OutQuantity,0)>0 THEN 1 ELSE 0 END) AS masterDetailMismatchCount
     FROM ShipmentMaster sm
     LEFT JOIN ShipmentDetail sd ON sd.ShipmentKey = sm.ShipmentKey
     WHERE sm.isDeleted=0 AND sm.OrderWeek=@wk`,
    params,
  );

  const stock = await q(
    `SELECT COUNT(*) AS stockMasterCount,
            MAX(CASE WHEN ISNULL(isFix,0)=1 THEN 1 ELSE 0 END) AS stockFixed
       FROM StockMaster
      WHERE OrderWeek=@wk`,
    params,
  );

  const neg = await q(
    `SELECT COUNT(DISTINCT p.ProdKey) AS negativeLiveCount
       FROM Product p
      WHERE p.isDeleted=0 AND ISNULL(p.Stock,0) < 0
        AND EXISTS (
          SELECT 1 FROM ShipmentDetail sd
          JOIN ShipmentMaster sm ON sm.ShipmentKey=sd.ShipmentKey
          WHERE sd.ProdKey=p.ProdKey AND sm.OrderWeek=@wk AND sm.isDeleted=0
            AND ISNULL(sd.OutQuantity,0)>0
        )`,
    params,
  );

  const s = summary.recordset?.[0] || {};
  const st = stock.recordset?.[0] || {};
  const n = neg.recordset?.[0] || {};

  const shipmentStatus = deriveShipmentDetailStatus({
    detailCount: Number(s.detailCount || 0),
    fixedDetailCount: Number(s.fixedDetailCount || 0),
    unfixedDetailCount: Number(s.unfixedDetailCount || 0),
  });
  const stockFixStatus = deriveStockFixStatus({
    stockMasterCount: Number(st.stockMasterCount || 0),
    stockFixed: Number(st.stockFixed || 0),
  });

  return deriveExeAlignedStatus({
    shipmentStatus,
    stockFixStatus,
    negativeLiveCount: Number(n.negativeLiveCount || 0),
    masterDetailMismatchCount: Number(s.masterDetailMismatchCount || 0),
  });
}

export async function runStockCalculationSequential({
  q,
  sqlTypes,
  orderYear,
  orderWeek,
  uid,
  prodKeys,
  logFix,
  logPrefix = 'reconcile_stock',
  logLabel = '',
}) {
  const uniqueKeys = [...new Set((prodKeys || []).map(Number).filter(Boolean))].sort((a, b) => a - b);
  const results = [];
  const errors = [];
  let completed = 0;
  const total = uniqueKeys.length;

  for (const prodKey of uniqueKeys) {
    try {
      if (logFix) {
        await logFix(`${logPrefix}_item_start`, `${orderYear}/${orderWeek} ${logLabel} pk=${prodKey} ${completed + 1}/${total}`);
      }
      const r = await q(
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
          yr: { type: sqlTypes.NVarChar, value: String(orderYear) },
          wk: { type: sqlTypes.NVarChar, value: String(orderWeek) },
          pk: { type: sqlTypes.Int, value: prodKey },
          uid: { type: sqlTypes.NVarChar, value: uid },
        },
      );
      const row = r.recordset?.[0] || {};
      if (Number(row.result || 0) === 0) {
        results.push({ prodKey, ok: true, message: row.message || '' });
      } else {
        const error = { prodKey, code: row.result, message: row.message || 'unknown' };
        errors.push(error);
        if (logFix) {
          await logFix(`${logPrefix}_item_error`, `${orderYear}/${orderWeek} ${logLabel} pk=${prodKey} ${error.message}`, true);
        }
      }
    } catch (e) {
      const error = { prodKey, code: -1, message: e.message };
      errors.push(error);
      if (logFix) {
        await logFix(`${logPrefix}_item_error`, `${orderYear}/${orderWeek} ${logLabel} pk=${prodKey} ${error.message}`, true);
      }
    } finally {
      completed += 1;
      if (logFix && (completed === total || completed % 10 === 0)) {
        await logFix(`${logPrefix}_progress`, `${orderYear}/${orderWeek} ${logLabel} ${completed}/${total}`);
      }
    }
  }

  return { results, errors, total };
}

/**
 * 카테고리/차수 확정·취소 직후 호출 — 차수 전체 outbound 품목 재고 재계산 + 정합 상태
 */
export async function reconcileWeekAfterScopedOperation({
  q,
  sqlTypes,
  orderYear,
  orderWeek,
  uid,
  logFix,
  alreadyCalculatedProdKeys = [],
  scopeLabel = '',
  forceFullWeekRecalc = false,
}) {
  const allWeekProdKeys = await loadWeekOutboundProdKeys(q, orderWeek, sqlTypes);
  const keysToCalc = forceFullWeekRecalc
    ? allWeekProdKeys
    : prodKeysNeedingRecalc(allWeekProdKeys, alreadyCalculatedProdKeys);

  if (logFix && keysToCalc.length > 0) {
    await logFix(
      'reconcile_start',
      `${orderYear}/${orderWeek} ${scopeLabel} weekProd=${allWeekProdKeys.length} calc=${keysToCalc.length}`,
    );
  }

  let stock = { results: [], errors: [], total: 0 };
  if (keysToCalc.length > 0) {
    stock = await runStockCalculationSequential({
      q,
      sqlTypes,
      orderYear,
      orderWeek,
      uid,
      prodKeys: keysToCalc,
      logFix,
      logPrefix: 'reconcile_stock',
      logLabel: scopeLabel,
    });
    if (logFix) {
      await logFix(
        'reconcile_stock_done',
        `${orderYear}/${orderWeek} ${scopeLabel} ok=${stock.results.length} err=${stock.errors.length}`,
        stock.errors.length > 0,
      );
    }
  }

  const parity = await loadWeekParityMetrics(q, sqlTypes, orderYear, orderWeek);

  if (logFix) {
    await logFix(
      'reconcile_done',
      `${orderYear}/${orderWeek} status=${parity.status} exeAligned=${parity.exeAligned ? 1 : 0}`,
      !parity.exeAligned,
    );
  }

  return {
    weekProdKeyCount: allWeekProdKeys.length,
    recalculatedCount: stock.results.length,
    stockErrors: stock.errors,
    parity,
  };
}
