const XLSX=require('xlsx-js-style'),core=require('./shipmentStatement.cjs'),format=require('../config/shipment-statement-format.json'),labels=require('./shipmentStatementLabels.cjs'),{redDateTitles}=require('./shipmentStatementRichTitle.cjs');
function wrappedRows(text,width){return String(text).split('\n').reduce((lines,line)=>lines+Math.max(1,Math.ceil([...line].reduce((n,c)=>n+(c.charCodeAt(0)>255?1:.55),0)/width)),0);}
function buildWorkbook(record,overrides={}){
 // 사용자가 직접 매칭해 둔 표시명(품목별)이 있으면 자동 축약명보다 우선한다.
 const itemLabel=row=>overrides?.[row.prodKey]||labels.itemLabel(row);
 const wb=XLSX.utils.book_new(),draft=core.validatePlan(record.source.rows,record.draft);
 for(const block of core.outputBlocks(record)){
  const ws={},merges=[],heights=[{hpt:format.titleHeight},{hpt:format.spacerHeight}],bundles=new Map(),cols=[];
  for(const group of block.groups){const configured=draft.groups.some(g=>g.name===group.name&&g.categories.includes(group.rows[0].category)),name=configured?group.name:(draft.groups.length?'기타 품목':'');if(!bundles.has(name))bundles.set(name,[]);bundles.get(name).push(group);}
  let maxRow=2,index=0;
  function cell(r,c,value,role,numFmt){const a=XLSX.utils.encode_cell({r,c}),s=JSON.parse(JSON.stringify(format.styles[role]));delete s.numFmt;if(role==='title'||role==='spacer')s.alignment.wrapText=true;ws[a]=typeof value==='object'&&value!==null?{t:'n',...value,s}:{t:typeof value==='number'?'n':'s',v:value??'',s};const z=numFmt??format.styles[role].numFmt;if(z)ws[a].z=z;}
  for(const [bundle,groups] of [...bundles].sort((a,b)=>{const rank=n=>{const i=draft.groups.findIndex(g=>g.name===n);return i<0?draft.groups.length:i;};return rank(a[0])-rank(b[0]);})){
   const col=index++*5,[,month,day]=block.date.split('-');format.columns.forEach(wch=>cols.push({wch}));cols.push({wch:format.gap});
   const title=`${record.source.customer.name} 출고일자 ${Number(month)}월 ${Number(day)}일 ${block.day}요일`;heights[0]={hpt:Math.max(heights[0].hpt,wrappedRows(title,32)*30)};cell(0,col,title,'title');for(let c=1;c<4;c++)cell(0,col+c,'','title');merges.push({s:{r:0,c:col},e:{r:0,c:col+3}});
   for(let c=0;c<4;c++)cell(1,col+c,c===0?bundle:'','spacer');merges.push({s:{r:1,c:col},e:{r:1,c:col+3}});
   if(bundle)heights[1]={hpt:Math.max(heights[1].hpt,32,wrappedRows(bundle,32)*30)};
   let r=2;
   for(const group of groups){
    const start=r;heights[r]={hpt:Math.max(heights[r]?.hpt??0,format.headerHeight,wrappedRows(`총 수량 / ${group.unit}`,7)*20)};cell(r,col,labels.categoryLabel(group),'category');cell(r,col+1,'색상','nameHeader');cell(r,col+2,`총 수량 / ${group.unit}`,'numberHeader');cell(r,col+3,'단가','numberHeader');r++;
    const first=r;
    for(const row of group.rows){heights[r]={hpt:Math.max(heights[r]?.hpt??0,format.bodyHeight,wrappedRows(itemLabel(row),15)*30)};cell(r,col,'','category');cell(r,col+1,itemLabel(row),'body');cell(r,col+2,row.quantity,'body',Number.isInteger(row.quantity)?'#,##0':'#,##0.########');cell(r,col+3,row.cost,'price',row.cost===null||Number.isInteger(row.cost)?format.styles.price.numFmt:'"₩"#,##0.########');r++;}
    heights[r]={hpt:Math.max(heights[r]?.hpt??0,format.bodyHeight)};cell(r,col,'','category');cell(r,col+1,'합 계','total');const letter=XLSX.utils.encode_col(col+2);cell(r,col+2,{f:`SUM(${letter}${first+1}:${letter}${r})`,v:group.rows.reduce((s,row)=>core.round(s+row.quantity),0)},'body',Number.isInteger(group.rows.reduce((s,row)=>core.round(s+row.quantity),0))?'#,##0':'#,##0.########');cell(r,col+3,'','price');merges.push({s:{r:start,c:col},e:{r,c:col}});if(group.rows.every(row=>row.cost!==null&&row.cost===group.rows[0].cost)){merges.push({s:{r:first,c:col+3},e:{r,c:col+3}});for(let pr=first;pr<=r;pr++){const p=ws[XLSX.utils.encode_cell({r:pr,c:col+3})];p.s.border={left:{style:'thin',color:{rgb:'000000'}},right:{style:'thin',color:{rgb:'000000'}},...(pr===first?{top:{style:'thin',color:{rgb:'000000'}}}:{}),...(pr===r?{bottom:{style:'thin',color:{rgb:'000000'}}}:{})};if(pr>first)p.v='';}}r+=2;
   }
   maxRow=Math.max(maxRow,r-1);
  }
  for(let r=0;r<maxRow;r++)for(let c=0;c<index*5-1;c++)if(!ws[XLSX.utils.encode_cell({r,c})])ws[XLSX.utils.encode_cell({r,c})]={t:'s',v:'',s:{fill:{patternType:'solid',fgColor:{rgb:'FFFFFF'}}}};
  ws['!ref']=XLSX.utils.encode_range({s:{r:0,c:0},e:{r:maxRow-1,c:index*5-2}});ws['!merges']=merges;ws['!cols']=cols.slice(0,-1);ws['!rows']=heights;ws['!margins']={left:.25,right:.25,top:.4,bottom:.4,header:.2,footer:.2};
  XLSX.utils.book_append_sheet(wb,ws,block.day);
 }
 if(!wb.SheetNames.length)throw core.fail('출력할 수량이 없습니다.');return wb;
}
function exportWorkbook(record,overrides={}){const wb=buildWorkbook(record,overrides);return redDateTitles(XLSX.write(wb,{type:'buffer',bookType:'xlsx',compression:true}),wb);}
module.exports={buildWorkbook,exportWorkbook};
