import test from 'node:test';
import assert from 'node:assert/strict';
import { checkWeekdayNativeStock, WEEKDAY_NATIVE_STOCK_SQL } from '../lib/weekdayNativeStock.js';

const sql={NVarChar:'string',Int:'int'};
const plan=(year,week,consumed,delta=0)=>({change:{year,orderWeek:week,prodKey:1443,custKey:533},
  actual:{product:{ProdName:'Playa Blanca',Stock:0}},delta,lifecycle:{consumedDelta:consumed}});
const ledger=(before=41,incoming=50,confirmed=3,adjustment=0)=>({recordset:[{BeforeStock:before,Incoming:incoming,Confirmed:confirmed,Adjustment:adjustment}]});
test('native week availability permits 70 despite a divergent cumulative counter; no mutation',async()=>{
  const result=await checkWeekdayNativeStock(async statement=>{
    assert.equal(statement,WEEKDAY_NATIVE_STOCK_SQL);assert.doesNotMatch(statement,/\b(UPDATE|INSERT|DELETE|EXEC)\b/);
    return ledger();
  },sql,[plan('2026','43-01',70)]);
  assert.equal(result[0].available,88);assert.equal(result[0].remain,18);
});
test('real shortage blocks with exact business week and component values',async()=>{
  await assert.rejects(()=>checkWeekdayNativeStock(async()=>ledger(0,50,3),sql,[plan('2026','43-01',70)]),error=>{
    assert.equal(error.code,'STOCK_SHORTAGE');assert.equal(error.stockValidation.availability[0].remain,-23);return true;
  });
});
test('fixed date only and pure reductions do not check or adjust stock',async()=>{
  await checkWeekdayNativeStock(()=>{throw new Error('unexpected stock query');},sql,[plan('2026','43-01',0),plan('2026','43-02',-10,-10)]);
});
test('earlier batch consumption is carried forward, later cancellation cannot fund earlier stock',async()=>{
  await assert.rejects(()=>checkWeekdayNativeStock(async()=>ledger(0,10,0),sql,
    [plan('2026','43-01',10),plan('2026','43-02',1)]),{code:'STOCK_SHORTAGE'});
  await assert.rejects(()=>checkWeekdayNativeStock(async()=>ledger(0,0,0),sql,
    [plan('2026','43-01',1),plan('2026','43-02',-10,-10)]),{code:'STOCK_SHORTAGE'});
  const rows=await checkWeekdayNativeStock(async()=>ledger(0,0,0),sql,
    [plan('2026','43-01',-10,-10),plan('2026','43-02',10,10)]);
  assert.equal(rows[0].remain,0);
});
test('year-scoped reads and sequential carry cross the year boundary',async()=>{
  const calls=[];
  await checkWeekdayNativeStock(async(_,p)=>{calls.push(p);return ledger(0,10,0);},sql,
    [plan('2025','43-01',1),plan('2026','43-01',1)]);
  assert.deepEqual(calls.map(p=>p.yearWeek.value),['20254301','20264301']);
  assert.deepEqual(calls.map(p=>p.yr.value),['2025','2026']);
});
test('unfixed quantity increase still checks available week stock; malformed ledger is blocked',async()=>{
  await assert.rejects(()=>checkWeekdayNativeStock(async()=>ledger(0,2,0),sql,[plan('2026','43-01',0,3)]),{code:'STOCK_SHORTAGE'});
  await assert.rejects(()=>checkWeekdayNativeStock(async()=>({recordset:[]}),sql,[plan('2026','43-01',3)]),{code:'WEEK_STOCK_INVALID'});
});
