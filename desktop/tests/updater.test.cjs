'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createUpdater, createUpdateScheduler, validInfo, releaseNoteLines, FEED } = require('../updater.cjs');
const info = (version = '1.4.0') => ({ version, files: [{ url: `Nenova-Desktop-Setup-${version}-x64.exe`, size: 120000000, sha512: Buffer.alloc(64).toString('base64') }] });
test('release notes are bounded plain text and keep their version through download', async () => {
  assert.deepEqual(releaseNoteLines(null), []);
  assert.deepEqual(releaseNoteLines([{ note: '- 메뉴 위치 개선\n- 버튼 안내' }, { note: 123 }]), ['메뉴 위치 개선', '버튼 안내']);
  const notes = releaseNoteLines('<img src=x onerror=alert(1)>\n' + '가'.repeat(1000) + '\n세 번째\n네 번째');
  assert.equal(notes.length, 3); assert.equal(notes[1].length, 240);
  assert.equal(notes[0], '<img src=x onerror=alert(1)>');
  const f = fixture();
  f.engine.checkForUpdates = async () => ({ updateInfo: { ...info(), releaseNotes: '- 상단 업데이트\n- 변경 내용 안내' } });
  await f.updater.check();
  assert.deepEqual(f.updater.getState().releaseNotes, ['상단 업데이트', '변경 내용 안내']);
  await f.updater.download();
  assert.equal(f.updater.getState().version, '1.4.0');
  assert.deepEqual(f.updater.getState().releaseNotes, ['상단 업데이트', '변경 내용 안내']);
  // An older feed must not label outdated release notes as current.
  const older = fixture(); older.engine.checkForUpdates = async () => ({ updateInfo: { ...info('1.2.0'), releaseNotes: '오래된 변경' } });
  await older.updater.check(); assert.deepEqual(older.updater.getState().releaseNotes, []);
});
function fixture({ enabled = true, space = true, prepare = () => true } = {}) {
  const engine = new EventEmitter();
  engine.currentVersion = { version: '1.3.0' };
  engine.checkForUpdates = async () => ({ updateInfo: info() });
  engine.downloadUpdate = async () => {};
  const installs = [];
  engine.quitAndInstall = (...args) => installs.push(args);
  const states = [];
  const updater = createUpdater({ engine, enabled, enoughSpace: () => space, prepareInstall: prepare, notify: s => states.push(s) });
  return { engine, updater, installs, states };
}
test('fixed feed, manual-only download/install and strict artifact metadata', () => {
  assert.equal(require('../package.json').build.publish.url, FEED);
  const { engine } = fixture();
  for (const key of ['autoDownload', 'allowDowngrade', 'allowPrerelease']) assert.equal(engine[key], false);
  assert.equal(engine.autoInstallOnAppQuit, true);
  assert(validInfo(info()));
  for (const url of ['https://evil.test/setup.exe', '../setup.exe', 'Nenova-Desktop-Setup-1.4.0-ia32.exe']) { const i = info(); i.files[0].url = url; assert(!validInfo(i)); }
  for (const change of [{size: 0}, {size: 9999999999}, {sha512: 'bad'}]) { const i = info(); Object.assign(i.files[0],change); assert(!validInfo(i)); }
  assert(!validInfo(info('1.4.0-beta')));
});

test('automatic checks wait for login, check after reconnect and repeat every six hours', async () => {
  const f = fixture(); let ready = false, online = true, time = 0, checks = 0, downloads = 0;
  f.engine.checkForUpdates = async () => { checks++; return { updateInfo: info('1.3.0') }; };
  f.engine.downloadUpdate = async () => { downloads++; };
  const scheduler = createUpdateScheduler({ updater: f.updater, isReady: () => ready, isOnline: () => online, now: () => time });
  await scheduler.tick(); assert.equal(checks, 0);
  ready = true; await scheduler.tick(); assert.equal(checks, 1);
  time = 6 * 60 * 60 * 1000 - 1; await scheduler.tick(); assert.equal(checks, 1);
  time++; await scheduler.tick(); assert.equal(checks, 2);
  online = false; time += 60000; await scheduler.tick(); assert.equal(checks, 2);
  online = true; await scheduler.tick(); assert.equal(checks, 3);
  await scheduler.tick(true); assert.equal(checks, 3, 'duplicate window online notifications are throttled');
  ready = false; time += 7 * 60 * 60 * 1000; await scheduler.tick(); assert.equal(checks, 3);
  assert.equal(downloads, 0); assert.equal(f.installs.length, 0);
});

