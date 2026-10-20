import { useEffect, useRef } from 'react';
import { validateSelection } from '../../lib/ecountLookupWindow.cjs';

// A window session is bound to one menu, form mode and dialog instance.
export function createLookupWindowController(host, {getScope,onDaily,onError}) {
  let active=null;
  function dispose() {
    if(!active)return;
    const previous=active;active=null;
    host.removeEventListener('message',previous.receive);
    host.removeEventListener('pagehide',dispose);
    host.clearInterval(previous.timer);
    try {if(!previous.child.closed)previous.child.close();} catch {}
  }
  function open(dataset) {
    dispose();
    const scope=getScope();let nonce,child;
    try {
      nonce=host.crypto.randomUUID();
      const query=new URLSearchParams({dataset,nonce});
      child=host.open(`/ecount/lookup?${query}`,'_blank','popup,width=960,height=684');
    } catch {onError('조회창을 열지 못했습니다. 브라우저 설정을 확인해 주세요.');return;}
    if(!child){onError('새창이 차단되었습니다. 브라우저의 팝업 허용 설정을 확인해 주세요.');return;}
    const session={child,nonce,dataset,scope,timer:null,receive:null};
    session.receive=event=>{
      if(active!==session||getScope()!==scope)return;
      if(!validateSelection(event,{origin:host.location.origin,child,nonce,dataset,currentDataset:dataset,parentClosed:host.closed}))return;
      onDaily(dataset);dispose();
    };
    active=session;
    host.addEventListener('message',session.receive);
    host.addEventListener('pagehide',dispose);
    session.timer=host.setInterval(()=>{if(child.closed||getScope()!==scope)dispose();},400);
  }
  return {open,dispose};
}
export function useLookupWindow({scope,onDaily,onError}) {
  const current=useRef({scope,onDaily,onError});current.current={scope,onDaily,onError};
  const controller=useRef(null);
  useEffect(()=>()=>controller.current?.dispose(),[scope]);
  return dataset=>{
    if(!controller.current)controller.current=createLookupWindowController(window,{getScope:()=>current.current.scope,onDaily:value=>current.current.onDaily(value),onError:value=>current.current.onError(value)});
    controller.current.open(dataset);
  };
}
