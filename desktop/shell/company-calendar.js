/* Authenticated shared calendar. Text-only DOM; personal tasks are never mutated. */
(() => {
  'use strict';
  window.NenovaCompanyCalendar={create(onChange){
    const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;};
    const button=(text,fn,cls='')=>{const b=el('button',cls,text);b.type='button';b.onclick=fn;return b;};
    let owner='',epoch=0,readId=0,snapshot=null,query={},editing=null,initial='',editRevision=0,pending=null,busy=false,trigger=null,reported=false;
    const dialog=el('dialog','company-dialog');dialog.setAttribute('aria-labelledby','companyDialogTitle');
    const heading=el('div','company-dialog-heading'),title=el('h2','','회사 공통 일정');title.id='companyDialogTitle';
    const close=button('×',tryClose);close.setAttribute('aria-label','공통 일정 창 닫기');heading.append(title,close);
    const help=el('p','company-help','모든 직원에게 표시됩니다. 등록자와 관리자만 수정·삭제할 수 있습니다.');
    const dayLabel=el('label','company-day-filter','목록 날짜'),day=el('input');day.type='date';day.setAttribute('aria-label','공통 일정 목록 날짜');dayLabel.append(day);
    const list=el('div','company-day-list');list.setAttribute('role','group');list.setAttribute('aria-label','선택일 회사 공통 일정');
    const newButton=button('＋ 새 공통 일정',()=>edit(null,day.value));
    const form=el('form','company-form'),fields={};
    function field(name,label,type,max){const wrap=el('label','',label),input=el(type==='textarea'?'textarea':'input');if(type!=='textarea')input.type=type;input.name=name;if(max)input.maxLength=max;wrap.append(input);form.append(wrap);fields[name]=input;return input;}
    field('title','일정 제목','text',120).required=true;field('date','일정 날짜','date').required=true;
    field('startTime','시작 시간 · 미입력은 시간 미정','time');field('endTime','종료 시간 · 선택','time');field('note','일정 메모','textarea',2000);
    const actions=el('div','company-dialog-actions'),save=el('button','workspace-primary','전체 직원에게 일정 저장');save.type='submit';
    const remove=button('이 공통 일정 삭제',()=>{confirmBox.hidden=false;confirmText.textContent='회사 전체에서 이 일정을 삭제할까요?';confirmYes.onclick=()=>void mutate('delete');confirmYes.focus();});actions.append(save,remove);form.append(actions);
    const status=el('p','company-dialog-status');status.setAttribute('role','status');
    const confirmBox=el('div','company-confirm'),confirmText=el('span'),confirmYes=button('확인',()=>{}),confirmNo=button('돌아가기',()=>{confirmBox.hidden=true;close.focus();});confirmBox.hidden=true;confirmBox.append(confirmText,confirmYes,confirmNo);
    dialog.append(heading,help,dayLabel,list,newButton,form,status,confirmBox);document.body.append(dialog);
    const fingerprint=()=>JSON.stringify(Object.values(fields).map(input=>input.value));
    const dirty=()=>!!pending||dialog.open&&fingerprint()!==initial;
    function report(){const value=dirty();if(value!==reported){reported=value;void window.desktop.invoke('homeDraft',{scope:'company',dirty:value}).catch(()=>{});}}
    function controls(){const readonly=!!editing&&!editing.canEdit;for(const input of Object.values(fields))input.disabled=busy||!!pending||readonly;save.disabled=busy||!snapshot;save.hidden=readonly;save.textContent=pending?'같은 요청으로 다시 저장':'전체 직원에게 일정 저장';remove.hidden=!editing||readonly;remove.disabled=busy||!!pending;newButton.disabled=busy||!!pending;day.disabled=busy||!!pending;confirmYes.disabled=busy;}
    function showList(){list.replaceChildren();const items=(snapshot?.events||[]).filter(item=>item.date===day.value);for(const event of items){const b=button((event.startTime||'시간 미정')+' · '+event.title,()=>edit(event));b.title=event.note||event.title;list.append(b);}if(!items.length)list.append(el('p','company-muted','선택한 날짜에 등록된 공통 일정이 없습니다.'));}
    function setSnapshot(data){snapshot=data;showList();controls();onChange?.();}
    async function load(next=query){query={...next};const ticket=++readId,generation=epoch,actor=owner;if(!actor)return;
      try{const result=await window.desktop.invoke('companyCalendar',{method:'GET',query});if(generation!==epoch||ticket!==readId||actor!==owner)return;if(!result?.success||result.ownerId!==owner)throw Error(result?.error||'공통 일정을 확인하지 못했습니다.');setSnapshot(result);}
      catch(e){if(generation===epoch&&ticket===readId){status.textContent=e.message;if(dialog.open)controls();onChange?.(e.message);}}
    }
    function edit(event,date=day.value){
      if(busy||pending)return;if(dialog.open&&dirty()){status.textContent='작성 중인 내용을 저장하거나 창을 닫은 뒤 다른 일정을 선택하세요.';return;}
      editing=event||null;editRevision=snapshot?.revision??0;confirmBox.hidden=true;status.textContent='';
      for(const [key,input]of Object.entries(fields))input.value=event?.[key]||(key==='date'?date:'');
      initial=fingerprint();controls();report();fields.title.focus();
    }
    function finishClose(){dialog.close();editing=null;pending=null;initial=fingerprint();confirmBox.hidden=true;report();trigger?.isConnected&&trigger.focus();}
    function tryClose(){if(busy||pending){status.textContent='저장 결과를 먼저 같은 요청으로 확인하세요.';return;}if(dirty()){confirmBox.hidden=false;confirmText.textContent='저장하지 않은 입력을 버리고 닫을까요?';confirmYes.onclick=finishClose;confirmNo.focus();return;}finishClose();}
    async function mutate(action){
      if(busy||!owner||!snapshot)return;
      if(!pending){const command={action,requestId:crypto.randomUUID(),expectedRevision:editRevision};if(editing)command.id=editing.id;if(action!=='delete')for(const [key,input]of Object.entries(fields))command[key]=input.value;pending={command,query:{...query,date:fields.date.value||day.value}};}
      const request=pending,generation=epoch,actor=owner;busy=true;++readId;status.textContent='회사 공통 일정을 저장하고 있습니다…';controls();report();
      try{const result=await window.desktop.invoke('companyCalendar',{method:'POST',...request});if(generation!==epoch||actor!==owner)return;
        if(!result?.success){if([400,403,404,409].includes(result?.status)){pending=null;await load({...query,date:day.value});editRevision=snapshot?.revision??editRevision;}throw Error(result?.error||'저장하지 못했습니다. 같은 요청으로 다시 시도하세요.');}
        if(result.ownerId!==owner)throw Error('계정이 변경되었습니다.');pending=null;setSnapshot(result);initial=fingerprint();busy=false;finishClose();
      }catch(e){if(generation===epoch){status.textContent=e.message;}}
      finally{if(generation===epoch){busy=false;controls();report();}}
    }
    form.onsubmit=event=>{event.preventDefault();if(!form.reportValidity())return;void mutate(editing?'update':'create');};form.addEventListener('input',report);form.addEventListener('change',report);
    day.onchange=()=>{if(dirty()){day.value=fields.date.value;status.textContent='작성 중인 내용을 저장하거나 닫은 뒤 날짜를 바꿔 주세요.';return;}showList();void load({...query,date:day.value});};
    dialog.addEventListener('cancel',event=>{event.preventDefault();tryClose();});
    dialog.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();tryClose();}});
    list.onkeydown=event=>{const rows=[...list.querySelectorAll('button')],at=rows.indexOf(document.activeElement),delta={ArrowUp:-1,ArrowDown:1}[event.key];if(at>=0&&delta!==undefined){event.preventDefault();rows[Math.max(0,Math.min(rows.length-1,at+delta))]?.focus();}};
    return {
      get events(){return snapshot?.events||[];},get truncated(){return !!snapshot?.truncated;},load,
      setOwner(value){if(owner===value)return;owner=value;epoch++;readId++;snapshot=null;pending=null;busy=false;editing=null;if(dialog.open)dialog.close();for(const input of Object.values(fields))input.value='';initial=fingerprint();list.replaceChildren();status.textContent='';report();onChange?.();},
      open(date,event=null){if(!owner)return;trigger=document.activeElement;day.value=date;edit(event,date);if(!dialog.open)dialog.showModal();showList();fields.title.focus();void load({...query,date});},
      openEvent(event){this.open(event.date,event);},
    };
  }};
})();
