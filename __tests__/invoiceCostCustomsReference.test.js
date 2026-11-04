import test from 'node:test';
import assert from 'node:assert/strict';
import {customsReferenceCells} from '../lib/invoiceCostCustomsReference.js';

for(const [profile,expected] of [
 ['US_ORIGINAL_V1',199000],['VN_ORIGINAL_V1',208000],['NZ_ORIGINAL_V1',190500],
 ['EC_ORIGINAL_V1',219000],['CO_ORIGINAL_V1',239000],['CN_AIR_ORIGINAL_V1',248000],
])test(`${profile} restores original customs rows without using old weight or amounts`,()=>{
 const input={weightRef:'C8',countRef:'C9',weight:100,count:3,labelCol:'O',valueCol:'P',start:6};
 const before=JSON.stringify(input),result=customsReferenceCells(profile,input);
 assert.equal(result.total,expected);assert.equal(JSON.stringify(input),before);
 assert.equal(result.cells.get('O6').value,'백상');assert.equal(result.cells.get('O7').value,'통관 수수료');
 assert.equal(result.cells.get('O8').value,'검역 수수료');assert.equal(result.cells.get('O9').value,'국내 운송비');
 assert.match(result.cells.get('P6').formula,/^C8\*/);
 assert.match(result.cells.get('P10').formula,/SUM\(P6:P9\)/);
 assert.match(result.cells.get('O5').value,/실제 청구 아님/);
});
test('missing weight stays unknown; explicit zero remains zero; unsupported rules are not guessed',()=>{
 const p={weightRef:'C7',countRef:'C8',count:0,labelCol:'L',valueCol:'M',start:5};
 const missing=customsReferenceCells('US_ORIGINAL_V1',p);
 assert.equal(missing.total,'입력 필요');
 assert.equal(customsReferenceCells('US_ORIGINAL_V1',{...p,weight:0}).total,123000);
 assert.equal(customsReferenceCells('UNKNOWN',p),null);
});

test('Thailand preserves original additive quarantine reference, never substitutes FOB or applied customs',()=>{
 const result=customsReferenceCells('TH_ORIGINAL_V1',{
  weightRef:'C8',countRef:'C9',weight:225,count:5,labelCol:'M',valueCol:'N',start:6,
 });
 assert.ok(Math.abs(result.total-330178.8868042371)<1e-8);
 assert.ok(Math.abs(result.cells.get('P6').value-44678.8868042371)<1e-8);
 assert.equal(result.cells.get('P6').formula,'SUMPRODUCT(S6:S10,T6:T10)+SUMPRODUCT(V6:V7,W6:W7)');
 assert.match(result.cells.get('N10').formula,/\+\$AB\$10/);
 assert.match(result.cells.get('R4').value,/현재 단가 아님/);
 assert.equal(result.cells.get('T8').value,'원본 미기재');
 assert.equal(result.cells.get('W7').value,'원본 미기재');
 assert.equal(result.cells.has('AB5'),false);
});

test('China sea restores all original fee rows and total without silently replacing actual customs',()=>{
 const result=customsReferenceCells('CN_SEA_ORIGINAL_V1',{});
 assert.equal(result.total,6510302);
 assert.equal(result.cells.get('E28').formula,'SUM(C20:C27,E20:E27)');
 assert.equal(result.cells.get('C27').value,1703302);
 assert.equal(result.cells.get('E23').value,297000);
 assert.equal(result.cells.has('AB5'),false);
 assert.match(result.cells.get('B19').value,/참고 기본값.*실제 청구 아님/);
});
