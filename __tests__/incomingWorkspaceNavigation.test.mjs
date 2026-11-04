import test from 'node:test';
import assert from 'node:assert/strict';
import { incomingWorkspaceHref } from '../lib/incomingWorkspaceNavigation.js';

test('both entry modes preserve receipt, year-specific date filters and popup without mixing query values', () => {
  for (const year of [2025,2026]) {
    const url=new URL(incomingWorkspaceHref({warehouseKey:7970,from:`${year}-10-01`,to:`${year}-11-30`,farm:'Farm A & B',week:'41-01',q:'A?B#C',popup:true}),'https://nenovaweb.com');
    assert.equal(url.pathname,'/import/tools');assert.equal(url.searchParams.get('tab'),'incoming');
    assert.equal(url.searchParams.get('warehouseKey'),'7970');assert.equal(url.searchParams.get('from'),`${year}-10-01`);
    assert.equal(url.searchParams.get('farm'),'Farm A & B');assert.equal(url.searchParams.get('q'),'A?B#C');assert.equal(url.searchParams.get('popup'),'1');
  }
  for(const warehouseKey of [null,undefined,0,-1,'abc',1.5])assert(!new URL(incomingWorkspaceHref({warehouseKey}),'https://nenovaweb.com').searchParams.has('warehouseKey'));
  assert.equal(incomingWorkspaceHref(),'/import/tools?tab=incoming');
});
