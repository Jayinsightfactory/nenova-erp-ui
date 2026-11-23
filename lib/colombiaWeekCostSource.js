import {createHash} from 'node:crypto';
import {isFreightItem} from './freightCalc.js';
import {baseCountry} from './countryClassification.js';
import {nativeLineId} from './nativeReceiptCost.js';
import {suggestGroup} from './nativeSharedCost.js';
import {coReceiptCostPrice} from './coOriginalCostInputs.js';
import {normalizeColombiaCostAwb} from './colombiaWeekCost.js';
const fail=(code,message,statusCode=422)=>{throw Object.assign(Error(message),{code,statusCode});};
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const isCo=row=>baseCountry(row.CounName)==='콜롬비아';
const validAwb=awb=>/^\d{11}$/.test(awb);
export const COLOMBIA_WEEK_SOURCE_SQL=`/* colombia-week-cost:SELECT-only */ SELECT TOP (10001)
 wm.WarehouseKey,wm.OrderYear,wm.OrderWeek,wm.OrderNo,wm.FarmName,wm.InvoiceNo,wm.FileName,
 CONVERT(nvarchar(10),wm.InputDate,23) InputDate,wm.GrossWeight,wm.ChargeableWeight,wm.FreightRateUSD,wm.DocFeeUSD,
 wd.WdetailKey,wd.ProdKey,wd.OrderCode,wd.BoxQuantity,wd.BunchQuantity,wd.SteamQuantity,wd.OutQuantity,
 wd.UPrice,wd.TPrice,wd.SteamOf1Bunch,wd.SteamOf1Box,p.ProdName,p.CounName,p.FlowerName,p.OutUnit,p.TariffRate,p.isDeleted ProductDeleted
 FROM dbo.WarehouseMaster wm JOIN dbo.WarehouseDetail wd ON wd.WarehouseKey=wm.WarehouseKey
 LEFT JOIN dbo.Product p ON p.ProdKey=wd.ProdKey
 WHERE wm.OrderYear=@orderYear AND wm.OrderWeek=@orderWeek AND ISNULL(wm.isDeleted,0)=0
 ORDER BY wm.WarehouseKey,wd.WdetailKey`;

