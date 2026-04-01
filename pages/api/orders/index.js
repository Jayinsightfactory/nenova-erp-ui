// pages/api/orders/index.js
// GET  → 실제 DB 조회 (OrderMaster + OrderDetail)
// POST → 테스트 테이블에 저장 (_new_OrderMaster + _new_OrderDetail)

import { query, sql } from '../../../lib/db';
import { withAuth } from '../../../lib/auth';

export default withAuth(async function handler(req, res) {
  if (req.method === 'GET')  return await getOrders(req, res);
  if (req.method === 'POST') return await createOrder(req, res);
  return res.status(405).end();
});

// ── 조회: 실제 DB ──────────────────────────────
async function getOrders(req, res) {
  const { week, startDate, endDate, custName } = req.query;

  let where = 'WHERE om.isDeleted = 0';
  const params = {};

  if (week) {
    where += ' AND om.OrderWeek = @week';
    params.week = { type: sql.NVarChar, value: week };
  }
  if (startDate) {
    where += ' AND CAST(om.OrderDtm AS DATE) >= @startDate';
    params.startDate = { type: sql.NVarChar, value: startDate };
  }
  if (endDate) {
    where += ' AND CAST(om.OrderDtm AS DATE) <= @endDate';
    params.endDate = { type: sql.NVarChar, value: endDate };
  }
  if (custName) {
    where += ' AND c.CustName LIKE @custName';
    params.custName = { type: sql.NVarChar, value: `%${custName}%` };
  }

  try {
    const result = await query(
      `SELECT
        om.OrderMasterKey,
        CONVERT(NVARCHAR(10), om.OrderDtm, 120) AS OrderDtm,
        om.OrderYear, om.OrderWeek, om.Manager, om.OrderCode,
        c.CustKey, c.CustName, c.CustArea,
        od.OrderDetailKey, od.ProdKey,
        p.ProdName, p.FlowerName, p.CounName,
        od.BoxQuantity, od.BunchQuantity, od.SteamQuantity,
        od.OutQuantity, od.NoneOutQuantity
       FROM OrderMaster om
       LEFT JOIN Customer c    ON om.CustKey = c.CustKey AND c.isDeleted = 0
       LEFT JOIN OrderDetail od ON om.OrderMasterKey = od.OrderMasterKey AND od.isDeleted = 0
       LEFT JOIN Product p     ON od.ProdKey = p.ProdKey
       ${where}
       ORDER BY om.OrderDtm DESC, om.OrderMasterKey, od.OrderDetailKey`,
      params
    );

    // OrderMasterKey 기준으로 그룹핑
    const ordersMap = {};
    for (const row of result.recordset) {
      if (!ordersMap[row.OrderMasterKey]) {
        ordersMap[row.OrderMasterKey] = {
          id: row.OrderMasterKey,
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
          unit: row.BoxQuantity > 0 ? '박스' : row.BunchQuantity > 0 ? '단' : '송이',
          qty: row.BoxQuantity || row.BunchQuantity || row.SteamQuantity || 0,
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

// ── 등록: 테스트 테이블 ──────────────────────────
async function createOrder(req, res) {
  const { custName, custKey, week, year, manager, orderCode, items } = req.body;

  if (!items || items.length === 0) {
    return res.status(400).json({ success: false, error: '품목을 입력하세요.' });
  }

  try {
    // 거래처 조회
    let resolvedCustKey = custKey;
    if (!resolvedCustKey && custName) {
      const r = await query(
        `SELECT TOP 1 CustKey FROM Customer WHERE CustName LIKE @name AND isDeleted = 0`,
        { name: { type: sql.NVarChar, value: `%${custName}%` } }
      );
      if (!r.recordset[0]) {
        return res.status(404).json({ success: false, error: `거래처 없음: ${custName}` });
      }
      resolvedCustKey = r.recordset[0].CustKey;
    }

    // _new_OrderMaster 에 저장
    const masterResult = await query(
      `INSERT INTO _new_OrderMaster
         (OrderDtm, OrderYear, OrderWeek, Manager, CustKey, OrderCode, isDeleted, CreateID, CreateDtm)
       OUTPUT INSERTED.OrderMasterKey
       VALUES (GETDATE(), @year, @week, @manager, @custKey, @orderCode, 0, @createId, GETDATE())`,
      {
        year:      { type: sql.NVarChar, value: year || new Date().getFullYear().toString() },
        week:      { type: sql.NVarChar, value: week || '' },
        manager:   { type: sql.NVarChar, value: manager || req.user.userName },
        custKey:   { type: sql.Int,      value: resolvedCustKey },
        orderCode: { type: sql.NVarChar, value: orderCode || '' },
        createId:  { type: sql.NVarChar, value: req.user.userId },
      }
    );
    const orderMasterKey = masterResult.recordset[0].OrderMasterKey;

    // _new_OrderDetail 에 각 품목 저장
    const results = [];
    for (const item of items) {
      let prodKey = item.prodKey;
      if (!prodKey && item.prodName) {
        const pr = await query(
          `SELECT TOP 1 ProdKey FROM Product WHERE ProdName LIKE @name AND isDeleted = 0`,
          { name: { type: sql.NVarChar, value: `%${item.prodName}%` } }
        );
        if (!pr.recordset[0]) {
          results.push({ prodName: item.prodName, status: 'NOT_FOUND' });
          continue;
        }
        prodKey = pr.recordset[0].ProdKey;
      }

      const qty = parseFloat(item.qty) || 0;
      const unit = item.unit || '박스';
      await query(
        `INSERT INTO _new_OrderDetail
           (OrderMasterKey, ProdKey, BoxQuantity, BunchQuantity, SteamQuantity,
            OutQuantity, NoneOutQuantity, isDeleted, CreateID, CreateDtm)
         VALUES (@mk, @pk, @box, @bunch, @steam, 0, 0, 0, @uid, GETDATE())`,
        {
          mk:    { type: sql.Int,      value: orderMasterKey },
          pk:    { type: sql.Int,      value: prodKey },
          box:   { type: sql.Float,    value: unit === '박스' ? qty : 0 },
          bunch: { type: sql.Float,    value: unit === '단'   ? qty : 0 },
          steam: { type: sql.Float,    value: unit === '송이' ? qty : 0 },
          uid:   { type: sql.NVarChar, value: req.user.userId },
        }
      );
      results.push({ prodKey, prodName: item.prodName, qty, unit, status: 'OK' });
    }

    return res.status(201).json({
      success: true,
      source: 'test_table',  // 테스트 테이블에 저장됐음을 표시
      orderMasterKey,
      message: `주문 등록 완료 (테스트) — ${results.filter(r => r.status === 'OK').length}개 품목`,
      results,
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}
