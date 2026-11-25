import { createHash } from 'node:crypto';
import { normalizeWarehouseBrowse } from './invoiceWarehouseBrowse.js';
import { isFreightItem, isGrossWeightItem, isChargeableWeightItem } from './freightCalc.js';
import { baseCountry } from './countryClassification.js';
import { INVOICE_COST_FORMULAS, previewInvoiceCost } from './invoiceReceiptCost.js';
import { auInvoiceTariffDefault } from './auInvoiceTariffDefaults.js';
import { vnInvoiceTariffDefault } from './vnOriginalCostInputs.js';
import { coReceiptCostPrice } from './coOriginalCostInputs.js';
import { readInvoiceReceiptExpenses, receiptFreightAmount } from './invoiceReceiptExpenses.js';
import {readImportTeamRecord} from './importTeamStore.js';
import {CLOUD_MAPPING_KEY,cloudMappingFarm,applyCloudMappings} from './cloudCostMappings.js';
import {resolveCloudCostReference} from './cloudCostReferenceEvidence.js';
import {resolveNativeCostEvidence} from './nativeReceiptCostEvidence.js';
import {isOrphanWeightDetailRow} from './warehouseWeightRows.js';
import {extractAwbReferenceFromReceipts,isValidAwbCode,normalizeAwbCode} from './awbReferenceReceipt.js';
import {matchCloudCategory} from './chinaCloudCost.js';

const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fail = (message, statusCode = 400) => { throw Object.assign(new Error(message), { statusCode }); };
const countries = { 중국: 'CN', 콜롬비아: 'CO', 네덜란드: 'NL', 에콰도르: 'EC', 미국: 'US', 베트남: 'VN', 호주: 'AU', 뉴질랜드: 'NZ', 태국: 'TH' };
const lineId = key => { const h = hash(key); return `${h.slice(0,8)}-${h.slice(8,12)}-5${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`; };
export const nativeLineId = lineId;
const isBlankOrZero = value => value == null || String(value).trim() === ''
  || (typeof value !== 'boolean' && Number.isFinite(Number(value)) && Math.abs(Number(value)) <= 1e-9);
export function isEmptyNativePlaceholderRow(row) {
  if (!row || typeof row !== 'object') return false;
  const noProdKey = row.ProdKey == null || String(row.ProdKey).trim() === '';
  const noProdName = !String(row.ProdName ?? '').trim();
  return noProdKey && noProdName && isBlankOrZero(row.OutQuantity) && isBlankOrZero(row.UPrice) && isBlankOrZero(row.TPrice);
}
function detailWeight(raw, pattern) {
  const rows = raw.filter(row => pattern.test(String(row.ProdName || '').trim()));
  if (rows.length !== 1) return null;
  const candidates = ['OutQuantity','BoxQuantity','BunchQuantity','SteamQuantity'].map(key => rows[0][key])
    .filter(value => typeof value === 'number' && Number.isFinite(value) && value > 0);
  // Native weight rows use Box/Bunch=1 as a placeholder, not a second kg value.
  // Distinct real kg values remain a conflict rather than choosing the maximum.
  const values = [...new Set(candidates.some(value => value > 1) ? candidates.filter(value => value > 1) : candidates)];
  return values.length === 1 ? values[0] : null;
}

