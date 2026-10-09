import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyWeekdayConfirmationLifecycle as classify } from '../lib/weekdayConfirmationLifecycle.js';
const make=(fixed,oldTotal,newTotal,dates=[{date:'2026-10-11',shipmentQuantity:newTotal}])=>({change:{year:'2026',custKey:533,prodKey:359},fixed,oldTotal,newTotal,changed:true,before:{shipmentDates:[{date:'2026-10-11',shipmentQuantity:oldTotal}]},finalDates:dates});
test('fixed quantity cancels and refixes, unfixed quantity stays unfixed',()=>{
  const [fixed,unfixed]=[true,false].map(flag=>classify([make(flag,5,8)])[0].lifecycle);
  assert.deepEqual(fixed.transitionStages,['CANCEL_CONFIRMATION','SAVE_QUANTITY','CONFIRM']);
  assert.equal(fixed.consumedDelta,3);assert.equal(unfixed.finalFixed,false);assert.equal(unfixed.consumedDelta,0);
});
test('weekday move confirms unfixed and retains fixed',()=>{
  for(const flag of [true,false]) {
    const lifecycle=classify([make(flag,5,5,[{date:'2026-10-12',shipmentQuantity:5}])])[0].lifecycle;
    assert.equal(lifecycle.dateMove,true);assert.equal(lifecycle.finalFixed,true);
    assert.equal(lifecycle.confirm,!flag);assert.equal(lifecycle.consumedDelta,flag?0:5);
  }
});
test('zero fixed cancels without confirming an empty detail',()=>{
  const lifecycle=classify([make(true,5,0,[])])[0].lifecycle;
  assert.equal(lifecycle.cancel,true);assert.equal(lifecycle.confirm,false);assert.equal(lifecycle.consumedDelta,-5);
});
test('cross-subweek move and cross-year separation',()=>{
  const source=make(true,5,2),target={...make(false,0,3,[{date:'2026-10-12',shipmentQuantity:3}]),before:{shipmentDates:[]}};
  assert.equal(classify([source,target])[1].lifecycle.finalFixed,true);
  target.change={...target.change,year:'2027'};
  assert.equal(classify([source,target])[1].lifecycle.finalFixed,false);
});

import { reconcileWeekdayConfirmationHistory } from '../lib/weekdayDistributionApply.js';
test('native confirmation initializes missing unchanged-date history and does not append reconciled dates',async()=>{
  const inserted=[];
  const sql={Int:'int',NVarChar:'nvarchar'};
  let rows=[{Timestamp:'2026-10-11 00:00:00.000',Kind:'신규',BeforeQuantity:0,AfterQuantity:5}];
  const query=async(text,params)=>{
    if(text.includes('WITH Latest AS')) return {recordset:rows};
    inserted.push(params);return {recordset:[]};
  };
  const plan={actual:{detail:{SdetailKey:123}}};
  assert.equal(await reconcileWeekdayConfirmationHistory(query,sql,plan,'tester'),1);
  assert.equal(inserted[0].before.value,'0');assert.equal(inserted[0].after.value,'5');
  assert.equal(inserted[0].sdk.value,123);
  rows=[];
  assert.equal(await reconcileWeekdayConfirmationHistory(query,sql,plan,'tester'),0);
  assert.equal(inserted.length,1);
});
