// pages/api/warehouse/index.js
import { query, withTransaction, sql } from '../../../lib/db';
import { withAuth } from '../../../lib/auth';
import { useExeParityFlag } from '../../../lib/exeParity/common.js';
import { sqlWarehouseViewGetData, WAREHOUSE_DETAIL_COST_COLUMNS_SQL, WAREHOUSE_DOCUMENT_FREIGHT_APPLY_SQL } from '../../../lib/exeWarehouseViewSql.js';
import { acquireInvoiceReceiptGate, nextInvoiceWarehouseKey, calculateInvoiceStock, insertInvoiceWarehouseDetail, applyInvoiceWarehouseStockDelta } from '../../../lib/invoiceReceiptNative.js';
import { resolveReceiptBunch } from '../../../lib/receiptBunchQuantity.js';
import { WAREHOUSE_WEIGHT_ROW_SQL } from '../../../lib/warehouseWeightRows.js';
import { canManageInvoiceReceipt } from '../../../lib/invoiceReceiptAccess.js';
import { manualWarehouseHeader, manualWarehouseLine, isManualWarehouseAllowedAccount } from '../../../lib/manualWarehouseUpload.js';
import { assertManualWarehouseEligible, readManualWarehouseAttempt } from '../../../lib/manualWarehouseUploadDb.js';
import { warehouseFarmChoicesSql } from '../../../lib/warehouseFarmChoices.js';
import { splitIncomingRound } from '../../../lib/incomingRoundLabel.js';
import { approvalPermissions } from '../../../lib/incomingApprovalPolicy.js';
import { attachWarehouseRoundLabels, recordWarehouseRoundLabel } from '../../../lib/warehouseDetailActions.js';
import { isMatchingDuplicateWarehouseRow } from '../../../lib/packingDuplicateCheck.js';
import { withActionLog } from '../../../lib/withActionLog.js';

// 2026-11-26: 입고 쓰기(POST/PATCH/DELETE)를 SystemActionLog에 남긴다. GET은 기록하지 않는다.
export default withAuth(withActionLog(async function handler(req, res) {
  if (req.method === 'GET')  return req.query.manualOptions === '1' ? await getManualOptions(req,res) : await getWarehouse(req, res);
  if (req.method === 'POST') return await uploadWarehouse(req, res);
  if (req.method === 'PATCH') return await patchFreight(req, res);
  if (req.method === 'DELETE') return await deleteWarehouse(req, res);
  return res.status(405).end();
}, { actionType: 'WAREHOUSE_WRITE', affectedTable: 'WarehouseMaster/WarehouseDetail', riskLevel: 'HIGH' }));

// 함수 선언만 사용한다(모듈 상단 export default 뒤에 선언돼도 호이스팅으로 안전).
function warehouseErrorText(code) {
  return ({
    DUPLICATE_INVOICE: '같은 연도·차수·농장·송장번호의 입고가 이미 있습니다. 입고관리 목록에서 기존 입고를 확인하세요.',
    WAREHOUSE_WEEK_FIXED: '이 차수는 출고 확정되어 입고를 변경할 수 없습니다. 출고 확정 취소 후 다시 시도하세요.',
    WAREHOUSE_OPERATION_CONFLICT: '같은 요청 번호로 다른 사용자 또는 삭제된 입고가 있습니다. 화면을 새로 열어 다시 시도하세요.',
  })[code] || '';
}

/** 빈 오류 문구를 보내지 않는다. DB 원문이 비어 있으면 쉬운 한국어 안내로 바꾼다. */
function warehouseErrorMessage(err, fallback = '입고 처리 중 문제가 발생했습니다. 입력값을 확인하고 다시 시도하세요.') {
  const message = String(err?.message ?? '').trim();
  if (message) return message;
  if (err?.code && warehouseErrorText(err.code)) return warehouseErrorText(err.code);
  if (Number.isInteger(err?.number)) return `전산 DB 처리 중 오류가 발생했습니다(오류 번호 ${err.number}). 잠시 후 다시 시도하고 계속되면 수입부 관리자에게 알려 주세요.`;
  return fallback;
}

/** 화면 요청 번호(operationId)는 FileName 접두어로 남겨 같은 요청의 이중 입고를 막는다(스키마 변경 없음). */
function packingOperationPrefix(operationId) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(operationId || '')) ? `visual-${String(operationId).toLowerCase()}-` : '';
}

