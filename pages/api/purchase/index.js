// pages/api/purchase/index.js
// GET  → 구매(수입) 주문 목록 / 단건 상세 조회
// POST → 신규 구매 주문 등록
// DELETE → 구매 주문 삭제(소프트)

import { query, withTransaction, sql } from '../../../lib/db';
import { withAuth } from '../../../lib/auth';

// ── 테이블 자동 생성 ──────────────────────────────────────
async function ensureTables() {
  await query(`
    IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='ImportOrder' AND xtype='U')
    CREATE TABLE ImportOrder (
      ImportKey     INT IDENTITY PRIMARY KEY,
      InvoiceNo     NVARCHAR(50) NOT NULL,
      OrderWeek     NVARCHAR(20),
      SupplierName  NVARCHAR(100),
      CurrencyCode  NVARCHAR(10) DEFAULT 'USD',
      ExchangeRate  DECIMAL(10,4) DEFAULT 1300,
      PaymentDtm    NVARCHAR(20),
      ImportDtm     NVARCHAR(20),
      TotalBoxes    INT DEFAULT 0,
      TotalWeight   DECIMAL(10,2) DEFAULT 0,
      FreightCost   DECIMAL(18,2) DEFAULT 0,
      Memo          NVARCHAR(200),
      CreateDtm     DATETIME DEFAULT GETDATE(),
      isDeleted     BIT DEFAULT 0
    )
  `);
  await query(`
    IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='ImportOrderDetail' AND xtype='U')
    CREATE TABLE ImportOrderDetail (
      DetailKey     INT IDENTITY PRIMARY KEY,
      ImportKey     INT NOT NULL,
      ProdKey       INT,
      ProdName      NVARCHAR(200),
      BoxQty        DECIMAL(10,2) DEFAULT 0,
      UnitPrice     DECIMAL(18,4) DEFAULT 0,
      TotalPrice    DECIMAL(18,2) DEFAULT 0,
      Weight        DECIMAL(10,2) DEFAULT 0,
      Memo          NVARCHAR(200),
      isDeleted     BIT DEFAULT 0
    )
  `);
}

export default withAuth(async function handler(req, res) {
  try {
    await ensureTables();
  } catch (err) {
    return res.status(500).json({ success: false, error: '테이블 초기화 오류: ' + err.message });
  }

  if (req.method === 'GET')    return await getOrders(req, res);
  if (req.method === 'POST')   return await createOrder(req, res);
  if (req.method === 'DELETE') return await deleteOrder(req, res);
  return res.status(405).end();
});

