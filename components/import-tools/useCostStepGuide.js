import {useEffect,useRef} from 'react';
// Presentation only: never changes data, validation or save permissions.
export default function useCostStepGuide(revision,ready){
 const root=useRef(null),previous=useRef(null);
 useEffect(()=>{
  const panel=root.current;if(!panel)return;
  panel.querySelectorAll('[data-cost-next]').forEach(n=>n.removeAttribute('data-cost-next'));
  const visible=n=>!n.disabled&&n.getClientRects().length>0;
  const invalid=[...panel.querySelectorAll('[aria-invalid="true"]')].find(visible);
  const confirm=panel.querySelector('input[data-cost-confirm]');
  const next=invalid||(confirm&&!confirm.checked?confirm:panel.querySelector(ready?'[data-cost-download]':'[data-cost-preview]'));
  if(!next||!visible(next))return;
  next.setAttribute('data-cost-next','true');
  const move=()=>next.scrollIntoView({block:'center',behavior:'smooth'});
  if(previous.current&&previous.current!==next){
   if(panel.contains(document.activeElement)&&/INPUT|SELECT/.test(document.activeElement.tagName))panel.addEventListener('focusout',move,{once:true});else move();
  }
  previous.current=next;return()=>panel.removeEventListener('focusout',move);
 },[revision,ready]);
 return root;
}
