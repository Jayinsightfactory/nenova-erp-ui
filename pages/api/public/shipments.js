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

import { query, withTransaction, sql } from '../../../lib/db';
import { tryInsertWithRetry, syncKeyNumbering } from '../../../lib/safeNextKey';

const API_KEY = process.env.PUBLIC_API_KEY || 'nenova-api-2026';

function toShipmentUnits(outQty, product = {}) {
  const qty = Number(outQty || 0);
  const b1b = Number(product.BunchOf1Box || 0);
  const s1b = Number(product.SteamOf1Box || 0);
  return {
    box: qty,
    bunch: b1b > 0 ? qty * b1b : 0,
    steam: s1b > 0 ? qty * s1b : 0,
    outQty: qty,
  };
}

function estimateQuantityFromShipmentUnits(units) {
  if (Number(units.bunch || 0) > 0) return Number(units.bunch || 0);
  if (Number(units.steam || 0) > 0) return Number(units.steam || 0);
  return Number(units.box || 0);
}

function checkApiKey(req, res) {
  const key = req.headers['x-api-key'] || req.query.apiKey;
  if (key !== API_KEY) {
    res.status(401).json({ success: false, error: 'API 키가 올바르지 않습니다. X-Api-Key 헤더를 확인하세요.' });
    return false;
  }
  return true;
}

