import assert from 'node:assert/strict';
import {parseOptions,prepareSafeInput,loadDatabaseEnvironment,importSafe} from '../scripts/ecount-workspace-import-safe.mjs';
import menus from '../data/ecount-workbench/source-menu.json' with {type:'json'};
const menu=menus.menus.find(item=>item.program==='E040202');
const options=parseOptions(['--file','synthetic.json','--dataset','quote','--menu-id',menu.id,'--period-from','2026-10-01','--period-to','2026-10-31','--env-file','synthetic.env']);
assert.throws(()=>parseOptions(['--file','a','--file','b']));
assert.throws(()=>parseOptions(['--password','never-load']));
const input=prepareSafeInput(options,{rows:[{refDate:'2026/10/20 -1',estimateTotal:'12,300',custName:'SYNTHETIC_MUST_DROP',account:'SYNTHETIC_MUST_DROP'}]});
assert(!JSON.stringify(input).includes('SYNTHETIC_MUST_DROP'));
assert.throws(()=>prepareSafeInput(options,[]));
assert.throws(()=>prepareSafeInput({...options,'period-from':'2026-11-01'},[{estimateTotal:'1'}]));
assert.throws(()=>prepareSafeInput(options,[{estimateTotal:'not-a-number'}]));
const env={};loadDatabaseEnvironment('DB_SERVER=synthetic\nDB_PASSWORD="synthetic"\nAUTH_SECRET=never-load\nPATH=never-load',env);assert.deepEqual(Object.keys(env).sort(),['DB_PASSWORD','DB_SERVER']);
function mock(){let revision=0,version=null,writes=0;return {get writes(){return writes;},activeAdmin:async user=>user.userId==='nenovaSS3',installed:async()=>true,readWorkspace:async()=>({revision,version}),saveVersion:async body=>{assert.equal(body.action,'import');assert.equal(body.expectedRevision,revision);assert(!JSON.stringify(body).includes('SYNTHETIC_MUST_DROP'));if(version)return {revision,versionId:version.versionId,idempotent:true};writes++;revision++;version={versionId:'00000000-0000-0000-0000-000000000001',periodFrom:body.periodFrom,periodTo:body.periodTo,rows:body.rows};return {revision,versionId:version.versionId,idempotent:false};}};}
const store=mock();assert.deepEqual(await importSafe(input,store),{count:1,revision:1,readback:true,idempotent:true});assert.equal(store.writes,1);
const purchaseInput=prepareSafeInput({...options,dataset:'purchase','menu-id':menus.menus.find(item=>item.program==='E040304').id},[{refDate:'2026/10/20 -1',amountTotal:'100000000000000000.00000001',foreignTotal:'1.00000000',exchangeRate:'1300',custName:'SYNTHETIC_MUST_DROP'}]);
const statusInput=prepareSafeInput({...options,dataset:'buyStatus','menu-id':'MENUTREE_000583'},[{refDate:'2026/10/20 -1',qty:'1.00000001',total:'100000000000000000.00000001',invoiceNumber:'SYNTHETIC_MUST_DROP'}]);
assert.equal(statusInput.menuId,'MENUTREE_000513');assert.deepEqual(await importSafe(statusInput,mock()),{count:1,revision:1,readback:true,idempotent:true});
for(const [dataset,program,key]of [['journal','E010701','amount'],['saleQuery','E040206','amount'],['poQuery','E040302','orderTotal'],['receipt','E040217','amount'],['payment','E040310','amount']]){const prepared=prepareSafeInput({...options,dataset,'menu-id':menus.menus.find(m=>m.program===program).id},[{refDate:'2026/10/20 -1',[key]:'100000000000000000.00000001',memo:'SYNTHETIC_MUST_DROP'}]);assert.deepEqual(await importSafe(prepared,mock()),{count:1,revision:1,readback:true,idempotent:true});}
const discountOptions={...options,dataset:'discount','menu-id':menus.menus.find(m=>m.program==='E040216').id};assert.throws(()=>prepareSafeInput(discountOptions,[]),/EMPTY_IMPORT/);assert.throws(()=>prepareSafeInput(discountOptions,[{salesAmount:'1'}]),/IMPORT_NOT_VERIFIED/);
assert.throws(()=>prepareSafeInput({...discountOptions,dataset:'buyDisc','menu-id':'MENUTREE_000518'},[{purchaseAmount:'1'}]),/IMPORT_NOT_VERIFIED/);
const purchaseStore=mock();assert.deepEqual(await importSafe(purchaseInput,purchaseStore),{count:1,revision:1,readback:true,idempotent:true});assert.equal(purchaseStore.writes,1);
await assert.rejects(importSafe(input,{...mock(),activeAdmin:async()=>false}),/ACTIVE_ADMIN_REQUIRED/);
const bad=mock();const read=bad.readWorkspace;let reads=0;bad.readWorkspace=async()=>{const value=await read();if(++reads>1)return {...value,version:{...value.version,rows:[{estimateTotal:'999'}]}};return value;};await assert.rejects(importSafe(input,bad),/READBACK_CONTENT_MISMATCH/);
console.log('PASS safe import CLI: args, privacy projection, DB-only environment, authorization, readback hash, idempotency; no SQL executed');
