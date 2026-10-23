// Stored receipt boxes only. No master-data unit conversion or ERP writes.
export const WAREHOUSE_BOX_SQL = `SELECT wm.OrderYear, wm.OrderWeek, wm.WarehouseKey,
 CONVERT(varchar(10),wm.InputDate,23) AS inputDate,
 wm.GrossWeight AS gw, wm.ChargeableWeight AS cw,
 COALESCE(NULLIF(LTRIM(RTRIM(p.CounName)),N''),N'미분류') AS country,
 COALESCE(NULLIF(LTRIM(RTRIM(p.FlowerName)),N''),N'미분류') AS flower,
 SUM(CAST(wd.BoxQuantity AS DECIMAL(28,6))) AS boxes,
 SUM(CASE WHEN wd.BoxQuantity IS NULL THEN 1 ELSE 0 END) AS missingBoxes,
 COUNT(*) AS lineCount, COUNT(DISTINCT wm.WarehouseKey) AS receiptCount
 FROM WarehouseMaster wm
 JOIN WarehouseDetail wd ON wd.WarehouseKey=wm.WarehouseKey
 LEFT JOIN Product p ON p.ProdKey=wd.ProdKey
 WHERE wm.isDeleted=0 AND wm.OrderYear>=@year AND wm.OrderYear<=@toYear
 GROUP BY wm.OrderYear, wm.OrderWeek, wm.WarehouseKey, wm.InputDate,
 wm.GrossWeight, wm.ChargeableWeight, p.CounName, p.FlowerName`;

export function boxSummaryYear(value) {
  if (typeof value !== 'string' || !/^20\d{2}$/.test(value)) throw new Error('조회 연도는 2000~2099로 입력하세요.');
  return value;
}
export function filterBoxSummary(rows, { year, week = '', country = '', flower = '' }) {
  boxSummaryYear(String(year));
  return rows.filter(row => String(row.OrderYear) === String(year)
    && (!week || row.OrderWeek === week) && (!country || row.country === country)
    && (!flower || row.flower === flower)).sort((a,b) => String(a.OrderWeek).localeCompare(String(b.OrderWeek), undefined, { numeric:true })
      || a.country.localeCompare(b.country,'ko') || a.flower.localeCompare(b.flower,'ko'));
}
export function boxSummaryTotals(rows) {
  return rows.reduce((sum,row) => ({ boxes: Math.round((sum.boxes + Number(row.boxes ?? 0))*1e6)/1e6,
    missingBoxes: sum.missingBoxes + Number(row.missingBoxes || 0), lineCount:sum.lineCount+Number(row.lineCount||0) }),
  { boxes:0, missingBoxes:0, lineCount:0 });
}

export function boxSummaryRange(year, toYear = year) {
  boxSummaryYear(year); boxSummaryYear(toYear);
  if (+toYear < +year || +toYear - +year > 9) throw new Error('조회 기간은 시작 연도부터 최대 10년까지 선택하세요.');
  return { year, toYear };
}

export function createBoxSummaryHandler({queryFn,types}) {
  return async function(req,res){
    res.setHeader('Cache-Control','private, no-store');
    if(req.method!=='GET')return res.status(405).json({success:false,error:'조회만 가능한 메뉴입니다.'});
    let year,toYear;
    try{({year,toYear}=boxSummaryRange(req.query.year,req.query.toYear??req.query.year));}
    catch(error){return res.status(400).json({success:false,error:error.message});}
    try{
      const result=await queryFn(WAREHOUSE_BOX_SQL,{year:{type:types.NVarChar,value:year},toYear:{type:types.NVarChar,value:toYear}});
      return res.status(200).json({success:true,year,toYear,rows:result.recordset,source:'WarehouseDetail.BoxQuantity / WarehouseMaster.GrossWeight,ChargeableWeight'});
    }catch{return res.status(500).json({success:false,error:'입고 박스·중량 조회에 실패했습니다. 잠시 후 새로고침해 주세요.'});}
  };
}

const round = n => Math.round(n * 1e6) / 1e6;
const weight = n => n == null || n === '' || !Number.isFinite(Number(n)) ? null : Number(n);
const nullableSum = (a,b) => b == null ? a : round((a ?? 0)+b);
const label = n => String(n ?? '').trim() || '미분류';

