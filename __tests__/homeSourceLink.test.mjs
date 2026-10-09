import {test} from 'node:test';
import assert from 'node:assert/strict';
import {homeKnowledgeTarget,homeFeedbackTarget} from '../lib/homeSourceLink.js';
const id='643045f0-8bb3-4aac-9724-d8ca3f63897e';
test('home source links select a valid source without guessing year',()=>{
  assert.equal(homeKnowledgeTarget({itemId:id.toUpperCase()}),id);
  for(const year of ['2025','2026'])assert.deepEqual(homeFeedbackTarget({caseKey:id,year}),{id,year:Number(year)});
  for(const query of [{caseKey:id},{caseKey:id,year:'2026-40'},{caseKey:id,year:['2026']},{caseKey:'../'+id,year:'2026'},{caseKey:id,year:'1999'}])assert.equal(homeFeedbackTarget(query),null);
  assert.equal(homeKnowledgeTarget({itemId:[id]}),null);
});
