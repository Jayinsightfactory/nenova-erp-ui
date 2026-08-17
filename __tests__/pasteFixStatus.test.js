import assert from 'node:assert/strict';
import fs from 'node:fs';
import { matchesFullFixStatusWeek, toFullFixStatusWeek } from '../lib/fixStatusWeek.js';

assert.equal(toFullFixStatusWeek('2026-33-02'), '2026-33-02');
assert.equal(toFullFixStatusWeek('33-02'), '2025-33-02');
assert.equal(matchesFullFixStatusWeek({ OrderYear: '2026', OrderWeek: '33-02' }, '2026-33-02'), true);
assert.equal(matchesFullFixStatusWeek({ OrderYear: '2025', OrderWeek: '33-02' }, '2026-33-02'), false);
const component = fs.readFileSync('components/orders/PasteFixStatusPanel.js', 'utf8');
const page = fs.readFileSync('pages/orders/paste.js', 'utf8');
assert.match(component, /fix-status\?fromWeek=\$\{encodeURIComponent\(fullWeek\)\}/);
assert.match(component, /week: fullWeek/);
assert.match(component, /\/api\/shipment\/fix-reconcile/);
assert.match(page, /PasteFixStatusPanel/);
console.log('paste fix-status tests passed');
