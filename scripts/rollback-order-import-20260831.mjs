import fs from 'node:fs';
import { query, withTransaction, sql } from '../lib/db.js';

const manifest = JSON.parse(fs.readFileSync(
  new URL('../docs/repair-manifests/2026-08-31_36-01_order-import-rollback.json', import.meta.url),
  'utf8',
));

const APPLY = process.argv.includes('--apply');
const EPSILON = 0.000001;
const ROLLBACK_ACTOR = 'nenovaSS3';
const ROLLBACK_REASON = '2026-08-31 오전 출고분배 엑셀의 잘못된 주문등록 변경 41건 원복';

function n(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function same(a, b) {
  return Math.abs(n(a) - n(b)) <= EPSILON;
}

function unitName(value, fallback = '박스') {
  const text = String(value || '').trim().toLowerCase();
  if (/단|bunch/.test(text)) return '단';
  if (/송이|스템|스팀|stem|steam/.test(text)) return '송이';
  if (/박스|box/.test(text)) return '박스';
  return fallback;
}

function quantitiesFor(targetQty, row) {
  const outUnit = unitName(row.OutUnit, '박스');
  const estUnit = unitName(row.EstUnit, outUnit);
  const bunchOfBox = n(row.BunchOf1Box);
  const stemOfBox = n(row.SteamOf1Box);
  const stemOfBunch = n(row.SteamOf1Bunch);
  let box = 0;
  let bunch = 0;
  let stem = 0;

  if (outUnit === '박스') {
    box = targetQty;
    bunch = bunchOfBox > 0 ? targetQty * bunchOfBox : 0;
    stem = stemOfBox > 0 ? targetQty * stemOfBox
      : bunchOfBox > 0 && stemOfBunch > 0 ? targetQty * bunchOfBox * stemOfBunch : 0;
  } else if (outUnit === '단') {
    bunch = targetQty;
    box = bunchOfBox > 0 ? targetQty / bunchOfBox : 0;
    stem = stemOfBunch > 0 ? targetQty * stemOfBunch
      : bunchOfBox > 0 && stemOfBox > 0 ? (targetQty / bunchOfBox) * stemOfBox : 0;
  } else {
    stem = targetQty;
    box = stemOfBox > 0 ? targetQty / stemOfBox
      : stemOfBunch > 0 && bunchOfBox > 0 ? targetQty / (stemOfBunch * bunchOfBox) : 0;
    bunch = stemOfBunch > 0 ? targetQty / stemOfBunch
      : stemOfBox > 0 && bunchOfBox > 0 ? (targetQty / stemOfBox) * bunchOfBox : 0;
  }

  const out = outUnit === '단' ? bunch : outUnit === '송이' ? stem : box;
  const est = estUnit === '단' ? bunch : estUnit === '송이' ? stem : box;
  return { box, bunch, stem, out, est };
}

function targetParams(target) {
  return {
    yr: { type: sql.NVarChar, value: manifest.orderYear },
    wk: { type: sql.NVarChar, value: manifest.orderWeek },
    customer: { type: sql.NVarChar, value: target.customer },
    product: { type: sql.NVarChar, value: target.product },
    orderCode: { type: sql.NVarChar, value: target.orderCode || '' },
    sourceActor: { type: sql.NVarChar, value: manifest.sourceChangeWindow.actor },
    // SQL Server에 기록된 현지 업무시각을 그대로 비교한다. Node/서버 timezone 변환을 거치지 않는다.
    fromDtm: { type: sql.NVarChar, value: manifest.sourceChangeWindow.from },
    toDtm: { type: sql.NVarChar, value: manifest.sourceChangeWindow.toExclusive },
  };
}

async function loadTargetRows(runQuery, target, { lock = false } = {}) {
  const detailHint = lock ? ' WITH (UPDLOCK, HOLDLOCK)' : '';
  const masterHint = lock ? ' WITH (UPDLOCK, HOLDLOCK)' : '';
  const historyHint = lock ? ' WITH (UPDLOCK, HOLDLOCK)' : '';
  return (await runQuery(
    `SELECT od.OrderDetailKey, od.OrderMasterKey, om.CustKey, od.ProdKey,
            c.CustName, p.ProdName, ISNULL(om.OrderCode,'') AS OrderCode,
            ISNULL(od.BoxQuantity,0) AS BoxQuantity,
            ISNULL(od.BunchQuantity,0) AS BunchQuantity,
            ISNULL(od.SteamQuantity,0) AS SteamQuantity,
            ISNULL(od.OutQuantity,0) AS OutQuantity,
            ISNULL(od.EstQuantity,0) AS EstQuantity,
            ISNULL(od.NoneOutQuantity,0) AS NoneOutQuantity,
            ISNULL(od.isDeleted,0) AS isDeleted,
            od.CreateDtm, od.LastUpdateDtm,
            p.OutUnit, p.EstUnit,
            ISNULL(p.BunchOf1Box,0) AS BunchOf1Box,
            ISNULL(p.SteamOf1Box,0) AS SteamOf1Box,
            ISNULL(p.SteamOf1Bunch,0) AS SteamOf1Bunch,
            latest.ChangeDtm AS LatestChangeDtm,
            latest.ChangeID AS LatestChangeID,
            latest.BeforeValue AS LatestBeforeValue,
            latest.AfterValue AS LatestAfterValue,
            latest.Descr AS LatestDescr,
            CASE WHEN latest.ChangeDtm>=CONVERT(DATETIME2,@fromDtm,126)
                       AND latest.ChangeDtm<CONVERT(DATETIME2,@toDtm,126)
                       AND latest.ChangeID=@sourceActor THEN 1 ELSE 0 END AS LatestIsSourceChange,
            CASE WHEN od.CreateDtm>=CONVERT(DATETIME2,@fromDtm,126)
                       AND od.CreateDtm<CONVERT(DATETIME2,@toDtm,126) THEN 1 ELSE 0 END AS CreatedInSourceWindow,
            CASE WHEN od.LastUpdateDtm>=CONVERT(DATETIME2,@fromDtm,126)
                       AND od.LastUpdateDtm<CONVERT(DATETIME2,@toDtm,126) THEN 1 ELSE 0 END AS UpdatedInSourceWindow
       FROM OrderMaster om${masterHint}
       JOIN OrderDetail od${detailHint} ON od.OrderMasterKey=om.OrderMasterKey
       JOIN Customer c ON c.CustKey=om.CustKey
       JOIN Product p ON p.ProdKey=od.ProdKey
       OUTER APPLY (
         SELECT TOP 1 oh.ChangeDtm, oh.ChangeID, oh.BeforeValue, oh.AfterValue, oh.Descr
           FROM OrderHistory oh${historyHint}
          WHERE oh.OrderDetailKey=od.OrderDetailKey
          ORDER BY oh.ChangeDtm DESC
       ) latest
      WHERE CAST(om.OrderYear AS NVARCHAR(4))=@yr
        AND om.OrderWeek=@wk
        AND c.CustName=@customer
        AND p.ProdName=@product
        AND ISNULL(om.OrderCode,'')=@orderCode
        AND ISNULL(om.isDeleted,0)=0
        AND ISNULL(od.isDeleted,0)=0`,
    targetParams(target),
  )).recordset;
}

function inspectTarget(target, rows) {
  if (rows.length !== 1) {
    throw new Error(`ABORT ${target.customer} / ${target.product}: 활성 주문행 ${rows.length}건 (정확히 1건이어야 함)`);
  }
  const row = rows[0];
  if (!same(row.OutQuantity, target.after)) {
    throw new Error(`ABORT ${target.customer} / ${target.product}: 현재 ${row.OutQuantity}, 오전 변경값 ${target.after}`);
  }
  if (Number(row.LatestIsSourceChange) !== 1
      || !same(row.LatestBeforeValue, target.before)
      || !same(row.LatestAfterValue, target.after)) {
    throw new Error(`ABORT ${target.customer} / ${target.product}: 오전 변경 뒤 다른 수정 이력이 있거나 원본 이력이 다름`);
  }
  if (target.before > 0 && Number(row.UpdatedInSourceWindow) !== 1) {
    throw new Error(`ABORT ${target.customer} / ${target.product}: 주문행 최종 수정시각이 오전 오류 구간과 다름`);
  }
  const deleteCreated = target.before === 0 && Number(row.CreatedInSourceWindow) === 1;
  return {
    ...target,
    row,
    action: deleteCreated ? 'DELETE_CREATED_DETAIL' : 'RESTORE_QUANTITY',
    quantities: quantitiesFor(target.before, row),
  };
}

async function preflight(runQuery, { lock = false } = {}) {
  if (manifest.targets.length !== 41) throw new Error(`ABORT: manifest target count=${manifest.targets.length}, expected=41`);
  const unique = new Set(manifest.targets.map(t => `${t.customer}\u0000${t.product}\u0000${t.orderCode || ''}`));
  if (unique.size !== manifest.targets.length) throw new Error('ABORT: manifest contains duplicate business keys');
  const inspected = [];
  for (const target of manifest.targets) {
    inspected.push(inspectTarget(target, await loadTargetRows(runQuery, target, { lock })));
  }
  const detailKeys = new Set(inspected.map(item => Number(item.row.OrderDetailKey)));
  if (detailKeys.size !== inspected.length) throw new Error('ABORT: more than one manifest row resolved to the same OrderDetailKey');
  return inspected;
}

function listParams(prefix, values, type) {
  return Object.fromEntries(values.map((value, index) => [`${prefix}${index}`, { type, value }]));
}

async function downstreamSnapshot(runQuery, inspected) {
  const custKeys = [...new Set(inspected.map(item => Number(item.row.CustKey)))];
  const prodKeys = [...new Set(inspected.map(item => Number(item.row.ProdKey)))];
  const custSql = custKeys.map((_, index) => `@ck${index}`).join(',');
  const prodSql = prodKeys.map((_, index) => `@pk${index}`).join(',');
  const params = {
    yr: { type: sql.NVarChar, value: manifest.orderYear },
    wk: { type: sql.NVarChar, value: manifest.orderWeek },
    ...listParams('ck', custKeys, sql.Int),
    ...listParams('pk', prodKeys, sql.Int),
  };
  const result = await runQuery(
    `SELECT
       (SELECT COUNT_BIG(*) FROM ShipmentMaster sm JOIN ShipmentDetail sd ON sd.ShipmentKey=sm.ShipmentKey
         WHERE CAST(sm.OrderYear AS NVARCHAR(4))=@yr AND sm.OrderWeek=@wk
           AND sm.CustKey IN (${custSql}) AND sd.ProdKey IN (${prodSql})) AS ShipmentDetailCount,
       (SELECT ISNULL(SUM(ISNULL(sd.OutQuantity,0)),0) FROM ShipmentMaster sm JOIN ShipmentDetail sd ON sd.ShipmentKey=sm.ShipmentKey
         WHERE CAST(sm.OrderYear AS NVARCHAR(4))=@yr AND sm.OrderWeek=@wk
           AND sm.CustKey IN (${custSql}) AND sd.ProdKey IN (${prodSql})) AS ShipmentOutQuantity,
       (SELECT COUNT_BIG(*) FROM ShipmentMaster sm JOIN ShipmentDetail sd ON sd.ShipmentKey=sm.ShipmentKey
          JOIN ShipmentDate sdt ON sdt.SdetailKey=sd.SdetailKey
         WHERE CAST(sm.OrderYear AS NVARCHAR(4))=@yr AND sm.OrderWeek=@wk
           AND sm.CustKey IN (${custSql}) AND sd.ProdKey IN (${prodSql})) AS ShipmentDateCount,
       (SELECT COUNT_BIG(*) FROM ShipmentMaster sm JOIN ShipmentDetail sd ON sd.ShipmentKey=sm.ShipmentKey
          JOIN ShipmentFarm sf ON sf.SdetailKey=sd.SdetailKey
         WHERE CAST(sm.OrderYear AS NVARCHAR(4))=@yr AND sm.OrderWeek=@wk
           AND sm.CustKey IN (${custSql}) AND sd.ProdKey IN (${prodSql})) AS ShipmentFarmCount,
       (SELECT COUNT_BIG(*) FROM ShipmentMaster sm JOIN Estimate e ON e.ShipmentKey=sm.ShipmentKey
         WHERE CAST(sm.OrderYear AS NVARCHAR(4))=@yr AND sm.OrderWeek=@wk
           AND sm.CustKey IN (${custSql}) AND e.ProdKey IN (${prodSql})) AS EstimateCount,
       (SELECT COUNT_BIG(*) FROM StockMaster stm JOIN ProductStock ps ON ps.StockKey=stm.StockKey
         WHERE CAST(stm.OrderYear AS NVARCHAR(4))=@yr AND stm.OrderWeek=@wk
           AND ps.ProdKey IN (${prodSql})) AS ProductStockCount,
       (SELECT ISNULL(SUM(ISNULL(ps.Stock,0)),0) FROM StockMaster stm JOIN ProductStock ps ON ps.StockKey=stm.StockKey
         WHERE CAST(stm.OrderYear AS NVARCHAR(4))=@yr AND stm.OrderWeek=@wk
           AND ps.ProdKey IN (${prodSql})) AS ProductStockQuantity`,
    params,
  );
  return result.recordset[0];
}

async function applyRollback() {
  return withTransaction(async (tQ) => {
    const inspected = await preflight(tQ, { lock: true });
    const downstreamBefore = await downstreamSnapshot(tQ, inspected);
    const results = [];

    for (const item of inspected) {
      const q = item.quantities;
      const deleting = item.action === 'DELETE_CREATED_DETAIL';
      const updateResult = await tQ(
        `UPDATE OrderDetail
            SET BoxQuantity=@box, BunchQuantity=@bunch, SteamQuantity=@stem,
                OutQuantity=@outQty, EstQuantity=@estQty, NoneOutQuantity=0,
                isDeleted=@deleted, LastUpdateID=@uid, LastUpdateDtm=GETDATE()
          WHERE OrderDetailKey=@detailKey
            AND ISNULL(isDeleted,0)=0
            AND ABS(ISNULL(OutQuantity,0)-@expectedAfter)<=0.000001`,
        {
          detailKey: { type: sql.Int, value: Number(item.row.OrderDetailKey) },
          box: { type: sql.Float, value: deleting ? 0 : q.box },
          bunch: { type: sql.Float, value: deleting ? 0 : q.bunch },
          stem: { type: sql.Float, value: deleting ? 0 : q.stem },
          outQty: { type: sql.Float, value: deleting ? 0 : q.out },
          estQty: { type: sql.Float, value: deleting ? 0 : q.est },
          deleted: { type: sql.Bit, value: deleting ? 1 : 0 },
          uid: { type: sql.NVarChar, value: ROLLBACK_ACTOR },
          expectedAfter: { type: sql.Float, value: item.after },
        },
      );
      if (Number(updateResult.rowsAffected?.[0] || 0) !== 1) {
        throw new Error(`ABORT ${item.customer} / ${item.product}: 잠금 뒤 현재값이 변경됨`);
      }
      await tQ(
        `INSERT INTO OrderHistory
           (OrderDetailKey, ChangeType, ColumName, BeforeValue, AfterValue, Descr, ChangeID, ChangeDtm)
         VALUES (@detailKey, N'수정', N'수량', @before, @after, @descr, @uid, GETDATE())`,
        {
          detailKey: { type: sql.Int, value: Number(item.row.OrderDetailKey) },
          before: { type: sql.NVarChar, value: String(item.after) },
          after: { type: sql.NVarChar, value: String(item.before) },
          descr: { type: sql.NVarChar, value: ROLLBACK_REASON },
          uid: { type: sql.NVarChar, value: ROLLBACK_ACTOR },
        },
      );
      results.push({
        orderDetailKey: Number(item.row.OrderDetailKey),
        customer: item.customer,
        product: item.product,
        restoredFrom: item.after,
        restoredTo: item.before,
        action: item.action,
      });
    }

    const downstreamAfter = await downstreamSnapshot(tQ, inspected);
    if (JSON.stringify(downstreamBefore) !== JSON.stringify(downstreamAfter)) {
      throw new Error(`ABORT: 주문 외 원장 값이 달라짐 before=${JSON.stringify(downstreamBefore)} after=${JSON.stringify(downstreamAfter)}`);
    }

    for (const item of inspected) {
      const verify = await tQ(
        `SELECT ISNULL(isDeleted,0) AS isDeleted, ISNULL(OutQuantity,0) AS OutQuantity
           FROM OrderDetail WITH (UPDLOCK, HOLDLOCK)
          WHERE OrderDetailKey=@detailKey`,
        { detailKey: { type: sql.Int, value: Number(item.row.OrderDetailKey) } },
      );
      const row = verify.recordset[0];
      const shouldDelete = item.action === 'DELETE_CREATED_DETAIL';
      if (!row || Number(row.isDeleted) !== (shouldDelete ? 1 : 0) || !same(row.OutQuantity, item.before)) {
        throw new Error(`ABORT ${item.customer} / ${item.product}: 원복 후 재조회 불일치`);
      }
    }

    await tQ(
      `INSERT INTO SystemActionLog
         (Actor, SessionId, ActionType, Method, Endpoint, AffectedTable, AffectedCount,
          Payload, Result, ResultDesc, RiskLevel, IpAddress, UserAgent)
       VALUES
         (@actor, N'approved-production-repair', N'ORDER_IMPORT_ROLLBACK', N'SCRIPT',
          N'scripts/rollback-order-import-20260831.mjs', N'OrderDetail/OrderHistory', @count,
          @payload, N'SUCCESS', @resultDesc, N'HIGH', N'', N'GitHub Actions SSH')`,
      {
        actor: { type: sql.NVarChar, value: ROLLBACK_ACTOR },
        count: { type: sql.Int, value: results.length },
        payload: { type: sql.NVarChar, value: JSON.stringify({ manifestId: manifest.id, orderYear: manifest.orderYear, orderWeek: manifest.orderWeek }) },
        resultDesc: { type: sql.NVarChar, value: `${ROLLBACK_REASON}; restored=${results.length}; downstream=preserved` },
      },
    );

    return { success: true, appliedCount: results.length, downstreamBefore, downstreamAfter, results };
  });
}

const dryRun = await preflight(query, { lock: false });
const dryRunDownstream = await downstreamSnapshot(query, dryRun);
console.log(JSON.stringify({
  mode: APPLY ? 'APPLY_PRECHECK' : 'DRY_RUN',
  manifestId: manifest.id,
  orderYear: manifest.orderYear,
  orderWeek: manifest.orderWeek,
  targetCount: dryRun.length,
  restoreQuantityCount: dryRun.filter(item => item.action === 'RESTORE_QUANTITY').length,
  deleteCreatedDetailCount: dryRun.filter(item => item.action === 'DELETE_CREATED_DETAIL').length,
  downstreamSnapshot: dryRunDownstream,
  rows: dryRun.map(item => ({
    orderDetailKey: Number(item.row.OrderDetailKey),
    customer: item.customer,
    product: item.product,
    current: item.after,
    restore: item.before,
    action: item.action,
  })),
}, null, 2));

if (!APPLY) {
  console.log('DRY_RUN_COMPLETE: no production rows were changed');
  process.exit(0);
}

const applied = await applyRollback();
console.log(JSON.stringify(applied, null, 2));
console.log(`ROLLBACK_COMPLETE: ${applied.appliedCount} order rows restored; shipment/stock/estimate preserved`);
