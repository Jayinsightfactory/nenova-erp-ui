import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildEstimateFixStatusUrl } from '../lib/estimateFixStatusLink.js';

const url = new URL(buildEstimateFixStatusUrl('2026-33-02'), 'https://nenova.test');
assert.equal(url.pathname, '/estimate');
assert.equal(url.searchParams.get('popup'), '1');
assert.equal(url.searchParams.get('year'), '2026');
assert.equal(url.searchParams.get('week'), '33');
assert.equal(url.searchParams.get('openFixStatus'), '1');
assert.equal(new URL(buildEstimateFixStatusUrl('33-02'), 'https://nenova.test').searchParams.get('year'), '2025');
const page = fs.readFileSync('pages/orders/paste.js', 'utf8');
const estimate = fs.readFileSync('pages/estimate.js', 'utf8');
assert.match(page, /buildEstimateFixStatusUrl\(week\)/);
assert.match(page, /window\.open\(url, 'estimate-fix-status'/);
assert.match(estimate, /params\.get\('openFixStatus'\) !== '1'/);
assert.match(estimate, /checkFixStatus\(\{ orderYearOverride: requestedYear, parentWeekOverride: requestedWeek \}\)/);
assert.doesNotMatch(page, /PasteFixStatusPanel/);
console.log('paste fix-status tests passed');
