import assert from 'node:assert/strict';
import test from 'node:test';
import { recoverWeekdayWilsonEditing } from '../lib/weekdayWilsonEditing.js';

const identity={year:2026,orderWeek:'42-01',custKey:533,prodKey:389,date:'2026-10-18'};
const record={...identity,unit:'박스',status:'STALE',currentTotal:8,expectedTotal:7,wilsonQuantity:1,revision:4};
const input={record,identity,unit:'박스',savedTotal:8,plannedTotal:null,draft:null,error:'',disabledReason:''};
test('Doncel ERP total change offers editing suggestion without asserting saved classification',()=>{
  const before=structuredClone(record);
  const result=recoverWeekdayWilsonEditing(input);
  assert.equal(result.general,7);assert.equal(result.wilson,1);
  assert.equal(result.notice,'최신 ERP 합계에 기존 윌슨 구분 적용');assert.doesNotMatch(result.notice,/미확인|재확인|예상값/);
  assert.deepEqual(record,before);assert.equal(record.status,'STALE');
});
test('unknown, different unit/year, unverified total and overflow never recover',()=>{
  for(const patch of [{status:'UNVERIFIED'},{status:'CURRENT'},{unit:'단'},{year:2025},
    {currentTotal:null},{currentTotal:7},{currentTotal:NaN},{wilsonQuantity:9},{wilsonQuantity:-1},
    {wilsonQuantity:null},{wilsonQuantity:Infinity},{wilsonQuantity:2147483648}]) {
    assert.equal(recoverWeekdayWilsonEditing({...input,record:{...record,...patch}}),null,JSON.stringify(patch));
  }
  for(const patch of [{savedTotal:null},{savedTotal:Infinity},{savedTotal:2147483648},{unit:''},
    {error:'조회 실패'},{disabledReason:'잠금'},{draft:{}},{plannedTotal:0}]) {
    assert.equal(recoverWeekdayWilsonEditing({...input,...patch}),null,JSON.stringify(patch));
  }
});
test('zero remainder and decimal quantities keep original Wilson exactly once',()=>{
  const zero=recoverWeekdayWilsonEditing({...input,savedTotal:1,record:{...record,currentTotal:1}});
  assert.equal(zero.general,0);assert.equal(zero.wilson,1);
  const fraction=recoverWeekdayWilsonEditing({...input,savedTotal:1.2,record:{...record,currentTotal:1.2,wilsonQuantity:0.3}});
  assert.equal(fraction.general,0.9);assert.equal(fraction.wilson,0.3);
});
