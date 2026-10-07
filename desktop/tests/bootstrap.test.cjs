'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { parseBootstrap } = require('../bootstrap.cjs');

const actor = 'desktop-test';
const valid = () => ({
  success: true,
  schemaVersion: 1,
  user: { userId: actor },
  webVersion: 'web-1',
  menuVersion: 'a'.repeat(64),
  menus: [{ group: '업무', items: [{ href: '/orders', labelKey: 'orders', popup: false }] }],
});

test('accepts a valid bootstrap payload and returns only the shell contract', () => {
  assert.deepEqual(parseBootstrap(valid(), actor), {
    menus: [{ group: '업무', items: [{ href: '/orders', labelKey: 'orders', popup: false }] }],
    menuVersion: 'a'.repeat(64),
    webVersion: 'web-1',
  });
});

test('rejects malformed envelope and actor identity', () => {
  for (const patch of [
    { success: false }, { schemaVersion: 2 }, { user: { userId: 'another-user' } },
    { user: {} }, { menus: {} }, { menus: new Array(51).fill(valid().menus[0]) },
  ]) {
    assert.throws(() => parseBootstrap({ ...valid(), ...patch }, actor));
  }
});

test('enforces menu group, item, and total bounds without dropping entries', () => {
  const tooManyGroups = Array.from({ length: 301 }, () => ({ group: 'g', items: [] }));
  const tooManyInGroup = [{ group: 'g', items: Array.from({ length: 501 }, () => ({ href: '/x', labelKey: 'x', popup: false })) }];
  const tooManyTotal = [
    { group: 'a', items: Array.from({ length: 250 }, (_, i) => ({ href: '/x'+i, labelKey: 'x', popup: false })) },
    { group: 'b', items: Array.from({ length: 251 }, (_, i) => ({ href: '/y'+i, labelKey: 'y', popup: true })) },
  ];
  assert.throws(() => parseBootstrap({ ...valid(), menus: tooManyGroups }, actor));
  assert.throws(() => parseBootstrap({ ...valid(), menus: tooManyInGroup }, actor));
  assert.throws(() => parseBootstrap({ ...valid(), menus: tooManyTotal }, actor));
});

test('rejects every invalid item in the payload instead of silently filtering it', () => {
  const cases = [
    { group: 1, items: [] },
    { group: 'g'.repeat(101), items: [] },
    { group: 'g', items: [{ href: '/x', labelKey: 'x'.repeat(121), popup: false }] },
    { group: 'g', items: [{ href: 'https://nenovaweb.com/orders', labelKey: 'x', popup: false }] },
    { group: 'g', items: [{ href: '//outside.example/orders', labelKey: 'x', popup: false }] },
    { group: 'g', items: [{ href: '/api/orders', labelKey: 'x', popup: false }] },
    { group: 'g', items: [{ href: '/orders', labelKey: 'x', popup: 'false' }] },
    { group: 'g', items: [{ href: '/ok', labelKey: 'ok', popup: false }, { href: '/api/nope', labelKey: 'bad', popup: true }] },
  ];
  for (const menu of cases) assert.throws(() => parseBootstrap({ ...valid(), menus: [menu] }, actor));
});

test('rejects missing, malformed, or oversized version text', () => {
  for (const patch of [
    { webVersion: '' }, { webVersion: 'w'.repeat(161) },
    { menuVersion: 'not-a-hash' }, { menuVersion: 'a'.repeat(65) },
  ]) assert.throws(() => parseBootstrap({ ...valid(), ...patch }, actor));
});
