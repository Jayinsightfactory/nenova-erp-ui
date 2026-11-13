import {useEffect} from 'react';

export function useDistributionViewport(ref,contentKey){
 useEffect(()=>{
  const root=ref.current;if(!root)return;
  const measure=()=>{
   const height=`${Math.max(0,window.innerHeight-Math.max(0,root.getBoundingClientRect().top)-4)}px`;
   if(root.style.getPropertyValue('--distribution-available-height')!==height)root.style.setProperty('--distribution-available-height',height);
   root.querySelectorAll('[data-distribution-scroll]').forEach(scroller=>{
    const context=scroller.querySelector('[data-distribution-context]');
    const value=`${context?.offsetHeight||0}px`;
    if(scroller.style.getPropertyValue('--distribution-context-height')!==value)scroller.style.setProperty('--distribution-context-height',value);
   });
  };
  const ro=new ResizeObserver(measure);if(root.parentElement)ro.observe(root.parentElement);
  root.querySelectorAll('[data-distribution-context]').forEach(n=>ro.observe(n));
  window.addEventListener('resize',measure);measure();
  return()=>{ro.disconnect();window.removeEventListener('resize',measure);};
 },[ref,contentKey]);
}
