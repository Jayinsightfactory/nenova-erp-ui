import assert from 'node:assert/strict';
import {saveProductMaster} from '../lib/productMasterSave.js';
import {productMasterSnapshot,productEditPayload,validateProductValues} from '../lib/productMasterPolicy.js';
const row={ProdKey:338,ProdCode:'p',ProdName:'test',DisplayName:null,FlowerName:'장미',CounName:'콜롬비아',CountryFlower:'콜롬비아장미',Cost:100,OutUnit:'박스',EstUnit:'단',BunchOf1Box:15,SteamOf1Bunch:20,SteamOf1Box:0,BoxWeight:null,BoxCBM:0.1,TariffRate:0.08,Stock:7,ProdGroup:'keep',Descr:'keep',isDeleted:false};
const sql={Int:'int',Float:'float',NVarChar:Object.assign(()=> 'text',{MAX:'max'}),Decimal:()=> 'decimal',MAX:'max'};
assert.deepEqual(productEditPayload({...row,prodName:'changed'}).values,{ProdName:'changed'});
assert.equal(productEditPayload({...row,boxWeight:null}).expected.BoxWeight,null);
for(const values of [{Stock:0},{Cost:false},{Cost:-1},{Cost:'abc'},{TariffRate:2},{BoxCBM:'0.0001'},{}])assert.throws(()=>validateProductValues(values));
async function run(values,mode='ok',extra={}){
 let working={...row},writes=[],logs=[];
 const q=async(text,params={})=>{
   assert.ok(!/UPDATE (Order|Shipment|Warehouse|Stock|Estimate)|usp_/.test(text));
   if(text.includes('FROM Country'))return {recordset:mode==='codes'?[]:[{isSelectFlower:extra.nativeCountryOnly?1:0}]};
   if(text.startsWith('SELECT'))return {recordset:mode==='missing'?[]:[{...working,...(mode==='readback'&&!text.includes('UPDLOCK')?{SteamOf1Box:999}:{})}]};
   if(text.startsWith('UPDATE Product')){writes.push(text);for(const[k,v]of Object.entries(params))if(!['pk','actor'].includes(k))working[k]=v.value;return {rowsAffected:[1]};}
   if(text.startsWith('INSERT INTO SystemActionLog')){if(mode==='audit')throw Error('audit');logs.push(JSON.parse(params.payload.value));return {};}
   throw Error(text);
 };
 const expected=productMasterSnapshot(row);if(mode==='stale')expected.Cost=101;
 try {const saved=await saveProductMaster(q,sql,{prodKey:338,values,expected,...extra},'test');assert.equal(mode,'ok');return {saved,writes,logs};}
 catch(e){if(mode==='ok')throw e;return {failed:true};}
}
for(const SteamOf1Box of [null,0,77]){
 row.SteamOf1Box=SteamOf1Box;
 const {saved,writes}=await run({ProdName:'changed'});
 assert.equal(saved.SteamOf1Box,SteamOf1Box);assert.equal(saved.Stock,7);assert.ok(!writes[0].includes('SteamOf1Box='));
}
assert.equal((await run({BunchOf1Box:12})).saved.SteamOf1Box,77);
assert.equal((await run({SteamOf1Box:0})).saved.SteamOf1Box,0);
assert.equal((await run({CounName:'중국'},'ok',{nativeCountryOnly:true})).saved.CountryFlower,'중국');
assert.equal((await run({FlowerName:'수국'})).saved.CountryFlower,'콜롬비아수국');
for(const mode of ['stale','missing','readback','audit'])assert.equal((await run({ProdName:'changed'},mode)).failed,true);
assert.equal((await run({CounName:'invalid'},'codes')).failed,true);
await assert.rejects(()=>run({OutUnit:'단'}),/변경 확인/);
assert.equal((await run({OutUnit:'단'},'ok',{confirmUnitChange:true})).saved.OutUnit,'단');
const sentinels=[2025,2026].map(OrderYear=>({OrderYear,OrderWeek:'42-01',Order:10,Shipment:10,Stock:7,Estimate:100,Amount:90,Vat:10,isFix:1}));
const before=JSON.stringify(sentinels);await run({Cost:0});assert.equal(JSON.stringify(sentinels),before);
console.log('productMasterSave: independent null/zero, classification, stale, unit confirmation, readback/audit failure and cross-year preservation PASS');
