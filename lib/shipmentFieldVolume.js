import { palletText } from './shipmentPallet.js';
import { customerExportName } from './customerExportName.js';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import XLSX from 'xlsx';
import { shipmentExportLines } from './shipmentExportExcel.js';
import { assignmentsKey } from './shipmentFarmText.js';

const fail = message => { throw Object.assign(new Error(message), { statusCode: 409, code: 'FIELD_VOLUME_INVALID' }); };
const fmt = n => Number(n).toLocaleString('en-US', { maximumFractionDigits: 6 });
const close = (a,b) => Number.isFinite(Number(a)) && Number.isFinite(Number(b)) && Math.abs(Number(a)-Number(b)) < 0.000001;
const key = (cust,prod) => `${cust}|${prod}`;
export const FIELD_DAY_COLORS = ['FCE4D6','FFF2CC','E2F0D9','DDEBF7','E4DFEC','F4CCCC','D9EAF7'];

export function fieldThemeColor(color,palette) {
  if (/^[a-f\d]{8}$/i.test(color?.argb || '') && !/^00/.test(color.argb)) return color.argb.slice(2);
  const rgb=palette[color?.theme];if(!rgb)return null;
  const channels=rgb.match(/../g).map(c=>parseInt(c,16)/255),max=Math.max(...channels),min=Math.min(...channels),d=max-min;
  let l=(max+min)/2,s=d===0?0:d/(1-Math.abs(2*l-1)),h=0;
  if(d){const [r,g,b]=channels;h=max===r?((g-b)/d)%6:max===g?(b-r)/d+2:(r-g)/d+4;h=(h+6)%6/6;}
  const tint=Number(color.tint || 0);l=tint<0?l*(1+tint):l*(1-tint)+tint;
  const a=s*Math.min(l,1-l),channel=n=>{const k=(n+h*12)%12;return l-a*Math.max(-1,Math.min(k-3,9-k,1));};
  return [channel(0),channel(8),channel(4)].map(v=>Math.round(Math.max(0,Math.min(1,v))*255).toString(16).padStart(2,'0')).join('').toUpperCase();
}

export function farmWorkbookReadiness({isXlsx,farmErrors=[],layoutErrors=[],unmatched=[]}) {
  const valid = !farmErrors.length;
  return {canApplyFarm:valid && (isXlsx || !layoutErrors.length),
    canExportOriginal:valid && isXlsx && !layoutErrors.length && !unmatched.length,
    canPrepareField:valid && isXlsx && !unmatched.length};
}

