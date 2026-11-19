import assert from 'node:assert/strict';
import test from 'node:test';
import { safeSnapshot } from '../desktop/policy.cjs';
import { invoiceReceiptCostHref, invoiceReceiptCostScope } from '../lib/invoiceReceiptCostRoute.js';

test('same receipt cost route survives desktop restoration with an explicit year', () => {
  const sameWeek = { orderWeek: '47-02', warehouseKey: 42 };
  for (const orderYear of ['2025', '2026']) {
    const scope = { orderYear, ...sameWeek };
    const href = invoiceReceiptCostHref(scope);
    const restored = safeSnapshot({ windows: [{ tabs: [{ url: href }] }] }).windows[0].tabs[0].url;
    const query = Object.fromEntries(new URL(restored).searchParams);
    assert.equal(query.tab, 'cost');
    assert.deepEqual(invoiceReceiptCostScope(query), scope);
    const incoming = safeSnapshot({
      windows: [{ tabs: [{ url: '/incoming?week=47-02&warehouseKey=42' }] }],
    }).windows[0].tabs[0].url;
    assert.equal(new URL(incoming).searchParams.get('warehouseKey'), '42');
  }
});

test('missing year, ambiguous scope, unknown tab and unsafe receipt IDs do not resume a receipt', () => {
  const current = { orderYear: '2026', orderWeek: '47-02', warehouseKey: '42' };
  for (const invalid of [{ orderYear: null }, { orderWeek: '47' }, { warehouseKey: ['42'] }, { warehouseKey: 0 }]) {
    assert.equal(invoiceReceiptCostHref({ ...current, ...invalid }), null);
  }
  for (const path of ['/orders?warehouseKey=42', '/import/tools?tab=packing&warehouseKey=42',
    '/import/tools?tab=cost&warehouseKey=-1', '/import/tools?tab=cost&warehouseKey=42&warehouseKey=43']) {
    const restored = safeSnapshot({ windows: [{ tabs: [{ url: path }] }] }).windows[0].tabs[0].url;
    assert.equal(new URL(restored).searchParams.has('warehouseKey'), false);
  }
});
