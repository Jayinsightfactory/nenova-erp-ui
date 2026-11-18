import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sortRecentOrderCustomers } from '../lib/orderCustomerRecency.mjs';

test('recent date outranks own manager and repeated week across years; undated last', () => {
  const rows = [
    { CustKey: 1, CustName: 'A', Manager: 'A', IsMine: 1, LastOrderDtm: null },
    { CustKey: 2, CustName: 'B', Manager: 'B', LastOrderWeek: '45-01', LastOrderDtm: '2025-11-18' },
    { CustKey: 3, CustName: 'Z', Manager: 'Z', LastOrderWeek: '45-01', LastOrderDtm: '2026-11-18' },
    { CustKey: 4, CustName: 'C', Manager: 'C', LastOrderDtm: 'invalid' },
    { CustKey: 5, CustName: 'Y', Manager: 'Z', LastOrderDtm: '2026-11-18' },
  ];
  const sorted = sortRecentOrderCustomers(rows);
  assert.deepEqual(sorted.map(c => c.CustKey), [5, 3, 2, 1, 4]);
  assert.deepEqual([...new Set(sorted.map(c => c.Manager))], ['Z', 'B', 'A', 'C']);
  assert.deepEqual(rows.map(c => c.CustKey), [1, 2, 3, 4, 5]);
  assert.deepEqual(sortRecentOrderCustomers([]), []);
});
