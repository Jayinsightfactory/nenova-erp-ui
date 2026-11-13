import XLSX from 'xlsx';
import { fieldVolumePlan, renderFieldVolumeWorkbook } from './shipmentFieldVolume.js';
import { readFarmDrawingText } from './shipmentFarmDrawing.js';
import { FARM_SHEET, readFarmSheet, parseFarmText, matchFarmEntry, farmTextKey } from './shipmentFarmText.js';

const fail = message => { throw new Error(message); };
const close = (a,b) => Math.abs(a-b)<0.000001;
const sourceAliases={비스윗:'besweet',캔들라이트:'candlelight',코랄리프:'coralreef',프리덤:'freedom',만달라:'mandala',롤리팝화이트블루:'lollipopwhiteblue',몬디알화이트:'mondialwhite',퀵샌드:'quicksand',실란토이:'silantoi',틴티드블루:'tintedblue',모멘텀:'momentum',문라이트:'moonlight'};
const sourceIdentity=value=>{let text=String(value).replace(/(\d+)\s*cm/gi,'$1');for(const [k,v] of Object.entries(sourceAliases))text=text.replaceAll(k,v);return farmTextKey(text);};
// A memo may omit rose length only when this customer has one positive matching cultivar.
function matchSourceNote(note,rows){
  const eligible=rows.filter(r=>r.uploadQty>0),exact=matchFarmEntry(note,eligible);if(exact)return exact;
  const customer=farmTextKey(note.customer),product=sourceIdentity(note.product);
  const candidates=eligible.filter(r=>(!note.family||note.family===r.productFamily)&&
    (farmTextKey(r.custName)===customer||(customer.length>=2&&farmTextKey(r.custName).includes(customer)&&!/선출고|재고|보유/.test(r.custName)))&&
    (sourceIdentity(r.productLabel)===product||(!/\d/.test(product)&&sourceIdentity(r.productLabel).replace(/\d+$/,'')===product)));
  return candidates.length===1?candidates[0]:null;
}

// Source-only conversion: local identities are never ERP keys and no database is consulted.
export async function createUploadedFieldWorkbook(buffer, parsedRows, {filename='', farmText='', week='', year=''} = {}) {
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
    if(!rows.has(key))rows.set(key,{key,prodKey,custKey,custName:r.customerLabel,productLabel:r.productLabel,productFamily:r.productFamily,outUnit:unit,excelUnit:unit,uploadQty:0,excelQty:0,cells:[],day});
    const row=rows.get(key),ref=`${r.sheetName}!R${r.rowNo}C${r.colNo}`;
    if(row.cells.includes(ref))continue;
    row.uploadQty+=qty;row.excelQty+=qty;row.cells.push(ref);
  }
  const sourceRows=[...rows.values()];
  const plan=await fieldVolumePlan(buffer,{orderYear,week:orderWeek,rows:sourceRows},source);
  const weekdays=[...'일월화수목금토'],first=[...days.keys()].find(day=>weekdays.includes(day)),start=weekdays.indexOf(first);
  plan.uploadOnly=true;plan.dayOrder=[...weekdays.slice(Math.max(0,start)),...weekdays.slice(0,Math.max(0,start)),...[...days.keys()].filter(day=>!weekdays.includes(day))];
  const entries=[],details=new Map(),lines=[],farms=new Map(),totals=plan.products.map(p=>({...p,outgoing:0}));
  for(const row of sourceRows) {
    totals.find(p=>p.prodKey===row.prodKey).outgoing+=row.uploadQty;
    if(!row.uploadQty)continue;
    const d=details.size+1,p=plan.products.find(p=>p.prodKey===row.prodKey);
    row.detailKey=d;
    entries.push({date:row.day,region:plan.customers.find(c=>c.custKey===row.custKey)?.region||'지역 미지정',custKey:row.custKey,customer:row.custName,product:p,previous:0,current:row.uploadQty,details:[d]});
    details.set(d,{OrderWeek:plan.week,CustName:row.custName,ProdKey:row.prodKey,OutQuantity:row.uploadQty});
    lines.push({SdetailKey:d,date:row.day,qty:row.uploadQty});
  }
  if(!entries.length)fail('출력할 양수 물량이 없습니다.');
  let memo=String(farmText||'').trim(),notes=[],parsed;
  if(!memo&&source.Sheets[FARM_SHEET]) {
    memo=XLSX.utils.sheet_to_csv(source.Sheets[FARM_SHEET]);
    try{parsed={entries:readFarmSheet(XLSX,source),errors:[]};}catch(e){parsed={entries:[],errors:[e.message]};}
  }
  if(!memo&&!parsed)memo=await readFarmDrawingText(buffer);
  parsed=parsed||parseFarmText(memo);
  for(const error of parsed.errors)notes.push(['확인 필요',error]);
  const matches=new Map();
  for(const note of parsed.entries) {
    const row=matchSourceNote(note,sourceRows);
    const issue=!row?'업체·품목 연결이 없거나 여러 개입니다.':!close(note.quantity,row.uploadQty)?'원본 물량과 메모 수량이 다릅니다.':
      !note.farms.length||note.farms.some(f=>!(f.quantity>0)||(f.unit&&f.unit!==row.outUnit))||!close(note.farms.reduce((s,f)=>s+f.quantity,0),note.quantity)?'농장 합계·단위를 확인하세요.':note.unit&&note.unit!==row.outUnit?'원본 단위와 메모 단위가 다릅니다.':'';
    if(issue)notes.push([`${note.customer} / ${note.product}`,issue]);
    if(!row)continue;
    if(!matches.has(row.key))matches.set(row.key,[]);
    matches.get(row.key).push({note,row,issue});
  }
  for(const list of matches.values()) {
    if(list.length>1){notes.push([`${list[0].row.custName} / ${list[0].row.productLabel}`,'중복 메모는 반영하지 않았습니다.']);continue;}
    const {note,row,issue}=list[0];
    if(!issue){farms.set(row.detailKey,note.farms.map(f=>({FarmName:f.name,ShipmentQuantity:f.quantity})));notes.push([`${note.customer} / ${note.product}`,'반영']);}
  }
  return renderFieldVolumeWorkbook(plan,{entries,details,lines,farms,totals,memo,notes});
}
