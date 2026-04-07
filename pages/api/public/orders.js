// pages/api/public/orders.js
// 외부 프로그램용 주문 API (API 키 인증)
//
// 인증: 헤더 X-Api-Key: <key> 또는 쿼리 ?apiKey=<key>
// API 키: 환경변수 PUBLIC_API_KEY (미설정 시 "nenova-api-2026")
//
// GET  /api/public/orders         → 주문 조회
// POST /api/public/orders         → 주문 등록 (실제 DB 저장)
//
// POST 예시 (JSON):
// {
//   "custName": "ABC화원",          // 거래처명 (또는 custKey)
//   "custKey": 123,                 // 거래처 키 (custName 대신 가능)
//   "week": "14-01",               // 차수
//   "year": "2026",                // 년도 (생략 시 현재 년도)
//   "manager": "홍길동",            // 담당자
//   "items": [
//     { "prodName": "장미 레드", "qty": 10, "unit": "박스" },
//     { "prodKey": 456,          "qty": 5,  "unit": "단"   }
//   ]
// }

import { query, sql } from '../../../lib/db';

const API_KEY = process.env.PUBLIC_API_KEY || 'nenova-api-2026';

function checkApiKey(req, res) {
  const key = req.headers['x-api-key'] || req.query.apiKey;
  if (key !== API_KEY) {
    res.status(401).json({ success: false, error: 'API 키가 올바르지 않습니다. X-Api-Key 헤더를 확인하세요.' });
    return false;
  }
  return true;
}

export default async function handler(req, res) {
  // CORS 허용 (외부 프로그램 접근)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Api-Key');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (!checkApiKey(req, res)) return;

  if (req.method === 'GET')  return await getOrders(req, res);
  if (req.method === 'POST') return await createOrder(req, res);
  return res.status(405).json({ success: false, error: '지원하지 않는 메서드입니다.' });
}

