'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { adminAlertList, createAdminAlerts, ALERTS_URL } = require('../admin-alerts.cjs');

const card = (sig, extra = {}) => ({ sig, title: `${sig} 제목`, since: '2일째', todo: '사장님 승인 필요', approval: true, detail: '내용', decision: '정할 것', ...extra });

function harness({ owner = 'boss', responses, allowed = true, isQuitting }) {
  const windows = [], seen = {}, changes = [];
  class Window extends EventEmitter {
    constructor(options) {
      super(); this.options = options; this.urls = []; this.sent = []; this.flashes = [];
      this.webContents = new EventEmitter();
      this.webContents.setWindowOpenHandler = handler => { this.openHandler = handler; };
      this.webContents.send = (channel, state) => this.sent.push([channel, state]);
      windows.push(this);
    }
    isDestroyed() { return !!this.destroyed; }
    isMinimized() { return !!this.minimized; }
    minimize() { this.minimized = true; }
    restore() { this.minimized = false; }
    isVisible() { return !!this.visible; }
    setMenuBarVisibility(value) { assert.equal(value, false); }
    show() { this.visible = true; this.focused = true; }
    showInactive() { this.visible = true; this.minimized = false; }
    focus() { this.focused = true; }
    flashFrame(value) { this.flashes.push(value); }
    destroy() { this.destroyed = true; this.emit('closed'); }
    async loadURL(url) { this.urls.push(url); }
  }
  const state = { owner, calls: 0, allowed };
  const alerts = createAdminAlerts({
    BrowserWindow: Window, screen: { getPrimaryDisplay: () => ({ workArea: { x: 0, y: 0, width: 1280, height: 800 } }) },
    appDir: 'desktop', preload: 'desktop/alerts-preload.cjs',
    fetch: async url => { state.calls++; state.url = url; const next = responses.shift(); if (next instanceof Error) throw next; return next; },
    getOwner: () => state.owner, allowed: () => state.allowed, isQuitting, readSeen: who => seen[who] || [], writeSeen: (who, list) => { seen[who] = list; },
    onCreate: win => { win.registered = true; }, setIdentity: win => { win.branded = true; }, onChange: () => changes.push(1), now: () => 1000,
  });
  return { alerts, windows, seen, state, changes };
}
const ok = list => ({ ok: true, status: 200, json: async () => ({ success: true, ageSec: 30, alerts: list }) });

test('server payload is reduced to bounded text fields and duplicate marks are dropped', () => {
  assert.equal(adminAlertList({ success: false, alerts: [] }), null);
  assert.equal(adminAlertList({ success: true }), null);
  const list = adminAlertList({ success: true, alerts: [card('a'), card('a'), { sig: 'b' }, { title: 'no sig' }, card('c', { title: 'x'.repeat(300), approval: 'yes', html: '<b>' })] });
  assert.deepEqual(list.map(item => item.sig), ['a', 'c']);
  assert.equal(list[1].title.length, 120); assert.equal(list[1].approval, false); assert.equal('html' in list[1], false);
});

test('an ordinary account never asks the server and never gets a window', async () => {
  const plain = harness({ responses: [], allowed: false });
  await plain.alerts.check(); await plain.alerts.check();
  assert.equal(plain.state.calls, 0, 'no request at all without the login flag'); assert.equal(plain.windows.length, 0);
  assert.equal(plain.alerts.count(), null); assert.equal(plain.alerts.open(), false);
});

test('a flagged account the server still refuses is asked only once', async () => {
  const h = harness({ responses: [{ ok: false, status: 404 }] });
  await h.alerts.check(); await h.alerts.check();
  assert.equal(h.state.calls, 1); assert.equal(h.windows.length, 0);
  assert.equal(h.alerts.count(), null); assert.equal(h.alerts.open(), false); assert.equal(h.windows.length, 0);
});

