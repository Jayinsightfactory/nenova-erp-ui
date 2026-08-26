// pages/api/orders/index.js
// GET  → 실제 DB 조회 (OrderMaster + OrderDetail)
// POST → 정식 테이블에 저장 (OrderMaster + OrderDetail)

import { query, withTransaction, sql } from '../../../lib/db';
import { withAuth } from '../../../lib/auth';
import { normalizeOrderUnit, requireOrderYear } from '../../../lib/orderUtils';
import { resolveOrderListYearScope } from '../../../lib/orderListYearScope.js';
import { withActionLog } from '../../../lib/withActionLog';
import { useExeParityFlag } from '../../../lib/exeParity/common.js';
import { sqlOrderViewGetData } from '../../../lib/exeOrderViewSql.js';
import {
  sqlOrderAddGetDataCountry,
  sqlOrderAddGetDataFlower,
  sqlOrderAddGetDataProduct,
} from '../../../lib/exeOrderAddSql.js';
import {
  assertMyCustomerExpectedCurrentQty,
  isMyCustomerOrderSource,
  MY_CUSTOMER_ORDER_MODE,
  planMyCustomerOrderWrite,
  validateMyCustomerOrderWriteRequest,
} from '../../../lib/myCustomerOrderWritePolicy.js';
import { allowHotelMiuMissingCancel, resolveHotelMiuOverflowCancel } from '../../../lib/hotelMiuIntake.js';
import { assertErpEditGuard, advanceErpEditGuard } from '../../../lib/erpEditPresence.js';
import {
  evaluateOrderRegistrationPostWrite,
  orderRegistrationPostWriteMismatchError,
} from '../../../lib/shipmentAdjustmentPostWrite.js';

async function appLog(category, step, detail, isError = false) {
  try {
    await query(
      `INSERT INTO AppLog (Category, Step, Detail, IsError) VALUES (@cat, @step, @detail, @err)`,
      { cat: { type: sql.NVarChar, value: category }, step: { type: sql.NVarChar, value: step },
        detail: { type: sql.NVarChar, value: String(detail) }, err: { type: sql.Bit, value: isError ? 1 : 0 } }
    );
  } catch { /* AppLog 없으면 무시 */ }
}

// MAX(Key)+1 안전 INSERT — HOLDLOCK + PK 충돌 방지
// 전산이 같은 시점에 INSERT 하면 HOLDLOCK 범위 밖이라 여전히 충돌 가능 → tryInsertWithRetry 로 감쌈
async function safeNextKey(tQ, table, keyCol) {
  const r = await tQ(
    `SELECT ISNULL(MAX(${keyCol}),0)+1 AS nk FROM ${table} WITH (UPDLOCK, HOLDLOCK)`, {}
  );
  return r.recordset[0].nk;
}

// PK 충돌 시 MAX+1 재계산 후 재시도 (최대 5회).
// buildInsert(newKey) 는 해당 key 로 INSERT 를 수행하는 async 함수.
// 성공 시 실제 사용된 key 반환, 모두 실패 시 마지막 에러 throw.
async function tryInsertWithRetry(tQ, table, keyCol, buildInsert, maxRetry = 5) {
  let lastErr;
  for (let attempt = 0; attempt < maxRetry; attempt++) {
    const key = await safeNextKey(tQ, table, keyCol);
    try {
      await buildInsert(key);
      return key;
    } catch (e) {
      lastErr = e;
      // PK 충돌(2627) 또는 UNIQUE 위반(2601) 만 재시도
      if (e.number === 2627 || e.number === 2601 || /PRIMARY KEY|duplicate key|UNIQUE/i.test(e.message || '')) {
        await appLog('safeInsert', '재시도', `${table}.${keyCol}=${key} 충돌 → 재시도 ${attempt + 1}/${maxRetry}`, false);
        continue;
      }
      throw e;
    }
  }
  throw lastErr || new Error(`${table} INSERT 재시도 ${maxRetry}회 모두 실패`);
}

