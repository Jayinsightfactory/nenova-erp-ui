import headerOrder from './pivotVolumeHeaderOrder.cjs';

const families = { carnation:['카네이션',40], rose:['장미',28], hydrangea:['수국',40], alstroemeria:['알스트로',40], ruscus:['루스커스',35] };
function palletDay(value) {
  const day=String(value??'').trim().replace(/요일$/,'');
  return !day||day==='미정'?'미지정':day;
}
export function palletSnapshot(XLSX, workbook, rows) {
  const data = {};
  const sheetMeta = new Map();
  for (const row of rows) {
    const family = row.productFamily==='minicarnation'?'carnation':row.productFamily;
    if (!Object.hasOwn(families,family) || !row.colNo) continue;
    const sheet=workbook.Sheets[row.sheetName];
    const value=(r,c)=>String(sheet[XLSX.utils.encode_cell({r,c})]?.v??'').trim();
    if (!sheetMeta.has(row.sheetName)) {
      const range=XLSX.utils.decode_range(sheet?.['!ref']||'A1');
      let headerRow=3, summaryStartCol=(range.e.c??0)+2;
      for (let r=0; r<=Math.min(11,range.e.r); r++) {
        const labels=Array.from({length:range.e.c+1},(_,c)=>value(r,c));
        if (labels.includes('입고') && (labels.includes('주문') || labels.includes('잔량'))) {
          headerRow=r+1;
          const idx=['주문','입고','잔량','재고'].map(lbl=>labels.indexOf(lbl)).filter(c=>c>=0).sort((a,b)=>a-b)[0];
          if (idx!==undefined) summaryStartCol=idx+1;
          break;
        }
      }
      sheetMeta.set(row.sheetName,{
        headerRow,
        order:headerOrder.detectSheetJsHeaderOrder(workbook,row.sheetName,headerRow,summaryStartCol),
      });
    }
    const { headerRow, order }=sheetMeta.get(row.sheetName);
    const resolved=headerOrder.resolveColumnDayAndRegion({
      order,
      headerRow,
      col:row.colNo,
      minCol:2,
      getCellText:(r1,c1)=>value(r1-1,c1-1),
    });
    const region=resolved.region.replace(/_/g,'');
    const day=palletDay(resolved.day);
    const key=JSON.stringify([day,region||'지역 미지정']);
    const boxes=data[family]??={};
    const divisor=family==='rose'?(/snow\s*flake/i.test(row.rawProductLabel||row.productLabel)?25:10):family==='alstroemeria'&&row.alstroErpQuantity?16:1;
    boxes[key]=(boxes[key]||0)+Number(row.uploadQty)/divisor;
  }
  return data;
}
export function palletText(data,day,region,selectedFamilies) {
  const normalized=palletDay(day);
  const key=JSON.stringify([normalized,region]);
  const legacyKey=normalized==='미지정'?JSON.stringify(['미정',region]):null;
  let total=0;
  const display=n=>n>0&&n<0.05?'<0.1':String(Math.round(n*10)/10);
  const parts=Object.entries(families).filter(([id])=>!selectedFamilies||selectedFamilies.includes(id)).map(([id,[name,capacity]])=>{
    if(!data[id]) return name+' 없음';
    const boxes=(data[id][key]||0)+(legacyKey?(data[id][legacyKey]||0):0);
    const pallets=boxes/capacity;
    total+=pallets;
    return name+' '+display(pallets)+'('+Number(boxes.toFixed(6))+')';
  });

  return parts.join(' + ')+' = '+display(total)+'빠렛'+(total>=3?' ('+Math.floor(total)+'빠렛 이상)':'');
}

export function addPalletSnapshots(...snapshots) {
  const combined={};
  for(const snapshot of snapshots){
    for(const [family,routes] of Object.entries(snapshot||{})){
      const subtotal=combined[family]??={};
      for(const [route,boxes] of Object.entries(routes))subtotal[route]=(subtotal[route]||0)+boxes;
    }
  }
  return combined;
}
