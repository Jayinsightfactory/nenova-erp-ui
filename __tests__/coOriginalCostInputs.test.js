import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {calculateCoOriginalCustoms,coCustomsInput,coReceiptCostPrice,CO_ORIGINAL_CUSTOMS_DEFAULTS as d} from '../lib/coOriginalCostInputs.js';
test('42-1 defaults and canonical source formulas agree',()=>{
 const asset=JSON.parse(readFileSync(new URL('../lib/invoiceCostTemplates/colombia-42-1-content.json',import.meta.url)));
 assert.equal(asset.defaults.P7,d.clearance);assert.equal(asset.defaults.P9,d.domestic);assert.equal(asset.defaults.R6,d.quarantine);
 assert.equal(asset.formulas.P6,`C8*${d.storagePerKg}`);assert.equal(asset.formulas.P8,`C9*${d.inspectionPerGroup}`);
 assert.equal(calculateCoOriginalCustoms(100,['ROSE','ROSE','CARNATION']).total,238000);
});
test('exact four-decimal weighted FOB rounding preserves receipt total without hiding a real mismatch',()=>{
 const row=Object.freeze({stemQuantity:600,unitPrice:.3433,lineAmount:206});
 assert.equal(coReceiptCostPrice(row).unitPrice,206/600);assert.equal(coReceiptCostPrice(row).receiptUnitPrice,.3433);
 assert.equal(row.unitPrice,.3433);
 for(const price of [.34,.35,.34331,0])assert.equal(coReceiptCostPrice({...row,unitPrice:price}).unitPrice,price);
});
test('missing weight/count stays missing; explicit total zero and legacy totals preserved',()=>{
 for(const gw of [null,undefined,'',false,0,-1,'bad',Infinity])assert.equal(calculateCoOriginalCustoms(gw,['ROSE']).total,null);
 assert.equal(calculateCoOriginalCustoms(100,[]).total,null);
 for(const total of [0,25])assert.equal(coCustomsInput({customsTotalKRW:total},100,['ROSE']).customsTotalKRW,total);
 const input=Object.freeze({customsMode:'FORMULA',customsTotalKRW:0});
 assert.equal(coCustomsInput(input,100,['ROSE']).customsTotalKRW,228000);assert.equal(input.customsTotalKRW,0);
 assert.throws(()=>coCustomsInput({customsMode:'OTHER'},100,['ROSE']));
});
