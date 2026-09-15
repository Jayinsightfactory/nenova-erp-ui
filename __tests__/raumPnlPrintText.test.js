import assert from 'node:assert/strict';
import fs from 'node:fs';
import { escapePnlHtml } from '../lib/raumPnlPrintText.js';
assert.equal(escapePnlHtml('호텔 & 리조트'), '호텔 &amp; 리조트');
assert.equal(escapePnlHtml('<img src=x onerror="alert(1)">'), '&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');
assert.equal(escapePnlHtml(null), '');
const page = fs.readFileSync(new URL('../pages/raum/pnl.js', import.meta.url), 'utf8');
const printFunctions = page.slice(page.indexOf('function buildDetailPrintHtml'), page.indexOf('function VerifyPanel'));
for (const expression of ['meta.title', 'meta.note', 'partnerLabel', 'it.name', 'it.unit']) {
  assert.ok(page.includes(`escapePnlHtml(${expression})`));
  assert.ok(!printFunctions.includes('${' + expression + '}'), `${expression} must not interpolate raw HTML`);
}
console.log('P&L print text escaping tests passed');
