'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { parseMenuSource, generateMenu } = require('../scripts/generate-menu.cjs');

const sample = `export const MENU_ITEMS = [
  {
    group: '업무',
    items: [
    { href: '/orders', labelKey: '주문', popup: false },
    { href: '/private', labelKey: '비공개', popup: true, userIds: ['staff'] },
    { href: '/computed', labelKey: '계산', popup: true, userIds: Object.keys(OWNERS).filter((id) => id) },
    { href: 'https://outside.example', labelKey: '외부', popup: false },
  ] },
  {
    group: '빈 그룹',
    items: [],
  },
];`;

test('parses only unrestricted same-site route literals, preserving source order', () => {
  assert.deepEqual(parseMenuSource(sample), [{
    group: '업무',
    items: [{ href: '/orders', labelKey: '주문', popup: false }],
  }]);
});

test('writes deterministic JSON from the source without evaluating it', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nenova-menu-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const sourcePath = path.join(dir, 'Layout.js');
  const outputPath = path.join(dir, 'menu.json');
  fs.writeFileSync(sourcePath, sample);
  const first = generateMenu({ sourcePath, outputPath });
  const firstText = fs.readFileSync(outputPath, 'utf8');
  const second = generateMenu({ sourcePath, outputPath });
  assert.deepEqual(second, first);
  assert.equal(fs.readFileSync(outputPath, 'utf8'), firstText);
  assert.equal(firstText.includes('/private'), false);
  assert.equal(firstText.includes('/computed'), false);
});
