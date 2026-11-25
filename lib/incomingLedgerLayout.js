export function incomingRowKind(row) {
  if (row.IsWeightRow || [3100,3101].includes(Number(row.ProdKey))) return 'weight';
  if (Number(row.ProdKey) === 2182) return 'freight';
  return 'goods';
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