export async function readNativeCostSource({ queryFn, types, input, evidenceResolver=resolveNativeCostEvidence }) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('입고 조회 조건을 확인하세요.');
  const scope = normalizeWarehouseBrowse(input), warehouseKey = Number(input.warehouseKey);
  if (!['string','number'].includes(typeof input.warehouseKey) || !Number.isSafeInteger(warehouseKey) || warehouseKey < 1) fail('입고 번호를 확인하세요.');
  const params = { warehouseKey: { type: types.Int, value: warehouseKey },
    orderYear: { type: types.NVarChar(4), value: scope.orderYear }, orderWeek: { type: types.NVarChar(5), value: scope.orderWeek } };
  // One SELECT: header and details share the same explicit year/week boundary.
  const result = await queryFn(`/* native-cost:readonly-source */ SELECT TOP (1001)
    wm.WarehouseKey,wm.OrderYear,wm.OrderWeek,wm.OrderNo,wm.FarmName,wm.InvoiceNo,wm.FileName,
    CONVERT(varchar(10),wm.InputDate,23) AS InputDate,wm.GrossWeight,wm.ChargeableWeight,
    wd.WdetailKey,wd.ProdKey,wd.OrderCode,wd.BoxQuantity,wd.BunchQuantity,wd.SteamQuantity,wd.OutQuantity,
    wd.UPrice,wd.TPrice,wd.SteamOf1Bunch,wd.SteamOf1Box,p.ProdName,p.CounName,p.FlowerName,p.OutUnit,p.TariffRate,p.isDeleted AS ProductDeleted
    FROM dbo.WarehouseMaster wm
    JOIN dbo.WarehouseDetail wd ON wd.WarehouseKey=wm.WarehouseKey
    LEFT JOIN dbo.Product p ON p.ProdKey=wd.ProdKey
    WHERE wm.WarehouseKey=@warehouseKey AND wm.OrderYear=@orderYear AND wm.OrderWeek=@orderWeek
      AND ISNULL(wm.isDeleted,0)=0 ORDER BY wd.WdetailKey`, params);
  const raw = result.recordset || [];
  if (!raw.length) fail('선택한 연도·차수에 입고 상세가 없습니다. 다시 조회하세요.', 404);
  if (raw.length > 1000) fail('1,000행을 초과하여 계산할 수 없습니다.');
  const workbookEvidence=evidenceResolver(raw);
  const cloudReference=resolveCloudCostReference(raw);
  const weightByKey=new Map((workbookEvidence?.weights||[]).map(w=>[w.key,w]));
  const orphanWeights=raw.filter(row=>isOrphanWeightDetailRow(row)&&!isEmptyNativePlaceholderRow(row));
  const orphanGw=orphanWeights.length>=1&&orphanWeights.length<=2&&Number(orphanWeights[0].SteamQuantity)>0?Number(orphanWeights[0].SteamQuantity):null;
  const orphanCw=orphanWeights.length===2&&Number(orphanWeights[1].SteamQuantity)>0?Number(orphanWeights[1].SteamQuantity):null;
  const excluded=row=>isFreightItem(row.ProdName)||weightByKey.has(row.WdetailKey)||isOrphanWeightDetailRow(row)||isEmptyNativePlaceholderRow(row);
  const head = raw[0], goods = raw.filter(row => !excluded(row));
  const countryOf = value => countries[baseCountry(value)] || String(value || '').trim().toUpperCase();
  // 전산 품목과 연결되지 않은 행(원산지 없음)이 하나 섞여도 나머지 행의 단일 원산지를 입고의 원산지로 본다.
  const countryValues = [...new Set(goods.map(row => countryOf(row.CounName)).filter(Boolean))];
  const receiptExpenses = await readInvoiceReceiptExpenses({ queryFn, types, warehouseKey });
  const sourceHash = hash({ raw, receiptExpenses });
  let awbReference = null;
  if (isValidAwbCode(head.OrderNo)) {
    const normalizedAwb = normalizeAwbCode(head.OrderNo);
    const refResult = await queryFn(`/* native-awb-reference:readonly-source */ SELECT TOP (2001)
      wm.WarehouseKey,wm.OrderYear,wm.OrderWeek,wm.OrderNo,wm.FarmName,wm.InvoiceNo,
      wm.GrossWeight,wm.ChargeableWeight,
      wd.WdetailKey,wd.ProdKey,wd.BoxQuantity,wd.BunchQuantity,wd.SteamQuantity,wd.OutQuantity,
      wd.UPrice,wd.TPrice,wd.SteamOf1Bunch,wd.SteamOf1Box,p.ProdName,p.CounName
      FROM dbo.WarehouseMaster wm
      JOIN dbo.WarehouseDetail wd ON wd.WarehouseKey=wm.WarehouseKey
      LEFT JOIN dbo.Product p ON p.ProdKey=wd.ProdKey
      WHERE wm.OrderYear=@orderYear AND wm.OrderWeek=@orderWeek
        AND REPLACE(REPLACE(ISNULL(wm.OrderNo,N''),N'-',N''),N' ',N'')=@awb
        AND ISNULL(wm.isDeleted,0)=0 ORDER BY wm.WarehouseKey,wd.WdetailKey`, {
      orderYear: { type: types.NVarChar(4), value: scope.orderYear },
      orderWeek: { type: types.NVarChar(5), value: scope.orderWeek },
      awb: { type: types.NVarChar(20), value: normalizedAwb },
    });
    awbReference = extractAwbReferenceFromReceipts(refResult?.recordset || [], normalizedAwb, { targetWarehouseKey: warehouseKey });
  }
  const ownGw = head.GrossWeight ?? receiptExpenses?.weights?.gw ?? detailWeight(raw, /^GROSS\s*WEIG[H]?T[H]?$/i) ?? workbookEvidence?.weights.find(w=>w.kind==='GW')?.kg ?? cloudReference?.weights.find(w=>w.kind==='GW')?.kg ?? orphanGw ?? null;
  const ownCw = head.ChargeableWeight ?? receiptExpenses?.weights?.cw ?? detailWeight(raw, /^CHARGEABLE\s*WEIG[H]?T[H]?$/i) ?? workbookEvidence?.weights.find(w=>w.kind==='CW')?.kg ?? cloudReference?.weights.find(w=>w.kind==='CW')?.kg ?? orphanCw ?? null;
  const awbShare = awbReference && awbReference.sharedGoodsReceiptCount > 1 && awbReference.stemShareNumerator > 0 && awbReference.stemShareDenominator > 0
    ? awbReference.stemShareNumerator / awbReference.stemShareDenominator
    : awbReference && awbReference.sharedGoodsReceiptCount <= 1 ? 1 : null;
  const refGw = awbReference?.gw > 0 && awbShare != null
    ? (awbShare === 1 ? awbReference.gw : Math.round(awbReference.gw * awbShare * 100) / 100) : null;
  const refCw = awbReference?.cw > 0 && awbShare != null
    ? (awbShare === 1 ? awbReference.cw : Math.max(refGw ?? 0, Math.round(awbReference.cw * awbShare * 100) / 100)) : null;
  const cloudMappings=countryValues.length===1&&countryValues[0]==='CN'&&cloudMappingFarm(head.FarmName)
    ? (await readImportTeamRecord(CLOUD_MAPPING_KEY)).value : null;
  return { ...scope, warehouseKey, sourceHash, receiptExpenses, orderNo: head.OrderNo ?? null, farmName: head.FarmName, invoiceNo: head.InvoiceNo,
    inputDate: head.InputDate, gw: ownGw ?? refGw ?? null,
    cw: ownCw ?? refCw ?? null,
    ...(awbReference ? { awbReference } : {}),
    cloudReference,
    cloudMappings,
    ...(workbookEvidence?{workbookEvidence}:{}),
    country: countryValues.length === 1 ? countryValues[0] : '',
    excluded: raw.filter(excluded).map(row => ({ key: row.WdetailKey,
      name:weightByKey.has(row.WdetailKey)?`${weightByKey.get(row.WdetailKey).name} · 검증 원본 ${workbookEvidence.source.sheet}!${weightByKey.get(row.WdetailKey).cells}`:(String(row.ProdName ?? '').trim() || '(공란·비상품 행)'),
      quantity:weightByKey.get(row.WdetailKey)?.kg??(isOrphanWeightDetailRow(row)?row.SteamQuantity:row.OutQuantity), amount: row.TPrice })),
    lines: goods.map((row, i) => ({ lineId: lineId([warehouseKey, row.WdetailKey]), lineNo: i + 1,
      wdetailKey: row.WdetailKey, prodKey: row.ProdKey, originalName: row.ProdName,
      sourceOriginalName:receiptExpenses?.sourceLines?.find(line=>line.wdetailKey===row.WdetailKey)?.originalName??row.SourceOriginalName??null,
      country: countryOf(row.CounName), originName: row.CounName, flowerName: row.FlowerName, productDeleted: row.ProductDeleted,
      boxQuantity: row.BoxQuantity, bunchQuantity: row.BunchQuantity, stemQuantity: row.SteamQuantity,
      outQuantity: row.OutQuantity, outUnit: row.OutUnit, unitPrice: row.UPrice, lineAmount: row.TPrice,
      tariffRate: row.TariffRate, stemsPerBunch: row.SteamOf1Bunch, stemsPerBox: row.SteamOf1Box })) };
}

