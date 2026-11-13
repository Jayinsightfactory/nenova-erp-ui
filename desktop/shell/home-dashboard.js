/* Desktop-only home. Read-only projections; private tasks keep their existing owner fence. */
(() => {
  'use strict';
  const board=document.getElementById('requestBoard'),calendar=document.getElementById('workCalendar');
  if(!board||!calendar)return;
  const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;};
  const btn=(text,fn,cls='')=>{const n=el('button',cls,text);n.type='button';n.onclick=fn;return n;};
  const today=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul'}).format(new Date());
  let owner='',generation=0,visible=false,online=false,selected=today(),month=selected.slice(0,7),days=[],boardBusy=false,calendarRead=0,timer;
  const open=(query)=>window.desktop.invoke('open',{url:'/pm?'+query,title:'개발요청 게시판'}).catch(e=>{boardStatus.textContent=e.message;});
  const head=el('div','workspace-card-heading'),title=el('h2','','개발요청 게시판'),actions=el('div','workspace-actions');
  const write=btn('＋ 요청 작성',()=>open('requests=new'),'workspace-primary'),all=btn('전체 보기 ↗',()=>open('requests=list'));
  actions.append(write,all);head.append(title,actions);
  const boardStatus=el('p','workspace-muted','로그인 후 개발요청을 확인할 수 있습니다.'),list=el('div','request-list');boardStatus.setAttribute('role','status');
  const retry=btn('새로고침',()=>void loadBoard(),'workspace-refresh');board.append(head,boardStatus,list,retry);
  async function loadBoard(){
    if(!owner||!visible||!online||boardBusy||document.hidden)return;
    const ticket=generation,actor=owner;boardBusy=true;retry.disabled=true;
    try{const data=await window.desktop.invoke('homeRequests');if(ticket!==generation||actor!==owner)return;
      if(!data?.success||data.ownerId!==owner)throw Error('개발요청을 확인하지 못했습니다.');
      list.replaceChildren();for(const request of (data.requests||[]).slice(0,4)){
        const row=btn('',()=>open('requests=list&requestId='+encodeURIComponent(request.id)),'request-row');
        const badge=el('span','request-status',request.statusLabel);badge.dataset.status=request.status;
        row.append(badge,el('span','request-title',request.title),el('span','request-category',request.categoryLabel));list.append(row);
      }
      boardStatus.textContent=data.requests?.length?'최근 요청 · 제목을 선택하면 상세 내용을 엽니다.':'등록된 개발요청이 없습니다. 새 요청을 작성해 보세요.';
    }catch(e){if(ticket===generation){list.replaceChildren();boardStatus.textContent=e.message||'게시판 조회 실패 · 다시 시도해 주세요.';}}
    finally{if(ticket===generation){boardBusy=false;retry.disabled=false;clearTimeout(timer);timer=setTimeout(()=>void loadBoard(),60000);}}
  }
  const calHead=el('div','workspace-card-heading'),calTitle=el('h2'),calActions=el('div','workspace-actions');
  const prev=btn('‹',()=>browse(-1)),next=btn('›',()=>browse(1)),now=btn('오늘',()=>choose(today()));prev.setAttribute('aria-label','이전 달');next.setAttribute('aria-label','다음 달');
  calActions.append(prev,next,now);calHead.append(calTitle,calActions);
  const week=el('div','calendar-week');for(const name of ['일','월','화','수','목','금','토'])week.append(el('span','',name));
  const grid=el('div','calendar-grid');grid.setAttribute('role','group');grid.setAttribute('aria-label','날짜 선택 · 방향키 이동');
  const calStatus=el('p','calendar-status');calStatus.setAttribute('role','status');calendar.append(calHead,week,grid,calStatus);
  function paint(){
    const [year,m]=month.split('-').map(Number),first=new Date(Date.UTC(year,m-1,1)).getUTCDay(),length=new Date(Date.UTC(year,m,0)).getUTCDate();
    const focused=grid.contains(document.activeElement)?document.activeElement.dataset.date:null;
    calTitle.textContent=year+'년 '+m+'월';grid.replaceChildren();
    prev.disabled=!owner||month==='2000-01';next.disabled=!owner||month==='2100-12';now.disabled=!owner;
    for(let i=0;i<first;i++){const spacer=el('span','calendar-spacer');spacer.setAttribute('aria-hidden','true');grid.append(spacer);}
    for(let d=1;d<=length;d++){
      const date=month+'-'+String(d).padStart(2,'0'),data=days.find(x=>x.date===date),b=btn('',()=>choose(date),'calendar-day');b.dataset.date=date;
      b.append(el('span','',String(d)));if(data?.total)b.append(el('small','',data.done+'/'+data.total));
      b.setAttribute('aria-label',date+(data?' · 업무 '+data.total+'건, 완료 '+data.done+'건':''));b.setAttribute('aria-pressed',String(date===selected));
      if(date===today())b.setAttribute('aria-current','date');b.disabled=!owner;b.tabIndex=date===(selected.startsWith(month)?selected:month+'-01')?0:-1;
      b.onkeydown=e=>{const delta={ArrowLeft:-1,ArrowRight:1,ArrowUp:-7,ArrowDown:7}[e.key];if(delta===undefined)return;e.preventDefault();const at=new Date(date+'T12:00:00Z');at.setUTCDate(at.getUTCDate()+delta);const target=at.toISOString().slice(0,10);if(target.slice(0,7)!==month)return;grid.querySelectorAll('button').forEach(n=>n.tabIndex=n.dataset.date===target?0:-1);grid.querySelector('[data-date="'+target+'"]')?.focus();};
      grid.append(b);
    }
    if(focused)grid.querySelector('[data-date="'+focused+'"]')?.focus({preventScroll:true});
    if(!owner)calStatus.textContent='로그인하면 개인 업무 일정을 확인할 수 있습니다.';
    else if(days.length)calStatus.textContent='선택 '+selected+' · 숫자는 완료 / 전체 업무 · 날짜를 눌러 오른쪽 업무 확인';
  }
  function choose(date){if(!owner)return;if(window.homeWorkspace?.selectDate(date,date===today())){selected=date;if(month!==date.slice(0,7)){month=date.slice(0,7);days=[];}paint();}}
  async function loadCalendar(){
    if(!owner||!online)return;const ticket=++calendarRead,actor=owner,requested=month;calStatus.textContent='월별 업무를 확인하고 있습니다…';
    try{const data=await window.desktop.invoke('homeWorkspace',{method:'GET',date:selected,calendarMonth:requested,limit:1});
      if(ticket!==calendarRead||actor!==owner||requested!==month)return;if(!data?.success||data.ownerId!==owner||data.calendar?.month!==month)throw Error(data?.error||'달력을 확인하지 못했습니다.');days=data.calendar.days;paint();
    }catch(e){if(ticket===calendarRead&&actor===owner)calStatus.textContent=(e.message||'달력 조회 실패')+' · 월 이동으로 다시 시도할 수 있습니다.';}
  }
  function browse(delta){const at=new Date(month+'-01T12:00:00Z');at.setUTCMonth(at.getUTCMonth()+delta);const value=at.toISOString().slice(0,7);if(value<'2000-01'||value>'2100-12')return;month=value;days=[];
    const update=()=>paint();if(document.startViewTransition&&!matchMedia('(prefers-reduced-motion: reduce)').matches){const transition=document.startViewTransition(update);transition.finished.catch(()=>{});}else update();void loadCalendar();
  }
  window.addEventListener('home-workspace-data',e=>{if(e.detail.owner!==owner)return;const changed=selected!==e.detail.date;selected=e.detail.date;if(changed){month=selected.slice(0,7);days=[];}if(e.detail.calendar?.month===month)days=e.detail.calendar.days;if(changed||e.detail.calendar)paint();});
  window.homeDashboard={applyState(state){const previousVisible=visible,previousOnline=online,nextOwner='homeOwnerId'in state?String(state.homeOwnerId||''):owner,changed=nextOwner!==owner;
    if(changed){owner=nextOwner;generation++;calendarRead++;boardBusy=false;clearTimeout(timer);list.replaceChildren();days=[];selected=today();month=selected.slice(0,7);boardStatus.textContent=owner?'개발요청을 확인합니다.':'로그인 후 개발요청을 확인할 수 있습니다.';}
    if('menuOpen'in state)visible=!!state.menuOpen;if('online'in state)online=!!state.online;
    for(const b of [write,all,retry])b.disabled=!owner||!online;if(changed||previousVisible!==visible||previousOnline!==online)paint();
    if(owner&&visible&&online&&(changed||!previousVisible||!previousOnline)){void loadBoard();void loadCalendar();}if(!visible||!online)clearTimeout(timer);
  }};
  document.addEventListener('visibilitychange',()=>{if(!document.hidden&&visible)void loadBoard();else clearTimeout(timer);});paint();
})();
