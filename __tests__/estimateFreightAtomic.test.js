import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeFreightRequest, freightOperationId } from '../lib/estimateFreightAtomic.js';
import { registerFreight } from '../lib/estimateFreightClient.js';
const base=()=>({year:'2026',parentWeek:'38',custKey:515,rows:[{weekShort:'38-01',prodKey:2253,qty:61,cost:3000,shipmentDate:'2026-09-19',combined:true}]});
test('freight final quantity is not an increment and scope is explicit',()=>{
  assert.equal(normalizeFreightRequest(base()).rows[0].qty,61);
  assert.equal(normalizeFreightRequest({...base(),rows:[{...base().rows[0],combined:false}]}).rows[0].combined,false);
});
test('reject invalid defaults, prior year, cross week and duplicate combined entries',()=>{
  for(const key of ['qty','cost']) for(const value of [undefined,null,'',0,false,-1,Infinity,'bad']) {
    const b=base(); b.rows[0][key]=value; assert.throws(()=>normalizeFreightRequest(b));
  }
  for(const patch of [{year:'2025'},{year:''},{custKey:0},{parentWeek:'39'}]) assert.throws(()=>normalizeFreightRequest({...base(),...patch}));
  const duplicate=base();duplicate.rows.push({...duplicate.rows[0],weekShort:'38-02',combined:false});
  assert.throws(()=>normalizeFreightRequest(duplicate),/합산/);
});
test('receipt requires a UUID, not a truthy arbitrary request value',()=>{
  for(const value of ['',null,0,'request']) assert.throws(()=>freightOperationId(value));
  assert.equal(freightOperationId('00000000-0000-4000-8000-000000000001'),'00000000-0000-4000-8000-000000000001');
});
function clientFixture(){
  const data=new Map(),calls=[];
  const storage={getItem:k=>data.get(k),setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)};
  return {data,calls,args:{input:base(),storage,status:()=>{},confirm:async()=>true,uuid:()=> '00000000-0000-4000-8000-000000000001',
    post:async(path,body)=>{calls.push(body);return body.mode==='preview'?{success:true,planHash:'hash',rows:[{week:'38-01',prodName:'운임',oldQty:31,qty:61,oldCost:3000,cost:3000,shipmentDate:'2026-09-17'}]}:{success:true,verified:true,count:1};},get:async()=>({found:false})}};
}
test('client requires preview approval before exactly one apply',async()=>{
  const f=clientFixture();assert((await registerFreight(f.args)).verified);
  assert.deepEqual(f.calls.map(c=>c.mode),['preview','apply']);assert.equal(f.data.size,0);
  const cancel=clientFixture();cancel.args.confirm=async()=>false;
  assert.equal(await registerFreight(cancel.args),null);assert.equal(cancel.calls.length,1);
});
test('lost commit response resolves receipt without another POST',async()=>{
  const f=clientFixture(),post=f.args.post;f.args.post=async(p,b)=>{if(b.mode==='apply'){f.calls.push(b);throw new Error('504');}return post(p,b);};
  f.args.get=async()=>({found:true,result:{success:true,verified:true}});
  assert((await registerFreight(f.args)).verified);assert.equal(f.calls.length,2);assert.equal(f.data.size,0);
});
test('unknown outcome retains operation across reload and reuses it',async()=>{
  const f=clientFixture(),post=f.args.post;
  f.args.post=async(p,b)=>{if(b.mode==='apply'){f.calls.push(b);throw new Error('504');}return post(p,b);};
  await assert.rejects(()=>registerFreight(f.args),/아직 확인/);assert.equal(f.data.size,1);
  const original=f.calls[1].operationId;
  f.args.post=post;
  assert((await registerFreight(f.args)).verified);
  assert.equal(f.calls[2].operationId,original);assert.equal(f.calls[2].mode,'apply');
});
test('known rollback releases pending operation and never reports success',async()=>{
  const f=clientFixture(),post=f.args.post;f.args.post=async(p,b)=>{if(b.mode==='apply'){const e=new Error('실패');e.data={rolledBack:true};throw e;}return post(p,b);};
  await assert.rejects(()=>registerFreight(f.args),/전체 운임 저장이 취소/);assert.equal(f.data.size,0);
});
test('busy retry retains the original operation because another attempt may still commit',async()=>{
  const f=clientFixture(),post=f.args.post;
  f.args.post=async(p,b)=>{if(b.mode==='apply'){const e=new Error('busy');e.data={rolledBack:true,code:'STOCK_GATE_BUSY'};throw e;}return post(p,b);};
  await assert.rejects(()=>registerFreight(f.args),/아직 확인/);
  assert.equal(f.data.size,1);
});
