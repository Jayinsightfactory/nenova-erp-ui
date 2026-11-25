import { incomingRowKind } from './incomingLedgerLayout.js';

// Pure correction policy: final file values, never additive upload values.
export function correctionError(code, message, statusCode = 409) {
  return Object.assign(new Error(message), { code, statusCode });
}
const fail = (code, message) => { throw correctionError(code, message, 400); };
export function correctionScope(input = {}) {
  const warehouseKey = Number(input.warehouseKey), orderYear = String(input.orderYear ?? ''), orderWeek = String(input.orderWeek ?? '');
  if (!Number.isInteger(warehouseKey) || warehouseKey <= 0 || warehouseKey > 2147483647
    || !/^\d{4}$/.test(orderYear) || Number(orderYear) < 2026 || !/^\d{2}-\d{2}$/.test(orderWeek))
    fail('CORRECTION_SCOPE_INVALID', '2026년 이후의 입고번호·연도·세부차수를 선택하세요.');
  return { warehouseKey, orderYear, orderWeek };
}
const fields = { boxQty: 'BoxQuantity', bunchQty: 'BunchQuantity', steamQty: 'SteamQuantity',
  steamOf1Box: 'SteamOf1Box', steamOf1Bunch: 'SteamOf1Bunch', unitPrice: 'UPrice', totalPrice: 'TPrice' };
