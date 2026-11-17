const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {importFlightBoard,projectFlightBoard}=require('../flight-board.cjs');
// 운송장 번호는 전부 지어낸 값이다.
const flight=(over={})=>({key:'014-12345675',weekLabel:'46-2',country:'콜롬비아',itemLabel:'콜카장수국',airline:'AIR CANADA',awb:'014-12345675',flight:'AC063',box:597,arriveAt:'2026-11-18T05:20:00.000Z',timeAssumed:false,
  status:'in_flight',statusLabel:'밴쿠버 경유지 대기(추정)',progress:0.45,via:{code:'YVR',name:'밴쿠버'},phase:'layover',note:'x',
  actual:{scheduledAt:'2026-11-18T08:10:00.000Z',estimatedAt:'2026-11-18T08:10:00.000Z',remark:null,delayMinutes:170},aircraft:{regNo:'C-FIVM',type:'789'},
  links:{aircraftTrack:'https://www.flightradar24.com/data/aircraft/c-fivm',flightTrack:'https://www.flightradar24.com/data/flights/ac63',flightSearch:'https://www.google.com/search?q=AC063'},
  checklist:{quarantine:{deadlineAt:'2026-11-19T00:00:00.000Z',slot:'오전'},steps:[{key:'awb',label:'빌번호',state:'done'},{key:'notice',label:'도착 공지',state:'done'},{key:'docs',label:'서류 전달',state:'due'},{key:'quarantine',label:'검역',state:'late'}]},
  alerts:[{level:'amber',text:'a'}],roomEvents:[{text:'secret 014-12345675'}],receipt:{farms:20},contents:{items:[{name:'장미',box:3}]},...over});
const body=(over={})=>({success:true,generatedAt:'2026-11-17T08:00:00.000Z',feed:{ok:true},sources:{icn:{enabled:true,ok:true},customs:{enabled:true,ok:false}},
  summary:{total:3,beforeDeparture:0,inFlight:1,arrived:0,registered:1,awaitingAwb:1,issues:2,red:1,amber:1},
  todo:[{key:'014-12345675',label:'46-2차 콜롬비아 AC063',level:'red',text:'스케줄 변경 공지가 선율방에 없음'},{key:'k',label:'l',level:'info',text:'무시'}],
  flights:[flight(),flight({key:'reg',status:'registered',statusLabel:'입고 등록 끝'}),flight({key:'46-2|중국|CLOUD',awb:'',flight:'',status:'awaiting_awb',statusLabel:'빌번호 대기',progress:null,via:null,actual:null,aircraft:null,links:{flightTrack:null},checklist:null,alerts:[]})],...over});