async function readPackingOperation(tQuery, prefix, actor, locked = false) {
  if (!prefix) return null;
  const hint = locked ? 'WITH (UPDLOCK,HOLDLOCK)' : '';
  const { recordset } = await tQuery(`/* warehouse:packing-operation */
    SELECT WarehouseKey, FileName, CreateID, isDeleted FROM dbo.WarehouseMaster ${hint}
    WHERE LEFT(FileName,LEN(@filePrefix))=@filePrefix`, { filePrefix: { type: sql.NVarChar, value: prefix } });
  if (!recordset?.length) return null;
  const prior = recordset[0];
  if (recordset.length !== 1 || prior.isDeleted || String(prior.CreateID) !== String(actor)) {
    throw Object.assign(new Error(warehouseErrorText('WAREHOUSE_OPERATION_CONFLICT')), { statusCode: 409, code: 'WAREHOUSE_OPERATION_CONFLICT' });
  }
  return Number(prior.WarehouseKey);
}

/** 미리보기(잠금 없음)와 본 저장(잠금)이 같은 중복 판정 함수를 쓴다. */
async function findDuplicateWarehouseReceipt(tQuery, { orderYear, orderWeek, farmName, invoiceNo }, locked = false) {
  const invoice = String(invoiceNo ?? '').trim();
  if (!invoice) return null;
  const hint = locked ? 'WITH (UPDLOCK,HOLDLOCK)' : '';
  const previous = await tQuery(`SELECT WarehouseKey, FarmName, InvoiceNo FROM dbo.WarehouseMaster ${hint}
    WHERE OrderYear=@year AND OrderWeek=@week AND ISNULL(isDeleted,0)=0`, {
    year: { type: sql.NVarChar, value: String(orderYear) },
    week: { type: sql.NVarChar, value: String(orderWeek) },
  });
  return (previous.recordset || []).find(row =>
    isMatchingDuplicateWarehouseRow(row, { farmName: String(farmName ?? '').trim(), invoiceNo: invoice })) || null;
}

function duplicateError(duplicate) {
  return Object.assign(new Error(`같은 연도·차수·농장·인보이스의 입고(#${duplicate.WarehouseKey})가 이미 있습니다. 원장에서 기존 입고를 확인하세요.`),
    { statusCode: 409, code: 'DUPLICATE_INVOICE', warehouseKey: duplicate.WarehouseKey });
}

const MANUAL_OPTIONS_TTL_MS = 5 * 60 * 1000;
const manualOptionsCache = new WeakMap();

function mayManualUpload(user) {
  if (canManageInvoiceReceipt(user)) return true;
  return typeof isManualWarehouseAllowedAccount === 'function' && isManualWarehouseAllowedAccount(user);
}

async function getManualOptions(req,res) {
  if (!mayManualUpload(req.user)) return res.status(403).json({success:false,error:'입고 등록 권한이 없습니다.'});
  const now = Date.now();
  const forceRefresh = req.query?.refresh === '1';
  const cached = !forceRefresh ? manualOptionsCache.get(query) : null;
  if (cached && cached.expiresAt > now) {
    return res.status(200).json(cached.payload);
  }
  try {
    const [farms,periods,recentManual,farmCountries] = await Promise.all([
      query(warehouseFarmChoicesSql({activeOnly:true})),
      query(`SELECT DISTINCT OrderYear,OrderWeek FROM dbo.StockMaster
        WHERE OrderYear>=N'2026' ORDER BY OrderYear DESC,OrderWeek DESC`),
      Promise.resolve(query(`SELECT TOP 40 LTRIM(RTRIM(wm.FarmName)) AS FarmName, COUNT(*) AS UseCount, MAX(wm.WarehouseKey) AS LastWarehouseKey
        FROM dbo.WarehouseMaster wm
        WHERE ISNULL(wm.isDeleted,0)=0 AND wm.FileName LIKE N'manual-%' AND NULLIF(LTRIM(RTRIM(wm.FarmName)),N'') IS NOT NULL
        GROUP BY LTRIM(RTRIM(wm.FarmName))
        ORDER BY COUNT(*) DESC, MAX(wm.WarehouseKey) DESC`)).catch(() => ({ recordset: [] })),
      Promise.resolve(query(`SELECT f.FarmKey, LTRIM(RTRIM(c.CounName)) AS CounName
        FROM dbo.Farm f LEFT JOIN dbo.Country c ON c.CounKey=f.CounKey
        WHERE f.isDeleted=0`)).catch(() => ({ recordset: [] })),
    ]);
    const countryByFarmKey = new Map();
    for (const row of farmCountries?.recordset ?? []) {
      const counName = String(row?.CounName ?? '').trim();
      if (row?.FarmKey != null && counName) countryByFarmKey.set(Number(row.FarmKey), counName);
    }
    const activeFarmNames = new Set();
    const enrichedFarms = (farms.recordset ?? []).map(row => {
      const farmName = String(row?.FarmName ?? '').trim();
      if (farmName) activeFarmNames.add(farmName);
      const counName = row?.FarmKey != null ? countryByFarmKey.get(Number(row.FarmKey)) : undefined;
      return counName ? { ...row, CounName: counName } : row;
    });
    const recentManualFarms = (recentManual?.recordset ?? [])
      .filter(row => row?.FarmName && activeFarmNames.has(String(row.FarmName).trim()))
      .map(row => ({
        farmName: String(row.FarmName).trim(),
        useCount: Number(row.UseCount || 0) || 0,
        lastWarehouseKey: Number(row.LastWarehouseKey || 0) || 0,
      }));
    const payload = { success: true, farms: enrichedFarms, periods: periods.recordset, recentManualFarms };
    manualOptionsCache.set(query, { expiresAt: now + MANUAL_OPTIONS_TTL_MS, payload });
    return res.status(200).json(payload);
  } catch {
    return res.status(503).json({success:false,error:'등록 농장 또는 차수를 불러오지 못했습니다.'});
  }
}

