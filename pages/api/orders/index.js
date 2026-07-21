// pages/api/orders/index.js
// GET  → 실제 DB 조회 (OrderMaster + OrderDetail)
// POST → 정식 테이블에 저장 (OrderMaster + OrderDetail)

import { query, withTransaction, sql } from '../../../lib/db';
import { withAuth } from '../../../lib/auth';
import { normalizeOrderUnit, validateOrderWeek, resolveOrderWeekQuery } from '../../../lib/orderUtils';
import { withActionLog } from '../../../lib/withActionLog';
import { useExeParityFlag } from '../../../lib/exeParity/common.js';
import { sqlOrderViewGetData } from '../../../lib/exeOrderViewSql.js';
import {
  sqlOrderAddGetDataCountry,
  sqlOrderAddGetDataFlower,
  sqlOrderAddGetDataProduct,
} from '../../../lib/exeOrderAddSql.js';

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
      const yearParam = req.query.year;
      const v = validateOrderWeek(String(week));
      const resolved = resolveOrderWeekQuery(week);
      const orderYear = yearParam || resolved.year;
      where += ' AND vo.OrderWeek = @week';
      params.week = { type: sql.NVarChar, value: v.week };
      if (orderYear) {
        if (orderYear === '2025' || orderYear === '2024') {
          where += ` AND (vo.OrderYear = @orderYear OR vo.OrderYear IS NULL OR vo.OrderYear = N'')`;
        } else {
          where += ' AND vo.OrderYear = @orderYear';
        }
        params.orderYear = { type: sql.NVarChar, value: String(orderYear) };
      }
    } catch {
      const normWeek = week.match(/^\d{4}-(\d{2}-\d{2})$/) ? week.match(/^\d{4}-(\d{2}-\d{2})$/)[1] : week;
      where += ' AND vo.OrderWeek = @week';
      params.week = { type: sql.NVarChar, value: normWeek };
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

// ── 등록: 정식 테이블 (OrderMaster + OrderDetail) ──────────────────────────
// 웹 주문등록은 기존 OrderDetail 수량에 입력값을 가산한다. (기존 2 + 신규 3 → 5)
async function createOrder(req, res) {
  const { custName, custKey, week, year, manager, orderCode, items, source } = req.body;
  const ensureShipmentMaster = String(source || '').toLowerCase() === 'raum-pnl' || req.body?.ensureShipmentMaster === true;
  const isDelta = true; // 웹/붙여넣기 주문등록은 기존 수량을 덮어쓰지 않고 항상 가산한다.
  const historyDescr = String(source || '').toLowerCase() === 'paste' ? '붙여넣기 주문등록' : '주문등록';

  if (!items || items.length === 0) {
    return res.status(400).json({ success: false, error: '품목을 입력하세요.' });
  }

  try {
    await appLog('createOrder', '시작', `custKey=${custKey} custName=${custName} week=${week} items=${items?.length}`);

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

    // OrderWeek 형식 검증 + 정규화 (NN-NN 또는 YYYY-NN-NN 만 허용)
    // → '17-01B', '470-01' 같은 노이즈 행 신규 생성 차단
    let orderYear, orderWeek;
    try {
      const v = validateOrderWeek(week || '');
      // 신규 주문 생성은 현재 연도 기준 — resolveOrderWeekQuery 의 NN-NN→2025 레거시 규칙 금지
      // (레거시 규칙은 조회 전용. 생성에 타면 2025 주문이 생김 — 2026-07-08 연도분열 사고와 동류)
      orderYear = v.year || year || new Date().getFullYear().toString();
      orderWeek = v.week;
    } catch (e) {
      await appLog('createOrder', '검증실패', e.message, true);
      return res.status(400).json({ success: false, error: e.message });
    }
    const uid = req.user?.userId || 'nenovaSS3';
    // Manager 에는 UserInfo.UserID 가 들어가야 ViewOrder 의 INNER JOIN UserInfo(om.Manager=ui.UserID)
    // 를 통과한다. 문자열 '관리자'(=UserName) 를 넣으면 그 주문이 ViewOrder 에서 탈락 → 전산 분배
    // grid 에 거래처가 안 뜸. '관리자' 계정의 실제 UserID(보통 'admin') 로 해석해 넣는다.
    const mgrRow = await query(`SELECT TOP 1 UserID FROM UserInfo WHERE UserName=N'관리자' ORDER BY UserID`, {});
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
    const { orderMasterKey, results, prodKeys, shipmentMasterKey } = await withTransaction(async (tQuery) => {
      // 기존 OrderMaster 확인 (같은 업체+연도+차수 — 연도 무시 시 25년 주문에 26년 등록이 붙는 버그 방지)
      const existing = await tQuery(
        `SELECT TOP 1 OrderMasterKey FROM OrderMaster WITH (UPDLOCK, HOLDLOCK)
         WHERE CustKey=@ck AND OrderWeek=@wk AND isDeleted=0
           AND (
             OrderYear = @year
             OR (@year IN (N'2025', N'2024') AND (OrderYear IS NULL OR OrderYear = N''))
           )
         ORDER BY OrderMasterKey ASC`,
        {
          ck: { type: sql.Int, value: resolvedCustKey },
          wk: { type: sql.NVarChar, value: orderWeek },
          year: { type: sql.NVarChar, value: orderYear },
        }
      );

      let mk;
      if (existing.recordset.length > 0) {
        mk = existing.recordset[0].OrderMasterKey;
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
      for (const item of items) {
        let prodKey = item.prodKey;
        if (!prodKey && item.prodName) {
          const pr = await tQuery(
            `SELECT TOP 1 ProdKey FROM Product WHERE ProdName LIKE @name AND isDeleted = 0`,
            { name: { type: sql.NVarChar, value: `%${item.prodName}%` } }
          );
          if (!pr.recordset[0]) { detailResults.push({ prodName: item.prodName, status: 'NOT_FOUND' }); continue; }
          prodKey = pr.recordset[0].ProdKey;
        }
        const prodInfo = await tQuery(
          `SELECT ProdName, FlowerName, OutUnit, CounName, ISNULL(Descr,'') AS ProdDescr,
                  ISNULL(BunchOf1Box,0) AS B1B, ISNULL(SteamOf1Box,0) AS S1B
             FROM Product WHERE ProdKey=@pk AND isDeleted=0`,
          { pk: { type: sql.Int, value: prodKey } }
        );
        if (!prodInfo.recordset[0]) { detailResults.push({ prodName: item.prodName, status: 'NOT_FOUND' }); continue; }
        const prod = prodInfo.recordset[0];
        const qty = parseFloat(item.qty) || 0;
        const unit = normalizeOrderUnit(item.unit, normalizeOrderUnit(prod.OutUnit, '박스'));
        const allQty = toAllUnits(qty, unit, prod);
        const boxQty = allQty.box;
        const bunchQty = allQty.bunch;
        const steamQty = allQty.steam;
        const outQty = allQty.outQ;
        const detailDescr = String(item.descr || item.memo || extractMoqText(prod) || '').trim();

        // 기존 OrderDetail 확인 (같은 Master+품목)
        const existOd = await tQuery(
          `SELECT OrderDetailKey, OutQuantity FROM OrderDetail
           WHERE OrderMasterKey=@mk AND ProdKey=@pk AND isDeleted=0`,
          { mk: { type: sql.Int, value: mk }, pk: { type: sql.Int, value: prodKey } }
        );
        const oldOutQty = Number(existOd.recordset[0]?.OutQuantity || 0);

        if (existOd.recordset.length > 0) {
          const nextOutQty = isDelta ? oldOutQty + outQty : outQty;
          if (nextOutQty < -0.0001) {
            throw new Error(`${item.prodName || prodKey}: 취소 수량이 현재 주문수량(${oldOutQty})보다 큽니다.`);
          }
          if (isDelta && nextOutQty <= 0) {
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
            changedProdKeys.add(Number(prodKey));
            detailResults.push({
              prodKey,
              prodName: item.prodName || prod.ProdName || '',
              qty,
              unit,
              status: 'DELETED',
              previousQty: oldOutQty,
              deltaQty: outQty,
              finalQty: 0,
              orderDetailKey: existOd.recordset[0].OrderDetailKey,
            });
            continue;
          }
          // delta=true 면 기존값에 더하기, 기본은 덮어쓰기
          const updateSql = isDelta
            ? `UPDATE OrderDetail SET
                 BoxQuantity   = ISNULL(BoxQuantity,0)   + @box,
                 BunchQuantity = ISNULL(BunchQuantity,0) + @bunch,
                 SteamQuantity = ISNULL(SteamQuantity,0) + @steam,
                 OutQuantity   = ISNULL(OutQuantity,0)   + @oq,
                 EstQuantity   = ISNULL(EstQuantity,0)   + @oq,
                 NoneOutQuantity = 0,
                 ${hasOrderDetailDescrColumn ? `Descr = CASE WHEN @descr<>'' THEN @descr ELSE Descr END,` : ''}
                 LastUpdateID=@uid, LastUpdateDtm=GETDATE()
               WHERE OrderMasterKey=@mk AND ProdKey=@pk AND isDeleted=0`
            : `UPDATE OrderDetail SET BoxQuantity=@box, BunchQuantity=@bunch, SteamQuantity=@steam,
                 OutQuantity=@oq, EstQuantity=@oq, NoneOutQuantity=0,
                 ${hasOrderDetailDescrColumn ? `Descr = CASE WHEN @descr<>'' THEN @descr ELSE Descr END,` : ''}
                 LastUpdateID=@uid, LastUpdateDtm=GETDATE()
               WHERE OrderMasterKey=@mk AND ProdKey=@pk AND isDeleted=0`;
          await appLog('createOrder', 'OD_UPDATE', `pk=${prodKey} box=${boxQty} bunch=${bunchQty} steam=${steamQty} delta=${isDelta}`);
          await tQuery(updateSql,
            { box: { type: sql.Float, value: boxQty }, bunch: { type: sql.Float, value: bunchQty },
              steam: { type: sql.Float, value: steamQty },
              oq:  { type: sql.Float,    value: outQty },
              descr: { type: sql.NVarChar, value: detailDescr },
              uid: { type: sql.NVarChar, value: uid },
              mk: { type: sql.Int, value: mk }, pk: { type: sql.Int, value: prodKey } }
          );
          await insertOrderHistory(
            tQuery,
            existOd.recordset[0].OrderDetailKey,
            String(oldOutQty),
            String(isDelta ? oldOutQty + outQty : outQty),
            historyDescr,
            uid
          );
          changedProdKeys.add(Number(prodKey));
          detailResults.push({
            prodKey,
            prodName: item.prodName || prod.ProdName || '',
            qty,
            unit,
            status: isDelta ? (outQty < 0 ? 'CANCELLED' : 'ADDED') : 'UPDATED',
            previousQty: oldOutQty,
            deltaQty: outQty,
            finalQty: isDelta ? oldOutQty + outQty : outQty,
            orderDetailKey: existOd.recordset[0].OrderDetailKey,
          });
        } else if (qty > 0) {
          const newDetailKey = await tryInsertWithRetry(tQuery, 'OrderDetail', 'OrderDetailKey', async (newNk) => {
            await appLog('createOrder', 'OD_INSERT', `nk=${newNk} pk=${prodKey} box=${boxQty} bunch=${bunchQty} steam=${steamQty}`);
            const insertCols = hasOrderDetailDescrColumn
              ? `(OrderDetailKey, OrderMasterKey, ProdKey, BoxQuantity, BunchQuantity, SteamQuantity,
                  OutQuantity, EstQuantity, NoneOutQuantity, Descr, isDeleted, CreateID, CreateDtm)`
              : `(OrderDetailKey, OrderMasterKey, ProdKey, BoxQuantity, BunchQuantity, SteamQuantity,
                  OutQuantity, EstQuantity, NoneOutQuantity, isDeleted, CreateID, CreateDtm)`;
            const insertValues = hasOrderDetailDescrColumn
              ? `(@nk, @mk, @pk, @box, @bunch, @steam, @oq, @oq, 0, @descr, 0, @uid, GETDATE())`
              : `(@nk, @mk, @pk, @box, @bunch, @steam, @oq, @oq, 0, 0, @uid, GETDATE())`;
            await tQuery(
              `INSERT INTO OrderDetail ${insertCols} VALUES ${insertValues}`,
              {
                nk:    { type: sql.Int,      value: newNk },
                mk:    { type: sql.Int,      value: mk },
                pk:    { type: sql.Int,      value: prodKey },
                box:   { type: sql.Float,    value: boxQty },
                bunch: { type: sql.Float,    value: bunchQty },
                steam: { type: sql.Float,    value: steamQty },
                oq:    { type: sql.Float,    value: outQty },
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
            qty,
            unit,
            status: 'OK',
            previousQty: 0,
            deltaQty: outQty,
            finalQty: outQty,
            orderDetailKey: newDetailKey,
          });
        } else if (qty < 0) {
          throw new Error(`${item.prodName || prodKey}: 취소 대상 주문이 없습니다.`);
        }
      }
      return { orderMasterKey: mk, results: detailResults, prodKeys: [...changedProdKeys], shipmentMasterKey: ensuredShipmentMasterKey };
    });

    const stockWarning = await runStockCalculation(orderYear, orderWeek, uid, prodKeys);
    await appLog('createOrder', '완료', `mk=${orderMasterKey} items=${results.length}`);
    return res.status(201).json({
      success: true,
      source: 'real_db',
      orderMasterKey,
      shipmentMasterKey: shipmentMasterKey || null,
      message: `주문 등록 완료 — ${results.filter(r => r.status === 'OK' || r.status === 'UPDATED' || r.status === 'ADDED' || r.status === 'CANCELLED' || r.status === 'DELETED').length}개 품목`,
      warning: stockWarning?.message || null,
      results,
    });
  } catch (err) {
    await appLog('createOrder', '오류', err.message, true);
    return res.status(500).json({ success: false, error: err.message });
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
