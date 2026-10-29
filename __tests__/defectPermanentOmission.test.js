import assert from 'node:assert/strict';
import {omissionSql}from '../lib/defectPermanentOmission.js';
import {defectSourceReview}from '../lib/salesDefectAutoSource.js';
import {permanentlyOmitDeductions,filterPermanentlyOmittedRows}from '../lib/salesDefectDeductions.js';
assert.throws(()=>omissionSql('x;DELETE'));
assert.equal(defectSourceReview({PermanentOmitted:true}).code,'PERMANENT_OMITTED');
const row={DeductionKey:1,OrderYear:2026,OrderWeek:'43',CustKey:2,ProdKey:3,Quantity:5,SourceUnit:'단',RowVersionNo:2,Status:'DRAFT'};
const input={year:2026,week:44,rows:[{deductionKey:1,expectedRowVersionNo:2}],user:{authority:0,userId:'test'}};
let writes=0;const query=async(q,p)=>{if(/FROM WebSalesDefectDeduction d/.test(q))return{recordset:[row]};if(/INSERT INTO WebSalesDefectDeductionHistory/.test(q)){writes++;const a=JSON.parse(p.after.value);assert.equal(a.orderWeek,'43');assert.equal(a.quantity,5);return{rowsAffected:[1]};}throw Error('unexpected write/query');};
await permanentlyOmitDeductions(input,{transaction:fn=>fn(query)});assert.equal(writes,1);
await assert.rejects(permanentlyOmitDeductions({...input,rows:[{deductionKey:1,expectedRowVersionNo:1}]},{transaction:fn=>fn(query)}));
row.EstimateKey=99;await assert.rejects(permanentlyOmitDeductions(input,{transaction:fn=>fn(query)}));assert.equal(writes,1);
console.log('permanent omission: audit only, stale/live preservation and review block passed');

const incoming={custKey:2,prodKey:3,customerName:'가상',productName:'품목',quantity:5,sourceUnit:'단'};
for(const [year,week,quantity,excluded]of [[2026,43,5,1],[2026,44,5,0],[2026,43,6,0],[2027,43,5,0]]){
 const result=await filterPermanentlyOmittedRows({year,week,rows:[{...incoming,quantity}]},async(q,p)=>({recordset:p.year.value===2026&&p.week.value==='43'&&p.qty.value===5?[{Omitted:1}]:[]}));
 assert.equal(result.excludedCount,excluded);assert.equal(result.rows.length,1-excluded);
}
