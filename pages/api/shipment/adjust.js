// pages/api/shipment/adjust.js
// 출고분배 ADD/CANCEL 단일 액션 + ShipmentAdjustment 이력 자동 기록
//
// POST  body: { custKey, prodKey, week, year, type: 'ADD'|'CANCEL', qty, unit, memo }
//   ADD    : OrderDetail += qty, ShipmentDetail += qty, Adjustment(ADD) INSERT
//   CANCEL : OrderDetail 변경없음, ShipmentDetail -= qty, Adjustment(CANCEL) INSERT
//
// GET   ?week=18-01&prodKey=456  → 해당 차수+품목의 Adjustment 시계열 (비고 렌더링용)

import { withTransaction, query, sql } from '../../../lib/db';
import { withAuth } from '../../../lib/auth';
import { withActionLog } from '../../../lib/withActionLog';
import { normalizeOrderUnit } from '../../../lib/orderUtils';

async function safeNextKey(tQ, table, keyCol) {
  const r = await tQ(
    `SELECT ISNULL(MAX(${keyCol}),0)+1 AS nk FROM ${table} WITH (UPDLOCK, HOLDLOCK)`,
    {}
  );
  return r.recordset[0].nk;
}

async function syncKeyNumbering(tQ, category, table, keyCol) {
  const allowed = {
    OrderMasterKey: ['OrderMaster', 'OrderMasterKey'],
    OrderDetailKey: ['OrderDetail', 'OrderDetailKey'],
    ShipmentMasterKey: ['ShipmentMaster', 'ShipmentKey'],
    ShipmentDetailKey: ['ShipmentDetail', 'SdetailKey'],
  };
  const [safeTable, safeKeyCol] = allowed[category] || [];
  if (safeTable !== table || safeKeyCol !== keyCol) throw new Error('invalid key numbering sync target');

  await tQ(
    `IF EXISTS (SELECT 1 FROM KeyNumbering WHERE Category=@cat)
       UPDATE KeyNumbering
          SET LastKeyNo = CASE WHEN LastKeyNo < x.MaxKey THEN x.MaxKey ELSE LastKeyNo END
         FROM KeyNumbering
         CROSS JOIN (SELECT ISNULL(MAX(${keyCol}),0) AS MaxKey FROM ${table}) x
        WHERE Category=@cat
     ELSE
       INSERT INTO KeyNumbering (Category, LastKeyNo, Descr)
       SELECT @cat, ISNULL(MAX(${keyCol}),0), '' FROM ${table}`,
    { cat: { type: sql.NVarChar, value: category } }
  );
}

// 차수 정규화: 'YYYY-WW-SS' → 'WW-SS' / year 추출
function normWeek(week) {
  const m = String(week || '').match(/^(\d{4})-(\d{2}-\d{2})$/);
  if (m) return { year: m[1], week: m[2] };
  return { year: String(new Date().getFullYear()), week: String(week || '') };
}

const columnExistsCache = {};
async function columnExists(tableName, columnName) {
  const key = `${tableName}.${columnName}`;
  if (columnExistsCache[key] !== undefined) return columnExistsCache[key];
  const r = await query(
    `SELECT CASE WHEN COL_LENGTH(@tableName, @columnName) IS NULL THEN 0 ELSE 1 END AS HasColumn`,
    {
      tableName:  { type: sql.NVarChar, value: `dbo.${tableName}` },
      columnName: { type: sql.NVarChar, value: columnName },
    }
  );
  columnExistsCache[key] = Number(r.recordset[0]?.HasColumn || 0) === 1;
  return columnExistsCache[key];
}

// 차수(예: "18-01") + 연도 → 정상 출고일(YYYY-MM-DD) 계산
// 14차/17차 옛 전산 패턴과 동일: 01차=월요일, 02차=목요일(+3), 03차=토요일(+5)
function weekToShipDate(weekStr, yearStr) {
  try {
    const year = parseInt(yearStr) || new Date().getFullYear();
    const [wStr, dStr] = String(weekStr || '').split('-');
    const weekNum = parseInt(wStr, 10);
    const delivNum = parseInt(dStr, 10) || 1;
    if (!weekNum) return null;
    const jan4 = new Date(year, 0, 4);
    const dayOfWeek = jan4.getDay() || 7;
    const monday = new Date(jan4);
    monday.setDate(jan4.getDate() - dayOfWeek + 1 + (weekNum - 1) * 7);
    const offsets = [0, 0, 3, 5];
    monday.setDate(monday.getDate() + (offsets[delivNum] ?? 0));
    return monday;
  } catch { return null; }
}

