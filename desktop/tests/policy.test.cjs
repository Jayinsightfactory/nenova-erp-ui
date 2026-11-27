'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  ORIGIN,
  MAX_WINDOWS,
  WINDOW_CASCADE_OFFSET,
  clampBoundsToDisplays,
  cascadeWindowBounds,
  secondInstanceAction,
  tabContextMenuItems,
  trustedUrl,
  externalUrl,
  safeSnapshot,
} = require('../policy.cjs');

test('trustedUrl canonicalizes same-origin relative URLs and applies popup mode', () => {
  assert.equal(trustedUrl('/orders?year=2026'), `${ORIGIN}/orders?year=2026&popup=1`);
  assert.equal(trustedUrl('/dashboard?tab=home'), `${ORIGIN}/dashboard?tab=home`);
  assert.equal(trustedUrl('/orders?popup=0'), `${ORIGIN}/orders?popup=1`);
  assert.equal(trustedUrl('/orders', { popup: false }), `${ORIGIN}/orders`);
});

test('trustedUrl rejects foreign origins, insecure schemes, credentials, and malformed input', () => {
  for (const input of [
    'http://nenovaweb.com/orders',
    'https://nenovaweb.com.evil.example/orders',
    'https://evil.example/',
    'https://user:pass@nenovaweb.com/orders',
    'javascript:alert(1)',
    'data:text/html,hello',
    'https://nenovaweb.com:444/orders',
    'x'.repeat(8193),
  ]) assert.equal(trustedUrl(input), null, input.slice(0, 80));
});

test('externalUrl accepts canonical HTTPS destinations and rejects unsafe URLs', () => {
  assert.equal(externalUrl('https://docs.example.com/a/../b'), 'https://docs.example.com/b');
  for (const input of ['http://docs.example.com', 'javascript:alert(1)', 'file:///etc/passwd', 'https://u:p@docs.example.com']) {
    assert.equal(externalUrl(input), null, input);
  }
});

test('safeSnapshot keeps only bounded window and tab metadata', () => {
  const snapshot = safeSnapshot({
    actor: 'user\u0000id', secret: 'drop me',
    favorites: [{ url: '/orders', title: '주문', zoom: 9, extra: 'drop me' }, { url: 'https://evil.example/' }],
    windows: [{
      bounds: { x: -90000, y: 30, width: 99999, height: 200 }, maximized: true, active: 99,
      tabs: [{ url: '/shipment/view?token=secret&access_token=secret', title: '출고', zoom: 0.2, internal: true }, { url: '/api/auth/me' }],
      injected: 'drop me',
    }], injected: true,
  });

  assert.deepEqual(Object.keys(snapshot).sort(), ['actor', 'favorites', 'version', 'windows']);
  assert.equal(snapshot.version, 1);
  assert.equal(snapshot.actor, 'userid');
  assert.deepEqual(snapshot.favorites, [{ url: `${ORIGIN}/orders?popup=1`, title: '주문', zoom: 1.5, number: 1 }]);
  assert.equal(snapshot.windows.length, 1);
  const win = snapshot.windows[0];
  assert.deepEqual(win.bounds, { x: -30000, y: 30, width: 7680, height: 600 });
  assert.equal(win.maximized, true);
  assert.equal(win.active, 49);
  assert.deepEqual(Object.keys(win).sort(), ['active', 'bounds', 'maximized', 'tabs']);
  assert.equal(win.tabs.length, 1);
  assert.equal(win.tabs[0].title, '출고');
  assert.equal(win.tabs[0].zoom, 0.5);
  assert.doesNotMatch(win.tabs[0].url, /token|secret/i);
  assert.equal(win.tabs[0].url, `${ORIGIN}/shipment/view?popup=1`);
});

test('safeSnapshot caps collection sizes and drops invalid tab entries', () => {
  const snapshot = safeSnapshot({
    favorites: Array.from({ length: 105 }, (_, i) => ({ url: `/page-${i}` })),
    windows: Array.from({ length: 14 }, () => ({ tabs: Array.from({ length: 52 }, () => ({ url: '/orders' })) })),
  });
  assert.equal(snapshot.favorites.length, 100);
  assert.equal(snapshot.windows.length, 12);
  assert.ok(snapshot.windows.every(window => window.tabs.length === 50));
});

test('favorite numbers and aliases survive deletion, insertion and restart', () => {
  const { favorites } = safeSnapshot({ favorites: [
    { url: '/a' }, { url: '/b', title: '주차별매출이익보고서', alias: '매출자료' }, { url: '/c' },
  ] });
  const restored = safeSnapshot({ favorites: [...favorites.slice(1), { url: '/d' }] }).favorites;
  assert.deepEqual(restored.map(row => row.number), [1, 2, 3]);
  assert.deepEqual(restored[1], favorites[1]);
  assert.deepEqual(restored[2], favorites[2]);
});