async function syncKeyNumbering(tQ, category, table, keyCol) {
  const allowed = {
    OrderMasterKey: ['OrderMaster', 'OrderMasterKey'],
    OrderDetailKey: ['OrderDetail', 'OrderDetailKey'],
    ShipmentMasterKey: ['ShipmentMaster', 'ShipmentKey'],
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

function toAllUnits(qty, unit, prod = {}) {
  const B1B = Number(prod.B1B || prod.BunchOf1Box || 0);
  const S1B = Number(prod.S1B || prod.SteamOf1Box || 0);
  const outUnit = normalizeOrderUnit(prod.OutUnit, unit || '박스');
  unit = normalizeOrderUnit(unit, outUnit);
  let box = 0;
  let bunch = 0;
  let steam = 0;
  if (unit === '단') {
    bunch = qty;
    box = B1B > 0 ? qty / B1B : 0;
    steam = (B1B > 0 && S1B > 0) ? box * S1B : 0;
  } else if (unit === '송이') {
    steam = qty;
    box = S1B > 0 ? qty / S1B : 0;
    bunch = (S1B > 0 && B1B > 0) ? box * B1B : 0;
  } else {
    box = qty;
    bunch = B1B > 0 ? qty * B1B : 0;
    steam = S1B > 0 ? qty * S1B : 0;
  }
  const outQ = outUnit === '단' ? bunch : outUnit === '송이' ? steam : box;
  return { box, bunch, steam, outQ };
}

// FormOrderAdd.UnitQuantity(false): OrderDetail의 이미 환산된 박스/단/송이 열에서
// Product.EstUnit에 해당하는 열을 그대로 고른다. 출고분배용 반올림/보정은 주문에 쓰지 않는다.
function myCustomerOrderEstQuantity(allQty, prod = {}, finalOutQty) {
  const outUnit = normalizeOrderUnit(prod.OutUnit, '박스');
  const estUnit = normalizeOrderUnit(prod.EstUnit, outUnit);
  const value = estUnit === '박스' ? Number(allQty.box)
    : estUnit === '단' ? Number(allQty.bunch)
      : Number(allQty.steam);
  if (!Number.isFinite(value) || (Number(finalOutQty) > 0 && value <= 0)) {
    const error = new Error(`품목 ${prod.ProdName || ''}의 EstUnit(${estUnit}) 환산값을 확인할 수 없습니다.`);
    error.statusCode = 400;
    error.code = 'EST_UNIT_CONVERSION_INVALID';
    throw error;
  }
  return value;
}

// FormOrderAdd.UnitQuantity가 읽는 세 실제 수량 열을 만든다. 기존 범용 toAllUnits는
// 다른 source의 과거 동작을 보존하기 위해 건드리지 않는다.
function myCustomerOrderAllUnits(qty, unit, prod = {}) {
  const outUnit = normalizeOrderUnit(prod.OutUnit, '박스');
  const inputUnit = normalizeOrderUnit(unit, outUnit);
  const bunchOfBox = Number(prod.B1B || prod.BunchOf1Box || 0);
  const steamOfBox = Number(prod.S1B || prod.SteamOf1Box || 0);
  const steamOfBunch = Number(prod.SteamOf1Bunch || 0);
  let box = 0;
  let bunch = 0;
  let steam = 0;
  if (inputUnit === '박스') {
    box = qty;
    if (bunchOfBox > 0) bunch = qty * bunchOfBox;
    if (steamOfBox > 0) steam = qty * steamOfBox;
    else if (bunchOfBox > 0 && steamOfBunch > 0) steam = qty * bunchOfBox * steamOfBunch;
  } else if (inputUnit === '단') {
    bunch = qty;
    if (bunchOfBox > 0) box = qty / bunchOfBox;
    if (steamOfBunch > 0) steam = qty * steamOfBunch;
    else if (steamOfBox > 0 && bunchOfBox > 0) steam = (qty / bunchOfBox) * steamOfBox;
  } else {
    steam = qty;
    if (steamOfBox > 0) box = qty / steamOfBox;
    else if (steamOfBunch > 0 && bunchOfBox > 0) box = qty / (steamOfBunch * bunchOfBox);
    if (steamOfBunch > 0) bunch = qty / steamOfBunch;
    else if (steamOfBox > 0 && bunchOfBox > 0) bunch = (qty / steamOfBox) * bunchOfBox;
  }
  return { box, bunch, steam, outQ: outUnit === '박스' ? box : outUnit === '단' ? bunch : steam };
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

export default withAuth(withActionLog(async function handler(req, res) {
  if (req.method === 'GET')  return await getOrders(req, res);
  if (req.method === 'POST') return await createOrder(req, res);
  if (req.method === 'PUT')  return await updateOrder(req, res);
  return res.status(405).end();
}, { actionType: 'ORDER_WRITE', affectedTable: 'OrderMaster/OrderDetail[/ShipmentMaster for Raum image registration]', riskLevel: 'MEDIUM' }));

// ── 조회: 실제 DB ──────────────────────────────
async function getOrders(req, res) {
  const { week, startDate, endDate, custName, countryFlower, exeParity, view, orderMasterKey } = req.query;
  const useExe = useExeParityFlag(exeParity) || view === 'exe';

  if (view === 'add' && orderMasterKey != null && String(orderMasterKey) !== '') {
    try {
      const mk = parseInt(orderMasterKey, 10);
      const p = { orderMasterKey: { type: sql.Int, value: mk } };
      const [products, flowers, countries] = await Promise.all([
        query(sqlOrderAddGetDataProduct(), p),
        query(sqlOrderAddGetDataFlower(), p),
        query(sqlOrderAddGetDataCountry(), p),
      ]);
      return res.status(200).json({
        success: true,
        source: 'real_db_exe_parity',
        orderMasterKey: mk,
        products: products.recordset,
        flowers: flowers.recordset,
        countries: countries.recordset,
      });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  if (useExe && startDate && endDate) {
    try {
      const params = {
        startDate: { type: sql.Date, value: new Date(startDate) },
        endDate: { type: sql.Date, value: new Date(endDate) },
      };
      if (countryFlower) params.countryFlower = { type: sql.NVarChar, value: countryFlower };
      const result = await query(
        sqlOrderViewGetData({ countryFlower: countryFlower || null }),
        params
      );
      return res.status(200).json({ success: true, source: 'real_db_exe_parity', rows: result.recordset });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  let where = 'WHERE 1=1';
  const params = {};

  if (week) {
    try {
      const scope = resolveOrderListYearScope({
        week,
        explicitYear: req.query.year,
        startDate,
        endDate,
      });
      where += ' AND vo.OrderWeek = @week';
      where += ' AND vo.OrderYear = @orderYear';
      params.week = { type: sql.NVarChar, value: scope.orderWeek };
      params.orderYear = { type: sql.NVarChar, value: scope.orderYear };
    } catch (error) {
      return res.status(Number(error.statusCode) || 400).json({
        success: false,
        code: error.code || 'ORDER_LIST_SCOPE_INVALID',
        error: error.message,
      });
    }
  }
  if (startDate) {
    where += ' AND CAST(vo.OrderDtm AS DATE) >= @startDate';
    params.startDate = { type: sql.NVarChar, value: startDate };
  }
  if (endDate) {
    where += ' AND CAST(vo.OrderDtm AS DATE) <= @endDate';
    params.endDate = { type: sql.NVarChar, value: endDate };
  }
  if (custName) {
    where += ' AND vo.CustName LIKE @custName';
    params.custName = { type: sql.NVarChar, value: `%${custName}%` };
  }

  try {
    const result = await query(
      `SELECT
        vo.OrderMasterKey,
        CONVERT(NVARCHAR(10), vo.OrderDtm, 120) AS OrderDtm,
        vo.OrderYear, vo.OrderWeek, vo.Manager, vo.OrderCode,
        vo.CustKey, vo.CustName, vo.CustArea,
        vo.OrderDetailKey, vo.ProdKey,
        vo.ProdName, px.DisplayName, vo.FlowerName, vo.CounName, px.OutUnit,
        vo.BoxQuantity, vo.BunchQuantity, vo.SteamQuantity,
        ISNULL(vo.OutQuantity, 0) AS OutQuantity,
        vo.NoneOutQuantity
       FROM ViewOrder vo
       LEFT JOIN Product px ON vo.ProdKey = px.ProdKey
       ${where}
       ORDER BY vo.OrderDtm DESC, vo.OrderMasterKey, vo.OrderDetailKey`,
      params
    );

    // OrderMasterKey 기준으로 그룹핑
    const ordersMap = {};
    for (const row of result.recordset) {
      if (!ordersMap[row.OrderMasterKey]) {
        ordersMap[row.OrderMasterKey] = {
          id: row.OrderMasterKey,
          date: row.OrderDtm,
          week: row.OrderYear ? `${row.OrderYear}-${row.OrderWeek}` : row.OrderWeek,
          year: row.OrderYear,
          manager: row.Manager,
          orderCode: row.OrderCode,
          custKey: row.CustKey,
          custName: row.CustName,
          custArea: row.CustArea,
          items: [],
        };
      }
      if (row.OrderDetailKey) {
        const displayQty = row.OutQuantity || row.BoxQuantity || row.BunchQuantity || row.SteamQuantity || 0;
        ordersMap[row.OrderMasterKey].items.push({
          detailKey: row.OrderDetailKey,
          prodKey: row.ProdKey,
          prodName: row.ProdName,
          flowerName: row.FlowerName,
          counName: row.CounName,
          boxQty: row.BoxQuantity,
          bunchQty: row.BunchQuantity,
          steamQty: row.SteamQuantity,
          outQty: row.OutQuantity,
          noneOutQty: row.NoneOutQuantity,
          unit: normalizeOrderUnit(row.OutUnit, row.BoxQuantity > 0 ? '박스' : row.BunchQuantity > 0 ? '단' : '송이'),
          qty: displayQty,
        });
      }
    }

    return res.status(200).json({
      success: true,
      source: 'real_db',  // 실제 DB임을 표시
      count: Object.keys(ordersMap).length,
      orders: Object.values(ordersMap),
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}

async function verifyCreatedOrdersInTransaction(tQuery, { orderYear, orderWeek, custKey, results }) {
  const verifiedItems = [];
  for (const item of results || []) {
    if (!Number.isInteger(Number(item?.prodKey)) || !Number.isFinite(Number(item?.finalQty))) continue;
    const check = await tQuery(
      `SELECT rawOrder.RecordCount AS RawOrderCount, rawOrder.Qty AS RawOrderQty,
              viewOrder.RecordCount AS ViewOrderCount, viewOrder.Qty AS ViewOrderQty
         FROM (VALUES (1)) seed(n)
         OUTER APPLY (
           SELECT COUNT(*) AS RecordCount, ISNULL(SUM(ISNULL(od.OutQuantity,0)),0) AS Qty
             FROM OrderMaster om
             JOIN OrderDetail od ON od.OrderMasterKey=om.OrderMasterKey AND ISNULL(od.isDeleted,0)=0
            WHERE om.OrderYear=@yr AND om.OrderWeek=@wk AND om.CustKey=@ck
              AND ISNULL(om.isDeleted,0)=0 AND od.ProdKey=@pk
         ) rawOrder
         OUTER APPLY (
           SELECT COUNT(*) AS RecordCount, ISNULL(SUM(ISNULL(vo.OutQuantity,0)),0) AS Qty
             FROM ViewOrder vo
            WHERE vo.OrderYear=@yr AND vo.OrderWeek=@wk AND vo.CustKey=@ck AND vo.ProdKey=@pk
         ) viewOrder`,
      {
        yr: { type: sql.NVarChar, value: orderYear },
        wk: { type: sql.NVarChar, value: orderWeek },
        ck: { type: sql.Int, value: Number(custKey) },
        pk: { type: sql.Int, value: Number(item.prodKey) },
      },
    );
    const row = check.recordset?.[0] || {};
    const verification = evaluateOrderRegistrationPostWrite({
      expectedOrderOut: item.finalQty,
      facts: {
        rawOrderCount: row.RawOrderCount,
        rawOrderQty: row.RawOrderQty,
        viewOrderCount: row.ViewOrderCount,
        viewOrderQty: row.ViewOrderQty,
      },
    });
    if (!verification.verified) throw orderRegistrationPostWriteMismatchError(verification);
    verifiedItems.push({ prodKey: Number(item.prodKey), finalQty: Number(item.finalQty), verified: true });
  }
  return verifiedItems;
}

// ── 등록: 정식 테이블 (OrderMaster + OrderDetail) ──────────────────────────
// 웹 주문등록은 기존 OrderDetail 수량에 입력값을 가산한다. (기존 2 + 신규 3 → 5)
async function createOrder(req, res) {
  const { custName, custKey, week, year, manager, orderCode, items, source } = req.body;
  let myCustomerPolicy;
  try {
    myCustomerPolicy = validateMyCustomerOrderWriteRequest({ source, orderMode: req.body?.orderMode, items });
  } catch (error) {
    return res.status(error.statusCode || 400).json({ success: false, code: error.code, error: error.message });
  }
  const isMyCustomerSource = myCustomerPolicy.isMyCustomerSource;
  const orderMode = myCustomerPolicy.orderMode;
  const writeItems = isMyCustomerSource ? myCustomerPolicy.items : items;
  // 웹 내 업체 등록의 의도된 범위는 OrderMaster/Detail/History만이다. 출고 원장은 보존한다.
  const ensureShipmentMaster = !isMyCustomerSource
    && (String(source || '').toLowerCase() === 'raum-pnl' || req.body?.ensureShipmentMaster === true);
  const isDelta = true; // 웹/붙여넣기 주문등록은 기존 수량을 덮어쓰지 않고 항상 가산한다.
  const historyDescr = String(source || '').toLowerCase() === 'paste' ? '붙여넣기 주문등록' : '주문등록';

  if (!writeItems || writeItems.length === 0) {
    return res.status(400).json({ success: false, error: '품목을 입력하세요.' });
  }

  try {
    await appLog('createOrder', '시작', `custKey=${custKey} custName=${custName} week=${week} items=${writeItems?.length} mode=${orderMode}`);

    // 거래처 조회 (OrderCode 포함)
    let resolvedCustKey = custKey;
    let resolvedOrderCode = orderCode || '';
    if (resolvedCustKey) {
      const rc = await query(
        `SELECT TOP 1 CustKey, ISNULL(OrderCode,'') AS OrderCode FROM Customer WHERE CustKey=@ck AND isDeleted=0`,
        { ck: { type: sql.Int, value: parseInt(resolvedCustKey) } }
      );
      if (rc.recordset[0]) resolvedOrderCode = rc.recordset[0].OrderCode || resolvedOrderCode;
    } else if (custName) {
      const r = await query(
        `SELECT TOP 1 CustKey, ISNULL(OrderCode,'') AS OrderCode FROM Customer WHERE CustName LIKE @name AND isDeleted = 0`,
        { name: { type: sql.NVarChar, value: `%${custName}%` } }
      );
      if (!r.recordset[0]) {
        await appLog('createOrder', '오류', `거래처 없음: ${custName}`, true);
        return res.status(404).json({ success: false, error: `거래처 없음: ${custName}` });
      }
      resolvedCustKey = r.recordset[0].CustKey;
      resolvedOrderCode = r.recordset[0].OrderCode || '';
    }

    if (isMyCustomerSource) {
      const activeCustomer = await query(`SELECT TOP 1 CustKey FROM Customer WHERE CustKey=@ck AND ISNULL(isDeleted,0)=0`, {
        ck: { type: sql.Int, value: Number(resolvedCustKey) },
      });
      if (!activeCustomer.recordset[0]) return res.status(404).json({ success: false, error: '사용 가능한 업체가 아닙니다.' });
      if (writeItems.some(item => item.expectedCurrentQty === undefined)) return res.status(400).json({ success: false, error: '중복 등록 방지를 위한 현재 수량이 필요합니다.' });
    }

    // OrderWeek 형식 검증 + 정규화 (NN-NN 또는 YYYY-NN-NN 만 허용)
    // → '17-01B', '470-01' 같은 노이즈 행 신규 생성 차단
    let orderYear, orderWeek;
    try {
      ({ orderYear, orderWeek } = requireOrderYear(week || '', year || ''));
    } catch (e) {
      await appLog('createOrder', '검증실패', e.message, true);
      return res.status(400).json({ success: false, error: e.message });
    }
    const uid = req.user?.userId || 'nenovaSS3';
    // Manager 에는 UserInfo.UserID 가 들어가야 ViewOrder 의 INNER JOIN UserInfo(om.Manager=ui.UserID)
    // 를 통과한다. 문자열 '관리자'(=UserName) 를 넣으면 그 주문이 ViewOrder 에서 탈락 → 전산 분배
    // grid 에 거래처가 안 뜸. '관리자' 계정의 실제 UserID(보통 'admin') 로 해석해 넣는다.
    const mgrRow = isMyCustomerSource
      ? await query(`SELECT TOP 1 ui.UserID FROM Customer c LEFT JOIN UserInfo ui ON ui.UserID=c.Manager OR ui.UserName=c.Manager
          WHERE c.CustKey=@ck AND ISNULL(c.isDeleted,0)=0 ORDER BY CASE WHEN ui.UserID=c.Manager THEN 0 ELSE 1 END`, { ck: { type: sql.Int, value: Number(resolvedCustKey) } })
      : await query(`SELECT TOP 1 UserID FROM UserInfo WHERE UserName=N'관리자' ORDER BY UserID`, {});
    const mgr = mgrRow.recordset[0]?.UserID || 'admin';

    await appLog('createOrder', 'OM_조회', `ck=${resolvedCustKey} yr=${orderYear} wk=${orderWeek}`);
    const hasOrderYearWeekColumn = await columnExists('OrderMaster', 'OrderYearWeek');
    const hasOrderDetailDescrColumn = await columnExists('OrderDetail', 'Descr');
    const hasShipmentYearWeekColumn = ensureShipmentMaster ? await columnExists('ShipmentMaster', 'OrderYearWeek') : false;
    const hasShipmentEstimateNameColumn = ensureShipmentMaster ? await columnExists('ShipmentMaster', 'EstimateName') : false;
    const hasShipmentWebCreatedColumn = ensureShipmentMaster ? await columnExists('ShipmentMaster', 'WebCreated') : false;
    const hasShipmentCreateIdColumn = ensureShipmentMaster ? await columnExists('ShipmentMaster', 'CreateID') : false;
    const hasShipmentCreateDtmColumn = ensureShipmentMaster ? await columnExists('ShipmentMaster', 'CreateDtm') : false;

    // Master + Detail 전체를 하나의 트랜잭션으로 (중간 실패 시 전체 롤백)
    const { orderMasterKey, results, prodKeys, shipmentMasterKey, postWriteVerification } = await withTransaction(async (tQuery) => {
      await assertErpEditGuard(tQuery, { orderYear, orderWeek, custKey: Number(resolvedCustKey) }, req.user, req.body);
      // 기존 OrderMaster 확인 (같은 업체+연도+차수 — 연도 무시 시 25년 주문에 26년 등록이 붙는 버그 방지)
      // 수량 0으로 숨긴 Master도 재사용한다. 새로 INSERT하면 EXE에 같은 차수 주문이 두 장이 된다.
      const existing = await tQuery(
          `SELECT TOP 1 OrderMasterKey, ISNULL(isDeleted,0) AS isDeleted
           FROM OrderMaster WITH (UPDLOCK, HOLDLOCK)
          WHERE CustKey=@ck AND OrderWeek=@wk
            AND (
              OrderYear = @year
              OR (@allowLegacyYear=1 AND @year IN (N'2025', N'2024') AND (OrderYear IS NULL OR OrderYear = N''))
            )
          ORDER BY CASE WHEN ISNULL(isDeleted,0)=0 THEN 0 ELSE 1 END, OrderMasterKey ASC`,
        {
          ck: { type: sql.Int, value: resolvedCustKey },
          wk: { type: sql.NVarChar, value: orderWeek },
          year: { type: sql.NVarChar, value: orderYear },
          allowLegacyYear: { type: sql.Bit, value: isMyCustomerSource ? 0 : 1 },
        }
      );

      let mk;
      if (existing.recordset.length > 0) {
        mk = existing.recordset[0].OrderMasterKey;
        if (Number(existing.recordset[0].isDeleted)) {
          await tQuery(
            `UPDATE OrderMaster
                SET isDeleted=0, LastUpdateID=@uid, LastUpdateDtm=GETDATE()
              WHERE OrderMasterKey=@mk`,
            { mk: { type: sql.Int, value: mk }, uid: { type: sql.NVarChar, value: uid } }
          );
        }
        await appLog('createOrder', 'OM_FOUND', `mk=${mk}`);
        // Manager/OrderCode 없는 경우(웹 이전 생성분)만 보완
        const ywk = orderYear + (orderWeek || '').split('-')[0]; // 전산 raw OrderYearWeek = 연도+대차수
        const yearWeekPatch = hasOrderYearWeekColumn
          ? `OrderYearWeek = CASE WHEN OrderYearWeek IS NULL OR OrderYearWeek = '' THEN @ywk ELSE OrderYearWeek END,`
          : '';
        await tQuery(
          `UPDATE OrderMaster SET
             ${yearWeekPatch}
             Manager   = CASE WHEN Manager   IS NULL OR Manager   = '' THEN @mgr ELSE Manager END,
             OrderCode = CASE WHEN OrderCode IS NULL OR OrderCode = '' THEN @oc  ELSE OrderCode END
           WHERE OrderMasterKey = @mk`,
          {
            ywk: { type: sql.NVarChar, value: ywk },
            mgr: { type: sql.NVarChar, value: mgr },
            oc: { type: sql.NVarChar, value: resolvedOrderCode },
            mk: { type: sql.Int, value: mk },
          }
        );
      } else {
        mk = await tryInsertWithRetry(tQuery, 'OrderMaster', 'OrderMasterKey', async (newMk) => {
          await appLog('createOrder', 'OM_INSERT', `new mk=${newMk} ck=${resolvedCustKey} wk=${orderWeek}`);
          const ywk = orderYear + (orderWeek || '').split('-')[0]; // 전산 raw OrderYearWeek = 연도+대차수
          const params = {
            mk:       { type: sql.Int,      value: newMk },
            year:     { type: sql.NVarChar, value: orderYear },
            week:     { type: sql.NVarChar, value: orderWeek },
            ywk:      { type: sql.NVarChar, value: ywk },
            mgr:      { type: sql.NVarChar, value: mgr },
            custKey:  { type: sql.Int,      value: resolvedCustKey },
            oc:       { type: sql.NVarChar, value: resolvedOrderCode },
            createId: { type: sql.NVarChar, value: 'admin' }, // 전산 호환 (CreateID='admin' 기준 필터)
          };
          if (hasOrderYearWeekColumn) {
            await tQuery(
              `INSERT INTO OrderMaster
                 (OrderMasterKey, OrderDtm, OrderYear, OrderWeek, OrderYearWeek, Manager, CustKey, OrderCode, Descr, isDeleted, CreateID, CreateDtm, LastUpdateID, LastUpdateDtm)
               VALUES (@mk, GETDATE(), @year, @week, @ywk, @mgr, @custKey, @oc, '', 0, @createId, GETDATE(), @createId, GETDATE())`,
              params
            );
          } else {
            await tQuery(
              `INSERT INTO OrderMaster
                 (OrderMasterKey, OrderDtm, OrderYear, OrderWeek, Manager, CustKey, OrderCode, Descr, isDeleted, CreateID, CreateDtm, LastUpdateID, LastUpdateDtm)
               VALUES (@mk, GETDATE(), @year, @week, @mgr, @custKey, @oc, '', 0, @createId, GETDATE(), @createId, GETDATE())`,
              params
            );
          }
        });
        await syncKeyNumbering(tQuery, 'OrderMasterKey', 'OrderMaster', 'OrderMasterKey');
      }

      // nenova.exe FormOrderAdd 저장과 동일하게, 주문이 처음 만들어지는 경우에만
      // 빈 ShipmentMaster를 준비한다. ShipmentDetail/ShipmentDate/ShipmentFarm은 만들지 않는다.
      let ensuredShipmentMasterKey = null;
      if (ensureShipmentMaster) {
        const existingShipment = await tQuery(
          `SELECT TOP 1 ShipmentKey FROM ShipmentMaster WITH (UPDLOCK, HOLDLOCK)
            WHERE CustKey=@ck AND OrderYear=@year AND OrderWeek=@wk AND ISNULL(isDeleted,0)=0
            ORDER BY ISNULL(isFix,0) DESC, ShipmentKey ASC`,
          {
            ck: { type: sql.Int, value: resolvedCustKey },
            year: { type: sql.NVarChar, value: orderYear },
            wk: { type: sql.NVarChar, value: orderWeek },
          }
        );
        if (existingShipment.recordset[0]) {
          ensuredShipmentMasterKey = existingShipment.recordset[0].ShipmentKey;
        } else {
          ensuredShipmentMasterKey = await tryInsertWithRetry(tQuery, 'ShipmentMaster', 'ShipmentKey', async (newShipmentKey) => {
            const cols = ['ShipmentKey', 'CustKey', 'OrderYear', 'OrderWeek'];
            const vals = ['@sk', '@ck', '@year', '@wk'];
            const params = {
              sk: { type: sql.Int, value: newShipmentKey },
              ck: { type: sql.Int, value: resolvedCustKey },
              year: { type: sql.NVarChar, value: orderYear },
              wk: { type: sql.NVarChar, value: orderWeek },
            };
            if (hasShipmentYearWeekColumn) { cols.push('OrderYearWeek'); vals.push('@ywk'); params.ywk = { type: sql.NVarChar, value: orderYear + orderWeek.substring(0, 2) }; }
            cols.push('isFix', 'isDeleted'); vals.push('0', '0');
            if (hasShipmentEstimateNameColumn) { cols.push('EstimateName'); vals.push('@estimate'); params.estimate = { type: sql.NVarChar, value: `${orderWeek.substring(0, 2)}차 종합견적서` }; }
            if (hasShipmentWebCreatedColumn) { cols.push('WebCreated'); vals.push('1'); }
            if (hasShipmentCreateIdColumn) { cols.push('CreateID'); vals.push('@createId'); params.createId = { type: sql.NVarChar, value: uid }; }
            if (hasShipmentCreateDtmColumn) { cols.push('CreateDtm'); vals.push('GETDATE()'); }
            await tQuery(`INSERT INTO ShipmentMaster (${cols.join(', ')}) VALUES (${vals.join(', ')})`, params);
          });
          await syncKeyNumbering(tQuery, 'ShipmentMasterKey', 'ShipmentMaster', 'ShipmentKey');
        }
      }

      const detailResults = [];
      const changedProdKeys = new Set();
      const touchedOrderMasterKeys = new Set([Number(mk)]);
      for (const item of writeItems) {
        let prodKey = item.prodKey;
        if (!prodKey && item.prodName) {
          const pr = await tQuery(
            `SELECT TOP 1 ProdKey FROM Product WHERE ProdName LIKE @name AND isDeleted = 0`,
            { name: { type: sql.NVarChar, value: `%${item.prodName}%` } }
          );
          if (!pr.recordset[0]) {
            if (isMyCustomerSource) throw Object.assign(new Error(`${item.prodName}: 품목을 찾을 수 없습니다.`), { statusCode: 404, code: 'PRODUCT_NOT_FOUND' });
            detailResults.push({ prodName: item.prodName, status: 'NOT_FOUND' }); continue;
          }
          prodKey = pr.recordset[0].ProdKey;
        }
        const prodInfo = await tQuery(
          `SELECT ProdName, FlowerName, OutUnit, EstUnit, CounName, ISNULL(Descr,'') AS ProdDescr,
                  ISNULL(BunchOf1Box,0) AS B1B, ISNULL(SteamOf1Box,0) AS S1B,
                  ISNULL(SteamOf1Bunch,0) AS SteamOf1Bunch
             FROM Product WHERE ProdKey=@pk AND isDeleted=0`,
          { pk: { type: sql.Int, value: prodKey } }
        );
        if (!prodInfo.recordset[0]) {
          if (isMyCustomerSource) throw Object.assign(new Error(`${item.prodName || prodKey}: 품목을 찾을 수 없습니다.`), { statusCode: 404, code: 'PRODUCT_NOT_FOUND' });
          detailResults.push({ prodName: item.prodName, status: 'NOT_FOUND' }); continue;
        }
        const prod = prodInfo.recordset[0];
        const qty = isMyCustomerSource ? Number(item.qty) : (parseFloat(item.qty) || 0);
        const unit = normalizeOrderUnit(item.unit, normalizeOrderUnit(prod.OutUnit, '박스'));
        const allQty = isMyCustomerSource ? myCustomerOrderAllUnits(qty, unit, prod) : toAllUnits(qty, unit, prod);
        const boxQty = allQty.box;
        const bunchQty = allQty.bunch;
        const steamQty = allQty.steam;
        const outQty = allQty.outQ;
        const detailDescr = String(item.descr || item.memo || extractMoqText(prod) || '').trim();

        // 내 업체 화면은 현재수량을 모든 활성 Master의 합으로 표시한다. 따라서 한 품목의
        // 활성 상세가 둘 이상이면 어느 행도 임의로 고르지 않고 전체 트랜잭션을 거부한다.
        let detailMasterKey = mk;
        let existOd;
        if (isMyCustomerSource) {
          const activeDetails = await tQuery(
            `SELECT od.OrderDetailKey, od.OrderMasterKey, od.OutQuantity, CAST(0 AS INT) AS isDeleted
               FROM OrderMaster om WITH (UPDLOCK, HOLDLOCK)
               JOIN OrderDetail od WITH (UPDLOCK, HOLDLOCK) ON od.OrderMasterKey=om.OrderMasterKey
              WHERE om.CustKey=@ck AND om.OrderYear=@year AND om.OrderWeek=@wk
                AND ISNULL(om.isDeleted,0)=0 AND od.ProdKey=@pk AND ISNULL(od.isDeleted,0)=0
              ORDER BY od.OrderDetailKey ASC`,
            { ck: { type: sql.Int, value: Number(resolvedCustKey) }, year: { type: sql.NVarChar, value: orderYear }, wk: { type: sql.NVarChar, value: orderWeek }, pk: { type: sql.Int, value: prodKey } }
          );
          if (activeDetails.recordset.length > 1) {
            const duplicate = new Error(`${item.prodName || prodKey}: 같은 연도·차수의 활성 주문 상세가 ${activeDetails.recordset.length}건이라 안전하게 변경할 수 없습니다.`);
            duplicate.statusCode = 409;
            duplicate.code = 'DUPLICATE_ACTIVE_ORDER_DETAIL';
            throw duplicate;
          }
          if (activeDetails.recordset[0]) {
            detailMasterKey = Number(activeDetails.recordset[0].OrderMasterKey);
            touchedOrderMasterKeys.add(detailMasterKey);
            existOd = activeDetails;
          } else {
            // 숨긴 과거 행은 새 활성행을 만들지 않도록 기본 Master에서만 재사용한다.
            existOd = await tQuery(
              `SELECT TOP 1 OrderDetailKey, OrderMasterKey, OutQuantity, ISNULL(isDeleted,0) AS isDeleted
                 FROM OrderDetail WITH (UPDLOCK, HOLDLOCK)
                WHERE OrderMasterKey=@mk AND ProdKey=@pk
                ORDER BY CASE WHEN ISNULL(isDeleted,0)=0 THEN 0 ELSE 1 END, OrderDetailKey ASC`,
              { mk: { type: sql.Int, value: detailMasterKey }, pk: { type: sql.Int, value: prodKey } }
            );
          }
        } else {
          existOd = await tQuery(
            `SELECT TOP 1 OrderDetailKey, OrderMasterKey, OutQuantity, ISNULL(isDeleted,0) AS isDeleted
               FROM OrderDetail WITH (UPDLOCK, HOLDLOCK)
              WHERE OrderMasterKey=@mk AND ProdKey=@pk
              ORDER BY CASE WHEN ISNULL(isDeleted,0)=0 THEN 0 ELSE 1 END, OrderDetailKey ASC`,
            { mk: { type: sql.Int, value: detailMasterKey }, pk: { type: sql.Int, value: prodKey } }
          );
        }
        const existRow = existOd.recordset[0];
        const reviveDeleted = !!(existRow && Number(existRow.isDeleted));
        const oldOutQty = existRow && !reviveDeleted ? Number(existRow.OutQuantity || 0) : 0;
        const applyDeltaAdd = (isMyCustomerSource ? orderMode === MY_CUSTOMER_ORDER_MODE.ADD : isDelta) && !reviveDeleted;

        if (isMyCustomerSource) assertMyCustomerExpectedCurrentQty(item.expectedCurrentQty, oldOutQty);

        if (isMyCustomerSource && qty > 0 && outQty <= 0) {
          throw Object.assign(new Error(`${item.prodName || prodKey}: OutUnit 환산수량이 0입니다. 품목 단위 설정을 확인하세요.`), { statusCode: 400, code: 'OUT_UNIT_CONVERSION_INVALID' });
        }
        let myWritePlan = null;
        if (isMyCustomerSource) {
          let hasShipmentDetail = false;
          if (orderMode === MY_CUSTOMER_ORDER_MODE.REPLACE && outQty === 0) {
            const shipment = await tQuery(
              `SELECT COUNT(*) AS ShipmentDetailCount
                 FROM ShipmentMaster sm WITH (UPDLOCK, HOLDLOCK)
                 JOIN ShipmentDetail sd WITH (UPDLOCK, HOLDLOCK) ON sd.ShipmentKey=sm.ShipmentKey
                WHERE sm.OrderYear=@year AND sm.OrderWeek=@wk AND sm.CustKey=@ck
                  AND ISNULL(sm.isDeleted,0)=0 AND sd.ProdKey=@pk`,
              { year: { type: sql.NVarChar, value: orderYear }, wk: { type: sql.NVarChar, value: orderWeek }, ck: { type: sql.Int, value: Number(resolvedCustKey) }, pk: { type: sql.Int, value: prodKey } }
            );
            hasShipmentDetail = Number(shipment.recordset[0]?.ShipmentDetailCount || 0) > 0;
          }
          myWritePlan = planMyCustomerOrderWrite({
            orderMode,
            inputOutQty: outQty,
            previousQty: oldOutQty,
            hasActiveOrderDetail: Boolean(existRow && !reviveDeleted),
            hasShipmentDetail,
          });
          if (myWritePlan.action === 'SKIP_ZERO') {
            detailResults.push({ prodKey, prodName: item.prodName || prod.ProdName || '', qty: outQty, inputQty: outQty, unit: normalizeOrderUnit(prod.OutUnit, '박스'), status: 'SKIPPED', ...myWritePlan });
            continue;
          }
        }

        if (existOd.recordset.length > 0) {
          const computedNext = myWritePlan ? myWritePlan.finalQty : (applyDeltaAdd ? oldOutQty + outQty : outQty);
          const overflow = myWritePlan
            ? { kind: myWritePlan.action === 'DELETE_ZERO' ? 'zero' : 'normal', nextOutQty: myWritePlan.finalQty }
            : resolveHotelMiuOverflowCancel(source, applyDeltaAdd, oldOutQty, computedNext);
          if (overflow.kind === 'reject') {
            throw new Error(`${item.prodName || prodKey}: 취소 수량이 현재 주문수량(${oldOutQty})보다 큽니다.`);
          }
          if (overflow.kind === 'skip') {
            detailResults.push({
              prodKey,
              prodName: item.prodName || prod.ProdName || '',
              qty,
              unit,
              status: 'SKIPPED',
              previousQty: oldOutQty,
              deltaQty: outQty,
              finalQty: oldOutQty,
              orderDetailKey: existOd.recordset[0].OrderDetailKey,
            });
            continue;
          }
          const nextOutQty = overflow.nextOutQty;
          if (overflow.kind === 'zero' || (!isMyCustomerSource && applyDeltaAdd && nextOutQty <= 0)) {
            await appLog('createOrder', 'OD_DELETE_ZERO', `pk=${prodKey} old=${oldOutQty} delta=${outQty}`);
            await tQuery(
              `UPDATE OrderDetail SET
                 BoxQuantity=0, BunchQuantity=0, SteamQuantity=0,
                 OutQuantity=0, EstQuantity=0, NoneOutQuantity=0,
                 isDeleted=1,
                 LastUpdateID=@uid, LastUpdateDtm=GETDATE()
               WHERE OrderDetailKey=@dk`,
              {
                dk: { type: sql.Int, value: existOd.recordset[0].OrderDetailKey },
                uid: { type: sql.NVarChar, value: uid },
              }
            );
            await insertOrderHistory(
              tQuery,
              existOd.recordset[0].OrderDetailKey,
              String(oldOutQty),
              '0',
              historyDescr,
              uid
            );
            // 내 업체의 여러 명시 행은 한 트랜잭션 끝까지 모두 처리한 뒤에만 Master를 정리한다.
            // 중간 0행 처리 뒤 다음 품목을 같은 Master에 넣는 ghost 삭제를 막는다.
            if (!isMyCustomerSource) {
              await tQuery(
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
            changedProdKeys.add(Number(prodKey));
            detailResults.push({
              prodKey,
              prodName: item.prodName || prod.ProdName || '',
              qty: isMyCustomerSource ? outQty : qty,
              inputQty: isMyCustomerSource ? outQty : undefined,
              unit: isMyCustomerSource ? normalizeOrderUnit(prod.OutUnit, '박스') : unit,
              status: 'DELETED',
              previousQty: oldOutQty,
              deltaQty: isMyCustomerSource ? myWritePlan.deltaQty : outQty,
              finalQty: 0,
              orderDetailKey: existOd.recordset[0].OrderDetailKey,
            });
            continue;
          }
          // delta=true 면 기존값에 더하기. 숨긴 행은 잔여 환산값을 더하지 않고 이번 수량으로 덮어 살린다.
          const updateEstQty = isMyCustomerSource
            ? myCustomerOrderEstQuantity(myCustomerOrderAllUnits(nextOutQty, normalizeOrderUnit(prod.OutUnit, '박스'), prod), prod, nextOutQty)
            : outQty;
          const updateSql = applyDeltaAdd
            ? `UPDATE OrderDetail SET
                 BoxQuantity   = ISNULL(BoxQuantity,0)   + @box,
                 BunchQuantity = ISNULL(BunchQuantity,0) + @bunch,
                 SteamQuantity = ISNULL(SteamQuantity,0) + @steam,
                 OutQuantity   = ISNULL(OutQuantity,0)   + @oq,
                 EstQuantity   = ${isMyCustomerSource ? '@est' : 'ISNULL(EstQuantity,0)   + @oq'},
                 NoneOutQuantity = 0,
                 isDeleted = 0,
                 ${hasOrderDetailDescrColumn ? `Descr = CASE WHEN @descr<>'' THEN @descr ELSE Descr END,` : ''}
                 LastUpdateID=@uid, LastUpdateDtm=GETDATE()
               WHERE OrderDetailKey=@dk`
            : `UPDATE OrderDetail SET BoxQuantity=@box, BunchQuantity=@bunch, SteamQuantity=@steam,
                 OutQuantity=@oq, EstQuantity=${isMyCustomerSource ? '@est' : '@oq'}, NoneOutQuantity=0, isDeleted=0,
                 ${hasOrderDetailDescrColumn ? `Descr = CASE WHEN @descr<>'' THEN @descr ELSE Descr END,` : ''}
                 LastUpdateID=@uid, LastUpdateDtm=GETDATE()
               WHERE OrderDetailKey=@dk`;
          await appLog('createOrder', 'OD_UPDATE', `pk=${prodKey} box=${boxQty} bunch=${bunchQty} steam=${steamQty} delta=${isDelta} revive=${reviveDeleted ? 1 : 0}`);
          await tQuery(updateSql,
            { box: { type: sql.Float, value: boxQty }, bunch: { type: sql.Float, value: bunchQty },
              steam: { type: sql.Float, value: steamQty },
              oq:  { type: sql.Float,    value: isMyCustomerSource && !applyDeltaAdd ? nextOutQty : outQty },
              est: { type: sql.Float,    value: updateEstQty },
              descr: { type: sql.NVarChar, value: detailDescr },
              uid: { type: sql.NVarChar, value: uid },
              dk: { type: sql.Int, value: existOd.recordset[0].OrderDetailKey } }
          );
          await insertOrderHistory(
            tQuery,
            existOd.recordset[0].OrderDetailKey,
            String(oldOutQty),
            String(nextOutQty),
            historyDescr,
            uid
          );
          changedProdKeys.add(Number(prodKey));
          detailResults.push({
            prodKey,
            prodName: item.prodName || prod.ProdName || '',
            qty: isMyCustomerSource ? outQty : qty,
            inputQty: isMyCustomerSource ? outQty : undefined,
            unit: isMyCustomerSource ? normalizeOrderUnit(prod.OutUnit, '박스') : unit,
            status: applyDeltaAdd ? (outQty < 0 ? 'CANCELLED' : 'ADDED') : (reviveDeleted ? 'ADDED' : 'UPDATED'),
            previousQty: oldOutQty,
            deltaQty: isMyCustomerSource ? myWritePlan.deltaQty : outQty,
            finalQty: nextOutQty,
            orderDetailKey: existOd.recordset[0].OrderDetailKey,
          });
        } else if (qty > 0) {
          const insertEstQty = isMyCustomerSource
            ? myCustomerOrderEstQuantity(myCustomerOrderAllUnits(outQty, normalizeOrderUnit(prod.OutUnit, '박스'), prod), prod, outQty)
            : outQty;
          const newDetailKey = await tryInsertWithRetry(tQuery, 'OrderDetail', 'OrderDetailKey', async (newNk) => {
            await appLog('createOrder', 'OD_INSERT', `nk=${newNk} pk=${prodKey} box=${boxQty} bunch=${bunchQty} steam=${steamQty}`);
            const insertCols = hasOrderDetailDescrColumn
              ? `(OrderDetailKey, OrderMasterKey, ProdKey, BoxQuantity, BunchQuantity, SteamQuantity,
                  OutQuantity, EstQuantity, NoneOutQuantity, Descr, isDeleted, CreateID, CreateDtm)`
              : `(OrderDetailKey, OrderMasterKey, ProdKey, BoxQuantity, BunchQuantity, SteamQuantity,
                  OutQuantity, EstQuantity, NoneOutQuantity, isDeleted, CreateID, CreateDtm)`;
            const insertValues = hasOrderDetailDescrColumn
              ? `(@nk, @mk, @pk, @box, @bunch, @steam, @oq, @est, 0, @descr, 0, @uid, GETDATE())`
              : `(@nk, @mk, @pk, @box, @bunch, @steam, @oq, @est, 0, 0, @uid, GETDATE())`;
            await tQuery(
              `INSERT INTO OrderDetail ${insertCols} VALUES ${insertValues}`,
              {
                nk:    { type: sql.Int,      value: newNk },
                mk:    { type: sql.Int,      value: detailMasterKey },
                pk:    { type: sql.Int,      value: prodKey },
                box:   { type: sql.Float,    value: boxQty },
                bunch: { type: sql.Float,    value: bunchQty },
                steam: { type: sql.Float,    value: steamQty },
                oq:    { type: sql.Float,    value: outQty },
                est:   { type: sql.Float,    value: insertEstQty },
                descr: { type: sql.NVarChar, value: detailDescr },
                uid:   { type: sql.NVarChar, value: 'admin' }, // 전산 호환
              }
            );
          });
          await syncKeyNumbering(tQuery, 'OrderDetailKey', 'OrderDetail', 'OrderDetailKey');
          await insertOrderHistory(tQuery, newDetailKey, '0', String(outQty), historyDescr, uid);
          changedProdKeys.add(Number(prodKey));
          detailResults.push({
            prodKey,
            prodName: item.prodName || prod.ProdName || '',
            qty: isMyCustomerSource ? outQty : qty,
            inputQty: isMyCustomerSource ? outQty : undefined,
            unit: isMyCustomerSource ? normalizeOrderUnit(prod.OutUnit, '박스') : unit,
            status: 'OK',
            previousQty: 0,
            deltaQty: isMyCustomerSource ? myWritePlan.deltaQty : outQty,
            finalQty: outQty,
            orderDetailKey: newDetailKey,
          });
        } else if (qty < 0) {
          if (allowHotelMiuMissingCancel(source)) {
            detailResults.push({
              prodKey,
              prodName: item.prodName || prod.ProdName || '',
              qty,
              unit,
              status: 'SKIPPED',
              previousQty: 0,
              deltaQty: outQty,
              finalQty: 0,
            });
            continue;
          }
          throw new Error(`${item.prodName || prodKey}: 취소 대상 주문이 없습니다.`);
        }
      }
      if (isMyCustomerSource) {
        for (const touchedMasterKey of touchedOrderMasterKeys) {
          await tQuery(
            `UPDATE OrderMaster
                SET isDeleted=1, LastUpdateID=@uid, LastUpdateDtm=GETDATE()
              WHERE OrderMasterKey=@mk
                AND ISNULL(isDeleted,0)=0
                AND NOT EXISTS (
                  SELECT 1 FROM OrderDetail
                   WHERE OrderMasterKey=@mk AND ISNULL(isDeleted,0)=0
                )`,
            { mk: { type: sql.Int, value: touchedMasterKey }, uid: { type: sql.NVarChar, value: uid } }
          );
        }
      }
      const postWriteVerification = await verifyCreatedOrdersInTransaction(tQuery, {
        orderYear,
        orderWeek,
        custKey: Number(resolvedCustKey),
        results: detailResults,
      });
      const editGuardAfter = await advanceErpEditGuard(tQuery, { orderYear, orderWeek, custKey: Number(resolvedCustKey) }, req.user, req.body);
      return { orderMasterKey: mk, results: detailResults, prodKeys: [...changedProdKeys], shipmentMasterKey: ensuredShipmentMasterKey, postWriteVerification, editDigestAfter: editGuardAfter.editDigestAfter, revision: editGuardAfter.revision };
    });

    // FormOrderAdd EditMode=2(변경등록)는 재고 재계산을 하지 않는다. 기존 ADD 경로는 유지한다.
    const stockWarning = isMyCustomerSource && orderMode === MY_CUSTOMER_ORDER_MODE.REPLACE
      ? null
      : await runStockCalculation(orderYear, orderWeek, uid, prodKeys);
    const modeWarning = isMyCustomerSource && orderMode === MY_CUSTOMER_ORDER_MODE.ADD
      ? '추가등록은 기존 재고 재계산 절차를 유지했습니다.'
      : null;
    await appLog('createOrder', '완료', `mk=${orderMasterKey} items=${results.length}`);
    return res.status(201).json({
      success: true,
      verified: true,
      verifiedCount: postWriteVerification.length,
      source: 'real_db',
      orderMasterKey,
      shipmentMasterKey: shipmentMasterKey || null,
      message: `주문 등록 완료 — ${results.filter(r => r.status === 'OK' || r.status === 'UPDATED' || r.status === 'ADDED' || r.status === 'CANCELLED' || r.status === 'DELETED').length}개 품목`,
      warning: stockWarning?.message || modeWarning,
      orderMode: isMyCustomerSource ? orderMode : undefined,
      results,
    });
  } catch (err) {
    await appLog('createOrder', '오류', err.message, true);
    return res.status(err.statusCode || 500).json({
      success: false,
      code: err.code,
      error: err.message,
      lease: err.lease || null,
      expectedDigest: err.expectedDigest,
      actualDigest: err.actualDigest,
      verification: err.verification || null,
    });
  }
}

// ── 수정: 기존 주문 수량 변경 ──────────────────────────
async function updateOrder(req, res) {
  const { orderMasterKey, items, manager, orderCode } = req.body;
  if (!orderMasterKey) {
    return res.status(400).json({ success: false, error: 'orderMasterKey 필요' });
  }

  try {
    const uid = req.user?.userId || 'system';
    let recalcTarget = null;
    const recalcProdKeys = new Set();

    await withTransaction(async (tQuery) => {
      const omInfo = await tQuery(
        `SELECT OrderYear, OrderWeek FROM OrderMaster WHERE OrderMasterKey=@mk`,
        { mk: { type: sql.Int, value: orderMasterKey } }
      );
      if (omInfo.recordset[0]) recalcTarget = omInfo.recordset[0];

      // Master 필드 업데이트 (manager, orderCode)
      if (manager !== undefined || orderCode !== undefined) {
        const sets = [];
        const params = { mk: { type: sql.Int, value: orderMasterKey } };
        if (manager !== undefined) {
          // Manager 는 UserInfo.UserID 여야 ViewOrder INNER JOIN 통과. 입력이 UserID/UserName 어느쪽이든
          // 유효 UserID 로 해석, 실패 시 '관리자' 계정(fallback 'admin').
          sets.push("Manager = COALESCE((SELECT TOP 1 UserID FROM UserInfo WHERE UserID=@mgr OR UserName=@mgr), (SELECT TOP 1 UserID FROM UserInfo WHERE UserName=N'관리자'), 'admin')");
          params.mgr = { type: sql.NVarChar, value: manager };
        }
        if (orderCode !== undefined) {
          sets.push('OrderCode = @oc');
          params.oc = { type: sql.NVarChar, value: orderCode };
        }
        if (sets.length > 0) {
          await tQuery(
            `UPDATE OrderMaster SET ${sets.join(', ')} WHERE OrderMasterKey = @mk`,
            params
          );
        }
      }

      // Detail 수량 업데이트
      if (Array.isArray(items)) {
        for (const item of items) {
          if (!item.detailKey) continue;
          const qty = parseFloat(item.qty) || 0;
          const unit = normalizeOrderUnit(item.unit, '박스');
          // 기존 수량 조회 (이력용)
          const old = await tQuery(
            `SELECT od.ProdKey, od.BoxQuantity, od.BunchQuantity, od.SteamQuantity, od.OutQuantity,
                    p.OutUnit, ISNULL(p.BunchOf1Box,0) AS B1B, ISNULL(p.SteamOf1Box,0) AS S1B
               FROM OrderDetail od
               JOIN Product p ON od.ProdKey=p.ProdKey
              WHERE od.OrderDetailKey = @dk`,
            { dk: { type: sql.Int, value: item.detailKey } }
          );
          const oldRow = old.recordset[0];
          if (oldRow?.ProdKey) recalcProdKeys.add(Number(oldRow.ProdKey));
          const oldQty = oldRow ? (oldRow.OutQuantity || oldRow.BoxQuantity || oldRow.BunchQuantity || oldRow.SteamQuantity || 0) : 0;
          const prod = oldRow || {};
          const allQty = toAllUnits(qty, unit, prod);

          await tQuery(
            `UPDATE OrderDetail SET
              BoxQuantity = @box, BunchQuantity = @bunch, SteamQuantity = @steam,
              OutQuantity = @oq, EstQuantity = @oq, NoneOutQuantity = 0
             WHERE OrderDetailKey = @dk`,
            {
              dk:    { type: sql.Int,   value: item.detailKey },
              box:   { type: sql.Float, value: allQty.box },
              bunch: { type: sql.Float, value: allQty.bunch },
              steam: { type: sql.Float, value: allQty.steam },
              oq:    { type: sql.Float, value: allQty.outQ },
            }
          );

          // 변경 이력 기록
          await tQuery(
            `INSERT INTO OrderHistory
              (OrderDetailKey, ChangeType, ColumName, BeforeValue, AfterValue, Descr, ChangeID, ChangeDtm)
             VALUES (@dk, '수정', '수량', @before, @after, @descr, @uid, GETDATE())`,
            {
              dk:     { type: sql.Int,      value: item.detailKey },
              before: { type: sql.NVarChar, value: String(oldQty) },
              after:  { type: sql.NVarChar, value: String(allQty.outQ) },
              descr:  { type: sql.NVarChar, value: '주문수정' },
              uid:    { type: sql.NVarChar, value: uid },
            }
          );
        }
      }
    });

    if (recalcTarget?.OrderYear && recalcTarget?.OrderWeek) {
      const stockWarning = await runStockCalculation(String(recalcTarget.OrderYear), recalcTarget.OrderWeek, uid, [...recalcProdKeys]);
      return res.status(200).json({ success: true, message: '주문 수정 완료', warning: stockWarning?.message || null });
    }
    return res.status(200).json({ success: true, message: '주문 수정 완료' });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}

async function runStockCalculation(orderYear, orderWeek, uid, prodKeys = []) {
  const keys = [...new Set((prodKeys || []).map(Number).filter(Boolean))];
  if (keys.length === 0) return null;

  try {
    for (const prodKey of keys) {
      await query(
        stockCalculationSql(),
        {
          year: { type: sql.NVarChar, value: String(orderYear) },
          week: { type: sql.NVarChar, value: orderWeek },
          uid:  { type: sql.NVarChar, value: uid || 'admin' },
          pk:   { type: sql.Int, value: prodKey },
        }
      );
    }
    return null;
  } catch (e) {
    await appLog('usp_StockCalculation', '오류', `${orderYear}/${orderWeek}: ${e.message}`, true);
    return { message: `재고 재계산 경고: ${e.message}` };
  }
}

function stockCalculationSql() {
  return `DECLARE @hasProdKey BIT = CASE WHEN EXISTS (
            SELECT 1 FROM sys.parameters
             WHERE object_id = OBJECT_ID(N'dbo.usp_StockCalculation')
               AND name = N'@ProdKey'
          ) THEN 1 ELSE 0 END;

          DECLARE @hasResult BIT = CASE WHEN EXISTS (
            SELECT 1 FROM sys.parameters
             WHERE object_id = OBJECT_ID(N'dbo.usp_StockCalculation')
               AND name = N'@oResult'
          ) THEN 1 ELSE 0 END;

          IF @hasProdKey = 1 AND @hasResult = 1
          BEGIN
            DECLARE @r INT, @m NVARCHAR(MAX);
            EXEC dbo.usp_StockCalculation
                 @OrderYear = @year,
                 @OrderWeek = @week,
                 @ProdKey   = @pk,
                 @iUserID   = @uid,
                 @oResult   = @r OUTPUT,
                 @oMessage  = @m OUTPUT;
            SELECT @r AS result, @m AS message;
          END
          ELSE IF @hasProdKey = 1
          BEGIN
            EXEC dbo.usp_StockCalculation
                 @OrderYear = @year,
                 @OrderWeek = @week,
                 @ProdKey   = @pk,
                 @iUserID   = @uid;
          END
          ELSE IF @hasResult = 1
          BEGIN
            DECLARE @r2 INT, @m2 NVARCHAR(MAX);
            EXEC dbo.usp_StockCalculation
                 @OrderYear = @year,
                 @OrderWeek = @week,
                 @iUserID   = @uid,
                 @oResult   = @r2 OUTPUT,
                 @oMessage  = @m2 OUTPUT;
            SELECT @r2 AS result, @m2 AS message;
          END
          ELSE
          BEGIN
            EXEC dbo.usp_StockCalculation
                 @OrderYear = @year,
                 @OrderWeek = @week,
                 @iUserID   = @uid;
          END`;
}

async function insertOrderHistory(tQuery, detailKey, before, after, descr, uid) {
  try {
    await tQuery(
      `INSERT INTO OrderHistory
         (OrderDetailKey, ChangeType, ColumName, BeforeValue, AfterValue, Descr, ChangeID, ChangeDtm)
       VALUES (@dk, N'수정', N'수량', @before, @after, @descr, @uid, GETDATE())`,
      {
        dk:     { type: sql.Int,      value: detailKey },
        before: { type: sql.NVarChar, value: before },
        after:  { type: sql.NVarChar, value: after },
        descr:  { type: sql.NVarChar, value: descr || '' },
        uid:    { type: sql.NVarChar, value: uid || 'admin' },
      }
    );
  } catch (e) {
    await appLog('OrderHistory', '오류', e.message, true);
  }
}
