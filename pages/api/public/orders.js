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

import { query, withTransaction, sql } from '../../../lib/db';

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
// 같은 업체+차수 OrderMaster가 이미 있으면 재사용 (중복 생성 방지)
async function createOrder(req, res) {
  const { custName, custKey, week, year, manager, orderCode, items } = req.body;

  if (!items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ success: false, error: 'items 배열이 필요합니다.' });
  }
  if (!week) {
    return res.status(400).json({ success: false, error: 'week(차수)가 필요합니다.' });
  }

  try {
    // 거래처 조회
    let resolvedCustKey = parseInt(custKey) || 0;
    if (!resolvedCustKey && custName) {
      const r = await query(
        `SELECT TOP 1 CustKey FROM Customer WHERE CustName LIKE @name AND isDeleted = 0`,
        { name: { type: sql.NVarChar, value: `%${custName}%` } }
      );
      if (!r.recordset[0]) return res.status(404).json({ success: false, error: `거래처 없음: ${custName}` });
      resolvedCustKey = r.recordset[0].CustKey;
    }
    if (!resolvedCustKey) return res.status(400).json({ success: false, error: 'custKey 또는 custName이 필요합니다.' });

    const { orderMasterKey, created: masterCreated, results } = await withTransaction(async (tQ) => {
      // ── OrderMaster: 기존 있으면 재사용, 없으면 생성 (UPDLOCK+HOLDLOCK으로 중복 방지)
      const existing = await tQ(
        `SELECT OrderMasterKey FROM OrderMaster WITH (UPDLOCK, HOLDLOCK)
         WHERE CustKey=@ck AND OrderWeek=@wk AND isDeleted=0`,
        { ck: { type: sql.Int, value: resolvedCustKey }, wk: { type: sql.NVarChar, value: week } }
      );

      let mk;
      let created = false;
      if (existing.recordset.length > 0) {
        mk = existing.recordset[0].OrderMasterKey;
      } else {
        const ins = await tQ(
          `INSERT INTO OrderMaster
             (OrderDtm, OrderYear, OrderWeek, Manager, CustKey, OrderCode, isDeleted, CreateID, CreateDtm)
           OUTPUT INSERTED.OrderMasterKey
           VALUES (GETDATE(), @year, @week, @manager, @ck, @orderCode, 0, 'API', GETDATE())`,
          {
            year:      { type: sql.NVarChar, value: year || String(new Date().getFullYear()) },
            week:      { type: sql.NVarChar, value: week },
            manager:   { type: sql.NVarChar, value: manager || '' },
            ck:        { type: sql.Int,      value: resolvedCustKey },
            orderCode: { type: sql.NVarChar, value: orderCode || '' },
          }
        );
        mk = ins.recordset[0].OrderMasterKey;
        created = true;
      }

      // ── OrderDetail: 품목별로 기존 있으면 수량 UPDATE, 없으면 INSERT
      const results = [];
      for (const item of items) {
        let prodKey = parseInt(item.prodKey) || 0;
        if (!prodKey && item.prodName) {
          const pr = await tQ(
            `SELECT TOP 1 ProdKey FROM Product WHERE ProdName LIKE @name AND isDeleted = 0`,
            { name: { type: sql.NVarChar, value: `%${item.prodName}%` } }
          );
          if (!pr.recordset[0]) { results.push({ prodName: item.prodName, status: 'NOT_FOUND' }); continue; }
          prodKey = pr.recordset[0].ProdKey;
        }

        const qty   = parseFloat(item.qty) || 0;
        const unit  = item.unit || '박스';
        const box   = unit === '박스' ? qty : 0;
        const bunch = unit === '단'   ? qty : 0;
        const steam = unit === '송이' ? qty : 0;

        const odExist = await tQ(
          `SELECT OrderDetailKey FROM OrderDetail WHERE OrderMasterKey=@mk AND ProdKey=@pk AND isDeleted=0`,
          { mk: { type: sql.Int, value: mk }, pk: { type: sql.Int, value: prodKey } }
        );

        if (odExist.recordset.length > 0) {
          await tQ(
            `UPDATE OrderDetail SET BoxQuantity=@box, BunchQuantity=@bunch, SteamQuantity=@steam, OutQuantity=@qty
             WHERE OrderMasterKey=@mk AND ProdKey=@pk AND isDeleted=0`,
            {
              box:   { type: sql.Float, value: box },
              bunch: { type: sql.Float, value: bunch },
              steam: { type: sql.Float, value: steam },
              qty:   { type: sql.Float, value: qty },
              mk:    { type: sql.Int,   value: mk },
              pk:    { type: sql.Int,   value: prodKey },
            }
          );
          results.push({ prodKey, prodName: item.prodName, qty, unit, status: 'UPDATED' });
        } else {
          await tQ(
            `INSERT INTO OrderDetail
               (OrderMasterKey, ProdKey, BoxQuantity, BunchQuantity, SteamQuantity,
                OutQuantity, NoneOutQuantity, isDeleted, CreateID, CreateDtm)
             VALUES (@mk, @pk, @box, @bunch, @steam, @qty, 0, 0, 'API', GETDATE())`,
            {
              mk:    { type: sql.Int,   value: mk },
              pk:    { type: sql.Int,   value: prodKey },
              box:   { type: sql.Float, value: box },
              bunch: { type: sql.Float, value: bunch },
              steam: { type: sql.Float, value: steam },
              qty:   { type: sql.Float, value: qty },
            }
          );
          results.push({ prodKey, prodName: item.prodName, qty, unit, status: 'OK' });
        }
      }
      return { orderMasterKey: mk, created, results };
    });

    return res.status(201).json({
      success: true,
      orderMasterKey,
      masterCreated,  // true=신규생성, false=기존재사용
      savedItems: results.filter(r => r.status === 'OK').length,
      updatedItems: results.filter(r => r.status === 'UPDATED').length,
      failedItems: results.filter(r => r.status === 'NOT_FOUND'),
      results,
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}