export function nativeCostDocument(source, metadata = {}) {
  const weight = (key, fallback) => {
    const value = metadata[key];
    if (value == null || value === '') return fallback;
    if (!['string','number'].includes(typeof value) || !Number.isFinite(Number(value)) || Number(value) < 0) fail(`${key.toUpperCase()} 중량을 확인하세요.`);
    return Number(value);
  };
  const currency = String(metadata.currency || '').trim().toUpperCase();
  const transportMode = String(metadata.transportMode || '').trim().toUpperCase();
  // Native AU receipt TPrice is the saved shipment total, not UPrice * bunches.
  // Use that authoritative total in the bunch-based cost formula; never rewrite ERP.
  const lines = source.lines.map(line => {
    const nativeAmount = line.lineAmount, bunches = line.bunchQuantity;
    const useNativeTotal = source.country === 'AU' && typeof nativeAmount === 'number' && Number.isFinite(nativeAmount) && nativeAmount >= 0
      && typeof bunches === 'number' && Number.isFinite(bunches) && bunches > 0;
    const conversion=source.workbookEvidence?.unitConversions?.find(c=>c.key===line.wdetailKey)
      ??source.cloudReference?.unitConversions?.find(c=>c.key===line.wdetailKey);
    const baseLine = { ...line, currency, ...(conversion?{nativeOutUnit:line.nativeOutUnit??line.outUnit,nativeOutQuantity:line.nativeOutQuantity??line.outQuantity,
      sourceBunchQuantity:Object.hasOwn(line,'sourceBunchQuantity')?line.sourceBunchQuantity:line.bunchQuantity,outUnit:conversion.to,outQuantity:conversion.quantity??line.bunchQuantity,
      bunchQuantity:conversion.quantity??line.bunchQuantity,calculationUnitEvidence:conversion.cells}:{}), ...(useNativeTotal ? {
      nativeStoredUnitPrice: line.unitPrice, nativePriceBasis: 'SAVED_TOTAL_PER_BUNCH',
      unitPrice: nativeAmount / bunches,
    } : {}) };
    return source.country === 'CO' ? coReceiptCostPrice(baseLine) : baseLine;
  });
  const coTariffDefault = line => source.country === 'CO' && transportMode === 'AIR' && Number(line.prodKey) > 0
    ? { tariffRate: 0, label: '콜롬비아 기본 0%', prodKey: line.prodKey } : null;
  const tariffDefaults = Object.fromEntries(lines.map(line => [line.lineId, coTariffDefault(line) || vnInvoiceTariffDefault({orderYear:source.orderYear,orderWeek:source.orderWeek,reviewedMetadata:{country:source.country,transportMode}},line) || auInvoiceTariffDefault({
    orderYear: source.orderYear, orderWeek: source.orderWeek, reviewedMetadata: { country: source.country, transportMode },
  }, { ProdKey: line.prodKey, ProdName: line.originalName, CounName: source.country === 'AU' ? '호주' : source.country, isDeleted: line.productDeleted })]).filter(([, value]) => value));
  const ownFreightRows = (source.excluded || []).filter(row => row.name !== '(공란·비상품 행)' && !isGrossWeightItem(row.name) && !isChargeableWeightItem(row.name) && !/검증 원본/.test(String(row.name || '')));
  const positiveOwnFreight = ownFreightRows.filter(row => typeof row.amount === 'number' && Number.isFinite(row.amount) && row.amount > 0);
  const legacyFreight = positiveOwnFreight.length > 0
    ? Math.round(positiveOwnFreight.reduce((sum, row) => sum + row.amount, 0) * 1e6) / 1e6 : null;
  let detectedFreight = legacyFreight;
  if (source.receiptExpenses) {
    try { detectedFreight = receiptFreightAmount(source, legacyFreight); } catch { detectedFreight = legacyFreight; }
  }
  const awbRef = source.awbReference;
  const awbShare = awbRef && awbRef.sharedGoodsReceiptCount > 1 && awbRef.stemShareNumerator > 0 && awbRef.stemShareDenominator > 0
    ? awbRef.stemShareNumerator / awbRef.stemShareDenominator
    : awbRef && awbRef.sharedGoodsReceiptCount <= 1 ? 1 : null;
  const refFreight = detectedFreight == null && awbRef?.freightAmount != null && awbShare != null
    ? (awbShare === 1 ? awbRef.freightAmount : Math.round(awbRef.freightAmount * awbShare * 1e6) / 1e6)
    : null;
  const autoFreight = detectedFreight ?? refFreight;
  const isCloudNoOrchid = source.country === 'CN' && transportMode === 'AIR' && /\bCLOUD(?:\s*LAND)?\b/i.test(String(source.farmName || ''))
    && !source.cloudReference && lines.length > 0 && lines.every(line => matchCloudCategory(line.originalName) !== 8);
  const derivedLineConversions = line => {
    const stemsPerBunch = line.bunchQuantity > 0 && line.stemQuantity > 0
      && (!(Number(line.stemsPerBunch) > 0) || Math.abs(line.bunchQuantity * Number(line.stemsPerBunch) - line.stemQuantity) > 1e-6)
      ? line.stemQuantity / line.bunchQuantity
      : line.stemsPerBunch;
    const effectiveStemsPerBunch = Number(stemsPerBunch) > 0 ? Number(stemsPerBunch) : null;
    const nominalBunchesPerBox = effectiveStemsPerBunch && Number(line.stemsPerBox) > 0
      ? Number(line.stemsPerBox) / effectiveStemsPerBunch : null;
    const bunchesPerBox = line.boxQuantity > 0 && line.bunchQuantity > 0
      && (!(nominalBunchesPerBox > 0) || Math.abs(line.boxQuantity * nominalBunchesPerBox - line.bunchQuantity) > 1e-6)
      ? line.bunchQuantity / line.boxQuantity
      : nominalBunchesPerBox;
    return { stemsPerBunch, bunchesPerBox };
  };
  return applyCloudMappings({ documentId: `native-${source.warehouseKey}`, revision: 1, sourceHash: source.sourceHash,
    orderYear: source.orderYear, orderWeek: source.orderWeek, invoiceNo: source.invoiceNo,
    receiptStatus: 'NATIVE_READONLY', costStatus: 'PREVIEW_ONLY', warehouseKey: source.warehouseKey,
    lines, receiptLines: lines, reviewedMetadata: { country: source.country, transportMode, tariffDefaults,
      ...(source.workbookEvidence?{nativeWorkbookEvidence:source.workbookEvidence}:{}),
      ...(awbRef ? { awbReference: awbRef } : {}),
      farmName: source.farmName, inputDate: source.inputDate,
      cloudReference:source.cloudReference,
      gw: weight('gw', source.gw), cw: weight('cw', source.cw),
      invoiceCostInput: { nativeCurrency: currency, freightCurrency: currency, formulaEffectiveDate: source.inputDate,
        exchangeRateDate: source.inputDate, exchangeRateType: 'MANUAL', allocationScope: 'SINGLE_INVOICE',
        allocationShareNumerator: 1, allocationShareDenominator: 1,
        costSourceId: awbRef && refFreight != null
          ? `${awbRef.sourceId}${awbRef.sharedGoodsReceiptCount > 1 ? ` · 송이비중 ${awbRef.stemShareNumerator}/${awbRef.stemShareDenominator} 안분 초안` : ''}`
          : `입고 ${source.warehouseKey} 계산본`,
        ...(autoFreight != null ? { freightAmount: autoFreight } : {}),
        ...(isCloudNoOrchid ? { cloudOrchidPermitNative: 0 } : {}),
        ...(source.workbookEvidence?{freightAmount:source.workbookEvidence.freight.amount}:{}),
        ...(source.workbookEvidence?.exchangeRate?{exchangeRateKRW:source.workbookEvidence.exchangeRate.value,
          exchangeRateType:'WORKBOOK_REFERENCE',exchangeRateSource:`원본 참고 ${source.workbookEvidence.exchangeRate.sheet}!${source.workbookEvidence.exchangeRate.cell}=${source.workbookEvidence.exchangeRate.value} · 현재 입력값 우선`}:{}),
        ...(source.cloudReference?{exchangeRateKRW:source.cloudReference.exchangeRate.value,exchangeRateType:'WORKBOOK_REFERENCE',
          exchangeRateSource:`${source.cloudReference.source.fileName} ${source.cloudReference.source.sheet}!C7 · 원문 참고`,
          estimateSource:`${source.cloudReference.source.fileName} ${source.cloudReference.source.sheet} · C8 GW·C9 검역 분류수·통관비 수식 참고 · 적용 확인 전 추정`,
          freightAmount:source.cloudReference.freight.amount,cloudOrchidPermitNative:'',cloudQuarantineCategoryCount:source.cloudReference.quarantineCount?.value??'',
          cloudFinancialReviewConfirmed:false}:{}),
        lineInputs: lines.map(line => {
          const conversions = derivedLineConversions(line);
          return { lineId: line.lineId,
            ...(source.workbookEvidence?.categories.find(c=>c.key===line.wdetailKey)?{categoryCode:source.workbookEvidence.categories.find(c=>c.key===line.wdetailKey).code}:{}),
            ...(tariffDefaults[line.lineId] ? { tariffRate: tariffDefaults[line.lineId].tariffRate } : {}),
            stemsPerBunch: conversions.stemsPerBunch,
            bunchesPerBox: conversions.bunchesPerBox };
        }) } } },source.cloudMappings);
}

