// Display-only facts. Never feeds eligibility, source ownership or mutations.
const labels={NEW:'요청 전',WAITING:'답변 대기',ANSWERED:'답변 도착',OBSERVING:'개선 관찰',CLOSED:'완료',RECURRED:'재발 확인'};
const priorities={NEW:0,RECURRED:0,WAITING:1,ANSWERED:2,OBSERVING:3,CLOSED:4};
const format=n=>Number(n).toLocaleString('ko-KR',{maximumFractionDigits:1});
const week=value=>{const m=String(value??'').match(/^(\d{1,2})(?:-\d{1,2})?$/);return m&&+m[1]>=1&&+m[1]<=53?+m[1]:null;};
const unique=values=>[...new Set(values.filter(Boolean))];
export const feedbackStatusLabel=code=>labels[code]||'상태 확인 필요';
export const feedbackNeedsRequest=item=>!item.cases?.length||item.cases.some(c=>c.status==='NEW');
export const feedbackPriority=item=>item.excluded?5:Math.min(...(item.cases?.length?item.cases.map(c=>priorities[c.status]??0):[0]));

export function summarizeQualityInbox(item){
 const seen=new Set(),sources=[];
 for(const row of item.sources||[]){
  if(Number(row.orderYear)!==Number(item.orderYear)||row.historical||row.isHistorical)continue;
  const key=String(row.sourceKey??'');if(!key||seen.has(key))continue;
  seen.add(key);sources.push(row);
 }
 const farms=unique(sources.map(r=>r.farmName?.trim()||'농장 미지정'));
 const flowers=unique(sources.map(r=>r.flowerName?.trim()));
 const groups=new Map(),totals=new Map();let unknown=0;
 for(const r of sources){
  const unit=r.unit||'단위 미상',key=`${Number(r.prodKey)>0?r.prodKey:`source:${r.sourceKey}`}|${unit}`;
  if(!groups.has(key))groups.set(key,{key,name:r.productName||'품목 미지정',unit,quantity:0,count:0,weeks:new Map(),unknown:0});
  const g=groups.get(key);g.count++;
  const w=week(r.orderWeek),qty=r.quantity==null?NaN:Number(r.quantity);
  if(!Number.isFinite(qty)||qty<0){g.unknown++;unknown++;continue;}
  g.quantity+=qty;totals.set(unit,(totals.get(unit)||0)+qty);
  if(w)g.weeks.set(w,(g.weeks.get(w)||0)+qty);
 }
 const products=[...groups.values()].map(g=>({...g,
  share:totals.get(g.unit)>0&&!g.unknown&&!unknown?Math.round(g.quantity/totals.get(g.unit)*1000)/10:null,
  quantity:g.unknown?null:g.quantity,
  weekText:[...g.weeks].sort(([a],[b])=>a-b).map(([w,q])=>`${w}차 ${format(q)}`).join(' → ')+(g.unknown?' · 수량 확인 필요':''),
  weeks:undefined,
 })).sort((a,b)=>a.unit.localeCompare(b.unit,'ko')||(b.quantity??-1)-(a.quantity??-1)||a.name.localeCompare(b.name,'ko'));
 const topGroups=unique(products.map(p=>p.unit)).map(unit=>{const all=products.filter(p=>p.unit===unit);return {unit,products:all.slice(0,3),remaining:Math.max(0,all.length-3)};});
 const weeks=unique(sources.map(r=>week(r.orderWeek))).sort((a,b)=>a-b);
 const first=weeks[0],last=weeks.at(-1),continuous=weeks.length>1&&last-first+1===weeks.length;
 let overview=weeks.length===1?`${first}차에서 불량 발생`:continuous?`${first}~${last}차 매 차수 불량 발생`:weeks.length>1?`${weeks.join('·')}차에 불량 반복 발생`:'현재 감지 원본 없이 기존 피드백 이력을 관리합니다.';
 if(sources.length&&sources.some(r=>!week(r.orderWeek)))overview+=' · 차수 확인 필요';
 const family=flowers.length&&sources.every(r=>r.flowerName?.trim())?(flowers.length<=2?flowers.join('·'):`${flowers.slice(0,2).join('·')} 외 ${flowers.length-2}개 품종`):`${products.length}개 품목`;
 const title=sources.length?`${farms.length===1?farms[0]:farms.length?`${farms[0]} 외 ${farms.length-1}개 농장`:'농장 미지정'} · ${family}`:item.cases?.[0]?.title||'기존 피드백';
 const statuses=[];for(const c of item.cases||[]){const found=statuses.find(s=>s.code===c.status);if(found)found.count++;else statuses.push({code:c.status,label:feedbackStatusLabel(c.status),count:1});}
 if(!statuses.length)statuses.push({code:'NEW',label:labels.NEW,count:1});
 statuses.sort((a,b)=>(priorities[a.code]??0)-(priorities[b.code]??0));
 const events=(item.cases||[]).flatMap(c=>c.recentEvents||[]).filter(e=>e.Body).sort((a,b)=>(Date.parse(b.CreatedAt)||0)-(Date.parse(a.CreatedAt)||0)||String(b.EventKey||'').localeCompare(String(a.EventKey||'')));
 const requestText=farms.includes('농장 미지정')?'농장 정보와 주요 불량 품목을 확인한 뒤 원인·개선 방안을 요청해 주세요.':`주요 불량 품목의 ${weeks.length>1?'반복 발생 ':''}원인과 개선 방안을 회신해 주세요.`;
 return {title,overview,totalsText:sources.length?`불량 ${sources.length}건 · ${[...totals].map(([u,q])=>`${format(q)} ${u}`).join(' / ')}${unknown?' · 일부 수량 확인 필요':''}`:'기존 이력 보존',topGroups,products,statuses,latest:events[0]||null,priority:feedbackPriority(item),requestText,newCount:new Set(item.newSourceKeys||[]).size,reviewRequired:Boolean(item.sourceReviewRequired)};
}
