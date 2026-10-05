import assert from 'node:assert/strict';
import { parseDutchSheetQuantity } from '../lib/dutchSheetQuantityEdit.js';

assert.deepEqual(parseDutchSheetQuantity('12'), { ok: true, quantity: 12 });
assert.deepEqual(parseDutchSheetQuantity(' 1.25 '), { ok: true, quantity: 1.25 });
assert.deepEqual(parseDutchSheetQuantity('0'), { ok: true, quantity: 0 });
assert.deepEqual(parseDutchSheetQuantity(''), { ok: false, reason: 'empty' });
assert.deepEqual(parseDutchSheetQuantity('   '), { ok: false, reason: 'empty' });
assert.deepEqual(parseDutchSheetQuantity('abc'), { ok: false, reason: 'not-finite' });
assert.deepEqual(parseDutchSheetQuantity('Infinity'), { ok: false, reason: 'not-finite' });
assert.deepEqual(parseDutchSheetQuantity('-0.1'), { ok: false, reason: 'negative' });
console.log('dutch sheet quantity edit tests passed');