// Keep original summary blanks distinct from zero; never add repeated per-customer summaries.
export async function fieldVolumePlan(buffer, preview, sourceWorkbook = null) {
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(buffer);
  // ExcelJS omits some shared-formula cached zero results. Read source numeric caches
  // from SheetJS, as the existing allocation parser does, and use ExcelJS for styles.
  const values=sourceWorkbook ?? XLSX.read(buffer,{type:'buffer'});
  const zip=await JSZip.loadAsync(buffer),theme=await zip.file('xl/theme/theme1.xml')?.async('string') || '';
  const palette=['lt1','dk1','lt2','dk2','accent1','accent2','accent3','accent4','accent5','accent6','hlink','folHlink'].map(name=>{
    const block=theme.match(new RegExp(`<(?:\\w+:)?${name}>([\\s\\S]*?)<\\/(?:\\w+:)?${name}>`))?.[1] || '';
    return block.match(/\b(?:lastClr|val)="([a-f\d]{6})"/i)?.[1];
  });
  const products = new Map(), customers = new Map(), colors = {}, sources = new Map(), sourceProducts = new Map(), headers = new Map(), factors = new Map();
  for(const row of preview.rows || [])if(Number(row.excelQty)>0) {
    const k=JSON.stringify([Number(row.prodKey),row.excelUnit || '']);
    const factor=Number(row.originalTotal ?? row.uploadQty)/Number(row.excelQty);
    if(!(factor>0) || !Number.isFinite(factor) || (factors.has(k)&&!close(factors.get(k),factor)))fail('같은 품목·원본 단위의 수량 환산이 서로 다릅니다. 다시 검증하세요.');
    factors.set(k,factor);
  }
  for (const row of preview.rows || []) {
    if (row.missingFromExcel || !row.prodKey || !row.custKey) continue;
    const p={prodKey:Number(row.prodKey), label:row.displayName || row.productLabel || row.prodName, unit:row.outUnit,
      family:row.productFamily || ''};
    const before=products.get(p.prodKey);
    if (before && before.unit!==p.unit) fail(`${p.label}: 원본의 출고 단위가 서로 다릅니다.`);
    if (!before) products.set(p.prodKey,p);
    if(!sources.has(p.prodKey))sources.set(p.prodKey,new Map());
    const factor=factors.get(JSON.stringify([p.prodKey,row.excelUnit || ''])) ?? (!row.excelUnit || row.excelUnit===row.outUnit ? 1 : NaN);
    // A customer/product can span several physical source rows (e.g. a stock-only row).
    // Count each physical row once, regardless of customer columns or repeated name blocks.
    for(const source of (row.cells || []).map(c=>String(c).match(/^(.*)!R(\d+)C(\d+)$/)).filter(Boolean)) {
      const [,sheetName,r,c]=source,sheet=wb.getWorksheet(sheetName),srcRow=Number(r),srcCol=Number(c);
      if(!sheet)fail('원본 수량 셀의 시트를 찾을 수 없습니다.');
      if(!headers.has(sheetName)){
        let header=0;
        for(let n=1;n<=Math.min(sheet.rowCount,12);n++){
          const labels=sheet.getRow(n).values;
          if(labels.includes('입고')&&(labels.includes('주문')||labels.includes('잔량'))){header=n;break;}
        }
        headers.set(sheetName,header);
      }
      const summaryRow=headers.get(sheetName),sourceKey=JSON.stringify([sheetName,srcRow]);
      if(sourceProducts.has(sourceKey)&&sourceProducts.get(sourceKey)!==p.prodKey)fail(`${p.label}: 같은 원본 행이 여러 DB 품목으로 연결됐습니다. 품목 매칭을 확인하세요.`);
      sourceProducts.set(sourceKey,p.prodKey);
      const summary=label=>{
        if(!summaryRow)return null;
        const col=sheet.getRow(summaryRow).values.indexOf(label);
        if(col<1)return null;
        const cell=values.Sheets[sheetName]?.[XLSX.utils.encode_cell({r:srcRow-1,c:col-1})];
        if(cell?.t==='e')fail(`${p.label}: 원본 입고·재고 요약 수식 오류를 확인하세요.`);
        const val=cell?.v;
        if(val==null||(typeof val==='string'&&!val.trim()))return null;
        if(!Number.isFinite(Number(val))||!Number.isFinite(factor)||factor<=0)fail(`${p.label}: 입고·재고 수량/환산을 확인하세요.`);
        return Number(val)*factor;
      };
      let incoming=summary('입고'),stock=summary('재고');
      const sourceOrder=summary('주문'),sourceRemain=summary('잔량');
      if(stock===null&&incoming!==null&&sourceOrder!==null&&sourceRemain!==null&&close(sourceRemain,incoming-sourceOrder))stock=0;
      if(incoming===null&&stock!==null&&sourceOrder!==null&&sourceRemain!==null&&close(sourceRemain,stock-sourceOrder))incoming=0;
      const previous=sources.get(p.prodKey).get(sourceKey);
      if(previous&&(previous.incoming!==incoming||previous.stock!==stock))fail(`${p.label}: 같은 원본 행의 입고·재고 환산이 서로 다릅니다.`);
      sources.get(p.prodKey).set(sourceKey,{incoming,stock});
      let region='';
      if(summaryRow>2){
        for(let n=srcCol;n>=1;n--){
          const text=String(sheet.getCell(summaryRow-2,n).text||'').trim();
          if(text){if(!/카네이션|장미|수국|\d{2}[-－]/.test(text))region=text.replace(/_/g,'');break;}
        }
        const cell=sheet.getCell(summaryRow-1,srcCol),day=String(cell.text).trim().replace(/요일$/,'');
        const rgb=fieldThemeColor(cell.fill?.fgColor,palette);
        if(/^[일월화수목금토]$/.test(day)&&rgb&&!colors[day])colors[day]=rgb;
      }
      const ck=Number(row.custKey),old=customers.get(ck);
      if(old?.region&&region&&old.region!==region)fail(`${row.custName}: 배송 지역이 여러 개입니다. 원본의 업체·지역 연결을 확인하세요.`);
      customers.set(ck,{custKey:ck,region:region||old?.region||'',name:row.custName});
    }
  }
  if(!products.size)fail('출력할 품목이 없습니다. 원본 파일과 품목 연결을 확인하세요.');
  for(const p of products.values()){
    const parts=[...sources.get(p.prodKey).values()];
    for(const field of ['incoming','stock'])p[field]=parts.length&&parts.every(part=>part[field]!==null)?parts.reduce((sum,part)=>sum+part[field],0):null;
  }
  return {kind:'field-volume-v2',orderYear:String(preview.orderYear),week:preview.week,products:[...products.values()],customers:[...customers.values()],colors,
    expected:(preview.rows || []).filter(r=>r.prodKey&&r.custKey).map(r=>({custKey:Number(r.custKey),prodKey:Number(r.prodKey),qty:Number(r.uploadQty),farms:r.farmAssignments ?? r.farmBefore ?? []})),errors:[]};
}