// Shared by the screen and isolated SQL integration tests. No unit estimation.
export function summarizeReceipts(input, { year, toYear = year, period = 'week', dimension = 'both', week = '', month = '', country = '', flower = '' }) {
  boxSummaryRange(year,toYear);
  if (!['week','month','year'].includes(period) || !['both','country','flower'].includes(dimension)) throw new Error('조회 구분을 확인하세요.');
  const rows=input.filter(r => String(r.OrderYear)>=year && String(r.OrderYear)<=toYear
    && (!week || r.OrderWeek===week) && (!month || String(r.inputDate||'').slice(0,7)===month))
    .map(r=>({...r,country:label(r.country),flower:label(r.flower)}));
  const selected=r=>(!country||r.country===country)&&(!flower||r.flower===flower);
  const periodOf=r=>period==='week'?`${r.OrderYear}/${r.OrderWeek}`:period==='year'?String(r.OrderYear):String(r.inputDate||'').slice(0,7)||'입고일 미기재';
  const keyOf=r=>JSON.stringify([periodOf(r),dimension==='flower'?'전체':r.country,dimension==='country'?'전체':r.flower]);
  const groups=new Map(), receipts=new Map();
  for(const r of rows){
    const receiptKey=String(r.WarehouseKey);
    if(!receipts.has(receiptKey)) receipts.set(receiptKey,[]);
    receipts.get(receiptKey).push(r);
    if(!selected(r))continue;
    const key=keyOf(r);
    if(!groups.has(key))groups.set(key,{key,period:periodOf(r),country:dimension==='flower'?'전체':r.country,flower:dimension==='country'?'전체':r.flower,boxes:null,missingBoxes:0,lineCount:0,receiptKeys:new Set(),gw:null,cw:null,missingGW:0,missingCW:0,mixedReceipts:0});
    const g=groups.get(key);
    g.boxes=nullableSum(g.boxes,weight(r.boxes));g.missingBoxes+=Number(r.missingBoxes||0);g.lineCount+=Number(r.lineCount||0);g.receiptKeys.add(receiptKey);
  }
  const mixed=[];
  let gw=null,cw=null,missingGW=0,missingCW=0,receiptCount=0;
  for(const [id,lines] of receipts){
    const visible=lines.filter(selected);if(!visible.length)continue;
    receiptCount++;
    const header=lines[0], wgw=weight(header.gw),wcw=weight(header.cw);
    // A partial filter must not reassign the whole receipt's weight to its remaining flower.
    const allKeys=new Set(lines.map(keyOf));
    if(allKeys.size===1 && visible.length===lines.length){
      const g=groups.get(keyOf(header));
      g.gw=nullableSum(g.gw,wgw);g.cw=nullableSum(g.cw,wcw);
      g.missingGW+=wgw==null?1:0;g.missingCW+=wcw==null?1:0;
      gw=nullableSum(gw,wgw);cw=nullableSum(cw,wcw);
      missingGW+=wgw==null?1:0;missingCW+=wcw==null?1:0;
    }else{
      mixed.push({warehouseKey:id,period:periodOf(header),country:[...new Set(lines.map(r=>r.country))].join(' · '),flower:[...new Set(lines.map(r=>r.flower))].join(' · '),gw:wgw,cw:wcw,partial:visible.length!==lines.length});
      for(const key of new Set(visible.map(keyOf)))groups.get(key).mixedReceipts++;
    }
  }
  const grouped=[...groups.values()].map(({receiptKeys,...r})=>({...r,receiptCount:receiptKeys.size})).sort((a,b)=>a.period.localeCompare(b.period,'ko',{numeric:true})||a.country.localeCompare(b.country,'ko')||a.flower.localeCompare(b.flower,'ko'));
  return {rows:grouped,mixed,totals:{...boxSummaryTotals(grouped),receiptCount,gw,cw,missingGW,missingCW,
    mixedGW:mixed.reduce((s,r)=>nullableSum(s,r.gw),null),mixedCW:mixed.reduce((s,r)=>nullableSum(s,r.cw),null)}};
}
