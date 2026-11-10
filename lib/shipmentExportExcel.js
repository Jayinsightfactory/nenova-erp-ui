import XLSX from 'xlsx';

// Stored dates are authoritative; browser draft settings never redistribute them.
export const SHIPMENT_EXPORT_SQL = `SELECT vs.OrderYear,vs.OrderWeek,vs.CustKey,vs.CustName,
 vs.SdetailKey,vs.ProdKey,vs.ProdName,vs.FlowerName,vs.CountryFlower,p.OutUnit,
 vs.OutQuantity,dt.SdateKey,dt.ShipmentQuantity,
 CONVERT(nvarchar(23),dt.ShipmentDtm,121) AS Timestamp,
 (SELECT COUNT(*) FROM PeriodDay pd WHERE pd.OrderYearWeek=@major
    AND CONVERT(datetime,pd.BaseYmd,121)=dt.ShipmentDtm) AS CalendarMatches
 FROM ViewShipment vs
 LEFT JOIN ShipmentDate dt ON dt.SdetailKey=vs.SdetailKey
 LEFT JOIN Product p ON p.ProdKey=vs.ProdKey
 WHERE vs.OrderYear=@year AND vs.OrderWeek=@week AND vs.OutQuantity>0
 AND (@custKey IS NULL OR vs.CustKey=@custKey)
 ORDER BY vs.CustKey,vs.SdetailKey,dt.ShipmentDtm,dt.SdateKey`;

function fail(message){throw Object.assign(new Error(message),{statusCode:409,code:'SHIPMENT_EXPORT_MISMATCH'});}
function quantity(value){if(value===null||value===undefined||value===''||!Number.isFinite(Number(value))||Number(value)<0)fail('출고 수량이 올바르지 않아 엑셀을 생성할 수 없습니다.');return Number(value);}
export function shipmentExportLines(rows,scope){
 const details=new Map(),lines=[];
 for(const row of rows){
  if(String(row.OrderYear)!==scope.orderYear||row.OrderWeek!==scope.orderWeek||
    (scope.custKey!==null&&Number(row.CustKey)!==scope.custKey))fail('선택 연도·차수·업체와 출력 자료가 다릅니다.');
  if(!['박스','단','송이'].includes(row.OutUnit))fail('출고 단위가 없어 엑셀을 생성할 수 없습니다.');
  const key=Number(row.SdetailKey);if(!Number.isSafeInteger(key)||key<=0)fail('출고 상세키를 확인하세요.');
  if(!details.has(key))details.set(key,[]);details.get(key).push(row);
 }
 for(const group of details.values()){
  const first=group[0],out=quantity(first.OutQuantity),seen=new Set();
  if(out<=0)fail('양수 출고만 출력할 수 있습니다.');
  if(group.every(r=>r.SdateKey===null)){
   if(group.length!==1)fail('출고 상세가 중복되어 엑셀을 생성할 수 없습니다.');
   lines.push({...first,date:'미지정',qty:out});continue;
  }
  let total=0;
  for(const row of group){
   if(row.SdateKey===null||row.OutQuantity!==first.OutQuantity||row.ProdKey!==first.ProdKey||row.CustKey!==first.CustKey)fail('출고 상세와 날짜 연결을 확인하세요.');
   const timestamp=String(row.Timestamp??'');
   if(!/^\d{4}-\d{2}-\d{2} 00:00:00\.000$/.test(timestamp)||Number(row.CalendarMatches)!==1||seen.has(timestamp))fail('출고일이 전산 달력과 일치하지 않거나 중복됩니다. 출고일 지정을 확인하세요.');
   seen.add(timestamp);const qty=quantity(row.ShipmentQuantity);total+=qty;
   if(qty>0)lines.push({...row,date:timestamp.slice(0,10),qty});
  }
  if(Math.abs(total-out)>0.000001)fail('출고일 수량 합계와 출고수량이 다릅니다. 출고일 지정을 확인하세요.');
 }
 return lines;
}
export function buildShipmentExportWorkbook(rows,scope){
 const lines=shipmentExportLines(rows,scope),customers=new Map(),wb=XLSX.utils.book_new();
 for(const line of lines){if(!customers.has(line.CustKey))customers.set(line.CustKey,new Map());const days=customers.get(line.CustKey);if(!days.has(line.date))days.set(line.date,[]);days.get(line.date).push(line);}
 for(const [custKey,days] of customers){
  for(const date of [...days.keys()].sort((a,b)=>a==='미지정'?1:b==='미지정'?-1:a.localeCompare(b))){
   const items=days.get(date),name=items[0].CustName??String(custKey),cats=new Map();
   for(const item of items){const category=item.CountryFlower||item.FlowerName||'기타',key=JSON.stringify([category,item.OutUnit]);if(!cats.has(key))cats.set(key,{category,unit:item.OutUnit,items:[]});cats.get(key).items.push(item);}
   const label=date==='미지정'?'미지정':`${date} (${['일','월','화','수','목','금','토'][new Date(date+'T00:00:00Z').getUTCDay()]})`;
   const data=[[`${name} 출고일자 ${label}`],[`차수 ${scope.orderYear}-${scope.orderWeek}`]],merges=[{s:{r:0,c:0},e:{r:0,c:3}},{s:{r:1,c:0},e:{r:1,c:3}}];
   for(const {category,unit,items:group} of cats.values()){
    data.push([category,'색상',`총 수량 / ${unit}`,'비고']);
    for(const item of group)data.push(['',item.ProdName,item.qty,'']);
    data.push(['','합 계',group.reduce((s,r)=>s+r.qty,0),'']);data.push([]);
   }
   const ws=XLSX.utils.aoa_to_sheet(data);ws['!cols']=[{wch:25},{wch:32},{wch:20},{wch:12}];ws['!merges']=merges;
   for(const [address,cell] of Object.entries(ws))if(!address.startsWith('!')&&cell.t==='n')cell.z='#,##0.###';
   const safe=String(name).replace(/[\\/?*[\]:]/g,'_').slice(0,14);const suffix=date==='미지정'?'미지정':date.slice(5);let sheet=`${safe}_${suffix}`,n=1;while(wb.SheetNames.includes(sheet))sheet=`${safe}_${suffix}_${n++}`;
   XLSX.utils.book_append_sheet(wb,ws,sheet);
  }
 }
 return wb;
}