// Exact year and same major; the caller passes validated integer product keys only.
export function fieldVolumeSql(prodKeys) {
  if (!prodKeys.length || prodKeys.some(k=>!Number.isSafeInteger(k)||k<=0)) fail('품목 범위를 다시 검증하세요.');
  const scope=`sm.OrderYear=@year AND LEFT(sm.OrderWeek,2)=@major AND TRY_CONVERT(int,SUBSTRING(sm.OrderWeek,4,8)) BETWEEN 1 AND @minor
    AND ISNULL(sm.isDeleted,0)=0 AND sd.ProdKey IN (${prodKeys.join(',')})`;
  return {lines:`SELECT sm.OrderYear,sm.OrderWeek,sm.CustKey,c.CustName,c.Descr AS CustomerDescr,c.CustArea,sd.SdetailKey,sd.ProdKey,p.ProdName,p.OutUnit,
    sd.OutQuantity,dt.SdateKey,dt.ShipmentQuantity,CONVERT(nvarchar(23),dt.ShipmentDtm,121) AS Timestamp,
    (SELECT COUNT(*) FROM PeriodDay pd WHERE pd.OrderYearWeek=@year+@major AND CONVERT(datetime,pd.BaseYmd,121)=dt.ShipmentDtm) AS CalendarMatches
    FROM ShipmentMaster sm JOIN ShipmentDetail sd ON sd.ShipmentKey=sm.ShipmentKey
    JOIN Customer c ON c.CustKey=sm.CustKey JOIN Product p ON p.ProdKey=sd.ProdKey
    LEFT JOIN ShipmentDate dt ON dt.SdetailKey=sd.SdetailKey WHERE ${scope} AND sd.OutQuantity>0`,
    farms:`SELECT sm.OrderYear,sm.OrderWeek,sm.CustKey,sd.ProdKey,sd.SdetailKey,sf.FarmKey,sf.ShipmentQuantity,f.FarmName
    FROM ShipmentMaster sm JOIN ShipmentDetail sd ON sd.ShipmentKey=sm.ShipmentKey
    JOIN ShipmentFarm sf ON sf.SdetailKey=sd.SdetailKey LEFT JOIN Farm f ON f.FarmKey=sf.FarmKey WHERE ${scope}`};
}

