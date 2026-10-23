import assert from 'node:assert/strict';
import {productColorDescription,productColorLabel,saveProductColor} from '../lib/productColor.js';
for(const color of ['핑크','블루','blue','연보라'])assert.equal(productColorLabel(productColorDescription('설명 보존',color)),color);
for(const color of ['12cm','MOq 20','pink 123'])assert.throws(()=>productColorDescription(null,color));
assert.equal(productColorDescription(null,'핑크'),'핑크');
assert.equal(productColorDescription('화이트 / 60cm / 설명','레드'),'레드 / 60cm / 설명');
assert.equal(productColorDescription('설명 보존','레드'),'레드 / 설명 보존');
assert.equal(productColorDescription('white／keep','blue'),'blue／keep');
for(const color of ['',false,'a/b','a\nb','x'.repeat(41)])assert.throws(()=>productColorDescription(null,color));
assert.throws(()=>productColorDescription('x'.repeat(200),'핑크'));
const sql={Int:'int',NVarChar:Object.assign(()=> 'text',{MAX:'max'}),MAX:'max'};
async function fixture(mode='ok'){
  const before={ProdKey:1,ProdName:'test',Descr:'화이트 / 설명',Stock:0,Cost:0,OutUnit:'박스',isDeleted:0};
  const ledgers=[2025,2026].map(OrderYear=>({OrderYear,OrderWeek:'43-01',Qty:3,Amount:100,Vat:10,isFix:1}));
  const original=JSON.stringify(ledgers);let row={...before},audits=0;
  const q=async(text,params={})=>{
    if(text.startsWith('SELECT'))return {recordset:mode==='deleted'?[]:[{...row,...(mode==='readback'&&!text.includes('UPDLOCK')?{Stock:99}:{})}]};
    if(text.startsWith('UPDATE Product')){assert.ok(!text.includes('Stock='));row.Descr=params.descr.value;return {};}
    if(text.startsWith('INSERT INTO SystemActionLog')){if(mode==='audit')throw Error('audit failure');audits++;return {};}
    throw Error('Unexpected SQL');
  };
  try{await saveProductColor(q,sql,{prodKey:1,expectedDescr:mode==='stale'?null:before.Descr,color:'블루'},'test');assert.equal(mode,'ok');assert.equal(row.Descr,'블루 / 설명');assert.equal(audits,1);}
  catch(e){row={...before};assert.notEqual(mode,'ok');assert.equal(row.Descr,before.Descr);}
  assert.equal(JSON.stringify(ledgers),original);
}
for(const mode of ['ok','deleted','stale','readback','audit'])await fixture(mode);
await assert.rejects(()=>saveProductColor(()=>{},sql,{prodKey:0},'test'));
console.log('product color: prefix preservation, validation, stale/deleted, readback/audit failure, cross-year ledgers PASS');
