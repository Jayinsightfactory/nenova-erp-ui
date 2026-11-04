'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createAiBridge, allowedOpenUrl, isWriteBlockedPath } = require('../ai-bridge.cjs');
const { trustedUrl } = require('../policy.cjs');

const MENUS = [{ group: '주문', items: [{ href: '/orders', labelKey: '주문 관리', popup: false }, { href: '/stats/weekly?tab=a', labelKey: '주간 통계', popup: false }] }];

test('isWriteBlockedPath blocks ERP write-family paths and allows read pages', () => {
  for (const p of ['/orders', '/orders/new', '/shipment/distribute', '/stock', '/estimate', '/master/products', '/api/orders']) assert.equal(isWriteBlockedPath(p), true, p);
  for (const p of ['/dashboard', '/stats/weekly', '/freight.js', '/login']) assert.equal(isWriteBlockedPath(p), false, p);
  assert.equal(isWriteBlockedPath(''), true);
  assert.equal(isWriteBlockedPath(undefined), true);
});

test('allowedOpenUrl accepts only bootstrap menu paths, dashboard, and login', () => {
  assert.equal(allowedOpenUrl('/orders?year=2026', MENUS, trustedUrl), 'https://nenovaweb.com/orders?year=2026');
  assert.equal(allowedOpenUrl('/stats/weekly', MENUS, trustedUrl), 'https://nenovaweb.com/stats/weekly');
  assert.equal(allowedOpenUrl('/dashboard', MENUS, trustedUrl), 'https://nenovaweb.com/dashboard');
  for (const input of ['/unknown-page', '/api/orders', 'https://evil.example/orders', 'javascript:alert(1)', 'https://nenovaweb.com.evil.example/orders', '']) {
    assert.equal(allowedOpenUrl(input, MENUS, trustedUrl), null, input);
  }
});

function startBridge(overrides = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-bridge-test-'));
  const calls = [];
  const tools = {
    tabsList: () => ({ locked: false, tabs: [{ id: '1', url: 'https://nenovaweb.com/dashboard', title: '홈', active: true }] }),
    tabsOpen: url => { calls.push(['open', url]); return { id: '2', url }; },
    resolveTabUrl: async () => 'https://nenovaweb.com/dashboard',
    pageText: async () => ({ tabId: '1', text: '본문' }),
    pageQuery: async p => ({ tabId: '1', matches: [p.selector] }),
    pageClick: async p => { calls.push(['click', p.selector]); return { clicked: true }; },
    pageFill: async p => { calls.push(['fill', p.selector, p.value]); return { filled: true }; },
    pageScreenshot: async () => ({ path: 'x.png' }),
    consoleLogs: async () => ({ logs: [] }),
    ...overrides,
  };
  const bridge = createAiBridge({ dir, trustedUrl, getMenus: () => MENUS, tools });
  return { dir, calls, bridge };
}
async function rpc(port, token, method, params) {
  const response = await fetch(`http://127.0.0.1:${port}/rpc`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ method, params }),
  });
  return { status: response.status, body: await response.json() };
}

