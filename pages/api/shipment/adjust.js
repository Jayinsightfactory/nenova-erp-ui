// pages/api/shipment/adjust.js
// 출고분배 ADD/CANCEL 단일 액션 + ShipmentAdjustment 이력 자동 기록
//
// POST  body: { custKey, prodKey, week, year, type: 'ADD'|'CANCEL', qty, unit, memo }
//   ADD    : OrderDetail += qty, ShipmentDetail += qty, Adjustment(ADD) INSERT
//   CANCEL : OrderDetail -= qty, ShipmentDetail -= qty, Adjustment(CANCEL) INSERT
//            주문수량이 0으로 돌아가면 OrderDetail 삭제 처리
//
// GET   ?week=18-01&prodKey=456  → 해당 차수+품목의 Adjustment 시계열 (비고 렌더링용)

import { withTransaction, query, sql } from '../../../lib/db';
import { withAuth } from '../../../lib/auth';
import { withActionLog } from '../../../lib/withActionLog';
import { normalizeOrderUnit } from '../../../lib/orderUtils';
import { changeEntry, appendDescr } from '../../../lib/shipmentDescr';

async function safeNextKey(tQ, table, keyCol) {
  const r = await tQ(
    `SELECT ISNULL(MAX(${keyCol}),0)+1 AS nk FROM ${table} WITH (UPDLOCK, HOLDLOCK)`,
    {}
  );
  return r.recordset[0].nk;
}