// ── GET: 주문 조회 ─────────────────────────────────────────────────────
// 쿼리 파라미터: week, startDate, endDate, custName, limit(기본100)
async function getOrders(req, res) {
  const { week, startDate, endDate, custName, limit = 100 } = req.query;

  let where = 'WHERE om.isDeleted = 0';
  const params = {};

  if (week)      { where += ' AND om.OrderWeek = @week';                          params.week      = { type: sql.NVarChar, value: week }; }
  if (startDate) { where += ' AND CAST(om.OrderDtm AS DATE) >= @startDate';       params.startDate = { type: sql.NVarChar, value: startDate }; }
  if (endDate)   { where += ' AND CAST(om.OrderDtm AS DATE) <= @endDate';         params.endDate   = { type: sql.NVarChar, value: endDate }; }
  if (custName)  { where += ' AND c.CustName LIKE @custName';                     params.custName  = { type: sql.NVarChar, value: `%${custName}%` }; }

  try {
    const result = await query(
      `SELECT TOP ${Math.min(parseInt(limit) || 100, 1000)}
        om.OrderMasterKey,
        CONVERT(NVARCHAR(10), om.OrderDtm, 120) AS OrderDtm,
        om.OrderYear, om.OrderWeek, om.Manager, om.OrderCode,
        c.CustKey, c.CustName, c.CustArea,
        od.OrderDetailKey, od.ProdKey,
        p.ProdName, p.FlowerName, p.CounName,
        od.BoxQuantity, od.BunchQuantity, od.SteamQuantity,
        od.OutQuantity, od.NoneOutQuantity
       FROM OrderMaster om
       LEFT JOIN Customer   c  ON om.CustKey = c.CustKey AND c.isDeleted = 0
       LEFT JOIN OrderDetail od ON om.OrderMasterKey = od.OrderMasterKey AND od.isDeleted = 0
       LEFT JOIN Product     p  ON od.ProdKey = p.ProdKey
       ${where}
       ORDER BY om.OrderDtm DESC, om.OrderMasterKey, od.OrderDetailKey`,
      params
    );

    const ordersMap = {};
    for (const row of result.recordset) {
      if (!ordersMap[row.OrderMasterKey]) {
        ordersMap[row.OrderMasterKey] = {
          orderMasterKey: row.OrderMasterKey,
          date: row.OrderDtm,
          week: row.OrderWeek,
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
        ordersMap[row.OrderMasterKey].items.push({
          orderDetailKey: row.OrderDetailKey,
          prodKey: row.ProdKey,
          prodName: row.ProdName,
          flowerName: row.FlowerName,
          counName: row.CounName,
          boxQty: row.BoxQuantity,
          bunchQty: row.BunchQuantity,
          steamQty: row.SteamQuantity,
          outQty: row.OutQuantity,
          noneOutQty: row.NoneOutQuantity,
        });
      }
    }

    return res.status(200).json({
      success: true,
      count: Object.keys(ordersMap).length,
      orders: Object.values(ordersMap),
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}

// ── POST: 주문 등록 (실제 DB) ──────────────────────────────────────────
async function createOrder(req, res) {
  const { custName, custKey, week, year, manager, orderCode, items } = req.body;

  if (!items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ success: false, error: 'items 배열이 필요합니다.' });
  }

  try {
    // 거래처 조회
    let resolvedCustKey = custKey;
    if (!resolvedCustKey && custName) {
      const r = await query(
        `SELECT TOP 1 CustKey FROM Customer WHERE CustName LIKE @name AND isDeleted = 0`,
        { name: { type: sql.NVarChar, value: `%${custName}%` } }
      );
      if (!r.recordset[0]) return res.status(404).json({ success: false, error: `거래처 없음: ${custName}` });
      resolvedCustKey = r.recordset[0].CustKey;
    }
    if (!resolvedCustKey) return res.status(400).json({ success: false, error: 'custKey 또는 custName이 필요합니다.' });

    // OrderMaster 저장 (실제 테이블)
    const masterResult = await query(
      `INSERT INTO OrderMaster
         (OrderDtm, OrderYear, OrderWeek, Manager, CustKey, OrderCode, isDeleted, CreateID, CreateDtm)
       OUTPUT INSERTED.OrderMasterKey
       VALUES (GETDATE(), @year, @week, @manager, @custKey, @orderCode, 0, 'API', GETDATE())`,
      {
        year:      { type: sql.NVarChar, value: year || String(new Date().getFullYear()) },
        week:      { type: sql.NVarChar, value: week || '' },
        manager:   { type: sql.NVarChar, value: manager || '' },
        custKey:   { type: sql.Int,      value: resolvedCustKey },
        orderCode: { type: sql.NVarChar, value: orderCode || '' },
      }
    );
    const orderMasterKey = masterResult.recordset[0].OrderMasterKey;

    // OrderDetail 저장
    const results = [];
    for (const item of items) {
      let prodKey = item.prodKey;
      if (!prodKey && item.prodName) {
        const pr = await query(
          `SELECT TOP 1 ProdKey FROM Product WHERE ProdName LIKE @name AND isDeleted = 0`,
          { name: { type: sql.NVarChar, value: `%${item.prodName}%` } }
        );
        if (!pr.recordset[0]) { results.push({ prodName: item.prodName, status: 'NOT_FOUND' }); continue; }
        prodKey = pr.recordset[0].ProdKey;
      }

      const qty  = parseFloat(item.qty) || 0;
      const unit = item.unit || '박스';
      await query(
        `INSERT INTO OrderDetail
           (OrderMasterKey, ProdKey, BoxQuantity, BunchQuantity, SteamQuantity,
            OutQuantity, NoneOutQuantity, isDeleted, CreateID, CreateDtm)
         VALUES (@mk, @pk, @box, @bunch, @steam, 0, 0, 0, 'API', GETDATE())`,
        {
          mk:    { type: sql.Int,   value: orderMasterKey },
          pk:    { type: sql.Int,   value: prodKey },
          box:   { type: sql.Float, value: unit === '박스' ? qty : 0 },
          bunch: { type: sql.Float, value: unit === '단'   ? qty : 0 },
          steam: { type: sql.Float, value: unit === '송이' ? qty : 0 },
        }
      );
      results.push({ prodKey, prodName: item.prodName, qty, unit, status: 'OK' });
    }

    return res.status(201).json({
      success: true,
      orderMasterKey,
      savedItems: results.filter(r => r.status === 'OK').length,
      failedItems: results.filter(r => r.status !== 'OK'),
      results,
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}
