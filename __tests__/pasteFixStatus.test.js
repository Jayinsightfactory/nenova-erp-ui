import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildEstimateCustomerUrl, buildEstimateFixStatusUrl } from '../lib/estimateFixStatusLink.js';

const url = new URL(buildEstimateFixStatusUrl('2026-33-02'), 'https://nenova.test');
assert.equal(url.pathname, '/estimate');
assert.equal(url.searchParams.get('popup'), '1');
assert.equal(url.searchParams.get('year'), '2026');
assert.equal(url.searchParams.get('week'), '33');
assert.equal(url.searchParams.get('openFixStatus'), '1');
assert.equal(new URL(buildEstimateFixStatusUrl('33-02'), 'https://nenova.test').searchParams.get('year'), '2025');
assert.equal(new URL(buildEstimateFixStatusUrl('33', '2026'), 'https://nenova.test').searchParams.get('year'), '2026');
const customerUrl = new URL(buildEstimateCustomerUrl({
  year: 2026, week: 33, custKey: 77, customerName: '청화원예',
}), 'https://nenova.test');
assert.equal(customerUrl.pathname, '/estimate');
assert.equal(customerUrl.searchParams.get('year'), '2026');
assert.equal(customerUrl.searchParams.get('week'), '33');
assert.equal(customerUrl.searchParams.get('custKey'), '77');
assert.equal(customerUrl.searchParams.get('custName'), '청화원예');
assert.equal(customerUrl.searchParams.get('includeUnfixed'), '1');
assert.equal(customerUrl.searchParams.get('highlightDeductions'), '1');
assert.equal(customerUrl.searchParams.get('openFixStatus'), null);
assert.equal(new URL(buildEstimateCustomerUrl({ year: 2025, week: '33-02', custKey: 77 }), 'https://nenova.test').searchParams.get('year'), '2025');
assert.equal(buildEstimateCustomerUrl({ year: 2026, week: 33, custKey: 0 }), '');
const page = fs.readFileSync('pages/orders/paste.js', 'utf8');
const estimate = fs.readFileSync('pages/estimate.js', 'utf8');
assert.match(page, /buildEstimateFixStatusUrl\(week\)/);
assert.match(page, /window\.open\(url, 'estimate-fix-status'/);
assert.match(estimate, /params\.get\('openFixStatus'\) !== '1'/);
assert.match(estimate, /checkFixStatus\(\{ orderYearOverride: requestedYear, parentWeekOverride: requestedWeek \}\)/);
assert.match(estimate, /params\.get\('custKey'\)/);
assert.match(estimate, /params\.get\('highlightDeductions'\) === '1'/);
assert.match(estimate, /params\.get\('previewCapture'\) === '1'/);
assert.match(estimate, /estimate-preview-capture/);
assert.match(estimate, /queryIncludeUnfixedRef\.current/);
assert.match(estimate, /data-estimate-deduction/);
assert.doesNotMatch(page, /PasteFixStatusPanel/);
console.log('paste fix-status tests passed');
