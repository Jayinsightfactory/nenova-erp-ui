const assert = require('node:assert/strict');
const { parseDistributionBaseline, validateSelectedScope } = require('../lib/distributionBaseline');

const sheet = values => Object.fromEntries(Object.entries(values).map(([ref, v]) => [ref, { v }]).concat([['!ref', 'A1:H6']]));
const book = (title = '2026 차수(3701) 품종(장미)', extra = {}) => ({
  SheetNames: ['01', '_keymap', ...Object.keys(extra)],
  Sheets: { '01': sheet({ A1: title, B2: '월', C2: '화', A3: '품종', B3: '수연선출고', C3: '수연선출고', D3: '주문', E3: '입고', F3: '재고', G3: '잔량', H3: '농장 메모', A4: 'RED', B4: 0, C4: '', E4: 5, G4: 5, A5: 'WHITE', B5: 2, C5: '미확인', E5: 3, G5: 1, A6: '합계', B6: 2 }), _keymap: sheet({ A2: 'cust', B2: '01', C2: '수연선출고', D2: 7, A3: 'prod', B3: '01', C3: 'RED', D3: 9 }), ...extra }
});

const baseline = parseDistributionBaseline(book(), { year: 2026, week: '37-01', fileName: '37-01.xlsx' });
const [one] = baseline.sheets;
assert.equal(one.clients.length, 2, 'same client on separate days remains separate');
assert.equal(one.clients[0].label, '수연선출고', 'pre-shipment header is retained');
assert.equal(one.clients[0].day, '월');
assert.equal(one.rows[0].values[one.clients[0].id], 0, 'zero is preserved');
assert.equal(one.rows[0].values[one.clients[1].id], '', 'blank string is preserved');
assert.equal(one.rows[1].values[one.clients[1].id], '미확인', 'text is preserved');
assert.equal(one.rows[0].remaining, 5);
assert.equal(one.clients[0].key, 7);
assert.equal(one.rows[0].key, 9);
assert.equal(one.clients.some(client => client.label === '농장 메모'), false, 'columns after summary are excluded');
assert.equal(one.rows.length, 2, 'total row is excluded');
assert.equal(baseline.issues.some(issue => issue.code === 'UNKNOWN_QUANTITY'), true);
assert.equal(validateSelectedScope(baseline, '2026-37-01'), true);
assert.equal(validateSelectedScope(baseline, '2025-37-01'), false);
assert.throws(() => parseDistributionBaseline(book('2025 차수(3701) 품종(장미)'), { year: 2026, week: '37-01' }), /다른 연도/);
assert.throws(() => parseDistributionBaseline(book('2026 차수(3701) 품종(장미)', { '02': sheet({ A1: '2026 차수(3702) 품종(장미)', A3: '품종', B3: '주문', C3: '입고', D3: '잔량' }) }), { year: 2026, week: '37-01' }), /다른 차수/);
console.log('distribution baseline tests passed');
const fs = require('node:fs');
const path = require('node:path');
const ui = fs.readFileSync(path.join(__dirname,'../components/orders/DistributionBaselinePanel.js'),'utf8');
assert.ok(!/apiPost\(|apiPut\(|apiDelete\(|localStorage|sessionStorage|\/api\/shipment/.test(ui), 'baseline UI never saves to ERP or browser persistent storage');
assert.ok(ui.includes('/api/orders/distribution-baselines'), 'explicit server baseline storage only');
const page = fs.readFileSync(path.join(__dirname,'../pages/orders/paste.js'),'utf8');
for(const id of ['paste-connected-input','paste-connected-preview','paste-connected-save','paste-connected-result']) assert.ok(page.includes(`id="${id}"`));
assert.ok(page.includes('onClick={() => handleAllMixedDistribute()}'), 'existing explicit save handler preserved');
console.log('baseline navigation/write-preservation checks passed');