export const correctionDetailFields = ['ProdKey', 'OrderCode', ...Object.values(fields), 'OutQuantity', 'EstQuantity'];
export function normalizedCorrection(input,{allowNativeQuantity=false}={}) {
  const scope = correctionScope(input);
  if (allowNativeQuantity && input.mode === 'NATIVE_QUANTITY') return { ...scope, mode:input.mode, detail:normalizeNativeQuantity(input.detail) };
  if (!['FARM', 'REPLACE'].includes(input.mode)) fail('CORRECTION_MODE_REQUIRED', '농장 수정 또는 파일 교체를 선택하세요.');
  const farmName = String(input.farmName ?? '').trim();
  if (!farmName || farmName.length > 100) fail('CORRECTION_FARM_REQUIRED', '농장명을 선택하세요.');
  if (input.mode === 'FARM' && input.items !== undefined) fail('FARM_DETAILS_FORBIDDEN', '농장 수정에서는 품목을 변경할 수 없습니다.');
  const result = { ...scope, mode: input.mode, farmName };
  if(input.sourceDigest!==undefined){
    if(!/^[a-f0-9]{64}$/.test(input.sourceDigest))fail('CORRECTION_SOURCE_DIGEST','조회한 입고 기준을 다시 확인하세요.');
    result.sourceDigest=input.sourceDigest;
  }
  if (input.editKind !== undefined) {
    if (!['FARM','PRODUCT','QUANTITY','ADD','CANCEL','PRICE'].includes(input.editKind) || (input.editKind === 'FARM') !== (input.mode === 'FARM')) fail('CORRECTION_EDIT_SCOPE', '수정 범위를 확인하세요.');
    result.editKind = input.editKind;
  }
  if (result.editKind === 'PRICE') {
    if (input.items !== undefined) fail('CORRECTION_EDIT_SCOPE', '단가 정정에서는 원본 품목과 수량을 전송할 수 없습니다.');
    const { sourceWdetailKey, expectedUnitPrice, unitPrice } = input.price ?? {};
    const validPrice = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1e10;
    if (!Number.isInteger(sourceWdetailKey) || sourceWdetailKey <= 0 || !validPrice(expectedUnitPrice) || !validPrice(unitPrice))
      fail('CORRECTION_PRICE_INVALID', '변경할 입고행과 기존·새 단가를 확인하세요.');
    result.price = { sourceWdetailKey, expectedUnitPrice, unitPrice };
    return result;
  }
  if (input.mode === 'REPLACE') {
    if (!Array.isArray(input.items) || !input.items.length || input.items.length > 500)
      fail('CORRECTION_ROWS_INVALID', '파킹 파일은 1~500행이어야 합니다.');
    result.fileName = String(input.fileName ?? '').trim();
    if (!result.fileName || result.fileName.length > 500) fail('CORRECTION_FILE_REQUIRED', '수정 파일을 선택하세요.');
    result.fileMeta = Object.fromEntries(['orderYear','orderWeek','invoiceNo','awb','inputDate'].map(k => [k, String(input.fileMeta?.[k] ?? '').trim()]));
    result.items = input.items.map((item, index) => {
      const prodName = String(item?.prodName ?? '').trim(), orderCode = String(item?.orderCode ?? '').trim();
      if (!prodName || prodName.length > 300 || orderCode.length > 20) fail('CORRECTION_ROW_INVALID', `${index + 1}행 품목명/주문코드를 확인하세요.`);
      const row = { prodName, orderCode };
      if (result.editKind) {
        const key = item.sourceWdetailKey;
        if (key !== null && (!Number.isInteger(key) || key <= 0)) fail('CORRECTION_SOURCE_INVALID', '원본 입고행을 확인하세요.');
        row.sourceWdetailKey = key;
      }
      for (const key of Object.keys(fields)) {
        // Carry forward NULL only after verifying the scoped source row.
        if (result.editKind === 'PRODUCT' && row.sourceWdetailKey && item[key] === null) {
          row[key] = null;
          continue;
        }
        if (item[key] === null || item[key] === undefined || item[key] === '' || typeof item[key] === 'boolean')
          fail('CORRECTION_NUMBER_REQUIRED', `${index + 1}행 ${key} 수량·금액이 누락됐습니다.`);
        const n = Number(item[key]);
        if (!Number.isFinite(n) || n < 0 || n > 1e10) fail('CORRECTION_NUMBER_INVALID', `${index + 1}행 ${key}는 음수가 아닌 숫자여야 합니다.`);
        row[key] = n;
      }
      return row;
    });
  }
  return result;
}
export function preserveOriginalFarmName(correction, header) {
  if (!correction.editKind || correction.editKind === 'FARM') return correction;
  const stored = header.FarmName;
  if (typeof stored !== 'string' || correction.farmName !== stored.trim()) return correction;
  return { ...correction, farmName: stored };
}
export function buildCorrectionPlan(input, header, before, products) {
  if (!header || ![0,false].includes(header.isDeleted) || header.WarehouseKey !== input.warehouseKey
    || header.OrderYear !== input.orderYear || header.OrderWeek !== input.orderWeek)
    throw correctionError('CORRECTION_SCOPE_CHANGED', '선택한 입고가 삭제되었거나 연도·차수가 달라졌습니다. 다시 조회하세요.');
  if (input.mode === 'NATIVE_QUANTITY' && before.length && before.length <= 500) return planNativeQuantity(input,before,products);
  if (!before.length || before.length > 500 || before.some(d => !Number.isInteger(d.ProdKey) || d.ProdKey <= 0 || !Number.isFinite(d.OutQuantity)))
    throw correctionError('CORRECTION_OLD_DETAILS_INVALID', '기존 입고에 미매칭 품목/수량이 있습니다. 원장 확인이 필요합니다.');
  if (input.editKind === 'PRICE') {
    if (input.farmName !== header.FarmName) throw correctionError('CORRECTION_EDIT_SCOPE', '단가 정정에서는 농장을 변경할 수 없습니다.');
    const { sourceWdetailKey, expectedUnitPrice, unitPrice } = input.price;
    const source = before.find(row => row.WdetailKey === sourceWdetailKey);
    const product = products.find(row => row.ProdKey === source?.ProdKey && [false, 0].includes(row.isDeleted));
    if (!source || !product || source.UPrice !== expectedUnitPrice)
      throw correctionError('CORRECTION_PRICE_STALE', '원본 입고행 또는 기존 단가가 바뀌었습니다. 다시 조회하세요.');
    if (source.OutQuantity <= 0 || !Number.isFinite(source.TPrice) || Math.abs(source.TPrice - source.OutQuantity * expectedUnitPrice) > 0.01)
      throw correctionError('CORRECTION_PRICE_BASIS', '기존 총액이 출고 단위 수량과 단가의 곱으로 확인되는 행만 정정할 수 있습니다.');
    const totalPrice = Math.round(source.OutQuantity * unitPrice * 10000) / 10000;
    if (!Number.isFinite(totalPrice) || totalPrice > 1e10)
      throw correctionError('CORRECTION_PRICE_INVALID', '변경 후 총액을 확인하세요.');
    const after = before.map(row => row.WdetailKey === sourceWdetailKey ? { ...row, UPrice: unitPrice, TPrice: totalPrice } : row);
    const changed = source.UPrice !== unitPrice;
    return { before, after, keys: [source.ProdKey], changes: [{prodKey:source.ProdKey,prodName:product.ProdName,unit:product.OutUnit,
      before:source.OutQuantity,after:source.OutQuantity,delta:0}], priceChange: {sourceWdetailKey, expectedUnitPrice}, detailsChanged: changed, farmChanged: false, changed };
  }
  if (input.mode === 'REPLACE') {
    for (const [key, expected] of Object.entries({orderYear:header.OrderYear,orderWeek:header.OrderWeek,invoiceNo:header.InvoiceNo,awb:header.OrderNo,inputDate:header.InputDate})) {
      const actual = key === 'inputDate' ? input.fileMeta[key].replace(/\//g, '-') : input.fileMeta[key];
      if (actual && actual !== String(expected ?? '').trim())
        throw correctionError('CORRECTION_FILE_SCOPE_MISMATCH', `파일의 ${key}가 선택 입고와 다릅니다. 같은 입고의 수정 파일을 선택하세요.`);
    }
  }
  if (input.editKind && input.editKind !== 'FARM') {
    if (input.farmName !== header.FarmName) throw correctionError('CORRECTION_EDIT_SCOPE', '품목·수량 정정은 선택 농장을 유지해야 합니다.');
    const seen = new Set();
    for (const item of input.items) {
      if (item.sourceWdetailKey === null) {
        if (input.editKind !== 'ADD') throw correctionError('CORRECTION_SOURCE_INVALID', '추가는 품목·수량 추가에서 선택하세요.');
        continue;
      }
      if (seen.has(item.sourceWdetailKey) || !before.some(r => r.WdetailKey === item.sourceWdetailKey)) throw correctionError('CORRECTION_SOURCE_INVALID', '선택 입고의 원본행이 아니거나 중복입니다.');
      seen.add(item.sourceWdetailKey);
    }
    if (seen.size !== before.length) throw correctionError('CORRECTION_SOURCE_INVALID', '기존 입고행을 보존하고 취소 수량은 0으로 입력하세요.');
  }
  const after = input.mode === 'FARM' ? before.map(d => ({...d})) : input.items.map((item, i) => {
    const matches = products.filter(p => p.isDeleted === false || p.isDeleted === 0).filter(p => p.ProdName.trim().toLowerCase() === item.prodName.toLowerCase());
    if (matches.length !== 1) throw correctionError('CORRECTION_PRODUCT_MATCH', `${i+1}행 ${item.prodName}: 전산 품목명이 없거나 중복입니다. 파일 품목명을 수정하세요.`);
    const p = matches[0], row = {ProdKey:p.ProdKey, ProdName:p.ProdName, OrderCode:item.orderCode};
    const original = input.editKind === 'PRODUCT' ? before.find(d => d.WdetailKey === item.sourceWdetailKey) : null;
    for (const [a,b] of Object.entries(fields)) {
      if (item[a] === null && (!original || original[b] !== null))
        throw correctionError('CORRECTION_NUMBER_REQUIRED', `${i+1}행 ${a} 수량·금액이 누락됐습니다.`);
      row[b] = item[a];
    }
    if (input.editKind) row.SourceWdetailKey = item.sourceWdetailKey;
    row.OutQuantity = p.OutUnit === '박스' ? row.BoxQuantity : p.OutUnit === '단' ? row.BunchQuantity : row.SteamQuantity;
    row.EstQuantity = p.EstUnit === '박스' ? row.BoxQuantity : p.EstUnit === '단' ? row.BunchQuantity : row.SteamQuantity;
    if (original && original.ProdKey === row.ProdKey
      && ['BoxQuantity', 'BunchQuantity', 'SteamQuantity'].every(k => row[k] === original[k])) {
      row.OutQuantity = original.OutQuantity;
      row.EstQuantity = original.EstQuantity;
    }
    if (original && original.ProdKey !== row.ProdKey && (row.OutQuantity === null || row.EstQuantity === null))
      throw correctionError('CORRECTION_PRODUCT_UNIT_QUANTITY', `${i+1}행 새 품목의 출고·견적 단위 수량을 입력하세요.`);
    return row;
  });
  if (input.editKind && ['QUANTITY','CANCEL','ADD'].includes(input.editKind)) for (const row of after) {
    const old = before.find(r => r.WdetailKey === row.SourceWdetailKey);
    if (old && (row.ProdKey !== old.ProdKey || row.OrderCode !== old.OrderCode || row.UPrice !== old.UPrice || row.SteamOf1Box !== old.SteamOf1Box || row.SteamOf1Bunch !== old.SteamOf1Bunch)) throw correctionError('CORRECTION_EDIT_SCOPE', '수량 정정은 기존 품목·단가·포장기준을 유지하세요.');
    if (old && input.editKind === 'ADD' && correctionDetailFields.some(k => row[k] !== old[k])) throw correctionError('CORRECTION_EDIT_SCOPE', '추가에서는 기존 행을 변경하지 마세요.');
    if (old && input.editKind === 'CANCEL' && ['BoxQuantity','BunchQuantity','SteamQuantity'].some(k => row[k] > old[k])) throw correctionError('CORRECTION_EDIT_SCOPE', '취소 수량은 기존 수량 이하여야 합니다.');
    if (old && ['QUANTITY','CANCEL'].includes(input.editKind)) {
      const ratio = old.OutQuantity > 0 ? row.OutQuantity / old.OutQuantity : row.OutQuantity === 0 ? 1 : NaN;
      if (!Number.isFinite(ratio) || ['BoxQuantity','BunchQuantity','SteamQuantity','TPrice'].some(k => Math.abs(Number(row[k])-Number(old[k])*ratio) > (k==='TPrice' ? 0.01 : 0.0001)))
        throw correctionError('CORRECTION_QUANTITY_RATIO', '수량만 정정할 때는 기존 포장비율과 금액의 수량비례를 유지하세요. 포장기준·단가도 바꾸려면 품목·수량 변경에서 확인하세요.');
    }
  }
  const detailSignature = rows => JSON.stringify(rows.map(r => correctionDetailFields.map(k => r[k] ?? null)).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))));
  const detailsChanged = detailSignature(before) !== detailSignature(after), farmChanged = header.FarmName !== input.farmName;
  const keys = [...new Set([...before,...after].map(d=>d.ProdKey))].sort((a,b)=>a-b);
  const changes = keys.map(prodKey => {
    const sum = rows => rows.filter(r=>r.ProdKey===prodKey).reduce((s,r)=>s+r.OutQuantity,0);
    const p = products.find(p=>p.ProdKey===prodKey);
    return {prodKey, prodName:p?.ProdName ?? before.find(d=>d.ProdKey===prodKey)?.ProdName ?? String(prodKey), unit:p?.OutUnit ?? '', before:sum(before), after:sum(after), delta:sum(after)-sum(before)};
  });
  return {before, after, keys, changes, detailsChanged, farmChanged, changed:detailsChanged||farmChanged};
}

