// Snapshot observation time is not the edit time; scheduler Actor is never an editor.
import { diffRowSets } from './salesSnapshotPolicy.js';
export function buildSalesObservationEvents(beforeRows, afterRows, { custKey, week, observedAt, observationKey }) {
  const groups = diffRowSets(beforeRows, afterRows).byCust;
  const group = groups.find(g => Number(g.custKey) === Number(custKey));
  return (group?.items || []).filter(i => i.kind !== 'same').map(i => ({
    ...i, OrderWeek: week, changeDtm: observedAt, observed: true,
    eventKey: `${week}-${observationKey}-${i.rowType}-${i.refKey}`,
  }));
}

const alias = {
  '아이엠（미우）': '아이엠', '아이엠 (I am)': '아이엠', '인터넷공판장 (영남가빈)': '인터넷공판장 (원협가빈)',
  '동산(꽃동산)': '동산', '(주)꽃동산': '동산', '대전 꽃부리영': '대전 봄날', '대전 봄날(대전 꽃부리영)': '대전 봄날',
  '신라호텔 발주용 코드': '신라호텔', '날마다, 꽃（매일）': '날마다, 꽃', '탑플라워（청목）': '탑플라워',
  '구백의 천사': '레바논 꽃방', '화사랑': '수아레', '청목소재': '탑플라워', '농업회사법인 주식회사 로뎀': '로뎀농원',
  '경남꽃도매': '경남꽃도매(영남4호)', '경향': '경향농원', '주식회사 에이스화훼무역': '에이스플라워',
};
const custAlias = (x) => alias[String(x || '').trim()] || String(x || '').trim();


const normalize = value => String(value || '').toLowerCase().replace(/[\s()\[\]（）\/.,·\-_]/g, '');
const productName = value => normalize(String(value || '').replace(/\([^)]*\)|（[^）]*）|\[[^\]]*\]/g, ''));
const num = n => Number(n ?? 0);
// Exact existing ECOUNT comparison aliases, no fuzzy or amount-based matching.
export function compareEcountSales({ ecountRows, currentRows, customers = [], estimateTypes = {} }) {
  const identities = new Map();
  for (const c of customers) {
    const key = normalize(custAlias(c.CustName));
    if (!identities.has(key)) identities.set(key, new Set());
    identities.get(key).add(Number(c.CustKey));
  }
  const groups = new Map();
  function customer(name, custKey) {
    const nameKey = normalize(custAlias(name));
    const candidates = identities.get(nameKey);
    const resolved = custKey ?? (candidates?.size === 1 ? [...candidates][0] : null);
    const key = resolved == null ? `unmatched:${nameKey}` : `cust:${resolved}`;
    if (!groups.has(key)) groups.set(key, { key, custKey: resolved, custName: custAlias(name), baseTotal:0, currTotal:0, items:new Map() });
    return groups.get(key);
  }
  function add(group, name, side, values, ref) {
    const key = productName(name);
    if (!group.items.has(key)) group.items.set(key,{prodName:name,kind:'same',refs:[],before:null,after:null});
    const item = group.items.get(key);
    const target = item[side] ||= {estQty:0,outQty:0,amount:0,vat:0,total:0,unit:values.unit || '',estType:values.estType || '',unitPrices:[],priceQuantities:[]};
    for (const field of ['estQty','outQty','amount','vat','total']) target[field] += num(values[field]);
    if (!target.unitPrices.includes(num(values.unitPrice))) target.unitPrices.push(num(values.unitPrice));
    const bucket=target.priceQuantities.find(b=>b.unitPrice===num(values.unitPrice));
    if(bucket)bucket.qty+=num(values.estQty);else target.priceQuantities.push({unitPrice:num(values.unitPrice),qty:num(values.estQty)});
    target.priceQuantities.sort((a,b)=>a.unitPrice-b.unitPrice);
    target.unitPrices.sort((a,b)=>a-b);target.unitPrice=target.unitPrices[0];
    if (ref) item.refs.push(ref);
    group[side === 'before' ? 'baseTotal' : 'currTotal'] += num(values.total);
  }
  for (const r of ecountRows) {
    const g=customer(r.custName);
    add(g,r.prodName,'before',{estQty:r.qty,unitPrice:r.unitPrice,amount:r.supplyAmt,vat:r.vat,total:num(r.supplyAmt)+num(r.vat)});
  }
  for (const r of currentRows) {
    const name=r.RowType==='EST' ? (estimateTypes[r.EstimateType] || r.EstimateType || r.ProdName) : r.ProdName;
    add(customer(r.CustName,r.CustKey),name,'after',{estQty:r.EstQuantity,outQty:r.OutQuantity,unitPrice:r.Cost,amount:r.Amount,vat:r.Vat,total:num(r.Amount)+num(r.Vat),unit:r.EstUnit,estType:r.EstimateType},{rowType:r.RowType,refKey:r.RefKey,prodKey:r.ProdKey});
  }
  const byCust=[];
  let baseTotal=0,currTotal=0;
  for (const group of groups.values()) {
    baseTotal+=group.baseTotal;currTotal+=group.currTotal;
    const items=[];
    for (const item of group.items.values()) {
      const b=item.before,a=item.after;
      if (!b) item.kind='added'; else if (!a) item.kind='removed';
      else if (['estQty','amount','vat'].some(f=>Math.abs(b[f]-a[f])>0.001) || JSON.stringify(b.unitPrices)!==JSON.stringify(a.unitPrices) || b.priceQuantities.some((bucket,index)=>Math.abs(bucket.qty-(a.priceQuantities[index]?.qty ?? 0))>0.001))item.kind='changed';
      if (item.kind!=='same')items.push({...item,rowType:item.refs[0]?.rowType,refKey:item.refs[0]?.refKey});
    }
    if(items.length)byCust.push({...group,items,delta:group.currTotal-group.baseTotal});
  }
  byCust.sort((a,b)=>Math.abs(b.delta)-Math.abs(a.delta));
  return {byCust,baseTotal,currTotal};
}

export function salesHistoryKst(utcSqlTime) {
  const utc = new Date(String(utcSqlTime).replace(' ', 'T') + 'Z');
  return new Date(utc.getTime()+9*3600000).toISOString().slice(0,19).replace('T',' ');
}

export function salesReviewItemMatchesEvent(item, event) {
  const refs = item.refs || [item];
  const rowType = event.rowType || 'SD';
  const refKey = event.refKey ?? event.SdetailKey;
  return refs.some(r => r.rowType===rowType && Number(r.refKey)===Number(refKey))
    || (refs.length===0 && productName(item.prodName)===productName(event.prodName || event.ProdName));
}