test('automatic retries recover after failure and concurrent ticks issue one check', async () => {
  const f = fixture(); let time = 0, checks = 0, finish;
  f.engine.checkForUpdates = async () => { checks++; throw Error('offline'); };
  const scheduler = createUpdateScheduler({ updater: f.updater, isReady: () => true, isOnline: () => true, now: () => time });
  await scheduler.tick(); assert.equal(f.updater.getState().phase, 'error');
  time = 15 * 60 * 1000 - 1; await scheduler.tick(); assert.equal(checks, 2, 'one failed attempt tries the Cafe24 feed and the GitHub fallback once each');
  f.engine.checkForUpdates = () => { checks++; return new Promise(resolve => { finish = resolve; }); };
  time++; const pending = scheduler.tick(); await scheduler.tick(true); await f.updater.check(); assert.equal(checks, 3);
  finish({ updateInfo: info() }); await pending;
  assert.equal(f.updater.getState().phase, 'installing');
  assert.equal(f.installs.length, 1);
});

test('login downloads once and a deferred restart remains staged for normal exit', async () => {
  const f = fixture({ prepare: () => false });
  let downloads = 0;
  f.engine.downloadUpdate = async () => { downloads++; };
  const scheduler = createUpdateScheduler({ updater: f.updater, isReady: () => true, isOnline: () => true });
  await Promise.all([scheduler.tick(), scheduler.tick(true)]);
  await scheduler.tick(true);
  assert.equal(downloads, 1);
  assert.equal(f.updater.getState().phase, 'downloaded');
  assert.equal(f.engine.autoInstallOnAppQuit, true);
  assert.equal(f.installs.length, 0);
});
test('check/download do not restart, explicit install approval required', async () => {
  let approved = false;
  const { updater, installs } = fixture({prepare: () => approved});
  await updater.check(); assert.equal(updater.getState().phase, 'available');
  await updater.download(); assert.equal(updater.getState().phase, 'downloaded'); assert.equal(installs.length, 0);
  await updater.install(); assert.equal(installs.length, 0);
  approved = true; await updater.install(); assert.deepEqual(installs, [[true,true]]);
});

test('installer errors emitted without throwing leave installing and allow an explicit retry', async () => {
  for (const asynchronous of [false, true]) {
    const f = fixture();
    f.engine.quitAndInstall = () => {
      const emit = () => f.engine.emit('error', Error('Installer unavailable'));
      if (asynchronous) queueMicrotask(emit); else emit();
    };
    await f.updater.check(); await f.updater.download(); await f.updater.install();
    assert.equal(f.updater.getState().phase, 'error');
    assert.match(f.updater.getState().message, /실패/);
    await f.updater.check(); assert.equal(f.updater.getState().phase, 'available');
    await f.updater.download(); assert.equal(f.updater.getState().phase, 'downloaded');
  }
});
test('offline, low disk, malformed feed and failed persistence never install', async () => {
  for (const mode of ['offline','disk','metadata','persist']) {
    const f = fixture({space: mode !== 'disk', prepare: () => false});
    if (mode === 'offline') f.engine.checkForUpdates = async () => {throw Error('offline');};
    if (mode === 'metadata') f.engine.checkForUpdates = async () => ({updateInfo:{version:'1.4.0',files:[]}});
    await f.updater.check(); await f.updater.download(); await f.updater.install();
    assert.equal(f.installs.length, 0);
    assert.equal(f.updater.getState().phase, mode === 'persist' ? 'downloaded' : 'error');
  }
});
test('duplicate windows requests and cancellation remain serialized', async () => {
  const f = fixture(); let finishCheck, calls=0;
  f.engine.checkForUpdates = () => {calls++; return new Promise(r=>finishCheck=r);};
  const checking=f.updater.check(); await f.updater.check(); assert.equal(calls,1);
  finishCheck({updateInfo:info()}); await checking;
  f.engine.downloadUpdate = token => new Promise((_resolve,reject)=>token.onCancel(()=>reject(Error('cancelled'))));
  const downloading=f.updater.download(); await f.updater.download(); f.updater.cancel(); await downloading;
  assert.equal(f.updater.getState().phase,'available'); assert.equal(f.installs.length,0);
});
test('current/older releases and development mode do not download', async () => {
  for(const version of ['1.3.0','1.2.1']) {
    const f=fixture(); f.engine.checkForUpdates=async()=>({updateInfo:info(version)});
    await f.updater.check(); assert.equal(f.updater.getState().phase,'current');
    await f.updater.download(); assert.equal(f.updater.getState().phase,'current');
  }
  const f=fixture({enabled:false}); await f.updater.check(); assert.equal(f.updater.getState().phase,'unavailable');
});