async function patchFreight(req, res) {
  const { warehouseKey, gw, cw, rate, docFee } = req.body;
  if (!warehouseKey) return res.status(400).json({ success:false, error:'warehouseKey 필수' });
  if (!canManageInvoiceReceipt(req.user)) {
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
    return res.status(err.code === 'WAREHOUSE_WEEK_FIXED' ? 409 : 500).json({ success: false, code: err.code, error: warehouseErrorMessage(err) });
  }
}

async function getWarehouse(req, res) {
  const { startDate, endDate, exeParity } = req.query;
  const useExe = useExeParityFlag(exeParity);
  const labelsRequested=req.query.roundLabels==='1';
  const mayEdit=canManageInvoiceReceipt(req.user);
  const detailAccess=labelsRequested?{canEditDetail:mayEdit,canReadDetailHistory:mayEdit||approvalPermissions(req.user).review,canManualUpload:mayManualUpload(req.user)}:{};

  try {
    if (useExe && startDate && endDate) {
      const result = await query(sqlWarehouseViewGetData({goodsTotals:req.query.goodsTotals === '1'}), {
        startDate: { type: sql.Date, value: new Date(startDate) },
        endDate: { type: sql.Date, value: new Date(endDate) },
      });
      return res.status(200).json({ success: true, source: 'real_db_exe_parity', ...detailAccess, masters: labelsRequested ? await attachWarehouseRoundLabels(query,sql,result.recordset) : result.recordset });
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
        wd.DetailGrossWeight, wd.DetailChargeableWeight, wd.DetailFreightAmount,
        goodsOrigin.GoodsCountry,
        orphanWeight.OrphanGrossWeight, orphanWeight.OrphanChargeableWeight,
        invoiceDoc.DocAction, invoiceDoc.DocCountry, invoiceDoc.DocSourceHash, invoiceDoc.DocGrossWeight, invoiceDoc.DocChargeableWeight,
        invoiceDoc.DocFreightAmount, invoiceDoc.DocFreightCurrency,
        wd.totalBox, wd.totalBunch, wd.totalSteam
       FROM WarehouseMaster wm
       LEFT JOIN (
         SELECT wd.WarehouseKey,
           SUM(CASE WHEN wd.IsWeightRow=0 THEN wd.BoxQuantity END)   AS totalBox,
           SUM(CASE WHEN wd.IsWeightRow=0 THEN wd.BunchQuantity END) AS totalBunch,
           SUM(CASE WHEN wd.IsWeightRow=0 THEN wd.SteamQuantity END) AS totalSteam,${WAREHOUSE_DETAIL_COST_COLUMNS_SQL}
         FROM (SELECT wd.*, CONVERT(bit, CASE WHEN ${WAREHOUSE_WEIGHT_ROW_SQL} THEN 1 ELSE 0 END) AS IsWeightRow FROM WarehouseDetail wd) wd
         GROUP BY wd.WarehouseKey
       ) wd ON wm.WarehouseKey = wd.WarehouseKey${WAREHOUSE_DOCUMENT_FREIGHT_APPLY_SQL}
       ${where}
       ORDER BY wm.InputDate DESC, wm.WarehouseKey DESC`,
      params
    );
    return res.status(200).json({ success: true, source: 'real_db', ...detailAccess, masters: labelsRequested ? await attachWarehouseRoundLabels(query,sql,masterResult.recordset) : masterResult.recordset });
  } catch (err) {
    return res.status(500).json({ success: false, error: warehouseErrorMessage(err, '입고 목록을 불러오지 못했습니다. 잠시 후 다시 조회하세요.') });
  }
}

function warehouseRowBunch(item, product) {
  return resolveReceiptBunch(product, {boxQuantity:item.boxQty, bunchQuantity:item.bunchQty,
    stemQuantity:item.steamQty, stemsPerBunch:item.steamOf1Bunch, stemsPerBox:item.steamOf1Box, legacyWorkbook:true,
    confirmation:item.bunchConfirmation, scopeKey:item.bunchScope});
}

async function uploadWarehouse(req, res) {
  const body = req.body ?? {};
  const manual = body.source === 'manual';
  let manualMeta;
  if (manual) {
    try { manualMeta = manualWarehouseHeader(body); }
    catch (error) { return res.status(400).json({success:false,code:error.code,error:error.message}); }
  }
  const { orderYear, orderWeek:rawRound, farmName, invoiceNo, awb, inputDate } = manualMeta ?? body;
  const {orderWeek, suffix:roundSuffix}=splitIncomingRound(rawRound)??{};
  const { fileName, sourceWorkbookHash, items, gw, cw, rate, docFee } = body;
  if (!Array.isArray(items) || items.length === 0) return res.status(400).json({ success: false, error: '업로드할 데이터가 없습니다.' });
  if (!/^\d{4}$/.test(String(orderYear || '')) || !/^\d{2}-\d{2}$/.test(String(orderWeek || ''))) {
    return res.status(400).json({ success: false, code: 'ORDER_YEAR_WEEK_REQUIRED', error: '입고 저장에는 화면의 선택 연도와 세부차수가 필요합니다.' });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(inputDate || '')) || Number.isNaN(new Date(`${inputDate}T00:00:00`).getTime())) {
    return res.status(400).json({ success: false, code: 'WAREHOUSE_INPUT_DATE_REQUIRED', error: '관세청 과세환율 기준이 되는 실제 입고·신고일자를 입력하세요.' });
  }
  const canWrite = manual ? mayManualUpload(req.user) : canManageInvoiceReceipt(req.user);
  if (!canWrite) {
    return res.status(403).json({ success: false, code: 'WAREHOUSE_WRITE_FORBIDDEN', error: '입고 등록은 관리자 또는 수입부 계정만 가능합니다.' });
  }

  // EXE CheckData와 같은 대소문자 무시 정확 일치. 요청 prodKey와 유사검색은 신뢰하지 않는다.
  const resolvedItems = [];
  const validationErrors = [];
  const bunchResolutions = {};
  for (const [index, item] of items.entries()) {
    const prodName = String(item?.prodName || '').trim();
    const row = item ?? {};
    const numericFields = ['boxQty', 'bunchQty', 'steamQty', 'steamOf1Box', 'steamOf1Bunch', 'unitPrice', 'totalPrice'];
    const badField = !manual && numericFields.find((field) => row[field] != null && row[field] !== '' && !Number.isFinite(Number(row[field])));
    const negativeQuantity = !manual && numericFields.slice(0,5).find(field => Number(row[field]) < 0);
    if (!prodName || badField || negativeQuantity) {
      validationErrors.push({ row: index + 1, prodName, error: !prodName ? '품목명이 없습니다.'
        : badField ? `${badField} 값이 숫자가 아닙니다.` : '입고 수량과 포장 기준은 0 이상이어야 합니다.' });
      continue;
    }
    const pr = await query(
      `SELECT ProdKey, CountryFlower, OutUnit, EstUnit, SteamOf1Bunch, BunchOf1Box
         FROM Product
        WHERE LOWER(LTRIM(RTRIM(ProdName)))=LOWER(@name)
          AND ISNULL(isDeleted,0)=0`,
      { name: { type: sql.NVarChar, value: prodName } }
    );
    if (pr.recordset.length !== 1) {
      validationErrors.push({ row: index + 1, prodName, error: pr.recordset.length ? '동일 품목명이 중복 등록되어 있습니다.' : '전산에 등록되지 않은 품목입니다.' });
      continue;
    }
    const product = pr.recordset[0];
    if (manual) {
      try {
        const line = manualWarehouseLine(row,product);
        resolvedItems.push({...line,prodName,prodKey:product.ProdKey,countryFlower:product.CountryFlower});
      } catch (error) {
        validationErrors.push({row:index+1,prodName,error:error.message});
      }
      continue;
    }
    const workbookScope = /^[a-f0-9]{64}$/i.test(sourceWorkbookHash || '') ? sourceWorkbookHash.toLowerCase() : fileName;
    const bunchScope = [orderYear, orderWeek, farmName, invoiceNo, inputDate, workbookScope, index];
    const resolution = warehouseRowBunch({...item,bunchScope}, product);
    if (resolution.status === 'review') {
      validationErrors.push({row:index+1,prodName,error:resolution.message,candidates:resolution.candidates,snapshot:resolution.snapshot});
      continue;
    }
    if (resolution.status === 'derived' || resolution.status === 'confirmed') {
      bunchResolutions[index] = {quantity:resolution.quantity,status:resolution.status};
    }
    resolvedItems.push({ ...item, bunchScope, prodName, prodKey: product.ProdKey, countryFlower: product.CountryFlower,
      previewBunchQuantity: resolution.quantity ?? item.bunchQty });
  }
  if (validationErrors.length || resolvedItems.length !== items.length) {
    return res.status(400).json({ success: false, code: 'WAREHOUSE_PRODUCT_VALIDATION_FAILED', error: '확인이 필요한 품목이 있습니다.',
      errors: validationErrors,bunchResolutions });
  }

  if (!manual && body.previewOnly === true) {
    // 사전 검증에서도 본 저장과 같은 중복·확정차수 판정을 읽기 전용으로 먼저 보여 준다(쓰기·잠금 없음).
    try {
      const replayKey = await readPackingOperation(query, packingOperationPrefix(body.operationId), String(req.user.userId));
      if (replayKey) return res.status(200).json({success:true, replay:true, warehouseKey:replayKey, validatedRows:resolvedItems.length,
        bunchQuantities:resolvedItems.map(item => item.previewBunchQuantity),bunchResolutions});
      await assertWarehouseWeekEditable(query, orderYear, orderWeek, resolvedItems.map((item) => item.countryFlower));
      const duplicate = await findDuplicateWarehouseReceipt(query, { orderYear, orderWeek, farmName, invoiceNo });
      if (duplicate) throw duplicateError(duplicate);
    } catch (err) {
      const status = [400,409,503].includes(err.statusCode) ? err.statusCode : err.code === 'WAREHOUSE_WEEK_FIXED' ? 409 : 503;
      return res.status(status).json({ success:false, code:err.code || 'WAREHOUSE_PREVIEW_CHECK_FAILED',
        error: warehouseErrorMessage(err, '입고 사전 검사(중복·확정 차수)를 확인하지 못했습니다. 잠시 후 다시 시도하세요.'),
        ...(err.warehouseKey ? { warehouseKey: err.warehouseKey } : {}), bunchResolutions });
    }
    return res.status(200).json({success:true, validatedRows:resolvedItems.length,
      bunchQuantities:resolvedItems.map(item => item.previewBunchQuantity),bunchResolutions});
  }

  const operationPrefix = manual ? '' : packingOperationPrefix(body.operationId);
  try {
    const actor = String(req.user.userId);
    if (operationPrefix) {
      const replayKey = await readPackingOperation(query, operationPrefix, actor);
      if (replayKey) return res.status(200).json({ success: true, replay: true, warehouseKey: replayKey, message: `이미 입고된 요청입니다 (#${replayKey}).` });
    }
    if (manual) {
      const attempt = await readManualWarehouseAttempt(query,sql,manualMeta,resolvedItems,actor);
      if (body.previewOnly === true) {
        if (!attempt.replay) {
          await assertWarehouseWeekEditable(query,orderYear,orderWeek,resolvedItems.map(item=>item.countryFlower));
          await assertManualWarehouseEligible(query,sql,manualMeta,resolvedItems);
        }
        return res.status(200).json({success:true,manualPreview:resolvedItems,previewToken:attempt.fileName,
          ...(attempt.replay ? { warehouseKey:attempt.replay } : {})});
      }
      if (body.previewToken !== attempt.fileName) {
        return res.status(409).json({success:false,code:'WAREHOUSE_MANUAL_PREVIEW_CHANGED',error:'입력값을 다시 미리보기한 후 등록하세요.'});
      }
      if (attempt.replay) return res.status(200).json({success:true,warehouseKey:attempt.replay});
    }
    const warehouseKey = await withTransaction(async (tQuery) => {
      let manualFile;
      for (const [index,item] of resolvedItems.entries()) {
        const current = await tQuery(
          `SELECT ProdKey, CountryFlower, OutUnit, EstUnit, SteamOf1Bunch, BunchOf1Box FROM dbo.Product WITH (UPDLOCK,HOLDLOCK)
           WHERE ISNULL(isDeleted,0)=0 AND LOWER(LTRIM(RTRIM(ProdName)))=LOWER(@name)`,
          {name:{type:sql.NVarChar,value:item.prodName}}
        );
        const product = current.recordset.length === 1 && current.recordset[0].ProdKey === item.prodKey ? current.recordset[0] : null;
        if (manual && product) {
          Object.assign(item,manualWarehouseLine(items[index],product),{countryFlower:product.CountryFlower});
          continue;
        }
        const resolution = product && warehouseRowBunch(item,product);
        const error = !product ? '품목이 변경됐습니다. 다시 확인하세요.' : resolution.message;
        if (error) throw Object.assign(new Error(`${item.prodName} · ${error}`), {statusCode:400,
          ...(resolution?.snapshot ? {errors:[{row:item.bunchScope.at(-1)+1,prodName:item.prodName,error,
            candidates:resolution.candidates,snapshot:resolution.snapshot}]} : {})});
        if (resolution.status === 'derived' || resolution.status === 'confirmed') {
          item.bunchQty = resolution.quantity;
          if (item.steamQty > 0) item.steamOf1Bunch = item.steamQty / resolution.quantity;
        }
        item.countryFlower = product.CountryFlower;
        item.outUnit = product.OutUnit;
        item.estUnit = product.EstUnit;
      }
      const transactionMarker = await acquireInvoiceReceiptGate(tQuery, sql);
      if (operationPrefix) {
        const replayKey = await readPackingOperation(tQuery, operationPrefix, actor, true);
        if (replayKey) return { replay: replayKey };
      }
      if (manual) {
        const attempt = await readManualWarehouseAttempt(tQuery,sql,manualMeta,resolvedItems,actor,true);
        if (body.previewToken !== attempt.fileName) {
          throw Object.assign(new Error('입력값을 다시 미리보기한 후 등록하세요.'),{statusCode:409,code:'WAREHOUSE_MANUAL_PREVIEW_CHANGED'});
        }
        if (attempt.replay) return attempt.replay;
        manualFile = attempt.fileName;
        await assertManualWarehouseEligible(tQuery,sql,manualMeta,resolvedItems,true);
      }
      await assertWarehouseWeekEditable(tQuery, orderYear, orderWeek, resolvedItems.map((item) => item.countryFlower));
      const scope = {
        year:{ type:sql.NVarChar,value:String(orderYear) },
        week:{ type:sql.NVarChar,value:String(orderWeek) },
        farm:{ type:sql.NVarChar,value:String(farmName ?? '').trim() },
        invoice:{ type:sql.NVarChar,value:String(invoiceNo ?? '').trim() },
      };
      if (!manual && scope.invoice.value) {
        const duplicate = await findDuplicateWarehouseReceipt(tQuery, { orderYear, orderWeek, farmName, invoiceNo }, true);
        if (duplicate) throw duplicateError(duplicate);
      }
      const wk = await nextInvoiceWarehouseKey(tQuery, sql, transactionMarker);
      // Header GW/CW: explicit modal values win. Otherwise use the single
      // canonical Gross/Chargeable weight row of this same upload (ProdKey 3100/3101).
      const uploadWeight = prodKey => {
        const rows = resolvedItems.filter(item => Number(item.prodKey) === prodKey);
        const value = rows.length === 1 ? Number(rows[0].steamQty) : NaN;
        return Number.isFinite(value) && value > 0 ? value : null;
      };
      const headerGw = manual ? null : gw === '' || gw == null ? uploadWeight(3100) : parseFloat(gw);
      const headerCw = manual ? null : cw === '' || cw == null ? uploadWeight(3101) : parseFloat(cw);
      const masterResult = await tQuery(
        `INSERT INTO WarehouseMaster
           (WarehouseKey, UploadDtm, FileName, OrderYear, OrderWeek, FarmName, InvoiceNo, OrderNo,
            InputDate, GrossWeight, ChargeableWeight, FreightRateUSD, DocFeeUSD,
            isDeleted, CreateID, CreateDtm)
         OUTPUT INSERTED.WarehouseKey
         VALUES (@wk, GETDATE(), @fn, @year, @week, @farm, @inv, @awb, CONVERT(datetime, REPLACE(@dt, N'-', N''), 112),
                 @gw, @cw, @rate, @doc,
                 0, @uid, GETDATE())`,
        {
          wk:   { type: sql.Int, value: wk },
          fn:   { type: sql.NVarChar, value: manualFile || (operationPrefix ? operationPrefix + String(fileName || 'pdf').slice(0, 60) : '') || fileName || `upload_${Date.now()}` },
          year: { type: sql.NVarChar, value: orderYear || '' },
          week: { type: sql.NVarChar, value: orderWeek || '' },
          farm: { type: sql.NVarChar, value: farmName || '' },
          inv:  { type: sql.NVarChar, value: invoiceNo || '' },
          awb:  { type: sql.NVarChar, value: awb || '' },
          dt:   { type: sql.NVarChar, value: String(inputDate).trim() },
          gw:   { type: sql.Float,    value: headerGw },
          cw:   { type: sql.Float,    value: headerCw },
          rate: { type: sql.Float,    value: manual || rate === '' || rate == null ? null : parseFloat(rate) },
          doc:  { type: sql.Float,    value: manual || docFee === '' || docFee == null ? null : parseFloat(docFee) },
          uid:  { type: sql.NVarChar, value: req.user.userId },
        }
      );
      if (masterResult.recordset[0]?.WarehouseKey !== wk) throw new Error('입고번호를 확인하지 못했습니다.');

      const fromWorkbook = value => Number(value ?? 0);
      const delta = new Map();
      const expected = [];
      for (const item of resolvedItems) {
        const box = manual ? item.boxQty : fromWorkbook(item.boxQty);
        const bunch = manual ? item.bunchQty : fromWorkbook(item.bunchQty);
        const steam = fromWorkbook(item.steamQty);
        const quantity = unit => {
          const normalized = String(unit ?? '').trim();
          return normalized === '박스' ? box : normalized === '단' ? bunch : steam;
        };
        const out = quantity(item.outUnit);
        const estimate = quantity(item.estUnit);
        const unitPrice = fromWorkbook(item.unitPrice);
        const totalPrice = fromWorkbook(item.totalPrice);
        const detailKey = await insertInvoiceWarehouseDetail(tQuery, {
          wk:{type:sql.Int,value:wk}, pk:{type:sql.Int,value:item.prodKey}, oc:{type:sql.NVarChar,value:item.orderCode || ''},
          box:{type:sql.Float,value:box}, bunch:{type:sql.Float,value:bunch}, steam:{type:sql.Float,value:steam},
          sbox:{type:sql.Float,value:fromWorkbook(item.steamOf1Box)}, sbunch:{type:sql.Float,value:fromWorkbook(item.steamOf1Bunch)},
          oq:{type:sql.Float,value:out}, eq:{type:sql.Float,value:estimate},
          up:{type:sql.Float,value:unitPrice}, tp:{type:sql.Float,value:totalPrice},
        });
        expected.push({WdetailKey:detailKey,ProdKey:item.prodKey,BoxQuantity:box,BunchQuantity:bunch,
          SteamQuantity:steam,OutQuantity:out,EstQuantity:estimate,UPrice:unitPrice,TPrice:totalPrice});
        delta.set(item.prodKey,(delta.get(item.prodKey) || 0) + out);
      }
      for (const [prodKey,quantity] of [...delta].sort((a,b)=>a[0]-b[0])) {
        await applyInvoiceWarehouseStockDelta(tQuery,{
          year:scope.year,week:scope.week,pk:{type:sql.Int,value:prodKey},delta:{type:sql.Float,value:quantity},
          actor:{type:sql.NVarChar,value:actor},description:{type:sql.NVarChar,value:manual?'수기 입고':'파킹리스트 업로드'},
        });
      }
      await calculateInvoiceStock(tQuery, sql, transactionMarker, {orderYear,orderWeek}, String(req.user.userId));
      const saved = await tQuery(`SELECT WdetailKey,ProdKey,BoxQuantity,BunchQuantity,SteamQuantity,OutQuantity,EstQuantity,UPrice,TPrice
        FROM dbo.WarehouseDetail WHERE WarehouseKey=@wk ORDER BY WdetailKey`,{wk:{type:sql.Int,value:wk}});
      if (saved.recordset.length !== expected.length || expected.some((item,index)=>Object.keys(item)
        .some(field=>item[field] === null ? saved.recordset[index][field] !== null
          : !Number.isFinite(saved.recordset[index][field]) || Math.abs(saved.recordset[index][field]-item[field])>0.000001))) {
        throw new Error('저장 후 입고 수량과 금액이 일치하지 않습니다.');
      }
      if(roundSuffix)await recordWarehouseRoundLabel(tQuery,sql,{warehouseKey:wk,orderYear:String(orderYear),orderWeek},
        {suffix:roundSuffix,actor,source:'PACKING_UPLOAD'});
      return wk;
    });

    if (warehouseKey && typeof warehouseKey === 'object' && warehouseKey.replay) {
      return res.status(200).json({ success: true, replay: true, warehouseKey: warehouseKey.replay, message: `이미 입고된 요청입니다 (#${warehouseKey.replay}).` });
    }
    return res.status(201).json({
      success: true, warehouseKey,
      message: `입고 등록 완료: ${items.length}/${items.length}개 품목`,
    });
  } catch (err) {
    return res.status([400,409,503].includes(err.statusCode) ? err.statusCode : err.code === 'WAREHOUSE_WEEK_FIXED' ? 409 : 500).json({
      success: false, code: err.code, error: warehouseErrorMessage(err), ...(err.errors ? {errors:err.errors} : {}),
      ...(err.warehouseKey ? { warehouseKey: err.warehouseKey } : {}),
    });
  }
}

async function deleteWarehouse(req, res) {
  const { warehouseKey } = req.body;
  if (!Number.isInteger(Number(warehouseKey)) || Number(warehouseKey) <= 0) {
    return res.status(400).json({ success: false, error: 'warehouseKey 필수' });
  }
  if (!canManageInvoiceReceipt(req.user)) {
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
    return res.status(err.code === 'WAREHOUSE_WEEK_FIXED' ? 409 : 500).json({ success: false, code: err.code, error: warehouseErrorMessage(err) });
  }
}

async function assertWarehouseWeekEditable(tQuery, orderYear, orderWeek, countryFlowers = null, warehouseKey = null) {
  const result = await tQuery(
    `SELECT DISTINCT p.CountryFlower
       FROM ShipmentMaster sm
       JOIN ShipmentDetail sd ON sd.ShipmentKey=sm.ShipmentKey
       JOIN Product p ON p.ProdKey=sd.ProdKey AND ISNULL(p.isDeleted,0)=0
      WHERE sm.OrderYear=@year AND sm.OrderWeek=@week AND ISNULL(sm.isDeleted,0)=0
        AND ISNULL(sm.isFix,0)=1
        AND (@allCategories=1 OR p.CountryFlower IN (
          SELECT LTRIM(RTRIM(value)) FROM STRING_SPLIT(@categories, N'|')
        ))`,
    {
      year: { type: sql.NVarChar, value: String(orderYear) },
      week: { type: sql.NVarChar, value: String(orderWeek) },
      allCategories: { type: sql.Bit, value: countryFlowers == null ? 1 : 0 },
      categories: { type: sql.NVarChar, value: [...new Set(countryFlowers || [])].join('|') },
    }
  );
  if (result.recordset.length) {
    const error = new Error(`확정된 차수·품종(${result.recordset.map((row) => row.CountryFlower).join(', ')})은 입고를 변경할 수 없습니다. 먼저 출고 확정을 취소하세요.`);
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
            DECLARE @r INT, @m NVARCHAR(MAX);
            EXEC dbo.usp_StockCalculation
                 @OrderYear = @year,
                 @OrderWeek = @week,
                 @ProdKey   = @pk,
                 @iUserID   = @uid,
                 @oResult   = @r OUTPUT,
                 @oMessage  = @m OUTPUT;
            IF ISNULL(@r,-1)<>0 THROW 51001, N'usp_StockCalculation 처리에 실패했습니다.', 1;
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
