import assert from 'node:assert/strict';
import { invoiceExpenseValues, receiptFreightAmount } from '../lib/invoiceReceiptExpenses.js';
const document={reviewedMetadata:{costInputs:{freight:{amount:321.49,currency:'EUR'},docFee:{amount:50,currency:'EUR'}}}};
const values=invoiceExpenseValues(document);
assert.equal(values.totals.EUR,371.49);
const source={orderYear:'2026',orderWeek:'46-01',warehouseKey:8069,receiptExpenses:{...values,verified:true,orderYear:'2026',orderWeek:'46-01',warehouseKey:8069}};
assert.equal(receiptFreightAmount(source,null),371.49);
assert.equal(receiptFreightAmount(source,371.49),371.49,'do not add both representations');
assert.throws(()=>receiptFreightAmount(source,321.49),/다릅니다/);
for(const patch of [{orderYear:'2025'},{orderWeek:'46-02'},{warehouseKey:1},{verified:false}])
 assert.throws(()=>receiptFreightAmount({...source,receiptExpenses:{...source.receiptExpenses,...patch}},null),/연결/);
assert.equal(receiptFreightAmount({...source,receiptExpenses:{...source.receiptExpenses,entries:[{kind:'freight',currency:'EUR',amount:0}]}},null),0);
assert.equal(receiptFreightAmount({...source,receiptExpenses:null},null),null);
assert.throws(()=>invoiceExpenseValues({reviewedMetadata:{costInputs:{freight:{currency:'EUR',amount:null}}}}),/금액/);
assert.throws(()=>receiptFreightAmount({...source,receiptExpenses:{...source.receiptExpenses,entries:[{kind:'freight',currency:'USD',amount:1}]}},null),/통화/);
console.log('PASS invoice expenses: NL371.49, zero, missing, duplicate, conflict, cross-year/week/key');
