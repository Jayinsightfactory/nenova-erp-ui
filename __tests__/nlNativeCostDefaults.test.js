import test from 'node:test';
import assert from 'node:assert/strict';
import { nlNativeCostDefaults } from '../lib/nlNativeCostDefaults.js';
const source={country:'NL',warehouseKey:7814,inputDate:'2026-10-25',gw:1226.1,cw:1364,
 excluded:[{name:'Gross weight',amount:0},{name:'Chargeable weight',amount:0},{name:'운송료',amount:3689.69}],
 lines:[{lineId:'a',originalName:'Eucalyptus / Nicholii',outUnit:'단',outQuantity:50,stemQuantity:150,stemsPerBunch:1},
 {lineId:'b',originalName:'Grevillea',tariffRate:0,stemsPerBunch:1}]};
const quote={rate:1503.6,marketRate:1488.6,adjustmentKRW:15,requestedAt:'2026-11-02T00:00:00Z'};
test('NL same receipt freight, placeholder-free weights, company customs and actual quantity factor',()=>{
 const before=JSON.stringify(source),r=nlNativeCostDefaults(source,quote);
 assert.deepEqual(r.missing,[]);assert.equal(r.input.freightAmount,3689.69);
 assert.equal(r.input.customsTotalKRW,927006);assert.equal(r.input.expenseBasis,'ESTIMATED');
 assert.equal(r.input.lineInputs[0].stemsPerBunch,3);assert.equal(r.input.lineInputs[1].tariffRate,0);
 assert.equal(r.input.exchangeRateKRW,1503.6);assert.equal(JSON.stringify(source),before);
 assert.equal(nlNativeCostDefaults({...source,country:'AU'},quote),null);
});
test('missing source costs and quote are not invented; explicit zero freight stays zero',()=>{
 assert.deepEqual(nlNativeCostDefaults({...source,gw:null,excluded:[]},null).missing,['입고 운송료','GW 중량','현재 EUR 환율']);
 assert.equal(nlNativeCostDefaults({...source,excluded:[{name:'운송료',amount:0}]},quote).input.freightAmount,0);
 assert.equal(nlNativeCostDefaults({...source,lines:[{lineId:'x',originalName:'Grevillea'}]},quote).input.lineInputs[0].tariffRate,.08);
});
