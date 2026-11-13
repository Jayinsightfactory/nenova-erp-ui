import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import XLSX from 'xlsx';
import { shipmentExportLines } from './shipmentExportExcel.js';
import { assignmentsKey } from './shipmentFarmText.js';

const fail = message => { throw Object.assign(new Error(message), { statusCode: 409, code: 'FIELD_VOLUME_INVALID' }); };
const fmt = n => Number(n).toLocaleString('en-US', { maximumFractionDigits: 6 });
const close = (a,b) => Number.isFinite(Number(a)) && Number.isFinite(Number(b)) && Math.abs(Number(a)-Number(b)) < 0.000001;
const key = (cust,prod) => `${cust}|${prod}`;
const wrappedLines = (text,width) => String(text).split('\n').reduce((n,t)=>n+Math.max(1,Math.ceil([...t].reduce((s,c)=>s+(c.charCodeAt(0)>255?2:1),0)/width)),0);
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
  return {kind:'field-volume-v1',orderYear:String(preview.orderYear),week:preview.week,products:[...products.values()],customers:[...customers.values()],colors,
    expected:(preview.rows || []).filter(r=>r.prodKey&&r.custKey).map(r=>({custKey:Number(r.custKey),prodKey:Number(r.prodKey),qty:Number(r.uploadQty),farms:r.farmAssignments ?? r.farmBefore ?? []})),errors:[]};
}

