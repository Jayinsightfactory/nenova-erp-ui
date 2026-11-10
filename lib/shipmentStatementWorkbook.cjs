const XLSX=require('xlsx-js-style'),core=require('./shipmentStatement.cjs');
function buildWorkbook(record){
 const wb=XLSX.utils.book_new();
 for(const block of core.outputBlocks(record)){
  const data=[[`${record.source.customer.name} 출고일자 ${block.date} ${block.day}요일`],[],['품목군','컬러 / 품목','수량','단가']],merges=[{s:{r:0,c:0},e:{r:0,c:3}}];
  for(const group of block.groups){
   data.push([group.name,`${group.country} ${group.flower}`,`총수량 / ${group.unit}`,'단가']);const start=data.length+1;
   for(const row of group.rows)data.push([row.flower,row.name,row.quantity,row.cost]);
   data.push(['','합계', {f:`SUM(C${start}:C${data.length})`,v:group.rows.reduce((s,r)=>core.round(s+r.quantity),0)},'']);data.push([]);
  }
  const ws=XLSX.utils.aoa_to_sheet(data);ws['!merges']=merges;ws['!cols']=[{wch:23},{wch:46},{wch:19},{wch:17}];ws['!rows']=data.map((r,i)=>({hpt:i===0?32:24}));
  for(let r=0;r<data.length;r++)for(let c=0;c<4;c++){
   const cell=ws[XLSX.utils.encode_cell({r,c})];if(!cell)continue;
   const header=r===0||r===2||String(data[r][2]||'').startsWith('총수량'),total=data[r][1]==='합계';
   cell.s={font:{name:'맑은 고딕',sz:r===0?15:11,bold:header||total},alignment:{vertical:'center',horizontal:c>=2?'right':'left',wrapText:true},border:Object.fromEntries(['top','bottom','left','right'].map(k=>[k,{style:'thin',color:{rgb:'CBD5E1'}}])),...((header||total)?{fill:{fgColor:{rgb:total?'DCFCE7':'E2E8F0'}}}:{})};
   if(c>=2)cell.z='#,##0.########';
  }
  ws['!margins']={left:.25,right:.25,top:.4,bottom:.4,header:.2,footer:.2};ws['!autofilter']={ref:'A3:D3'};
  XLSX.utils.book_append_sheet(wb,ws,block.day);
 }
 if(!wb.SheetNames.length)throw core.fail('출력할 수량이 없습니다.');return wb;
}
function exportWorkbook(record){return XLSX.write(buildWorkbook(record),{type:'buffer',bookType:'xlsx',compression:true});}
module.exports={buildWorkbook,exportWorkbook};
