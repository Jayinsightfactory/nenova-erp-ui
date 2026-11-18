/* Authenticated shared calendar. Text-only DOM; personal tasks are never mutated. */
(() => {
  'use strict';
  const palette = [['#267b4c','초록'],['#2563eb','파랑'],['#7c3aed','보라'],['#b45309','주황'],['#be365c','분홍'],['#475569','회색']];
  const colorOf = value => /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : palette[0][0];
  function applyColor(node, value) {
    node.style.setProperty('--company-color', colorOf(value));
  }
  window.NenovaCompanyCalendar={applyColor,create(onChange){
    const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;};
    const button=(text,fn,cls='')=>{const b=el('button',cls,text);b.type='button';b.onclick=fn;return b;};
    let owner='',epoch=0,readId=0,snapshot=null,query={},editing=null,initial='',editRevision=0,pending=null,busy=false,trigger=null,reported=false,listDate='';
    const dialog=el('dialog','company-dialog');dialog.setAttribute('aria-labelledby','companyDialogTitle');
    const heading=el('div','company-dialog-heading'),title=el('h2','','회사 공통 일정');title.id='companyDialogTitle';
    const close=button('×',tryClose);close.setAttribute('aria-label','공통 일정 창 닫기');heading.append(title,close);
    const help=el('p','company-help','모든 직원에게 표시됩니다. 등록자와 관리자만 수정·삭제할 수 있습니다.'),dateNote=el('p','company-date-summary');
    const dayLabel=el('label','company-day-filter','목록 날짜'),day=el('input');day.type='date';day.setAttribute('aria-label','공통 일정 목록 날짜');dayLabel.append(day);
    const list=el('div','company-day-list');list.setAttribute('role','group');list.setAttribute('aria-label','선택일 회사 공통 일정');
    const newActions=el('div','company-new-actions'),newButton=button('＋ 새 공통 일정',()=>startNew(false)),weeklyButton=button('＋ 주차별 일정',()=>startNew(true));weeklyButton.id='newWeeklySchedule';
    newActions.append(newButton,weeklyButton);
    const form=el('form','company-form'),fields={},detailFields={};form.id='companyEventForm';
    function field(name,label,type,max){const wrap=el('label','',label),input=el(type==='textarea'?'textarea':'input');if(type!=='textarea')input.type=type;input.name=name;if(max)input.maxLength=max;wrap.append(input);form.append(wrap);fields[name]=input;return input;}
    field('title','일정 제목','text',120).required=true;field('date','일정 날짜','date').required=true;
    field('startTime','시작 시간 · 미입력은 시간 미정','time');field('endTime','종료 시간 · 선택','time');field('note','일정 메모','textarea',2000);
    function selectField(name,label,options,target=fields){const wrap=el('label','',label),input=el('select');input.name=name;for(const [value,text] of options)input.add(new Option(text,value));wrap.append(input);form.insertBefore(wrap,fields.note.parentElement);target[name]=input;return input;}
    const visibility=selectField('visibility','공개 범위',[['company','회사 공통 · 모든 직원'],['private','나만 보기 · 내 일정']]);
    for(const [name,label,max] of [['location','장소',200],['attendees','참석자 · 참고용, 초대 발송 없음',500]]){const wrap=el('label','',label),input=el('input');input.name=name;input.maxLength=max;wrap.append(input);form.insertBefore(wrap,fields.note.parentElement);detailFields[name]=input;}
    selectField('availability','일정 상태',[['busy','일정 있음'],['free','일정 없음']],detailFields);
    selectField('reminderMinutes','홈 알림',[['','알림 없음'],['0','시작할 때'],['10','10분 전'],['30','30분 전'],['60','1시간 전'],['1440','하루 전']],detailFields);
    const reminderHelp=el('small','company-reminder-help','한국 시간 기준 · 조회 중인 일정에 한해 앱 홈을 열어 둔 동안 알림을 표시합니다.');form.append(reminderHelp);
    function detailsValue(){return window.NenovaTaskSettings.normalizeDetails({location:detailFields.location.value,attendees:detailFields.attendees.value,availability:detailFields.availability.value,reminderMinutes:detailFields.reminderMinutes.value===''?null:Number(detailFields.reminderMinutes.value)});}
    visibility.onchange=()=>{help.textContent=visibility.value==='private'?'나만 볼 수 있는 달력 일정입니다. 회사 공통 일정에는 공개되지 않습니다.':'모든 직원에게 표시됩니다. 등록자와 관리자만 수정·삭제할 수 있습니다.';controls();};
    let weeklyMode=false,resetTouched=false,previousWeeklyStart='';
    const weeklyBox=el('fieldset','company-weekly-fields');weeklyBox.hidden=true;weeklyBox.append(el('legend','','주차별 일정'));
    const weeklyHint=el('p','company-weekly-hint');
    const weeklyDates=el('div','company-weekly-dates');
    function weeklyDate(name,text){const label=el('label','',text),n=el('input');n.name=name;n.type='date';label.append(n);weeklyDates.append(label);return n;}
    const rangeEnd=weeklyDate('weeklyEndDate','첫 주 마지막 날짜'),deadline=weeklyDate('weeklyDeadline','반복 마감일');
    const resetDate=weeklyDate('weeklyResetDate','새 1차 시작 기준일 (선택)');
    const resetHelp=el('small','company-reset-help','기준일 이후 처음 시작하는 주간 일정이 1차가 됩니다. 비워 두면 이전 차수를 이어갑니다.');
    resetDate.parentElement.append(resetHelp);for(const evt of ['input','change'])resetDate.addEventListener(evt,()=>{resetTouched=true;});
    const inclusiveLabel=el('label','company-weekly-inclusive'),inclusive=el('input');inclusive.type='checkbox';inclusive.name='weeklyInclusive';inclusiveLabel.append(inclusive,document.createTextNode('마감일 당일도 표시'));
    const preview=el('div','company-weekly-preview');preview.setAttribute('aria-live','polite');
    weeklyBox.append(weeklyHint,weeklyDates,inclusiveLabel,preview);const weeklyOptions=el('details','company-weekly-options');weeklyOptions.open=true;weeklyOptions.append(el('summary','','주차별 일정 설정 · 마감일 · 새 1차 기준일'),weeklyBox);form.insertBefore(weeklyOptions,fields.startTime.parentElement);
    const dayMs=86400000,dayNum=v=>/^\d{4}-\d{2}-\d{2}$/.test(v)?Date.parse(v+'T00:00:00Z')/dayMs:NaN,iso=n=>new Date(n*dayMs).toISOString().slice(0,10);
    function weeklyPreview(){
      if(!weeklyMode)return '';
      const start=dayNum(fields.date.value),end=dayNum(rangeEnd.value),stop=dayNum(deadline.value)-(inclusive.checked?0:1);
      rangeEnd.min=fields.date.value;rangeEnd.max=Number.isFinite(start)?iso(start+6):'';deadline.min=fields.date.value;
      resetDate.min=Number.isFinite(start)?iso(start+1):'';resetDate.max=Number.isFinite(stop)?iso(stop):'';
      if(!resetTouched){
        const january=Number.isFinite(start)?Date.UTC(Number(fields.date.value.slice(0,4))+1,0,1)/dayMs:NaN;
        const suggested=start+7*Math.ceil((january-start)/7);
        resetDate.value=Number.isFinite(suggested)&&suggested<=stop?iso(suggested):'';
      }
      const reset=dayNum(resetDate.value),resetWeek=Number.isFinite(reset)?Math.ceil((reset-start)/7):Infinity;
      const template=fields.title.value.trim(),number=[...template.matchAll(/([0-9]+)차/g)];
      let error='';
      if(!Number.isFinite(start)||!Number.isFinite(end)||!Number.isFinite(stop))error='첫 주 날짜 범위와 반복 마감일을 선택하세요.';
      else if(end<start||end-start>6)error='첫 주 범위는 시작일부터 최대 7일입니다.';
      else if(stop<start)error='첫 일정이 마감 전에 표시되도록 마감일을 선택하세요.';
      else if(resetDate.value&&(reset<=start||start+resetWeek*7>stop))error='새 1차가 표시될 주가 첫 주 이후, 마감 범위 안에 있어야 합니다.';
      else if(number.length!==1||Number(number[0][1])<1||!Number.isSafeInteger(Number(number[0][1])))error='제목에 시작 차수를 한 번 입력하세요. 예: 네덜란드 1차 주문등록';
      const last=Math.floor((stop-start)/7);
      const valueAt=index=>index>=resetWeek?1+index-resetWeek:Number(number[0][1])+index;
      const numberAt=index=>String(valueAt(index)).padStart(number[0][1].startsWith('0')?number[0][1].length:1,'0')+'차';
      if(!error&&[Math.min(last,resetWeek-1),last].some(index=>!Number.isSafeInteger(valueAt(index))||template.replace(/[0-9]+차/,numberAt(index)).length>120))error='표시할 차수 또는 제목 길이가 입력 범위를 넘습니다.';
      preview.replaceChildren();if(error){preview.textContent=error;return error;}
      preview.append(el('strong','','미리보기 · '+(last+1)+'주 · 마감일 '+(inclusive.checked?'포함':'제외')));
      const examples=[...new Set([0,1,resetWeek-1,resetWeek,resetWeek+1,last])].filter(n=>Number.isFinite(n)&&n>=0&&n<=last).sort((a,b)=>a-b);
      let previous=-1;for(const index of examples){
        const a=start+index*7,b=Math.min(a+end-start,stop),text=template.replace(/[0-9]+차/,numberAt(index));
        if(index>previous+1)preview.append(el('span','company-weekly-skip','⋯'));previous=index;
        const row=el('div','company-weekly-example');row.append(el('time','',iso(a)+(a===b?'':' ~ '+iso(b))),el('span','',text));preview.append(row);
      }
      return '';
    }
    function paintMode(){
      weeklyOptions.hidden=weeklyBox.hidden=!weeklyMode;rangeEnd.required=deadline.required=weeklyMode;
      fields.date.parentElement.firstChild.nodeValue=weeklyMode?'첫 주 시작 날짜':'일정 날짜';
      weeklyButton.setAttribute('aria-pressed',String(weeklyMode));newButton.setAttribute('aria-pressed',String(!weeklyMode));
      weeklyHint.textContent=editing?.weekly?'제목과 날짜는 첫 주 기준입니다. 변경하면 이 주차별 일정 전체에 반영됩니다.':'제목에 ‘1차’처럼 시작 차수를 넣으세요. 다음 해까지 반복하면 새 1차 기준일로 다음 해 첫 해당 요일을 제안합니다. 직접 바꾸거나 지울 수 있습니다.';
      weeklyPreview();
    }
    function startNew(wantWeekly){
      if(pending||busy)return;
      if(editing){if(dirty()){status.textContent='편집 중인 일정을 먼저 저장하거나 닫아 주세요.';return;}edit(null,day.value);}
      weeklyMode=wantWeekly;if(wantWeekly&&!rangeEnd.value)rangeEnd.value=fields.date.value;previousWeeklyStart=fields.date.value;
      paintMode();controls();report();fields.title.focus();
    }
    const colors=el('fieldset','company-colors'),choices=el('div','company-color-choices');
    colors.append(el('legend','','일정 색상'),choices);form.insertBefore(colors,fields.note.parentElement);
    const customLabel=el('label','company-color-custom','직접 선택'),colorInput=el('input');
    colorInput.type='color';colorInput.name='color';colorInput.setAttribute('aria-label','일정 색상 직접 선택');fields.color=colorInput;
    for(const [value,name] of palette){
      const swatch=button(name,()=>{colorInput.value=value;syncColor();report();},'company-swatch');
      swatch.dataset.value=value;applyColor(swatch,value);choices.append(swatch);
    }
    customLabel.append(colorInput);choices.append(customLabel);
    function syncColor(){
      for(const swatch of choices.querySelectorAll('.company-swatch'))swatch.setAttribute('aria-pressed',String(swatch.dataset.value===colorInput.value));
    }
    colorInput.addEventListener('input',syncColor);
    const actions=el('div','company-dialog-actions'),save=el('button','workspace-primary','전체 직원에게 일정 저장');save.type='submit';save.id='companyCalendarSave';save.setAttribute('form',form.id);const headerActions=el('div','company-header-actions');headerActions.append(save,close);heading.append(headerActions);
    const remove=button('이 공통 일정 삭제',()=>{confirmBox.hidden=false;confirmText.textContent=editing?.weekly?'이 주차별 일정 전체를 삭제할까요?':visibility.value==='private'?'내 달력에서 이 일정을 삭제할까요?':'회사 전체에서 이 일정을 삭제할까요?';confirmYes.onclick=()=>void mutate('delete');confirmYes.focus();});actions.append(remove);form.append(actions);
    const status=el('p','company-dialog-status');status.setAttribute('role','status');
    const confirmBox=el('div','company-confirm'),confirmText=el('span'),confirmYes=button('확인',()=>{}),confirmNo=button('돌아가기',()=>{confirmBox.hidden=true;close.focus();});confirmBox.hidden=true;confirmBox.append(confirmText,confirmYes,confirmNo);
    dialog.append(heading,help,dateNote,dayLabel,list,newActions,form,status,confirmBox);document.body.append(dialog);
    const fingerprint=()=>JSON.stringify([Object.values(fields).map(input=>input.value),Object.values(detailFields).map(input=>input.value),weeklyMode?[rangeEnd.value,deadline.value,inclusive.checked,resetDate.value]:null]);
    const dirty=()=>!!pending||dialog.open&&fingerprint()!==initial;
    function report(){const value=dirty();if(value!==reported){reported=value;void window.desktop.invoke('homeDraft',{scope:'company',dirty:value}).catch(()=>{});}}
    function controls(){const readonly=!!editing&&!editing.canEdit;for(const input of [...Object.values(fields),...Object.values(detailFields)])input.disabled=busy||!!pending||readonly;colors.disabled=busy||!!pending||readonly;weeklyBox.disabled=!weeklyMode||busy||!!pending||readonly;save.disabled=busy||!snapshot;save.hidden=readonly;save.textContent=pending?'다시 확인':weeklyMode?'전체 저장':'저장';save.setAttribute('aria-label',weeklyMode?'주차별 일정 전체 저장':'일정 저장');remove.textContent=editing?.weekly?'주차별 일정 전체 삭제':'이 일정 삭제';remove.hidden=!editing||readonly;remove.disabled=busy||!!pending;weeklyButton.disabled=newButton.disabled=busy||!!pending;day.disabled=busy||!!pending;confirmYes.disabled=busy;}
    function showList(){list.replaceChildren();const items=(snapshot?.events||[]).filter(item=>item.date===day.value);for(const event of items){const b=button((event.startTime||'시간 미정')+' · '+event.title,()=>edit(event));b.title=event.note||event.title;applyColor(b,event.color);list.append(b);}if(!items.length)list.append(el('p','company-muted','선택한 날짜에 등록된 공통 일정이 없습니다.'));}
    function setSnapshot(data){snapshot=data;showList();controls();onChange?.();}
    async function load(next=query){query={...next};const ticket=++readId,generation=epoch,actor=owner;if(!actor)return;
      try{const result=await window.desktop.invoke('companyCalendar',{method:'GET',query});if(generation!==epoch||ticket!==readId||actor!==owner)return;if(!result?.success||result.ownerId!==owner)throw Error(result?.error||'공통 일정을 확인하지 못했습니다.');setSnapshot(result);}
      catch(e){if(generation===epoch&&ticket===readId){status.textContent=e.message;if(dialog.open)controls();onChange?.(e.message);}}
    }
    function edit(event,date=day.value){
      if(busy||pending)return;if(dialog.open&&dirty()){status.textContent='작성 중인 내용을 저장하거나 창을 닫은 뒤 다른 일정을 선택하세요.';return;}
      editing=event||null;editRevision=snapshot?.revision??0;confirmBox.hidden=true;status.textContent='';
      dateNote.textContent='선택일 · '+new Intl.DateTimeFormat('ko-KR',{dateStyle:'full',timeZone:'Asia/Seoul'}).format(new Date(date+'T12:00:00+09:00'));weeklyOptions.open=!event?.weekly;
      for(const [key,input]of Object.entries(fields))input.value=key==='color'?colorOf(event?.color):event?.[key]||(key==='date'?date:key==='visibility'?'company':'');
      for(const [key,input]of Object.entries(detailFields))input.value=event?.details?.[key]??(key==='availability'?'busy':'');visibility.onchange();title.textContent=event?'일정 상세 · 수정':'새 일정';
      weeklyMode=!!event?.weekly;rangeEnd.value=event?.weekly?.endDate||'';deadline.value=event?.weekly?.deadline||'';inclusive.checked=!!event?.weekly?.inclusive;
      if(weeklyMode){fields.title.value=event.weekly.title;fields.date.value=event.weekly.startDate;}
      resetDate.value=event?.weekly?.resetDate||'';resetTouched=weeklyMode;previousWeeklyStart=fields.date.value;
      syncColor();paintMode();
      initial=fingerprint();controls();report();fields.title.focus();
    }
    function finishClose(){dialog.close();editing=null;pending=null;initial=fingerprint();confirmBox.hidden=true;report();const target=trigger?.isConnected?trigger:trigger?.dataset.focus?document.querySelector('[data-focus="'+CSS.escape(trigger.dataset.focus)+'"]'):null;(target||document.getElementById('companyCalendarButton'))?.focus({preventScroll:true});}
    function tryClose(){if(busy||pending){status.textContent='저장 결과를 먼저 같은 요청으로 확인하세요.';return;}if(dirty()){confirmBox.hidden=false;confirmText.textContent='저장하지 않은 입력을 버리고 닫을까요?';confirmYes.onclick=finishClose;confirmNo.focus();return;}finishClose();}
    async function mutate(action){
      if(busy||!owner||!snapshot)return;
      if(!pending){const command={action,requestId:crypto.randomUUID(),expectedRevision:editRevision};if(editing)command.id=editing.id;if(editing?.weekly)command.recurringEdit=true;if(action!=='delete'){for(const [key,input]of Object.entries(fields))command[key]=input.value;command.details=detailsValue();if(command.details.reminderMinutes!==null&&!command.startTime){status.textContent='홈 알림을 사용하려면 시작 시간을 입력하세요.';return;}if(weeklyMode)command.weekly={endDate:rangeEnd.value,deadline:deadline.value,inclusive:inclusive.checked,...(resetDate.value?{resetDate:resetDate.value}:{})};}pending={command,query:{...query,date:weeklyMode?day.value:fields.date.value||day.value}};}
      const request=pending,generation=epoch,actor=owner;busy=true;++readId;status.textContent='회사 공통 일정을 저장하고 있습니다…';controls();report();
      try{const result=await window.desktop.invoke('companyCalendar',{method:'POST',...request});if(generation!==epoch||actor!==owner)return;
        if(!result?.success){if([400,403,404,409].includes(result?.status)){pending=null;await load({...query,date:day.value});editRevision=snapshot?.revision??editRevision;}throw Error(result?.error||'저장하지 못했습니다. 같은 요청으로 다시 시도하세요.');}
        if(result.ownerId!==owner)throw Error('계정이 변경되었습니다.');pending=null;setSnapshot(result);initial=fingerprint();busy=false;finishClose();
      }catch(e){if(generation===epoch){status.textContent=e.message;}}
      finally{if(generation===epoch){busy=false;controls();report();}}
    }
    fields.date.addEventListener('input',()=>{if(!weeklyMode||!Number.isFinite(dayNum(fields.date.value)))return;const span=dayNum(rangeEnd.value)-dayNum(previousWeeklyStart);if(!rangeEnd.value||span>=0&&span<=6)rangeEnd.value=iso(dayNum(fields.date.value)+(Number.isFinite(span)?span:0));previousWeeklyStart=fields.date.value;});
    form.onsubmit=event=>{event.preventDefault();if(!form.reportValidity())return;const issue=weeklyPreview();if(issue){status.textContent=issue;return;}void mutate(editing?'update':'create');};form.addEventListener('input',()=>{weeklyPreview();report();});form.addEventListener('change',()=>{weeklyPreview();report();});
    day.onchange=()=>{if(dirty()){day.value=listDate;status.textContent='작성 중인 내용을 저장하거나 닫은 뒤 날짜를 바꿔 주세요.';return;}listDate=day.value;edit(null,listDate);showList();void load({...query,date:day.value});};
    dialog.addEventListener('cancel',event=>{event.preventDefault();tryClose();});
    dialog.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();tryClose();}});
    list.onkeydown=event=>{const rows=[...list.querySelectorAll('button')],at=rows.indexOf(document.activeElement),delta={ArrowUp:-1,ArrowDown:1}[event.key];if(at>=0&&delta!==undefined){event.preventDefault();rows[Math.max(0,Math.min(rows.length-1,at+delta))]?.focus();}};
    return {
      get events(){return snapshot?.events||[];},get holidays(){return snapshot?.holidays||null;},get latestAdditionRevision(){return snapshot?.latestAdditionRevision??null;},get truncated(){return !!snapshot?.truncated;},load,
      setOwner(value){if(owner===value)return;owner=value;epoch++;readId++;snapshot=null;pending=null;busy=false;editing=null;if(dialog.open)dialog.close();for(const [key,input]of Object.entries(fields))input.value=key==='color'?colorOf(null):'';for(const input of Object.values(detailFields))input.value='';syncColor();initial=fingerprint();list.replaceChildren();status.textContent='';report();onChange?.();},
      open(date,event=null){if(!owner)return;trigger=document.activeElement;day.value=date;listDate=date;edit(event,date);if(!dialog.open)dialog.showModal();showList();fields.title.focus();void load({...query,date});},
      openEvent(event){this.open(event.date,event);},
    };
  }};
})();
