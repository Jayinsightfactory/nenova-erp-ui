import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { buildDesktopBootstrap } from '../lib/desktopBootstrap.js';
import { WORKFLOW_OWNERS } from '../lib/workFlowOwners.js';

const menuGroups = [
  {
    group: 'Common',
    items: [
      { href: '/orders', labelKey: 'Orders', popup: false },
      { href: '/private', labelKey: 'Private', popup: true, userIds: ['nenovaSS3'] },
      { href: '/mine', labelKey: 'Mine', popup: true, userIds: ['sales01'] },
    ],
  },
  { group: 'Owner only', items: [{ href: '/owner', labelKey: 'Owner', popup: false, userIds: ['nenovaSS3'] }] },
];

test('returns every permitted menu in source order without leaking userIds', () => {
  const response = buildDesktopBootstrap(menuGroups, { userId: 'nenovaSS3', authority: 6 }, 'v1·abc');
  assert.equal(response.success, true);
  assert.equal(response.schemaVersion, 1);
  assert.deepEqual(response.user, { userId: 'nenovaSS3' });
  assert.equal(response.webVersion, 'v1·abc');
  assert.deepEqual(response.menus, [
    { group: 'Common', items: [
      { href: '/orders', labelKey: 'Orders', popup: false },
      { href: '/private', labelKey: 'Private', popup: true },
    ] },
    { group: 'Owner only', items: [{ href: '/owner', labelKey: 'Owner', popup: false }] },
  ]);
  assert.equal(response.menuVersion, createHash('sha256').update(JSON.stringify(response.menus)).digest('hex'));
  assert.equal(JSON.stringify(response).includes('userIds'), false);
  assert.equal(menuGroups[0].items[1].userIds[0], 'nenovaSS3');
});

test('restricted entries use exact userId matching and empty groups disappear', () => {
  const sales = buildDesktopBootstrap(menuGroups, { userId: 'sales01' }, 'v1');
  assert.deepEqual(sales.menus, [{ group: 'Common', items: [
    { href: '/orders', labelKey: 'Orders', popup: false },
    { href: '/mine', labelKey: 'Mine', popup: true },
  ] }]);
  const differentCase = buildDesktopBootstrap(menuGroups, { userId: 'NENOVASS3' }, 'v1');
  assert.deepEqual(differentCase.menus, [{ group: 'Common', items: [
    { href: '/orders', labelKey: 'Orders', popup: false },
  ] }]);
  assert.notEqual(sales.menuVersion, differentCase.menuVersion);
});

test('menuVersion is stable for the same menus and changes with menu content', () => {
  const first = buildDesktopBootstrap(menuGroups, { userId: 'sales01' }, 'v1');
  const nextBuild = buildDesktopBootstrap(menuGroups, { userId: 'sales01' }, 'v2');
  assert.equal(first.menuVersion, nextBuild.menuVersion);
  assert.notEqual(first.webVersion, nextBuild.webVersion);
  const changed = structuredClone(menuGroups);
  changed[0].items[0].labelKey = 'Orders updated';
  assert.notEqual(first.menuVersion, buildDesktopBootstrap(changed, { userId: 'sales01' }, 'v2').menuVersion);
});

test('missing verified identity fails closed', () => {
  assert.throws(() => buildDesktopBootstrap(menuGroups, {}, 'v1'), /userId/);
  assert.throws(() => buildDesktopBootstrap(menuGroups, { userId: '' }, 'v1'), /userId/);
});

test('current Layout menu yields complete menus for each permitted identity', () => {
  const layout = readFileSync(new URL('../components/Layout.js', import.meta.url), 'utf8');
  const marker = 'export const MENU_ITEMS = ';
  const start = layout.indexOf(marker);
  const end = layout.indexOf('\n];', start);
  assert.ok(start >= 0 && end > start, 'Layout must export the canonical MENU_ITEMS array');
  const expression = layout.slice(start + marker.length, end + 2);
  const canonical = Function('WORKFLOW_OWNERS', `return (${expression});`)(WORKFLOW_OWNERS);
  for (const userId of ['nenovaSS3', 'nenovaSS2', 'sales01', 'NENOVASS3']) {
    const result = buildDesktopBootstrap(canonical, { userId }, 'v1');
    const expected = canonical.flatMap(group => group.items
      .filter(item => !item.userIds || item.userIds.includes(userId))
      .map(item => item.href));
    assert.deepEqual(result.menus.flatMap(group => group.items.map(item => item.href)), expected);
  }
  const owner = buildDesktopBootstrap(canonical, { userId: 'nenovaSS3' }, 'v1');
  const member = buildDesktopBootstrap(canonical, { userId: 'nenovaSS2' }, 'v1');
  const other = buildDesktopBootstrap(canonical, { userId: 'sales01' }, 'v1');
  assert.ok(owner.menus.flatMap(group => group.items).some(item => item.href === '/integrations/moyi-drive'));
  assert.ok(member.menus.flatMap(group => group.items).some(item => item.href === '/my-work?tab=mine'));
  assert.ok(!other.menus.flatMap(group => group.items).some(item => item.href === '/my-work?tab=mine'));
});
