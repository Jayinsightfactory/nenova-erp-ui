// pages/api/warehouse/index.js
import { query, withTransaction, sql } from '../../../lib/db';
import { withAuth } from '../../../lib/auth';
import { useExeParityFlag } from '../../../lib/exeParity/common.js';
import { sqlWarehouseViewGetData } from '../../../lib/exeWarehouseViewSql.js';
import { isAdminUser } from '../../../lib/userAccess.js';
import { resolveWarehouseProducts, validateWarehouseUploadInput, WAREHOUSE_STAGE_GUARD_SQL, warehouseExpectedQuantity, warehouseFixedCategories, warehouseDuplicateUploads } from '../../../lib/warehouseProductMatching.js';

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
  if (!canManageWarehouse(req.user)) {
    return res.status(403).json({ success: false, code: 'WAREHOUSE_WRITE_FORBIDDEN', error: '입고 원장 수정은 관리자 또는 수입부 계정만 가능합니다.' });
  }
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
    return res.status(err.code === 'WAREHOUSE_WEEK_FIXED' ? 409 : 500).json({ success: false, code: err.code, error: err.message });
  }
}

async function getWarehouse(req, res) {
  const { startDate, endDate, exeParity } = req.query;
  const useExe = useExeParityFlag(exeParity);

  try {
    if (useExe && startDate && endDate) {
      const result = await query(sqlWarehouseViewGetData(), {
        startDate: { type: sql.Date, value: new Date(startDate) },
        endDate: { type: sql.Date, value: new Date(endDate) },
      });
      return res.status(200).json({ success: true, source: 'real_db_exe_parity', masters: result.recordset });
    }

    let where = 'WHERE wm.isDeleted = 0';
    const params = {};
    if (startDate) { where += ' AND CAST(wm.InputDate AS DATE) >= @start'; params.start = { type: sql.NVarChar, value: startDate }; }
    if (endDate)   { where += ' AND CAST(wm.InputDate AS DATE) <= @end';   params.end   = { type: sql.NVarChar, value: endDate }; }

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
  const { orderYear, orderWeek, farmName, invoiceNo, awb, inputDate, fileName, items, gw, cw, rate, docFee } = req.body || {};
  const inputErrors = validateWarehouseUploadInput(req.body || {});
  if (inputErrors.length) return res.status(400).json({ success: false, code: 'WAREHOUSE_INPUT_INVALID', error: '입고 입력값을 확인하세요. 저장하지 않았습니다.', errors: inputErrors });
  if (!/^\d{4}$/.test(String(orderYear || '')) || !/^\d{2}-\d{2}$/.test(String(orderWeek || ''))) {
    return res.status(400).json({ success: false, code: 'ORDER_YEAR_WEEK_REQUIRED', error: '입고 저장에는 화면의 선택 연도와 세부차수가 필요합니다.' });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(inputDate || '')) || Number.isNaN(new Date(`${inputDate}T00:00:00`).getTime())) {
    return res.status(400).json({ success: false, code: 'WAREHOUSE_INPUT_DATE_REQUIRED', error: '관세청 과세환율 기준이 되는 실제 입고·신고일자를 입력하세요.' });
  }
  if (!canManageWarehouse(req.user)) {
    return res.status(403).json({ success: false, code: 'WAREHOUSE_WRITE_FORBIDDEN', error: '입고 등록은 관리자 또는 수입부 계정만 가능합니다.' });
  }

  try {
    const warehouseKey = await withTransaction(async (tQuery) => {
      const lock = await tQuery(
        `DECLARE @lockResult INT;
         EXEC @lockResult=sys.sp_getapplock @Resource=N'Nenova.TempWarehouseDetail', @LockMode=N'Exclusive', @LockOwner=N'Transaction', @LockTimeout=15000;
         SELECT @lockResult AS lockResult;`, {}
      );
      if (Number(lock.recordset[0]?.lockResult) < 0) throw new Error('다른 입고 업로드가 처리 중입니다. 잠시 후 다시 시도하세요.');

      await tQuery(WAREHOUSE_STAGE_GUARD_SQL, {});
      const matched = await resolveWarehouseProducts(tQuery, sql, items, { lock: true });
      if (!matched.valid) {
        const error = new Error('품목 검증에 실패하여 파일 전체를 저장하지 않았습니다. 다시 매칭하세요.');
        error.code = 'WAREHOUSE_PRODUCT_VALIDATION_FAILED';
        error.errors = matched.errors;
        throw error;
      }
      const resolvedItems = matched.items;
      await assertWarehouseWeekEditable(tQuery, orderYear, orderWeek, resolvedItems.map((item) => item.countryFlower), true);
      const duplicate = await warehouseDuplicateUploads(tQuery, sql, req.body, true);
      if (duplicate.length) {
        const error = new Error(`같은 파일의 활성 입고 원장(${duplicate.map(row => row.WarehouseKey).join(', ')})이 있습니다. 중복 등록하지 않았습니다. 기존 원장을 먼저 확인하세요.`);
        error.code = 'WAREHOUSE_DUPLICATE_UPLOAD'; throw error;
      }
      const nextKey = await tQuery(`DECLARE @key INT, @rc INT;
        EXEC @rc=dbo.usp_GetNextKey @iCategory=N'WarehouseKey', @oNextKey=@key OUTPUT;
        IF ISNULL(@rc,-1)<>0 OR ISNULL(@key,0)<=0 THROW 51004, N'입고 원장 채번에 실패했습니다.', 1;
        IF EXISTS (SELECT 1 FROM WarehouseMaster WHERE WarehouseKey=@key) THROW 51004, N'입고 원장 채번이 충돌했습니다. 관리자에게 확인하세요.', 1;
        SELECT @key AS WarehouseKey;`, {});
      const wk = nextKey.recordset[0].WarehouseKey;

      await tQuery(
        `INSERT INTO WarehouseMaster
           (WarehouseKey, UploadDtm, FileName, OrderYear, OrderWeek, FarmName, InvoiceNo, OrderNo,
            InputDate, GrossWeight, ChargeableWeight, FreightRateUSD, DocFeeUSD,
            isDeleted, CreateID, CreateDtm)
         OUTPUT INSERTED.WarehouseKey
         VALUES (@wk, GETDATE(), @fn, @year, @week, @farm, @inv, @awb, @dt,
                 @gw, @cw, @rate, @doc,
                 0, @uid, GETDATE())`,
        {
          wk: { type: sql.Int, value: wk },
          fn:   { type: sql.NVarChar, value: fileName || `upload_${Date.now()}` },
          year: { type: sql.NVarChar, value: orderYear || '' },
          week: { type: sql.NVarChar, value: orderWeek || '' },
          farm: { type: sql.NVarChar, value: farmName || '' },
          inv:  { type: sql.NVarChar, value: invoiceNo || '' },
          awb:  { type: sql.NVarChar, value: awb || '' },
          dt:   { type: sql.DateTime, value: new Date(`${inputDate}T00:00:00`) },
          gw:   { type: sql.Float,    value: gw === '' || gw == null ? null : parseFloat(gw) },
          cw:   { type: sql.Float,    value: cw === '' || cw == null ? null : parseFloat(cw) },
          rate: { type: sql.Float,    value: rate === '' || rate == null ? null : parseFloat(rate) },
          doc:  { type: sql.Float,    value: docFee === '' || docFee == null ? null : parseFloat(docFee) },
          uid:  { type: sql.NVarChar, value: req.user.userId },
        }
      );
      // Guard above proves all old staging rows have already been consumed by EXE.
      await tQuery('DELETE FROM TempWarehouseDetail', {});
      for (const item of resolvedItems) {
        await tQuery(
            `INSERT INTO TempWarehouseDetail
               (ProdName, BoxQuantity, BunchQuantity, SteamQuantity,
                SteamOf1Box, SteamOf1Bunch, UPrice, TPrice, OrderCode, WarehouseKey)
             VALUES (@name,@box,@bunch,@steam,@s1b,@s1bh,@up,@tp,@oc,@wk)`,
            {
              name: { type: sql.NVarChar, value: item.prodName },
              box:  { type: sql.Float,    value: parseFloat(item.boxQty)    || 0 },
              bunch:{ type: sql.Float,    value: parseFloat(item.bunchQty)  || 0 },
              steam:{ type: sql.Float,    value: parseFloat(item.steamQty)  || 0 },
              up:   { type: sql.Float,    value: parseFloat(item.unitPrice) || 0 },
              tp:   { type: sql.Float,    value: parseFloat(item.totalPrice)|| 0 },
              oc:   { type: sql.NVarChar, value: item.orderCode || '' },
              wk:   { type: sql.Int,      value: wk },
              s1b:  { type: sql.Float,    value: parseFloat(item.steamOf1Box)   || 0 },
              s1bh: { type: sql.Float,    value: parseFloat(item.steamOf1Bunch) || 0 },
            }
        );
      }

      const created = await tQuery(
        `DECLARE @result INT;
         EXEC dbo.usp_CreateWarehouse @iUserID=@uid, @oResult=@result OUTPUT;
         IF ISNULL(@result,-1)<>0 THROW 51000, N'usp_CreateWarehouse 처리에 실패했습니다.', 1;
         SELECT @result AS result;`,
        { uid: { type: sql.VarChar, value: String(req.user?.userId || 'admin').slice(0, 20) } }
      );
      if (Number(created.recordset[0]?.result) !== 0) throw new Error('usp_CreateWarehouse 처리에 실패했습니다.');
      const saved = await tQuery(`SELECT ProdKey, BoxQuantity, BunchQuantity, SteamQuantity, OutQuantity, EstQuantity,
          SteamOf1Box, SteamOf1Bunch, UPrice, TPrice, OrderCode FROM WarehouseDetail WHERE WarehouseKey=@wk ORDER BY WdetailKey`,
        { wk: { type: sql.Int, value: wk } });
      // Multiset check (the SP need not preserve insertion ordering).
      const actual = saved.recordset.map(row => JSON.stringify([Number(row.ProdKey), ...['BoxQuantity','BunchQuantity','SteamQuantity','OutQuantity','EstQuantity','SteamOf1Box','SteamOf1Bunch','UPrice','TPrice'].map(field => Number(row[field] || 0)), row.OrderCode || ''])).sort();
      const expected = resolvedItems.map(item => JSON.stringify([Number(item.prodKey), Number(item.boxQty || 0), Number(item.bunchQty || 0), Number(item.steamQty || 0), warehouseExpectedQuantity(item, item.outUnit), warehouseExpectedQuantity(item, item.estUnit), Number(item.steamOf1Box || 0), Number(item.steamOf1Bunch || 0), Number(item.unitPrice || 0), Number(item.totalPrice || 0), item.orderCode || ''])).sort();
      if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error('EXE 입고 저장 결과가 검증 수량·품목과 달라 전체 저장을 취소했습니다.');
      await runStockCalculation(tQuery, orderYear, orderWeek, req.user?.userId || 'admin', [0]);
      await tQuery('DELETE FROM TempWarehouseDetail WHERE WarehouseKey=@wk', { wk: { type: sql.Int, value: wk } });
      return wk;
    });

    return res.status(201).json({
      success: true, warehouseKey,
      message: `입고 등록 완료: ${items.length}/${items.length}개 품목`,
    });
  } catch (err) {
    return res.status(err.code?.startsWith('WAREHOUSE_') ? 409 : 500).json({ success: false, code: err.code, error: err.message, errors: err.errors || [] });
  }
}

