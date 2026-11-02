import {jamoMatch} from './displayName.js';

const identity = c => JSON.stringify([String(c.CustName||'').trim(),String(c.CustArea||c.area||'').trim()]);
export function stockSalesPeriod(now=new Date()) {
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'numeric'}).formatToParts(now);
  const year=Number(parts.find(p=>p.type==='year').value),month=Number(parts.find(p=>p.type==='month').value);
  return {year,month,label:`${month===1?year-1:year}년 ${month===1?12:month-1}월~${year}년 ${month}월 매출순`};
}
export function stockCustomerResults(customers,sales,keyword='') {
  const amounts=new Map();
  for(const c of sales||[]){const key=identity(c);amounts.set(key,(amounts.get(key)||0)+Number(c.curSales||0)+Number(c.prevSales||0));}
  return customers.filter(c=>!keyword.trim()||jamoMatch(keyword,c.CustName)).map(c=>({...c,sales:amounts.get(identity(c))??0}))
    .sort((a,b)=>b.sales-a.sales||String(a.CustName).localeCompare(String(b.CustName),'ko')||Number(a.CustKey)-Number(b.CustKey));
}
