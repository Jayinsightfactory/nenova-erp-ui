import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {farmRegistrationInput,registerFarmMaster} from '../lib/farmMasterRegistration.js';
const input={farmName:'New Demo',counKey:1,confirmed:true},types={Int:'int',NVarChar:'text'};
function fixture(existing=[]){const calls=[];return {calls,query:async(q,p)=>{calls.push(q);if(q.includes('FROM dbo.Country'))return {recordset:[{CounKey:1,CounName:'콜롬비아'}]};if(q.includes('FROM dbo.Farm'))return {recordset:existing};return {recordset:[{FarmKey:51,FarmName:p.name.value,FarmCode:p.code.value,CounKey:p.country.value}]};}};}
test('explicit registration writes only native Farm columns and DB identity, never receipt or stock',async()=>{
 for(const year of ['2025','2026']){const f=fixture(),r=await registerFarmMaster(f.query,types,{...input,orderYear:year},'fixture');assert.equal(r.created,true);assert.equal(r.farm.FarmKey,51);assert.match(f.calls[1],/UPDLOCK,HOLDLOCK/);assert.match(f.calls[2],/OUTPUT INSERTED.FarmKey/);assert.doesNotMatch(f.calls.join('\n'),/Warehouse|Stock|OrderMaster|Shipment|Estimate|WebProfitReport|MAX\(/);}
});
test('exact retry returns existing, equivalent or deleted names and existing code reject duplicate',async()=>{
 const f=fixture([{FarmKey:41,FarmName:'New Demo',CounKey:1,isDeleted:false}]);assert.equal((await registerFarmMaster(f.query,types,input,'fixture')).created,false);assert.equal(f.calls.length,2);
 for(const existing of [[{FarmName:'CI FLORES NEW DEMO SAS',CounKey:1}],[{FarmName:'New Demo',CounKey:1,isDeleted:true}],[{FarmName:'Other',FarmCode:'A',CounKey:2}],[{FarmName:'New Demo',CounKey:2}],[{FarmName:'New Demo',CounKey:1},{FarmName:'New Demo',CounKey:2}],[{FarmName:'Native collated spelling',CounKey:2,NativeNameMatch:1}]]){const f=fixture(existing);await assert.rejects(registerFarmMaster(f.query,types,{...input,farmCode:'A'},'fixture'),e=>e.status===409);assert.equal(f.calls.length,2);}
});
test('invalid or non-explicit request fails before SQL, including missing/zero/foreign type country',()=>{
 for(const body of [null,[],{},{...input,confirmed:false},{...input,counKey:0},{...input,counKey:'1'},{...input,farmName:''},{...input,farmName:'a\nB'},{...input,farmCode:false},{...input,farmName:'a'.repeat(101)},{...input,farmCode:'a'.repeat(21)}])assert.throws(()=>farmRegistrationInput(body));
});
test('actual registration handler enforces active import roles before transaction',async()=>{
 const userSource=fs.readFileSync('lib/userAccess.js','utf8').replace(/export /g,''),ua=new Function(userSource+';return {hasFullWebAccess,isAdminUser};')();
 const access=new Function(...Object.keys(ua),fs.readFileSync('lib/invoiceReceiptAccess.js','utf8').replace(/^import .*;\s*$/gm,'').replace(/export /g,'')+';return canManageInvoiceReceipt;')(...Object.values(ua));
 const source=fs.readFileSync('pages/api/master/farms.js','utf8').replace(/^import .*;\s*$/gm,'').replace(/^export default .*;\s*$/gm,'').replace(/export /g,'');
 const create=new Function('withTransaction','sql','canManageInvoiceReceipt','farmRegistrationInput','registerFarmMaster',source+';return createFarmRegistrationHandler;')(()=>assert.fail(),types,access,farmRegistrationInput,registerFarmMaster);
 for(const user of [{},{userId:'x',authority:6},{userId:'x',authority:4,accountActive:false},{userId:'x',authority:7,isDeleted:true}]){let tx=0;const handler=create({transaction:async()=>{tx++;}}),res={setHeader(){},status(n){this.code=n;return this;},json(v){this.body=v;}};await handler({method:'POST',user,body:input},res);assert.equal(res.code,403);assert.equal(tx,0);}
 const f=fixture(),handler=create({transaction:async fn=>fn(f.query)}),res={setHeader(){},status(n){this.code=n;return this;},json(v){this.body=v;}};await handler({method:'POST',user:{userId:'x',authority:4},body:input},res);assert.equal(res.code,201);assert.equal(res.body.farm.FarmKey,51);
});
