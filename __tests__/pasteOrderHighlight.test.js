import assert from 'node:assert/strict';
import { pasteOrderHighlightState } from '../lib/pasteOrderHighlight.js';

const pending = pasteOrderHighlightState({});
assert.equal(pending.key, 'PENDING');
assert.equal(pending.color, '#c62828');

const registered = pasteOrderHighlightState({ orderOnlyRegistered: true });
assert.equal(registered.key, 'ORDER_ONLY');
assert.equal(registered.color, '#1565c0');
assert.equal(registered.background, '#e3f2fd');
assert.match(registered.label, /주문만 등록/);

console.log('paste order highlight tests passed');
