// pages/api/public/shipments.js
// 외부 프로그램용 출고분배 API (API 키 인증)
//
// 인증: 헤더 X-Api-Key: <key> 또는 쿼리 ?apiKey=<key>
// API 키: 환경변수 PUBLIC_API_KEY (미설정 시 "nenova-api-2026")
//
// GET  /api/public/shipments         → 출고 조회
// POST /api/public/shipments         → 출고분배 등록 (실제 DB 저장)
//
// GET 쿼리 파라미터: week, custName, area, limit(기본100)
//
// POST 예시 (JSON):
// {
//   "custName": "ABC화원",           // 거래처명 (또는 custKey)
//   "custKey": 123,                  // 거래처 키
//   "week": "14-01",                // 차수
//   "year": "2026",                 // 년도
//   "items": [
//     {
//       "prodName": "장미 레드",      // 품목명 (또는 prodKey)
//       "prodKey": 456,              // 품목 키
//       "qty": 10,                   // 출고수량
//       "boxQty": 10,                // 박스 수량 (생략 가능)
//       "bunchQty": 0,               // 단 수량
//       "steamQty": 0,               // 송이 수량
//       "cost": 5000,                // 단가
//       "shipDate": "2026-04-07"     // 출고일 (생략 시 현재)
//     }
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

  if (req.method === 'GET')  return await getShipments(req, res);
  if (req.method === 'POST') return await createShipment(req, res);
  return res.status(405).json({ success: false, error: '지원하지 않는 메서드입니다.' });
}