export function fieldVolumeModel(plan, rawRows, farmRows) {
  const [major,minorText]=String(plan.week).split('-'),minor=Number(minorText);
  if (!/^\d{4}$/.test(plan.orderYear) || !/^\d{2}-\d{2}$/.test(plan.week) || !(minor>=1&&minor<=99)) fail('선택 연도·차수를 확인하세요.');
  const products=new Map(plan.products.map(p=>[p.prodKey,p]));
  const byWeek=new Map();
  for (const row of rawRows) {
    if (String(row.OrderYear)!==plan.orderYear || !products.has(Number(row.ProdKey)) || String(row.OrderWeek).split('-')[0]!==major || !(Number(String(row.OrderWeek).split('-')[1])>=1&&Number(String(row.OrderWeek).split('-')[1])<=minor)) fail('출력 범위 밖의 연도·차수·품목입니다.');
    if (!byWeek.has(row.OrderWeek)) byWeek.set(row.OrderWeek,[]);
    byWeek.get(row.OrderWeek).push(row);
  }
  const lines=[...byWeek].flatMap(([orderWeek,rows])=>shipmentExportLines(rows,{orderYear:plan.orderYear,orderWeek,custKey:null}));
  const details=new Map();
  for(const row of rawRows) {
    const prior=details.get(row.SdetailKey);
    if(prior && (prior.CustKey!==row.CustKey || prior.ProdKey!==row.ProdKey || prior.OrderWeek!==row.OrderWeek)) fail('중복 출고 상세 연결입니다.');
    details.set(row.SdetailKey,row);
  }
  const farms=new Map();
  for(const f of farmRows) {
    const d=details.get(f.SdetailKey);
    if(!d) {if(Number(f.ShipmentQuantity)!==0)fail('0 출고에 남은 농장배정을 확인하세요.');continue;}
    if(String(f.OrderYear)!==plan.orderYear || f.OrderWeek!==d.OrderWeek || f.CustKey!==d.CustKey || f.ProdKey!==d.ProdKey || !f.FarmName || !(Number(f.ShipmentQuantity)>0))fail('농장분배 연결을 확인하세요.');
    if(!farms.has(f.SdetailKey))farms.set(f.SdetailKey,[]);
    const list=farms.get(f.SdetailKey);
    if(list.some(x=>x.FarmKey===f.FarmKey))fail('같은 상세의 농장이 중복되었습니다.');
    list.push(f);
  }
  for(const [dk,fs] of farms)if(!close(fs.reduce((s,f)=>s+Number(f.ShipmentQuantity),0),details.get(dk).OutQuantity))fail('농장분배 합계와 출고수량이 다릅니다.');
  const current=new Map();
  for(const d of details.values())if(d.OrderWeek===plan.week){const k=key(d.CustKey,d.ProdKey);if(current.has(k))fail('업체·품목 출고 상세가 중복되었습니다.');current.set(k,d);}
  for(const expected of plan.expected){
    const d=current.get(key(expected.custKey,expected.prodKey));
    if(!close(d?.OutQuantity??0,expected.qty) || assignmentsKey(d?farms.get(d.SdetailKey):[])!==assignmentsKey(expected.farms))fail('아직 적용하지 않았거나 분배가 변경됐습니다. 수량·농장분배를 적용하고 다시 검증하세요.');
  }
  const customers=new Map(plan.customers.map(c=>[c.custKey,c]));
  const entries=new Map();
  for(const line of lines){
    const p=products.get(line.ProdKey);if(p.unit!==line.OutUnit)fail('품목 출고단위가 변경됐습니다. 다시 검증하세요.');
    const region=customers.get(line.CustKey)?.region || line.CustArea || '지역 미지정';
    const k=JSON.stringify([line.date,region,line.CustKey,line.ProdKey]);
    if(!entries.has(k))entries.set(k,{date:line.date,region,custKey:line.CustKey,customer:customerExportName(details.get(line.SdetailKey)),product:p,previous:0,current:0,details:[]});
    const e=entries.get(k);e[line.OrderWeek===plan.week?'current':'previous']+=line.qty;e.details.push(line.SdetailKey);
  }
  const totals=new Map(plan.products.map(p=>[p.prodKey,{...p,outgoing:0}]));
  for(const d of current.values())totals.get(d.ProdKey).outgoing+=Number(d.OutQuantity);
  return {entries:[...entries.values()],totals:[...totals.values()],farms,details,lines};
}

