import { customerExportName } from './customerExportName.js';
import XLSX from 'xlsx';
import { fieldVolumePlan, renderFieldVolumeWorkbook } from './shipmentFieldVolume.js';
import { readFarmDrawingText } from './shipmentFarmDrawing.js';
import { FARM_SHEET, readFarmSheet, parseFarmText, matchFarmEntry, farmTextKey } from './shipmentFarmText.js';

const fail = message => { throw new Error(message); };
// Preserve symbols in display names such as 북문-☆ while normalizing spacing.
const customerKey=value=>String(value??'').normalize('NFKC').toLowerCase().replace(/\s/g,'');
function customerIndex(customers){
  const index=new Map();
  for(const customer of customers){
    for(const label of [customer.CustName,customer.OrderCode,customerExportName(customer)]){
      const key=customerKey(label);
      if(!key)continue;
      if(!index.has(key))index.set(key,customer);
      else if(index.get(key)!==customer)index.set(key,null);
    }
  }
  return index;
}
const sourceAliases={비스윗:'besweet',캔들라이트:'candlelight',코랄리프:'coralreef',프리덤:'freedom',만달라:'mandala',롤리팝화이트블루:'lollipopwhiteblue',몬디알화이트:'mondialwhite',퀵샌드:'quicksand',실란토이:'silantoi',틴티드블루:'tintedblue',모멘텀:'momentum',문라이트:'moonlight'};
const sourceIdentity=value=>{let text=String(value).replace(/(\d+)\s*cm/gi,'$1');for(const [k,v] of Object.entries(sourceAliases))text=text.replaceAll(k,v);return farmTextKey(text);};
// A memo may omit rose length only when this customer has one positive matching cultivar.
function matchSourceNote(note,rows){
  const key=customerKey(note.customer);
  const exact=rows.filter(r=>r.sourceCustomerLabels.some(label=>customerKey(label)===key));
  const candidates=exact.length?exact:rows.filter(r=>key.length>=2&&r.sourceCustomerLabels.some(label=>
    customerKey(label).includes(key)&&!(/선출고|재고|보유/.test(label))));
  const product=sourceIdentity(note.product);
  const family=candidates.filter(r=>!note.family||note.family===r.productFamily);
  const direct=family.filter(r=>sourceIdentity(r.productLabel)===product);
  const compatible=direct.length?direct:family.filter(r=>matchFarmEntry({...note,customer:r.custName},[r])||
    (!/\d/.test(product)&&sourceIdentity(r.productLabel).replace(/\d+$/,'')===product));
  const positive=compatible.filter(r=>r.uploadQty>0);
  const choices=positive.length?positive:compatible;
  return choices.length===1?choices[0]:null;
}

