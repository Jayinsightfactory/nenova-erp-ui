import assert from 'node:assert/strict';
import {buildChinaOrderReport, selectChinaOrderSubweek} from '../lib/chinaOrderDownload.js';
import {buildChinaOrderCustomerMatrix} from '../lib/chinaOrderCustomerMatrix.js';
const cycles=[37,38,39,40,41,42,43].map((w,i)=>({year:2026,majorWeek:String(w),key:`2026${w}`,offset:i-3}));
const source=(custKey,prodKey,quantity,extra={})=>({country:'중국',orderYear:2026,orderWeek:'40-01',custKey,custName:`업체${custKey}`,custOrderCode:'CL2',prodKey,prodCode:`00${prodKey}`,prodName:'같은 품목명',flower:'장미',unit:'단',quantity,...extra});
const all=buildChinaOrderReport({success:true,readOnly:true,scope:{year:2026,majorWeek:'40'},cycles,orders:[
 source(1,10,0.1),source(1,10,0.2),source(2,10,2),source(2,11,5),source(1,11,0.5,{unit:'박스'}),
 source(3,10,100,{orderWeek:'40-03A'}),source(4,10,99,{orderYear:2025}),
]});
const selected=selectChinaOrderSubweek(all,'2026/40-01');
const matrix=buildChinaOrderCustomerMatrix(selected);
assert.deepEqual(matrix.customers.map(c=>c.custKey),[1,2]);
assert.deepEqual(matrix.customers.map(c=>c.custOrderCode),['CL2','CL2'],'same CL does not merge actual customers');
assert.equal(matrix.rows.length,3,'different product keys and units remain separate');
const row=matrix.rows.find(r=>r.rowKey==='10|단');
assert.ok(Math.abs(row.total-2.3)<1e-10);
assert.ok(Math.abs(row.quantities['1']-0.3)<1e-10);
assert.equal(row.quantities['2'],2);
assert.equal(matrix.rows.find(r=>r.rowKey==='11|단').quantities['1'],0);
assert.equal(matrix.totals.find(t=>t.unit==='박스').total,0.5);
assert.ok(Math.abs(matrix.totals.find(t=>t.unit==='단').total-7.3)<1e-10);
for(const r of matrix.rows)assert.ok(Math.abs(Object.values(r.quantities).reduce((a,b)=>a+b,0)-r.total)<1e-10);
const filtered=buildChinaOrderCustomerMatrix(selectChinaOrderSubweek(all,'2026/40-01',new Set(['1|10|단'])));
assert.equal(filtered.customers.length,1);assert.equal(filtered.rows.length,1);assert.ok(Math.abs(filtered.rows[0].total-0.3)<1e-10);
const suffix=buildChinaOrderCustomerMatrix(selectChinaOrderSubweek(all,'2026/40-03A'));
assert.equal(suffix.rows[0].total,100);
assert.throws(()=>buildChinaOrderCustomerMatrix(all),/세부차수 하나/);
assert.throws(()=>buildChinaOrderCustomerMatrix({...selected,orders:[...selected.orders,source(1,10,1,{orderYear:2025})]}),/다른 연도/);
assert.throws(()=>buildChinaOrderCustomerMatrix({...selected,orders:[source(1,10,NaN)]}),/양수/);
assert.throws(()=>buildChinaOrderCustomerMatrix({...selected,orders:[source(1,10,0)]}),/양수/);
assert.throws(()=>buildChinaOrderCustomerMatrix({...selected,orders:[source(1,10,1),source(1,11,2,{custOrderCode:'OTHER'})]}),/CL 코드/);
assert.throws(()=>buildChinaOrderCustomerMatrix({...selected,orders:[source(1,10,1,{country:'태국'})]}),/중국 양수/);
const empty=buildChinaOrderCustomerMatrix({...selected,orders:[]});assert.equal(empty.rows.length,0);assert.equal(empty.customers.length,0);
console.log('chinaOrderCustomerMatrix behavioral fixtures passed');
