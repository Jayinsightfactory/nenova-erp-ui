// The printed HTML is the layout source. Measure its leaf cells rather than
// maintaining a second, abbreviated report template for Excel.
import XLSX from 'xlsx-js-style';


export function measureEstimatePrintDocument(doc) {
  const root = doc.body;
  const origin = root.getBoundingClientRect();
  const cells = [];
  const numberParts=new doc.defaultView.Intl.NumberFormat().formatToParts(12345.6);
  const group=numberParts.find(part=>part.type==='group')?.value;
  const decimal=numberParts.find(part=>part.type==='decimal')?.value||'.';
  const add = (el, text, kind = 'text') => {
    const r = el.getBoundingClientRect();
    const s = doc.defaultView.getComputedStyle(el);
    if (!r.width || !r.height) return;
    let background=s.backgroundColor,parent=el.parentElement;
    while((background==='transparent'||background==='rgba(0, 0, 0, 0)')&&parent){background=doc.defaultView.getComputedStyle(parent).backgroundColor;parent=parent.parentElement;}
    const label=String(text??'').trim();
    const normalized=(group?label.split(group).join(''):label).split(decimal).join('.');
    const isNumeric=s.textAlign==='right'&&/^-?\d+(?:\.\d+)?$/.test(normalized)&&Number.isFinite(Number(normalized));
    cells.push({ x:r.left-origin.left, y:r.top-origin.top, w:r.width, h:r.height,
      text:label,isNumeric,numericValue:isNumeric?Number(normalized):null,kind, fontSize:parseFloat(s.fontSize)*.75,
      fontName:s.fontFamily.split(',')[0].replace(/["']/g,''),underline:s.textDecorationLine.includes('underline'),
      bold: Number(s.fontWeight)>=600, align:s.textAlign, background,color:s.color,
      border:el.matches('.logo-area,.greet') || (s.borderTopStyle !== 'none' && parseFloat(s.borderTopWidth)>0) });
  };
  root.querySelectorAll('td,th').forEach(el => {
    if (el.querySelector('table,td,th,.logo-area,.greet')) return;
    add(el,el.innerText);
  });
  root.querySelectorAll('h1,.greet,.logo-area').forEach(el=>add(el,el.innerText));
  const amount=root.querySelector('.amt-row');
  if(amount){
    const parts=[...amount.querySelectorAll('.amt-ko,.amt-num')];
    parts.forEach((el,index)=>{
      add(el,el.innerText);
      const cell=cells.at(-1),r=amount.getBoundingClientRect();
      const split=parts[1]?.getBoundingClientRect().left||r.right;
      Object.assign(cell,{x:(index===0?r.left:split)-origin.left,y:r.top-origin.top,
        w:index===0?split-r.left:r.right-split,h:r.height,border:true,borderEdges:index===0?['top','bottom','left']:['top','bottom','right']});
    });
  }
  const images=[...root.querySelectorAll('img')].map(el=>{
    const r=el.getBoundingClientRect();
    return {src:el.src,x:r.left-origin.left,y:r.top-origin.top,w:r.width,h:r.height};
  }).filter(x=>/^data:image\/(png|jpeg);base64,/.test(x.src));
  const itemHead=root.querySelector('.item-table thead');
  const h=itemHead?.getBoundingClientRect();
  return {cells,images,head:h?{top:h.top-origin.top,bottom:h.bottom-origin.top}:null};
}

const pxToPt=px=>px*.75;
const unique=values=>[...new Set(values.map(v=>Math.round(v*4)/4))].sort((a,b)=>a-b);
const nearest=(values,v)=>values.reduce((best,n,i)=>Math.abs(n-v)<Math.abs(values[best]-v)?i:best,0);

export function uniqueEstimateSheetName(value,existingNames=[]) {
  const base=String(value||'견적서').replace(/[\\/?*\[\]:]/g,'_').trim()||'견적서';
  const used=new Set(existingNames.map(name=>name.toLocaleLowerCase()));
  let name=base.slice(0,31),index=2;
  while(used.has(name.toLocaleLowerCase())){const suffix=`_${index++}`;name=base.slice(0,31-suffix.length)+suffix;}
  return name;
}

export function buildEstimateRenderedWorksheet(layout) {
  const {cells}=layout;
  if(!cells.length) throw new Error('인쇄 양식에 출력할 셀이 없습니다.');
  const xs=unique(cells.flatMap(c=>[c.x,c.x+c.w]));
  const ys=unique(cells.flatMap(c=>[c.y,c.y+c.h]));
  const ws={}; const merges=[];
  for(const cell of cells){
    const c=nearest(xs,cell.x),r=nearest(ys,cell.y);
    const ec=nearest(xs,cell.x+cell.w)-1,er=nearest(ys,cell.y+cell.h)-1;
    if(ec<c||er<r) continue;
    const border=cell.border?Object.fromEntries((cell.borderEdges||['top','bottom','left','right']).map(edge=>[edge,{style:'thin',color:{rgb:'BBBBBB'}}])):undefined;
    const numeric=cell.isNumeric??(/^-?\d[\d,]*(\.\d+)?$/.test(cell.text) && cell.align==='right');
    const value=numeric?(Number.isFinite(cell.numericValue)?cell.numericValue:Number(cell.text.replaceAll(',',''))):cell.text;
    const style={font:{name:cell.fontName||'맑은 고딕',sz:cell.fontSize,bold:cell.bold,underline:cell.underline},alignment:{horizontal:['right','center'].includes(cell.align)?cell.align:'left',vertical:'center',wrapText:true},border};
    const foreground=String(cell.color||'').match(/^rgb\((\d+), (\d+), (\d+)\)$/);
    if(foreground)style.font.color={rgb:foreground.slice(1).map(v=>(+v).toString(16).padStart(2,'0')).join('').toUpperCase()};
    if(numeric)style.numFmt=Number.isInteger(value)?'#,##0':'#,##0.########';
    const bg=String(cell.background||'').match(/^rgb\((\d+), (\d+), (\d+)\)$/);
    if(bg)style.fill={fgColor:{rgb:bg.slice(1).map(v=>(+v).toString(16).padStart(2,'0')).join('').toUpperCase()}};
    for(let rr=r;rr<=er;rr++)for(let cc=c;cc<=ec;cc++)ws[XLSX.utils.encode_cell({r:rr,c:cc})]={t:'s',v:'',s:style};
    ws[XLSX.utils.encode_cell({r,c})]={t:numeric?'n':'s',v:value,s:style};
    if(ec>c||er>r)merges.push({s:{r,c},e:{r:er,c:ec}});
  }
  ws['!ref']=XLSX.utils.encode_range({s:{r:0,c:0},e:{r:ys.length-2,c:xs.length-2}});
  ws['!merges']=merges;
  ws['!cols']=xs.slice(0,-1).map((x,i)=>({wpx:xs[i+1]-x}));
  ws['!rows']=ys.slice(0,-1).map((y,i)=>({hpt:pxToPt(ys[i+1]-y)}));
  ws['!printLayout']={images:layout.images.map(i=>({...i,x:i.x-xs[0],y:i.y-ys[0]})),
    repeat:layout.head?{start:nearest(ys,layout.head.top)+1,end:nearest(ys,layout.head.bottom)}:null};
  return ws;
}

export async function buildEstimateWorksheetFromHtml(html) {
  const frame=document.createElement('iframe');
  frame.setAttribute('aria-hidden','true');frame.tabIndex=-1;
  Object.assign(frame.style,{position:'fixed',left:'-10000px',top:'0',width:'210mm',height:'297mm',border:'0',visibility:'hidden'});
  try{
    const loaded=new Promise((resolve,reject)=>{frame.onload=resolve;frame.onerror=()=>reject(new Error('인쇄 양식을 불러오지 못했습니다.'));});
    frame.srcdoc=html;document.body.appendChild(frame);await loaded;
    const doc=frame.contentDocument;await doc.fonts.ready;
    await Promise.all([...doc.images].map(i=>i.decode().catch(()=>{})));
    return buildEstimateRenderedWorksheet(measureEstimatePrintDocument(doc));
  }finally{frame.remove();}
}

export async function serializeEstimatePrintWorkbook(wb) {
  const { default: ExcelJS } = await import('exceljs');
  const output = new ExcelJS.Workbook();
  for (let i=0;i<wb.SheetNames.length;i++) {
    const source=wb.Sheets[wb.SheetNames[i]], layout=source['!printLayout'];
    if (!layout) continue;
    const sheet=output.addWorksheet(wb.SheetNames[i]);
    sheet.views=[{showGridLines:false,zoomScale:100}];
    for (const [ref,cell] of Object.entries(source)) {
      if (ref.startsWith('!')) continue;
      const target=sheet.getCell(ref);target.value=cell.v;
      if(cell.s){
        target.font={name:cell.s.font.name,size:cell.s.font.sz,bold:cell.s.font.bold,underline:cell.s.font.underline};
        if(cell.s.font.color)target.font.color={argb:cell.s.font.color.rgb};
        target.alignment=cell.s.alignment;
        if(cell.s.border)target.border=Object.fromEntries(Object.entries(cell.s.border).map(([edge,value])=>[edge,{...value,color:{argb:value.color.rgb}}]));
        if(cell.s.fill)target.fill={type:'pattern',pattern:'solid',fgColor:{argb:cell.s.fill.fgColor.rgb}};
        if(cell.s.numFmt)target.numFmt=cell.s.numFmt;
      }
    }
    for(const merge of source['!merges']||[])sheet.mergeCells(XLSX.utils.encode_range(merge));
    (source['!cols']||[]).forEach((col,index)=>{sheet.getColumn(index+1).width=col.wpx<=12?col.wpx/12:(col.wpx-5)/7;});
    (source['!rows']||[]).forEach((row,index)=>{sheet.getRow(index+1).height=row.hpt;});
    sheet.pageSetup={paperSize:9,orientation:'portrait',fitToPage:true,fitToWidth:1,fitToHeight:0,
      margins:{left:15/25.4,right:15/25.4,top:10/25.4,bottom:10/25.4,header:0,footer:0},
      printArea:source['!ref'],printTitlesRow:layout.repeat?layout.repeat.start+':'+layout.repeat.end:undefined};
    for (const image of layout.images) {
      const match=image.src.match(/^data:image\/(png|jpeg);base64,(.+)$/);
      if (!match) continue;
      const id=output.addImage({base64:image.src,extension:match[1]});
      const locate=(values,pixel)=>{let index=0,offset=pixel;while(index<values.length-1&&offset>=values[index]){offset-=values[index];index++;}return {index,offset:Math.round(offset*9525)};};
      const x=locate(source['!cols'].map(c=>c.wpx),image.x);
      const y=locate(source['!rows'].map(r=>r.hpt/.75),image.y);
      sheet.addImage(id,{tl:{nativeCol:x.index,nativeColOff:x.offset,nativeRow:y.index,nativeRowOff:y.offset},ext:{width:image.w,height:image.h},editAs:'absolute'});
    }
  }
  return new Uint8Array(await output.xlsx.writeBuffer());
}

export async function downloadRenderedEstimateWorkbook(wb,fileName){
  const bytes=await serializeEstimatePrintWorkbook(wb);
  const url=URL.createObjectURL(new Blob([bytes],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));
  const link=document.createElement('a');link.href=url;link.download=fileName;link.click();
  setTimeout(()=>URL.revokeObjectURL(url),30000);
}
