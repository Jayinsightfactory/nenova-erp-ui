import test from 'node:test';
import assert from 'node:assert/strict';
import { NL_QUARANTINE_SAMPLES, nlQuarantineDeduction, nlQuarantineKind } from '../lib/nlQuarantineDeduction.js';
import { nlCompanyTemplateCost } from '../lib/nlCompanyTemplateCost.js';
import { nlInvoiceTariffRate } from '../lib/nlInvoiceTariffReference.js';

test('chooses cheapest landed line and deducts converged landed stem cost times original sample stems', () => {
  const lines = [
    {lineId:'t1',originalName:'Tulip expensive',stemQuantity:100,lineAmount:200,unitPrice:2,effectiveTariffRate:0},
    {lineId:'t2',originalName:'Tulip cheap',stemQuantity:100,lineAmount:100,unitPrice:1,effectiveTariffRate:0},
    {lineId:'e1',originalName:'Eryngium',stemQuantity:50,lineAmount:100,unitPrice:2,effectiveTariffRate:.25},
  ];
  const before=JSON.stringify(lines);
  const r=nlQuarantineDeduction(lines,{freight:0,exchangeRate:1000,customsBeforeDeduction:100000});
  assert.equal(r.ready,true);assert.equal(r.kindCount,2);
  assert.deepEqual(r.selected.map(row=>[row.kind,row.lineId,row.stems]),[['Tulip','t2',10],['Eryngium','e1',5]]);
  assert.ok(Math.abs(r.deduction - 550000 / 19) < 1e-6);
  assert.equal(JSON.stringify(lines),before);
});

test('missing original sample is zero; sample loss is added even above base customs while 100% destruction fails closed',()=>{
  assert.equal(nlQuarantineKind({originalName:'Woolly bush'}),null);
  const noSample=nlQuarantineDeduction([{lineId:'x',originalName:'Woolly bush',stemQuantity:10,lineAmount:10,unitPrice:1,effectiveTariffRate:0}],
    {freight:0,exchangeRate:1000,customsBeforeDeduction:100000});
  assert.equal(noSample.ready,true);assert.equal(noSample.kindCount,1);assert.equal(noSample.deduction,0);
  assert.deepEqual(noSample.excluded.map(x=>x.kind),['Woolly']);
  const converged=nlQuarantineDeduction([{lineId:'t',originalName:'Tulip',stemQuantity:100,lineAmount:1000,unitPrice:10,effectiveTariffRate:0}],
    {freight:0,exchangeRate:1000,customsBeforeDeduction:1000});
  assert.equal(converged.ready,true);
  assert.ok(converged.deduction > 100000);
  assert.equal(nlQuarantineDeduction([{lineId:'t',originalName:'Tulip',stemQuantity:10,lineAmount:100,unitPrice:10,effectiveTariffRate:0}],
    {freight:0,exchangeRate:1000,customsBeforeDeduction:1000}).ready,false);
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
 assert.ok(Math.abs(r.deduction - 1600000 / 23) < 1e-6);
});

test('43-02 unmatched kinds remain distinct while 48-1 Gossypium/Weigelia/Hippeastrum use exact sample stems',()=>{
  assert.equal(nlQuarantineKind({originalName:'HIPPEASTRUM MONT BLANC 12x 4 80cm'}),'Amaryllis');
  assert.equal(nlQuarantineKind({originalName:'Gossypium Herbaceum'}),'Gossypium');
  assert.equal(nlQuarantineKind({originalName:'Weigelia Alexandra'}),'Weigelia');
  assert.equal(NL_QUARANTINE_SAMPLES.find(s=>s.kind==='Gossypium')?.stems,1);
  assert.equal(NL_QUARANTINE_SAMPLES.find(s=>s.kind==='Weigelia')?.stems,5);
  const lines=[
    ['a','Amerine/ Anastasia','기타'],['o','Onisogallium / Arabicum','오니소겔륨'],
    ['w','Weigelia Alexandra','기타'],['t','Tulip / Double','튤립'],
  ].map(([lineId,originalName,flowerName])=>({lineId,originalName,flowerName,
    stemQuantity:100,lineAmount:100,unitPrice:1,effectiveTariffRate:0}));
  const r=nlQuarantineDeduction(lines,{freight:0,exchangeRate:1000,customsBeforeDeduction:100000});
  assert.equal(r.ready,true);assert.equal(r.kindCount,4);
  assert.ok(Math.abs(r.deduction - 100000 / 3) < 1e-6);
  assert.deepEqual(r.selected.map(x=>[x.kind,x.stems]),[['Ornithogalum',10],['Weigelia',5],['Tulip',10]]);
  assert.deepEqual(r.excluded.map(x=>x.kind),['Amerine']);
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
  assert.ok(Math.abs(r.deduction - 35000 / 3) < 1e-6);
});

