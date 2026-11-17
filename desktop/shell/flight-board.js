/* 앱 홈 「수입 비행기 현황」. 메인 프로세스가 추려 준 읽기 전용 요약만 그린다(스타일은 CSP 때문에 JS 로 준다). */
(() => {
  'use strict';
  const root=document.getElementById('flightBoard');
  if(!root||!window.desktop)return;
  const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;};
  const css=(n,style)=>{Object.assign(n.style,style);return n;};
  const btn=(text,fn,cls='')=>{const n=el('button',cls,text);n.type='button';n.onclick=fn;return n;};
  const COLORS={in_flight:['#e3f0ff','#0b57a4'],before_departure:['#f1f3f5','#495057'],awaiting_awb:['#fff4d6','#8a5a00'],arrived:['#e6f6ea','#1d6b33'],unknown:['#f1f3f5','#495057'],red:['#ffe3e3','#b02a2a'],amber:['#fff4d6','#8a5a00'],gray:['#f1f3f5','#6c757d']};
  const chip=(text,[bg,ink])=>css(el('span','',text),{display:'inline-block',padding:'2px 9px',borderRadius:'11px',background:bg,color:ink,fontSize:'12px',fontWeight:'700',whiteSpace:'nowrap'});
  // 한국 시간 고정(이 PC 시간대와 무관)
  const kst=iso=>{const ms=Date.parse(iso);if(!Number.isFinite(ms))return null;const d=new Date(ms+9*3600000);return {mo:d.getUTCMonth()+1,day:d.getUTCDate(),hh:String(d.getUTCHours()).padStart(2,'0'),mm:String(d.getUTCMinutes()).padStart(2,'0'),dow:'일월화수목금토'[d.getUTCDay()]};};
  const when=(iso,withDow)=>{const p=kst(iso);return p?`${p.mo}/${p.day}${withDow?`(${p.dow})`:''} ${p.hh}:${p.mm}`:'';};
  let owner='',generation=0,visible=false,online=false,busy=false,timer=null,loaded=false;
  const open=()=>window.desktop.invoke('open',{url:'/dashboard',title:'네노바 홈'}).catch(e=>{status.textContent=e.message;});
  const head=el('div','workspace-card-heading'),title=el('h2','','수입 비행기 현황'),actions=el('div','workspace-actions');
  const detail=btn('지도·상세 보기 ↗',open,'workspace-primary'),retry=btn('새로고침',()=>void load(),'workspace-refresh');
  actions.append(detail,retry);head.append(title,actions);
  const status=el('p','workspace-muted','로그인 후 수입 비행기 현황을 확인할 수 있습니다.');status.setAttribute('role','status');
  const chips=css(el('div'),{display:'flex',flexWrap:'wrap',gap:'6px',margin:'6px 0'});
  const todoBox=css(el('div'),{border:'1px solid #f3c2c2',background:'#fff5f5',borderRadius:'8px',padding:'6px 10px',margin:'6px 0',fontSize:'12.5px',lineHeight:'1.65'});
  const list=css(el('div'),{display:'flex',flexDirection:'column'});
  const foot=css(el('p','workspace-muted'),{fontSize:'11.5px',margin:'6px 0 0'});
  root.append(head,status,chips,todoBox,list,foot);todoBox.hidden=true;
  function clear(){chips.replaceChildren();todoBox.replaceChildren();todoBox.hidden=true;list.replaceChildren();foot.textContent='';}
  function paint(data){
    clear();
    const s=data.summary||{},issues=(s.red||0)+(s.amber||0);
    chips.append(chip(`비행 중 ${s.inFlight||0}`,COLORS.in_flight),chip(`출발 전 ${s.beforeDeparture||0}`,COLORS.before_departure),chip(`빌번호 대기 ${s.awaitingAwb||0}`,COLORS.awaiting_awb),chip(`도착·입고 대기 ${s.arrived||0}`,COLORS.arrived),
      chip(`확인 필요 ${issues}`,issues?(s.red?COLORS.red:COLORS.amber):COLORS.gray));
    const todo=data.todo||[];
    if(todo.length){
      todoBox.hidden=false;todoBox.append(css(el('strong','','지금 확인할 것'),{display:'block',color:'#b02a2a',fontSize:'12.5px'}));
      for(const t of todo.slice(0,5)){
        const row=el('div'),dot=css(el('span','','● '),{color:t.level==='red'?'#d6336c':'#e67700'});
        row.append(dot,css(el('b','',t.label),{fontWeight:'700'}),document.createTextNode(` — ${t.text}`));todoBox.append(row);
      }
      if(todo.length>5)todoBox.append(css(el('div','',`외 ${todo.length-5}건은 「지도·상세 보기」에서 확인`),{color:'#868e96',fontSize:'11.5px'}));
    }
    const flights=(data.flights||[]).slice(0,6);
    for(const f of flights){
      const row=css(el('div'),{display:'flex',flexWrap:'wrap',alignItems:'center',gap:'6px 10px',padding:'7px 2px',borderTop:'1px solid #e9ecef',fontSize:'12.5px'});
      const name=css(el('span'),{minWidth:'150px'});name.append(css(el('b','',`${f.weekLabel} ${f.country}`),{fontWeight:'700'}),css(el('span','',f.itemLabel?` ${f.itemLabel}`:''),{color:'#868e96',fontSize:'11.5px'}));
      const flight=css(el('span','',f.flight||'편명 없음'),{minWidth:'92px',color:f.flight?'#212529':'#b07500'});
      if(f.regNo)flight.append(css(el('span','',` 기체 ${f.regNo}`),{color:'#868e96',fontSize:'11px'}));
      const pct=f.status==='in_flight'&&f.progress!==null&&!/대기/.test(f.statusLabel)?` ${Math.round(f.progress*100)}%`:'';
      const state=chip(`${f.statusLabel}${pct}`,COLORS[f.status]||COLORS.gray);
      const at=f.estimatedAt||f.arriveAt;
      const arrive=el('span','',at?`도착 ${f.timeAssumed&&!f.estimatedAt?when(at,true).replace(/ \d\d:\d\d$/,' 시각 미정'):when(at,true)}${f.estimatedAt?' · 공항':''}${f.remark?` ${f.remark}`:''}`:'도착 미정');
      row.append(name,flight,state,arrive);
      if(f.quarantineDeadlineAt){const past=Date.parse(f.quarantineDeadlineAt)<Date.now();row.append(css(el('span','',`검역 마감(예상) ${when(f.quarantineDeadlineAt)}${f.quarantineSlot?` ${f.quarantineSlot}`:''}`),{color:past?'#b02a2a':'#495057',fontSize:'11.5px'}));}
      if(f.nextStep)row.append(chip(`${f.nextState==='late'?'⚠':'⏳'} ${f.nextStep}`,f.nextState==='late'?COLORS.red:COLORS.amber));
      if(f.trackUrl){
        const go=btn('실제 위치 ↗',async()=>{go.disabled=true;try{await window.desktop.invoke('taskShortcut',{shortcut:{kind:'web',target:f.trackUrl,label:'실제 위치'}});}catch(e){status.textContent=e.message||'실제 위치 화면을 열지 못했습니다.';}finally{go.disabled=false;}});
        css(go,{marginLeft:'auto'});row.append(go);
      }
      list.append(row);
    }
    const p=kst(data.generatedAt);
    status.textContent=flights.length?`${p?`${p.mo}/${p.day} ${p.hh}:${p.mm} 기준 · `:''}지도 위 위치와 %는 일정으로 계산한 예측입니다.`:(data.feedOk?'지금 들어오는 비행기 공지가 없습니다.':'도착 공지를 읽지 못했습니다. 잠시 후 다시 확인해 주세요.');
    const parts=[];if(data.registeredCount)parts.push(`입고 등록까지 끝난 편 ${data.registeredCount}건은 「지도·상세 보기」에서 확인`);
    parts.push(`공항 자료 ${data.sources?.icn?'✔':'–'} · 통관 자료 ${data.sources?.customs?'✔':'–'}`);foot.textContent=parts.join(' · ');
  }
  async function load(){
    if(!owner||!visible||!online||busy||document.hidden)return;
    const ticket=generation,actor=owner;busy=true;retry.disabled=true;if(!loaded)status.textContent='불러오는 중…';
    try{
      const data=await window.desktop.invoke('importFlightBoard');if(ticket!==generation||actor!==owner)return;
      if(!data?.success||data.ownerId!==owner)throw Error('수입 비행기 현황을 확인하지 못했습니다.');
      paint(data);loaded=true;
    }catch(e){if(ticket===generation){clear();status.textContent=(e&&e.message)||'수입 비행기 현황을 불러오지 못했습니다. 새로고침을 눌러 주세요.';}}
    finally{if(ticket===generation){busy=false;retry.disabled=!owner||!online;clearTimeout(timer);timer=setTimeout(()=>void load(),300000);}}
  }
  function applyState(state){
    if(!state||typeof state!=='object')return;
    const previousVisible=visible,previousOnline=online,nextOwner='homeOwnerId'in state?String(state.homeOwnerId||''):owner,changed=nextOwner!==owner;
    if(changed){owner=nextOwner;generation++;busy=false;loaded=false;clearTimeout(timer);clear();status.textContent=owner?'수입 비행기 현황을 확인합니다.':'로그인 후 수입 비행기 현황을 확인할 수 있습니다.';}
    if('menuOpen'in state)visible=!!state.menuOpen;if('online'in state)online=!!state.online;
    root.hidden=!owner;for(const b of [detail,retry])b.disabled=!owner||!online;
    if(owner&&visible&&online&&(changed||!previousVisible||!previousOnline))void load();
    if(!visible||!online)clearTimeout(timer);
  }
  window.desktop.onState(applyState);
  // 처음 상태는 방송이 아니라 조회로 받는다(다른 홈 카드는 shell.js 가 넘겨 주지만 이 구역은 스스로 받는다).
  window.desktop.invoke('state').then(applyState).catch(()=>{});
  window.flightBoard={applyState,reload:()=>load()};
})();