export const nativeQuantityFields = ['BoxQuantity','BunchQuantity','SteamQuantity'];
export const nativeQuantityWriteFields = [...nativeQuantityFields,'OutQuantity','EstQuantity','TPrice'];

export function normalizeNativeQuantity(input) {
  if (!input || !Number.isInteger(input.detailKey) || input.detailKey < 1 || input.detailKey > 2147483647)
    throw correctionError('CORRECTION_DETAIL_KEY','수정할 입고 상세행을 선택하세요.',400);
  const quantity = {detailKey:input.detailKey,expected:{}};
  for(const key of nativeQuantityFields) {
    const value=input[key], expected=input.expected?.[key];
    const valid=value=>value===null || typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=1e10;
    if(!valid(value)||!valid(expected))
      throw correctionError('CORRECTION_DETAIL_QUANTITY','입고 수량에 0 이상의 숫자를 입력하세요.',400);
    quantity[key]=value; quantity.expected[key]=expected;
  }
  return quantity;
}

export function planNativeQuantity(request, before, products) {
  const {detail: requested}=request;
  const source=before.find(row=>row.WdetailKey===requested.detailKey);
  const product=products.find(row=>row.ProdKey===source?.ProdKey && [false,0].includes(row.isDeleted));
  if(source && incomingRowKind(source)!=='goods')
    throw correctionError('CORRECTION_DETAIL_NON_MERCHANDISE','운송료·중량은 상품 수량 수정에서 처리하지 않습니다. 연결된 도착원가 또는 운송비 작업을 확인하세요.');
  if(!source || !product || nativeQuantityFields.some(key=>source[key]!==requested.expected[key])) throw correctionError('CORRECTION_DETAIL_STALE','기존 입고 상세행과 품목을 다시 조회하세요.');
  if(nativeQuantityFields.some(key=>requested[key]===null&&source[key]!==null))
    throw correctionError('CORRECTION_DETAIL_QUANTITY','기존 수량을 지우려면 0 을 입력하세요.',400);
  const fieldForUnit=unit=>unit==='박스'?'BoxQuantity':unit==='단'?'BunchQuantity':'SteamQuantity';
  const outField=fieldForUnit(product.OutUnit);
  const estField=fieldForUnit(product.EstUnit);
  if(![source[outField],source[estField],requested[outField],requested[estField],source.OutQuantity,source.EstQuantity,source.UPrice,source.TPrice].every(Number.isFinite)
    || Math.abs(source[outField]-source.OutQuantity)>1e-7 || Math.abs(source[estField]-source.EstQuantity)>1e-7)
    throw correctionError('CORRECTION_DETAIL_UNIT','기존 출고·견적 단위와 입력된 수량을 먼저 확인하세요.');
  const bases=[...new Set(['SteamQuantity',outField])].filter(key=>Number.isFinite(source[key])&&Math.abs(source[key]*source.UPrice-source.TPrice)<=0.01);
  let totalPrice=source.TPrice;
  if(bases.length) {
    const results=bases.map(key=>requested[key]===source[key]?source.TPrice:Math.round(requested[key]*source.UPrice*1e4)/1e4);
    if(results.some(value=>Math.abs(value-results[0])>0.01))
      throw correctionError('CORRECTION_DETAIL_PRICE_BASIS','기존 합계가 송이 기준과 출고 단위 기준에 모두 해당하고, 변경하면 금액이 달라집니다. 원장 정정에서 금액 기준을 확인하세요.');
    totalPrice=results[0];
  } else if (['SteamQuantity',outField].some(key=>source[key]!==requested[key])) {
    throw correctionError('CORRECTION_DETAIL_PRICE_BASIS','기존 합계의 단가 기준을 확인할 수 없습니다. 원장 정정에서 금액을 함께 검토하세요.');
  }
  if(!Number.isFinite(totalPrice)||totalPrice<0||totalPrice>1e10)
    throw correctionError('CORRECTION_DETAIL_PRICE','변경 후 금액을 확인하세요.');
  const row={...source,BoxQuantity:requested.BoxQuantity,BunchQuantity:requested.BunchQuantity,SteamQuantity:requested.SteamQuantity,
    OutQuantity:requested[outField],EstQuantity:requested[estField],TPrice:totalPrice};
  const changes=[{prodKey:source.ProdKey,prodName:product.ProdName,unit:product.OutUnit,before:source.OutQuantity,after:row.OutQuantity,
    delta:row.OutQuantity-source.OutQuantity}];
  const changed=nativeQuantityWriteFields.some(key=>row[key]!==source[key]);
  const after=before.map(item=>item.WdetailKey===source.WdetailKey?row:item);
  return {before,after,keys:[source.ProdKey],changes,farmChanged:false,detailsChanged:changed,changed,
    nativeQuantity:{prodName:product.ProdName,before:source,after:row}};
}
