import test from 'node:test';
import assert from 'node:assert/strict';
import { nlQuarantineDeduction, nlQuarantineKind } from '../lib/nlQuarantineDeduction.js';
import { nlInvoiceTariffRate } from '../lib/nlInvoiceTariffReference.js';

test('chooses cheapest landed line but deducts FOB times original sample stems', () => {
  const lines = [
    {lineId:'t1',originalName:'Tulip expensive',stemQuantity:100,lineAmount:200,unitPrice:2,effectiveTariffRate:0},
    {lineId:'t2',originalName:'Tulip cheap',stemQuantity:100,lineAmount:100,unitPrice:1,effectiveTariffRate:0},
    {lineId:'e1',originalName:'Eryngium',stemQuantity:50,lineAmount:100,unitPrice:2,effectiveTariffRate:.25},
  ];
  const before=JSON.stringify(lines);
  const r=nlQuarantineDeduction(lines,{freight:0,exchangeRate:1000,customsBeforeDeduction:100000});
  assert.equal(r.ready,true);assert.equal(r.kindCount,2);
  assert.deepEqual(r.selected.map(row=>[row.kind,row.lineId,row.stems]),[['Tulip','t2',10],['Eryngium','e1',5]]);
  assert.equal(r.deduction,20000);assert.equal(JSON.stringify(lines),before);
});

test('missing original sample is zero; sample loss is added even above base customs',()=>{
  assert.equal(nlQuarantineKind({originalName:'Woolly bush'}),null);
  const noSample=nlQuarantineDeduction([{lineId:'x',originalName:'Woolly bush',stemQuantity:10,lineAmount:10,unitPrice:1,effectiveTariffRate:0}],
    {freight:0,exchangeRate:1000,customsBeforeDeduction:100000});
  assert.equal(noSample.ready,true);assert.equal(noSample.kindCount,1);assert.equal(noSample.deduction,0);
  assert.deepEqual(noSample.excluded.map(x=>x.kind),['Woolly']);
  assert.equal(nlQuarantineDeduction([{lineId:'t',originalName:'Tulip',stemQuantity:10,lineAmount:100,unitPrice:10,effectiveTariffRate:0}],
    {freight:0,exchangeRate:1000,customsBeforeDeduction:1000}).ready,true);
});

test('missing freight is not silently treated as zero',()=>{
  const lines=[{lineId:'t',originalName:'Tulip',stemQuantity:10,lineAmount:10,unitPrice:1,effectiveTariffRate:0}];
  assert.equal(nlQuarantineDeduction(lines,{freight:null,exchangeRate:1000,customsBeforeDeduction:100000}).ready,false);
});

test('additional reference kinds are independent, not replacements or double deductions',()=>{
 const names=['Nerine','Ornithogalum White','Ornithogalum Yellow','Leucothoe','Cordyline'];
 const lines=names.map((originalName,i)=>({lineId:String(i),originalName,stemQuantity:100,
   lineAmount:100+i*10,unitPrice:1+i*.1,effectiveTariffRate:0}));
 const r=nlQuarantineDeduction(lines,{freight:0,exchangeRate:1000,customsBeforeDeduction:200000});
 assert.equal(r.ready,true);assert.equal(r.kindCount,4);
 assert.deepEqual(r.selected.map(x=>x.kind),['Nerine','Ornithogalum','Leucothoe','Cordyline']);
 assert.ok(r.selected.every(x=>x.stems===10));
 assert.equal(r.selected.find(x=>x.kind==='Ornithogalum').lineId,'1');
 assert.equal(r.deduction,48000);
});

test('43-02 unmatched kinds remain distinct and sample deduction never assumes ten stems',()=>{
  const lines=[
    ['a','Amerine/ Anastasia','기타'],['o','Onisogallium / Arabicum','오니소겔륨'],
    ['w','Weigelia Alexandra','기타'],['t','Tulip / Double','튤립'],
  ].map(([lineId,originalName,flowerName])=>({lineId,originalName,flowerName,
    stemQuantity:100,lineAmount:100,unitPrice:1,effectiveTariffRate:0}));
  const r=nlQuarantineDeduction(lines,{freight:0,exchangeRate:1000,customsBeforeDeduction:100000});
  assert.equal(r.ready,true);assert.equal(r.kindCount,4);assert.equal(r.deduction,10000);
  assert.deepEqual(r.excluded.map(x=>x.kind),['Amerine','Onisogallium','Weigelia']);
});

test('NL reference tariff priority and spelling normalization keep item-specific rate before origin',()=>{
  assert.equal(nlInvoiceTariffRate('Grevillea / Red','Colombia'),.08);
  assert.equal(nlInvoiceTariffRate('Eryngium', 'Netherlands'),.25);
  assert.equal(nlInvoiceTariffRate('Cordyline',''),.08);
  assert.equal(nlInvoiceTariffRate('Kangaroo paw Red',''),.25);
  assert.equal(nlInvoiceTariffRate('Unlisted flower','Israel'),.08);
  assert.equal(nlInvoiceTariffRate('Unlisted flower',''),0);
});

test('selection follows landed stem cost even when cheaper FOB belongs to taxed line',()=>{
  const rows=[
    {lineId:'taxed',originalName:'Clematis A',stemQuantity:100,lineAmount:90,unitPrice:.9,effectiveTariffRate:.25},
    {lineId:'untaxed',originalName:'Clematis B',stemQuantity:100,lineAmount:100,unitPrice:1,effectiveTariffRate:0},
  ];
  const r=nlQuarantineDeduction(rows,{freight:0,exchangeRate:1000,customsBeforeDeduction:20000});
  assert.equal(r.ready,true);assert.equal(r.selected[0].lineId,'untaxed');
  assert.equal(r.deduction,10000);
});

test('editing price changes the selected kind member without mutating prior results',()=>{
 const lines=[
  {lineId:'a',originalName:'Tulip Ninja',stemQuantity:150,lineAmount:52.5,unitPrice:.35,effectiveTariffRate:0},
  {lineId:'b',originalName:'Tulip Alternative',stemQuantity:100,lineAmount:43,unitPrice:.43,effectiveTariffRate:0},
 ];
 const settings={freight:20,exchangeRate:1500,customsBeforeDeduction:100000};
 const first=nlQuarantineDeduction(lines,settings);assert.equal(first.selected[0].lineId,'a');assert.equal(first.deduction,5250);
 const next=nlQuarantineDeduction(lines.map(l=>l.lineId==='a'?{...l,unitPrice:1,lineAmount:150}:l),settings);
 assert.equal(next.selected[0].lineId,'b');assert.equal(next.deduction,6450);
 assert.equal(first.selected[0].lineId,'a');assert.equal(lines[0].lineAmount,52.5);
});
