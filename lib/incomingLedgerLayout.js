export function incomingRowKind(row) {
  if (row.IsWeightRow || [3100,3101].includes(Number(row.ProdKey))) return 'weight';
  if (Number(row.ProdKey) === 2182) return 'freight';
  return 'goods';
}

const finiteOrNull = value => {
  if (value == null || value === '' || typeof value === 'boolean') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

// Header values entered on the web win; native packing uploads keep GW/CW/운송료
// only as Product detail rows, and web invoice receipts keep non-USD charges in
// the committed document. Zero stays zero; absent stays absent.
export function incomingMasterCosts(row = {}) {
  const headerGw = finiteOrNull(row.GrossWeight);
  const headerCw = finiteOrNull(row.ChargeableWeight);
  const detailGw = finiteOrNull(row.DetailGrossWeight);
  const detailCw = finiteOrNull(row.DetailChargeableWeight);
  const detailFreight = finiteOrNull(row.DetailFreightAmount);
  const documentFreight = finiteOrNull(row.DocFreightAmount);
  const documentCurrency = /^[A-Z]{3}$/.test(String(row.DocFreightCurrency || '')) ? row.DocFreightCurrency : '';
  return {
    gw: headerGw ?? detailGw,
    gwSource: headerGw != null ? 'header' : detailGw != null ? 'detail' : null,
    cw: headerCw ?? detailCw,
    cwSource: headerCw != null ? 'header' : detailCw != null ? 'detail' : null,
    freight: detailFreight ?? documentFreight,
    freightCurrency: detailFreight != null ? '' : documentFreight != null ? documentCurrency : '',
    freightSource: detailFreight != null ? 'detail' : documentFreight != null ? 'document' : null,
  };
}

export function incomingCostLabel(value, currency = '') {
  if (value == null) return '';
  const amount = value.toLocaleString('ko-KR', { maximumFractionDigits: 2 });
  return currency ? `${amount} ${currency}` : amount;
}

const textPixels = value => [...String(value ?? '')].reduce((width,character) =>
  width+(/^[\u0000-\u007f]$/.test(character)?8:14),0);

export function incomingColumnWidth(values,{min=42,max=240,padding=14}={}) {
  const largest = values.reduce((width,value)=>Math.max(width,textPixels(value)),0);
  return Math.min(max,Math.max(min,largest+padding));
}

export function incomingQuantityWidth(rows,key,format,{label,min=42,padding=14,include=()=>true,suggestion}={}) {
  const goods=rows.filter(include);
  const sum=goods.reduce((total,row)=>total+(Number(row[key])||0),0);
  return incomingColumnWidth([
    label,format(sum),...goods.map(row=>row[key]==null&&suggestion?suggestion(row):format(row[key])),
  ],{min,padding});
}
