import test from 'node:test';
import assert from 'node:assert/strict';
import {readOnlyInvoiceCostValidation} from '../lib/readOnlyInvoiceCostValidation.js';
import {invoiceCostExportFixture} from './invoiceReceiptCostExport.test.js';

for(const id of ['NL_AMOUNT_V1','CN_AIR_WEIGHT_CBM_V1','CN_SEA_ACTUAL_V1','AU_CNF_BUNCH_V1','VN_CNF_STEM_V1','US_CNF_BOX_V1','NZ_CNF_STEM_V1','EC_FOB_STEM_V1','CO_GROUP_42_1_V1','TH_GROUP_BOX_SHARE_V1'])
test(`${id}: read-only current input passes without consent or separate preview; missing FX still blocks`,()=>{
  const f=invoiceCostExportFixture(2,id),input={...f.snapshot.input,formulaApplicabilityConfirmed:false};
  const receipt=f.document.lines.map((l,i)=>({...l,...f.document.operations[0].result.lineMappings[i],outUnit:f.document.operations[0].result.lineMappings[i].unit}));
  const before=JSON.stringify({document:f.document,input});
  const result=readOnlyInvoiceCostValidation(f.document,receipt,input);
  assert.equal(result.preview.status,'APPROVED',JSON.stringify(result.preview.issues));
  assert.equal(input.formulaApplicabilityConfirmed,false);
  assert.equal(JSON.stringify({document:f.document,input}),before);
  assert.notEqual(readOnlyInvoiceCostValidation({...f.document,reviewedMetadata:{...f.document.reviewedMetadata,country:'WRONG'}},receipt,input).preview.status,'APPROVED');
  assert.notEqual(readOnlyInvoiceCostValidation({...f.document,reviewedMetadata:{...f.document.reviewedMetadata,transportMode:'WRONG'}},receipt,input).preview.status,'APPROVED');
  assert.notEqual(readOnlyInvoiceCostValidation(f.document,receipt,{...input,exchangeRateKRW:null}).preview.status,'APPROVED');
  assert.notEqual(readOnlyInvoiceCostValidation(f.document,receipt,{...input,lineInputs:input.lineInputs.map(l=>({...l,tariffRate:null}))}).preview.status,'APPROVED');
  assert.notEqual(readOnlyInvoiceCostValidation(f.document,receipt.map((l,i)=>i===0?{...l,outQuantity:null}:l),input).preview.status,'APPROVED');
  if(!id.startsWith('CN_'))assert.notEqual(readOnlyInvoiceCostValidation(f.document,receipt.map((l,i)=>i===0?{...l,lineAmount:l.lineAmount+100}:l),input).preview.status,'APPROVED');
});
