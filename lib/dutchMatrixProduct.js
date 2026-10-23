import { dutchDataStart } from './dutchMatrixLayout.js';
import { createDutchBlankCellEntry } from './dutchSheetQuantityEdit.js';

export function addDutchMatrixProduct(XLSX, workbook, entries, name, product) {
  const prodKey=Number(product?.prodKey??product?.ProdKey), prodName=String(product?.prodName??product?.ProdName??'').trim();
  const country=String(product?.country??product?.CounName??product?.counName??'');
  if(!Number.isSafeInteger(prodKey)||prodKey<=0||!prodName||country!=='네덜란드')throw Error('네덜란드 ERP 품목을 선택하세요.');
  const duplicate=entries.find(row=>row.sheetName===name&&Number(row.prodKey)===prodKey);
  if(duplicate)return {workbook,entries,focusId:duplicate.id,duplicate:true};
  const source=workbook?.Sheets?.[name];
  if(!source?.['!ref'])throw Error('먼저 물량표를 불러오세요.');
  const range=XLSX.utils.decode_range(source['!ref']);
  for(let row=dutchDataStart(source);row<=range.e.r;row++) {
    if(String(source[XLSX.utils.encode_cell({r:row,c:1})]?.v||'').trim()===prodName) {
      return {workbook,entries,focusId:entries.find(e=>e.sheetName===name&&e.sourceRow===row)?.id,duplicate:true};
    }
  }
  let r=range.e.r+1;
  for(let row=dutchDataStart(source);row<=range.e.r;row++)if([0,1].some(c=>String(source[XLSX.utils.encode_cell({r:row,c})]?.v||'')==='합계')){r=row;break;}
  const next=structuredClone(workbook), sheet=next.Sheets[name];
  for(let row=range.e.r;row>=r;row--)for(let c=0;c<=range.e.c;c++) {
    const old=XLSX.utils.encode_cell({r:row,c}), to=XLSX.utils.encode_cell({r:row+1,c});
    if(sheet[old])sheet[to]=sheet[old];else delete sheet[to];delete sheet[old];
  }
  for(const sheetName of next.SheetNames)for(const cell of Object.values(next.Sheets[sheetName]||{}))if(typeof cell?.f==='string') {
    cell.f=cell.f.split(/("(?:[^"]|"")*")/g).map((part,i)=>i%2?part:part.replace(/(?<![\w.])(?:('[^']*(?:''[^']*)*'|[\p{L}\w]+)!)?(\$?[A-Z]{1,3}\$?\d+)(?::(\$?[A-Z]{1,3}\$?\d+))?(?![\w(])/gu,(all,q,a,b)=>{
      const target=q?q.replace(/^'|'$/g,'').replace(/''/g,"'"):sheetName;
      const shift=address=>address.replace(/(\$?)(\d+)$/,(_m,abs,row)=>`${abs}${Number(row)>=r+1?Number(row)+1:row}`);
      return target===name?`${q?`${q}!`:''}${shift(a)}${b?`:${shift(b)}`:''}`:all;
    })).join('');
  }
  sheet['!merges']=(sheet['!merges']||[]).map(m=>({s:{...m.s,r:m.s.r>=r?m.s.r+1:m.s.r},e:{...m.e,r:m.e.r>=r?m.e.r+1:m.e.r}}));
  if(sheet['!rows'])sheet['!rows'].splice(r,0,{hpt:24});
  const put=(c,v)=>{sheet[XLSX.utils.encode_cell({r,c})]={t:typeof v==='number'?'n':'s',v};};
  const flower=String(product.flower??product.FlowerName??product.flowerName??'기타');
  put(0,flower);put(1,prodName);put(2,String(product.Descr??product.descr??''));
  let summary=range.e.c+1;
  for(let c=3;c<=range.e.c;c++) {
    const h=String(sheet[XLSX.utils.encode_cell({r:2,c})]?.v||'');
    if(h==='주문')summary=c;
    if(['품목명','품목'].includes(h))put(c,prodName);
    else if(['주문','입고','잔량'].includes(h))put(c,0);
  }
  sheet['!ref']=XLSX.utils.encode_range({s:range.s,e:{r:range.e.r+1,c:range.e.c}});
  const added=[];
  for(let c=3;c<summary;c++) {
    const row=createDutchBlankCellEntry(XLSX,sheet,name,r,c,3);
    if(!row)continue;
    const peer=entries.find(e=>e.sheetName===name&&e.sourceColumn===c&&!e.added);
    added.push({...row,prodKey,product:prodName,unit:String(product.OutUnit??product.outUnit??''),...(peer?.custKey?{custKey:peer.custKey}:{}),...(peer?.sourceCustKey?{sourceCustKey:peer.sourceCustKey}:{})});
  }
  const inline=new Map(entries.filter(e=>e.sheetName===name&&e.added&&typeof e.customerArea==='string').map(e=>[e.custKey,e]));
  for(const peer of inline.values())added.push({...peer,id:`inline:${name}:${r}:${peer.custKey}`,sourceRow:r,prodKey,product:prodName,color:prodName,sourceFlower:flower,sourceItem:prodName,sourceColor:String(product.Descr??''),quantity:0,quantityHistory:[],unit:String(product.OutUnit??product.outUnit??'')});
  const shifted=entries.map(e=>e.sheetName===name&&e.sourceRow>=r?{...e,sourceRow:e.sourceRow+1,...(e.cellAddress?{cellAddress:XLSX.utils.encode_cell({r:e.sourceRow+1,c:e.sourceColumn})}:{})}:e);
  return {workbook:next,entries:[...shifted,...added],focusId:added[0]?.id,duplicate:false};
}
