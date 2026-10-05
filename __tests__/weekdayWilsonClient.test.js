import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { wilsonPendingAfterSave, wilsonWriteInput, validateWilsonWriteResponse } from '../lib/weekdayWilsonClient.js';

const record = {year:2026,majorWeek:'40',orderWeek:'40-02',custKey:533,prodKey:77,date:'2026-10-04',
  unit:'단',wilsonQuantity:5,expectedTotal:20,expectedRevision:0,scopeKey:'private-display-scope'};
const submission = {payload:{operationId:'operation',custKey:533,changes:[{year:2026,orderWeek:'40-02',prodKey:77,
  unit:'단',dates:[{date:'2026-10-04',quantity:20}]}]}};
assert.deepEqual(wilsonPendingAfterSave([record],submission),[record]);
for(const patch of [{year:2025},{custKey:675},{prodKey:78},{orderWeek:'40-01'},{majorWeek:'41'},
  {date:'2026-10-05'},{unit:'박스'},{expectedTotal:21},{expectedTotal:null},{wilsonQuantity:21},{wilsonQuantity:-1}]) {
  assert.deepEqual(wilsonPendingAfterSave([{...record,...patch}],submission),[],JSON.stringify(patch));
}
const zero = {...record,wilsonQuantity:0,expectedTotal:0};
const zeroSubmission = structuredClone(submission);
zeroSubmission.payload.changes[0].dates[0].quantity=0;
assert.deepEqual(wilsonPendingAfterSave([zero],zeroSubmission),[zero],'explicit zero is retained');
assert.deepEqual(wilsonPendingAfterSave([record],{payload:{custKey:533,changes:[]}}),[],
  'classification-only no-op is not attached to an ERP operation');
const metadataChange={year:record.year,orderWeek:record.orderWeek,prodKey:record.prodKey,unit:record.unit,
  dates:[{date:record.date,quantity:record.expectedTotal}],wilsonRecord:{...record}};
assert.deepEqual(wilsonPendingAfterSave([record],{payload:{custKey:533,changes:[]},metadataChanges:[metadataChange]}),[record],
  'validated unchanged-total classification is included without ERP quantity changes');
assert.deepEqual(wilsonPendingAfterSave([{...record,wilsonQuantity:6}],{payload:{custKey:533,changes:[]},metadataChanges:[metadataChange]}),[],
  'classification fingerprint must match the confirmed metadata intent');
assert.deepEqual(wilsonPendingAfterSave([record],null),[]);
assert.equal('scopeKey' in wilsonWriteInput(record),false,'UI metadata never leaks into strict API payload');
const response = {success:true,erpChanged:false,record:{...wilsonWriteInput(record),revision:1}};
assert.deepEqual(validateWilsonWriteResponse(record,response),response.record);
for(const patch of [{year:2025},{custKey:675},{prodKey:78},{date:'2026-10-05'},{orderWeek:'40-01'},
  {majorWeek:'41'},{unit:'박스'},{expectedTotal:19},{wilsonQuantity:6},{revision:0}]) {
  assert.throws(()=>validateWilsonWriteResponse(record,{...response,record:{...response.record,...patch}}));
}
assert.throws(()=>validateWilsonWriteResponse(record,{...response,erpChanged:true}));
const persisted = JSON.parse(JSON.stringify({...submission,wilson:[record]}));
assert.deepEqual(wilsonPendingAfterSave(persisted.wilson,persisted),[record],'pending operation retains exact classification on reload');
const workspace = readFileSync(new URL('../components/WeekdayEstimateWorkspace.js',import.meta.url),'utf8');
assert.ok(workspace.includes('submission.wilson=wilsonPendingAfterSave'), 'splits included before pending operation persistence');
assert.ok(workspace.includes('mergeWeekdayStoredInputs(inputsRef.current'), 'pending operation restoration recovers classification drafts');
console.log('Wilson client exact year/customer/product/week/date/unit/total, zero, no-op, response and pending recovery passed');
