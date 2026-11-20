'use strict';
const {createHash}=require('node:crypto');
const {linkedFlights,absoluteTime}=require('./shell/flight-board');
// 앱 홈 「수입 비행기 현황」: 로그인 세션으로 네노바웹 /api/import/flight-board 를 읽어 홈에 필요한 칸만 추려 넘긴다(읽기 전용).
// 카드에 필요한 운송장·수량만 넘기고 원문은 상세 화면에서 확인한다.
const {ORIGIN}=require('./policy.cjs');
const clean=(value,max)=>typeof value==='string'?value.replace(/[\u0000-\u001f\u007f]/g,' ').slice(0,max):'';
const iso=value=>{const ms=absoluteTime(value);return Number.isFinite(ms)?new Date(ms).toISOString():null;};
const count=value=>Number.isFinite(Number(value))&&Number(value)>=0?Math.min(Math.trunc(Number(value)),9999):0;
const flightViewId=key=>createHash('sha256').update(String(key||'')).digest('hex');
const issueText=value=>clean(value,160).replace(/\b\d{3}[- ]?\d{8}\b/g,'운송장');
// 지도용 좌표: 숫자 범위만 통과시킨다.
const point=p=>p&&Number.isFinite(Number(p.lat))&&Number.isFinite(Number(p.lon))&&Math.abs(Number(p.lat))<=90&&Math.abs(Number(p.lon))<=360?{lat:Math.round(Number(p.lat)*100)/100,lon:Math.round(Number(p.lon)*100)/100}:null;
const place=p=>{const at=point(p);return at?{name:clean(p.name,20),...at}:null;};
const routeLine=list=>Array.isArray(list)?list.slice(0,80).map(point).filter(Boolean).map(p=>[p.lon,p.lat]):[];
const STATUS=['awaiting_awb','before_departure','in_flight','arrived','registered','unknown'];
const STEP_STATES = ['done', 'wait', 'due', 'late', 'unknown'];
const quantity = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
const cargo = entry => entry ? {
  boxes: quantity(entry.boxes),
  items: Array.isArray(entry.items) ? entry.items.slice(0, 80).map(item => ({ name: clean(item?.name, 60), box: quantity(item?.box) })) : [],
  registeredAt: iso(entry.registeredAt),
} : null;
const trackUrl=links=>{
  for(const key of ['aircraftTrack','flightTrack']){
    const url=links&&typeof links[key]==='string'?links[key]:'';
    if(url.length<=200&&/^https:\/\/www\.flightradar24\.com\/data\/(?:aircraft|flights)\/[a-z0-9-]{2,12}$/.test(url))return url;
  }
  return null;
};
function projectFlightBoard(data){
  if(!data||typeof data!=='object'||!Array.isArray(data.flights)||data.flights.length>300)throw Error('수입 비행기 현황 형식을 확인하세요.');
  const s=data.summary&&typeof data.summary==='object'?data.summary:{};
  const candidates=[
    ...(Array.isArray(data.todo)?data.todo:[]),
    ...(Array.isArray(data.issues)?data.issues:[]).map(t=>({...t,level:'amber'}))
  ];
  const seen=new Set(),issues=[];
  for(const entry of candidates){
    if(!entry||!['red','amber'].includes(entry.level)||typeof entry.text!=='string'||!entry.text.trim())continue;
    const key=String(entry.key||'')+'\0'+entry.text;
    if(seen.has(key))continue;
    seen.add(key);
    issues.push({label:issueText(entry.label).slice(0,60),level:entry.level,text:issueText(entry.text),viewId:entry.key?flightViewId(entry.key):''});
  }
  issues.sort((a,b)=>(a.level==='red'?0:1)-(b.level==='red'?0:1));
  const todo=issues.slice(0,40);
  const rows=data.flights.filter(f=>f&&typeof f==='object'&&STATUS.includes(f.status));
  const flights=linkedFlights(rows,candidates).filter(f=>f.status!=='registered'||f.flightIssues.length).map(f=>{
    const steps=Array.isArray(f.checklist?.steps)?f.checklist.steps.filter(x=>x&&typeof x==='object'):[];
    const next=steps.find(x=>x.state==='late')||steps.find(x=>x.state==='due');
    const progress=Number(f.progress);
    return {
      viewId:flightViewId(f.key),weekLabel:clean(f.weekLabel,12),country:clean(f.country,12),itemLabel:clean(f.itemLabel,40),
      displayName:clean(f.displayName,60),
      customsProgress:f.customsProgress ? {
        declaration:['pending','cleared'].includes(f.customsProgress.declaration) ? f.customsProgress.declaration : '',
        release:f.customsProgress.release === 'waiting' ? 'waiting' : 'unknown',
      } : null,
      extraTitleItems:Array.isArray(f.extraTitleItems)?f.extraTitleItems.slice(0,80).map(name=>clean(name,60)).filter(Boolean):[],
      airline:clean(f.airline,32),awb:/^\d{3}-?\d{8}$/.test(f.awb||'')?f.awb:'',
      originAssumed:f.origin?.assumed===true,announcedCargo:cargo(f.announcedCargo),receivedCargo:cargo(f.receivedCargo),
      steps:steps.filter(x=>STEP_STATES.includes(x.state)).slice(0,20).map(x=>({label:clean(x.label,30),state:x.state,at:iso(x.at)})),
      quarantineSlotChanged:f.checklist?.quarantineSlotChanged===true,
      flight:clean(f.flight,12),statusLabel:clean(f.statusLabel,40),status:f.status,
      progress:f.progress!==null&&f.progress!==undefined&&Number.isFinite(progress)?Math.max(0,Math.min(1,progress)):null,
      viaName:clean(f.via?.name,20),origin:place(f.origin),via:place(f.via),position:point(f.position),route:routeLine(f.route),phase:clean(f.phase,20),arriveAt:iso(f.arriveAt),timeAssumed:f.timeAssumed===true,
      estimatedAt:iso(f.actual?.estimatedAt),remark:clean(f.actual?.remark,12),
      scheduledAt:iso(f.actual?.scheduledAt),departAtEstimated:iso(f.departAtEstimated),
      quarantineDeadlineAt:iso(f.checklist?.quarantine?.deadlineAt),quarantineSlot:clean(f.checklist?.quarantine?.slot,6),
      regNo:clean(f.aircraft?.regNo,10),trackUrl:trackUrl(f.links),
      alertCount:Array.isArray(f.alerts)?Math.min(f.alerts.length,99):0,
      nextStep:next?clean(next.label,20):'',nextState:next?next.state:'',
      doneSteps:steps.filter(x=>x.state==='done').length,totalSteps:Math.min(steps.length,20),
    };
  });
  return {
    generatedAt:iso(data.generatedAt),feedOk:data.feed?.ok===true,
    feedRooms:Object.entries(data.feed?.rooms||{}).slice(0,3).map(([room,r])=>({room:clean(room,20),latestMessageAt:iso(r?.latestMessageAt),latestImportedAt:iso(r?.latestImportedAt),error:!!r?.error})),
    sources:{icn:data.sources?.icn?.enabled===true&&data.sources?.icn?.ok===true,customs:data.sources?.customs?.enabled===true&&data.sources?.customs?.ok===true},
    summary:{total:count(s.total),beforeDeparture:count(s.beforeDeparture),inFlight:count(s.inFlight),arrived:count(s.arrived),registered:count(s.registered),awaitingAwb:count(s.awaitingAwb),red:count(s.red),amber:count(s.amber)},
    destination:place(data.destination)||{name:'인천',lat:37.46,lon:126.44},
    todo,issueTotal:issues.length,flights,registeredCount:rows.filter(f=>f.status==='registered').length,
  };
}
async function importFlightBoard({owner,fetch,isCurrent,onUnauthorized,fresh=false}) {
  if(!owner||!isCurrent())throw Error('로그인이 필요합니다.');
  const response=await fetch(ORIGIN+'/api/import/flight-board'+(fresh===true?'?fresh=1':''),{method:'GET',credentials:'include',cache:'no-store',redirect:'error',signal:AbortSignal.timeout(25000)});
  if(!isCurrent())throw Error('계정이 변경되었습니다.');
  if([401,403].includes(response.status)){onUnauthorized?.();throw Error('로그인을 다시 확인하세요.');}
  if(!response.ok)throw Error('수입 비행기 현황을 불러오지 못했습니다.');
  const raw=await response.text();if(!isCurrent())throw Error('계정이 변경되었습니다.');if(raw.length>2*1024*1024)throw Error('수입 비행기 현황이 너무 큽니다. 네노바 홈에서 확인하세요.');
  let data;try{data=JSON.parse(raw);}catch{throw Error('수입 비행기 현황 응답을 확인하세요.');}if(data.success!==true)throw Error('수입 비행기 현황을 불러오지 못했습니다.');
  return {success:true,ownerId:owner,...projectFlightBoard(data)};
}
module.exports={importFlightBoard,projectFlightBoard};