// ── GET: 출고 조회 ─────────────────────────────────────────────────────
// 쿼리 파라미터: week, custName, area, limit(기본100)
async function getShipments(req, res) {
  const { week, custName, area, limit = 100 } = req.query;

  let where = 'WHERE sm.isDeleted = 0';
  const params = {};

  if (week)     { where += ' AND sm.OrderWeek = @week';           params.week     = { type: sql.NVarChar, value: week }; }
  if (custName) { where += ' AND c.CustName LIKE @custName';      params.custName = { type: sql.NVarChar, value: `%${custName}%` }; }
  if (area)     { where += ' AND c.CustArea = @area';             params.area     = { type: sql.NVarChar, value: area }; }

  try {
    const result = await query(
      `SELECT TOP ${Math.min(parseInt(limit) || 100, 1000)}
        sm.ShipmentKey,
        CONVERT(NVARCHAR(10), sm.CreateDtm, 120) AS ShipmentDtm,
        sm.OrderWeek, sm.OrderYear, sm.isFix,
        c.CustKey, c.CustName, c.CustArea, c.Manager,
        sd.ShipmentDetailKey, sd.ProdKey,
        p.ProdName, p.FlowerName, p.CounName,
        sd.BoxQuantity, sd.BunchQuantity, sd.SteamQuantity,
        sd.OutQuantity, sd.Cost, sd.Amount, sd.Vat
       FROM ShipmentMaster sm
       LEFT JOIN Customer c       ON sm.CustKey = c.CustKey AND c.isDeleted = 0
       LEFT JOIN ShipmentDetail sd ON sm.ShipmentKey = sd.ShipmentKey
       LEFT JOIN Product p         ON sd.ProdKey = p.ProdKey
       ${where}
       ORDER BY sm.CreateDtm DESC, sm.ShipmentKey, sd.ShipmentDetailKey`,
      params
    );

    // 마스터 기준으로 그룹핑
    const shipmentsMap = {};
    for (const row of result.recordset) {
      if (!shipmentsMap[row.ShipmentKey]) {
        shipmentsMap[row.ShipmentKey] = {
          shipmentKey: row.ShipmentKey,
          date: row.ShipmentDtm,
          week: row.OrderWeek,
          year: row.OrderYear,
          isFix: row.isFix,
          custKey: row.CustKey,
          custName: row.CustName,
          custArea: row.CustArea,
          manager: row.Manager,
          items: [],
        };
      }
      if (row.ShipmentDetailKey) {
        shipmentsMap[row.ShipmentKey].items.push({
          shipmentDetailKey: row.ShipmentDetailKey,
          prodKey: row.ProdKey,
          prodName: row.ProdName,
          flowerName: row.FlowerName,
          counName: row.CounName,
          boxQty: row.BoxQuantity,
          bunchQty: row.BunchQuantity,
          steamQty: row.SteamQuantity,
          outQty: row.OutQuantity,
          cost: row.Cost,
          amount: row.Amount,
          vat: row.Vat,
        });
      }
    }

    return res.status(200).json({
      success: true,
      count: Object.keys(shipmentsMap).length,
      shipments: Object.values(shipmentsMap),
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}

// ── POST: 출고분배 등록 (실제 DB) ──────────────────────────────────────
async function createShipment(req, res) {
  const { custName, custKey, week, year, items } = req.body;

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

    const resolvedWeek = week || '';
    const resolvedYear = year || String(new Date().getFullYear());

    // ShipmentMaster가 이미 있는지 확인, 없으면 생성
    let smResult = await query(
      `SELECT ShipmentKey FROM ShipmentMaster WHERE CustKey=@ck AND OrderWeek=@week AND isDeleted=0`,
      {
        ck:   { type: sql.Int,      value: parseInt(resolvedCustKey) },
        week: { type: sql.NVarChar, value: resolvedWeek },
      }
    );

    let shipmentKey;
    if (smResult.recordset.length === 0) {
      const ins = await query(
        `INSERT INTO ShipmentMaster
           (OrderYear, OrderWeek, OrderYearWeek, CustKey, isFix, isDeleted, CreateID, CreateDtm)
         OUTPUT INSERTED.ShipmentKey
         VALUES (@yr, @wk, @ywk, @ck, 0, 0, 'API', GETDATE())`,
        {
          yr:  { type: sql.NVarChar, value: resolvedYear },
          wk:  { type: sql.NVarChar, value: resolvedWeek },
          ywk: { type: sql.NVarChar, value: resolvedYear + resolvedWeek },
          ck:  { type: sql.Int,      value: parseInt(resolvedCustKey) },
        }
      );
      shipmentKey = ins.recordset[0].ShipmentKey;
    } else {
      shipmentKey = smResult.recordset[0].ShipmentKey;
    }

    // ShipmentDetail 저장
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

      const qty    = parseFloat(item.qty)    || 0;
      const boxQty = parseFloat(item.boxQty) || qty;
      const bunchQty = parseFloat(item.bunchQty) || 0;
      const steamQty = parseFloat(item.steamQty) || 0;
      const cost   = parseFloat(item.cost)   || 0;
      // 13/14차 데이터 패턴: Amount = Bunch × Cost / 1.1 (Bunch 없으면 Out fallback)
      const effQty = bunchQty > 0 ? bunchQty : qty;
      const amount = Math.round(effQty * cost / 1.1);
      const vat    = Math.round(effQty * cost / 11);

      // 기존 동일 품목 있으면 덮어쓰기
      await query(
        `DELETE FROM ShipmentDetail WHERE ShipmentKey=@sk AND ProdKey=@pk`,
        { sk: { type: sql.Int, value: shipmentKey }, pk: { type: sql.Int, value: parseInt(prodKey) } }
      );

      if (qty > 0) {
        await query(
          `INSERT INTO ShipmentDetail
             (ShipmentKey, CustKey, ProdKey, ShipmentDtm,
              BoxQuantity, BunchQuantity, SteamQuantity, OutQuantity, EstQuantity,
              Cost, Amount, Vat, CreateID, CreateDtm)
           VALUES (@sk, @ck, @pk, @dt, @box, @bunch, @steam, @qty, @qty, @cost, @amount, @vat, 'API', GETDATE())`,
          {
            sk:     { type: sql.Int,      value: shipmentKey },
            ck:     { type: sql.Int,      value: parseInt(resolvedCustKey) },
            pk:     { type: sql.Int,      value: parseInt(prodKey) },
            dt:     { type: sql.DateTime, value: item.shipDate ? new Date(item.shipDate) : new Date() },
            box:    { type: sql.Float,    value: boxQty },
            bunch:  { type: sql.Float,    value: bunchQty },
            steam:  { type: sql.Float,    value: steamQty },
            qty:    { type: sql.Float,    value: qty },
            cost:   { type: sql.Float,    value: cost },
            amount: { type: sql.Float,    value: amount },
            vat:    { type: sql.Float,    value: vat },
          }
        );
      }
      results.push({ prodKey, prodName: item.prodName, qty, cost, amount, status: 'OK' });
    }

    return res.status(201).json({
      success: true,
      shipmentKey,
      week: resolvedWeek,
      savedItems: results.filter(r => r.status === 'OK').length,
      failedItems: results.filter(r => r.status !== 'OK'),
      results,
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}
