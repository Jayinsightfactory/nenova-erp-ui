import { query, withTransaction, sql } from '../db.js';
import { resolveActiveOrderYear } from '../orderUtils.js';
import { appendDescr } from '../shipmentDescr.js';
import { distributeUnits } from '../distributeUnits.js';
import { safeNextShipmentDetailKey } from '../safeNextKey.js';
import { refreshShipmentDatesAfterDetailChange } from '../syncShipmentDateEst.js';
import { assertShipmentLineHasOrder, assertShipmentWeekConsistent } from '../shipmentEstimateGuard.js';
import { purgeZeroOutShipmentDetail } from '../shipmentDetailWriteGuard.js';
import {
  loadCategoryFixStates,
  loadLineFixStates,
  evaluateImportRowFixBlock,
} from '../shipmentFixScope.js';
import { normalizeImportWeek, sameQty } from './matchingEngine.js';
import {
  isPkCollision,
  syncKeyNumbering,
  calcShipDate,
  orderQtyFromDetail,
  memoQty,
  importMemo,
  formatDateYmd,
  insertShipmentHistory,
  loadCurrentImportState,
} from './applyHelpers.js';

const preDistributeColumnCache = {};
async function columnExists(tableName, columnName) {
  const key = `${tableName}.${columnName}`;
  if (preDistributeColumnCache[key] !== undefined) return preDistributeColumnCache[key];
  const r = await query(
    `SELECT CASE WHEN COL_LENGTH(@tableName, @columnName) IS NULL THEN 0 ELSE 1 END AS HasColumn`,
    {
      tableName: { type: sql.NVarChar, value: `dbo.${tableName}` },
      columnName: { type: sql.NVarChar, value: columnName },
    }
  );
  preDistributeColumnCache[key] = Number(r.recordset[0]?.HasColumn || 0) === 1;
  return preDistributeColumnCache[key];
}

async function safeNextKey(tQ, table, keyCol) {
  if (table === 'ShipmentDetail' && keyCol === 'SdetailKey') {
    return safeNextShipmentDetailKey(tQ);
  }
  const r = await tQ(`SELECT ISNULL(MAX(${keyCol}),0)+1 AS nk FROM ${table} WITH (UPDLOCK, HOLDLOCK)`, {});
  return r.recordset[0].nk;
}

async function tryInsertWithRetry(tQ, table, keyCol, buildInsert, maxRetry = 5) {
  let lastErr;
  for (let attempt = 0; attempt < maxRetry; attempt += 1) {
    const key = await safeNextKey(tQ, table, keyCol);
    try {
      await buildInsert(key);
      return key;
    } catch (e) {
      lastErr = e;
      if (isPkCollision(e)) continue;
      throw e;
    }
  }
  throw lastErr || new Error(`${table} INSERT 재시도 실패`);
}

