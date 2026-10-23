// Header schema shared by parser, editor and export. Legacy three-row files remain valid.
export const dutchDataStart = sheet => String(sheet?.A4?.v || '').trim() === '클라이언트 번호' ? 4 : 3;
export function dutchCustomerHeader(XLSX, sheet, column) {
  const name = String(sheet?.[XLSX.utils.encode_cell({r:2,c:column})]?.v || '').trim();
  const code = dutchDataStart(sheet) === 4 ? String(sheet?.[XLSX.utils.encode_cell({r:3,c:column})]?.v || '').trim() : '';
  return [name,code].filter(Boolean).join('\n');
}

// Export legacy matrices using the new four-row header. Shift references, not cached values.
export function splitDutchClientRows(XLSX, workbook, entries) {
  const names = new Set(workbook.SheetNames.filter(name=> {
    const sheet=workbook.Sheets[name];
    return sheet?.['!ref'] && dutchDataStart(sheet)===3 && (entries.some(row=>row.sheetName===name) || (sheet.A3?.v==='꽃' && sheet.B3?.v==='품목명'));
  }));
  const shift = address => address.replace(/(\$?\d+)$/, row => `${row.startsWith('$')?'$':''}${Number(row.replace('$',''))>=4?Number(row.replace('$',''))+1:Number(row.replace('$',''))}`);
  for(const name of names) {
    const source=workbook.Sheets[name], target={}, range=XLSX.utils.decode_range(source['!ref']);
    for(const [address,cell] of Object.entries(source)) {
      if(address.startsWith('!')) continue;
      target[shift(address)]={...cell};
    }
    Object.assign(target, Object.fromEntries(Object.entries(source).filter(([k])=>k.startsWith('!'))));
    target['!ref']=XLSX.utils.encode_range({s:range.s,e:{r:range.e.r+1,c:range.e.c}});
    target['!rows']=[...(source['!rows']||[]).slice(0,3),{hpt:18},...(source['!rows']||[]).slice(3)];
    if(source['!freeze']) target['!freeze']={...source['!freeze'],ySplit:4};
    target['!merges']=(source['!merges']||[]).map(m=>({s:{...m.s,r:m.s.r>=3?m.s.r+1:m.s.r},e:{...m.e,r:m.e.r>=3?m.e.r+1:m.e.r}}));
    target.A4={t:'s',v:'클라이언트 번호'};
    for(let c=2;c<=range.e.c;c++) {
      const address=XLSX.utils.encode_cell({r:2,c}), label=String(source[address]?.v||'');
      if(label==='주문') break;
      const parts=label.split(/\r?\n/);
      if(parts.length>1) {target[address]={...target[address],v:parts[0]};target[XLSX.utils.encode_cell({r:3,c})]={t:'s',v:parts.slice(1).join(' ')};}
    }
    workbook.Sheets[name]=target;
  }
  for(const name of workbook.SheetNames) for(const cell of Object.values(workbook.Sheets[name]||{})) {
    if(typeof cell?.f!=='string')continue;
    cell.f=cell.f.split(/("(?:[^"]|"")*")/g).map((part,i)=>i%2?part:part.replace(/(?<![\w.])(?:('[^']*(?:''[^']*)*'|[\p{L}\w]+)!)?(\$?[A-Z]{1,3}\$?\d+)(?::(\$?[A-Z]{1,3}\$?\d+))?(?![\w(])/gu,(all,q,a,b)=>{
      const target=q?q.replace(/^'|'$/g,'').replace(/''/g,"'"):name;
      return names.has(target)?`${q?`${q}!`:''}${shift(a)}${b?`:${shift(b)}`:''}`:all;
    })).join('');
  }
  for(const entry of entries) if(names.has(entry.sheetName)) {entry.sourceRow++;entry.cellAddress=shift(entry.cellAddress);entry.id=`${entry.sheetName}!${entry.cellAddress}`;}
  return names;
}
