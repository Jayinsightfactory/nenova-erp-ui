export function weekdayStickyHeaderLayout({viewport,header,table,scrollTop=0}) {
  const top=Math.max(0,scrollTop);
  return header.top<top && table.bottom>top+header.height && viewport.width>0
    ? {left:viewport.left,top,width:viewport.width,height:header.height,tableWidth:table.width} : null;
}

// The original horizontal viewport remains the single source of scroll position.
export function observeWeekdayStickyHeader(viewport,{getOverlay,onLayout}) {
  const doc=viewport.ownerDocument,win=doc.defaultView;
  const table=viewport.querySelector('table'),header=table?.querySelector('thead');
  if(!table || !header) return ()=>{};
  let frame=null,last='';
  const scrollContainer=()=>{
    for(let node=viewport.parentElement;node && node!==doc.body;node=node.parentElement) {
      if(/auto|scroll/.test(win.getComputedStyle(node).overflowY) && node.scrollHeight>node.clientHeight) return node;
    }
    return null;
  };
  const measure=()=>{
    frame=null;
    const scroller=scrollContainer();
    const layout=weekdayStickyHeaderLayout({viewport:viewport.getBoundingClientRect(),header:header.getBoundingClientRect(),
      table:table.getBoundingClientRect(),scrollTop:scroller?.getBoundingClientRect().top || 0});
    const signature=JSON.stringify(layout);
    if(signature!==last) {last=signature;onLayout(layout);}
    const overlay=getOverlay();if(overlay)overlay.scrollLeft=viewport.scrollLeft;
  };
  const schedule=()=>{if(frame===null)frame=win.requestAnimationFrame(measure);};
  const observer=typeof win.ResizeObserver==='function'?new win.ResizeObserver(schedule):null;
  observer?.observe(table);observer?.observe(header);observer?.observe(viewport);
  doc.addEventListener('scroll',schedule,true);win.addEventListener('resize',schedule);
  doc.addEventListener('toggle',schedule,true);schedule();
  return ()=>{observer?.disconnect();doc.removeEventListener('scroll',schedule,true);win.removeEventListener('resize',schedule);
    doc.removeEventListener('toggle',schedule,true);if(frame!==null)win.cancelAnimationFrame(frame);};
}
