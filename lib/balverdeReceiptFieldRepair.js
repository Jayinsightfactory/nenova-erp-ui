import {createHash} from 'node:crypto';
export const BALVERDE_REPAIR_SCOPES=[
 {warehouseKey:8073,week:'46-02',invoice:'25571',hash:'8dee457a880cb2c6c52e861d56dcf81f085151c5f24dc90597869daf002ed62a',keys:[49674,49675,49676,49677,49678,49679],products:[888,868,3498,881,889,887],boxes:[3,17,19,3,50,1],stems:[90,510,570,90,1500,30],prices:[.9,.9,.9,.9,.7,.9]},
 {warehouseKey:8162,week:'47-02',invoice:'25587',hash:'e6daaeac008c5c283785909f40a70b0ad04fa235cbd26b6a675cf185d7411f94',keys:[50455,50456,50457,50458,50459],products:[888,868,3498,889,887],boxes:[4,9,25,30,1],stems:[120,270,750,900,30],prices:[.9,.9,.9,.7,.9]},
];
export const repairDigest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const assert=(condition,message)=>{if(!condition)throw Error(message);};
// Native ExcelLoadingPackingList.MakeTempTable takes column A verbatim. The
// existing buildSheet19_2 writes String(source product index+1) to that column.
// No product/customer codes or PDF ORD text are substituted here.
export function planBalverdeReceiptFields(scope,master,details,document,lines){
 assert(master?.WarehouseKey===scope.warehouseKey&&master.OrderYear==='2026'&&master.OrderWeek===scope.week&&master.InvoiceNo===scope.invoice&&master.FarmName==='Balverde'&&!master.isDeleted,'REPAIR_MASTER_IDENTITY');
 assert(document?.SourceHash===scope.hash&&document.InvoiceNo===scope.invoice&&document.OrderYear==='2026'&&document.OrderWeek===scope.week,'REPAIR_SOURCE_IDENTITY');
 assert(details.length===scope.keys.length&&lines.length===scope.keys.length,'REPAIR_ROW_COUNT');
 return details.map((row,index)=>{
  const line=lines[index],evidence=typeof line.SourceEvidenceJson==='string'?JSON.parse(line.SourceEvidenceJson):line.SourceEvidenceJson;
  assert(row.WdetailKey===scope.keys[index]&&row.WarehouseKey===scope.warehouseKey&&row.ProdKey===scope.products[index]&&line.ProdKey===row.ProdKey&&line.LineNo===index+1&&evidence?.sourceLineIndex===index,'REPAIR_ROW_IDENTITY');
  assert(evidence?.packing?.stemsPerBunch===1&&evidence?.packing?.stemsPerBox===30,'REPAIR_PACKING_EVIDENCE');
  const boxes=scope.boxes[index],stems=scope.stems[index],price=scope.prices[index],amount=Math.round(stems*price*100)/100;
  for(const [key,expected] of Object.entries({BoxQuantity:boxes,SteamQuantity:stems,SteamOf1Box:30,OutQuantity:boxes,EstQuantity:stems,UPrice:price,TPrice:amount}))assert(row[key]===expected,`REPAIR_PROTECTED_${key}`);
  for(const [key,expected] of Object.entries({BoxQuantity:boxes,StemQuantity:stems,UnitPrice:price,LineAmount:amount}))assert(line[key]===expected,`REPAIR_SOURCE_${key}`);
  const next={...row},changes={};
  const code=String(index+1);
  assert(row.OrderCode==null||row.OrderCode===''||row.OrderCode===code,'REPAIR_EXISTING_CODE');
  if(row.OrderCode==null||row.OrderCode==='')changes.OrderCode=next.OrderCode=code;
  for(const [key,expected] of Object.entries({BunchQuantity:stems,SteamOf1Bunch:1})){
   assert(row[key]==null||row[key]===expected,`REPAIR_EXISTING_${key}`);
   if(row[key]==null)changes[key]=next[key]=expected;
  }
  return {before:row,after:next,changes};
 });
}
