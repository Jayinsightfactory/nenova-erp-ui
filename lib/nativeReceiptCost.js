import { createHash } from 'node:crypto';
import { normalizeWarehouseBrowse } from './invoiceWarehouseBrowse.js';
import { isFreightItem } from './freightCalc.js';
import { baseCountry } from './countryClassification.js';
import { INVOICE_COST_FORMULAS, previewInvoiceCost } from './invoiceReceiptCost.js';

const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fail = (message, statusCode = 400) => { throw Object.assign(new Error(message), { statusCode }); };
const countries = { 중국: 'CN', 콜롬비아: 'CO', 네덜란드: 'NL', 에콰도르: 'EC', 미국: 'US', 베트남: 'VN', 호주: 'AU', 뉴질랜드: 'NZ', 태국: 'TH' };
const lineId = key => { const h = hash(key); return `${h.slice(0,8)}-${h.slice(8,12)}-5${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`; };
function detailWeight(raw, pattern) {
  const rows = raw.filter(row => pattern.test(String(row.ProdName || '').trim()));
  if (rows.length !== 1) return null;
  const values = [...new Set(['OutQuantity','BoxQuantity','BunchQuantity','SteamQuantity'].map(key => rows[0][key])
    .filter(value => typeof value === 'number' && Number.isFinite(value) && value > 0))];
  return values.length === 1 ? values[0] : null;
}

export async function readNativeCostSource({ queryFn, types, input }) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('입고 조회 조건을 확인하세요.');
  const scope = normalizeWarehouseBrowse(input), warehouseKey = Number(input.warehouseKey);
  if (!['string','number'].includes(typeof input.warehouseKey) || !Number.isSafeInteger(warehouseKey) || warehouseKey < 1) fail('입고 번호를 확인하세요.');
  const params = { warehouseKey: { type: types.Int, value: warehouseKey },
    orderYear: { type: types.NVarChar(4), value: scope.orderYear }, orderWeek: { type: types.NVarChar(5), value: scope.orderWeek } };
  // One SELECT: header and details share the same explicit year/week boundary.
  const result = await queryFn(`/* native-cost:readonly-source */ SELECT TOP (1001)
    wm.WarehouseKey,wm.OrderYear,wm.OrderWeek,wm.FarmName,wm.InvoiceNo,
    CONVERT(varchar(10),wm.InputDate,23) AS InputDate,wm.GrossWeight,wm.ChargeableWeight,
    wd.WdetailKey,wd.ProdKey,wd.BoxQuantity,wd.BunchQuantity,wd.SteamQuantity,wd.OutQuantity,
    wd.UPrice,wd.TPrice,wd.SteamOf1Bunch,wd.SteamOf1Box,p.ProdName,p.CounName,p.FlowerName,p.OutUnit
    FROM dbo.WarehouseMaster wm
    JOIN dbo.WarehouseDetail wd ON wd.WarehouseKey=wm.WarehouseKey
    LEFT JOIN dbo.Product p ON p.ProdKey=wd.ProdKey
    WHERE wm.WarehouseKey=@warehouseKey AND wm.OrderYear=@orderYear AND wm.OrderWeek=@orderWeek
      AND ISNULL(wm.isDeleted,0)=0 ORDER BY wd.WdetailKey`, params);
  const raw = result.recordset || [];
  if (!raw.length) fail('선택한 연도·차수에 입고 상세가 없습니다. 다시 조회하세요.', 404);
  if (raw.length > 1000) fail('1,000행을 초과하여 계산할 수 없습니다.');
  const head = raw[0], goods = raw.filter(row => !isFreightItem(row.ProdName));
  const countryOf = value => countries[baseCountry(value)] || String(value || '').trim().toUpperCase();
  const countryValues = [...new Set(goods.map(row => countryOf(row.CounName)))];
  const sourceHash = hash(raw);
  return { ...scope, warehouseKey, sourceHash, farmName: head.FarmName, invoiceNo: head.InvoiceNo,
    inputDate: head.InputDate, gw: head.GrossWeight ?? detailWeight(raw, /^GROSS\s*WEIG[H]?T[H]?$/i),
    cw: head.ChargeableWeight ?? detailWeight(raw, /^CHARGEABLE\s*WEIG[H]?T[H]?$/i),
    country: countryValues.length === 1 ? countryValues[0] : '',
    excluded: raw.filter(row => isFreightItem(row.ProdName)).map(row => ({ key: row.WdetailKey, name: row.ProdName,
      quantity: row.OutQuantity, amount: row.TPrice })),
    lines: goods.map((row, i) => ({ lineId: lineId([warehouseKey, row.WdetailKey]), lineNo: i + 1,
      wdetailKey: row.WdetailKey, prodKey: row.ProdKey, originalName: row.ProdName,
      country: countryOf(row.CounName), flowerName: row.FlowerName,
      boxQuantity: row.BoxQuantity, bunchQuantity: row.BunchQuantity, stemQuantity: row.SteamQuantity,
      outQuantity: row.OutQuantity, outUnit: row.OutUnit, unitPrice: row.UPrice, lineAmount: row.TPrice,
      stemsPerBunch: row.SteamOf1Bunch, stemsPerBox: row.SteamOf1Box })) };
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
  const lines = source.lines.map(line => ({ ...line, currency }));
  return { documentId: `native-${source.warehouseKey}`, revision: 1, sourceHash: source.sourceHash,
    orderYear: source.orderYear, orderWeek: source.orderWeek, invoiceNo: source.invoiceNo,
    receiptStatus: 'NATIVE_READONLY', costStatus: 'PREVIEW_ONLY', warehouseKey: source.warehouseKey,
    lines, receiptLines: lines, reviewedMetadata: { country: source.country, transportMode,
      farmName: source.farmName, inputDate: source.inputDate,
      gw: weight('gw', source.gw), cw: weight('cw', source.cw),
      invoiceCostInput: { nativeCurrency: currency, freightCurrency: currency, formulaEffectiveDate: source.inputDate,
        exchangeRateDate: source.inputDate, exchangeRateType: 'MANUAL', allocationScope: 'SINGLE_INVOICE',
        allocationShareNumerator: 1, allocationShareDenominator: 1, costSourceId: `입고 ${source.warehouseKey} 계산본`,
        lineInputs: lines.map(line => ({ lineId: line.lineId, stemsPerBunch: line.stemsPerBunch,
          bunchesPerBox: Number(line.stemsPerBunch) > 0 && Number(line.stemsPerBox) > 0 ? line.stemsPerBox / line.stemsPerBunch : null })) } } };
}

export function calculateNativeCost(source, request) {
  if (request.sourceHash !== source.sourceHash) fail('입고자료가 조회 후 변경되었습니다. 다시 조회한 뒤 계산하세요.', 409);
  const document = nativeCostDocument(source, request.metadata), input = request.input || {};
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
