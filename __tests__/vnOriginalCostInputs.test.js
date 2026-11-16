import test from 'node:test';
import assert from 'node:assert/strict';
import {vnDomesticTransport,vnDomesticTransportFormula,calculateVnOriginalCustoms,vnInvoiceTariffDefault} from '../lib/vnOriginalCostInputs.js';
import {customsReferenceCells} from '../lib/invoiceCostCustomsReference.js';

test('GW capacity decomposition follows authorized truck policy, not a fixed 99000',()=>{
  for(const [gw,expected] of [[164,99000],[1000,99000],[1000.01,187000],[2500,187000],[2500.01,286000],[3000,286000],[4500,385000],[5000,275000],[6000,374000]])
    assert.equal(vnDomesticTransport(gw).amount,expected,`${gw}kg`);
  for(const gw of [undefined,null,'',0,-1,Infinity,NaN,false])assert.equal(vnDomesticTransport(gw),null);
});
test('tariff is exact source product only; no cross-year/country/deleted/unmatched defaults',()=>{
 const d={orderYear:'2026',orderWeek:'46-01',reviewedMetadata:{country:'VN',transportMode:'AIR'}};
 const l={prodKey:3074,country:'VN',originalName:'ORCHID VIETNAM / 호접란  화이트 8 (Party grade White 8) '};
 assert.equal(vnInvoiceTariffDefault(d,l).tariffRate,.05);
 for(const bad of [{...l,originalName:'ORCHID VIETNAM / 호접란 화이트 7 (Party grade White 7)'},{...l,country:'TH'},{...l,productDeleted:1},{...l,prodKey:null}])assert.equal(vnInvoiceTariffDefault(d,bad),null);
 assert.equal(vnInvoiceTariffDefault({...d,orderYear:'2025'},l),null);
 assert.equal(vnInvoiceTariffDefault({...d,orderWeek:'24-01'},l),null);
});
test('46-01 GW164/CW351: CW storage and GW truck costs remain distinct',()=>{
  const value=calculateVnOriginalCustoms({gw:164,cw:351,itemCount:1});
  assert.equal(value.total,303460);assert.equal(value.domestic,99000);
  assert.equal(calculateVnOriginalCustoms({cw:351,itemCount:1}).total,null);
  assert.equal(calculateVnOriginalCustoms({gw:164,itemCount:1}).total,null);
});
test('workbook domestic cells recalculate from separate GW, never from CW or old flat value',()=>{
  const p={weightRef:'D7',countRef:'D8',weight:351,count:1,labelCol:'M',valueCol:'N',start:5,domesticWeight:3000,domesticWeightRef:'F7'};
  const before=JSON.stringify(p),r=customsReferenceCells('VN_ORIGINAL_V1',p);
  assert.equal(r.cells.get('N8').value,286000);assert.equal(r.total,490460);
  assert.equal(r.cells.get('N8').formula,vnDomesticTransportFormula('F7'));
  assert.equal(r.cells.get('N5').formula,'D7*460');assert.equal(JSON.stringify(p),before);
  assert.equal(customsReferenceCells('VN_ORIGINAL_V1',{...p,domesticWeight:undefined}).total,'입력 필요');
});
