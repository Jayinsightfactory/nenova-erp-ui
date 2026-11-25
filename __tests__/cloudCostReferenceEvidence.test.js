import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveCloudCostReference} from '../lib/cloudCostReferenceEvidence.js';
import {nativeCostSourceFingerprint} from '../lib/nativeReceiptCostEvidence.js';
import {nativeCostDocument,calculateNativeCost} from '../lib/nativeReceiptCost.js';
import {prepareArrivalWeekCost} from '../lib/arrivalWeekCost.js';

const row={WarehouseKey:990001,OrderYear:'2026',OrderWeek:'47-02',FarmName:'Cloudland',InvoiceNo:'TEST_ONLY-B',FileName:'TEST_ONLY-B.xlsx',InputDate:'2026-11-23',WdetailKey:990002,ProdKey:990003,ProdName:'ORCHID CHINA TEST_ONLY',OutUnit:'송이',SteamQuantity:90,BunchQuantity:null,BoxQuantity:null,OutQuantity:90,UPrice:23,TPrice:2070,CounName:'중국',ProductDeleted:0};
const evidence=()=>({scope:{warehouseKey:row.WarehouseKey,orderYear:row.OrderYear,orderWeek:row.OrderWeek,farmName:row.FarmName,invoiceNo:row.InvoiceNo,fileName:row.FileName},rowCount:1,nativeDigest:nativeCostSourceFingerprint([row]),source:{sha256:'a'.repeat(64),sheet:'TEST_ONLY'},weights:[{kind:'GW',kg:21,cells:'C8'},{kind:'CW',kg:70,cells:'F8'}],exchangeRate:{value:210,currency:'CNY'},freight:{amount:1830,currency:'CNY'},quarantineCount:{value:18},unitConversions:[{key:row.WdetailKey,prodKey:row.ProdKey,from:'송이',to:'BUNCH',quantity:90,amount:2070,cells:'E35:F35'}],financialReviewRequired:true});
test('only exact source association restores independent GW/CW; nearby receipt/year/product/amount remains unresolved',()=>{
 const e=evidence(),resolved=resolveCloudCostReference([row],[e]);assert.equal(resolved.weights[0].kg,21);assert.equal(resolved.weights[1].kg,70);
 const withSpecialRows=[row,
  {...row,WdetailKey:990010,ProdKey:2182,ProdName:'운송료',OutUnit:'박스',BoxQuantity:1,BunchQuantity:1,SteamQuantity:1,OutQuantity:1,UPrice:1830,TPrice:1830},
  {...row,WdetailKey:990011,ProdKey:3100,ProdName:'Gross weight',OutUnit:'송이',BoxQuantity:1,BunchQuantity:1,SteamQuantity:21,OutQuantity:21,UPrice:0,TPrice:0},
  {...row,WdetailKey:990012,ProdKey:3101,ProdName:'Chargeable weight',OutUnit:'송이',BoxQuantity:1,BunchQuantity:1,SteamQuantity:70,OutQuantity:70,UPrice:0,TPrice:0},
 ];
 assert.equal(resolveCloudCostReference(withSpecialRows,[e])?.weights[1].kg,70,'2182/3100/3101 detail rows never break flower nativeDigest');
 for(const patch of [{OrderYear:'2025'},{OrderWeek:'47-01'},{WarehouseKey:990004},{InvoiceNo:'other'},{ProdKey:99},{TPrice:2069},{OutUnit:'단'},{BunchQuantity:90},{GrossWeight:20}])assert.equal(resolveCloudCostReference([{...row,...patch}],[e]),null);
 assert.equal(resolveCloudCostReference([row],[e,e]),null);
 assert.equal(resolveCloudCostReference([row],[{...e,exchangeRate:{value:210,currency:'USD'}}]),null);
});
test('reviewed source-only equivalent quantity leaves original physical units unchanged and fiscal exceptions blocked',()=>{
 const source={warehouseKey:row.WarehouseKey,orderYear:'2026',orderWeek:'47-02',sourceHash:'a'.repeat(64),country:'CN',farmName:'Cloudland',inputDate:'2026-11-23',gw:21,cw:70,cloudReference:evidence(),lines:[{lineId:'11111111-1111-4111-8111-111111111111',wdetailKey:row.WdetailKey,prodKey:row.ProdKey,originalName:row.ProdName,outQuantity:90,outUnit:'송이',bunchQuantity:null,stemQuantity:90,unitPrice:23,lineAmount:2070}]};
 const original=structuredClone(source),d=nativeCostDocument(source,{currency:'CNY',transportMode:'AIR'});
 assert.equal(d.lines[0].outUnit,'BUNCH');assert.equal(d.lines[0].bunchQuantity,90);assert.equal(d.lines[0].nativeOutUnit,'송이');assert.equal(d.lines[0].sourceBunchQuantity,null);assert.deepEqual(source,original);
 assert.throws(()=>calculateNativeCost(source,{sourceHash:source.sourceHash,metadata:{currency:'CNY',transportMode:'AIR'},input:{}}),/확인/);
 assert.equal(d.reviewedMetadata.invoiceCostInput.cloudOrchidPermitNative,'');assert.equal(d.reviewedMetadata.invoiceCostInput.cloudFinancialReviewConfirmed,false);
});
test('missing AWB creates explicit receipt-specific cost scopes; selected order cannot change final scope or merge unrelated receipts',async()=>{
 const rows=[row,{...row,WarehouseKey:990004,WdetailKey:990005,InvoiceNo:'TEST_ONLY-A',FileName:'TEST_ONLY-A.xlsx'}];
 const read=selectedKeys=>prepareArrivalWeekCost({types:{Int:1,NVarChar:n=>n},queryFn:async(sql)=>{assert.doesNotMatch(sql,/\b(INSERT|UPDATE|DELETE|EXEC|MERGE)\b/i);return {recordset:sql.includes('invoice-expenses:')?[]:rows};},request:{country:'CN',orderYear:'2026',orderWeek:'47-02',selectedKeys}});
 const first=await read([990001,990004]),second=await read([990004,990001]);assert.deepEqual(first.awbs,second.awbs);assert.equal(first.awbs.length,2);assert(first.awbs.every(a=>a.scopeType==='RECEIPT'));assert(!first.issues.some(i=>i.code==='AWB_REQUIRED'));
});
