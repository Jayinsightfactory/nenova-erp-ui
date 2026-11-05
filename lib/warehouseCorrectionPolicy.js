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
export function normalizedCorrection(input) {
  const scope = correctionScope(input);
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
    if (!['FARM','PRODUCT','QUANTITY','ADD','CANCEL'].includes(input.editKind) || (input.editKind === 'FARM') !== (input.mode === 'FARM')) fail('CORRECTION_EDIT_SCOPE', '수정 범위를 확인하세요.');
    result.editKind = input.editKind;
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
export function buildCorrectionPlan(input, header, before, products) {
  if (!header || ![0,false].includes(header.isDeleted) || header.WarehouseKey !== input.warehouseKey
    || header.OrderYear !== input.orderYear || header.OrderWeek !== input.orderWeek)
    throw correctionError('CORRECTION_SCOPE_CHANGED', '선택한 입고가 삭제되었거나 연도·차수가 달라졌습니다. 다시 조회하세요.');
  if (!before.length || before.length > 500 || before.some(d => !Number.isInteger(d.ProdKey) || d.ProdKey <= 0 || !Number.isFinite(d.OutQuantity)))
    throw correctionError('CORRECTION_OLD_DETAILS_INVALID', '기존 입고에 미매칭 품목/수량이 있습니다. 원장 확인이 필요합니다.');
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
    for (const [a,b] of Object.entries(fields)) row[b] = item[a];
    if (input.editKind) row.SourceWdetailKey = item.sourceWdetailKey;
    row.OutQuantity = p.OutUnit === '박스' ? row.BoxQuantity : p.OutUnit === '단' ? row.BunchQuantity : row.SteamQuantity;
    row.EstQuantity = p.EstUnit === '박스' ? row.BoxQuantity : p.EstUnit === '단' ? row.BunchQuantity : row.SteamQuantity;
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
