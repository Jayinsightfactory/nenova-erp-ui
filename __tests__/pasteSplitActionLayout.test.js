import assert from 'node:assert/strict';
import fs from 'node:fs';

const page = fs.readFileSync('pages/orders/paste.js', 'utf8');
assert.match(page, /className="paste-action-split"/);
assert.match(page, /1\. 취소 먼저 \(\$\{cancelEntries\.length\}건\)/);
assert.match(page, /2\. 추가·분배 \(\$\{addEntries\.length\}건\)/);
assert.match(page, /gridTemplateColumns: 'minmax\(0, 1fr\) minmax\(0, 1fr\)'/);
assert.match(page, /order\.showDetailedItems \|\| unmatched\.length > 0/);
assert.match(page, /추가·취소 일괄 등록·분배/);
assert.match(page, /\.paste-action-split \{ grid-template-columns: 1fr !important; \}/);
console.log('paste split action layout tests passed');
