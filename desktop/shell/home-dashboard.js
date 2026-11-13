/* Desktop-only home. Read-only projections; private tasks keep their existing owner fence. */
(() => {
  'use strict';
  const board=document.getElementById('requestBoard'),calendar=document.getElementById('workCalendar');
  if(!board||!calendar)return;
  const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;};
  const btn=(text,fn,cls='')=>{const n=el('button',cls,text);n.type='button';n.onclick=fn;return n;};
  const today=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul'}).format(new Date());
  let owner='',generation=0,visible=false,online=false,selected=today(),month=selected.slice(0,7),days=[],boardBusy=false,calendarRead=0,timer,weekAnchor=selected,weekData=null;
  let companyError='';const company=window.NenovaCompanyCalendar.create(message=>{companyError=message||'';if(window.homeDashboard)paint();});
  const open=(query)=>window.desktop.invoke('open',{url:'/pm?'+query,title:'개발요청 게시판'}).catch(e=>{boardStatus.textContent=e.message;});
  const head=el('div','workspace-card-heading'),title=el('h2','','개발요청 게시판'),actions=el('div','workspace-actions');
  const write=btn('＋ 요청 작성',()=>open('requests=new'),'workspace-primary'),all=btn('전체 보기 ↗',()=>open('requests=list'));
  actions.append(write,all);head.append(title,actions);
  const boardStatus=el('p','workspace-muted','로그인 후 개발요청을 확인할 수 있습니다.'),list=el('div','request-list');boardStatus.setAttribute('role','status');
  list.addEventListener('keydown',e=>{if(!['ArrowDown','ArrowUp','Home','End'].includes(e.key))return;const rows=[...list.querySelectorAll('.request-row')],at=rows.indexOf(document.activeElement);if(at<0)return;e.preventDefault();const index=e.key==='Home'?0:e.key==='End'?rows.length-1:Math.max(0,Math.min(rows.length-1,at+(e.key==='ArrowDown'?1:-1)));rows[index]?.focus();});
  const retry=btn('새로고침',()=>void loadBoard(),'workspace-refresh');board.append(head,boardStatus,list,retry);
  async function loadBoard(){
    if(!owner||!visible||!online||boardBusy||document.hidden)return;
    const ticket=generation,actor=owner;boardBusy=true;retry.disabled=true;
    try{const data=await window.desktop.invoke('homeRequests');if(ticket!==generation||actor!==owner)return;
      if(!data?.success||data.ownerId!==owner)throw Error('개발요청을 확인하지 못했습니다.');
      const focused=list.contains(document.activeElement)?document.activeElement.dataset.request:null;
      list.replaceChildren();for(const request of (data.requests||[]).slice(0,4)){
        const row=btn('',()=>open('requests=list&requestId='+encodeURIComponent(request.id)),'request-row');
        row.dataset.request=request.id;
        const badge=el('span','request-status',request.statusLabel);badge.dataset.status=request.status;
        row.append(badge,el('span','request-title',request.title),el('span','request-category',request.categoryLabel));list.append(row);
      }
      if(focused)list.querySelector('[data-request="'+focused+'"]')?.focus({preventScroll:true});
      boardStatus.textContent=data.requests?.length?'최근 요청 · 제목을 선택하면 상세 내용을 엽니다.':'등록된 개발요청이 없습니다. 새 요청을 작성해 보세요.';
    }catch(e){if(ticket===generation){list.replaceChildren();boardStatus.textContent=e.message||'게시판 조회 실패 · 다시 시도해 주세요.';}}
    finally{if(ticket===generation){boardBusy=false;retry.disabled=false;clearTimeout(timer);timer=setTimeout(()=>void loadBoard(),60000);}}
  }
  const shift=(date,n)=>{const d=new Date(date+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10);};
  const monday=date=>{const d=new Date(date+'T12:00:00Z');return shift(date,-(d.getUTCDay()+6)%7);};
  const valid=date=>date>='2000-01-01'&&date<='2100-12-31';
  const calHead=el('div','workspace-card-heading'),calTitle=el('h2'),calActions=el('div','workspace-actions');
  const prev=btn('‹',()=>browse(-1)),next=btn('›',()=>browse(1)),now=btn('오늘',()=>choose(today()));
  now.id='calendarToday';
  const companyAdd=btn('＋ 회사 공통 일정',()=>company.open(selected),'workspace-primary');companyAdd.id='companyCalendarButton';
  const monthToggle=btn('접기 ▴',()=>setMonthOpen(!monthOpen)),weekToggle=btn('접기 ▴',()=>setWeekOpen(!weekOpen));let monthOpen=true,weekOpen=true;
  const calTitleGroup=el('div','calendar-title-group');calTitleGroup.append(calTitle,companyAdd);calActions.append(prev,next,now,monthToggle);calHead.append(calTitleGroup,calActions);
  const monthView=el('div','calendar-month-view'),week=el('div','calendar-week');for(const name of ['일','월','화','수','목','금','토'])week.append(el('span','',name));
  const grid=el('div','calendar-grid');grid.setAttribute('role','group');grid.setAttribute('aria-label','날짜 선택 · 방향키 이동');monthView.append(week,grid);monthView.id='monthCalendarBody';monthToggle.setAttribute('aria-controls',monthView.id);
  const monthHint=el('p','calendar-month-hint','날짜를 선택하면 아래 주간 시간표와 오른쪽 업무가 함께 바뀝니다. 숫자는 완료 / 전체 업무입니다.');
  const weekScroll=el('div','week-scroll'),weekView=el('div','week-view');weekScroll.append(weekView);weekScroll.id='weekCalendarBody';weekToggle.setAttribute('aria-controls',weekScroll.id);
  const weeklyHeading=el('div','workspace-card-heading weekly-heading'),weekTitle=el('h3'),weekActions=el('div','workspace-actions');
  const weekPrev=btn('‹',()=>browseWeek(-1)),weekNext=btn('›',()=>browseWeek(1));weekPrev.setAttribute('aria-label','이전 주');weekNext.setAttribute('aria-label','다음 주');weekActions.append(weekPrev,weekNext,weekToggle);weeklyHeading.append(weekTitle,weekActions);
  const legend=el('p','calendar-week-hint','한국 시간 · 빈 시간 클릭으로 업무 추가 · 종료 미정은 1시간 칸으로 표시');
  const calStatus=el('p','calendar-status');calStatus.setAttribute('role','status');calendar.append(calHead,monthView,monthHint,weeklyHeading,legend,weekScroll,calStatus);
  function setMonthOpen(value){monthOpen=value;monthView.hidden=!value;monthHint.hidden=!value;monthToggle.textContent=value?'접기 ▴':'열기 ▾';monthToggle.setAttribute('aria-expanded',String(value));}
  function setWeekOpen(value){weekOpen=value;weekScroll.hidden=!value;legend.hidden=!value;weekToggle.textContent=value?'접기 ▴':'열기 ▾';weekToggle.setAttribute('aria-expanded',String(value));}
  function paint(){
    prev.setAttribute('aria-label','이전 달');next.setAttribute('aria-label','다음 달');
    prev.disabled=!owner||month==='2000-01';next.disabled=!owner||month==='2100-12';now.disabled=!owner;
    weekPrev.disabled=!owner||!valid(shift(weekAnchor,-7));weekNext.disabled=!owner||!valid(shift(weekAnchor,7));
    companyAdd.disabled=!owner||!online;setMonthOpen(monthOpen);setWeekOpen(weekOpen);paintMonth();paintWeek();
    calStatus.textContent=companyError?'회사 공통 일정: '+companyError:company.truncated?'회사 공통 일정이 많아 일부만 표시됩니다. 날짜를 선택해 공통 일정에서 확인하세요.':owner?'선택 '+selected+' · 일정 선택: 오른쪽 업무 확인 · 빈 시간 선택: 해당 시간에 추가':'로그인하면 개인 업무 일정을 확인할 수 있습니다.';
  }
  function paintMonth(){
    const [year,m]=month.split('-').map(Number),first=new Date(Date.UTC(year,m-1,1)).getUTCDay(),length=new Date(Date.UTC(year,m,0)).getUTCDate();
    const focused=grid.contains(document.activeElement)?document.activeElement.dataset.date:null;calTitle.textContent=year+'년 '+m+'월';grid.replaceChildren();
    for(let i=0;i<first;i++){const spacer=el('span','calendar-spacer');spacer.setAttribute('aria-hidden','true');grid.append(spacer);}
    for(let d=1;d<=length;d++){
      const date=month+'-'+String(d).padStart(2,'0'),data=days.find(x=>x.date===date),shared=company.events.filter(event=>event.date===date),b=btn('',()=>choose(date),'calendar-day');b.dataset.date=date;
      const top=el('span','calendar-date-top');top.append(el('span','calendar-date-number',String(d)));if(data?.total)top.append(el('small','',data.done+'/'+data.total));b.append(top);
      if(shared.length){const common=el('span','month-company','회사 공통 '+shared.length+'건 · '+shared[0].title);common.title=shared.map(event=>(event.startTime||'시간 미정')+' '+event.title).join('\n');b.append(common);}
      for(const task of data?.preview||[]){const item=el('span','month-task'+(task.done?' is-done':''),(task.startTime?task.startTime+' ':'')+task.title);item.title=task.title;b.append(item);}if(data?.total>(data?.preview?.length||0)&&data?.preview?.length)b.append(el('span','month-more','＋ '+(data.total-data.preview.length)+'건'));
      b.onclick=event=>{if(event.target.closest('.month-company'))company.open(date);else choose(date);};
      b.setAttribute('aria-label',date+(data?' · 개인 업무 '+data.total+'건, 완료 '+data.done+'건':'')+(shared.length?' · 회사 공통 '+shared.length+'건':''));b.setAttribute('aria-pressed',String(date===selected));
      if(date===today())b.setAttribute('aria-current','date');b.disabled=!owner;b.tabIndex=date===(selected.startsWith(month)?selected:month+'-01')?0:-1;
      b.onkeydown=e=>{const delta={ArrowLeft:-1,ArrowRight:1,ArrowUp:-7,ArrowDown:7}[e.key];if(delta===undefined)return;e.preventDefault();const target=shift(date,delta);if(target.slice(0,7)!==month)return;grid.querySelectorAll('button').forEach(n=>n.tabIndex=n.dataset.date===target?0:-1);grid.querySelector('[data-date="'+target+'"]')?.focus();};grid.append(b);
    }
    if(focused)grid.querySelector('[data-date="'+focused+'"]')?.focus({preventScroll:true});
  }
  const minutes=time=>Number(time.slice(0,2))*60+Number(time.slice(3));
  const timeLabel=value=>String(Math.floor(value/60)).padStart(2,'0')+':'+String(value%60).padStart(2,'0');
  function layoutEvents(tasks){
    const entries=tasks.map(task=>{const start=minutes(task.startTime),end=task.endTime?minutes(task.endTime):Math.min(1440,start+60);return {task,start,end:Math.max(start+30,end)};}).sort((a,b)=>a.start-b.start||a.end-b.end);
    let group=[],lanes=[],end=0;const flush=()=>{for(const item of group)item.columns=lanes.length;group=[];lanes=[];};
    for(const item of entries){if(group.length&&item.start>=end)flush();let lane=lanes.findIndex(v=>v<=item.start);if(lane<0)lane=lanes.length;lanes[lane]=item.end;item.lane=lane;group.push(item);end=Math.max(...group.map(v=>v.end));}flush();return entries;
  }
  function paintWeek(){
    const start=monday(weekAnchor),dates=Array.from({length:7},(_,i)=>shift(start,i)),data=dates.map(date=>{const own=weekData?.start===start?weekData.days.find(day=>day.date===date):null;return {date,tasks:[...(own?.tasks||[]),...company.events.filter(event=>event.date===date).map(event=>({...event,company:true}))],more:own?.more||0};});
    const focus=weekView.contains(document.activeElement)?document.activeElement.dataset.focus:null;
    weekTitle.textContent='주간 시간표 · '+start.slice(0,4)+'년 '+Number(start.slice(5,7))+'월 '+Number(start.slice(8))+'일 – '+Number(dates[6].slice(5,7))+'월 '+Number(dates[6].slice(8))+'일';weekView.replaceChildren();
    const header=el('div','week-header');header.append(el('span','week-zone','KST'));
    for(const [i,date] of dates.entries()){
      const b=btn('',()=>choose(date),'week-day');b.dataset.date=date;b.dataset.focus='day-'+date;b.disabled=!owner||!valid(date);b.setAttribute('aria-pressed',String(date===selected));if(date===today())b.setAttribute('aria-current','date');
      b.append(el('strong','',Number(date.slice(8))),el('span','',['월','화','수','목','금','토','일'][i]));b.setAttribute('aria-label',date+' 업무 확인');
      b.onkeydown=e=>{const delta={ArrowLeft:-1,ArrowRight:1}[e.key];if(delta===undefined)return;e.preventDefault();weekView.querySelector('[data-focus="day-'+shift(date,delta)+'"]')?.focus();};header.append(b);
    }
    const allDay=el('div','week-allday');allDay.append(el('span','week-zone','시간 미정'));
    for(const date of dates){const col=el('div','week-allday-items');const unscheduled=data.find(d=>d.date===date)?.tasks.filter(t=>!t.startTime)||[];for(const task of unscheduled.slice(0,3)){const b=btn(task.title,()=>task.company?company.openEvent(task):choose(date),'week-unscheduled'+(task.company?' is-company':'')+(task.done?' is-done':''));if(task.company)b.textContent='회사 공통 · '+task.title;b.title=task.title;b.dataset.focus=task.id+date;col.append(b);}if(unscheduled.length>3)col.append(btn('＋ '+(unscheduled.length-3)+'건',()=>unscheduled.slice(3).some(task=>task.company)?company.open(date):choose(date),'week-unscheduled'));allDay.append(col);}
    const timed=data.flatMap(d=>d.tasks.filter(t=>t.startTime));const earliest=Math.min(8*60,...timed.map(t=>Math.floor(minutes(t.startTime)/60)*60)),latest=Math.min(1440,Math.max(19*60,...timed.map(t=>Math.ceil((t.endTime?minutes(t.endTime):minutes(t.startTime)+60)/60)*60)));
    const height=(latest-earliest)*.8,body=el('div','week-body'),axis=el('div','week-axis');body.style.height=(height+24)+'px';
    for(let value=earliest;value<=latest;value+=60){const label=el('span','',timeLabel(value));label.style.top=(value-earliest)*.8+'px';axis.append(label);}body.append(axis);
    for(const date of dates){
      const col=el('div','week-column');if(date===today())col.classList.add('is-today');
      for(let value=earliest;value<latest;value+=60){const add=btn('',()=>window.homeWorkspace?.beginAt(date,timeLabel(value)),'week-slot');add.style.top=(value-earliest)*.8+'px';add.style.height='48px';add.dataset.focus='slot-'+date+'-'+value;add.setAttribute('aria-label',date+' '+timeLabel(value)+' 업무 추가');add.disabled=!owner||!valid(date);add.tabIndex=value===earliest?0:-1;
        add.onkeydown=e=>{const delta={ArrowUp:-60,ArrowDown:60}[e.key];if(delta===undefined)return;e.preventDefault();const target=col.querySelector('[data-focus="slot-'+date+'-'+(value+delta)+'"]');if(target){add.tabIndex=-1;target.tabIndex=0;target.focus();}};col.append(add);}
      for(const item of layoutEvents(data.find(d=>d.date===date)?.tasks.filter(t=>t.startTime)||[])){
        const {task}=item,b=btn('',()=>task.company?company.openEvent(task):choose(date),'week-event'+(task.company?' is-company':'')+(task.done?' is-done':''));b.dataset.focus=task.id+date;b.dataset.taskId=task.id;
        const color=[...task.id].reduce((sum,c)=>sum+c.charCodeAt(0),0)%5;b.dataset.color=String(color);
        b.style.top=(item.start-earliest)*.8+'px';b.style.height=Math.max(22,(Math.min(item.end,latest)-item.start)*.8-3)+'px';b.style.left='calc('+item.lane/item.columns*100+'% + 3px)';b.style.width='calc('+100/item.columns+'% - 6px)';
        b.append(el('strong','',(task.company?'회사 공통 · ':'')+task.title),el('small','',task.startTime+(task.endTime?' – '+task.endTime:' · 종료 미정')));b.title=date+' '+task.startTime+(task.endTime?'–'+task.endTime:' (종료 미정 · 기본 표시 1시간)')+' '+task.title+(task.done?' · 완료':'');b.setAttribute('aria-label',b.title+(task.company?' · 공통 일정 보기':' · 오른쪽 업무에서 확인'));col.append(b);
      }
      const more=data.find(d=>d.date===date)?.more;if(more){const b=btn('추가 '+more+'건 · 일별 보기',()=>choose(date),'week-more');col.append(b);}body.append(col);
    }
    weekView.append(header,allDay,body);if(focus)weekView.querySelector('[data-focus="'+CSS.escape(focus)+'"]')?.focus({preventScroll:true});
  }
  function choose(date){if(!owner||!valid(date))return;if(window.homeWorkspace?.selectDate(date,date===today())){selected=date;weekAnchor=date;if(month!==date.slice(0,7)){month=date.slice(0,7);days=[];}paint();}}
  async function loadCalendar(){
    if(!owner||!online)return;void company.load({month,week:weekAnchor,date:selected});const ticket=++calendarRead,actor=owner,requested=month,requestedWeek=weekAnchor;calStatus.textContent='업무 일정을 확인하고 있습니다…';
    try{const result=await window.desktop.invoke('homeWorkspace',{method:'GET',date:selected,calendarMonth:requested,calendarWeek:requestedWeek,limit:1});
      if(ticket!==calendarRead||actor!==owner||requested!==month||requestedWeek!==weekAnchor)return;if(!result?.success||result.ownerId!==owner||result.calendar?.month!==month||!result.calendarWeek)throw Error(result?.error||'달력을 확인하지 못했습니다.');days=result.calendar.days;weekData=result.calendarWeek;paint();
    }catch(e){if(ticket===calendarRead&&actor===owner)calStatus.textContent=(e.message||'달력 조회 실패')+' · 기간 이동으로 다시 시도할 수 있습니다.';}
  }
  function animatePaint(){if(document.startViewTransition&&!matchMedia('(prefers-reduced-motion: reduce)').matches)document.startViewTransition(paint).finished.catch(()=>{});else paint();}
  function browse(delta){const at=new Date(month+'-01T12:00:00Z');at.setUTCMonth(at.getUTCMonth()+delta);const value=at.toISOString().slice(0,7);if(value<'2000-01'||value>'2100-12')return;month=value;days=[];animatePaint();void loadCalendar();}
  function browseWeek(delta){const value=shift(weekAnchor,delta*7);if(!valid(value))return;weekAnchor=value;animatePaint();void loadCalendar();}
  window.addEventListener('home-workspace-data',e=>{
    if(e.detail.owner!==owner)return;const changed=selected!==e.detail.date;selected=e.detail.date;if(changed){month=selected.slice(0,7);weekAnchor=selected;days=[];}
    if(e.detail.calendar?.month===month)days=e.detail.calendar.days;if(e.detail.calendarWeek?.start===monday(weekAnchor))weekData=e.detail.calendarWeek;
    if(changed||e.detail.calendar||e.detail.calendarWeek){paint();if(owner&&visible&&online)void company.load({month,week:weekAnchor,date:selected});}
  });
  window.homeDashboard={applyState(state){const previousVisible=visible,previousOnline=online,nextOwner='homeOwnerId'in state?String(state.homeOwnerId||''):owner,changed=nextOwner!==owner;
    if(changed){owner=nextOwner;company.setOwner(owner);companyError='';generation++;calendarRead++;boardBusy=false;clearTimeout(timer);list.replaceChildren();days=[];selected=today();weekAnchor=selected;weekData=null;month=selected.slice(0,7);boardStatus.textContent=owner?'개발요청을 확인합니다.':'로그인 후 개발요청을 확인할 수 있습니다.';}
    if('menuOpen'in state)visible=!!state.menuOpen;if('online'in state)online=!!state.online;
    for(const b of [write,all,retry,webRequest].filter(Boolean))b.disabled=!owner||!online;if(changed||previousVisible!==visible||previousOnline!==online)paint();
    if(visible&&(changed||!previousVisible)){setMonthOpen(true);setWeekOpen(true);}
    if(owner&&visible&&online&&(changed||!previousVisible||!previousOnline)){void loadBoard();void loadCalendar();}if(!visible||!online)clearTimeout(timer);
  }};
  const webRequest=document.getElementById('webRequestButton');webRequest?.addEventListener('click',()=>open('requests=new'));
  document.addEventListener('visibilitychange',()=>{if(!document.hidden&&visible)void loadBoard();else clearTimeout(timer);});paint();
})();