export async function createFieldVolumeWorkbook(plan,rawRows,farmRows){
  return renderFieldVolumeWorkbook(plan,fieldVolumeModel(plan,rawRows,farmRows));
}

function render(line){
 const out=[];
 line.forEach((x,i)=>{
 const prev=line[i-1],day=x.day.text!==prev?.day.text;
 if(i)out.push({text:day?'   ':' / '});
 if(day)out.push(x.day);
 if(day||x.region.text!==prev.region.text)out.push(x.region);
 out.push(x.body);if(x.tail)out.push(x.tail);
 });return out;
}
function width(line){return Array.from(render(line).map(r=>r.text).join('')).reduce((n,c)=>n+(c.charCodeAt(0)>255?14:/[il .]/.test(c)?4:8),0);}
function layout(slots,limit){
 const lines=[];
 for(let start=0;start<slots.length;){
 let end=start+1;
 while(end<slots.length&&end-start<limit&&width(slots.slice(start,end+1))<=1170)end++;
 if(end<slots.length){
 for(const key of ['day','region']){
 let cut=end;
 for(let j=end;j>=Math.max(start+1,end-2);j--){
 if(slots[j][key].text!==slots[j-1][key].text){cut=j;break;}
 }
 if(cut!==end||slots[end][key].text!==slots[end-1][key].text){end=cut;break;}
 }}
 lines.push(slots.slice(start,end));start=end;
 }return lines;
}
const dayInk={목:'466521',금:'146077',일:'923D57',월:'625395',화:'874915',수:'465983',토:'79423E'};
const regionInk={'지방':'9E470D','양재동':'1658A0','경부선':'23713D','경부선주광':'846000','호남선':'753E91','호텔':'167469'};
const familyName={carnation:'카네이션',minicarnation:'카네이션',rose:'장미',hydrangea:'수국',ruscus:'루스커스',alstroemeria:'알스트로'};
function ink(text,color){return {text,font:{name:'맑은 고딕',size:10,bold:true,color:{argb:'FF'+(color||'444444')}}};}