export function calculateNativeCost(source, request) {
  if (request.sourceHash !== source.sourceHash) fail('입고자료가 조회 후 변경되었습니다. 다시 조회한 뒤 계산하세요.', 409);
  const document = nativeCostDocument(source, request.metadata), input = {...request.input};
  if(source.cloudReference?.financialReviewRequired&&input.cloudFinancialReviewConfirmed!==true)
    fail('원문 통화·허가증 비용·검역 분류수 확인이 필요합니다. 원가표의 예외를 자동 확정하지 않았습니다.');
  if(source.workbookEvidence?.exchangeRate&&input.exchangeRateType==='WORKBOOK_REFERENCE'
    &&Number(input.exchangeRateKRW)!==source.workbookEvidence.exchangeRate.value){
    input.exchangeRateType='USER_INPUT';input.exchangeRateSource='담당자 직접 입력';
  }
  const formula = INVOICE_COST_FORMULAS[input.formulaId];
  if (!formula || formula.country !== source.country || formula.transportMode !== document.reviewedMetadata.transportMode)
    fail('입고 국가·운송과 원가 공식이 일치하지 않습니다.');
  // The user-selected, confirmed formula supplies the price basis. Country calculators
  // independently reconcile unit price × basis quantity against the native line amount.
  document.lines = document.lines.map(line => ({ ...line, priceUnit: formula.priceBasis || (formula.country === 'NL' ? 'STEM' : 'BUNCH') }));
  document.receiptLines = document.lines;
  const preview = previewInvoiceCost({ ...document, costInput: input }, document.receiptLines);
  return { document, input, preview };
}