// ── GET: 목록 또는 단건 상세 ──────────────────────────────
async function getOrders(req, res) {
  const { importKey, dateFrom, dateTo, week, invoiceNo, supplierName } = req.query;

  // 단건 상세 조회
  if (importKey) {
    try {
      const orderRes = await query(
        `SELECT ImportKey, InvoiceNo, OrderWeek, SupplierName, CurrencyCode,
                ExchangeRate, PaymentDtm, ImportDtm, TotalBoxes, TotalWeight,
                FreightCost, Memo, CreateDtm
         FROM ImportOrder
         WHERE ImportKey = @key AND isDeleted = 0`,
        { key: { type: sql.Int, value: parseInt(importKey) } }
      );
      if (!orderRes.recordset[0]) {
        return res.status(404).json({ success: false, error: '구매 주문을 찾을 수 없습니다.' });
      }
      const o = orderRes.recordset[0];

      const detailRes = await query(
        `SELECT DetailKey, ImportKey, ProdKey, ProdName, BoxQty, UnitPrice,
                TotalPrice, Weight, Memo
         FROM ImportOrderDetail
         WHERE ImportKey = @key AND isDeleted = 0
         ORDER BY DetailKey`,
        { key: { type: sql.Int, value: parseInt(importKey) } }
      );

      return res.status(200).json({
        success: true,
        order: {
          importKey:    o.ImportKey,
          invoiceNo:    o.InvoiceNo,
          week:         o.OrderWeek,
          supplierName: o.SupplierName,
          currencyCode: o.CurrencyCode,
          exchangeRate: o.ExchangeRate,
          paymentDtm:   o.PaymentDtm,
          importDtm:    o.ImportDtm,
          totalBoxes:   o.TotalBoxes,
          totalWeight:  o.TotalWeight,
          freightCost:  o.FreightCost,
          memo:         o.Memo,
          createDtm:    o.CreateDtm,
        },
        details: detailRes.recordset.map(d => ({
          detailKey:  d.DetailKey,
          prodKey:    d.ProdKey,
          prodName:   d.ProdName,
          boxQty:     d.BoxQty,
          unitPrice:  d.UnitPrice,
          totalPrice: d.TotalPrice,
          weight:     d.Weight,
          memo:       d.Memo,
        })),
      });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  // 목록 조회
  let where = 'WHERE io.isDeleted = 0';
  const params = {};

  if (dateFrom) {
    where += ' AND io.CreateDtm >= @dateFrom';
    params.dateFrom = { type: sql.NVarChar, value: dateFrom };
  }
  if (dateTo) {
    where += ' AND io.CreateDtm < DATEADD(day, 1, CAST(@dateTo AS DATE))';
    params.dateTo = { type: sql.NVarChar, value: dateTo };
  }
  if (week) {
    where += ' AND io.OrderWeek LIKE @week';
    params.week = { type: sql.NVarChar, value: `%${week}%` };
  }
  if (invoiceNo) {
    where += ' AND io.InvoiceNo LIKE @invoiceNo';
    params.invoiceNo = { type: sql.NVarChar, value: `%${invoiceNo}%` };
  }
  if (supplierName) {
    where += ' AND io.SupplierName LIKE @supplierName';
    params.supplierName = { type: sql.NVarChar, value: `%${supplierName}%` };
  }

  try {
    const result = await query(
      `SELECT
         io.ImportKey,
         io.InvoiceNo,
         io.OrderWeek,
         io.SupplierName,
         io.CurrencyCode,
         io.ExchangeRate,
         io.PaymentDtm,
         io.ImportDtm,
         io.TotalBoxes,
         io.TotalWeight,
         io.FreightCost,
         io.Memo,
         io.CreateDtm,
         COUNT(iod.DetailKey)        AS detailCount,
         ISNULL(SUM(iod.TotalPrice), 0) AS totalForeignAmt
       FROM ImportOrder io
       LEFT JOIN ImportOrderDetail iod
         ON io.ImportKey = iod.ImportKey AND iod.isDeleted = 0
       ${where}
       GROUP BY
         io.ImportKey, io.InvoiceNo, io.OrderWeek, io.SupplierName,
         io.CurrencyCode, io.ExchangeRate, io.PaymentDtm, io.ImportDtm,
         io.TotalBoxes, io.TotalWeight, io.FreightCost, io.Memo, io.CreateDtm
       ORDER BY io.CreateDtm DESC, io.ImportKey DESC`,
      params
    );

    const orders = result.recordset.map(o => ({
      importKey:       o.ImportKey,
      invoiceNo:       o.InvoiceNo,
      week:            o.OrderWeek,
      supplierName:    o.SupplierName,
      currencyCode:    o.CurrencyCode,
      exchangeRate:    parseFloat(o.ExchangeRate) || 0,
      paymentDtm:      o.PaymentDtm,
      importDtm:       o.ImportDtm,
      totalBoxes:      o.TotalBoxes,
      totalWeight:     parseFloat(o.TotalWeight) || 0,
      freightCost:     parseFloat(o.FreightCost) || 0,
      memo:            o.Memo,
      createDtm:       o.CreateDtm,
      detailCount:     o.detailCount,
      totalForeignAmt: parseFloat(o.totalForeignAmt) || 0,
      totalKRW:        (parseFloat(o.totalForeignAmt) || 0) * (parseFloat(o.ExchangeRate) || 0),
    }));

    return res.status(200).json({ success: true, orders });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}

// ── POST: 신규 구매 주문 등록 ─────────────────────────────
async function createOrder(req, res) {
  const {
    invoiceNo, week, supplierName, currencyCode, exchangeRate,
    paymentDtm, importDtm, totalBoxes, totalWeight, freightCost, memo,
    details,
  } = req.body;

  if (!invoiceNo || !invoiceNo.trim()) {
    return res.status(400).json({ success: false, error: '인보이스번호는 필수입니다.' });
  }
  if (!details || details.length === 0) {
    return res.status(400).json({ success: false, error: '품목을 1개 이상 입력하세요.' });
  }

  try {
    // Master + Detail 전체를 하나의 트랜잭션으로 (중간 실패 시 전체 롤백)
    const importKey = await withTransaction(async (tQuery) => {
      const masterResult = await tQuery(
        `INSERT INTO ImportOrder
           (InvoiceNo, OrderWeek, SupplierName, CurrencyCode, ExchangeRate,
            PaymentDtm, ImportDtm, TotalBoxes, TotalWeight, FreightCost, Memo,
            CreateDtm, isDeleted)
         OUTPUT INSERTED.ImportKey
         VALUES
           (@invoiceNo, @week, @supplierName, @currencyCode, @exchangeRate,
            @paymentDtm, @importDtm, @totalBoxes, @totalWeight, @freightCost, @memo,
            GETDATE(), 0)`,
        {
          invoiceNo:    { type: sql.NVarChar,  value: invoiceNo.trim() },
          week:         { type: sql.NVarChar,  value: week || '' },
          supplierName: { type: sql.NVarChar,  value: supplierName || '' },
          currencyCode: { type: sql.NVarChar,  value: currencyCode || 'USD' },
          exchangeRate: { type: sql.Decimal,   value: parseFloat(exchangeRate) || 1300 },
          paymentDtm:   { type: sql.NVarChar,  value: paymentDtm || '' },
          importDtm:    { type: sql.NVarChar,  value: importDtm || '' },
          totalBoxes:   { type: sql.Int,       value: parseInt(totalBoxes) || 0 },
          totalWeight:  { type: sql.Decimal,   value: parseFloat(totalWeight) || 0 },
          freightCost:  { type: sql.Decimal,   value: parseFloat(freightCost) || 0 },
          memo:         { type: sql.NVarChar,  value: memo || '' },
        }
      );
      const ik = masterResult.recordset[0].ImportKey;

      for (const d of details) {
        const boxQty     = parseFloat(d.boxQty)    || 0;
        const unitPrice  = parseFloat(d.unitPrice)  || 0;
        const totalPrice = parseFloat(d.totalPrice) || (boxQty * unitPrice);
        const weight     = parseFloat(d.weight)     || 0;
        await tQuery(
          `INSERT INTO ImportOrderDetail
             (ImportKey, ProdKey, ProdName, BoxQty, UnitPrice, TotalPrice, Weight, Memo, isDeleted)
           VALUES (@importKey, @prodKey, @prodName, @boxQty, @unitPrice, @totalPrice, @weight, @memo, 0)`,
          {
            importKey:  { type: sql.Int,      value: ik },
            prodKey:    { type: sql.Int,      value: d.prodKey ? parseInt(d.prodKey) : null },
            prodName:   { type: sql.NVarChar, value: d.prodName || '' },
            boxQty:     { type: sql.Decimal,  value: boxQty },
            unitPrice:  { type: sql.Decimal,  value: unitPrice },
            totalPrice: { type: sql.Decimal,  value: totalPrice },
            weight:     { type: sql.Decimal,  value: weight },
            memo:       { type: sql.NVarChar, value: d.memo || '' },
          }
        );
      }
      return ik;
    });

    return res.status(201).json({ success: true, importKey });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}

// ── DELETE: 소프트 삭제 ───────────────────────────────────
async function deleteOrder(req, res) {
  const { importKey } = req.body;
  if (!importKey) {
    return res.status(400).json({ success: false, error: 'importKey가 필요합니다.' });
  }
  try {
    await query(
      `UPDATE ImportOrder SET isDeleted = 1 WHERE ImportKey = @key`,
      { key: { type: sql.Int, value: parseInt(importKey) } }
    );
    return res.status(200).json({ success: true });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}