test('safeSnapshot preserves import-tools pedidos/country/days and kakao-import sales-paste query params while stripping secrets', () => {
  const snapshot = safeSnapshot({
    favorites: [
      { url: '/import/tools?tool=pedidos&country=colombia&days=14&token=leak', title: '수입부 발주서' },
      { url: '/orders/sales-paste?mode=kakao-import&secret=1', title: '영업 주문등록' },
    ],
  });
  assert.equal(snapshot.favorites.length, 2);
  assert.equal(snapshot.favorites[0].url, `${ORIGIN}/import/tools?tool=pedidos&country=colombia&days=14&popup=1`);
  assert.equal(snapshot.favorites[1].url, `${ORIGIN}/orders/sales-paste?mode=kakao-import&popup=1`);
});

test('secondInstanceAction opens new window when unlocked under cap, focuses when locked/capped/flag, or opens notes', () => {
  assert.equal(secondInstanceAction({ argv: ['nenova.exe', 'nenova-notes://open'], locked: false, windowCount: 1 }), 'open-notes');
  assert.equal(secondInstanceAction({ argv: ['nenova.exe', 'nenova-notes://open/'], locked: true, windowCount: 1 }), 'focus-existing');
  assert.equal(secondInstanceAction({ argv: ['nenova.exe', '--focus-only'], locked: false, windowCount: 1 }), 'focus-existing');
  assert.equal(secondInstanceAction({ argv: ['nenova.exe'], locked: false, windowCount: 1 }), 'new-window');
  assert.equal(secondInstanceAction({ argv: ['nenova.exe'], locked: false, windowCount: MAX_WINDOWS - 1 }), 'new-window');
  assert.equal(secondInstanceAction({ argv: ['nenova.exe'], locked: false, windowCount: MAX_WINDOWS }), 'focus-existing');
  assert.equal(secondInstanceAction({ argv: ['nenova.exe'], locked: true, windowCount: 1 }), 'focus-existing');
});

test('cascadeWindowBounds offsets by +32,+32 and clamps inside primary and dual monitors', () => {
  const primary = { x: 0, y: 0, width: 1920, height: 1040 };
  const secondary = { x: 1920, y: 0, width: 1920, height: 1040 };
  const displays = [{ workArea: primary }, { workArea: secondary }];

  assert.equal(WINDOW_CASCADE_OFFSET, 32);
  assert.deepEqual(
    cascadeWindowBounds(null, displays, primary),
    { x: 0, y: 0, width: 1600, height: 1000 }
  );
  assert.deepEqual(
    cascadeWindowBounds({ x: 100, y: 60, width: 1200, height: 800 }, displays, primary),
    { x: 132, y: 92, width: 1200, height: 800 }
  );
  assert.deepEqual(
    cascadeWindowBounds({ x: 310, y: 30, width: 1600, height: 1000 }, displays, primary),
    { x: 320, y: 40, width: 1600, height: 1000 }
  );
  assert.deepEqual(
    cascadeWindowBounds({ x: 1960, y: 40, width: 1200, height: 800 }, displays, primary),
    { x: 1992, y: 72, width: 1200, height: 800 }
  );
  assert.deepEqual(
    clampBoundsToDisplays({ x: -100, y: -100, width: 500, height: 400 }, [{ workArea: { x: 0, y: 0, width: 1024, height: 768 } }], { x: 0, y: 0, width: 1024, height: 768 }),
    { x: 0, y: 0, width: 800, height: 600 }
  );
});

test('tabContextMenuItems exposes detach, close, and closeOthers with accurate enabled state', () => {
  assert.deepEqual(tabContextMenuItems({ tabCount: 1, windowCount: 1, locked: false }), [
    { id: 'detach', label: '새 창으로 분리', enabled: true },
    { id: 'close', label: '탭 닫기', enabled: true },
    { id: 'closeOthers', label: '다른 탭 닫기', enabled: false },
  ]);
  assert.deepEqual(tabContextMenuItems({ tabCount: 3, windowCount: 2, locked: false }), [
    { id: 'detach', label: '새 창으로 분리', enabled: true },
    { id: 'close', label: '탭 닫기', enabled: true },
    { id: 'closeOthers', label: '다른 탭 닫기', enabled: true },
  ]);
  assert.deepEqual(tabContextMenuItems({ tabCount: 2, windowCount: MAX_WINDOWS, locked: false }), [
    { id: 'detach', label: '새 창으로 분리', enabled: false },
    { id: 'close', label: '탭 닫기', enabled: true },
    { id: 'closeOthers', label: '다른 탭 닫기', enabled: true },
  ]);
  assert.deepEqual(tabContextMenuItems({ tabCount: 2, windowCount: 1, locked: true }), [
    { id: 'detach', label: '새 창으로 분리', enabled: false },
    { id: 'close', label: '탭 닫기', enabled: true },
    { id: 'closeOthers', label: '다른 탭 닫기', enabled: true },
  ]);
});