function sourceFooterNotes(source) {
  const notes=[];
  for(const sheet of Object.values(source.Sheets)){
    const lines=XLSX.utils.sheet_to_json(sheet,{header:1});
    const end=lines.findIndex(row=>String(row[0]||'').trim()==='합계');
    if(end<0)continue;
    let customer='';
    for(const row of lines.slice(end+1)){
      let text=String(row[0]||'').trim();
      const header=text.match(/^\*([^ ]+)\s+농장(?:분배|구분)(.*)$/);
      if(header){customer=header[1];text=header[2].trim();
        if(text.startsWith('(')){const pending=text.match(/(\S+) (\d+)박스는 농장분배 따로/);if(pending)notes.push({customer,product:pending[1].replace('(',''),text:pending[2]+'박스 농장 미지정'});continue;}
        text=text.replace(/^-\s*/,'');
      }
      const line=text.match(/^(\S+)\s+(.+)$/);
      if(customer&&line)notes.push({customer,product:line[1],text:line[2]});
    }
  }
  return notes;
}
function slotKey(e){return JSON.stringify([e.date,e.region,customerKey(e.customer),sourceIdentity(e.product.label),e.product.family,e.product.unit]);}
function includePrevious(plan,model,old){
  const map=new Map(model.entries.map(e=>[slotKey(e),e]));
  const dates=new Set(model.entries.map(e=>e.date));
  for(const e of old.entries){
    if(!dates.has(e.date))continue;
    const key=slotKey(e),current=map.get(key);
    if(current){current.previous+=e.current;continue;}
    let product=plan.products.find(p=>p.family===e.product.family&&p.unit===e.product.unit&&sourceIdentity(p.label)===sourceIdentity(e.product.label));
    if(!product){product={...e.product,prodKey:Math.max(0,...plan.products.map(p=>p.prodKey))+1};plan.products.push(product);model.totals.push({...product,incoming:null,stock:null,outgoing:0});}
    const added={...e,product,custKey:'prior:'+customerKey(e.customer),details:[],previous:e.current,current:0};
    model.entries.push(added);map.set(key,added);
  }
  plan.hasPrevious=true;
}
export async function createUploadedFieldWorkbook(buffer, parsedRows, {previousFile,modelOnly=false,pallets,filename='', farmText='', week='', year='', customerDirectory=[]} = {}) {
  const directory=customerIndex(customerDirectory);
  const source=XLSX.read(buffer,{type:'buffer'}), rows=new Map(), products=new Map(), customers=new Map(), days=new Map();
  const sourceWeek=filename.match(/(?:^|[^\d])(\d{2})[-－](\d{1,2})(?!\d)/);
  const selected=String(week).match(/^(?:(\d{4})-)?(\d{2})-(\d{1,2})$/);
  const orderWeek=sourceWeek?`${sourceWeek[1]}-${sourceWeek[2].padStart(2,'0')}`:selected?`${selected[2]}-${selected[3].padStart(2,'0')}`:'업로드';
  const orderYear=selected?.[1] || (/^\d{4}$/.test(String(year))?String(year):'');
  const headers=new Map();
  for(const r of parsedRows) {
    if(!r.sheetName || !r.rowNo || !r.colNo)fail('바로 생성은 업체가 열로 표시된 원본 물량표(.xlsx)를 지원합니다.');
    const sheet=source.Sheets[r.sheetName];
    if(!headers.has(r.sheetName)) {
      const range=XLSX.utils.decode_range(sheet['!ref']||'A1');let header=0;
      for(let n=0;n<Math.min(12,range.e.r+1);n++) {
        const labels=Array.from({length:range.e.c+1},(_,c)=>String(sheet[XLSX.utils.encode_cell({r:n,c})]?.v??'').trim());
        if(labels.includes('입고')&&(labels.includes('주문')||labels.includes('잔량'))){header=n+1;break;}
      }
      if(!header)fail(`${r.sheetName}: 입고·주문·잔량 헤더가 있는 원본 물량표를 선택하세요.`);
      headers.set(r.sheetName,header);
    }
    const cell=sheet[XLSX.utils.encode_cell({r:r.rowNo-1,c:r.colNo-1})],value=cell?.v;
    if(cell?.t==='e'||(cell?.f&&value==null))fail(`${r.sheetName} ${r.rowNo}행: 수식 결과를 저장한 엑셀을 업로드하세요.`);
    const qty=value==null||String(value).trim()===''?0:Number(String(value).replace(/,/g,''));
    if(!Number.isFinite(qty)||qty<0)fail(`${r.sheetName} ${r.rowNo}행: 수량을 확인하세요.`);
    const unit=r.outUnit || (r.productFamily==='carnation'?'박스':r.productFamily==='rose'?'단':'원본수량');
    const pk=JSON.stringify([r.sheetName,r.productFamily,farmTextKey(r.productLabel),unit]);
    if(!products.has(pk))products.set(pk,products.size+1);
    const ck=JSON.stringify([r.sheetName,r.colNo]);if(!customers.has(ck))customers.set(ck,customers.size+1);
    const prodKey=products.get(pk),custKey=customers.get(ck),key=`${custKey}|${prodKey}`;
    const day=String(sheet[XLSX.utils.encode_cell({r:headers.get(r.sheetName)-2,c:r.colNo-1})]?.v??'').trim().replace(/요일$/,'')||'미지정';
    if(!days.has(day))days.set(day,days.size);
    const customer=directory.get(customerKey(r.customerLabel));
    if(!rows.has(key))rows.set(key,{key,prodKey,custKey,custName:customer?customerExportName(customer):r.customerLabel,sourceCustomerLabels:[r.customerLabel,customer?.CustName,customer?.OrderCode,customer&&customerExportName(customer)].filter(Boolean),productLabel:r.productLabel,productFamily:r.productFamily,outUnit:unit,excelUnit:unit,uploadQty:0,excelQty:0,cells:[],day});
    const row=rows.get(key),ref=`${r.sheetName}!R${r.rowNo}C${r.colNo}`;
    if(row.cells.includes(ref))continue;
    row.uploadQty+=qty;row.excelQty+=qty;row.cells.push(ref);
  }
  const sourceRows=[...rows.values()];
  const plan=await fieldVolumePlan(buffer,{orderYear,week:orderWeek,rows:sourceRows},source);
  const weekdays=[...'일월화수목금토'],first=[...days.keys()].find(day=>weekdays.includes(day)),start=weekdays.indexOf(first);
  plan.pallets=pallets;plan.uploadOnly=true;plan.dayOrder=[...weekdays.slice(Math.max(0,start)),...weekdays.slice(0,Math.max(0,start)),...[...days.keys()].filter(day=>!weekdays.includes(day))];
  const entries=[],details=new Map(),lines=[],farms=new Map(),totals=plan.products.map(p=>({...p,outgoing:0}));
  let memo=String(farmText||'').trim(),parsed;
  if(!memo&&source.Sheets[FARM_SHEET]) {
    memo=XLSX.utils.sheet_to_csv(source.Sheets[FARM_SHEET]);
    try{parsed={entries:readFarmSheet(XLSX,source),errors:[]};}catch(e){parsed={entries:[],errors:[e.message]};}
  }
  if(!memo&&!parsed)memo=await readFarmDrawingText(buffer);
  parsed=parsed||parseFarmText(memo);
  const matches=new Map();
  for(const note of parsed.entries){
    const row=matchSourceNote(note,sourceRows);
    if(!row)continue;
    if(matches.has(row.key))matches.set(row.key,null);
    else matches.set(row.key,note);
  }
  const footer=new Map();
  if(!farmText)for(const note of sourceFooterNotes(source)){
    const row=matchSourceNote(note,sourceRows);if(row)footer.set(row.key,[...(footer.get(row.key)||[]),note.text]);
  }
  for(const row of sourceRows) {
    totals.find(p=>p.prodKey===row.prodKey).outgoing+=row.uploadQty;
    const note=matches.get(row.key);
    const valid=note&&(!note.unit||note.unit===row.outUnit)&&note.farms.length&&
      note.farms.every(f=>Number.isFinite(f.quantity)&&f.quantity>0&&(!f.unit||f.unit===row.outUnit));
    if(!row.uploadQty&&!valid)continue;
    const d=details.size+1,p=plan.products.find(p=>p.prodKey===row.prodKey);
    if(valid)farms.set(d,note.farms.map(f=>({FarmName:f.name,ShipmentQuantity:f.quantity})));
    entries.push({date:row.day,region:plan.customers.find(c=>c.custKey===row.custKey)?.region||'지역 미지정',custKey:row.custKey,customer:row.custName,product:p,farmNote:footer.get(row.key)?.join(', '),previous:0,current:row.uploadQty,details:[d]});
    details.set(d,{OrderWeek:plan.week,CustName:row.custName,ProdKey:row.prodKey,OutQuantity:row.uploadQty});
    lines.push({SdetailKey:d,date:row.day,qty:row.uploadQty});
  }
  if(!entries.length)fail('출력할 양수 물량이 없습니다.');
  const model={entries,details,lines,farms,totals};
  if(modelOnly)return model;
  if(previousFile){
    const prior=previousFile.filename.match(/(?:^|[^\d])(\d{2})[-－]01(?!\d)/);
    if(!sourceWeek||sourceWeek[2]!=='02'||prior?.[1]!==sourceWeek[1]||
      !previousFile.rows.some(r=>parsedRows.some(c=>c.sheetName===r.sheetName&&c.productFamily===r.productFamily)))fail('같은 주차·품목의 1차 물량표를 선택하세요.');
    const old=await createUploadedFieldWorkbook(previousFile.buffer,previousFile.rows,{filename:previousFile.filename,year,customerDirectory,modelOnly:true});
    includePrevious(plan,model,old);
  }
  return renderFieldVolumeWorkbook(plan,model);
}
