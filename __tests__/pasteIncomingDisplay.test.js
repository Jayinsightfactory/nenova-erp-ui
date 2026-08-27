// node __tests__/pasteIncomingDisplay.test.js
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { normalizePasteIncomingProdKeys, buildPasteIncomingMap, buildPasteIncomingSql, pasteIncomingDisplayState, pasteIncomingDisplayCriteriaLedger } from '../lib/pasteIncomingDisplay.js';

assert.deepEqual(normalizePasteIncomingProdKeys([1, '2', { ProdKey: 2 }, { prodKey: 3 }, 0, -1, 'x', 4], 3), [1, 2, 3]);
assert.deepEqual(normalizePasteIncomingProdKeys(null), []);
assert.deepEqual(normalizePasteIncomingProdKeys('10, 20,10,bad'), [10, 20]);
assert.deepEqual(buildPasteIncomingMap([
  { ProdKey: 10, Qty: 4, OutUnit: '단' }, { prodKey: 20, qty: '2.5', outUnit: '박스' },
  { ProdKey: 10, OutQuantity: 1, OutUnit: '' }, { ProdKey: 0, Qty: 99, OutUnit: '송이' },
]), { 10: { qty: 5, outUnit: '단' }, 20: { qty: 2.5, outUnit: '박스' } });
assert.deepEqual(pasteIncomingDisplayState({ loading: true, error: new Error('stale') }), { kind: 'loading', label: '입고 조회 중' });
assert.deepEqual(pasteIncomingDisplayState({ error: 'GET failed' }), { kind: 'error', label: '입고 조회 실패' });
assert.deepEqual(pasteIncomingDisplayState({ entry: { qty: 0, outUnit: '단' } }), { kind: 'zero', label: '입고 0 단' });
assert.deepEqual(pasteIncomingDisplayState({ entry: { qty: 2, outUnit: '단' } }), { kind: 'positive', label: '입고 2 단' });
assert.deepEqual(pasteIncomingDisplayState({ entry: { qty: -1, outUnit: '박스' } }), { kind: 'positive', label: '입고 -1 박스' });
const ledger = pasteIncomingDisplayCriteriaLedger({ orderYear: 2026, orderWeek: '29-02', prodKeys: [10, 20, 10] });
assert.equal(ledger.operation, 'SELECT_ONLY'); assert.deepEqual(ledger.prodKeys, [10, 20]);
assert.deepEqual(ledger.predicates, ['wm.OrderYear = @orderYear', 'wm.OrderWeek = @orderWeek', 'wd.ProdKey IN (@prodKeys)', 'wm.isDeleted = 0']);
assert.equal(ledger.aggregation, 'SUM(wd.OutQuantity)'); assert.equal(ledger.unitSource, 'Product.OutUnit');
assert.equal(ledger.crossYear.included, '2026'); assert.match(ledger.crossYear.excluded, /prior year/);
assert.deepEqual(ledger.preserves, ['Order', 'Shipment', 'Warehouse', 'Stock', 'Estimate', 'WebProfitReport']);
const sqlText = buildPasteIncomingSql(['@pk0', '@pk1']);
assert.match(sqlText, /wm\.OrderYear=@orderYear AND wm\.OrderWeek=@orderWeek/);
assert.match(sqlText, /SUM\(ISNULL\(wd\.OutQuantity,0\)\)/);
assert.match(sqlText, /ISNULL\(wm\.isDeleted,0\)=0/);
assert.throws(() => buildPasteIncomingSql(['@unsafe']), /품목 파라미터/);
const apiSource = fs.readFileSync(new URL('../pages/api/orders/paste-incoming.js', import.meta.url), 'utf8');
const pageSource = fs.readFileSync(new URL('../pages/orders/paste.js', import.meta.url), 'utf8');
assert.match(apiSource, /requireOrderYear\(req\.query\.week, req\.query\.year/);
assert.match(apiSource, /buildPasteIncomingSql\(keyParams\)/);
assert.match(pageSource, /controller\.abort\(\)/, 'late prior-week response is aborted');
assert.match(pageSource, /productKeys\.slice\(index \* 250/, 'large match sets are chunked below the API limit');
assert.match(pageSource, /입고수량 조회 실패/);
console.log('pasteIncomingDisplay tests passed');
