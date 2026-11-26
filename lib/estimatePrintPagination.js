// Shared whole-row pagination for the browser print document and Excel pages.
export function paginateEstimateRows({heights,firstCapacity,nextCapacity,footerHeight=0}) {
 if(!Array.isArray(heights)||![firstCapacity,nextCapacity,footerHeight].every(Number.isFinite)||firstCapacity<=0||nextCapacity<=0||footerHeight<0)throw new Error('인쇄 페이지 크기를 확인할 수 없습니다.');
 const pages=[];let page=[],used=0,capacity=firstCapacity;
 heights.forEach((height,index)=>{
  if(!Number.isFinite(height)||height<=0)throw new Error('인쇄 품목 높이를 확인할 수 없습니다.');
  const required=height+(index===heights.length-1?footerHeight:0);
  if(used+required>capacity&&page.length){pages.push(page);page=[];used=0;capacity=nextCapacity;}
  if(required>capacity+.01)throw new Error('품목 또는 적요가 한 페이지보다 깁니다. 내용을 나누어 출력해 주세요.');
  page.push(index);used+=height;
 });
 if(page.length||!pages.length)pages.push(page);
 return pages;
}

export function splitEstimatePrintDocument(doc,paginate=paginateEstimateRows) {
 if(doc.body.hasAttribute('data-estimate-print-page')||doc.querySelector('.native-estimate'))return [doc.documentElement.outerHTML];
 const table=doc.querySelector('.item-table'),tbody=table?.tBodies[0];
 if(!table||!tbody)return [doc.documentElement.outerHTML];
 const rows=[...tbody.rows];if(!rows.length)return [doc.documentElement.outerHTML];
 const style=doc.defaultView.getComputedStyle(doc.body),box=doc.body.getBoundingClientRect();
 const pageHeight=297*96/25.4,padTop=parseFloat(style.paddingTop)||0,padBottom=parseFloat(style.paddingBottom)||0;
 const headHeight=table.tHead?.getBoundingClientRect().height||0;
 const footer=doc.querySelector('.web-document-total')||table.tFoot;
 const footerHeight=footer?(footer.getBoundingClientRect().height+(parseFloat(doc.defaultView.getComputedStyle(footer).marginTop)||0)):0;
 const heights=rows.map(row=>row.getBoundingClientRect().height);
 const rowTop=rows[0].getBoundingClientRect().top-box.top;
 // Leave two pixels for collapsed borders/physical page-unit rounding.
 const pages=paginate({heights,firstCapacity:pageHeight-padBottom-rowTop-2,nextCapacity:pageHeight-padTop-padBottom-headHeight-2,footerHeight});
 const widths=[...table.tHead.rows[0].cells].map(cell=>cell.getBoundingClientRect().width);
 const sum=widths.reduce((n,x)=>n+x,0);
 return pages.map((indices,pageIndex)=>{
  const clone=doc.cloneNode(true),body=clone.body,target=clone.querySelector('.item-table');
  body.setAttribute('data-estimate-print-page',String(pageIndex+1));
  body.setAttribute('data-estimate-print-page-count',String(pages.length));
  const keep=new Set(indices);
  [...target.tBodies[0].rows].forEach((row,index)=>{if(!keep.has(index))row.remove();else{row.style.height=heights[index]+'px';row.style.breakInside='avoid';row.style.pageBreakInside='avoid';}});
  if(pageIndex>0){for(const child of [...body.children])if(child!==target&&!child.matches('.web-document-total'))child.remove();}
  if(pageIndex<pages.length-1){clone.querySelector('.web-document-total')?.remove();target.tFoot?.remove();}
  target.querySelector('colgroup')?.remove();
  const cols=clone.createElement('colgroup');widths.forEach(width=>{const col=clone.createElement('col');col.style.width=(width/sum*100)+'%';cols.appendChild(col);});target.prepend(cols);target.style.tableLayout='fixed';
  const pageStyle=clone.createElement('style');pageStyle.textContent='@media print{.item-table tbody tr{break-inside:avoid;page-break-inside:avoid}}';clone.head.appendChild(pageStyle);
  return '<!doctype html>'+clone.documentElement.outerHTML;
 });
}
