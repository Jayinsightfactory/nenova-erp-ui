const families = { carnation:['카네이션',40], rose:['장미',28], hydrangea:['수국',40], alstroemeria:['알스트로',40], ruscus:['루스커스',35] };
export function palletSnapshot(XLSX, workbook, rows) {
  const data = {};
  for (const row of rows) {
    const family = row.productFamily==='minicarnation'?'carnation':row.productFamily;
    if (!Object.hasOwn(families,family) || !row.colNo) continue;
    const sheet=workbook.Sheets[row.sheetName];
    const value=(r,c)=>String(sheet[XLSX.utils.encode_cell({r,c})]?.v??'').trim();
    let region='';
    for(let c=row.colNo-1;c>0&&!region;c--)region=value(0,c).replace(/_/g,'');
    const day=value(1,row.colNo-1).replace(/요일$/,'')||'미정';
    const key=JSON.stringify([day,region||'지역 미지정']);
    const boxes=data[family]??={};
    const divisor=family==='rose'?(/snow\s*flake/i.test(row.rawProductLabel||row.productLabel)?25:10):family==='alstroemeria'&&row.alstroErpQuantity?16:1;
    boxes[key]=(boxes[key]||0)+Number(row.uploadQty)/divisor;
  }
  return data;
}
export function palletText(data,day,region) {
  const key=JSON.stringify([day.replace(/요일$/,''),region]);
  let total=0;
  const display=n=>n>0&&n<0.05?'<0.1':String(Math.round(n*10)/10);
  const parts=Object.entries(families).map(([id,[name,capacity]])=>{
    if(!data[id]) return name+' 없음';
    const pallets=(data[id][key]||0)/capacity;
    total+=pallets;
    return name+' '+display(pallets);
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
