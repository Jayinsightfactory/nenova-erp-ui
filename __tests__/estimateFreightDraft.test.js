import test from 'node:test';
import assert from 'node:assert/strict';
import { freightRowBoxes, freightSourceRows, buildFreightDraftRows, validateFreightDraft, additionalCycleWeek } from '../lib/estimateFreightDraft.js';

test('date rows count only that date, not repeated detail totals', () => {
  const base = { SdateKey: 1, DateShipQty: 2, Quantity: 30, Unit: '단', OutUnit: '박스', BoxQty: 8 };
  assert.equal(freightRowBoxes(base), 2);
  assert.equal(freightRowBoxes({ ...base, SdateKey: 2, DateShipQty: 6 }), 6);
  assert.equal(freightRowBoxes({ ...base, OutUnit:'단', DateShipQty:5, BunchOf1Box:15 }), 1/3);
  assert.equal(freightRowBoxes({ ...base, OutUnit:'송이', DateShipQty:30, SteamOf1Box:300, BunchOf1Box:15 }), .1);
  assert.equal(freightRowBoxes({ ...base, OutUnit:'단', BunchOf1Box:0 }), null);
});
test('excludes deductions and existing freight; rejects prior year and other weeks', () => {
  const row = { ProdName:'Rose', OrderWeek:'37-01', Unit:'박스', Quantity:4 };
  const sources = freightSourceRows([row,{...row,EstimateKey:1},{...row,ProdName:'장미 운송료'}, {...row,OrderYear:'2025'},{...row,OrderWeek:'38-01'}], '2026','37');
  assert.equal(sources.length,3);
  assert.deepEqual(sources.map(r=>r.boxes),[4,null,null]);
});
test('source date and subweek preserved; country transport groups round together', () => {
  const sources = [{ boxes:1.2, OrderWeek:'37-01',outDate:'2026-09-13',CounName:'중국',FlowerName:'장미'}, {boxes:.8,OrderWeek:'37-01',outDate:'2026-09-13',CounName:'중국',FlowerName:'기타'}, {boxes:3,OrderWeek:'37-02',outDate:'2026-09-17',CounName:'중국',FlowerName:'장미'}];
  const rows=buildFreightDraftRows(sources,[], 'CEIL');
  assert.deepEqual(rows.map(r=>[r.weekShort,r.name,r.qty]),[['37-01','현지상차운임',2],['37-01','중국 운송료',2],['37-02','현지상차운임',3],['37-02','중국 운송료',3]]);
});
test('validated draft uses selected year/week, positive cost and freight product', () => {
  const options={year:'2026',parentWeek:'37',custKey:12,products:[{ProdKey:1,ProdName:'현지상차운임',OutUnit:'박스'}]};
  const row={weekShort:'37-01',shipmentDate:'2026-09-13',prodKey:1,qty:5,cost:2000};
  assert.equal(validateFreightDraft([row],options)[0].week,'2026-37-01');
  assert.throws(()=>validateFreightDraft([{...row,weekShort:'36-01'}],options));
  assert.throws(()=>validateFreightDraft([{...row,cost:0}],options));
  assert.throws(()=>validateFreightDraft([row,row],options));
  assert.equal(additionalCycleWeek({week:'2026-37-01'},'2026','37'),'37-01');
  assert.equal(additionalCycleWeek({week:'2026-37-02'},'2026','37'),'37-02');
  assert.throws(()=>additionalCycleWeek({week:'2025-37-01'},'2026','37'));
});