test('bridge rejects missing or wrong tokens and accepts the issued token', async () => {
  const { bridge, dir } = startBridge();
  const { port, token } = await bridge.start();
  try {
    const info = JSON.parse(fs.readFileSync(bridge.tokenFile, 'utf8'));
    assert.equal(info.port, port);
    assert.equal(info.token, token);
    assert.equal((await rpc(port, '', 'tabs/list', {})).status, 401);
    assert.equal((await rpc(port, 'f'.repeat(64), 'tabs/list', {})).status, 401);
    const ok = await rpc(port, token, 'tabs/list', {});
    assert.equal(ok.status, 200);
    assert.equal(ok.body.result.tabs[0].url, 'https://nenovaweb.com/dashboard');
  } finally { bridge.stop(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('tabs/open refuses URLs outside the menu allowlist and audits decisions', async () => {
  const { bridge, dir, calls } = startBridge();
  const { port, token } = await bridge.start();
  try {
    for (const url of ['/unknown', 'https://evil.example/', '/api/orders']) {
      const denied = await rpc(port, token, 'tabs/open', { url });
      assert.equal(denied.status, 403, url);
      assert.equal(calls.length, 0);
    }
    const allowed = await rpc(port, token, 'tabs/open', { url: '/stats/weekly' });
    assert.equal(allowed.status, 200);
    assert.deepEqual(calls, [['open', 'https://nenovaweb.com/stats/weekly']]);
    const audit = fs.readFileSync(bridge.auditFile, 'utf8').trim().split('\n').map(JSON.parse);
    assert.equal(audit.length, 4);
    assert.equal(audit.at(-1).allowed, true);
    assert.equal(audit[0].allowed, false);
  } finally { bridge.stop(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('page/click and page/fill are blocked on ERP write paths and logged', async () => {
  const { bridge, dir, calls } = startBridge({ resolveTabUrl: async () => 'https://nenovaweb.com/shipment/distribute' });
  const { port, token } = await bridge.start();
  try {
    const click = await rpc(port, token, 'page/click', { selector: '#save' });
    assert.equal(click.status, 403);
    assert.match(click.body.error, /차단/);
    const fill = await rpc(port, token, 'page/fill', { selector: '#qty', value: '10' });
    assert.equal(fill.status, 403);
    assert.equal(calls.length, 0);
    const audit = fs.readFileSync(bridge.auditFile, 'utf8').trim().split('\n').map(JSON.parse);
    assert.deepEqual(audit.map(row => row.allowed), [false, false]);
    assert.equal(audit[0].selector, '#save');
  } finally { bridge.stop(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('page/click works on non-blocked paths and read tools need no path check', async () => {
  const { bridge, dir, calls } = startBridge({ resolveTabUrl: async () => 'https://nenovaweb.com/stats/weekly' });
  const { port, token } = await bridge.start();
  try {
    const click = await rpc(port, token, 'page/click', { selector: '#filter' });
    assert.equal(click.status, 200);
    assert.deepEqual(calls, [['click', '#filter']]);
    const text = await rpc(port, token, 'page/text', {});
    assert.equal(text.body.result.text, '본문');
    const query = await rpc(port, token, 'page/query', { selector: 'h1' });
    assert.deepEqual(query.body.result.matches, ['h1']);
    const unknown = await rpc(port, token, 'nope/nope', {});
    assert.equal(unknown.status, 400);
  } finally { bridge.stop(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('page/scroll is a read tool: works even on ERP write paths, needs selector or y', async () => {
  const scrolls = [];
  const { bridge, dir } = startBridge({
    resolveTabUrl: async () => 'https://nenovaweb.com/orders', // 쓰기 차단 경로여도 스크롤(읽기성)은 허용
    pageScroll: async p => { scrolls.push(p); return { scrolled: true, y: p.y ?? 120 }; },
  });
  const { port, token } = await bridge.start();
  try {
    const bySel = await rpc(port, token, 'page/scroll', { selector: '#row-30' });
    assert.equal(bySel.status, 200);
    assert.equal(bySel.body.result.scrolled, true);
    const byY = await rpc(port, token, 'page/scroll', { y: 480 });
    assert.equal(byY.status, 200);
    assert.deepEqual(scrolls.map(s => [s.selector, s.y]), [['#row-30', null], ['', 480]]);
    const bad = await rpc(port, token, 'page/scroll', {});
    assert.equal(bad.status, 400);
    assert.match(bad.body.error, /selector 또는 y/);
  } finally { bridge.stop(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('bridge.stop removes the token file', async () => {
  const { bridge, dir } = startBridge();
  await bridge.start();
  assert.equal(fs.existsSync(bridge.tokenFile), true);
  bridge.stop();
  assert.equal(fs.existsSync(bridge.tokenFile), false);
  fs.rmSync(dir, { recursive: true, force: true });
});