async function deleteWarehouse(req, res) {
  const { warehouseKey } = req.body;
  if (!Number.isInteger(Number(warehouseKey)) || Number(warehouseKey) <= 0) {
    return res.status(400).json({ success: false, error: 'warehouseKey 필수' });
  }
  if (!canManageWarehouse(req.user)) {
    return res.status(403).json({ success: false, code: 'WAREHOUSE_WRITE_FORBIDDEN', error: '입고 원장 삭제는 관리자 또는 수입부 계정만 가능합니다.' });
  }
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

      if (!info.recordset.length) throw new Error('삭제할 입고 원장을 찾을 수 없습니다.');
      await assertWarehouseWeekEditable(tQuery, info.recordset[0].OrderYear, info.recordset[0].OrderWeek);

      await tQuery(`UPDATE WarehouseMaster SET isDeleted=1 WHERE WarehouseKey=@wk`,
        { wk: { type: sql.Int, value: parseInt(warehouseKey) } });

      const first = info.recordset[0];
      if (info.recordset.some((row) => !/^\d{4}$/.test(String(row.OrderYear || '')) || !row.OrderWeek)) {
        throw new Error('삭제 대상 입고 원장의 연도/차수가 없어 재고 재계산 범위를 확정할 수 없습니다.');
      }
      if (first) {
        await runStockCalculation(tQuery, first.OrderYear, first.OrderWeek, req.user?.userId || 'admin', [0]);
      }
    });
    return res.status(200).json({ success: true, message: '원장 삭제 완료' });
  } catch (err) {
    return res.status(err.code === 'WAREHOUSE_WEEK_FIXED' ? 409 : 500).json({ success: false, code: err.code, error: err.message });
  }
}