const columnExistsCache = {};
async function columnExists(tableName, columnName) {
  const key = `${tableName}.${columnName}`;
  if (columnExistsCache[key] !== undefined) return columnExistsCache[key];
  const r = await query(
    `SELECT CASE WHEN COL_LENGTH(@tableName, @columnName) IS NULL THEN 0 ELSE 1 END AS HasColumn`,
    {
      tableName: { type: sql.NVarChar, value: `dbo.${tableName}` },
      columnName: { type: sql.NVarChar, value: columnName },
    }
  );
  columnExistsCache[key] = Number(r.recordset[0]?.HasColumn || 0) === 1;
  return columnExistsCache[key];
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
        sd.SdetailKey AS ShipmentDetailKey, sd.ProdKey,
        p.ProdName, p.FlowerName, p.CounName,
        sd.BoxQuantity, sd.BunchQuantity, sd.SteamQuantity,
        sd.OutQuantity, sd.Cost, sd.Amount, sd.Vat
       FROM ShipmentMaster sm
       LEFT JOIN Customer c       ON sm.CustKey = c.CustKey AND c.isDeleted = 0
       LEFT JOIN ShipmentDetail sd ON sm.ShipmentKey = sd.ShipmentKey
       LEFT JOIN Product p         ON sd.ProdKey = p.ProdKey
       ${where}
       ORDER BY sm.CreateDtm DESC, sm.ShipmentKey, sd.SdetailKey`,
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
    const hasShipmentYearWeekColumn = await columnExists('ShipmentMaster', 'OrderYearWeek');
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

    const { shipmentKey, results } = await withTransaction(async (tQ) => {
      const smResult = await tQ(
        `SELECT TOP 1 ShipmentKey FROM ShipmentMaster WITH (UPDLOCK, HOLDLOCK)
          WHERE CustKey=@ck AND OrderWeek=@week AND isDeleted=0
          ORDER BY ISNULL(isFix,0) DESC, ShipmentKey ASC`,
        {
          ck:   { type: sql.Int,      value: parseInt(resolvedCustKey) },
          week: { type: sql.NVarChar, value: resolvedWeek },
        }
      );

      let sk;
      if (smResult.recordset.length === 0) {
        const shipmentMasterParams = {
          yr:  { type: sql.NVarChar, value: resolvedYear },
          wk:  { type: sql.NVarChar, value: resolvedWeek },
          ywk: { type: sql.NVarChar, value: resolvedYear + String(resolvedWeek || '').split('-')[0] },
          ck:  { type: sql.Int,      value: parseInt(resolvedCustKey) },
        };
        sk = await tryInsertWithRetry(tQ, 'ShipmentMaster', 'ShipmentKey', async (nextKey) => {
          const params = { ...shipmentMasterParams, sk: { type: sql.Int, value: nextKey } };
          if (hasShipmentYearWeekColumn) {
            await tQ(
              `INSERT INTO ShipmentMaster
                 (ShipmentKey, OrderYear, OrderWeek, OrderYearWeek, CustKey, isFix, isDeleted, CreateID, CreateDtm)
               VALUES (@sk, @yr, @wk, @ywk, @ck, 0, 0, 'API', GETDATE())`,
              params
            );
          } else {
            await tQ(
              `INSERT INTO ShipmentMaster
                 (ShipmentKey, OrderYear, OrderWeek, CustKey, isFix, isDeleted, CreateID, CreateDtm)
               VALUES (@sk, @yr, @wk, @ck, 0, 0, 'API', GETDATE())`,
              params
            );
          }
        });
        await syncKeyNumbering(tQ, 'ShipmentMasterKey', 'ShipmentMaster', 'ShipmentKey');
      } else {
        sk = smResult.recordset[0].ShipmentKey;
      }

      const results = [];
      for (const item of items) {
        let prodKey = item.prodKey;
        if (!prodKey && item.prodName) {
          const pr = await tQ(
            `SELECT TOP 1 ProdKey FROM Product WHERE ProdName LIKE @name AND isDeleted = 0`,
            { name: { type: sql.NVarChar, value: `%${item.prodName}%` } }
          );
          if (!pr.recordset[0]) { results.push({ prodName: item.prodName, status: 'NOT_FOUND' }); continue; }
          prodKey = pr.recordset[0].ProdKey;
        }

        const prod = await tQ(
          `SELECT ISNULL(p.BunchOf1Box,0) AS BunchOf1Box,
                  ISNULL(p.SteamOf1Box,0) AS SteamOf1Box,
                  ISNULL(NULLIF(cpc.Cost,0), ISNULL(p.Cost,0)) AS Cost
             FROM Product p
             LEFT JOIN CustomerProdCost cpc ON cpc.CustKey=@ck AND cpc.ProdKey=p.ProdKey
            WHERE p.ProdKey=@pk AND ISNULL(p.isDeleted,0)=0`,
          { pk: { type: sql.Int, value: parseInt(prodKey) }, ck: { type: sql.Int, value: parseInt(resolvedCustKey) } }
        );
        if (!prod.recordset[0]) { results.push({ prodName: item.prodName, status: 'NOT_FOUND' }); continue; }

        const productInfo = prod.recordset[0];
        const qty = parseFloat(item.qty) || 0;
        const units = toShipmentUnits(qty, productInfo);
        const estQty = estimateQuantityFromShipmentUnits(units);
        const cost = parseFloat(item.cost) || Number(productInfo.Cost || 0);
        const amount = Math.round(estQty * cost / 1.1);
        const vat = Math.round(estQty * cost / 11);

        const oldRows = await tQ(
          `SELECT SdetailKey FROM ShipmentDetail WITH (UPDLOCK, HOLDLOCK)
            WHERE ShipmentKey=@sk AND ProdKey=@pk`,
          { sk: { type: sql.Int, value: sk }, pk: { type: sql.Int, value: parseInt(prodKey) } }
        );
        for (const old of oldRows.recordset) {
          await tQ(`DELETE FROM ShipmentDate WHERE SdetailKey=@dk`, { dk: { type: sql.Int, value: old.SdetailKey } });
        }
        await tQ(
          `DELETE FROM ShipmentDetail WHERE ShipmentKey=@sk AND ProdKey=@pk`,
          { sk: { type: sql.Int, value: sk }, pk: { type: sql.Int, value: parseInt(prodKey) } }
        );

        if (qty > 0) {
          const detailKey = await tryInsertWithRetry(tQ, 'ShipmentDetail', 'SdetailKey', async (nextKey) => {
            await tQ(
              `INSERT INTO ShipmentDetail
                 (SdetailKey, ShipmentKey, CustKey, ProdKey, ShipmentDtm,
                  BoxQuantity, BunchQuantity, SteamQuantity, OutQuantity, EstQuantity,
                  Cost, Amount, Vat, isFix, CreateID, CreateDtm)
               VALUES
                 (@dk, @sk, @ck, @pk, @dt,
                  @box, @bunch, @steam, @qty, @estQty,
                  @cost, @amount, @vat, 0, 'API', GETDATE())`,
              {
                dk:     { type: sql.Int,      value: nextKey },
                sk:     { type: sql.Int,      value: sk },
                ck:     { type: sql.Int,      value: parseInt(resolvedCustKey) },
                pk:     { type: sql.Int,      value: parseInt(prodKey) },
                dt:     { type: sql.DateTime, value: item.shipDate ? new Date(item.shipDate) : new Date() },
                box:    { type: sql.Float,    value: units.box },
                bunch:  { type: sql.Float,    value: units.bunch },
                steam:  { type: sql.Float,    value: units.steam },
                qty:    { type: sql.Float,    value: units.outQty },
                estQty: { type: sql.Float,    value: estQty },
                cost:   { type: sql.Float,    value: cost },
                amount: { type: sql.Float,    value: amount },
                vat:    { type: sql.Float,    value: vat },
              }
            );
          });
          await syncKeyNumbering(tQ, 'ShipmentDetailKey', 'ShipmentDetail', 'SdetailKey');
          await tQ(
            `INSERT INTO ShipmentDate (SdetailKey, ShipmentDtm, ShipmentQuantity, EstQuantity, Cost, Amount, Vat)
             SELECT @dk, ShipmentDtm, @qty, @estQty, @cost, @amount, @vat
               FROM ShipmentDetail
              WHERE SdetailKey=@dk`,
            {
              dk: { type: sql.Int, value: detailKey },
              qty: { type: sql.Float, value: units.outQty },
              estQty: { type: sql.Float, value: estQty },
              cost: { type: sql.Float, value: cost },
              amount: { type: sql.Float, value: amount },
              vat: { type: sql.Float, value: vat },
            }
          );
        }
        results.push({ prodKey, prodName: item.prodName, qty, cost, amount, status: 'OK' });
      }

      return { shipmentKey: sk, results };
    });

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
