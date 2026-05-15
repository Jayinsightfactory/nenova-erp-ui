// pages/api/warehouse/index.js
import { query, withTransaction, sql } from '../../../lib/db';
import { withAuth } from '../../../lib/auth';

export default withAuth(async function handler(req, res) {
  if (req.method === 'GET')  return await getWarehouse(req, res);
  if (req.method === 'POST') return await uploadWarehouse(req, res);
  if (req.method === 'PATCH') return await patchFreight(req, res);
  if (req.method === 'DELETE') return await deleteWarehouse(req, res);
  return res.status(405).end();
});

async function patchFreight(req, res) {
  const { warehouseKey, gw, cw, rate, docFee } = req.body;
  if (!warehouseKey) return res.status(400).json({ success:false, error:'warehouseKey 필수' });
  try {
    await query(
      `UPDATE WarehouseMaster SET
         GrossWeight=@gw, ChargeableWeight=@cw, FreightRateUSD=@rate, DocFeeUSD=@doc
       WHERE WarehouseKey=@wk`,
      {
        wk:   { type: sql.Int,   value: parseInt(warehouseKey) },
        gw:   { type: sql.Float, value: gw === '' || gw == null ? null : parseFloat(gw) },
        cw:   { type: sql.Float, value: cw === '' || cw == null ? null : parseFloat(cw) },
        rate: { type: sql.Float, value: rate === '' || rate == null ? null : parseFloat(rate) },
        doc:  { type: sql.Float, value: docFee === '' || docFee == null ? null : parseFloat(docFee) },
      }
    );
    return res.status(200).json({ success: true });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}

async function getWarehouse(req, res) {
  const { startDate, endDate } = req.query;
  let where = 'WHERE wm.isDeleted = 0';
  const params = {};
  if (startDate) { where += ' AND CAST(wm.InputDate AS DATE) >= @start'; params.start = { type: sql.NVarChar, value: startDate }; }
  if (endDate)   { where += ' AND CAST(wm.InputDate AS DATE) <= @end';   params.end   = { type: sql.NVarChar, value: endDate }; }

  try {
    const masterResult = await query(
      `SELECT wm.WarehouseKey, wm.OrderYear, wm.OrderWeek, wm.FarmName,
        wm.InvoiceNo, wm.OrderNo AS AWB,
        CONVERT(NVARCHAR(10), wm.InputDate, 120) AS InputDate,
        wm.FileName,
        wm.GrossWeight, wm.ChargeableWeight, wm.FreightRateUSD, wm.DocFeeUSD,
        SUM(wd.BoxQuantity)   AS totalBox,
        SUM(wd.BunchQuantity) AS totalBunch,
        SUM(wd.SteamQuantity) AS totalSteam
       FROM WarehouseMaster wm
       LEFT JOIN WarehouseDetail wd ON wm.WarehouseKey = wd.WarehouseKey
       ${where}
       GROUP BY wm.WarehouseKey, wm.OrderYear, wm.OrderWeek, wm.FarmName,
                wm.InvoiceNo, wm.OrderNo, wm.InputDate, wm.FileName,
                wm.GrossWeight, wm.ChargeableWeight, wm.FreightRateUSD, wm.DocFeeUSD
       ORDER BY wm.InputDate DESC, wm.WarehouseKey DESC`,
      params
    );
    return res.status(200).json({ success: true, source: 'real_db', masters: masterResult.recordset });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}

async function uploadWarehouse(req, res) {
  const { orderYear, orderWeek, farmName, invoiceNo, awb, inputDate, fileName, items, gw, cw, rate, docFee } = req.body;
  if (!items || items.length === 0) return res.status(400).json({ success: false, error: '업로드할 데이터가 없습니다.' });

  // 품목 매칭 미리 처리 (트랜잭션 밖에서 — 조회만)
  const resolvedItems = [];
  for (const item of items) {
    let prodKey = item.prodKey;
    if (!prodKey && item.prodName) {
      const pr = await query(
        `SELECT TOP 1 ProdKey FROM Product WHERE ProdName LIKE @n AND isDeleted=0 ORDER BY LEN(ProdName)`,
        { n: { type: sql.NVarChar, value: `%${item.prodName}%` } }
      );
      prodKey = pr.recordset[0]?.ProdKey || 0;
    }
    resolvedItems.push({ ...item, prodKey });
  }

  try {
    // Master + Detail 전체를 하나의 트랜잭션으로 (진짜 원자적 롤백)
    const { warehouseKey, ok, errors } = await withTransaction(async (tQuery) => {
      const masterResult = await tQuery(
        `INSERT INTO WarehouseMaster
           (UploadDtm, FileName, OrderYear, OrderWeek, FarmName, InvoiceNo, OrderNo,
            InputDate, GrossWeight, ChargeableWeight, FreightRateUSD, DocFeeUSD,
            isDeleted, CreateID, CreateDtm)
         OUTPUT INSERTED.WarehouseKey
         VALUES (GETDATE(), @fn, @year, @week, @farm, @inv, @awb, @dt,
                 @gw, @cw, @rate, @doc,
                 0, @uid, GETDATE())`,
        {
          fn:   { type: sql.NVarChar, value: fileName || `upload_${Date.now()}` },
          year: { type: sql.NVarChar, value: orderYear || '' },
          week: { type: sql.NVarChar, value: orderWeek || '' },
          farm: { type: sql.NVarChar, value: farmName || '' },
          inv:  { type: sql.NVarChar, value: invoiceNo || '' },
          awb:  { type: sql.NVarChar, value: awb || '' },
          dt:   { type: sql.DateTime, value: inputDate ? new Date(inputDate) : new Date() },
          gw:   { type: sql.Float,    value: gw === '' || gw == null ? null : parseFloat(gw) },
          cw:   { type: sql.Float,    value: cw === '' || cw == null ? null : parseFloat(cw) },
          rate: { type: sql.Float,    value: rate === '' || rate == null ? null : parseFloat(rate) },
          doc:  { type: sql.Float,    value: docFee === '' || docFee == null ? null : parseFloat(docFee) },
          uid:  { type: sql.NVarChar, value: req.user.userId },
        }
      );
      const wk = masterResult.recordset[0].WarehouseKey;

      let successCount = 0; const errs = [];
      for (const item of resolvedItems) {
        try {
          await tQuery(
            `INSERT INTO WarehouseDetail
               (ProdKey, BoxQuantity, BunchQuantity, SteamQuantity,
                OutQuantity, EstQuantity, UPrice, TPrice, Stock,
                OrderCode, WarehouseKey, SteamOf1Box, SteamOf1Bunch)
             VALUES (@pk,@box,@bunch,@steam,@out,@est,@up,@tp,0,@oc,@wk,@s1b,@s1bh)`,
            {
              pk:   { type: sql.Int,      value: item.prodKey },
              box:  { type: sql.Float,    value: parseFloat(item.boxQty)    || 0 },
              bunch:{ type: sql.Float,    value: parseFloat(item.bunchQty)  || 0 },
              steam:{ type: sql.Float,    value: parseFloat(item.steamQty)  || 0 },
              out:  { type: sql.Float,    value: parseFloat(item.outQty)    || 0 },
              est:  { type: sql.Float,    value: parseFloat(item.estQty)    || 0 },
              up:   { type: sql.Float,    value: parseFloat(item.unitPrice) || 0 },
              tp:   { type: sql.Float,    value: parseFloat(item.totalPrice)|| 0 },
              oc:   { type: sql.NVarChar, value: item.orderCode || '' },
              wk:   { type: sql.Int,      value: wk },
              s1b:  { type: sql.Float,    value: parseFloat(item.steamOf1Box)   || 0 },
              s1bh: { type: sql.Float,    value: parseFloat(item.steamOf1Bunch) || 0 },
            }
          );
          await insertStockHistory(
            tQuery,
            orderYear || new Date().getFullYear().toString(),
            orderWeek || '',
            req.user?.userId || 'admin',
            '입고',
            item.prodKey,
            parseFloat(item.outQty) || 0,
            `입고등록 ${farmName || ''} ${invoiceNo || awb || ''}`.trim()
          );
          successCount++;
        } catch (e) {
          errs.push({ prodName: item.prodName, error: e.message });
        }
      }

      if (successCount === 0) throw new Error(`품목 매칭 실패: ${errs.map(e=>e.prodName).join(', ')}`);
      await runStockCalculation(tQuery, orderYear || new Date().getFullYear().toString(), orderWeek || '', req.user?.userId || 'admin');
      return { warehouseKey: wk, ok: successCount, errors: errs };
    });

    return res.status(201).json({
      success: true, warehouseKey,
      message: `입고 등록 완료: ${ok}/${items.length}개 품목`,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}

async function deleteWarehouse(req, res) {
  const { warehouseKey } = req.body;
  try {
    await withTransaction(async (tQuery) => {
      const info = await tQuery(
        `SELECT wm.OrderYear, wm.OrderWeek, wm.FarmName, wm.InvoiceNo, wm.OrderNo,
                wd.ProdKey, ISNULL(wd.OutQuantity,0) AS OutQuantity
           FROM WarehouseMaster wm
           JOIN WarehouseDetail wd ON wm.WarehouseKey=wd.WarehouseKey
          WHERE wm.WarehouseKey=@wk AND ISNULL(wm.isDeleted,0)=0`,
        { wk: { type: sql.Int, value: parseInt(warehouseKey) } }
      );

      await tQuery(`UPDATE WarehouseMaster SET isDeleted=1 WHERE WarehouseKey=@wk`,
        { wk: { type: sql.Int, value: parseInt(warehouseKey) } });

      const first = info.recordset[0];
      for (const row of info.recordset) {
        await insertStockHistory(
          tQuery,
          row.OrderYear || new Date().getFullYear().toString(),
          row.OrderWeek || '',
          req.user?.userId || 'admin',
          '입고삭제',
          row.ProdKey,
          -Number(row.OutQuantity || 0),
          `입고삭제 ${row.FarmName || ''} ${row.InvoiceNo || row.OrderNo || ''}`.trim()
        );
      }
      if (first) {
        await runStockCalculation(tQuery, first.OrderYear || new Date().getFullYear().toString(), first.OrderWeek || '', req.user?.userId || 'admin');
      }
    });
    return res.status(200).json({ success: true, message: '원장 삭제 완료' });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}

async function insertStockHistory(tQuery, orderYear, orderWeek, uid, changeType, prodKey, delta, descr) {
  if (!prodKey || !delta) return;
  const beforeResult = await tQuery(
    `SELECT ISNULL(Stock,0) AS Stock FROM Product WHERE ProdKey=@pk`,
    { pk: { type: sql.Int, value: prodKey } }
  );
  const before = Number(beforeResult.recordset[0]?.Stock || 0);
  const after = before + Number(delta || 0);
  await tQuery(
    `INSERT INTO StockHistory
       (ChangeDtm, OrderYear, OrderWeek, ChangeID, ChangeType, ColumName,
        BeforeValue, AfterValue, Descr, ProdKey)
     VALUES (GETDATE(), @year, @week, @uid, @type, N'재고수량',
        @before, @after, @descr, @pk)`,
    {
      year:   { type: sql.NVarChar, value: String(orderYear) },
      week:   { type: sql.NVarChar, value: orderWeek || '' },
      uid:    { type: sql.NVarChar, value: uid || 'admin' },
      type:   { type: sql.NVarChar, value: changeType },
      before: { type: sql.Float,    value: before },
      after:  { type: sql.Float,    value: after },
      descr:  { type: sql.NVarChar, value: descr || '' },
      pk:     { type: sql.Int,      value: prodKey },
    }
  );
}

async function runStockCalculation(tQuery, orderYear, orderWeek, uid) {
  await tQuery(
    stockCalculationSql(),
    {
      year: { type: sql.NVarChar, value: String(orderYear) },
      week: { type: sql.NVarChar, value: orderWeek || '' },
      uid:  { type: sql.NVarChar, value: uid || 'admin' },
    }
  );
}

function stockCalculationSql() {
  return `IF EXISTS (
            SELECT 1 FROM sys.parameters
             WHERE object_id = OBJECT_ID(N'dbo.usp_StockCalculation')
               AND name = N'@oResult'
          )
          BEGIN
            DECLARE @r INT, @m NVARCHAR(MAX);
            EXEC dbo.usp_StockCalculation
                 @OrderYear = @year,
                 @OrderWeek = @week,
                 @iUserID   = @uid,
                 @oResult   = @r OUTPUT,
                 @oMessage  = @m OUTPUT;
            SELECT @r AS result, @m AS message;
          END
          ELSE
          BEGIN
            EXEC dbo.usp_StockCalculation
                 @OrderYear = @year,
                 @OrderWeek = @week,
                 @iUserID   = @uid;
          END`;
}
