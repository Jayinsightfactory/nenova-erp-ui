import {useEffect,useRef,useState} from 'react';

// The table owns scrolling. This visible top scrollbar mirrors it in both directions.
export default function DistributionScrollBar({viewMode,selectionKey}){
 const bar=useRef(null),[width,setWidth]=useState(0);
 useEffect(()=>{
  const root=bar.current?.closest('[data-testid="distribution-workspace"]');
  const table=root?.querySelector(`[data-distribution-scroll="${viewMode}"]`);
  if(!root||!table||!bar.current){setWidth(0);return;}
  const node=bar.current,header=root.querySelector('[data-testid="distribution-sticky-header"]');
  const measure=()=>{setWidth(Math.max(0,table.scrollWidth-table.clientWidth)+node.clientWidth);root.style.setProperty('--distribution-header-height',`${header?.offsetHeight||80}px`);};
  const fromBar=()=>{table.scrollLeft=node.scrollLeft;},fromTable=()=>{if(Math.abs(node.scrollLeft-table.scrollLeft)>1)node.scrollLeft=table.scrollLeft;};
  node.addEventListener('scroll',fromBar);table.addEventListener('scroll',fromTable);
  const resize=new ResizeObserver(measure);resize.observe(table);if(header)resize.observe(header);const grid=table.querySelector('table');if(grid)resize.observe(grid);
  measure();fromTable();
  return()=>{resize.disconnect();node.removeEventListener('scroll',fromBar);table.removeEventListener('scroll',fromTable);};
 },[viewMode,selectionKey]);
 return <div data-testid="distribution-top-scroll" ref={bar} aria-label="분배표 좌우 이동" tabIndex={0} style={{height:20,minHeight:20,flexShrink:0,overflowX:'scroll',overflowY:'hidden',background:'var(--blue-bg)',border:'1px solid var(--border)'}}><div style={{width:Math.max(width,1),height:1}} /></div>;
}
