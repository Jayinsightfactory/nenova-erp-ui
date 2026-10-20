// Pure reconciliation. Never merge unknown units or fuzzy names automatically.
import { normalizePnlPeriod } from './raumPnlPeriod.js';
export const analysisPeriod = value => normalizePnlPeriod(value,{allowSubPeriod:true});
export const clean = value => String(value ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim();
export const itemIdentity = row => JSON.stringify([clean(row.name), clean(row.unit)]);
export const receiptIdentity = row => JSON.stringify([clean(row.code), clean(row.name), clean(row.spec), clean(row.unit)]);
const number = value => value === null || value === undefined || clean(value) === '' ? null : Number.isFinite(Number(value)) ? Number(value) : null;
export function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return false;
  const d = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(+d) && d.toISOString().slice(0,10) === value;
}
export function validateScope({ year, from, to, periods }) {
  if (!/^20\d{2}$/.test(String(year))) throw new Error('결산 연도를 확인하세요.');
  if (!validDate(from) || !validDate(to) || from > to || from.slice(0,4) !== String(year) || to.slice(0,4) !== String(year)) throw new Error('입고기간은 선택 연도 안에서 시작일과 종료일을 지정하세요.');
  if (!Array.isArray(periods) || !periods.length || periods.length > 100 || new Set(periods.map(analysisPeriod)).size !== periods.length) throw new Error('대조할 원본 차수를 선택하세요.');
}
export function receiptGroups(rows) {
  const groups = new Map();
  for (const row of rows) {
    const key = receiptIdentity(row);
    if (!groups.has(key)) groups.set(key, { key, name:row.name, code:row.code, spec:row.spec, unit:row.unit, rows:[] });
    groups.get(key).rows.push(row);
  }
  return [...groups.values()];
}
function aggregate(rows) {
  if (!rows.length) return null;
  const sum = field => rows.some(r=>number(r[field]) === null) ? null : rows.reduce((a,r)=>a+number(r[field]),0);
  const prices = [...new Set(rows.map(r=>number(r.price)))].sort((a,b)=>(a??0)-(b??0));
  const buckets=new Map();
  for(const row of rows) {const key=number(row.price);buckets.set(key,(buckets.get(key)||0)+(number(row.qty)||0));}
  const costPrices=rows.some(r=>Object.hasOwn(r,'costPrice'))?[...new Set(rows.map(r=>number(r.costPrice)))].sort((a,b)=>(a??0)-(b??0)):null;
  return { qty:sum('qty'), amount:sum('amount'), prices, buckets:[...buckets].sort((a,b)=>(a[0]??0)-(b[0]??0)), costPrices, count:rows.length, rows };
}
const differs = (a,b,tolerance) => a === null || b === null ? null : Math.abs(a-b) > tolerance;
function compare(a,b) {
  if (!a || !b) return { status:'자료 없음', qty:null, amount:null, price:null };
  const qty = a.qty === null || b.qty === null ? null : a.qty-b.qty;
  const amount = a.amount === null || b.amount === null ? null : a.amount-b.amount;
  const price = a.prices.includes(null) || b.prices.includes(null) ? null : a.prices.length !== b.prices.length || a.prices.some((p,i)=>Math.abs(p-b.prices[i])>0.01);
  const bucketDifference=price===false && a.buckets.some((v,i)=>Math.abs(v[1]-b.buckets[i][1])>0.000001);
  const costPrice = a.costPrices&&b.costPrices ? (a.costPrices.includes(null)||b.costPrices.includes(null)?null:a.costPrices.length!==b.costPrices.length||a.costPrices.some((p,i)=>Math.abs(p-b.costPrices[i])>0.01)) : undefined;
  const unknown = qty === null || amount === null || price === null || costPrice===null;
  const mismatch = differs(a.qty,b.qty,0.000001) || differs(a.amount,b.amount,1) || price || costPrice || bucketDifference;
  return { status:mismatch ? '차이' : unknown ? '값 누락' : '일치', qty, amount, price, costPrice, bucketDifference };
}
export function reconcileShilla({ scope, db, excel, receipts, mappings = {}, excelGross = false }) {
  validateScope(scope);
  scope={...scope,periods:scope.periods.map(analysisPeriod)};
  if (typeof excelGross !== 'boolean' || !Array.isArray(receipts) || receipts.length > 50000) throw new Error('분석 입력 형식이 올바르지 않습니다.');
  const inScope = row => String(row.year) === String(scope.year) && scope.periods.includes(analysisPeriod(row.period));
  const normalized=rows=>rows.filter(inScope).map(row=>({...row,period:analysisPeriod(row.period)}));
  const d = normalized(db), x = normalized(excel);
  const issues = [], ids = new Set();
  const portal = receipts.map((r,index)=>{
    if (!validDate(r.date) || r.date < scope.from || r.date > scope.to) throw new Error('입고 조회기간 밖의 행이 있습니다. 다시 조회하세요.');
    for (const key of ['name','unit','code','spec','receiptNo','receiptItem','site']) if (typeof r[key] !== 'string' || r[key].length>500) throw new Error('입고 원본 열 형식이 올바르지 않습니다.');
    for (const key of ['qty','price','amount']) if (number(r[key]) === null) throw new Error('입고 수량·단가·금액이 누락되었습니다.');
    const id = JSON.stringify([r.date.slice(0,4),r.site,r.receiptNo,r.receiptItem]);
    if (!r.receiptNo || !r.receiptItem) issues.push(`입고 ${index+1}행: 전표 번호 또는 항목 누락`);
    else if(ids.has(id)) issues.push(`입고 중복 의심: ${r.receiptNo}/${r.receiptItem} (${r.date})`);
    ids.add(id);
    if(Math.abs(Number(r.qty)*Number(r.price)-Number(r.amount))>1) issues.push(`입고 ${r.receiptNo}/${r.receiptItem}: 수량×단가와 금액 차이`);
    return {...r,source:`${r.date} ${r.receiptNo}/${r.receiptItem}`};
  });
  const targets = new Map([...d,...x].map(r=>[itemIdentity(r),{key:itemIdentity(r),name:r.name,unit:r.unit}]));
  const mapped = [], unmatched = [];
  for(const group of receiptGroups(portal)) {
    const explicit = mappings[group.key];
    const exactKey = itemIdentity(group);
    const mapping = explicit || (targets.has(exactKey) && !clean(group.spec) ? {target:exactKey,factor:1,unitConfirmed:true} : null);
    if(!mapping || !targets.has(mapping.target)) { unmatched.push(group); continue; }
    const factor = number(mapping.factor);
    const target = targets.get(mapping.target);
    if(factor === null || factor <= 0 || factor>10000) throw new Error('수량 환산배수는 0보다 크고 10,000 이하여야 합니다.');
    if ((clean(target.unit)!==clean(group.unit) || factor!==1) && mapping.unitConfirmed!==true) { unmatched.push({...group,reason:'단위 환산 확인 필요'}); continue; }
    for(const row of group.rows) mapped.push({...row,key:mapping.target,qty:Number(row.qty)*factor,price:Number(row.price)/factor,amount:Number(row.amount),factor});
  }
  const divisor = excelGross ? 1.1 : 1;
  const adjusted = rows => rows.map(r=>({...r,price:number(r.price)===null?null:Number(r.price)/divisor,amount:number(r.amount)===null?null:Number(r.amount)/divisor}));
  const results = [...targets.values()].map(target=>{
    const dr = aggregate(adjusted(d.filter(r=>itemIdentity(r)===target.key)));
    const xr = aggregate(adjusted(x.filter(r=>itemIdentity(r)===target.key)));
    const sr = aggregate(mapped.filter(r=>r.key===target.key));
    const dbExcel = compare(dr,xr), excelSrm = compare(xr,sr);
    return {...target,db:dr,excel:xr,srm:sr,dbExcel,excelSrm,status:dbExcel.status==='일치'&&excelSrm.status==='일치'?'일치':'확인 필요'};
  });
  // Period-level comparison cannot be hidden by offsetting differences across weeks.
  const periodDifferences = [];
  for(const period of scope.periods) for(const target of targets.values()) {
    const a = aggregate(d.filter(r=>r.period===period && itemIdentity(r)===target.key));
    const b = aggregate(x.filter(r=>r.period===period && itemIdentity(r)===target.key));
    if(!a&&!b) continue;
    const diff=compare(a,b);
    if(diff.status!=='일치') periodDifferences.push({period,name:target.name,unit:target.unit,db:a,excel:b,...diff});
  }
  return {scope,rows:results,unmatched,issues,periodDifferences,counts:{db:d.length,excel:x.length,srm:portal.length,matched:results.filter(r=>r.status==='일치').length,review:results.filter(r=>r.status!=='일치').length},totals:{db:aggregate(adjusted(d))?.amount??null,excel:aggregate(adjusted(x))?.amount??null,srm:aggregate(portal)?.amount??null},complete:results.length>0&&!unmatched.length&&!issues.length&&!periodDifferences.length&&results.every(r=>r.status==='일치')};
}
