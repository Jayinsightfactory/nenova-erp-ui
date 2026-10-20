// Read-only candidates: numeric equality is evidence, not a shared shipment/receipt ID.
const dateOK=v=>/^\d{4}-\d{2}-\d{2}$/.test(v||'')&&!Number.isNaN(Date.parse(v));
const day=v=>Date.parse(`${v}T12:00:00Z`)/86400000;
const iso=v=>new Date(v*86400000).toISOString().slice(0,10);
const finite=v=>v!==null&&v!==undefined&&v!==''&&Number.isFinite(Number(v));
const unit=v=>['EA','스팀','송이'].includes(v)?'송이':v;
const sum=(rows,key)=>rows.length&&rows.every(r=>finite(r[key]))?rows.reduce((s,r)=>s+Number(r[key]),0):null;
function totals(rows) {
  const buckets=new Map();
  for(const r of rows) {
    if(!finite(r.qty)||!finite(r.price)) return {qty:sum(rows,'qty'),amount:sum(rows,'amount'),buckets:null};
    const p=Math.round(Number(r.price)*100)/100;buckets.set(p,(buckets.get(p)||0)+Number(r.qty));
  }
  return {qty:sum(rows,'qty'),amount:sum(rows,'amount'),buckets:[...buckets].sort((a,b)=>a[0]-b[0])};
}
function equal(a,b) {
  return a.qty!=null&&b.qty!=null&&a.amount!=null&&b.amount!=null&&a.buckets&&b.buckets
    &&Math.abs(a.qty-b.qty)<0.000001&&Math.abs(a.amount-b.amount)<=1
    &&a.buckets.length===b.buckets.length&&a.buckets.every(([p,q],i)=>Math.abs(p-b.buckets[i][0])<=0.01&&Math.abs(q-b.buckets[i][1])<0.000001);
}
const group=(rows,key)=>{const m=new Map();for(const r of rows){const k=key(r);if(!m.has(k))m.set(k,[]);m.get(k).push(r);}return [...m];};
const receiptID=r=>JSON.stringify([r.date,r.site,r.receiptNo,r.receiptItem]);
export function analyzeShillaPeriods({scope,rows,distribution,periods,receipts}) {
  const erp=distribution.filter(r=>String(r.year)===String(scope.year));
  if(new Set(erp.map(r=>r.id)).size!==erp.length) throw new Error('전산 분배 원본키가 중복됩니다.');
  const dateByPeriod=new Map(periods.map(p=>[p.period,p.date]));
  const lines=[];
  for(const target of rows) {
    for(const [period,x] of group(target.excel?.rows||[],r=>r.period)) {
      const anchor=dateByPeriod.get(period),excel=totals(x),major=String(Number(period.split('-')[0]));
      const eligible=erp.filter(r=>target.prodKey&&Number(r.prodKey)===Number(target.prodKey)&&unit(r.unit)===unit(target.unit)
        &&(dateOK(anchor)&&dateOK(r.date)?Math.abs(day(r.date)-day(anchor))<=14:String(Number(r.week.split('-')[0]))===major));
      const candidates=group(eligible,r=>r.week).map(([week,items])=>({week,...totals(items),rows:items}));
      const exact=candidates.filter(c=>equal(excel,c));
      const same=candidates.filter(c=>String(Number(c.week.split('-')[0]))===major);
      const chosen=exact.length===1?exact[0]:exact.length===0&&same.length===1?same[0]:null;
      const portal=(target.srm?.rows||[]).filter(r=>dateOK(anchor)&&Math.abs(day(r.date)-day(anchor))<=14);
      const windows=new Map();
      const add=(label,rs)=>{const signature=rs.map(receiptID).sort().join('|');if(!windows.has(signature)) windows.set(signature,{label,rows:rs,...totals(rs),signature});};
      for(const [d,rs] of group(portal,r=>r.date)) add(`입고일 ${d}`,rs);
      const weekdays=portal.filter(r=>![0,6].includes(new Date(`${r.date}T12:00:00Z`).getUTCDay()));
      for(const [monday,rs] of group(weekdays,r=>iso(day(r.date)-(new Date(`${r.date}T12:00:00Z`).getUTCDay()-1)))) {
        const friday=iso(day(monday)+4);
        // A truncated week is not evidence of a complete Monday-Friday aggregate.
        if(scope.from<=monday&&scope.to>=friday&&Math.abs(day(monday)-day(anchor))<=14&&Math.abs(day(friday)-day(anchor))<=14) add(`월~금 ${monday} ~ ${friday}`,rs);
      }
      const matches=[...windows.values()].filter(w=>equal(excel,w));
      const receipt=matches.length===1?matches[0]:null;
      const issue=!target.prodKey?'전산 품목 연결 필요':!chosen?'전산 후보 확인 필요':matches.length!==1?'입고 집계기간 확인 필요':
        equal(excel,chosen)?'세 자료 수치 일치 후보':'전산 분배 차이 후보';
      lines.push({key:`${target.key}/${period}`,period,name:target.name,prodKey:target.prodKey,unit:target.unit,anchor,excel,
        erp:chosen,candidates,receipt,receiptCandidateCount:matches.length,status:issue,
        qtyDifference:chosen?.qty!=null&&excel.qty!=null?chosen.qty-excel.qty:null,
        amountDifference:chosen?.amount!=null&&excel.amount!=null?chosen.amount-excel.amount:null});
    }
  }
  // Never let two workbook periods silently consume the same receipt or distribution row.
  for(const key of ['receipt','erp']) {
    const owners=new Map();
    for(const line of lines) for(const r of line[key]?.rows||[]) {
      const id=key==='erp'?String(r.id):receiptID(r);if(!owners.has(id))owners.set(id,new Set());owners.get(id).add(line.key);
    }
    for(const line of lines) if((line[key]?.rows||[]).some(r=>owners.get(key==='erp'?String(r.id):receiptID(r)).size>1)) {
      line.status='동일 원본 중복 연결 후보 — 확인 필요';line.conflict=true;
    }
  }
  const byMonth=new Map(group(receipts,r=>r.date.slice(0,7)));
  const monthKeys=[];
  let monthCursor=`${scope.from.slice(0,7)}-01`;
  while(monthCursor<=scope.to) {
    monthKeys.push(monthCursor.slice(0,7));
    const d=new Date(`${monthCursor}T12:00:00Z`);d.setUTCMonth(d.getUTCMonth()+1);monthCursor=d.toISOString().slice(0,10);
  }
  const months=monthKeys.map(month=>{
    const rs=byMonth.get(month)||[];
    const last=new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5,7)),0)).toISOString().slice(0,10);
    return {month,amount:rs.length?sum(rs,'amount'):0,count:rs.length,partial:scope.from>`${month}-01`||scope.to<last};
  }).sort((a,b)=>a.month.localeCompare(b.month));
  return {lines,months,distributionCount:erp.length,customer:'신라호텔',lookaroundDays:14,
    rule:'실제 입고일의 달 기준 · 세금계산서 발행본 대사는 별도',
    warning:'수치·기간 일치는 연결 후보입니다. 전산 차수와 엑셀 차수를 동일하다고 확정하지 않으며, 공통 전표번호가 없는 후보는 확인이 필요합니다.'};
}
