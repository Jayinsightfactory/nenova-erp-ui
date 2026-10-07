'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { ORIGIN, trustedUrl, externalUrl, safeSnapshot } = require('../policy.cjs');

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
  assert.deepEqual(snapshot.favorites, [{ url: `${ORIGIN}/orders?popup=1`, title: '주문', zoom: 1.5 }]);
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
