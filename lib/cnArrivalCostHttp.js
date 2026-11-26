// 중국 도착원가(CLOUD 항공 · HUBFRESH 해상) API. 운영 DB는 SELECT만 수행한다(dbWrites 0).
// #8249·#8250 정적 JSON 의존 없이 입고 원장·동일 AWB 참고전표·업로드 서류(WebInvoiceDocument)·현재 환율만으로 기본값을 채운다.
import { normalizeWarehouseBrowse } from './invoiceWarehouseBrowse.js';
import { cnSourceFromDbRows, normalizeCnPayload } from './cnArrivalCostEngine.js';
import { createCnArrivalCostWorkbook } from './cnArrivalCostWorkbook.js';
import { readInvoiceReceiptExpenses } from './invoiceReceiptExpenses.js';
import { extractAwbReferenceFromReceipts, isValidAwbCode, normalizeAwbCode } from './awbReferenceReceipt.js';
import { fetchLiveInvoiceRate } from './invoiceLiveExchangeRate.js';

const fail = (message, statusCode = 400) => { throw Object.assign(new Error(message), { statusCode }); };

function parseRequestedWarehouseKeys(input = {}) {
  const rawList = input.warehouseKeys != null && String(input.warehouseKeys).trim() !== ''
    ? String(input.warehouseKeys).split(',').map(v => Number(v.trim()))
    : input.warehouseKey != null && String(input.warehouseKey).trim() !== ''
      ? [Number(input.warehouseKey)]
      : [];
  const unique = [...new Set(rawList)];
  if (!unique.length || unique.length > 30 || unique.some(k => !Number.isSafeInteger(k) || k < 1)) {
    fail('입고 번호를 확인하세요.');
  }
  return unique;
}