export async function prepareColombiaWeekCost({queryFn,types,request}){
 const {orderYear,orderWeek,country}=request??{};
 if(country!=='CO'||typeof orderYear!=='string'||!/^\d{4}$/.test(orderYear)||typeof orderWeek!=='string'||!/^(?:0[1-9]|[1-4]\d|5[0-3])-(?:0[1-9]|[1-9]\d)$/.test(orderWeek))fail('WEEK_SCOPE_INVALID','콜롬비아 연도·세부차수를 선택하세요.',400);
 const result=await queryFn(COLOMBIA_WEEK_SOURCE_SQL,{orderYear:{type:types.NVarChar(4),value:orderYear},orderWeek:{type:types.NVarChar(5),value:orderWeek}});
 if(!Array.isArray(result.recordset))fail('WEEK_SOURCE_UNAVAILABLE','입고 전체 조회 결과를 확인하지 못했습니다.',503);
 if(result.recordset.length>10000)fail('WEEK_SOURCE_TOO_LARGE','입고 전체를 읽지 못해 계산하지 않았습니다.');
 const allRaw=result.recordset;
 const selected=request.selectedKeys;
 const raw=selected?allRaw.filter(row=>selected.includes(row.WarehouseKey)):allRaw;
 if(raw.some(row=>String(row.OrderYear)!==orderYear||row.OrderWeek!==orderWeek))fail('WEEK_SOURCE_SCOPE_MISMATCH','조회된 입고의 연도·차수가 다릅니다.',409);
 const coKeys=new Set(raw.filter(isCo).map(row=>row.WarehouseKey));
 const knownAwbs=new Set(raw.filter(row=>coKeys.has(row.WarehouseKey)).map(row=>normalizeColombiaCostAwb(row.OrderNo)).filter(validAwb));
 const relevant=raw.filter(row=>coKeys.has(row.WarehouseKey)||knownAwbs.has(normalizeColombiaCostAwb(row.OrderNo)));
 const receipts=new Map(),seen=new Set();
 for(const row of relevant){
  if(!Number.isSafeInteger(row.WarehouseKey)||!Number.isSafeInteger(row.WdetailKey)||seen.has(row.WdetailKey))fail('WEEK_SOURCE_DUPLICATE','입고 상세 식별값이 중복되거나 없습니다.');
  seen.add(row.WdetailKey);if(!receipts.has(row.WarehouseKey))receipts.set(row.WarehouseKey,[]);receipts.get(row.WarehouseKey).push(row);
 }
 const issues=[],excluded=[],members=[],documents=[],lineChoices=new Map();
 for(const choice of request.lineInputs??[]){if(!choice?.lineId||lineChoices.has(choice.lineId))fail('WEEK_LINE_CHOICE_DUPLICATE','품종 확인행이 중복되었습니다.');lineChoices.set(choice.lineId,choice);}
 const assignments=new Map();
 for(const assignment of request.awbAssignments??[]){if(!assignment?.warehouseKey||assignments.has(assignment.warehouseKey))fail('WEEK_AWB_CHOICE_DUPLICATE','AWB 귀속 확인이 중복되었습니다.');assignments.set(assignment.warehouseKey,assignment);}
 for(const [warehouseKey,rows] of receipts){
  const head=rows[0],nativeAwb=normalizeColombiaCostAwb(head.OrderNo),assignment=assignments.get(warehouseKey);
  let awb=nativeAwb;
  if(assignment){
   if(validAwb(nativeAwb))fail('WEEK_AWB_OVERRIDE_FORBIDDEN','유효한 원장 AWB는 임의로 바꾸지 않습니다.');
   if(assignment.confirmed!==true||typeof assignment.sourceId!=='string'||!assignment.sourceId.trim()||!validAwb(normalizeColombiaCostAwb(assignment.awb)))fail('WEEK_AWB_EVIDENCE_REQUIRED','모호한 입고의 AWB 근거를 확인하세요.');
   awb=normalizeColombiaCostAwb(assignment.awb);assignments.delete(warehouseKey);
  }
  const goods=rows.filter(row=>!isFreightItem(row.ProdName));
  for(const row of rows.filter(row=>isFreightItem(row.ProdName)))excluded.push({warehouseKey,wdetailKey:row.WdetailKey,awb,name:row.ProdName,quantity:row.OutQuantity,amount:row.TPrice,reason:'NON_GOODS_COST_REFERENCE'});
  const foreign=goods.filter(row=>!isCo(row));
  if(!goods.some(isCo)){if(foreign.length)for(const row of foreign)issues.push({code:'AWB_FOREIGN_GOODS_REVIEW',warehouseKey,wdetailKey:row.WdetailKey,awb,message:'같은 AWB에 타국 또는 국가 미확인 상품이 있어 운임 귀속 확인이 필요합니다.'});continue;}
  if(!validAwb(awb))issues.push({code:'RECEIPT_AWB_REQUIRED',warehouseKey,message:'입고 AWB 귀속을 확인하세요.'});
  if(!String(head.FarmName??'').trim()||!String(head.InvoiceNo??'').trim())issues.push({code:'RECEIPT_IDENTITY_REQUIRED',warehouseKey,message:'원장 농장·인보이스 식별값이 없습니다.'});
  const memberRows=[],settings=[];
  for(const row of goods){
   const lineId=nativeLineId([warehouseKey,row.WdetailKey]),choice=lineChoices.get(lineId);lineChoices.delete(lineId);
   if(!isCo(row))issues.push({code:'RECEIPT_COUNTRY_REVIEW',warehouseKey,wdetailKey:row.WdetailKey,awb,message:'원산지 미확인 또는 타국 상품행입니다.'});
   const groupId=choice?.groupId??suggestGroup(row.FlowerName,row.ProdName);
   if(!groupId)issues.push({code:'LINE_GROUP_REQUIRED',warehouseKey,wdetailKey:row.WdetailKey,lineId,message:'품종 귀속이 모호한 행만 확인하세요.'});
   const source={lineId,lineNo:memberRows.length+1,wdetailKey:row.WdetailKey,prodKey:row.ProdKey,originalName:row.ProdName,flowerName:row.FlowerName,
    actualQuantity:row.SteamQuantity,stemQuantity:row.SteamQuantity,boxQuantity:row.BoxQuantity,bunchQuantity:row.BunchQuantity,unit:'STEM',currency:'USD',priceUnit:'송이',
    unitPrice:row.UPrice,lineAmount:row.TPrice,stemsPerBunch:row.SteamOf1Bunch,stemsPerBox:row.SteamOf1Box};
   memberRows.push(coReceiptCostPrice(source));settings.push({lineId,groupId,tariffRate:0,stemsPerBunch:row.SteamOf1Bunch,bunchesPerBox:row.SteamOf1Bunch>0&&row.SteamOf1Box>0?row.SteamOf1Box/row.SteamOf1Bunch:null});
  }
  const sourceHash=hash(rows),member={documentId:`native-${warehouseKey}`,warehouseKey,revision:1,sourceHash,orderYear,orderWeek,country:'CO',currency:'USD',awb,farmName:head.FarmName,invoiceNo:head.InvoiceNo,rows:memberRows,lineInputs:settings};
  members.push(member);documents.push({documentId:member.documentId,revision:1,sourceHash,orderYear,orderWeek,invoiceNo:head.InvoiceNo,warehouseKey,reviewedMetadata:{country:'CO',transportMode:'AIR',awb,farmName:head.FarmName,inputDate:head.InputDate},receiptLines:memberRows,lines:memberRows});
 }
 if(lineChoices.size||assignments.size)fail('WEEK_CHOICE_OUT_OF_SCOPE','현재 범위에 없는 입고·행 확인이 포함되어 있습니다.');
 const scope={country,orderYear,orderWeek};
 const awbs=[...new Set(members.map(member=>member.awb))].sort().map(awb=>{
  const group=members.filter(member=>member.awb===awb);
  return {awb,manifest:{orderYear,orderWeek,awb,currency:'USD',members:group.map(({documentId,revision,sourceHash})=>({documentId,revision,sourceHash}))},members:group,
   headerEvidence:relevant.filter(row=>group.some(member=>member.warehouseKey===row.WarehouseKey)).filter((row,index,all)=>all.findIndex(other=>other.WarehouseKey===row.WarehouseKey)===index).map(row=>({warehouseKey:row.WarehouseKey,gw:row.GrossWeight,cw:row.ChargeableWeight,freightRate:row.FreightRateUSD,docFee:row.DocFeeUSD}))};
 });
 return {scope,awbs,members,documents,issues,excluded,baselineDigest:hash({scope,relevant}),status:issues.length?'REVIEW_REQUIRED':'SOURCE_READY'};
}