test('dual feed: Cafe24 static feed first, GitHub Releases only as fallback', async () => {
  const { FEED_PRIMARY, FEED_CHAIN } = require('../updater.cjs');
  assert.equal(FEED_PRIMARY, 'https://nenovaweb.com/desktop-releases');
  assert.deepEqual([...FEED_CHAIN], [FEED_PRIMARY, FEED]);
  assert(Object.isFrozen(FEED_CHAIN));
  const f = fixture(); const seen = [];
  f.engine.setFeedURL = options => seen.push(options);
  f.engine.checkForUpdates = async () => { seen.push('check'); return { updateInfo: info() }; };
  await f.updater.check();
  assert.deepEqual(seen, [{ provider: 'generic', url: FEED_PRIMARY }, 'check']);
  assert.equal(f.updater.getState().phase, 'available');
});

test('dual feed: missing or malformed Cafe24 feed falls back to GitHub without user-visible error', async () => {
  for (const failure of ['404', 'html', 'offline']) {
    const f = fixture(); const seen = []; let url = '';
    f.engine.setFeedURL = options => { url = options.url; seen.push(url); };
    f.engine.checkForUpdates = async () => {
      if (url === FEED) return { updateInfo: info() };
      if (failure === '404') throw Error('Cannot find latest.yml: 404');
      if (failure === 'html') return { updateInfo: { version: '1.4.0', files: [] } };
      throw Error('ENOTFOUND nenovaweb.com');
    };
    await f.updater.check();
    assert.deepEqual(seen, ['https://nenovaweb.com/desktop-releases', FEED], failure);
    assert.equal(f.updater.getState().phase, 'available', failure);
    await f.updater.download(); assert.equal(f.updater.getState().phase, 'downloaded', failure);
  }
});

test('dual feed: every feed failing is a normal retryable error, and a valid current primary does not hit GitHub', async () => {
  const f = fixture(); const seen = [];
  f.engine.setFeedURL = options => seen.push(options.url);
  f.engine.checkForUpdates = async () => { throw Error('offline'); };
  await f.updater.check();
  assert.equal(f.updater.getState().phase, 'error'); assert.equal(seen.length, 2);
  const g = fixture(); const used = [];
  g.engine.setFeedURL = options => used.push(options.url);
  g.engine.checkForUpdates = async () => ({ updateInfo: info('1.3.0') });
  await g.updater.check();
  assert.equal(g.updater.getState().phase, 'current'); assert.deepEqual(used, ['https://nenovaweb.com/desktop-releases']);
  // Feed list is injectable for a single-feed rollback, and the renderer can never supply URLs.
  const engine = new EventEmitter(); engine.currentVersion = { version: '1.3.0' }; const urls = [];
  engine.setFeedURL = options => urls.push(options.url); engine.checkForUpdates = async () => ({ updateInfo: info() });
  await createUpdater({ engine, enabled: true, enoughSpace: () => true, prepareInstall: () => true, notify() {}, feeds: [FEED] }).check();
  assert.deepEqual(urls, [FEED]);
});