// Exact year and same major; the caller passes validated integer product keys only.
export function fieldVolumeSql(prodKeys) {
  if (!prodKeys.length || prodKeys.some(k=>!Number.isSafeInteger(k)||k<=0)) fail('품목 범위를 다시 검증하세요.');
  const scope=`sm.OrderYear=@year AND LEFT(sm.OrderWeek,2)=@major AND TRY_CONVERT(int,SUBSTRING(sm.OrderWeek,4,8)) BETWEEN 1 AND @minor
    AND ISNULL(sm.isDeleted,0)=0 AND sd.ProdKey IN (${prodKeys.join(',')})`;
  return {lines:`SELECT sm.OrderYear,sm.OrderWeek,sm.CustKey,c.CustName,c.CustArea,sd.SdetailKey,sd.ProdKey,p.ProdName,p.OutUnit,
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
    if(!entries.has(k))entries.set(k,{date:line.date,region,custKey:line.CustKey,customer:line.CustName,product:p,previous:0,current:0,details:[]});
    const e=entries.get(k);e[line.OrderWeek===plan.week?'current':'previous']+=line.qty;e.details.push(line.SdetailKey);
  }
  const totals=new Map(plan.products.map(p=>[p.prodKey,{...p,outgoing:0}]));
  for(const d of current.values())totals.get(d.ProdKey).outgoing+=Number(d.OutQuantity);
  return {entries:[...entries.values()],totals:[...totals.values()],farms,details,lines};
}

export async function createFieldVolumeWorkbook(plan,rawRows,farmRows){
  const model=fieldVolumeModel(plan,rawRows,farmRows),wb=new ExcelJS.Workbook();
  wb.creator='Nenova';wb.calcProperties.fullCalcOnLoad=true;
  const groups=new Map();
  for(const p of plan.products){const k=JSON.stringify([p.family,p.unit]);if(!groups.has(k))groups.set(k,[]);groups.get(k).push(p);}
  const thin={style:'thin',color:{argb:'FFB8C2CC'}};
  const style=sheet=>{sheet.eachRow(row=>row.eachCell({includeEmpty:true},cell=>{cell.font={name:'맑은 고딕',size:11,...cell.font};cell.alignment={vertical:'top',wrapText:true,...cell.alignment};cell.border={top:thin,left:thin,bottom:thin,right:thin};}));};
  for(const products of groups.values()){
    const ids=new Set(products.map(p=>p.prodKey)),entries=model.entries.filter(e=>ids.has(e.product.prodKey));
    const allCols=[...new Map(entries.map(e=>[JSON.stringify([e.date,e.region]),{date:e.date,region:e.region}])).values()].sort((a,b)=>a.date.localeCompare(b.date)||a.region.localeCompare(b.region,'ko'));
    const title=products[0].family==='carnation'?'카네이션':products[0].family==='rose'?'장미':'물량표';
    // Five region columns per A3 sheet keep printed text readable without tiny scaling.
    for(let offset=0;offset<Math.max(allCols.length,1);offset+=5){
    const cols=allCols.slice(offset,offset+5);
    const ws=wb.addWorksheet(`${title} ${products[0].unit}${offset?' '+(offset/5+1):''}`.slice(0,31),{pageSetup:{paperSize:8,orientation:'landscape',fitToPage:true,fitToWidth:1,fitToHeight:0,margins:{left:.2,right:.2,top:.3,bottom:.3,header:.1,footer:.1}},views:[{state:'frozen',xSplit:1,ySplit:4}]});
    const last=1+Math.max(cols.length,1);
    ws.mergeCells(1,1,1,last);ws.getCell(1,1).value=`${plan.week}차 ${title} 현장물량표 · ${plan.orderYear}년 · ${products[0].unit}`;ws.getRow(1).height=27;ws.getCell(1,1).font={bold:true,size:15};
    ws.mergeCells(2,1,2,last);ws.getCell(2,1).value='품종(이전차수) 이번수량 /당일합계 · 입고·재고: 업로드 원본 기준';ws.getRow(2).height=22;
    ws.getCell(3,1).value='요일 / 출고일';ws.getCell(4,1).value='품종';ws.getColumn(1).width=25;
    cols.forEach((col,i)=>{
      const day=col.date==='미지정'?'미지정':['일','월','화','수','목','금','토'][new Date(col.date+'T00:00:00Z').getUTCDay()];
      ws.getCell(3,i+2).value=`${day} ${col.date==='미지정'?'':col.date.slice(5)}`;ws.getCell(4,i+2).value=col.region;ws.getColumn(i+2).width=30;
      const color=plan.colors[day] || FIELD_DAY_COLORS['일월화수목금토'.indexOf(day)] || 'E7E6E6';
      for(const r of [3,4]){ws.getCell(r,i+2).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF'+color}};ws.getCell(r,i+2).font={bold:true};}
    });
    let r=5;
    for(const p of products){
      const total=model.totals.find(t=>t.prodKey===p.prodKey);
      const remain=total.incoming!==null&&total.stock!==null?total.incoming+total.stock-total.outgoing:null;
      const byColumn=cols.map(col=>entries.filter(e=>e.product.prodKey===p.prodKey&&e.date===col.date&&e.region===col.region));
      for(let item=0;item<Math.max(1,...byColumn.map(list=>list.length));item++){
      ws.getCell(r,1).value=item===0?`${p.label}\n입 ${total.incoming===null?'미입력':fmt(total.incoming)} 출 ${fmt(total.outgoing)}\n재 ${total.stock===null?'미입력':fmt(total.stock)} 잔 ${remain===null?'미입력':fmt(remain)}`:`${p.label} (계속)`;let maxLines=wrappedLines(ws.getCell(r,1).value,23);
      cols.forEach((col,i)=>{
        const items=byColumn[i].slice(item,item+1);
        const texts=items.map(e=>{
          const text=`${e.customer}\n${p.label}${Number(plan.week.split('-')[1])>1?`(${fmt(e.previous)})`:''} ${fmt(e.current)} /${fmt(e.previous+e.current)}`;
          const dk=[...new Set(e.details)].filter(d=>model.details.get(d).OrderWeek===plan.week);
          const farmTexts=dk.flatMap(d=>{
            const fs=model.farms.get(d)||[];if(!fs.length)return [];
            return model.lines.filter(l=>l.SdetailKey===d).length>1?['농장: 분배표 참조']:fs.map(f=>`${f.FarmName} ${fmt(f.ShipmentQuantity)}`);
          });
          return text+(farmTexts.length?'\n'+farmTexts.join(' · '):'');
        });
        const text=texts.join('\n\n');ws.getCell(r,i+2).value=text;
        maxLines=Math.max(maxLines,wrappedLines(text,28));
      });
      if(maxLines*15+8>400)fail(`${p.label}: 농장명이 길어 인쇄가 잘릴 수 있습니다. 농장분배 메모를 확인하세요.`);
      ws.getRow(r).height=Math.max(30,maxLines*15+8);r++;
      }
    }
    ws.addRow([]);r++;
    ws.getCell(r,1).value='업체별 당일 총수량';ws.getCell(r,1).font={bold:true};
    const customerTotals=cols.map(col=>{const sums=new Map();for(const e of entries.filter(e=>e.date===col.date&&e.region===col.region)){const k=e.custKey;if(!sums.has(k))sums.set(k,{name:e.customer,prev:0,qty:0});sums.get(k).prev+=e.previous;sums.get(k).qty+=e.current;}return [...sums.values()];});
    for(let item=0;item<Math.max(1,...customerTotals.map(list=>list.length));item++){
      cols.forEach((col,i)=>{const s=customerTotals[i][item];if(s)ws.getCell(r,i+2).value=`${s.name}${Number(plan.week.split('-')[1])>1?`(${fmt(s.prev)})`:''} ${fmt(s.qty)} /${fmt(s.prev+s.qty)}`;});
      ws.getRow(r).height=38;r++;
    }
    r--;
    ws.pageSetup.printTitlesRow='3:4';ws.pageSetup.printArea=`A1:${ws.getCell(r,last).address}`;style(ws);
    }
  }
  const summary=wb.addWorksheet('입고출고재고잔량');summary.addRow(['품종','단위','입고','출고','재고','잔량']);
  for(const p of model.totals){const row=summary.addRow([p.label,p.unit,p.incoming,p.outgoing,p.stock,null]);if(p.incoming!==null&&p.stock!==null)row.getCell(6).value={formula:`C${row.number}+E${row.number}-D${row.number}`,result:p.incoming+p.stock-p.outgoing};}
  summary.addRow(['입고·재고는 업로드 원본 기준. 출고는 선택차수의 전체 업체 저장 분배량. 잔량=입고+재고-출고. 빈 요약값은 미입력.']);summary.columns.forEach((c,i)=>c.width=i===0?40:16);summary.eachRow(r=>{r.height=24;for(let c=3;c<=6;c++)r.getCell(c).numFmt='#,##0.######';});summary.lastRow.height=42;summary.mergeCells(summary.lastRow.number,1,summary.lastRow.number,6);style(summary);
  const farmSheet=wb.addWorksheet('농장분배');farmSheet.addRow(['차수','업체','품종','출고일','총분배','단위','농장','농장수량']);
  for(const [dk,fs] of model.farms){const d=model.details.get(dk);const p=plan.products.find(p=>p.prodKey===d.ProdKey);const dates=[...new Set(model.lines.filter(l=>l.SdetailKey===dk).map(l=>l.date))].join(', ');for(const [i,f] of fs.entries())farmSheet.addRow([d.OrderWeek,d.CustName,p.label,dates,i===0?Number(d.OutQuantity):null,p.unit,f.FarmName,Number(f.ShipmentQuantity)]);}
  farmSheet.columns.forEach((c,i)=>c.width=[12,24,30,30,12,10,30,14][i]);farmSheet.eachRow(r=>r.height=30);style(farmSheet);
  for(const s of [summary,farmSheet]){s.pageSetup={paperSize:9,orientation:'landscape',fitToPage:true,fitToWidth:1,fitToHeight:0,printTitlesRow:'1:1'};s.getRow(1).font={bold:true};}
  return Buffer.from(await wb.xlsx.writeBuffer());
}
