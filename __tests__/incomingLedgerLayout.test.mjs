import test from 'node:test';
import assert from 'node:assert/strict';
import { incomingColumnWidth, incomingQuantityWidth, incomingRowKind } from '../lib/incomingLedgerLayout.js';
import { readLatestArrivalResponse } from '../lib/latestArrivalResponse.js';
const format=value=>Number(value||0).toLocaleString('ko-KR');

test('incoming widths honor search minimum and grow for actual numbers, subtotal and box suggestion', ()=>{
  assert.equal(incomingColumnWidth(['47-02.A'],{min:132}),132);
  assert.equal(incomingColumnWidth(['최대값'.repeat(30)],{max:280}),280);
  const rows=[{n:992},{n:999},{n:9973}];
  const width=incomingQuantityWidth(rows,'n',format,{label:'송이'});
  assert.equal(width,incomingColumnWidth(['11,964','송이']));
  assert(incomingQuantityWidth([{n:null}],'n',format,{label:'박스',suggestion:()=> '1,234 참고'})>incomingQuantityWidth([{n:1}],'n',format,{label:'박스'}));
  assert.equal(incomingRowKind({ProdKey:2182}),'freight');
  assert.equal(incomingRowKind({ProdKey:3100}),'weight');
  assert.equal(incomingRowKind({IsWeightRow:true}),'weight');
  assert.equal(incomingRowKind({ProdKey:2201}),'goods');
});

test('HTML, login redirects, and invalid JSON produce a stable readable cost status',async()=>{
  const html=new Response('<html>gateway</html>',{status:502,headers:{'Content-Type':'text/html'}});
  await assert.rejects(()=>readLatestArrivalResponse(html),{message:'최신 원가를 불러오지 못했습니다.'});
  const invalid=new Response('<html>',{status:200,headers:{'Content-Type':'application/json'}});
  await assert.rejects(()=>readLatestArrivalResponse(invalid),{message:'최신 원가를 불러오지 못했습니다.'});
  const auth=new Response('<!-- login -->',{status:401,headers:{'Content-Type':'text/html'}});
  await assert.rejects(()=>readLatestArrivalResponse(auth),{message:'로그인을 확인한 뒤 최신 원가를 다시 조회하세요.'});
  const valid=Response.json({success:true,references:{'1|':[{cost:42}]}});
  assert.deepEqual(await readLatestArrivalResponse(valid),{'1|':[{cost:42}]});
});
