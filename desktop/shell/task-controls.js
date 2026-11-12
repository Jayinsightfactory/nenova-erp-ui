/* Shared, text-only schedule and shortcut inputs for home and notes. */
(() => {
  'use strict';
  function create(task={},menus=[]){
    const root=document.createElement('div');root.className='task-settings';
    const field=(text,type,value)=>{const label=document.createElement('label');label.textContent=text;const input=document.createElement('input');input.type=type;input.value=value||'';label.append(input);root.append(label);return input;};
    const start=field('시작 시간','time',task.startTime),end=field('종료 시간 (선택)','time',task.endTime);
    const kindLabel=document.createElement('label');kindLabel.textContent='바로가기';const kind=document.createElement('select');for(const [v,t] of [['none','연결 안 함'],['desktop','데스크톱 메뉴'],['web','웹 링크']])kind.add(new Option(t,v));kind.value=task.shortcut?.kind||'none';kindLabel.append(kind);root.append(kindLabel);
    const menuLabel=document.createElement('label');menuLabel.textContent='메뉴 선택';const menu=document.createElement('select');menu.add(new Option('메뉴를 선택하세요',''));for(const group of menus)for(const item of group.items||[]){if(!item.href?.includes('?')&&!item.href?.includes('#'))menu.add(new Option(group.group+' · '+item.labelKey,item.href));}if(task.shortcut?.kind==='desktop'&&!Array.from(menu.options).some(o=>o.value===task.shortcut.target)){menu.add(new Option('이전 연결 · 권한/메뉴를 다시 확인하세요',task.shortcut.target));}menu.value=task.shortcut?.kind==='desktop'?task.shortcut.target:'';menuLabel.append(menu);root.append(menuLabel);
    const url=field('웹 주소','url',task.shortcut?.kind==='web'?task.shortcut.target:'');url.placeholder='https://example.com';url.maxLength=2048;
    const label=field('버튼 이름','text',task.shortcut?.label);label.maxLength=24;
    start.name='startTime';end.name='endTime';kind.name='shortcutKind';menu.name='shortcutMenu';url.name='shortcutUrl';label.name='shortcutLabel';
    const hint=document.createElement('small');hint.textContent='한국 시간 · 시간을 비우면 미정 · 시간이 되어도 자동 실행하지 않습니다.';root.append(hint);
    const paint=()=>{menuLabel.hidden=kind.value!=='desktop';url.parentElement.hidden=kind.value!=='web';label.parentElement.hidden=kind.value==='none';};kind.onchange=paint;menu.onchange=()=>{if(menu.value)label.value=menu.selectedOptions[0].text.split(' · ').at(-1).slice(0,24);};paint();
    for(const control of root.querySelectorAll('input,select'))control.addEventListener('input',()=>control.setCustomValidity(''));
    function get(){return window.NenovaTaskSettings.normalize({startTime:start.value,endTime:end.value,shortcut:kind.value==='none'?null:{kind:kind.value,target:kind.value==='desktop'?menu.value:url.value,label:label.value.trim()||(kind.value==='web'?'웹 열기':'메뉴 열기')}});}
    function valid(){try{get();end.setCustomValidity('');return true;}catch(e){const target=end.value&&(!start.value||end.value<=start.value)?end:kind.value==='desktop'?menu:url;target.setCustomValidity(e.message);target.reportValidity();return false;}}
    return {root,get,valid,dirty(){return !!(start.value||end.value||kind.value!=='none');},setMenus(groups){const previous=menu.value;menu.replaceChildren(new Option('메뉴를 선택하세요',''));for(const group of groups)for(const item of group.items||[])if(!/[?#]/.test(item.href))menu.add(new Option(group.group+' · '+item.labelKey,item.href));if(previous&&!Array.from(menu.options).some(o=>o.value===previous))menu.add(new Option('이전 연결 · 메뉴를 확인하세요',previous));menu.value=previous;},reset(){start.value='';end.value='';kind.value='none';url.value='';menu.value='';label.value='';paint();},setStart(value){start.value=value;}};
  }
  window.NenovaTaskControls={create};
})();
