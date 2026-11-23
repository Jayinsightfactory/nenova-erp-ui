import test from 'node:test';
import assert from 'node:assert/strict';
import {receiptComparisonFocus,receiptComparisonValues,receiptQuantityEvidence,uniqueReceiptSourceRow} from '../lib/invoiceReceiptComparison.js';
test('quantity evidence follows exact adapter field without unit guessing or mutation',()=>{
 const raw={pcs:{page:2,quote:'6'},total_bunch:{page:2,quote:'120'},total_stems:{page:2,quote:'1200'}};
 const fields={boxQuantity:'pcs',bunchQuantity:'total_bunch',stemQuantity:null};
 const actual=receiptQuantityEvidence(fields,raw);
 assert.deepEqual(Object.keys(actual),['boxQuantity','bunchQuantity']);
 assert.equal(actual.boxQuantity,raw.pcs);assert.equal(actual.stemQuantity,undefined);
 assert.equal(Object.keys(raw).length,3);
});
test('spreadsheet highlight requires a unique exact product row, not a guessed repeated quantity',()=>{
 assert.equal(uniqueReceiptSourceRow([['Rose',10],['Lily',10]],'rose'),0);
 assert.equal(uniqueReceiptSourceRow([['Rose',10],['Rose',20]],'Rose'),-1);
 assert.equal(uniqueReceiptSourceRow([['Rose',10]],'Ros'),-1);
 assert.equal(uniqueReceiptSourceRow([['Rose',10]],''),-1);
});
test('clicking a quantity highlights the item row, or opens the evidenced page when coordinates are missing',()=>{
 const line={lineId:'2026-46-01-x',lineNo:4,originalName:'Rose',sourceEvidence:{descriptionEvidence:{page:3,quote:'Rose'},quantityEvidence:{boxQuantity:{page:4,quote:'6'}}}};
 assert.equal(receiptComparisonFocus(line,'boxQuantity').row,true);
 assert.equal(receiptComparisonFocus(line,'boxQuantity').evidence.page,3);
 assert.equal(receiptComparisonFocus(line,'stemQuantity').row,true);
 assert.equal(receiptComparisonFocus(line,'stemQuantity').evidence.page,3);
 assert.equal(receiptComparisonFocus({...line,sourceEvidence:{}},'boxQuantity').evidence,null);
 assert.deepEqual(receiptComparisonFocus({...line,sourceEvidence:{sourcePage:4}},'lineAmount').evidence,{page:4});
});
test('TH-style row separates missing printed bunches and explicit zero from edited prices and currency',()=>{
 const line={bunchQuantity:12,boxQuantity:0,currency:'USD',unitPrice:3.1,priceUnit:'단',
  sourceEvidence:{sourceFieldStates:{bunchQuantity:{status:'ABSENT'},boxQuantity:{status:'VALID',rawValue:0},unitPrice:{status:'VALID',rawValue:'3.00'}}}};
 assert.equal(receiptComparisonValues(line,'bunchQuantity').printed,null);
 assert.equal(receiptComparisonValues(line,'boxQuantity').printed,0);
 assert.deepEqual(receiptComparisonValues(line,'unitPrice','THB'),{printed:'3.00',planned:3.1,sourceCurrency:'THB',plannedCurrency:'USD',sourceUnit:null,plannedUnit:'단'});
});