function weekToShipDateByBaseOutDay(weekStr, yearStr, baseDay) {
  try {
    const weekNum = parseInt(String(weekStr || '').split('-')[0], 10);
    const year = parseInt(yearStr, 10) || new Date().getFullYear();
    if (!weekNum) return null;

    const dateStart = new Date(year, 0, (weekNum - 1) * 7 + 1);
    const wednesday = new Date(dateStart);
    for (let i = 0; i < 7; i++) {
      if (wednesday.getDay() === 3) break;
      wednesday.setDate(wednesday.getDate() + 1);
    }

    const offsets = [0, 4, 5, 6, 1, 3, 2];
    const normalizedBaseDay = Number.isFinite(Number(baseDay)) ? Number(baseDay) : 0;
    wednesday.setDate(wednesday.getDate() + (offsets[normalizedBaseDay] ?? 0));
    return wednesday;
  } catch { return null; }
}

function calcShipmentAmount(qty, unitCost) {
  const amount = Math.round((Number(qty) || 0) * (Number(unitCost) || 0) / 1.1);
  const vat = Math.round((Number(qty) || 0) * (Number(unitCost) || 0) / 11);
  return { amount, vat };
}

async function getProductFixScope(q, prodKey) {
  const prod = await q(
    `SELECT TOP 1 ProdKey, ProdName, CountryFlower, CounName, FlowerName
       FROM Product
      WHERE ProdKey=@pk AND ISNULL(isDeleted,0)=0`,
    { pk: { type: sql.Int, value: Number(prodKey) } }
  );
  return prod.recordset[0] || null;
}

async function getProductScopeFixedRows(q, orderWeek, prodKey) {
  const prod = await getProductFixScope(q, prodKey);
  if (!prod) return { prod: null, rows: [] };

  const params = {
    wk: { type: sql.NVarChar, value: orderWeek },
    pk: { type: sql.Int, value: Number(prodKey) },
    cf: { type: sql.NVarChar, value: prod.CountryFlower || '' },
  };
  const scopeClause = prod.CountryFlower
    ? `ISNULL(p.CountryFlower, '') = @cf`
    : `p.ProdKey = @pk`;

  const fixed = await q(
    `SELECT TOP 5
            sd.SdetailKey,
            sd.ProdKey,
            p.ProdName,
            p.CountryFlower,
            c.CustName
       FROM ShipmentMaster sm
       JOIN ShipmentDetail sd ON sd.ShipmentKey=sm.ShipmentKey
       JOIN Product p ON p.ProdKey=sd.ProdKey
       LEFT JOIN Customer c ON c.CustKey=sm.CustKey
      WHERE sm.OrderWeek=@wk
        AND ISNULL(sm.isDeleted,0)=0
        AND ISNULL(sd.isFix,0)=1
        AND ${scopeClause}
      ORDER BY c.CustName, p.ProdName`,
    params
  );
  return { prod, rows: fixed.recordset || [] };
}

async function assertProductScopeNotFixed(q, orderWeek, prodKey) {
  const { prod, rows } = await getProductScopeFixedRows(q, orderWeek, prodKey);
  if (rows.length > 0) {
    const scopeName = prod?.CountryFlower || prod?.ProdName || `ProdKey ${prodKey}`;
    throw new Error(`${orderWeek}차 ${scopeName} 품목군은 이미 확정되어 출고분배/분배조정을 할 수 없습니다. 해당 품목군 확정취소 후 다시 진행하세요.`);
  }
}

async function assertWeekNotFixed(q, orderWeek) {
  const fixed = await q(
    `SELECT TOP 1 FixSource
       FROM (
         SELECT N'ShipmentMaster' AS FixSource
           FROM ShipmentMaster
          WHERE OrderWeek=@wk AND isDeleted=0 AND ISNULL(isFix,0)=1
         UNION ALL
         SELECT N'ShipmentDetail' AS FixSource
           FROM ShipmentMaster sm
           JOIN ShipmentDetail sd ON sd.ShipmentKey=sm.ShipmentKey
          WHERE sm.OrderWeek=@wk AND sm.isDeleted=0 AND ISNULL(sd.isFix,0)=1
         UNION ALL
         SELECT N'StockMaster' AS FixSource
           FROM StockMaster
          WHERE OrderWeek=@wk AND ISNULL(isFix,0)=1
       ) x`,
    { wk: { type: sql.NVarChar, value: orderWeek } }
  );
  if (fixed.recordset.length > 0) {
    throw new Error('확정된 차수는 출고분배/분배조정을 할 수 없습니다 (먼저 차수 확정을 해제하세요)');
  }
}

export default withAuth(withActionLog(async function handler(req, res) {
  if (req.method === 'GET') {
    if (req.query?.type === 'fixCheck') return await getFixCheck(req, res);
    return await getAdjustments(req, res);
  }
  if (req.method === 'POST') return await postAdjust(req, res);
  return res.status(405).json({ success: false, error: 'method not allowed' });
}, { actionType: 'SHIPMENT_ADJUST', affectedTable: 'ShipmentAdjustment', riskLevel: 'MEDIUM' }));

