import test from 'node:test';
import assert from 'node:assert/strict';
import { nlInvoiceDraftTemplate } from '../lib/nlInvoiceDraftDefaults.js';

const document={costStatus:'DRAFT',lines:[{lineId:'x',originalName:'Tulip / Pink',lineAmount:100,unitPrice:1}],reviewedMetadata:{gw:100}};
const receipt=[{lineId:'x',stemQuantity:100}];
const form={formulaId:'NL_AMOUNT_V1',customsTotalKRW:'',freightAmount:0,exchangeRateKRW:1500,
  lineInputs:[{lineId:'x',tariffRate:0}]};

test('uploaded NL invoice gets proposed template costs without a second manual cost form',()=>{
  const before=JSON.stringify({document,receipt,form});
  const r=nlInvoiceDraftTemplate(document,receipt,form);
  assert.equal(r.ready,true);assert.equal(r.costs.kindCount,1);
  assert.equal(r.costs.deduct,15000);
  assert.equal(r.total,384000); // 100×460 + 33k + 10k + 90k + 220k - 15k
  assert.equal(JSON.stringify({document,receipt,form}),before);
});

test('operator override, approved cost and missing rate do not silently reprice',()=>{
  assert.equal(nlInvoiceDraftTemplate(document,receipt,{...form,customsTotalKRW:123}),null);
  assert.equal(nlInvoiceDraftTemplate({...document,costStatus:'APPROVED'},receipt,form),null);
  assert.equal(nlInvoiceDraftTemplate(document,receipt,{...form,exchangeRateKRW:''}),null);
});
