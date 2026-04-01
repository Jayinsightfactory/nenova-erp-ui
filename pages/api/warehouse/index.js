// pages/api/warehouse/index.js
import { query, sql } from '../../../lib/db';
import { withAuth } from '../../../lib/auth';

export default withAuth(async function handler(req, res) {
  if (req.method === 'GET')  return await getWarehouse(req, res);
  if (req.method === 'POST') return await uploadWarehouse(req, res);
  if (req.method === 'DELETE') return await deleteWarehouse(req, res);
  return res.status(405).end();
});

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
        SUM(wd.BoxQuantity)   AS totalBox,
        SUM(wd.BunchQuantity) AS totalBunch,
        SUM(wd.SteamQuantity) AS totalSteam
       FROM WarehouseMaster wm
       LEFT JOIN WarehouseDetail wd ON wm.WarehouseKey = wd.WarehouseKey
       ${where}
       GROUP BY wm.WarehouseKey, wm.OrderYear, wm.OrderWeek, wm.FarmName,
                wm.InvoiceNo, wm.OrderNo, wm.InputDate, wm.FileName
       ORDER BY wm.InputDate DESC, wm.WarehouseKey DESC`,
      params
    );
    return res.status(200).json({ success: true, source: 'real_db', masters: masterResult.recordset });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}

async function uploadWarehouse(req, res) {
  const { orderYear, orderWeek, farmName, invoiceNo, awb, inputDate, fileName, items } = req.body;
  if (!items || items.length === 0) return res.status(400).json({ success: false, error: '업로드할 데이터가 없습니다.' });

  try {
    const masterResult = await query(
      `INSERT INTO WarehouseMaster
         (UploadDtm, FileName, OrderYear, OrderWeek, FarmName, InvoiceNo, OrderNo,
          InputDate, isDeleted, CreateID, CreateDtm)
       OUTPUT INSERTED.WarehouseKey
       VALUES (GETDATE(), @fn, @year, @week, @farm, @inv, @awb, @dt, 0, @uid, GETDATE())`,
      {
        fn:   { type: sql.NVarChar, value: fileName || `upload_${Date.now()}` },
        year: { type: sql.NVarChar, value: orderYear || '' },
        week: { type: sql.NVarChar, value: orderWeek || '' },
        farm: { type: sql.NVarChar, value: farmName || '' },
        inv:  { type: sql.NVarChar, value: invoiceNo || '' },
        awb:  { type: sql.NVarChar, value: awb || '' },
        dt:   { type: sql.DateTime, value: inputDate ? new Date(inputDate) : new Date() },
        uid:  { type: sql.NVarChar, value: req.user.userId },
      }
    );
    const warehouseKey = masterResult.recordset[0].WarehouseKey;

    let ok = 0; const errors = [];
    for (const item of items) {
      try {
        let prodKey = item.prodKey;
        if (!prodKey && item.prodName) {
          const pr = await query(
            `SELECT TOP 1 ProdKey FROM Product WHERE ProdName LIKE @n AND isDeleted=0 ORDER BY LEN(ProdName)`,
            { n: { type: sql.NVarChar, value: `%${item.prodName}%` } }
          );
          prodKey = pr.recordset[0]?.ProdKey || 0;
        }
        await query(
          `INSERT INTO WarehouseDetail
             (ProdKey, BoxQuantity, BunchQuantity, SteamQuantity,
              OutQuantity, EstQuantity, UPrice, TPrice, Stock,
              OrderCode, WarehouseKey, SteamOf1Box, SteamOf1Bunch)
           VALUES (@pk,@box,@bunch,@steam,@out,@est,@up,@tp,0,@oc,@wk,@s1b,@s1bh)`,
          {
            pk:   { type: sql.Int,      value: prodKey },
            box:  { type: sql.Float,    value: parseFloat(item.boxQty)   || 0 },
            bunch:{ type: sql.Float,    value: parseFloat(item.bunchQty) || 0 },
            steam:{ type: sql.Float,    value: parseFloat(item.steamQty) || 0 },
            out:  { type: sql.Float,    value: parseFloat(item.outQty)   || 0 },
            est:  { type: sql.Float,    value: parseFloat(item.estQty)   || 0 },
            up:   { type: sql.Float,    value: parseFloat(item.unitPrice)|| 0 },
            tp:   { type: sql.Float,    value: parseFloat(item.totalPrice)||0 },
            oc:   { type: sql.NVarChar, value: item.orderCode || '' },
            wk:   { type: sql.Int,      value: warehouseKey },
            s1b:  { type: sql.Float,    value: parseFloat(item.steamOf1Box)  || 0 },
            s1bh: { type: sql.Float,    value: parseFloat(item.steamOf1Bunch)|| 0 },
          }
        );
        ok++;
      } catch (e) { errors.push({ prodName: item.prodName, error: e.message }); }
    }

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
    await query(`UPDATE WarehouseMaster SET isDeleted=1 WHERE WarehouseKey=@wk`,
      { wk: { type: sql.Int, value: parseInt(warehouseKey) } });
    return res.status(200).json({ success: true, message: '원장 삭제 완료' });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}
