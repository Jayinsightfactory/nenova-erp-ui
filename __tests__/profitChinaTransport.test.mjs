import assert from 'node:assert/strict';
import {buildChinaTransportBreakdown,incomingTransportShares,shipmentTransportShares,parseChinaTransportScope,TRANSPORT_AMOUNT_KEYS,chinaTransportFarm} from '../lib/profitChinaTransport.mjs';
const scope={orderYear:'2026',major:'44'};
for(const [y,w] of [[null,44],['26',44],['2026',54],['2026',0],[['2026'],44],['2026','44-01'],['2026','44x']])assert.equal(parseChinaTransportScope(y,w),null);
assert.deepEqual(parseChinaTransportScope('2026','4'),{orderYear:'2026',major:'04'});
assert.equal(chinaTransportFarm(' cloudland '),'air');assert.equal(chinaTransportFarm('CLOUD'),'unassigned');
const incoming=[{...scope,orderWeek:'44-01',prodKey:1,farm:'HUBFRESH',unit:'단',quantity:25,amount:250},
  {...scope,orderWeek:'44-02',prodKey:1,farm:'Cloudland',unit:'단',quantity:75,amount:750},
  {...scope,orderWeek:'44-01',prodKey:2,farm:'Cloudland',unit:'송이',quantity:5,amount:500},
  {orderYear:'2025',orderWeek:'44-01',prodKey:1,farm:'HUBFRESH',unit:'단',quantity:9999,amount:99999}];
const shares=incomingTransportShares(incoming,scope);assert.deepEqual(shares.get('1'),{sea:.25,air:.75,unassigned:0});
assert.deepEqual(shares.get('2'),{sea:0,air:1,unassigned:0});
assert.equal(incomingTransportShares([...incoming,{...incoming[0],quantity:-1}],scope).get('1').unassigned,1);
assert.equal(incomingTransportShares([...incoming,{...incoming[0],unit:'박스'}],scope).get('1').unassigned,1);
assert.deepEqual(shipmentTransportShares({quantity:10,assignments:[{farm:'HUBFRESH',quantity:4}]},shares.get('1')).shares,{sea:.4,air:0,unassigned:.6});
assert.equal(shipmentTransportShares({quantity:10,assignments:[{farm:'HUBFRESH',quantity:11}]},shares.get('1')).basis,'invalid_assignment');
assert.equal(shipmentTransportShares({quantity:0,assignments:[{farm:'Cloudland',quantity:1}]},shares.get('1')).basis,'invalid_assignment');
const parent={N:1400,L:-20,O:30,AC:5,AJ:-2,C:1415,Q:1500,S:10,R:2,P:3000,T:20,G:3020,E:400,F:100,H:60,I:3380,J:-1967};
const evidence={...scope,incoming,shipments:[{...scope,orderWeek:'44-01',prodKey:1,quantity:10,amount:1000},
  {...scope,orderWeek:'44-01',prodKey:2,quantity:2,amount:300,assignments:[{farm:'HUBFRESH',quantity:1}]},
  {...scope,orderWeek:'44-01',prodKey:3,quantity:1,amount:100}],
  freight:[{...scope,orderWeek:'44-01',farm:'HUBFRESH',amount:0},{...scope,orderWeek:'44-02',farm:'Cloudland',amount:10}],
  inventory:{begin:{items:[{prodKey:1,value:200},{prodKey:3,value:200}]},end:{items:[{prodKey:1,value:-40},{prodKey:2,value:140}]}}};
const original=JSON.stringify({parent,evidence});const result=buildChinaTransportBreakdown(parent,evidence,scope);
assert.equal(JSON.stringify({parent,evidence}),original,'inputs immutable');
assert.equal(result.rows[0].calc.N,400);assert.equal(result.rows[1].calc.N,750);assert.equal(result.rows[2].calc.N,250);
assert.equal(result.rows[0].calc.E,50);assert.equal(result.rows[0].calc.F,-10);
assert.equal(result.rows[2].calc.H,60);assert.equal(result.rows[2].calc.L,-20);
for(const key of TRANSPORT_AMOUNT_KEYS)assert(Math.abs(result.rows.reduce((s,r)=>s+r.calc[key],0)-parent[key])<1e-8,key);
for(const key of TRANSPORT_AMOUNT_KEYS)assert.equal(result.rows.reduce((s,r)=>s+r.display[key],0),Math.round(parent[key]),`visible ${key}`);
for(const key of TRANSPORT_AMOUNT_KEYS){const missing=buildChinaTransportBreakdown({...parent,[key]:null},evidence,scope);assert(missing.rows.every(row=>row.calc[key]===null),key);}
assert.throws(()=>buildChinaTransportBreakdown(parent,{...evidence,orderYear:'2025'},scope));
const stale=buildChinaTransportBreakdown({...parent,N:1},evidence,scope);assert(stale.rows[2].calc.N<0,'negative residual not hidden');
const zero=buildChinaTransportBreakdown({...parent,C:0,J:0,R:null},{...evidence,shipments:[]},scope);assert.equal(zero.rows[2].calc.K,null);
console.log('profitChinaTransport PASS: scope, actual/partial/invalid, incoming ratios, units, nulls, zeros, negatives, immutable parent, conservation');