test('an admin gets one unfocused secured window per new alert, not per check', async () => {
  const h = harness({ responses: [ok([card('a')]), ok([card('a')]), ok([card('a'), card('b', { approval: false })])] });
  const first = await h.alerts.check();
  assert.match(h.state.url, /\/api\/pm\/admin-alerts$/);
  assert.equal(h.windows.length, 1);
  const win = h.windows[0];
  assert.equal(win.options.show, false); assert.equal(win.options.webPreferences.nodeIntegration, false);
  assert.equal(win.options.webPreferences.contextIsolation, true); assert.equal(win.options.webPreferences.sandbox, true);
  assert.equal(win.options.webPreferences.preload, 'desktop/alerts-preload.cjs');
  assert.deepEqual(win.urls, [ALERTS_URL]); assert.equal(win.branded, true); assert.equal(win.registered, true);
  assert.deepEqual(win.openHandler({ url: 'https://example.com' }), { action: 'deny' });
  win.emit('ready-to-show');
  assert.equal(win.visible, true); assert.notEqual(win.focused, true, 'the alert must not take keyboard focus from work screens');
  assert.equal(first.alerts[0].fresh, true); assert.equal(h.alerts.count(), 1); assert.deepEqual(h.seen.boss, ['a']);
  const flashes = win.flashes.length;
  await h.alerts.check();
  assert.equal(h.windows.length, 1); assert.equal(win.flashes.length, flashes, 'an unchanged list does not flash again');
  const third = await h.alerts.check();
  assert.equal(h.windows.length, 1); assert.ok(win.flashes.length > flashes);
  assert.deepEqual(third.alerts.map(item => [item.sig, item.fresh]), [['a', true], ['b', true]]);
  assert.deepEqual(h.seen.boss, ['a', 'b']);
  assert.equal(win.sent.at(-1)[0], 'alerts:state');
  assert.equal(h.alerts.owns(win.webContents), true); assert.equal(h.alerts.owns({}), false);
  assert.equal(h.alerts.prompt('a'), '[네노바 PM 알림] a 제목 (2일째)\n내용: 내용\n정할 것: 정할 것\n\n위 건을 기록으로 확인한 뒤, 확인한 것·진행 방법·여쭐 것·확인 방법 순서로 보고하고 진행해 줘.');
  assert.equal(h.alerts.prompt('missing'), '');
  h.state.allowed = false; await h.alerts.check();
  assert.equal(win.destroyed, true, 'losing the login flag closes the window'); assert.equal(h.alerts.count(), null); assert.equal(h.state.calls, 3);
});

test('closing lowers the window to the taskbar, seen alerts stay quiet, a returning alert raises it again', async () => {
  const h = harness({ responses: [ok([card('a')]), ok([card('a')]), ok([]), ok([card('a')])] });
  await h.alerts.check(); const win = h.windows[0]; win.emit('ready-to-show');
  h.alerts.close();
  assert.equal(win.minimized, true); assert.notEqual(win.destroyed, true, 'the window stays in the taskbar so it can be reopened');
  const blocked = { preventDefault() { this.stopped = true; } }; win.emit('close', blocked);
  assert.equal(blocked.stopped, true, 'the title-bar close also only lowers the window');
  const quiet = await h.alerts.check();
  assert.equal(h.windows.length, 1); assert.equal(win.minimized, true, 'an alert that was already shown does not raise the window'); assert.equal(quiet.alerts[0].fresh, false);
  assert.equal(h.alerts.open(), true); assert.equal(win.minimized, false); assert.equal(win.focused, true, 'a manual open takes focus');
  h.alerts.close(); await h.alerts.check(); assert.deepEqual(h.seen.boss, []);
  const back = await h.alerts.check(); assert.equal(back.alerts[0].fresh, true); assert.equal(win.minimized, false, 'a returning alert raises the window');
  assert.equal(h.windows.length, 1);
});

test('app quit is never blocked by the alert window', async () => {
  const state = { quitting: false };
  const h = harness({ responses: [ok([card('a')])], isQuitting: () => state.quitting });
  await h.alerts.check(); state.quitting = true;
  const event = { preventDefault() { this.stopped = true; } }; h.windows[0].emit('close', event);
  assert.notEqual(event.stopped, true);
});

test('network failure and account change fail closed', async () => {
  const h = harness({ responses: [new Error('offline'), ok([card('a')]), { ok: false, status: 404 }] });
  const failed = await h.alerts.check();
  assert.equal(failed.failed, true); assert.equal(failed.admin, false); assert.equal(h.windows.length, 0);
  await h.alerts.check(); assert.equal(h.windows.length, 1);
  h.state.owner = 'staff';
  await h.alerts.check();
  assert.equal(h.windows[0].destroyed, true, 'the admin window closes when the account changes'); assert.equal(h.alerts.count(), null);
  h.state.owner = '';
  const out = await h.alerts.check(); assert.deepEqual(out.alerts, []);
});