export async function preDistributeImportProductsToOrders({ rawWeek, rawYear, rows, user }) {
  const week = normalizeImportWeek(rawWeek);
  const orderYear = resolveActiveOrderYear(rawWeek, rawYear);
  if (!week) throw new Error('차수 필요');
  if (!Array.isArray(rows) || rows.length === 0) throw new Error('업로드 파일에서 매칭된 품목이 없습니다');

  const hasShipmentYearWeekColumn = await columnExists('ShipmentMaster', 'OrderYearWeek');
  const uid = user?.userId || 'system';
  const userName = user?.userName || uid;
  const deduped = new Map();
  for (const row of rows) {
    if (!row?.custKey || !row?.prodKey) continue;
    const key = `${Number(row.custKey)}|${Number(row.prodKey)}`;
    if (!deduped.has(key)) deduped.set(key, row);
  }
  const targetRows = [...deduped.values()];
  if (targetRows.length === 0) throw new Error('업로드 파일에서 DB 업체/품목으로 매칭된 행이 없습니다');

  const [categoryFixStates, lineFixStates] = await Promise.all([
    loadCategoryFixStates(query, orderYear, week),
    loadLineFixStates(query, orderYear, week),
  ]);

  const result = await withTransaction(async (tQ) => {
    const applied = [];
    let skippedNoOrderCount = 0;
    let skippedNoChangeCount = 0;
    let skippedZeroNoShipmentCount = 0;
    let skippedFixedCount = 0;

    for (const row of targetRows) {
      const prodScope = await tQ(
        `SELECT TOP 1 ProdName, CountryFlower FROM Product WHERE ProdKey=@pk`,
        { pk: { type: sql.Int, value: Number(row.prodKey) } },
      );
      const scope = prodScope.recordset[0] || {};
      const fixCheck = evaluateImportRowFixBlock({
        orderWeek: week,
        countryFlower: scope.CountryFlower || row.countryFlower,
        prodName: scope.ProdName || row.prodName,
        custKey: row.custKey,
        prodKey: row.prodKey,
        categoryFixStates,
        lineFixStates,
      });
      if (fixCheck.fixBlocked) {
        skippedFixedCount += 1;
        continue;
      }

      const prod = await tQ(
        `SELECT TOP 1 p.OutUnit, p.EstUnit, p.CounName, ISNULL(p.Descr,'') AS ProdDescr,
                ISNULL(p.BunchOf1Box,0) AS BunchOf1Box, ISNULL(p.SteamOf1Bunch,0) AS SteamOf1Bunch,
                ISNULL(p.SteamOf1Box,0) AS SteamOf1Box,
                ISNULL(NULLIF(cpc.Cost,0), ISNULL(p.Cost,0)) AS Cost
           FROM Product p
           LEFT JOIN CustomerProdCost cpc ON cpc.CustKey=@ck AND cpc.ProdKey=p.ProdKey
          WHERE p.ProdKey=@pk`,
        { pk: { type: sql.Int, value: Number(row.prodKey) }, ck: { type: sql.Int, value: Number(row.custKey) } }
      );
      const cust = await tQ(
        `SELECT TOP 1 CustName, OrderCode, ISNULL(BaseOutDay,0) AS BaseOutDay
           FROM Customer
          WHERE CustKey=@ck`,
        { ck: { type: sql.Int, value: Number(row.custKey) } }
      );
      const order = await tQ(
        `SELECT TOP 1 od.OrderDetailKey, od.BoxQuantity, od.BunchQuantity, od.SteamQuantity, od.OutQuantity
           FROM OrderMaster om WITH (UPDLOCK, HOLDLOCK)
           JOIN OrderDetail od WITH (UPDLOCK, HOLDLOCK)
             ON od.OrderMasterKey=om.OrderMasterKey
            AND od.ProdKey=@pk
            AND ISNULL(od.isDeleted,0)=0
          WHERE om.CustKey=@ck
            AND om.OrderWeek=@week
            AND ISNULL(om.isDeleted,0)=0
            AND ISNULL(CAST(om.OrderYear AS NVARCHAR(4)), @importYear) = @importYear
          ORDER BY om.OrderMasterKey ASC, od.OrderDetailKey ASC`,
        {
          ck: { type: sql.Int, value: Number(row.custKey) },
          pk: { type: sql.Int, value: Number(row.prodKey) },
          week: { type: sql.NVarChar, value: week },
          importYear: { type: sql.NVarChar, value: String(orderYear) },
        }
      );

      const productInfo = prod.recordset[0] || {};
      const customerInfo = cust.recordset[0] || {};
      const orderDetail = order.recordset[0];
      const label = {
        custName: row.custName || customerInfo.CustName || row.custKey,
        prodName: row.displayName || row.prodName || row.productLabel || row.prodKey,
      };
      if (!orderDetail) {
        skippedNoOrderCount += 1;
        continue;
      }

      const desiredQty = orderQtyFromDetail(orderDetail, productInfo);
      const units = distributeUnits(desiredQty, productInfo);
      const estQty = units.estQty;
      const fallbackCost = Number(productInfo.Cost || 0);
      const currentState = await loadCurrentImportState(tQ, sql, row, week, productInfo, orderYear);
      if (sameQty(currentState.currentOutQty, units.outQty) && currentState.dateIssueCount === 0) {
        skippedNoChangeCount += 1;
        continue;
      }

      const shipDate = calcShipDate(week, orderYear, customerInfo.BaseOutDay ?? 0);
      if (!shipDate) throw new Error(`${label.custName} / ${label.prodName}: 출고일 계산 실패`);

      const sm = await tQ(
        `SELECT TOP 1 ShipmentKey FROM ShipmentMaster WITH (UPDLOCK, HOLDLOCK)
          WHERE CustKey=@ck AND OrderWeek=@week AND ISNULL(isDeleted,0)=0
            AND ISNULL(CAST(OrderYear AS NVARCHAR(4)), @importYear) = @importYear
          ORDER BY ISNULL(isFix,0) DESC, ShipmentKey ASC`,
        {
          ck: { type: sql.Int, value: Number(row.custKey) },
          week: { type: sql.NVarChar, value: week },
          importYear: { type: sql.NVarChar, value: String(orderYear) },
        }
      );

      let shipmentKey = sm.recordset[0]?.ShipmentKey;
      if (!shipmentKey && desiredQty > 0) {
        await assertShipmentWeekConsistent(tQ, sql, { orderYear, orderWeek: week, orderYearWeek: String(orderYear) + week.split('-')[0] });
        shipmentKey = await tryInsertWithRetry(tQ, 'ShipmentMaster', 'ShipmentKey', async (newSk) => {
          const params = {
            sk: { type: sql.Int, value: newSk },
            yr: { type: sql.NVarChar, value: String(orderYear) },
            week: { type: sql.NVarChar, value: week },
            ywk: { type: sql.NVarChar, value: String(orderYear) + week.split('-')[0] },
            ck: { type: sql.Int, value: Number(row.custKey) },
            uid: { type: sql.NVarChar, value: uid },
          };
          if (hasShipmentYearWeekColumn) {
            await tQ(
              `INSERT INTO ShipmentMaster (ShipmentKey,OrderYear,OrderWeek,OrderYearWeek,CustKey,isFix,isDeleted,WebCreated,CreateID,CreateDtm)
               VALUES (@sk,@yr,@week,@ywk,@ck,0,0,1,@uid,GETDATE())`,
              params
            );
          } else {
            await tQ(
              `INSERT INTO ShipmentMaster (ShipmentKey,OrderYear,OrderWeek,CustKey,isFix,isDeleted,WebCreated,CreateID,CreateDtm)
               VALUES (@sk,@yr,@week,@ck,0,0,1,@uid,GETDATE())`,
              params
            );
          }
        });
        await syncKeyNumbering(tQ, sql, 'ShipmentMasterKey', 'ShipmentMaster', 'ShipmentKey');
      }

      const old = shipmentKey
        ? await tQ(
          `SELECT TOP 1 SdetailKey, ISNULL(OutQuantity,0) AS OutQuantity, ISNULL(Descr,'') AS Descr
             FROM ShipmentDetail WITH (UPDLOCK, HOLDLOCK)
            WHERE ShipmentKey=@sk AND ProdKey=@pk`,
          { sk: { type: sql.Int, value: shipmentKey }, pk: { type: sql.Int, value: Number(row.prodKey) } }
        )
        : { recordset: [] };
      const oldDetail = old.recordset[0];
      const oldQty = Number(oldDetail?.OutQuantity || 0);
      let shipmentAction = oldDetail ? '분배유지' : '분배없음';
      let shipmentDetailKey = oldDetail?.SdetailKey || null;
      let shipmentChanged = false;

      if (desiredQty <= 0) {
        if (!oldDetail) {
          skippedZeroNoShipmentCount += 1;
          continue;
        }
        const log = importMemo(userName, oldQty, 0);
        await insertShipmentHistory(tQ, sql, oldDetail.SdetailKey, oldQty, 0, log, uid);
        await purgeZeroOutShipmentDetail(tQ, oldDetail.SdetailKey, sql);
        shipmentAction = '분배삭제';
        shipmentChanged = true;
      } else if (oldDetail) {
        const log = importMemo(userName, oldQty, desiredQty);
        const newDescr = appendDescr(oldDetail.Descr, log);
        await tQ(
          `UPDATE ShipmentDetail
              SET CustKey=@ck,
                  ShipmentDtm=@dt,
                  OutQuantity=@outQty,
                  EstQuantity=@estQty,
                  BoxQuantity=@box,
                  BunchQuantity=@bunch,
                  SteamQuantity=@steam,
                  Cost=CASE WHEN ISNULL(Cost,0)>0 THEN Cost ELSE @fallbackCost END,
                  Amount=ROUND(ISNULL(NULLIF(Cost,0), @fallbackCost) * @estQty / 1.1, 0),
                  Vat=((ISNULL(NULLIF(Cost,0), @fallbackCost) * @estQty) - ROUND(ISNULL(NULLIF(Cost,0), @fallbackCost) * @estQty / 1.1, 0)),
                  Descr=@log
            WHERE SdetailKey=@dk`,
          {
            dk: { type: sql.Int, value: oldDetail.SdetailKey },
            ck: { type: sql.Int, value: Number(row.custKey) },
            dt: { type: sql.DateTime, value: shipDate },
            outQty: { type: sql.Float, value: units.outQty },
            estQty: { type: sql.Float, value: estQty },
            box: { type: sql.Float, value: units.box },
            bunch: { type: sql.Float, value: units.bunch },
            steam: { type: sql.Float, value: units.steam },
            fallbackCost: { type: sql.Float, value: fallbackCost },
            log: { type: sql.NVarChar, value: newDescr },
          }
        );
        await refreshShipmentDatesAfterDetailChange(tQ, oldDetail.SdetailKey, sql, { shipDtm: shipDate });
        if (!sameQty(oldQty, units.outQty)) {
          await insertShipmentHistory(tQ, sql, oldDetail.SdetailKey, oldQty, units.outQty, log, uid);
          shipmentAction = '분배수정';
        } else {
          shipmentAction = '출고일정리';
        }
        shipmentChanged = true;
      } else {
        const log = importMemo(userName, 0, desiredQty);
        await assertShipmentLineHasOrder(tQ, sql, { orderYear, orderWeek: week, custKey: row.custKey, prodKey: row.prodKey });
        await assertShipmentWeekConsistent(tQ, sql, { orderYear, orderWeek: week, shipmentDtm: shipDate });
        const detailKey = await tryInsertWithRetry(tQ, 'ShipmentDetail', 'SdetailKey', async (newDk) => {
          await tQ(
            `INSERT INTO ShipmentDetail
               (SdetailKey,ShipmentKey,CustKey,ProdKey,ShipmentDtm,OutQuantity,EstQuantity,BoxQuantity,BunchQuantity,SteamQuantity,Cost,Amount,Vat,isFix,Descr)
             VALUES
               (@dk,@sk,@ck,@pk,@dt,@outQty,@estQty,@box,@bunch,@steam,@cost,
                ROUND(@cost * @estQty / 1.1, 0), ((@cost * @estQty) - ROUND(@cost * @estQty / 1.1, 0)),0,@log)`,
            {
              dk: { type: sql.Int, value: newDk },
              sk: { type: sql.Int, value: shipmentKey },
              ck: { type: sql.Int, value: Number(row.custKey) },
              pk: { type: sql.Int, value: Number(row.prodKey) },
              dt: { type: sql.DateTime, value: shipDate },
              outQty: { type: sql.Float, value: units.outQty },
              estQty: { type: sql.Float, value: estQty },
              box: { type: sql.Float, value: units.box },
              bunch: { type: sql.Float, value: units.bunch },
              steam: { type: sql.Float, value: units.steam },
              cost: { type: sql.Float, value: fallbackCost },
              log: { type: sql.NVarChar, value: log },
            }
          );
        });
        await syncKeyNumbering(tQ, sql, 'ShipmentDetailKey', 'ShipmentDetail', 'SdetailKey');
        await refreshShipmentDatesAfterDetailChange(tQ, detailKey, sql, { shipDtm: shipDate });
        await insertShipmentHistory(tQ, sql, detailKey, 0, units.outQty, log, uid);
        shipmentAction = '분배신규';
        shipmentChanged = true;
        shipmentDetailKey = detailKey;
      }

      if (shipmentChanged) {
        applied.push({
          key: `${row.custKey}|${row.prodKey}`,
          custKey: row.custKey,
          prodKey: row.prodKey,
          custName: label.custName,
          prodName: row.prodName,
          displayName: row.displayName || '',
          beforeQty: oldQty,
          afterQty: units.outQty,
          orderQty: desiredQty,
          shipmentAction,
          shipmentChanged,
          shipmentDetailKey,
          shipDate: formatDateYmd(shipDate),
          log: `${label.custName} / ${label.prodName}: ${shipmentAction} (주문기준 ${memoQty(desiredQty)}, 분배 ${memoQty(oldQty)}>${memoQty(units.outQty)}, 출고일 ${formatDateYmd(shipDate)})`,
        });
      }
    }

    return { applied, skippedNoOrderCount, skippedNoChangeCount, skippedZeroNoShipmentCount };
  });

  const appliedRows = result.applied || [];
  const productCount = new Set(targetRows.map(r => Number(r.prodKey))).size;
  const customerCount = new Set(targetRows.map(r => Number(r.custKey))).size;
  const logs = [
    `${week}차 업로드 품종 사전 일괄분배 완료`,
    `대상 범위: 품목 ${productCount}개, 업체 ${customerCount}개, 매칭행 ${targetRows.length}건`,
    `분배 반영 ${appliedRows.length}건, 이미 동일 ${result.skippedNoChangeCount || 0}건, 주문없음 제외 ${result.skippedNoOrderCount || 0}건`,
    ...appliedRows.slice(0, 500).map(r => r.log),
  ];
  if ((result.skippedZeroNoShipmentCount || 0) > 0) {
    logs.splice(3, 0, `주문 0 / 분배 없음 ${result.skippedZeroNoShipmentCount}건은 건너뜀`);
  }

  return {
    success: true,
    week,
    appliedCount: appliedRows.length,
    shipmentChangedCount: appliedRows.length,
    skippedNoChangeCount: result.skippedNoChangeCount || 0,
    skippedNoOrderCount: result.skippedNoOrderCount || 0,
    skippedZeroNoShipmentCount: result.skippedZeroNoShipmentCount || 0,
    productCount,
    customerCount,
    logs,
    appliedRows,
  };
}
