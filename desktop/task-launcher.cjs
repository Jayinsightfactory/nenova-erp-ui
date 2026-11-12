'use strict';
const {normalize}=require('./shell/task-settings.js');
const {ORIGIN}=require('./policy.cjs');
async function launchTaskShortcut({payload,owner,isCurrent,menus,openMenu,confirmWeb,openWeb}) {
  if(!owner||!isCurrent())throw Error('로그인을 다시 확인하세요.');
  const {shortcut}=normalize({shortcut:payload?.shortcut});
  if(!shortcut)throw Error('업무의 바로가기를 먼저 연결하세요.');
  if(shortcut.kind==='desktop'){
    const item=menus.flatMap(g=>g.items||[]).find(i=>i.href===shortcut.target);
    if(!item)throw Error('이 계정에서 사용할 수 없는 메뉴입니다. 메뉴를 갱신하고 연결을 다시 선택하세요.');
    if(!isCurrent())throw Error('계정이 변경되었습니다. 다시 로그인하세요.');
    await openMenu({url:new URL(item.href,ORIGIN).href,title:item.labelKey,popup:item.popup});
  }else{
    if(!await confirmWeb(shortcut.target))return {opened:false};
    if(!isCurrent())throw Error('계정이 변경되었습니다. 다시 로그인하세요.');
    await openWeb(shortcut.target);
  }
  return {opened:true};
}
module.exports={launchTaskShortcut};
