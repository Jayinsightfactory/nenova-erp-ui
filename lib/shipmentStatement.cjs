// Browser/server shared policies. No ERP writes and no inferred quantities/prices.
const DAYS=['수','목','금','토','일','월','화'];
const BASE_DAYS=['수','일','월','화','목','토','금'];
const EPS=1e-7;
const fail=(message,statusCode=400)=>Object.assign(new Error(message),{statusCode});
const round=n=>Math.round((n+Number.EPSILON)*1e8)/1e8;
function scope(input={}){
 const year=String(input.year??''),week=Number(input.week),custKey=input.custKey==null?null:Number(input.custKey);
 if(!/^20\d{2}$/.test(year)||!Number.isInteger(week)||week<1||week>53||custKey!==null&&(!Number.isSafeInteger(custKey)||custKey<=0))throw fail('연도·메인차수·업체를 확인하세요.');
 return {year,week,custKey};
}
function calendar(rows){
 const result=rows.map(r=>({day:DAYS.find(d=>d===r.day)||['일','월','화','수','목','금','토'][Number(r.WeekDay)-1],date:String(r.date??r.Date??'').slice(0,10)}));
 if(result.length!==7||new Set(result.map(r=>r.day)).size!==7||new Set(result.map(r=>r.date)).size!==7)throw fail('전산 차수 달력 7일을 확인하세요.',409);
 result.sort((a,b)=>DAYS.indexOf(a.day)-DAYS.indexOf(b.day));
 result.forEach((r,i)=>{const t=Date.parse(r.date+'T00:00:00Z');if(!Number.isFinite(t)||['일','월','화','수','목','금','토'][new Date(t).getUTCDay()]!==r.day||i&&t-Date.parse(result[i-1].date+'T00:00:00Z')!==86400000)throw fail('전산 차수 달력이 연속된 수~화가 아닙니다.',409);});
 return result;
}
function sourceRows(raw,input){
 const s=scope(input),groups=new Map();
 for(const r of raw){
  if(String(r.OrderYear)!==s.year||Number(String(r.OrderWeek).split('-')[0])!==s.week||s.custKey!==null&&Number(r.CustKey)!==s.custKey)continue;
  if(r.MasterDeleted||r.CustomerDeleted||r.ProductDeleted||!(Number(r.OutQuantity)>0))continue;
  const qty=Number(r.OutQuantity),cost=r.Cost==null?null:Number(r.Cost);
  if(!Number.isFinite(qty)||cost!==null&&(!Number.isFinite(cost)||cost<0))throw fail('원본 수량·단가를 확인하세요.',409);
  const category=JSON.stringify([r.CounName||'기타',r.FlowerName||'기타']);
  const id=JSON.stringify([Number(r.ProdKey),r.OutUnit||'',cost]);
  if(!groups.has(id))groups.set(id,{id,prodKey:Number(r.ProdKey),name:r.DisplayName||r.ProdName,originalName:r.ProdName,category,country:r.CounName||'기타',flower:r.FlowerName||'기타',unit:r.OutUnit||'단위미등록',cost,qty:0,sources:[]});
  const row=groups.get(id);row.qty=round(row.qty+qty);row.sources.push({year:s.year,week:r.OrderWeek,detailKey:Number(r.SdetailKey),quantity:qty,cost});
 }
 return [...groups.values()].map(r=>({...r,sources:r.sources.sort((a,b)=>a.week.localeCompare(b.week)||a.detailKey-b.detailKey)})).sort((a,b)=>a.category.localeCompare(b.category,'ko')||a.name.localeCompare(b.name,'ko')||a.id.localeCompare(b.id));
}
function allocation(row,entry={},defaultDay){
 if(!DAYS.includes(defaultDay))throw fail('기본 출고요일을 선택하세요.');
 if(!entry||typeof entry!=='object'||Array.isArray(entry)||Object.keys(entry).some(k=>!DAYS.includes(k)))throw fail('요일별 수량을 확인하세요.');
 const result=Object.fromEntries(DAYS.map(d=>[d,0]));let used=0;
 for(const [d,value] of Object.entries(entry)){
  if(value===''||value===null||typeof value==='boolean')throw fail('수량은 0 이상의 숫자로 입력하세요.');
  const n=Number(value);if(!Number.isFinite(n)||n<0||n>1e9)throw fail('수량은 0 이상의 숫자로 입력하세요.');result[d]=n;used+=n;
 }
 const remainder=round(row.qty-used);if(remainder<-EPS)throw fail(`${row.name}: 요일 수량이 분배수량 ${row.qty}을 초과합니다.`);
 result[defaultDay]=round(result[defaultDay]+Math.max(0,remainder));
 return result;
}
function preferences(input={},categories=[]){
 if(!input||typeof input!=='object'||Array.isArray(input))throw fail('작성내용 형식을 확인하세요.');
 const defaultDay=input.defaultDay??'일';if(!DAYS.includes(defaultDay))throw fail('기본 출고요일을 확인하세요.');
 const groups=input.groups??[];if(!Array.isArray(groups)||groups.length>100)throw fail('출력 묶음을 확인하세요.');
 const seen=new Set(),names=new Set();
 const clean=groups.map(g=>{
  const name=String(g.name??'').trim();if(!name||name.length>60||names.has(name)||!Array.isArray(g.categories)||!g.categories.length)throw fail('묶음 이름과 품목군을 확인하세요.');names.add(name);
  const keys=g.categories.map(k=>{if(typeof k!=='string'||k.length>250||seen.has(k))throw fail('한 품목군은 한 묶음에만 넣을 수 있습니다.');try{const v=JSON.parse(k);if(!Array.isArray(v)||v.length!==2||v.some(x=>typeof x!=='string'))throw Error();}catch{throw fail('품목군 식별값을 확인하세요.');}seen.add(k);return k;});
  return {name,categories:keys};
 });return {defaultDay,groups:clean};
}
function validatePlan(source,draft){
 const pref=preferences(draft),entries=draft.entries??{};
 if(!entries||typeof entries!=='object'||Array.isArray(entries))throw fail('요일 배분을 확인하세요.');
 const ids=new Set(source.map(r=>r.id));if(Object.keys(entries).some(id=>!ids.has(id)))throw fail('원본에서 변경된 품목이 있습니다. 다시 불러오세요.',409);
 for(const row of source)allocation(row,entries[row.id],pref.defaultDay);
 return {...pref,entries:Object.fromEntries(Object.entries(entries).map(([id,e])=>[id,Object.fromEntries(Object.entries(e).map(([d,v])=>[d,Number(v)]))]))};
}
function bulkMove(rows,entries,ids,day){
 if(!DAYS.includes(day))throw fail('일괄 출고요일을 선택하세요.');const selected=new Set(ids),next={...entries};
 rows.forEach(r=>{if(selected.has(r.id))next[r.id]={[day]:r.qty};});return next;
}
function groupName(row,groups){return groups.find(g=>g.categories.includes(row.category))?.name||`${row.country} ${row.flower}`;}
function outputBlocks(record){
 const {rows,calendar:dates}=record.source,draft=validatePlan(rows,record.draft);
 return dates.map(({day,date})=>{const groups=new Map();
  for(const row of rows){const quantity=allocation(row,draft.entries[row.id],draft.defaultDay)[day];if(quantity<=EPS)continue;
   const name=groupName(row,draft.groups),key=JSON.stringify([name,row.category,row.unit]);
   if(!groups.has(key))groups.set(key,{name,country:row.country,flower:row.flower,unit:row.unit,rows:[]});groups.get(key).rows.push({...row,quantity});
  }return {day,date,groups:[...groups.values()].sort((a,b)=>a.name.localeCompare(b.name,'ko')||a.flower.localeCompare(b.flower,'ko')||a.unit.localeCompare(b.unit,'ko'))};
 }).filter(d=>d.groups.length);
}
module.exports={DAYS,BASE_DAYS,EPS,fail,round,scope,calendar,sourceRows,allocation,preferences,validatePlan,bulkMove,groupName,outputBlocks};