// ─────────────────────────────────────────────────────────────────────────
// GET — 시계열 조회 (비고 렌더링용)
// ─────────────────────────────────────────────────────────────────────────
async function getFixCheck(req, res) {
  const { week, prodKey, prodKeys } = req.query;
  if (!week) return res.status(400).json({ success: false, error: 'week 필요' });
  const { week: orderWeek } = normWeek(week);
  const keys = String(prodKeys || prodKey || '')
    .split(',')
    .map(v => parseInt(v, 10))
    .filter(v => Number.isFinite(v) && v > 0);
  if (keys.length === 0) return res.status(400).json({ success: false, error: 'prodKey 필요' });

  try {
    const blockedScopes = [];
    const seenScopes = new Set();
    for (const pk of keys) {
      const { prod, rows } = await getProductScopeFixedRows(query, orderWeek, pk);
      const scopeName = prod?.CountryFlower || prod?.ProdName || `ProdKey ${pk}`;
      if (seenScopes.has(scopeName)) continue;
      seenScopes.add(scopeName);
      if (rows.length > 0) {
        blockedScopes.push({
          prodKey: pk,
          scopeName,
          fixedCount: rows.length,
          samples: rows.map(r => ({
            prodKey: r.ProdKey,
            prodName: r.ProdName,
            custName: r.CustName,
          })),
        });
      }
    }
    return res.status(200).json({
      success: true,
      blocked: blockedScopes.length > 0,
      blockedScopes,
      message: blockedScopes.length
        ? `${orderWeek}차 ${blockedScopes.map(b => b.scopeName).join(', ')} 품목군은 확정 상태입니다.`
        : `${orderWeek}차 선택 품목군은 미확정 상태입니다.`,
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}

async function getAdjustments(req, res) {
  const { week, year, prodKey, custKey } = req.query;
  if (!week) return res.status(400).json({ success: false, error: 'week 필요' });
  const { week: orderWeek, year: orderYear } = normWeek(week);

  let where = `OrderWeek=@wk AND OrderYear=@yr`;
  const params = {
    wk: { type: sql.NVarChar, value: orderWeek },
    yr: { type: sql.NVarChar, value: year || orderYear },
  };
  if (prodKey) { where += ' AND ProdKey=@pk'; params.pk = { type: sql.Int, value: parseInt(prodKey) }; }
  if (custKey) { where += ' AND CustKey=@ck'; params.ck = { type: sql.Int, value: parseInt(custKey) }; }

  try {
    const r = await query(
      `SELECT a.AdjKey, a.OrderYear, a.OrderWeek, a.ProdKey, a.CustKey, a.AdjType,
              a.QtyDelta, a.QtyBefore, a.QtyAfter,
              a.OrderQtyBefore, a.OrderQtyAfter, a.RemainBefore, a.RemainAfter,
              a.Memo, a.CreateID, a.CreateDtm,
              c.CustName, c.CustArea, p.ProdName, p.DisplayName, p.FlowerName, p.OutUnit
       FROM ShipmentAdjustment a
       LEFT JOIN Customer c ON a.CustKey = c.CustKey
       LEFT JOIN Product  p ON a.ProdKey = p.ProdKey
       WHERE ${where}
       ORDER BY a.ProdKey, a.CreateDtm`,
      params
    );
    return res.status(200).json({ success: true, adjustments: r.recordset });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}

// ─────────────────────────────────────────────────────────────────────────
// POST — ADD/CANCEL 한 건
// ─────────────────────────────────────────────────────────────────────────
async function postAdjust(req, res) {
  const { custKey, prodKey, week, year, type, qty, unit, memo } = req.body;

  if (!custKey || !prodKey || !week || !type) {
    return res.status(400).json({ success: false, error: 'custKey, prodKey, week, type 필요' });
  }
  if (type !== 'ADD' && type !== 'CANCEL') {
    return res.status(400).json({ success: false, error: 'type은 ADD 또는 CANCEL' });
  }
  const delta = parseFloat(qty);
  if (!(delta > 0)) {
    return res.status(400).json({ success: false, error: 'qty는 양수여야 함' });
  }

  const { week: orderWeek, year: orderYear } = normWeek(week);
  const ywk = (year || orderYear) + orderWeek.replace('-', '');
  const ck = parseInt(custKey);
  const pk = parseInt(prodKey);
  const uid = req.user?.userId || 'system';
  const userName = req.user?.userName || uid;

  try {
    const hasOrderYearWeekColumn = await columnExists('OrderMaster', 'OrderYearWeek');
    const result = await withTransaction(async (tQ) => {
      await assertProductScopeNotFixed(tQ, orderWeek, pk);

      // 1) 품목 정보 (환산용)
      const pInfo = await tQ(
        `SELECT ProdName, OutUnit, ISNULL(BunchOf1Box,0) AS B1B, ISNULL(SteamOf1Box,0) AS S1B,
                ISNULL(Cost,0) AS ProductCost
           FROM Product WHERE ProdKey=@pk`,
        { pk: { type: sql.Int, value: pk } }
      );
      if (!pInfo.recordset[0]) throw new Error('품목 없음 ProdKey=' + pk);
      const prod = pInfo.recordset[0];
      const cpc = await tQ(
        `SELECT TOP 1 ISNULL(Cost,0) AS Cost
           FROM CustomerProdCost
          WHERE CustKey=@ck AND ProdKey=@pk`,
        { ck: { type: sql.Int, value: ck }, pk: { type: sql.Int, value: pk } }
      );
      const custInfo = await tQ(
        `SELECT TOP 1 ISNULL(BaseOutDay,0) AS BaseOutDay
           FROM Customer
          WHERE CustKey=@ck`,
        { ck: { type: sql.Int, value: ck } }
      );
      const baseOutDay = custInfo.recordset[0]?.BaseOutDay ?? 0;
      const defaultShipDate =
        weekToShipDateByBaseOutDay(orderWeek, orderYear, baseOutDay) ||
        weekToShipDate(orderWeek, orderYear) ||
        new Date();
      const defaultUnitCost = Number(cpc.recordset[0]?.Cost || 0) || Number(prod.ProductCost || 0) || 0;
      // userUnit: 사용자가 보는 단위 (박스/단/송이) — 표시값과 입력값의 단위
      // prodOutUnit: 마스터 단위 (저장 기준)
      const prodOutUnit = normalizeOrderUnit(prod.OutUnit, '박스');
      const userUnit = normalizeOrderUnit(unit, prodOutUnit);
      const B1B = prod.B1B || 0;
      const S1B = prod.S1B || 0;
      // qty/delta 를 3개 단위(박스/단/송이) 모두로 환산하는 헬퍼
      // qty 가 userUnit 기준일 때, 다른 두 단위로 비례 환산
      const toAllUnits = (qInUserUnit) => {
        let box, bunch, steam;
        if (userUnit === '박스') {
          box   = qInUserUnit;
          bunch = B1B > 0 ? qInUserUnit * B1B : 0;
          steam = S1B > 0 ? qInUserUnit * S1B : 0;
        } else if (userUnit === '단') {
          bunch = qInUserUnit;
          box   = B1B > 0 ? qInUserUnit / B1B : 0;
          steam = (B1B > 0 && S1B > 0) ? box * S1B : 0;
        } else { // 송이
          steam = qInUserUnit;
          box   = S1B > 0 ? qInUserUnit / S1B : 0;
          bunch = (S1B > 0 && B1B > 0) ? box * B1B : 0;
        }
        // OutQuantity = Product 의 OutUnit 기준 (canonical)
        const outQ = prodOutUnit === '단' ? bunch : prodOutUnit === '송이' ? steam : box;
        return { box, bunch, steam, outQ };
      };

      // 2) OrderMaster 확보 (UPDLOCK)
      const om = await tQ(
        `SELECT TOP 1 OrderMasterKey FROM OrderMaster WITH (UPDLOCK, HOLDLOCK)
          WHERE CustKey=@ck AND OrderWeek=@wk AND isDeleted=0
          ORDER BY OrderMasterKey ASC`,
        { ck: { type: sql.Int, value: ck }, wk: { type: sql.NVarChar, value: orderWeek } }
      );
      let mk;
      if (om.recordset.length === 0) {
        if (type === 'CANCEL') throw new Error('취소 대상 OrderMaster 없음');
        mk = await safeNextKey(tQ, 'OrderMaster', 'OrderMasterKey');
        const orderMasterParams = {
          mk:  { type: sql.Int,      value: mk },
          yr:  { type: sql.NVarChar, value: orderYear },
          wk:  { type: sql.NVarChar, value: orderWeek },
          ywk: { type: sql.NVarChar, value: orderYear + (orderWeek || '').replace('-', '') },
          mgr: { type: sql.NVarChar, value: req.user?.userId || 'admin' },
          ck:  { type: sql.Int,      value: ck },
          uid: { type: sql.NVarChar, value: 'admin' },
        };
        if (hasOrderYearWeekColumn) {
          await tQ(
            `INSERT INTO OrderMaster
               (OrderMasterKey,OrderDtm,OrderYear,OrderWeek,OrderYearWeek,Manager,CustKey,OrderCode,Descr,isDeleted,CreateID,CreateDtm,LastUpdateID,LastUpdateDtm)
             VALUES (@mk,GETDATE(),@yr,@wk,@ywk,@mgr,@ck,'','',0,@uid,GETDATE(),@uid,GETDATE())`,
            orderMasterParams
          );
        } else {
          await tQ(
            `INSERT INTO OrderMaster
               (OrderMasterKey,OrderDtm,OrderYear,OrderWeek,Manager,CustKey,OrderCode,Descr,isDeleted,CreateID,CreateDtm,LastUpdateID,LastUpdateDtm)
             VALUES (@mk,GETDATE(),@yr,@wk,@mgr,@ck,'','',0,@uid,GETDATE(),@uid,GETDATE())`,
            orderMasterParams
          );
        }
        await syncKeyNumbering(tQ, 'OrderMasterKey', 'OrderMaster', 'OrderMasterKey');
      } else {
        mk = om.recordset[0].OrderMasterKey;
      }

      // 3) OrderDetail 현재값 — userUnit 기준 (사용자 보는 단위)
      const odCur = await tQ(
        `SELECT OrderDetailKey,
                ISNULL(BoxQuantity,0)   AS curBox,
                ISNULL(BunchQuantity,0) AS curBunch,
                ISNULL(SteamQuantity,0) AS curSteam
           FROM OrderDetail WITH (UPDLOCK, HOLDLOCK)
          WHERE OrderMasterKey=@mk AND ProdKey=@pk AND isDeleted=0`,
        { mk: { type: sql.Int, value: mk }, pk: { type: sql.Int, value: pk } }
      );
      const odRow = odCur.recordset[0];
      const orderQtyBefore = !odRow ? 0
        : userUnit === '단'   ? odRow.curBunch
        : userUnit === '송이' ? odRow.curSteam
        : odRow.curBox;
      const orderQtyAfter  = type === 'ADD' ? orderQtyBefore + delta : orderQtyBefore;

      // ADD 일 때만 OrderDetail INSERT/UPDATE — 모든 단위 환산값 저장
      if (type === 'ADD') {
        const u = toAllUnits(orderQtyAfter);
        let targetOdk = odRow?.OrderDetailKey;

        if (odRow) {
          await tQ(
            `UPDATE OrderDetail SET
               BoxQuantity=@bq, BunchQuantity=@bnq, SteamQuantity=@sq,
               OutQuantity=@oq, EstQuantity=@oq, NoneOutQuantity=0,
               LastUpdateID=@uid, LastUpdateDtm=GETDATE()
             WHERE OrderMasterKey=@mk AND ProdKey=@pk AND isDeleted=0`,
            { bq: { type: sql.Float, value: u.box }, bnq: { type: sql.Float, value: u.bunch },
              sq: { type: sql.Float, value: u.steam },
              oq: { type: sql.Float, value: u.outQ },
              uid: { type: sql.NVarChar, value: uid },
              mk: { type: sql.Int, value: mk }, pk: { type: sql.Int, value: pk } }
          );
        } else {
          const odk = await safeNextKey(tQ, 'OrderDetail', 'OrderDetailKey');
          targetOdk = odk;
          await tQ(
            `INSERT INTO OrderDetail
               (OrderDetailKey,OrderMasterKey,ProdKey,BoxQuantity,BunchQuantity,SteamQuantity,
                OutQuantity,EstQuantity,NoneOutQuantity,isDeleted,CreateID,CreateDtm)
             VALUES (@nk,@mk,@pk,@bq,@bnq,@sq,@oq,@oq,0,0,@uid,GETDATE())`,
            { nk: { type: sql.Int, value: odk }, mk: { type: sql.Int, value: mk }, pk: { type: sql.Int, value: pk },
              bq: { type: sql.Float, value: u.box }, bnq: { type: sql.Float, value: u.bunch },
              sq: { type: sql.Float, value: u.steam },
              oq: { type: sql.Float, value: u.outQ },
              uid: { type: sql.NVarChar, value: 'admin' } }
          );
          await syncKeyNumbering(tQ, 'OrderDetailKey', 'OrderDetail', 'OrderDetailKey');
        }
        if (targetOdk) {
          await insertOrderHistory(
            tQ,
            targetOdk,
            String(orderQtyBefore),
            String(orderQtyAfter),
            `[${formatLogTime()} ${userName}] paste order + distribute`,
            uid
          );
        }
      }

      // 4) ShipmentMaster 확보 + isFix 보호
      const sm = await tQ(
        `SELECT TOP 1 ShipmentKey, ISNULL(isFix,0) AS isFix FROM ShipmentMaster WITH (UPDLOCK, HOLDLOCK)
          WHERE CustKey=@ck AND OrderWeek=@wk AND isDeleted=0
          ORDER BY ISNULL(isFix,0) DESC, ShipmentKey ASC`,
        { ck: { type: sql.Int, value: ck }, wk: { type: sql.NVarChar, value: orderWeek } }
      );
      let sk;
      if (sm.recordset.length === 0) {
        if (type === 'CANCEL') throw new Error('취소 대상 ShipmentMaster 없음');
        sk = await safeNextKey(tQ, 'ShipmentMaster', 'ShipmentKey');
        await tQ(
          `INSERT INTO ShipmentMaster
             (ShipmentKey,OrderYear,OrderWeek,OrderYearWeek,CustKey,isFix,isDeleted,WebCreated,CreateID,CreateDtm)
           VALUES (@sk,@yr,@wk,@ywk,@ck,0,0,1,@uid,GETDATE())`,
          {
            sk:  { type: sql.Int,      value: sk },
            yr:  { type: sql.NVarChar, value: orderYear },
            wk:  { type: sql.NVarChar, value: orderWeek },
            ywk: { type: sql.NVarChar, value: ywk },
            ck:  { type: sql.Int,      value: ck },
            uid: { type: sql.NVarChar, value: uid },
          }
        );
        await syncKeyNumbering(tQ, 'ShipmentMasterKey', 'ShipmentMaster', 'ShipmentKey');
      } else {
        sk = sm.recordset[0].ShipmentKey;
      }

      // 5) ShipmentDetail 현재값 — userUnit 기준
      const sdCur = await tQ(
        `SELECT SdetailKey,
                ISNULL(BoxQuantity,0)   AS curBox,
                ISNULL(BunchQuantity,0) AS curBunch,
                ISNULL(SteamQuantity,0) AS curSteam,
                ISNULL(OutQuantity,0)   AS curOut,
                ISNULL(Cost,0)          AS curCost
           FROM ShipmentDetail WITH (UPDLOCK, HOLDLOCK)
          WHERE ShipmentKey=@sk AND ProdKey=@pk`,
        { sk: { type: sql.Int, value: sk }, pk: { type: sql.Int, value: pk } }
      );
      const sdRow = sdCur.recordset[0];
      const qtyBefore = !sdRow ? 0
        : userUnit === '단'   ? sdRow.curBunch
        : userUnit === '송이' ? sdRow.curSteam
        : sdRow.curBox;
      const qtyAfter  = type === 'ADD' ? qtyBefore + delta : qtyBefore - delta;
      if (qtyAfter < 0) throw new Error(`취소량(${delta}${userUnit})이 현재 출고(${qtyBefore}${userUnit})보다 큼`);

      const u = toAllUnits(qtyAfter);
      const outQBefore = !sdRow ? 0 : sdRow.curOut;
      const outQAfter  = u.outQ;
      const unitCost = Number(sdRow?.curCost || 0) || defaultUnitCost;
      const amountBase = u.bunch > 0 ? u.bunch : u.box;
      const { amount, vat } = calcShipmentAmount(amountBase, unitCost);

      let targetSdk;
      if (sdRow) {
        targetSdk = sdRow.SdetailKey;
        await tQ(
          `UPDATE ShipmentDetail SET
             OutQuantity=@oq, EstQuantity=@estQty,
             BoxQuantity=@bq, BunchQuantity=@bnq, SteamQuantity=@sq,
             CustKey=ISNULL(CustKey,@ck),
             Cost=@cost, Amount=@amount, Vat=@vat,
             ShipmentDtm=ISNULL(ShipmentDtm,@dt)
           WHERE SdetailKey=@dk`,
          { dk: { type: sql.Int, value: targetSdk },
            ck: { type: sql.Int, value: ck },
            dt: { type: sql.DateTime, value: defaultShipDate },
            oq: { type: sql.Float, value: u.outQ },
            estQty: { type: sql.Float, value: amountBase },
            bq: { type: sql.Float, value: u.box },
            bnq:{ type: sql.Float, value: u.bunch },
            sq: { type: sql.Float, value: u.steam },
            cost: { type: sql.Float, value: unitCost },
            amount: { type: sql.Float, value: amount },
            vat: { type: sql.Float, value: vat } }
        );
      } else if (type === 'ADD') {
        const sdk = await safeNextKey(tQ, 'ShipmentDetail', 'SdetailKey');
        // ShipmentDtm: Customer.BaseOutDay first, then the old week/delivery fallback.
        await tQ(
          `INSERT INTO ShipmentDetail
             (SdetailKey,ShipmentKey,CustKey,ProdKey,ShipmentDtm,OutQuantity,EstQuantity,
              BoxQuantity,BunchQuantity,SteamQuantity,Cost,Amount,Vat,isFix,Descr)
           VALUES (@dk,@sk,@ck,@pk,@dt,@oq,@estQty,@bq,@bnq,@sq,@cost,@amount,@vat,0,'')`,
          { dk: { type: sql.Int, value: sdk }, sk: { type: sql.Int, value: sk }, pk: { type: sql.Int, value: pk },
            ck: { type: sql.Int, value: ck },
            dt: { type: sql.DateTime, value: defaultShipDate },
            oq: { type: sql.Float, value: u.outQ },
            estQty: { type: sql.Float, value: amountBase },
            bq: { type: sql.Float, value: u.box },
            bnq:{ type: sql.Float, value: u.bunch },
            sq: { type: sql.Float, value: u.steam },
            cost: { type: sql.Float, value: unitCost },
            amount: { type: sql.Float, value: amount },
            vat: { type: sql.Float, value: vat } }
        );
        await syncKeyNumbering(tQ, 'ShipmentDetailKey', 'ShipmentDetail', 'SdetailKey');
        targetSdk = sdk;
      }

      if (targetSdk) {
        const conciseLog = `[${userName}]${fmtQty(qtyBefore)}>${fmtQty(qtyAfter)}(${formatSignedQty(qtyAfter - qtyBefore)})`;
        await tQ(
          `UPDATE ShipmentDetail
              SET Descr = ISNULL(NULLIF(Descr,''), '') +
                          CASE WHEN ISNULL(Descr,'')='' THEN '' ELSE CHAR(10) END + @descr
            WHERE SdetailKey=@dk`,
          {
            dk:    { type: sql.Int,      value: targetSdk },
            descr: { type: sql.NVarChar, value: conciseLog },
          }
        );
        await insertShipmentHistory(
          tQ,
          targetSdk,
          String(outQBefore),
          String(outQAfter),
          conciseLog,
          uid
        );
      }

      // ShipmentDate 동기화 — 전산 SP usp_ShipmentFix 의 출고일 합 검증 통과용
      // 정책: 기존 ShipmentDate 행 모두 삭제 후 ShipmentDtm 기준 단일 행 INSERT
      //       (출고일별 분배는 견적서/분배 화면에서 별도 입력하지 않으므로 단일화)
      // OutQuantity 가 0 으로 떨어지면 ShipmentDate 도 비우기
      if (targetSdk) {
        await tQ(
          `DELETE FROM ShipmentDate WHERE SdetailKey=@dk`,
          { dk: { type: sql.Int, value: targetSdk } }
        );
        if (u.outQ > 0) {
          // ShipmentDtm 은 ShipmentDetail 에서 가져옴 (방금 UPDATE/INSERT 한 값)
          await tQ(
            `INSERT INTO ShipmentDate (SdetailKey, ShipmentDtm, ShipmentQuantity, EstQuantity, Cost, Amount, Vat)
             SELECT @dk, ShipmentDtm, @oq, @estQty, @cost, @amount, @vat FROM ShipmentDetail WHERE SdetailKey=@dk`,
            {
              dk: { type: sql.Int, value: targetSdk },
              oq: { type: sql.Float, value: u.outQ },
              estQty: { type: sql.Float, value: amountBase },
              cost: { type: sql.Float, value: unitCost },
              amount: { type: sql.Float, value: amount },
              vat: { type: sql.Float, value: vat },
            }
          );
        }
      }

      // 6) 입고 초과 ADD 경고 (음수 잔량 방지) — totalIn < 새로운 totalOut 이면 경고
      // 단, totalIn=0 (입고 미등록 차수)인 경우는 허용 (선분배 패턴)
      // 잔량 계산: 입고합 − Σ(ShipmentDetail.OutQuantity by ProdKey,Week)
      const remainQ = await tQ(
        `SELECT
           ISNULL((SELECT SUM(wd.OutQuantity) FROM WarehouseDetail wd
                   JOIN WarehouseMaster wm ON wd.WarehouseKey=wm.WarehouseKey
                   WHERE wd.ProdKey=@pk AND wm.OrderWeek=@wk AND wm.isDeleted=0),0) AS totalIn,
           ISNULL((SELECT SUM(sd.OutQuantity) FROM ShipmentDetail sd
                   JOIN ShipmentMaster sm ON sd.ShipmentKey=sm.ShipmentKey
                   WHERE sd.ProdKey=@pk AND sm.OrderWeek=@wk AND sm.isDeleted=0),0) AS totalOut`,
        { pk: { type: sql.Int, value: pk }, wk: { type: sql.NVarChar, value: orderWeek } }
      );
      const totalIn  = remainQ.recordset[0].totalIn  || 0;
      const totalOut = remainQ.recordset[0].totalOut || 0;
      // OutQuantity 단위로 전후 환산 (totalOut 도 OutQuantity 기준이므로)
      // remainBefore: 이 행 변경 직전 시점
      const remainBefore = totalIn - (totalOut - outQAfter + outQBefore);
      const remainAfter  = totalIn - totalOut;

      // 입고검증 — 견적서/확정 단계 오류 예방
      // (a) 입고 0 인데 출고 ADD: "선분배" 패턴. 견적서에서 입고없는 출고로 보임 → 기본 차단, force=true 시만 허용
      // (b) 입고 < 출고 (remainAfter < 0): 잔량 음수, 차수 확정 시 fix.js validate 에서 거부됨 → 차단
      if (type === 'ADD' && !req.body.force) {
        if (totalIn === 0) {
          throw new Error(`입고 미등록 차수입니다. WarehouseDetail 입고 등록 후 분배하세요.\n선분배가 의도라면 force=true 로 강제 진행 (견적서 입고없는출고로 보일 수 있음)`);
        }
        if (totalIn > 0 && remainAfter < 0) {
          throw new Error(`입고(${totalIn}) 초과 분배: 총 ${totalOut} 분배 → 잔량 ${remainAfter}\n강제 진행하려면 force=true (관리자만)`);
        }
      }

      // 7) ShipmentAdjustment INSERT
      await tQ(
        `INSERT INTO ShipmentAdjustment
           (OrderYear, OrderWeek, ProdKey, CustKey, AdjType, QtyDelta,
            QtyBefore, QtyAfter, OrderQtyBefore, OrderQtyAfter,
            RemainBefore, RemainAfter, Memo, CreateID, CreateDtm)
         VALUES (@yr,@wk,@pk,@ck,@ty,@qd,@qb,@qa,@oqb,@oqa,@rb,@ra,@m,@uid,GETDATE())`,
        {
          yr:  { type: sql.NVarChar,  value: orderYear },
          wk:  { type: sql.NVarChar,  value: orderWeek },
          pk:  { type: sql.Int,       value: pk },
          ck:  { type: sql.Int,       value: ck },
          ty:  { type: sql.NVarChar,  value: type },
          qd:  { type: sql.Decimal(14,3), value: delta },
          qb:  { type: sql.Decimal(14,3), value: qtyBefore },
          qa:  { type: sql.Decimal(14,3), value: qtyAfter },
          oqb: { type: sql.Decimal(14,3), value: orderQtyBefore },
          oqa: { type: sql.Decimal(14,3), value: orderQtyAfter },
          rb:  { type: sql.Decimal(14,3), value: remainBefore },
          ra:  { type: sql.Decimal(14,3), value: remainAfter },
          m:   { type: sql.NVarChar,  value: memo || '' },
          uid: { type: sql.NVarChar,  value: uid },
        }
      );

      return { qtyBefore, qtyAfter, orderQtyBefore, orderQtyAfter, remainBefore, remainAfter, totalIn, totalOut };
    });

    return res.status(200).json({
      success: true,
      type,
      delta,
      ...result,
      message: `${type === 'ADD' ? '추가' : '취소'} 완료 — ${result.qtyBefore} → ${result.qtyAfter}`,
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}

function formatLogTime() {
  const now = new Date();
  return `${String(now.getMonth() + 1).padStart(2, '0')}/${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
}

function fmtQty(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value ?? '');
  if (Math.abs(n - Math.round(n)) < 0.0001) return String(Math.round(n));
  return n.toFixed(3).replace(/\.?0+$/, '');
}

function formatSignedQty(value) {
  const n = Number(value) || 0;
  const body = fmtQty(Math.abs(n));
  return `${n >= 0 ? '+' : '-'}${body}`;
}

async function insertOrderHistory(tQ, detailKey, before, after, descr, uid) {
  try {
    await tQ(
      `INSERT INTO OrderHistory
         (OrderDetailKey, ChangeType, ColumName, BeforeValue, AfterValue, Descr, ChangeID, ChangeDtm)
       VALUES (@dk, N'수정', N'수량', @before, @after, @descr, @uid, GETDATE())`,
      {
        dk:     { type: sql.Int,      value: detailKey },
        before: { type: sql.NVarChar, value: before },
        after:  { type: sql.NVarChar, value: after },
        descr:  { type: sql.NVarChar, value: descr },
        uid:    { type: sql.NVarChar, value: uid },
      }
    );
  } catch (e) {
    console.warn('[OrderHistory INSERT failed]', e.message);
  }
}

async function insertShipmentHistory(tQ, sdetailKey, before, after, descr, uid) {
  try {
    await tQ(
      `INSERT INTO ShipmentHistory
         (SdetailKey, ShipmentDtm, ChangeType, ColumName, BeforeValue, AfterValue, Descr, ChangeID, ChangeDtm)
       SELECT @dk, ShipmentDtm, N'수정', N'OutQuantity', @before, @after, @descr, @uid, GETDATE()
         FROM ShipmentDetail
        WHERE SdetailKey=@dk`,
      {
        dk:     { type: sql.Int,      value: sdetailKey },
        before: { type: sql.NVarChar, value: before },
        after:  { type: sql.NVarChar, value: after },
        descr:  { type: sql.NVarChar, value: descr },
        uid:    { type: sql.NVarChar, value: uid },
      }
    );
  } catch (e) {
    console.warn('[ShipmentHistory INSERT failed]', e.message);
  }
}
