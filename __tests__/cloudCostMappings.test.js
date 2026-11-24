import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {cloudLineCategory,cloudCostPreview} from '../lib/chinaCloudCost.js';
import {CLOUD_MAPPING_KEY,validateCloudMappingValue,applyCloudMappings} from '../lib/cloudCostMappings.js';
import {readImportTeamRecord,writeImportTeamRecord} from '../lib/importTeamStore.js';
import {createCloudCostMappingHandler} from '../lib/cloudCostMappingHttp.js';

const custom={label:'원문 직접분류',bunchesPerBox:20,length:100,width:30,height:20,tariffRate:.032,weightMode:'VOLUME'};
const entry={country:'CN',farm:'CLOUDLAND',prodKey:12,categoryCode:10,categoryOverride:custom};
test('complete direct category changes actual freight/tariff; invalid and partial drafts cannot calculate or save',()=>{
 const resolved=cloudLineCategory(entry);assert.equal(resolved.volumeKgPerBunch,.5);assert.equal(resolved.tariffRate,.032);
 for(const patch of [{label:''},{tariffRate:' '},{tariffRate:true},{tariffRate:21.4},{length:-1},{width:''},{bunchesPerBox:0},{weightMode:'GUESS'},{extra:1}]){
  const value={...entry,categoryOverride:{...custom,...patch}};assert.equal(cloudLineCategory(value),null);assert.throws(()=>validateCloudMappingValue({version:1,entries:[value]}));
 }
 const issues=[],rows=[{lineId:'a',prodKey:12,unit:'BUNCH',actualQuantity:20,bunchQuantity:20,lineAmount:40}];
 const result=cloudCostPreview({reviewedMetadata:{country:'CN',transportMode:'AIR',farmName:'Cloudland'}},rows,{customsTotalKRW:100,lineInputs:[{lineId:'a',...entry}]},{nativeCurrency:'CNY',freightCurrency:'CNY',exchangeRate:210,effectiveFreightAmount:10},issues);
 assert.deepEqual(issues,[]);assert.equal(result.lines[0].componentAmounts.tariffKRW,50*210*.032);
 assert.equal(result.lines[0].componentAmounts.volumeWeightKg,10);
 for(const patch of [{country:'CO'},{farm:'HUBFRESH'},{prodKey:0},{categoryCode:'10'}])assert.throws(()=>validateCloudMappingValue({version:1,entries:[{...entry,...patch}]}));
 const source={lines:[{lineId:'a',prodKey:12}],reviewedMetadata:{country:'CN',farmName:'Cloudland',invoiceCostInput:{lineInputs:[{lineId:'a'}]}}};
 const mapped=applyCloudMappings(source,{entries:[entry]});assert.equal(mapped.reviewedMetadata.invoiceCostInput.lineInputs[0].categoryOverride.tariffRate,.032);
 assert.equal(applyCloudMappings({...source,reviewedMetadata:{...source.reviewedMetadata,country:'CO'}},{entries:[entry]}).reviewedMetadata.invoiceCostInput.lineInputs[0].categoryCode,undefined);
});

test('two users share persisted matching; stale concurrent editor cannot overwrite and API enforces receipt/product access',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'cloud-cost-map-test-'));
 const read=key=>readImportTeamRecord(key,{root}),write=(key,request)=>writeImportTeamRecord(key,request,{root});
 try{
  const handler=createCloudCostMappingHandler({authorize:u=>u.authority===1,readRecord:read,writeRecord:write,readSource:async({input})=>{
   if(input.orderYear!=='2026'||input.orderWeek!=='47-02'||input.warehouseKey!==1)throw Object.assign(Error('scope mismatch'),{statusCode:400});
   return {country:'CN',farmName:'Cloudland',lines:[{prodKey:12,productDeleted:0}]};
  }});
  const request=async(body,user={userId:'fixture-a',authority:1})=>{let result;const res={setHeader(){},status(n){this.code=n;return this;},json(value){result={status:this.code??200,...value};return result;}};await handler({method:'POST',body,user},res);return result;};
  const body={orderYear:'2026',orderWeek:'47-02',warehouseKeys:[1],expectedRevision:0,entries:[entry]};
  assert.equal((await request(body,{userId:'fixture-denied',authority:0})).status,403);
  assert.equal((await request({...body,orderYear:'2025'})).status,400);
  assert.equal((await request({...body,entries:[{...entry,prodKey:13}]})).status,400);
  const result=await request(body);assert.equal(result.revision,1);assert.equal(result.persisted,true);
  const otherUserRead=await read(CLOUD_MAPPING_KEY);assert.deepEqual(otherUserRead.value.entries,[entry]);
  const conflict=await request({...body,entries:[{...entry,categoryCode:1}]},{userId:'fixture-b',authority:1});assert.equal(conflict.status,409);
  assert.deepEqual((await read(CLOUD_MAPPING_KEY)).value.entries,[entry]);
  assert.equal((await request({...body,expectedRevision:1,entries:[{...entry,categoryOverride:null}]},{userId:'fixture-b',authority:1})).revision,2);
 }finally{assert.equal(path.dirname(root),path.resolve(os.tmpdir()));assert(path.basename(root).startsWith('cloud-cost-map-test-'));await fs.rm(root,{recursive:true});}
});