export async function readCnArrivalSource({ queryFn, types, input, fetchRate = fetchLiveInvoiceRate, readExpenses = readInvoiceReceiptExpenses }) {
  const scope = normalizeWarehouseBrowse(input);
  const warehouseKeys = parseRequestedWarehouseKeys(input);
  const raw = [];
  for (const warehouseKey of warehouseKeys) {
    const result = await queryFn(`/* cn-arrival-cost:readonly-source */ SELECT TOP (1001)
      wm.WarehouseKey,wm.OrderYear,wm.OrderWeek,wm.OrderNo,wm.FarmName,wm.InvoiceNo,wm.FileName,wm.GrossWeight,wm.ChargeableWeight,
      wd.WdetailKey,wd.ProdKey,wd.OrderCode,wd.BoxQuantity,wd.BunchQuantity,wd.SteamQuantity,wd.OutQuantity,wd.UPrice,wd.TPrice,wd.SteamOf1Bunch,wd.SteamOf1Box,
      p.ProdName,p.CounName,p.FlowerName,p.OutUnit,p.TariffRate,p.SteamOf1Bunch AS ProductSteamOf1Bunch
      FROM dbo.WarehouseMaster wm
      JOIN dbo.WarehouseDetail wd ON wd.WarehouseKey=wm.WarehouseKey
      LEFT JOIN dbo.Product p ON p.ProdKey=wd.ProdKey
      WHERE wm.WarehouseKey=@warehouseKey AND wm.OrderYear=@orderYear AND wm.OrderWeek=@orderWeek AND ISNULL(wm.isDeleted,0)=0
      ORDER BY wd.WdetailKey`, {
      warehouseKey: { type: types.Int, value: warehouseKey },
      orderYear: { type: types.NVarChar(4), value: scope.orderYear },
      orderWeek: { type: types.NVarChar(5), value: scope.orderWeek },
    });
    raw.push(...(result.recordset || []));
  }
  if (!raw.length) fail('선택한 연도·차수에 입고 상세가 없습니다.', 404);
  if (raw.length > 1000) fail('1,000행을 초과하여 계산할 수 없습니다.');
  const source = cnSourceFromDbRows(raw);
  const evidence = [];

  // 업로드 서류(WebInvoiceDocument) 자동추출값: 중량·운임·서류비.
  let docGw = 0, docCw = 0, docFreight = 0, hasDocGw = false, hasDocCw = false;
  for (const warehouseKey of warehouseKeys) {
    try {
      const expenses = await readExpenses({ queryFn, types, warehouseKey });
      if (Number(expenses?.weights?.gw) > 0) { docGw += Number(expenses.weights.gw); hasDocGw = true; }
      if (Number(expenses?.weights?.cw) > 0) { docCw += Number(expenses.weights.cw); hasDocCw = true; }
      const freight = (expenses?.entries || []).filter(e => ['freight', 'docFee'].includes(e.kind) && (!e.currency || e.currency === 'CNY')).reduce((s, e) => s + Number(e.amount || 0), 0);
      if (freight > 0) docFreight += freight;
    } catch { /* 서류가 없으면 입고 원본·표준 기본값 사용 */ }
  }
  if (source.gw == null && hasDocGw) { source.gw = docGw; source.weightSource = '업로드 서류 중량'; source.gwCwAmbiguous = false; evidence.push('업로드 서류 중량'); }
  if (hasDocCw && (source.cw == null || source.weightSource === '업로드 서류 중량')) source.cw = docCw;
  if (docFreight > 0) { source.airFreight = docFreight; source.airFreightSource = '업로드 서류 운임·서류비'; evidence.push('업로드 서류 운임'); }

  // 동일 11자리 AWB 참고전표 자동추출 (SELECT-only).
  const awbs = [...new Set(raw.map(r => normalizeAwbCode(r.OrderNo)).filter(isValidAwbCode))];
  if (awbs.length === 1 && (source.gw == null || source.cw == null || source.airFreight == null)) {
    try {
      const refResult = await queryFn(`/* cn-arrival-awb-ref:readonly-source */ SELECT TOP (2001)
        wm.WarehouseKey,wm.OrderYear,wm.OrderWeek,wm.OrderNo,wm.FarmName,wm.InvoiceNo,wm.GrossWeight,wm.ChargeableWeight,
        wd.WdetailKey,wd.ProdKey,wd.BoxQuantity,wd.BunchQuantity,wd.SteamQuantity,wd.OutQuantity,wd.UPrice,wd.TPrice,wd.SteamOf1Bunch,wd.SteamOf1Box,p.ProdName,p.CounName
        FROM dbo.WarehouseMaster wm
        JOIN dbo.WarehouseDetail wd ON wd.WarehouseKey=wm.WarehouseKey
        LEFT JOIN dbo.Product p ON p.ProdKey=wd.ProdKey
        WHERE wm.OrderYear=@orderYear AND wm.OrderWeek=@orderWeek
          AND REPLACE(REPLACE(ISNULL(wm.OrderNo,N''),N'-',N''),N' ',N'')=@awb
          AND ISNULL(wm.isDeleted,0)=0 ORDER BY wm.WarehouseKey,wd.WdetailKey`, {
        orderYear: { type: types.NVarChar(4), value: scope.orderYear },
        orderWeek: { type: types.NVarChar(5), value: scope.orderWeek },
        awb: { type: types.NVarChar(20), value: awbs[0] },
      });
      const awbRef = extractAwbReferenceFromReceipts(refResult?.recordset || [], awbs[0], { targetWarehouseKey: warehouseKeys[0] });
      if (awbRef) {
        const fullAwbSelected = awbRef.sharedGoodsReceiptCount <= warehouseKeys.length;
        const share = fullAwbSelected ? 1 : (awbRef.stemShareNumerator > 0 && awbRef.stemShareDenominator > 0 ? awbRef.stemShareNumerator / awbRef.stemShareDenominator : null);
        if (share != null) {
          if (source.gw == null && awbRef.gw > 0) { source.gw = Math.round(awbRef.gw * share * 100) / 100; source.weightSource = `${awbRef.sourceId} AWB 연동`; source.gwCwAmbiguous = false; }
          if (source.cw == null && awbRef.cw > 0) source.cw = Math.max(source.gw ?? 0, Math.round(awbRef.cw * share * 100) / 100);
          if (source.airFreight == null && awbRef.freightAmount > 0) { source.airFreight = Math.round(awbRef.freightAmount * share * 1e6) / 1e6; source.airFreightSource = `${awbRef.sourceId} AWB 운임 연동`; }
          evidence.push('동일 AWB 참고전표');
        }
      }
    } catch { /* AWB 참고전표 조회 생략 시 입고 자체값 사용 */ }
  }

  if (source.exchangeRate == null) {
    try { const quote = await fetchRate('CNY'); source.exchangeRate = quote.rate; source.exchangeRateSource = `현재 CNY 시세 ${quote.marketRate} + 15원`; }
    catch { /* 표준 기본 환율(210원) 사용 */ }
  }
  return { ...source, orderYear: scope.orderYear, orderWeek: scope.orderWeek, evidence };
}

export function createCnArrivalCostHandler({ queryFn, types, authorize, fetchRate, readExpenses, generate = createCnArrivalCostWorkbook }) {
  return async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    if (!authorize?.(req.user)) return res.status(403).json({ success: false, error: '수입부 업무 권한이 필요합니다.' });
    try {
      if (req.method === 'GET') {
        const source = await readCnArrivalSource({ queryFn, types, input: req.query || {}, fetchRate, readExpenses });
        return res.status(200).json({ success: true, source, dbWrites: 0 });
      }
      if (req.method === 'POST') {
        const payload = normalizeCnPayload(req.body);
        const { buffer } = await generate(payload);
        const keyPart = payload.warehouseKeys?.length > 1 ? payload.warehouseKeys.join('-') : (payload.warehouseKey ?? '');
        const name = `중국도착원가_${payload.mode}_${payload.orderYear || ''}_${payload.orderWeek || ''}_${keyPart}.xlsx`;
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="cn-arrival-cost.xlsx"; filename*=UTF-8''${encodeURIComponent(name)}`);
        return res.status(200).send(buffer);
      }
      res.setHeader('Allow', 'GET, POST');
      return res.status(405).end();
    } catch (error) {
      const status = [400, 404, 409, 422].includes(error.statusCode) ? error.statusCode : 503;
      return res.status(status).json({ success: false, error: status === 503 ? '중국 도착원가를 준비하지 못했습니다. 입력값을 유지한 채 다시 시도하세요.' : error.message });
    }
  };
}
