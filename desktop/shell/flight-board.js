const flightPresentation = (() => {
  const normalize = value => String(value || '').replace(/\s+/g, ' ').trim();
  function issueRows(rows) {
    const unique = new Map();
    for (const row of rows || []) {
      const text = normalize(row.text);
      if (!text) continue;
      const identity = row.key || row.viewId || row.label || '';
      const key = JSON.stringify([identity, text]);
      const prior = unique.get(key);
      if (!prior || row.level === 'red') unique.set(key, { ...row, text });
    }
    return [...unique.values()].sort((a, b) => Number(b.level === 'red') - Number(a.level === 'red'));
  }
  function shortIssue(text) {
    return normalize(text)
      .replace('스케줄 변경 공지가 선율방에 없음', '선율방 변경 공지 미확인')
      .replace('공항 예정 시각이 공지와 다름:', '도착 시각 불일치:')
      .replace('변경 공지가 일부 방에만 올라옴', '변경 공지 공유 누락')
      .replace('서류 전달 표시 없음', '서류 전달 미확인');
  }
  // Identity is the full flight key (including year) or its desktop hash, never the flight number alone.
  function linkedFlights(flights, rows) {
    const issues = issueRows(rows);
    return (flights || []).map((f, index) => {
      const flightIssues = issues.filter(it => (it.key && it.key === f.key) || (it.viewId && it.viewId === f.viewId));
      const steps = f.checklist?.steps || [];
      const urgent = flightIssues.some(it => it.level === 'red') || steps.some(st => st.state === 'late') || f.nextState === 'late';
      const needsCheck = flightIssues.length > 0 || steps.some(st => st.state === 'due') || !!f.nextStep;
      const priority = f.status === 'registered' ? 3 : urgent ? 0 : needsCheck ? 1 : 2;
      const nextStep = f.nextStep || (steps.find(st => st.state === 'late') || steps.find(st => st.state === 'due'))?.label || '';
      return { ...f, flightIssues, priority, nextStep, boardNumber: index + 1 };
    }).sort((a, b) => a.priority - b.priority || a.boardNumber - b.boardNumber);
  }
  function nextAction(issue) {
    const text = normalize(issue?.text || issue);
    if (/서류/.test(text)) return '서류 전달 여부 확인';
    if (/검역|검사 접수/.test(text)) return '검역 접수·마감 확인';
    if (/시각|도착 변경|지연/.test(text)) return '연결 페이지에서 운항일·도착 시각 확인';
    if (/공지|공유/.test(text)) return '원문 대조 후 공유 여부 확인';
    return '관련 자료 확인';
  }
  return { issueRows, shortIssue, linkedFlights, nextAction };
})();
if(typeof module==='object'&&module.exports)module.exports=flightPresentation;
/* 앱 홈 맨 위 「수입 비행기 현황」: 지도와 편별 상태. 메인 프로세스가 추려 준 읽기 전용 요약만 그린다(스타일은 CSP 때문에 JS 로 준다). */
(() => {
  'use strict';
  if(typeof document==='undefined')return;
  const root=document.getElementById('flightBoard');
  if(!root||!window.desktop)return;
  const {issueRows,shortIssue,linkedFlights,nextAction}=flightPresentation;
  const SVG='http://www.w3.org/2000/svg',world=window.NenovaWorldMap||null;
  const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;};
  const css=(n,style)=>{Object.assign(n.style,style);return n;};
  const btn=(text,fn,cls='')=>{const n=el('button',cls,text);n.type='button';n.onclick=fn;return n;};
  const svg=(tag,attrs={},text)=>{const n=document.createElementNS(SVG,tag);for(const [k,v] of Object.entries(attrs))n.setAttribute(k,String(v));if(text!==undefined)n.textContent=text;return n;};
  const COLORS={in_flight:['#e3f0ff','#0b57a4'],before_departure:['#f1f3f5','#495057'],awaiting_awb:['#fff4d6','#8a5a00'],arrived:['#e6f6ea','#1d6b33'],unknown:['#f1f3f5','#495057'],red:['#ffe3e3','#b02a2a'],amber:['#fff4d6','#8a5a00'],gray:['#f1f3f5','#6c757d']};
  const DOT={in_flight:'#1668c7',before_departure:'#868e96'};
  const chip=(text,[bg,ink])=>css(el('span','',text),{display:'inline-block',padding:'2px 9px',borderRadius:'11px',background:bg,color:ink,fontSize:'12px',fontWeight:'700',whiteSpace:'nowrap'});
  // 한국 시간 고정(이 PC 시간대와 무관)
  const kst=iso=>{const ms=Date.parse(iso);if(!Number.isFinite(ms))return null;const d=new Date(ms+9*3600000);return {mo:d.getUTCMonth()+1,day:d.getUTCDate(),hh:String(d.getUTCHours()).padStart(2,'0'),mm:String(d.getUTCMinutes()).padStart(2,'0'),dow:'일월화수목금토'[d.getUTCDay()]};};
  const when=(iso,withDow)=>{const p=kst(iso);return p?`${p.mo}/${p.day}${withDow?`(${p.dow})`:''} ${p.hh}:${p.mm}`:'';};
  const STORE='nenova.flightBoard.open';
  const readOpen=()=>{try{return window.localStorage.getItem(STORE)!=='0';}catch{return true;}};
  const saveOpen=value=>{try{window.localStorage.setItem(STORE,value?'1':'0');}catch{/* 저장이 막혀 있으면 이번 실행 동안만 유지 */}};
  let owner='',generation=0,visible=false,online=false,busy=false,timer=null,loaded=false,opened=readOpen(),last=null,selectedViewId='';
  const open=(viewId='')=>window.desktop.invoke('flightPopup',{viewId}).catch(e=>{status.textContent=e.message;});
  const head=el('div','workspace-card-heading'),title=el('h2','','수입 비행기 현황'),actions=el('div','workspace-actions');
  const detail=btn('확대 보기',()=>open()),retry=btn('새로고침',()=>void load(true),'workspace-refresh'),toggle=btn('접기 ▴',()=>setOpen(!opened));
  css(head,{flexWrap:'wrap'});css(actions,{marginLeft:'auto',flexWrap:'wrap',justifyContent:'flex-end'});
  for(const button of [retry,detail,toggle])css(button,{margin:'0',minHeight:'32px',whiteSpace:'nowrap'});
  const body=el('div');body.id='flightBoardBody';toggle.setAttribute('aria-controls',body.id);
  actions.append(retry,detail,toggle);head.append(title,actions);
  const status=el('p','workspace-muted','로그인 후 수입 비행기 현황을 확인할 수 있습니다.');status.setAttribute('role','status');
  const chips=css(el('div'),{display:'flex',flexWrap:'wrap',gap:'6px',margin:'6px 0'});
  const todoBox=css(el('div','flight-issues'),{border:'1px solid #f3c2c2',background:'#fff5f5',borderRadius:'8px',padding:'6px 10px',margin:'6px 0',fontSize:'12.5px',lineHeight:'1.65'});
  const split=css(el('div'),{display:'flex',flexWrap:'wrap',gap:'10px',alignItems:'flex-start'});
  const mapBox=css(el('div'),{flex:'1 1 420px',minWidth:'280px'});
  const list=css(el('div'),{flex:'1 1 380px',minWidth:'280px',display:'flex',flexDirection:'column'});
  const foot=css(el('p','workspace-muted'),{fontSize:'11.5px',margin:'6px 0 0'});
  const timingHelp=css(el('p','workspace-muted','STD(출발 예정)·ATD(실제 출발)는 미수신 · STA는 인천공항 도착 예정 · 출발과 지도 위치는 예측 기준'),{fontSize:'11.5px',margin:'4px 0'});
  split.append(mapBox,list);body.append(split,foot);root.append(head,status,chips,timingHelp,body);todoBox.hidden=true;
  function setOpen(value){opened=value;saveOpen(value);body.hidden=!value;toggle.textContent=value?'접기 ▴':'열기 ▾';toggle.setAttribute('aria-expanded',String(value));}
  function clear(){chips.replaceChildren();todoBox.replaceChildren();todoBox.hidden=true;mapBox.replaceChildren();list.replaceChildren();foot.textContent='';}
  // ── 지도: 태평양 중심 등장방형. 육지 윤곽은 flight-map-data.js(정적 자료). ──
  const project=(lon,lat)=>{const v=world.view;let l=lon;while(l<v.lon0)l+=360;while(l>=v.lon0+360)l-=360;return {x:(l-v.lon0)/v.lonSpan*v.width,y:(v.latMax-lat)/(v.latMax-v.latMin)*v.height};};
  const routeD=points=>{let d='',prev=null;for(const [lon,lat] of points||[]){const p=project(lon,lat),jump=prev!==null&&Math.abs(p.x-prev)>world.view.width/2;d+=`${prev===null||jump?'M':'L'}${p.x.toFixed(1)},${Math.max(2,Math.min(world.view.height-2,p.y)).toFixed(1)}`;prev=p.x;}return d;};
  function paintMap(data){
    mapBox.replaceChildren();
    if(!world||!world.view||typeof world.land!=='string')return;
    const v=world.view,map=svg('svg',{viewBox:`0 0 ${v.width} ${v.height}`,role:'group','aria-label':'수입 비행기 예측 위치 지도'});
    css(map,{width:'100%',height:'auto',display:'block',background:'#eef4fa',borderRadius:'8px',border:'1px solid #d7e0ea'});
    map.append(svg('path',{d:world.land,fill:'#d5dee8',stroke:'#aebccb','stroke-width':'0.4'}));
    const flights=(data.flights||[]).filter(f=>f.origin);
    const routes=new Map(),origins=new Map(),vias=new Map();
    for(const f of flights){
      const key=`${f.origin.name}-${f.via?.name||''}`;
      if(f.route?.length&&!routes.has(key))routes.set(key,{d:routeD(f.route),unknownVia:!f.via&&/콜롬비아|에콰도르/.test(f.country)});
      if(!origins.has(f.origin.name))origins.set(f.origin.name,f.origin);
      if(f.via&&!vias.has(f.via.name))vias.set(f.via.name,f.via);
    }
    const chosen=flights.find(f=>f.viewId===selectedViewId);
    if(chosen?.route?.length)map.append(svg('path',{d:routeD(chosen.route),fill:'none',stroke:'#145db4','stroke-width':'3'}));
    for(const r of routes.values()){const line=svg('path',{d:r.d,fill:'none',stroke:'#5b8fd1','stroke-width':'1',opacity:'0.75'});if(r.unknownVia)line.setAttribute('stroke-dasharray','3 3');map.append(line);}
    let index=0;
    for(const o of origins.values()){const p=project(o.lon,o.lat),below=index++%2===1;map.append(svg('circle',{cx:p.x,cy:p.y,r:'2.6',fill:'#fff',stroke:'#3b6fb5','stroke-width':'1'}),svg('text',{x:p.x+4,y:below?p.y+10:p.y-4,'font-size':'8',fill:'#33475b',stroke:'#eef4fa','stroke-width':'2','paint-order':'stroke'},o.name));}
    for(const w of vias.values()){const p=project(w.lon,w.lat);map.append(svg('rect',{x:p.x-2.6,y:p.y-2.6,width:'5.2',height:'5.2',transform:`rotate(45 ${p.x} ${p.y})`,fill:'#fff3bf',stroke:'#e67700','stroke-width':'1'}),svg('text',{x:p.x+5,y:p.y-4,'font-size':'8',fill:'#8a4b00',stroke:'#eef4fa','stroke-width':'2','paint-order':'stroke'},`${w.name}(경유)`));}
    const dest=data.destination;
    if(dest){const p=project(dest.lon,dest.lat);map.append(svg('circle',{cx:p.x,cy:p.y,r:'3.4',fill:'#d9480f',stroke:'#fff','stroke-width':'1'}),svg('text',{x:p.x+5,y:p.y+3,'font-size':'9','font-weight':'700',fill:'#b23c0a'},dest.name||'인천'));}
    for(const f of flights){
      if(f.status==='registered')continue;
      const at=f.status==='arrived'?data.destination:f.status==='before_departure'?f.origin:(f.position||f.origin);if(!at)continue;
      const p=project(at.lon,at.lat),g=svg('g'),waiting=f.phase==='layover'&&f.via;
      const prefix=`${f.boardNumber}. ${f.flight||f.country} · `;
      const label=prefix+(f.status==='before_departure'?`${f.country} 출발 전`:waiting?`${f.country} · ${f.via.name} 대기`:f.status==='arrived'?'도착':`${Math.round((f.progress||0)*100)}%`);
      g.append(svg('title',{},`${f.weekLabel}차 ${f.country} ${f.flight} — ${f.statusLabel}`),svg('circle',{cx:p.x,cy:p.y,r:f.viewId===selectedViewId?'9':'7',fill:f.priority===0?'#b02a2a':(DOT[f.status]||'#1668c7'),stroke:'#fff','stroke-width':'1.4'}),svg('text',{x:p.x,y:p.y+2.6,'font-size':'6.5','text-anchor':'middle',fill:'#fff','font-weight':'700'},String(f.boardNumber)),
        svg('text',{x:p.x+8,y:p.y+3,'font-size':'8','font-weight':'700',fill:'#0b3d75',stroke:'#eef4fa','stroke-width':'2','paint-order':'stroke'},label));
      g.style.cursor='pointer';g.setAttribute('role','button');g.setAttribute('tabindex','0');g.setAttribute('aria-label',`${f.boardNumber}번 ${f.country} ${f.flight} 선택`);g.setAttribute('aria-pressed',String(f.viewId===selectedViewId));g.onclick=e=>{e.stopPropagation();selectFlight(f.viewId);};g.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();selectFlight(f.viewId);}};
      map.append(g);
    }
    const enlarge=el('div');enlarge.append(map);
    mapBox.append(enlarge,css(el('p','workspace-muted','지도 위 위치와 %는 일정으로 계산한 예측입니다. 실제 위치는 편별 「실제 위치」로 확인하세요.'),{fontSize:'11.5px',margin:'4px 0 0'}));
  }
  function paint(data){
    clear();last=data;
    const s=data.summary||{},issues=data.issueTotal??((s.red||0)+(s.amber||0));
    chips.append(chip(`비행 중 ${s.inFlight||0}`,COLORS.in_flight),chip(`출발 전 ${s.beforeDeparture||0}`,COLORS.before_departure),chip(`빌번호 대기 ${s.awaitingAwb||0}`,COLORS.awaiting_awb),chip(`도착·입고 대기 ${s.arrived||0}`,COLORS.arrived),
      chip(`확인 필요 ${issues}`,issues?(s.red?COLORS.red:COLORS.amber):COLORS.gray));
    const flights=linkedFlights(data.flights||[],data.todo||[]);
    paintMap({...data,flights});
    for(const f of flights){
      const row=css(el('div'),{display:'flex',flexWrap:'wrap',alignItems:'center',gap:'5px 10px',padding:'7px 2px',borderTop:'1px solid #e9ecef',fontSize:'12.5px'});
      const name=css(el('span'),{minWidth:'140px'});name.append(css(el('b','',`${f.weekLabel} ${f.country}`),{fontWeight:'700'}),css(el('span','',f.itemLabel?` ${f.itemLabel}`:''),{color:'#868e96',fontSize:'11.5px'}));
      const flight=css(el('span','',f.flight||'편명 없음'),{minWidth:'88px',color:f.flight?'#212529':'#b07500'});
      if(f.regNo)flight.append(css(el('span','',` 기체 ${f.regNo}`),{color:'#868e96',fontSize:'11px'}));
      const pct=f.status==='in_flight'&&f.progress!==null&&!/대기/.test(f.statusLabel)?` ${Math.round(f.progress*100)}%`:'';
      const state=chip(`${f.statusLabel}${pct}`,COLORS[f.status]||COLORS.gray);
      const at=f.arriveAt;
      const arrive=el('span','',at?'공지 도착 '+(f.timeAssumed?when(at,true).slice(0,-5)+'시각 미정':when(at,true)):'공지 도착 미정');
      const selected=f.viewId===selectedViewId;
      row.dataset.flightId=f.viewId;row.tabIndex=-1;
      css(row,{border:'1px solid #d7e0ea',borderLeft:`4px solid ${f.priority===0?'#b02a2a':f.priority===1?'#b07500':'#aab8c8'}`,borderRadius:'8px',padding:'8px',marginBottom:'8px',background:selected?'#f0f6ff':'#fff'});
      const choose=btn(`${f.boardNumber}. ${f.country} · ${f.flight||'편명 미확인'} ${selected?'▴':'▾'}`,()=>selectFlight(selected?'':f.viewId));
      choose.dataset.flightSelect='';choose.setAttribute('aria-expanded',String(selected));css(choose,{fontWeight:'700',textAlign:'left',flexBasis:'100%'});
      row.append(choose,state,arrive);
      if(f.priority<2||selected){
        const issues=el('ol');css(issues,{flexBasis:'100%',margin:'2px 0',paddingLeft:'22px'});
        for(const it of (selected?f.flightIssues:f.flightIssues.slice(0,2))){const item=el('li','',shortIssue(it.text));item.append(css(el('div','',`→ ${nextAction(it)}`),{color:'#526981',fontSize:'12px'}));issues.append(item);}
        row.append(issues);if(!selected&&f.flightIssues.length>2)row.append(btn(`이슈 ${f.flightIssues.length}건 모두 보기`,()=>selectFlight(f.viewId)));
      }
      row.onkeydown=e=>{if(e.key==='Escape'){selectFlight('');[...list.children].find(n=>n.dataset.flightId===f.viewId)?.querySelector('button')?.focus();}};
      if(selected)row.append(name,flight,btn('상세·원문 확인',()=>open(f.viewId)));

      const timing=css(el('div','flight-times'),{flexBasis:'100%',fontSize:'11.5px',color:'#526981'});
      const values=[];
      if(f.departAtEstimated)values.push('출발 예측 '+when(f.departAtEstimated,true));
      if(!f.estimatedAt)values.push(f.scheduledAt?'공항 예정 '+when(f.scheduledAt,true):'공항 예정 확인 중');
      if(f.estimatedAt)values.push((/도착/.test(f.remark)?'공항 도착 표시 ':'공항 최신 예정 ')+when(f.estimatedAt,true));
      if(f.remark&&!f.statusLabel.includes(f.remark))values.push('공항 상태 '+f.remark);timing.textContent=values.join(' · ');if(selected)row.append(timing);
      if(selected&&f.quarantineDeadlineAt){const past=Date.parse(f.quarantineDeadlineAt)<Date.now();row.append(css(el('span','',`검역 마감(예상) ${when(f.quarantineDeadlineAt)}${f.quarantineSlot?` ${f.quarantineSlot}`:''}`),{color:past?'#b02a2a':'#495057',fontSize:'11.5px'}));}
      if(!f.flightIssues.length&&f.nextStep)row.append(chip(`${f.nextState==='late'?'⚠':'⏳'} ${f.nextStep}`,f.nextState==='late'?COLORS.red:COLORS.amber));
      if(f.trackUrl&&(f.priority<2||selected)){
        const go=btn('시간·실제 위치 원문 ↗',async()=>{go.disabled=true;try{await window.desktop.invoke('taskShortcut',{shortcut:{kind:'web',target:f.trackUrl,label:'실제 위치'}});}catch(e){status.textContent=e.message||'실제 위치 화면을 열지 못했습니다.';}finally{go.disabled=false;}});
        css(go,{marginLeft:'auto'});row.append(go);
      }
      list.append(row);
    }
    const p=kst(data.generatedAt);
    status.textContent=flights.length?`${p?`${p.mo}/${p.day} ${p.hh}:${p.mm} 기준 · `:''}5분마다 자동으로 다시 읽습니다. 「새로고침」을 누르면 바로 다시 읽습니다.`:(data.feedOk?'지금 들어오는 비행기 공지가 없습니다.':'도착 공지를 읽지 못했습니다. 잠시 후 다시 확인해 주세요.');
    const parts=[];if(data.registeredCount)parts.push(`입고 등록까지 끝난 편 ${data.registeredCount}건은 「확대 보기」에서 확인`);
    parts.push(`인천공항 자료 ${data.sources?.icn?'✔':'–'} · 통관 자료 ${data.sources?.customs?'✔':'–'}`);foot.textContent=parts.join(' · ');
  }
  function selectFlight(id){selectedViewId=id;if(!last)return;paint(last);const card=[...list.children].find(n=>n.dataset.flightId===id);card?.focus();card?.scrollIntoView({block:'nearest',behavior:'smooth'});}
  list.onkeydown=e=>{if(!['ArrowDown','ArrowUp'].includes(e.key)||!e.target.hasAttribute('data-flight-select'))return;const buttons=[...list.querySelectorAll('[data-flight-select]')],i=buttons.indexOf(e.target),next=buttons[i+(e.key==='ArrowDown'?1:-1)];if(next){e.preventDefault();next.focus();}};
  async function load(fresh){
    if(!owner||!visible||!online||busy||document.hidden)return;
    const ticket=generation,actor=owner;busy=true;retry.disabled=true;if(!loaded)status.textContent='불러오는 중…';else if(fresh)status.textContent='다시 읽는 중…';
    try{
      const data=await window.desktop.invoke('importFlightBoard',fresh===true?{fresh:true}:{});if(ticket!==generation||actor!==owner)return;
      if(!data?.success||data.ownerId!==owner)throw Error('수입 비행기 현황을 확인하지 못했습니다.');
      paint(data);loaded=true;
    }catch(e){if(ticket===generation){if(!last)clear();status.textContent=(e&&e.message)||'수입 비행기 현황을 불러오지 못했습니다. 새로고침을 눌러 주세요.';}}
    finally{if(ticket===generation){busy=false;retry.disabled=!owner||!online;clearTimeout(timer);timer=setTimeout(()=>void load(false),300000);}}
  }
  function applyState(state){
    if(!state||typeof state!=='object')return;
    const previousVisible=visible,previousOnline=online,nextOwner='homeOwnerId'in state?String(state.homeOwnerId||''):owner,changed=nextOwner!==owner;
    if(changed){owner=nextOwner;generation++;busy=false;loaded=false;last=null;selectedViewId='';clearTimeout(timer);clear();status.textContent=owner?'수입 비행기 현황을 확인합니다.':'로그인 후 수입 비행기 현황을 확인할 수 있습니다.';}
    if('menuOpen'in state)visible=!!state.menuOpen;if('online'in state)online=!!state.online;
    root.hidden=!owner;for(const b of [detail,retry])b.disabled=!owner||!online;
    if(owner&&visible&&online&&(changed||!previousVisible||!previousOnline))void load(false);
    if(!visible||!online)clearTimeout(timer);
  }
  setOpen(opened);
  window.desktop.onState(applyState);
  // 처음 상태는 방송이 아니라 조회로 받는다(다른 홈 카드는 shell.js 가 넘겨 주지만 이 구역은 스스로 받는다).
  window.desktop.invoke('state').then(applyState).catch(()=>{});
  window.flightBoard={applyState,reload:()=>load(true),setOpen};
})();