test('editing price changes the selected kind member without mutating prior results',()=>{
 const lines=[
  {lineId:'a',originalName:'Tulip Ninja',stemQuantity:150,lineAmount:52.5,unitPrice:.35,effectiveTariffRate:0},
  {lineId:'b',originalName:'Tulip Alternative',stemQuantity:100,lineAmount:43,unitPrice:.43,effectiveTariffRate:0},
 ];
 const settings={freight:20,exchangeRate:1500,customsBeforeDeduction:100000};
 const first=nlQuarantineDeduction(lines,settings);
 assert.equal(first.selected[0].lineId,'a');
 assert.ok(Math.abs(first.deduction - 1912750 / 184) < 1e-6);
 const next=nlQuarantineDeduction(lines.map(l=>l.lineId==='a'?{...l,unitPrice:1,lineAmount:150}:l),settings);
 assert.equal(next.selected[0].lineId,'b');
 assert.ok(Math.abs(next.deduction - 1803850 / 188.7) < 1e-6);
 assert.equal(first.selected[0].lineId,'a');assert.equal(lines[0].lineAmount,52.5);
});

test('48-1 Holex 7-row shipment converges to exact M-column quarantine deduction without float64 tie crossing',()=>{
  const rows481=[
    {lineId:'1',originalName:'Amaryllis / Mont Blanc 12st White',stemQuantity:24,unitPrice:2.54,lineAmount:60.96,effectiveTariffRate:0},
    {lineId:'2',originalName:'Amaryllis / Rilona (Salmon) 12st',stemQuantity:24,unitPrice:3.36,lineAmount:80.64,effectiveTariffRate:0},
    {lineId:'3',originalName:'Skimmia / Conf Kew Ger Green',stemQuantity:450,unitPrice:1.49,lineAmount:670.5,effectiveTariffRate:0},
    {lineId:'4',originalName:'Skimmia / Jap Rubella Red',stemQuantity:90,unitPrice:1.5,lineAmount:135,effectiveTariffRate:0},
    {lineId:'5',originalName:'Amaryllis / Loyalty',stemQuantity:12,unitPrice:3.37,lineAmount:40.44,effectiveTariffRate:0},
    {lineId:'6',originalName:'Hydrangea Classic Verena Green/Red 60cm-20cm ',stemQuantity:50,unitPrice:3.85,lineAmount:192.5,effectiveTariffRate:0},
    {lineId:'7',originalName:'Skimmia / Champagne',stemQuantity:90,unitPrice:1.55,lineAmount:139.5,effectiveTariffRate:0},
  ];
  const tpl=nlCompanyTemplateCost(rows481,{gw:111.9,freight:403.84,exchangeRate:1750});
  assert.equal(tpl.ready,true);
  assert.equal(tpl.costs.kindCount,3);
  assert.deepEqual(tpl.costs.selections.map(s=>[s.kind,s.lineId,s.stems]),[['Amaryllis','1',5],['Skimmia','3',6],['Hydrangea','6',10]]);
  assert.ok(Math.abs(tpl.costs.deduct - 164288.54570430366) < 1e-6);
  assert.ok(Math.abs(tpl.total - 588762.5457043037) < 1e-6);
});