function isPkCollision(e) {
  return e?.number === 2627 || e?.number === 2601 || /PRIMARY KEY|duplicate key|UNIQUE/i.test(e?.message || '');
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

function isNetherlandsProduct(prod = {}) {
  return /네덜란드|netherlands|holland|dutch/i.test(String(prod.CounName || ''));
}

function extractMoqText(prod = {}) {
  if (!isNetherlandsProduct(prod)) return '';
  const descr = String(prod.ProdDescr || prod.Descr || '').trim();
  if (!descr) return '';
  const line = descr.split(/\r?\n/).find(v => /moq|엠오큐|최소/i.test(v)) || '';
  const m = line.match(/(?:moq|엠오큐|최소)\s*[:：=]?\s*([^,;/\n]+)/i);
  return (m ? `MOQ ${m[1].trim()}` : line.trim()).trim();
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

    const dateStart = new Date(year, 0, (weekNum - 1) * 7 + 1, 12, 0, 0, 0);
    const wednesday = new Date(dateStart);
    const daysBackToWednesday = (wednesday.getDay() - 3 + 7) % 7;
    wednesday.setDate(wednesday.getDate() - daysBackToWednesday);

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

function qtyForUnit(row, userUnit, keys) {
  const unitQty = userUnit === '단'
    ? Number(row?.[keys.bunch] || 0)
    : userUnit === '송이'
      ? Number(row?.[keys.steam] || 0)
      : Number(row?.[keys.box] || 0);
  if (unitQty !== 0) return unitQty;
  return Number(row?.[keys.out] || 0);
}

function toShipmentUnits(outQty, bunchOf1Box, steamOf1Box) {
  const qty = Number(outQty || 0);
  const b1b = Number(bunchOf1Box || 0);
  const s1b = Number(steamOf1Box || 0);
  return {
    box: qty,
    bunch: b1b > 0 ? qty * b1b : 0,
    steam: s1b > 0 ? qty * s1b : 0,
    outQ: qty,
  };
}

function estimateQuantityFromShipmentUnits(units) {
  if (Number(units.bunch || 0) > 0) return Number(units.bunch || 0);
  if (Number(units.steam || 0) > 0) return Number(units.steam || 0);
  return Number(units.box || 0);
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

  let where = `a.OrderWeek=@wk AND a.OrderYear=@yr`;
  const params = {
    wk: { type: sql.NVarChar, value: orderWeek },
    yr: { type: sql.NVarChar, value: year || orderYear },
  };
  if (prodKey) { where += ' AND a.ProdKey=@pk'; params.pk = { type: sql.Int, value: parseInt(prodKey) }; }
  if (custKey) { where += ' AND a.CustKey=@ck'; params.ck = { type: sql.Int, value: parseInt(custKey) }; }

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
    const hasShipmentYearWeekColumn = await columnExists('ShipmentMaster', 'OrderYearWeek');
    const hasOrderDetailDescrColumn = await columnExists('OrderDetail', 'Descr');
    const result = await withTransaction(async (tQ) => {
      await assertProductScopeNotFixed(tQ, orderWeek, pk);

      // 1) 품목 정보 (환산용)
      const pInfo = await tQ(
        `SELECT ProdName, OutUnit, CounName, ISNULL(Descr,'') AS ProdDescr,
                ISNULL(BunchOf1Box,0) AS B1B, ISNULL(SteamOf1Box,0) AS S1B,
                ISNULL(Cost,0) AS ProductCost
           FROM Product WHERE ProdKey=@pk`,
        { pk: { type: sql.Int, value: pk } }
      );
      if (!pInfo.recordset[0]) throw new Error('품목 없음 ProdKey=' + pk);
      const prod = pInfo.recordset[0];
      const orderDetailDescr = extractMoqText(prod);
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
        const convertedOutQ = prodOutUnit === '단' ? bunch : prodOutUnit === '송이' ? steam : box;
        const outQ = Number(convertedOutQ || 0) !== 0 || !(Number(qInUserUnit) > 0)
          ? convertedOutQ
          : Number(qInUserUnit);
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
        mk = await tryInsertWithRetry(tQ, 'OrderMaster', 'OrderMasterKey', async (newMk) => {
          const orderMasterParams = {
            mk:  { type: sql.Int,      value: newMk },
            yr:  { type: sql.NVarChar, value: orderYear },
            wk:  { type: sql.NVarChar, value: orderWeek },
            ywk: { type: sql.NVarChar, value: orderYear + (orderWeek || '').replace('-', '') },
            mgr: { type: sql.NVarChar, value: '관리자' },
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
        });
        await syncKeyNumbering(tQ, 'OrderMasterKey', 'OrderMaster', 'OrderMasterKey');
      } else {
        mk = om.recordset[0].OrderMasterKey;
      }

      // 3) OrderDetail 현재값 — userUnit 기준 (사용자 보는 단위)
      const odCur = await tQ(
        `SELECT OrderDetailKey,
                ISNULL(BoxQuantity,0)   AS curBox,
                ISNULL(BunchQuantity,0) AS curBunch,
                ISNULL(SteamQuantity,0) AS curSteam,
                ISNULL(OutQuantity,0)   AS curOut
           FROM OrderDetail WITH (UPDLOCK, HOLDLOCK)
          WHERE OrderMasterKey=@mk AND ProdKey=@pk AND isDeleted=0`,
        { mk: { type: sql.Int, value: mk }, pk: { type: sql.Int, value: pk } }
      );
      const odRow = odCur.recordset[0];
      const orderQtyBefore = !odRow ? 0
        : qtyForUnit(odRow, userUnit, { box: 'curBox', bunch: 'curBunch', steam: 'curSteam', out: 'curOut' });
      let orderQtyAfter  = type === 'ADD' ? orderQtyBefore + delta : orderQtyBefore - delta;
      let orderDeleted = false;
      let orderDeleteReason = '';
      if (type === 'CANCEL' && orderQtyAfter < -0.0001) {
        throw new Error(`취소량(${delta}${userUnit})이 현재 주문(${orderQtyBefore})보다 큼`);
      }

      // ADD/CANCEL 모두 OrderDetail을 델타 반영한다. 취소는 주문수량도 같이 감소한다.
      if (type === 'ADD' || type === 'CANCEL') {
        const normalizedOrderAfter = Math.max(0, orderQtyAfter);
        const u = toAllUnits(normalizedOrderAfter);
        let targetOdk = odRow?.OrderDetailKey;

        if (odRow && normalizedOrderAfter <= 0) {
          await tQ(
            `UPDATE OrderDetail SET
               BoxQuantity=0, BunchQuantity=0, SteamQuantity=0,
               OutQuantity=0, EstQuantity=0, NoneOutQuantity=0,
               isDeleted=1,
               LastUpdateID=@uid, LastUpdateDtm=GETDATE()
             WHERE OrderDetailKey=@dk`,
            {
              dk: { type: sql.Int, value: targetOdk },
              uid: { type: sql.NVarChar, value: uid },
            }
          );
          orderDeleted = true;
          orderDeleteReason = 'cancel_order_zero';
          orderQtyAfter = 0;
        } else if (odRow) {
          const updateDescrSql = hasOrderDetailDescrColumn
            ? `Descr = CASE WHEN @descr<>'' AND ISNULL(Descr,'')='' THEN @descr ELSE Descr END,`
            : '';
          await tQ(
            `UPDATE OrderDetail SET
               BoxQuantity=@bq, BunchQuantity=@bnq, SteamQuantity=@sq,
               OutQuantity=@oq, EstQuantity=@oq, NoneOutQuantity=0,
               ${updateDescrSql}
               LastUpdateID=@uid, LastUpdateDtm=GETDATE()
             WHERE OrderMasterKey=@mk AND ProdKey=@pk AND isDeleted=0`,
            { bq: { type: sql.Float, value: u.box }, bnq: { type: sql.Float, value: u.bunch },
              sq: { type: sql.Float, value: u.steam },
              oq: { type: sql.Float, value: u.outQ },
              descr: { type: sql.NVarChar, value: orderDetailDescr },
              uid: { type: sql.NVarChar, value: uid },
              mk: { type: sql.Int, value: mk }, pk: { type: sql.Int, value: pk } }
          );
        } else if (type === 'ADD' && normalizedOrderAfter > 0) {
          targetOdk = await tryInsertWithRetry(tQ, 'OrderDetail', 'OrderDetailKey', async (newOdk) => {
            const insertCols = hasOrderDetailDescrColumn
              ? `(OrderDetailKey,OrderMasterKey,ProdKey,BoxQuantity,BunchQuantity,SteamQuantity,
                  OutQuantity,EstQuantity,NoneOutQuantity,Descr,isDeleted,CreateID,CreateDtm)`
              : `(OrderDetailKey,OrderMasterKey,ProdKey,BoxQuantity,BunchQuantity,SteamQuantity,
                  OutQuantity,EstQuantity,NoneOutQuantity,isDeleted,CreateID,CreateDtm)`;
            const insertValues = hasOrderDetailDescrColumn
              ? `(@nk,@mk,@pk,@bq,@bnq,@sq,@oq,@oq,0,@descr,0,@uid,GETDATE())`
              : `(@nk,@mk,@pk,@bq,@bnq,@sq,@oq,@oq,0,0,@uid,GETDATE())`;
            await tQ(
              `INSERT INTO OrderDetail ${insertCols} VALUES ${insertValues}`,
              { nk: { type: sql.Int, value: newOdk }, mk: { type: sql.Int, value: mk }, pk: { type: sql.Int, value: pk },
                bq: { type: sql.Float, value: u.box }, bnq: { type: sql.Float, value: u.bunch },
                sq: { type: sql.Float, value: u.steam },
                oq: { type: sql.Float, value: u.outQ },
                descr: { type: sql.NVarChar, value: orderDetailDescr },
                uid: { type: sql.NVarChar, value: 'admin' } }
            );
          });
          await syncKeyNumbering(tQ, 'OrderDetailKey', 'OrderDetail', 'OrderDetailKey');
        } else {
          throw new Error('취소 대상 OrderDetail 없음');
        }
        if (targetOdk) {
          await insertOrderHistory(
            tQ,
            targetOdk,
            String(orderQtyBefore),
            String(orderQtyAfter),
            `붙여넣기 주문${type === 'ADD' ? '추가' : '취소'}`,
            uid
          );
        }
        if (orderDeleted) {
          await tQ(
            `UPDATE OrderMaster
                SET isDeleted=1, LastUpdateID=@uid, LastUpdateDtm=GETDATE()
              WHERE OrderMasterKey=@mk
                AND ISNULL(isDeleted,0)=0
                AND NOT EXISTS (
                  SELECT 1 FROM OrderDetail
                   WHERE OrderMasterKey=@mk AND ISNULL(isDeleted,0)=0
                )`,
            { mk: { type: sql.Int, value: mk }, uid: { type: sql.NVarChar, value: uid } }
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
        sk = await tryInsertWithRetry(tQ, 'ShipmentMaster', 'ShipmentKey', async (newSk) => {
          const shipmentMasterParams = {
            sk:  { type: sql.Int,      value: newSk },
            yr:  { type: sql.NVarChar, value: orderYear },
            wk:  { type: sql.NVarChar, value: orderWeek },
            ywk: { type: sql.NVarChar, value: ywk },
            ck:  { type: sql.Int,      value: ck },
            uid: { type: sql.NVarChar, value: uid },
          };
          if (hasShipmentYearWeekColumn) {
            await tQ(
              `INSERT INTO ShipmentMaster
                 (ShipmentKey,OrderYear,OrderWeek,OrderYearWeek,CustKey,isFix,isDeleted,WebCreated,CreateID,CreateDtm)
               VALUES (@sk,@yr,@wk,@ywk,@ck,0,0,1,@uid,GETDATE())`,
              shipmentMasterParams
            );
          } else {
            await tQ(
              `INSERT INTO ShipmentMaster
                 (ShipmentKey,OrderYear,OrderWeek,CustKey,isFix,isDeleted,WebCreated,CreateID,CreateDtm)
               VALUES (@sk,@yr,@wk,@ck,0,0,1,@uid,GETDATE())`,
              shipmentMasterParams
            );
          }
        });
        await syncKeyNumbering(tQ, 'ShipmentMasterKey', 'ShipmentMaster', 'ShipmentKey');
      } else {
        sk = sm.recordset[0].ShipmentKey;
      }

      // 5) ShipmentDetail 현재값 — exe 호환 기준: OutQuantity 단일값
      const sdCur = await tQ(
        `SELECT SdetailKey,
                ISNULL(BoxQuantity,0)   AS curBox,
                ISNULL(BunchQuantity,0) AS curBunch,
                ISNULL(SteamQuantity,0) AS curSteam,
                ISNULL(OutQuantity,0)   AS curOut,
                ISNULL(Cost,0)          AS curCost,
                ISNULL(Descr,'')        AS curDescr
           FROM ShipmentDetail WITH (UPDLOCK, HOLDLOCK)
          WHERE ShipmentKey=@sk AND ProdKey=@pk`,
        { sk: { type: sql.Int, value: sk }, pk: { type: sql.Int, value: pk } }
      );
      const sdRow = sdCur.recordset[0];
      const qtyBefore = !sdRow ? 0 : Number(sdRow.curOut || 0);
      const qtyAfter  = type === 'ADD' ? qtyBefore + delta : qtyBefore - delta;
      if (qtyAfter < 0) throw new Error(`취소량(${delta}${userUnit})이 현재 출고(${qtyBefore})보다 큼`);

      const u = toShipmentUnits(qtyAfter, B1B, S1B);
      const outQBefore = qtyBefore;
      const outQAfter  = u.outQ;
      const unitCost = Number(sdRow?.curCost || 0) || defaultUnitCost;
      const amountBase = estimateQuantityFromShipmentUnits(u);
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
        // ShipmentDtm: Customer.BaseOutDay first, then the old week/delivery fallback.
        const sdk = await tryInsertWithRetry(tQ, 'ShipmentDetail', 'SdetailKey', async (newSdk) => {
          await tQ(
            `INSERT INTO ShipmentDetail
               (SdetailKey,ShipmentKey,CustKey,ProdKey,ShipmentDtm,OutQuantity,EstQuantity,
                BoxQuantity,BunchQuantity,SteamQuantity,Cost,Amount,Vat,isFix,Descr)
             VALUES (@dk,@sk,@ck,@pk,@dt,@oq,@estQty,@bq,@bnq,@sq,@cost,@amount,@vat,0,'')`,
            { dk: { type: sql.Int, value: newSdk }, sk: { type: sql.Int, value: sk }, pk: { type: sql.Int, value: pk },
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
        });
        await syncKeyNumbering(tQ, 'ShipmentDetailKey', 'ShipmentDetail', 'SdetailKey');
        targetSdk = sdk;
      }

      if (targetSdk) {
        // 전산 비고(Descr): "담당자+이전>이후" 항목을 맨 뒤 2건만 콤마로 표기(최신화).
        //   예) "임16>12,임12>14"  — 전체 이력은 ShipmentHistory 에 별도 보존.
        const entry = changeEntry(userName, qtyBefore, qtyAfter);
        const prevDescr = sdRow ? String(sdRow.curDescr || '') : '';
        const newDescr = appendDescr(prevDescr, entry);
        await tQ(
          `UPDATE ShipmentDetail SET Descr=@descr WHERE SdetailKey=@dk`,
          {
            dk:    { type: sql.Int,      value: targetSdk },
            descr: { type: sql.NVarChar, value: newDescr },
          }
        );
        await insertShipmentHistory(
          tQ,
          targetSdk,
          String(outQBefore),
          String(outQAfter),
          entry,
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
      // 잔량 계산: 입고합 + 수동재고조정 − Σ(ShipmentDetail.OutQuantity by ProdKey,Week)
      const remainQ = await tQ(
        `SELECT
           ISNULL((SELECT SUM(wd.OutQuantity) FROM WarehouseDetail wd
                   JOIN WarehouseMaster wm ON wd.WarehouseKey=wm.WarehouseKey
                   WHERE wd.ProdKey=@pk AND wm.OrderWeek=@wk AND wm.isDeleted=0),0)
           + ISNULL((SELECT SUM(ISNULL(sh.AfterValue,0) - ISNULL(sh.BeforeValue,0))
                   FROM StockHistory sh
                   WHERE sh.ProdKey=@pk AND sh.OrderWeek=@wk
                     AND (sh.ChangeType IS NULL OR sh.ChangeType NOT IN (N'확정', N'확정취소', N'입고', N'출고'))),0) AS totalIn,
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

      if (type === 'CANCEL' && !orderDeleted && Math.abs(Number(outQAfter || 0)) < 0.0001 && odRow?.OrderDetailKey) {
        const cleanup = await maybeDeleteAutoPasteOrder(tQ, {
          orderMasterKey: mk,
          orderDetailKey: odRow.OrderDetailKey,
          orderQtyBefore,
          uid,
        });
        if (cleanup.deleted) {
          orderDeleted = true;
          orderDeleteReason = cleanup.reason;
          orderQtyAfter = 0;
        }
      }

      // 입고검증 — 견적서/확정 단계 오류 예방
      // (a) 입고+수동재고조정 0 인데 출고 ADD: 견적서에서 입고없는 출고로 보임 → 기본 차단, force=true 시만 허용
      // (b) 입고+수동재고조정 < 출고 (remainAfter < 0): 잔량 음수, 차수 확정 시 fix.js validate 에서 거부됨 → 차단
      if (type === 'ADD' && !req.body.force) {
        if (totalIn <= 0) {
          throw new Error(`입고/재고조정 반영 후 가용수량이 0 이하인 차수입니다. 입고 등록 또는 재고조정 후 분배하세요.\n선분배가 의도라면 force=true 로 강제 진행 (견적서 입고없는출고로 보일 수 있음)`);
        }
        if (totalIn > 0 && remainAfter < 0) {
          throw new Error(`입고+재고조정(${totalIn}) 초과 분배: 총 ${totalOut} 분배 → 잔량 ${remainAfter}\n강제 진행하려면 force=true (관리자만)`);
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

      return {
        qtyBefore,
        qtyAfter,
        orderQtyBefore,
        orderQtyAfter,
        orderDeleted,
        orderDeleteReason,
        outQtyBefore: outQBefore,
        outQtyAfter: outQAfter,
        remainBefore,
        remainAfter,
        totalIn,
        totalOut,
      };
    });

    return res.status(200).json({
      success: true,
      type,
      delta,
      ...result,
      message: `${type === 'ADD' ? '추가' : '취소'} 완료 — ${result.qtyBefore} → ${result.qtyAfter}${result.orderDeleted ? ' / 자동 주문삭제' : ''}`,
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
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

function isZeroishText(value) {
  const n = Number(String(value ?? '').replace(/,/g, ''));
  return Number.isFinite(n) && Math.abs(n) < 0.0001;
}

async function maybeDeleteAutoPasteOrder(tQ, { orderMasterKey, orderDetailKey, orderQtyBefore, uid }) {
  const marker = await tQ(
    `SELECT TOP 1 BeforeValue, AfterValue, Descr, ChangeDtm
       FROM OrderHistory
      WHERE OrderDetailKey=@dk
        AND ISNULL(ChangeType,'') = N'수정'
        AND (
             Descr LIKE N'%paste order + distribute%'
          OR Descr LIKE N'%붙여넣기 주문추가%'
          OR Descr LIKE N'%붙여넣기 주문등록%'
          OR Descr LIKE N'%붙여넣기 일괄추가%'
        )
      ORDER BY ChangeDtm ASC`,
    { dk: { type: sql.Int, value: orderDetailKey } }
  );
  const firstPaste = marker.recordset[0];
  if (!firstPaste || !isZeroishText(firstPaste.BeforeValue)) {
    return { deleted: false, reason: 'not_auto_paste_order' };
  }

  const laterManual = await tQ(
    `SELECT COUNT(*) AS Cnt
       FROM OrderHistory
      WHERE OrderDetailKey=@dk
        AND ChangeDtm > @dt
        AND (
             Descr IS NULL OR (
                 Descr NOT LIKE N'%paste order + distribute%'
             AND Descr NOT LIKE N'%붙여넣기 주문추가%'
             AND Descr NOT LIKE N'%붙여넣기 주문등록%'
             AND Descr NOT LIKE N'%붙여넣기 일괄추가%'
             AND Descr NOT LIKE N'%자동 주문삭제%'
             AND Descr NOT LIKE N'%자동주문삭제%'
             )
        )`,
    {
      dk: { type: sql.Int, value: orderDetailKey },
      dt: { type: sql.DateTime, value: firstPaste.ChangeDtm },
    }
  );
  if (Number(laterManual.recordset[0]?.Cnt || 0) > 0) {
    return { deleted: false, reason: 'manual_order_change_exists' };
  }

  await tQ(
    `UPDATE OrderDetail
        SET isDeleted=1, LastUpdateID=@uid, LastUpdateDtm=GETDATE()
      WHERE OrderDetailKey=@dk AND ISNULL(isDeleted,0)=0`,
    {
      dk: { type: sql.Int, value: orderDetailKey },
      uid: { type: sql.NVarChar, value: uid },
    }
  );
  await insertOrderHistory(
    tQ,
    orderDetailKey,
    String(orderQtyBefore),
    '0',
    '자동주문삭제 분배0',
    uid
  );
  await tQ(
    `UPDATE OrderMaster
        SET isDeleted=1, LastUpdateID=@uid, LastUpdateDtm=GETDATE()
      WHERE OrderMasterKey=@mk
        AND ISNULL(isDeleted,0)=0
        AND NOT EXISTS (
          SELECT 1 FROM OrderDetail
           WHERE OrderMasterKey=@mk AND ISNULL(isDeleted,0)=0
        )`,
    {
      mk: { type: sql.Int, value: orderMasterKey },
      uid: { type: sql.NVarChar, value: uid },
    }
  );
  return { deleted: true, reason: 'auto_paste_distribution_zero' };
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