test('flight board keeps only safe summary fields and never forwards waybill numbers',()=>{
  const out=projectFlightBoard(body());
  assert.equal(JSON.stringify(out).includes('12345675'),false,'운송장 번호가 결과 어디에도 없어야 한다');
  assert.equal(JSON.stringify(out).includes('secret'),false);
  assert.deepEqual(out.summary,{total:3,beforeDeparture:0,inFlight:1,arrived:0,registered:1,awaitingAwb:1,red:1,amber:1});
  assert.deepEqual(out.sources,{icn:true,customs:false});
  assert.equal(out.feedOk,true);
  assert.equal(out.todo.length,1,'red·amber 만 넘긴다');
  assert.equal(out.flights.length,2,'입고 등록 끝난 편은 뺀다');
  assert.equal(out.registeredCount,1);
  const f=out.flights[0];
  assert.deepEqual(Object.keys(f).sort(),['alertCount','arriveAt','country','doneSteps','estimatedAt','flight','itemLabel','nextState','nextStep','progress','quarantineDeadlineAt','quarantineSlot','regNo','remark','status','statusLabel','timeAssumed','totalSteps','trackUrl','viaName','weekLabel'].sort());
  assert.equal(f.viaName,'밴쿠버');assert.equal(f.regNo,'C-FIVM');assert.equal(f.progress,0.45);
  assert.equal(f.trackUrl,'https://www.flightradar24.com/data/aircraft/c-fivm','기체 번호 주소 우선');
  assert.equal(f.nextStep,'검역');assert.equal(f.nextState,'late','late 가 due 보다 먼저');
  assert.equal(f.doneSteps,2);assert.equal(f.totalSteps,4);assert.equal(f.alertCount,1);
  assert.equal(f.estimatedAt,'2026-11-18T08:10:00.000Z');assert.equal(f.quarantineSlot,'오전');
  const g=out.flights[1];
  assert.equal(g.trackUrl,null);assert.equal(g.progress,null);assert.equal(g.nextStep,'');assert.equal(g.totalSteps,0);
});
test('flight board bounds list sizes, text lengths and outside links',()=>{
  const many=projectFlightBoard(body({flights:Array.from({length:20},(_,i)=>flight({key:'k'+i})),todo:Array.from({length:20},()=>({key:'k',label:'가'.repeat(200),level:'amber',text:'나'.repeat(500)}))}));
  assert.equal(many.flights.length,8);assert.equal(many.todo.length,8);
  assert.equal(many.todo[0].label.length,60);assert.equal(many.todo[0].text.length,160);
  for(const bad of ['https://evil.example/data/aircraft/x','http://www.flightradar24.com/data/aircraft/n773ck','https://www.flightradar24.com/data/aircraft/../x','javascript:alert(1)'])
    assert.equal(projectFlightBoard(body({flights:[flight({links:{aircraftTrack:bad,flightTrack:bad}})]})).flights[0].trackUrl,null,bad);
  assert.equal(projectFlightBoard(body({flights:[flight({links:{aircraftTrack:null,flightTrack:'https://www.flightradar24.com/data/flights/ac63'}})]})).flights[0].trackUrl,'https://www.flightradar24.com/data/flights/ac63');
  assert.equal(projectFlightBoard(body({flights:[flight({status:'weird'})]})).flights.length,0,'모르는 상태는 버린다');
  assert.equal(projectFlightBoard(body({flights:[flight({progress:7})]})).flights[0].progress,1);
  assert.throws(()=>projectFlightBoard({flights:Array(301).fill({})}));
  assert.throws(()=>projectFlightBoard({}));
});
test('flight board uses fixed GET, prevents stale-account responses and rejects unauthorized',async()=>{
  let current=true,unauthorized=0;
  const fetch=async(url,options)=>{assert.equal(url,'https://nenovaweb.com/api/import/flight-board');assert.equal(options.method,'GET');assert.equal(options.redirect,'error');assert.equal(options.cache,'no-store');return Response.json(body());};
  const ok=await importFlightBoard({owner:'a',fetch,isCurrent:()=>current});
  assert.equal(ok.success,true);assert.equal(ok.ownerId,'a');assert.equal(ok.flights.length,2);
  await assert.rejects(importFlightBoard({owner:'',fetch,isCurrent:()=>true}),/로그인/);
  await assert.rejects(importFlightBoard({owner:'a',fetch:async(...args)=>{const r=await fetch(...args);current=false;return r;},isCurrent:()=>current}),/계정/);
  await assert.rejects(importFlightBoard({owner:'a',fetch:async()=>new Response('',{status:401}),isCurrent:()=>true,onUnauthorized:()=>unauthorized++}),/로그인/);assert.equal(unauthorized,1);
  await assert.rejects(importFlightBoard({owner:'a',fetch:async()=>new Response('',{status:500}),isCurrent:()=>true}),/불러오지/);
  await assert.rejects(importFlightBoard({owner:'a',fetch:async()=>Response.json({success:false}),isCurrent:()=>true}),/불러오지/);
  await assert.rejects(importFlightBoard({owner:'a',fetch:async()=>new Response('{"success":true,"flights":[],"pad":"'+'x'.repeat(2*1024*1024)+'"}'),isCurrent:()=>true}),/너무 큽니다/);
  await assert.rejects(importFlightBoard({owner:'a',fetch:async()=>new Response('not json'),isCurrent:()=>true}),/응답/);
});
test('desktop wires the flight board action, shell file and package list',()=>{
  const read=file=>fs.readFileSync(path.join(__dirname,'..',file),'utf8');
  assert.match(read('preload.cjs'),/'importFlightBoard'/);
  const main=read('main.cjs');
  assert.match(main,/case 'importFlightBoard':/);
  assert.match(main,/'pmLiveStatus', 'importFlightBoard'\]\.includes\(action\)/,'5분마다 부르는 조회는 작업 기록에 남기지 않는다');
  assert.match(main,/'flight-board\.js'/);
  const html=read('shell/index.html');
  assert.match(html,/<section id="flightBoard" class="workspace-card"[^>]*hidden><\/section>/);
  assert.ok(html.indexOf('./flight-board.js')>0&&html.indexOf('./flight-board.js')<html.indexOf('./shell.js'));
  assert.ok(JSON.parse(read('package.json')).build.files.includes('flight-board.cjs'),'설치본에 flight-board.cjs 포함');
  const shell=read('shell/flight-board.js');
  assert.equal(/innerHTML|fetch\(|XMLHttpRequest/.test(shell),false,'셸은 직접 통신하거나 HTML 을 끼워 넣지 않는다');
});
