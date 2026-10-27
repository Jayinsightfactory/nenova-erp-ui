import test from 'node:test';
import assert from 'node:assert/strict';
import {initialAuOriginalInputs, calculateAuOriginalCustoms, auNumber} from '../lib/auOriginalCostInputs.js';

test('AU historical defaults preserve explicit zero, empty, false and manual edits',()=>{
  const doc={orderYear:'2026',orderWeek:'44-01',reviewedMetadata:{gw:265.5},lines:[{prodKey:1},{prodKey:2},{prodKey:1}]};
  const base=initialAuOriginalInputs(doc);
  assert.equal(calculateAuOriginalCustoms(base).total,265.5*460+33000+20000+90000);
  assert.equal(calculateAuOriginalCustoms({...base,gw:0,clearanceFeeKRW:0,domesticTransportKRW:0}).total,20000);
  for(const value of ['',null,undefined,false,'bad',-1,Infinity])assert.equal(calculateAuOriginalCustoms({...base,gw:value}).total,null);
  assert.equal(calculateAuOriginalCustoms({...base,itemCount:1.5}).total,null);
  assert.equal(calculateAuOriginalCustoms(initialAuOriginalInputs(doc,{auOriginal:{gw:'',clearanceFeeKRW:99}})).total,null);
  assert.equal(initialAuOriginalInputs(doc,{auOriginal:{clearanceFeeKRW:99}}).clearanceFeeKRW,99);
  assert.equal(auNumber(false),null);
  assert.equal(initialAuOriginalInputs({...doc,orderYear:'2025'}).gw,265.5); // no cross-year transaction fallback
});
