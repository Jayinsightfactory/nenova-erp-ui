const XLSX=require('xlsx-js-style');
const xml=s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');
// xlsx-js-style drops cell rich-text runs when writing. Patch only our title
// cells using its bundled CFB ZIP API; leave every other OOXML part untouched.
function redDateTitles(bytes,workbook){
 const zip=XLSX.CFB.read(bytes,{type:'buffer'}),marker=' 출고일자 ';
 workbook.SheetNames.forEach((name,index)=>{
  const sheet=workbook.Sheets[name],targets=Object.keys(sheet).filter(a=>/^[A-Z]+1$/.test(a)&&typeof sheet[a].v==='string'&&sheet[a].v.includes(marker));
  if(!targets.length)return;
  const path=`Root Entry/xl/worksheets/sheet${index+1}.xml`,entry=XLSX.CFB.find(zip,path);
  if(!entry)throw Error('출고내역서 제목 시트를 찾지 못했습니다.');
  let content=Buffer.from(entry.content).toString('utf8');
  for(const address of targets){
   const cell=sheet[address],split=cell.v.lastIndexOf(marker)+marker.length,font=cell.s?.font??{name:'맑은 고딕',sz:19,bold:true};
   const run=(text,color)=>`<r><rPr>${font.bold?'<b/>':''}<sz val="${xml(font.sz??19)}"/><color rgb="${color}"/><rFont val="${xml(font.name??'맑은 고딕')}"/><family val="3"/><charset val="129"/></rPr><t xml:space="preserve">${xml(text)}</t></r>`;
   let replacements=0;
   content=content.replace(new RegExp(`<c\\b([^>]*\\br="${address}"[^>]*)>[\\s\\S]*?<\\/c>`,'g'),(_,attrs)=>{
    replacements++;return `<c${attrs.replace(/\s+t="[^"]*"/,'')} t="inlineStr"><is>${run(cell.v.slice(0,split),'FF000000')}${run(cell.v.slice(split),'FFFF0000')}</is></c>`;
   });
   if(replacements!==1)throw Error('출고내역서 날짜 색상 적용을 확인하지 못했습니다.');
  }
  // Full root path replaces the existing entry rather than adding a duplicate.
  XLSX.CFB.utils.cfb_add(zip,path,Buffer.from(content,'utf8'));
 });
 return XLSX.CFB.write(zip,{type:'buffer',fileType:'zip',compression:true});
}
module.exports={redDateTitles};