test('NL general rules: 6 botanical/spelling synonyms, [EZ] prefix stripping, 2-letter ISO Org 0%/8%/25% tariffs, and small-lot sample cap',()=>{
  assert.equal(nlQuarantineKind({originalName:'Onisogallium / Arabicum'}),'Ornithogalum');
  assert.equal(nlQuarantineKind({originalName:'Acasia Dealbata'}),'Acacia');
  assert.equal(nlQuarantineKind({originalName:'Zantedeschia Aethiopica'}),'Calla');
  assert.equal(nlQuarantineKind({originalName:'Eustoma Russelianum'}),'Lisianthus');
  assert.equal(nlQuarantineKind({originalName:'Anigozanthos Flavidus'}),'Kangoroo');
  assert.equal(nlQuarantineKind({originalName:'Leucospermum Cordifolium'}),'Nutan');
  assert.equal(nlQuarantineKind({originalName:'Astillbe Washington'}),'Astilbe');

  const ezUnmatched=nlQuarantineDeduction([
    {lineId:'ez1',originalName:'[EZ] Bouvardia White 60cm',flowerName:'기타',stemQuantity:50,lineAmount:50,unitPrice:1,effectiveTariffRate:0},
  ],{freight:0,exchangeRate:1000,customsBeforeDeduction:50000});
  assert.equal(ezUnmatched.ready,true);
  assert.deepEqual(ezUnmatched.excluded.map(x=>x.kind),['Bouvardia']);

  assert.equal(nlInvoiceTariffRate('Eryngium / Questar','NL'),0);
  assert.equal(nlInvoiceTariffRate('Clematis / Amazing','BE'),0);
  assert.equal(nlInvoiceTariffRate('Gossypium Herbaceum','IT'),0);
  assert.equal(nlInvoiceTariffRate('Clematis (no NL)','NL'),0.25);
  assert.equal(nlInvoiceTariffRate('Gossypium Herbaceum','IL'),0.08);
  assert.equal(nlInvoiceTariffRate('Waxflower / Chamelaucium','IL'),0.08);
  assert.equal(nlInvoiceTariffRate('Cordyline / Red','CR'),0.08);
  assert.equal(nlInvoiceTariffRate('Cordyline / Green','SG'),0.08);
  assert.equal(nlInvoiceTariffRate('Grevillea / Ivanhoe','AU'),0.08);
  assert.equal(nlInvoiceTariffRate('Eucalyptus / Cinerea','US'),0.08);
  assert.equal(nlInvoiceTariffRate('Astrantia / Roma','KE'),0.25);
  assert.equal(nlInvoiceTariffRate('Gossypium Herbaceum','TR'),0.25);
  assert.equal(nlInvoiceTariffRate('Leucospermum / Ayoba','ZA'),0.25);
  assert.equal(nlInvoiceTariffRate('Hypericum / Coco','ET'),0.25);
  assert.equal(nlInvoiceTariffRate('Eryngium','네덜란드'),0.25);
  assert.equal(nlInvoiceTariffRate('Eryngium','Netherlands'),0.25);

  const smallLot=nlQuarantineDeduction([
    {lineId:'t1',originalName:'Tulip / Double',stemQuantity:100,lineAmount:100,unitPrice:1,effectiveTariffRate:0},
    {lineId:'h1',originalName:'Hydrangea / Mini',stemQuantity:5,lineAmount:20,unitPrice:4,effectiveTariffRate:0},
    {lineId:'i1',originalName:'Iris / Blue Magic',stemQuantity:8,lineAmount:6.4,unitPrice:0.8,effectiveTariffRate:0},
  ],{freight:0,exchangeRate:1000,customsBeforeDeduction:100000});
  assert.equal(smallLot.ready,true);
  assert.deepEqual(smallLot.selected.map(x=>[x.kind,x.stems,x.tableStems,x.kindTotalStems,x.capped]),[
    ['Tulip',10,10,100,false],
    ['Hydrangea',5,10,5,true],
    ['Iris',8,30,8,true],
  ]);
});
