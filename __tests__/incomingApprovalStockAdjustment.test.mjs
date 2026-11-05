import {normalizeStockAdjustment} from '../lib/incomingApprovalPolicy.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {buildStockAdjustmentProposal,stockAdjustmentReviewCode} from '../lib/incomingApprovalStockAdjustment.js';
const scope={orderYear:'2026',orderWeek:'41-01'};
const make=(balances,extra={})=>buildStockAdjustmentProposal({scope,source:{receipt:1},products:[{ProdKey:1,ProdName:'P',OutUnit:'단',Stock:10}],future:balances.map((remain,i)=>({prodKey:1,year:'2026',week:`${41+i}-01`,remain})),reservations:[],...extra});
const ack=p=>normalizeStockAdjustment({acknowledged:true,fingerprint:p.fingerprint,rows:p.rows.map(({prodKey,quantity,year,week})=>({prodKey,quantity,year,week}))});
test('native shortages are incremental at the affected period, including later-only shortages',()=>{
 assert.deepEqual(make([-2,-5,-1]).rows.map(r=>[r.week,r.quantity]),[['41-01',2],['42-01',3]]);
 assert.deepEqual(make([3,1,-5]).rows.map(r=>[r.week,r.quantity]),[['43-01',5]]);
 const p=make([-2,-5,-1]);assert.equal(stockAdjustmentReviewCode(p,ack(p)),null);
 assert.equal(stockAdjustmentReviewCode(p,null),'APPROVAL_STOCK_ADJUSTMENT_REQUIRED');
});
test('explicit review rejects false, different period, extra quantity and stale sources',()=>{
 const p=make([-5]);const a=ack(p);
 assert.equal(stockAdjustmentReviewCode(p,{...a,acknowledged:false}),'APPROVAL_STOCK_ADJUSTMENT_REQUIRED');
 for(const change of [{quantity:4},{quantity:6},{year:'2025'},{week:'42-01'}])assert.equal(stockAdjustmentReviewCode(p,{...a,rows:[{...a.rows[0],...change}]}),'APPROVAL_STOCK_ADJUSTMENT_STALE');
 assert.equal(stockAdjustmentReviewCode(make([-5],{source:{receipt:2}}),a),'APPROVAL_STOCK_ADJUSTMENT_STALE');
 assert.equal(normalizeStockAdjustment(null),null);assert.equal(normalizeStockAdjustment({}),null);
 assert.throws(()=>normalizeStockAdjustment({...a,rows:[{...a.rows[0],quantity:true}]}));
 assert.throws(()=>normalizeStockAdjustment({...a,rows:[a.rows[0],a.rows[0]]}));
});
test('reservations remain separate and missing stock cannot become zero',()=>{
 const p=make([3,1,4],{reservations:[{prodKey:1,year:'2026',week:'42-01',remain:-6}]});
 assert.deepEqual(p.rows.map(r=>[r.week,r.quantity,r.basis]),[['42-01',6,['RESERVATION']]]);
 assert.equal(make([null]).canAdjust,false);
 assert.equal(make([1],{products:[{ProdKey:1,Stock:-1}]}).canAdjust,false);
 assert.equal(make([]).canAdjust,false);
 assert.equal(stockAdjustmentReviewCode(make([NaN]),null),'APPROVAL_STOCK_BASIS_MISSING');
});