export async function renderFieldVolumeWorkbook(plan,model){
  const wb=new ExcelJS.Workbook();
  const ws=wb.addWorksheet('현장물량표',{pageSetup:{paperSize:8,orientation:'portrait',scale:57,fitToPage:true,fitToWidth:1,fitToHeight:0,printTitlesRow:'1:2',margins:{left:0,right:0,top:0,bottom:0,header:0,footer:0}},views:[{state:'frozen',xSplit:1,ySplit:2}]});
  [30,2,172.625,7,7,7,7].forEach((w,i)=>ws.getColumn(i+1).width=w);
  ws.getColumn(2).hidden=true;
  ws.mergeCells('A1:G1');
  ws.getCell('A1').value=[plan.week,[...new Set(plan.products.map(p=>familyName[p.family]||p.family))].join('·'),'현장물량표'].join(' ');
  ws.getRow(2).values=['품종',null,'출고요일 · 지역별 업체 수량 (농장분배)','입고','출고','재고','잔량'];
  const side={style:'thin',color:{argb:'FFA5AEB5'}};
  function style(row){
    for(let c=1;c<=7;c++){
      const cell=row.getCell(c);
      cell.border={left:side,right:side,top:side,bottom:side};
      cell.font={name:'맑은 고딕',size:10};
      cell.alignment={horizontal:c===1?'right':c>=4?'center':'left',vertical:'middle',wrapText:true};
      if(row.number<=2){
        cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF244459'}};
        cell.font={name:'맑은 고딕',size:row.number===1?14:10,bold:true,color:{argb:'FFFFFFFF'}};
      }
    }
  }
  style(ws.getRow(1));ws.getCell('A1').alignment={horizontal:'left',vertical:'middle'};ws.getRow(1).height=24;
  style(ws.getRow(2));
  function quantity(e){
    return e.customer+(Number(plan.week.split('-')[1])>1&&(!plan.uploadOnly||plan.hasPrevious)?'('+fmt(e.previous)+') '+fmt(e.current)+' /'+fmt(e.previous+e.current):' '+fmt(e.current));
  }
  function dayOf(date){
    return plan.uploadOnly?date:('일월화수목금토'[new Date(date+'T00:00:00Z').getUTCDay()]||date);
  }
  function slot(e,text){
    const d=dayOf(e.date);
    return {day:ink(d+(dayInk[d]?'요일':'')+' - ',dayInk[d]),region:ink(e.region+' ',regionInk[e.region]),body:{text}};
  }
  function write(label,items,limit=10){
    const lines=layout(items,limit);
    const row=ws.addRow([label]);style(row);
    row.getCell(3).value=lines.length?{richText:lines.flatMap((l,i)=>i?[{text:'\n'},...render(l)]:render(l))}:'출고 없음';
    row.height=Math.min(409,Math.max(16,lines.reduce((n,l)=>n+Math.max(1,Math.ceil(width(l)/1170)),0)*15+2));
    return row;
  }
  const ordered=[...model.entries].sort((a,b)=>(plan.uploadOnly?plan.dayOrder.indexOf(a.date)-plan.dayOrder.indexOf(b.date):a.date.localeCompare(b.date))||a.region.localeCompare(b.region,'ko'));
  const routes=new Map(), ambiguous=new Set();
  for(const p of plan.products){
    const items=[];
    for(const e of ordered.filter(e=>e.product.prodKey===p.prodKey)){
      const notes=[];
      for(const d of new Set(e.details)){
        if(model.details.get(d)?.OrderWeek!==plan.week)continue;
        const farms=model.farms.get(d)||[];
        if(farms.length&&model.lines.filter(l=>l.SdetailKey===d).length>1){ambiguous.add(d);notes.push('농장분배 하단 참조');}
        else notes.push(...farms.map(f=>f.FarmName+' '+fmt(f.ShipmentQuantity)));
      }
      if(e.farmNote)notes.push(e.farmNote);
      items.push(slot(e,quantity(e)+(notes.length?' ('+notes.join(', ')+')':'')));
    }
    const row=write(p.label,items,/^(moon\s*light|doncel|novia|문라이트|돈셀|노비아)$/i.test(p.label)?7:10);
    const t=model.totals.find(t=>t.prodKey===p.prodKey);
    row.getCell(4).value=t.incoming;row.getCell(5).value=t.outgoing;row.getCell(6).value=t.stock;
    if(t.incoming!=null&&t.stock!=null)row.getCell(7).value={formula:'D'+row.number+'+F'+row.number+'-E'+row.number,result:t.incoming+t.stock-t.outgoing};
  }
  for(const e of ordered){
    const key=JSON.stringify([e.date,e.region,e.product.unit]);
    if(!routes.has(key))routes.set(key,new Map());
    const customers=routes.get(key);
    if(!customers.has(e.customer))customers.set(e.customer,{...e,current:0,previous:0});
    const t=customers.get(e.customer);t.current+=e.current;t.previous+=e.previous;
  }
  for(const customers of routes.values()){
    const entries=[...customers.values()],e=entries[0],day=dayOf(e.date);
    const header=ws.addRow([day+(dayInk[day]?'요일':'')+' · '+e.region]);style(header);if(plan.colors?.[day])header.getCell(1).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF'+plan.colors[day]}};
    const items=entries.map(v=>slot(v,quantity(v)));
    const total=entries.reduce((n,v)=>n+v.current+v.previous,0);
    items.at(-1).tail=ink(' (총 '+fmt(total)+')'+(plan.pallets?' · '+palletText(plan.pallets,day,e.region):''),regionInk[e.region]);
    write('업체별 당일 총수량',items);
  }
  for(const dk of ambiguous){
    const d=model.details.get(dk),p=plan.products.find(p=>p.prodKey===d.ProdKey);
    style(ws.addRow([p.label,null,customerExportName(d)+' · '+model.farms.get(dk).map(f=>f.FarmName+' '+fmt(f.ShipmentQuantity)).join(', ')]));
  }
  ws.pageSetup.printArea='A1:G'+ws.rowCount;
  return Buffer.from(await wb.xlsx.writeBuffer());
}