function canManageWarehouse(user) {
  return isAdminUser(user) || /수입/.test(String(user?.deptName ?? user?.DeptName ?? ''));
}

async function assertWarehouseWeekEditable(tQuery, orderYear, orderWeek, countryFlowers = null, neighbors = false) {
  const fixed = await warehouseFixedCategories(tQuery, sql, orderYear, orderWeek, countryFlowers, { lock: true, neighbors });
  if (fixed.length) {
    const error = new Error(`EXE 확정 순서 확인이 필요합니다: ${fixed.map(row => `${row.OrderYear}/${row.OrderWeek} ${row.CountryFlower} ${row.Reason}`).join(', ')}. 해당 확정 상태를 정리한 뒤 재검증하세요.`);
    error.code = 'WAREHOUSE_WEEK_FIXED';
    throw error;
  }
}

async function runStockCalculation(tQuery, orderYear, orderWeek, uid, prodKeys = []) {
  const keys = [...new Set((prodKeys || []).map(Number).filter((key) => Number.isInteger(key) && key >= 0))];
  for (const prodKey of keys) {
    await tQuery(
      stockCalculationSql(),
      {
        year: { type: sql.NVarChar, value: String(orderYear) },
        week: { type: sql.NVarChar, value: orderWeek || '' },
        uid:  { type: sql.NVarChar, value: uid || 'admin' },
        pk:   { type: sql.Int, value: prodKey },
      }
    );
  }
}

function stockCalculationSql() {
  return `IF EXISTS (
            SELECT 1 FROM sys.parameters
             WHERE object_id = OBJECT_ID(N'dbo.usp_StockCalculation')
               AND name = N'@oResult'
          )
          BEGIN
            DECLARE @r INT, @m NVARCHAR(MAX), @rc INT;
            EXEC @rc=dbo.usp_StockCalculation
                 @OrderYear = @year,
                 @OrderWeek = @week,
                 @ProdKey   = @pk,
                 @iUserID   = @uid,
                 @oResult   = @r OUTPUT,
                 @oMessage  = @m OUTPUT;
            IF ISNULL(@r,-1)<>0 THROW 51001, N'usp_StockCalculation 처리에 실패했습니다.', 1;
            IF ISNULL(@rc,-1)<>0 THROW 51001, N'usp_StockCalculation 반환값이 실패입니다.', 1;
            SELECT @r AS result, @m AS message;
          END
          ELSE
          BEGIN
            EXEC dbo.usp_StockCalculation
                 @OrderYear = @year,
                 @OrderWeek = @week,
                 @ProdKey   = @pk,
                 @iUserID   = @uid;
          END`;
}
