'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createUpdater, validInfo, releaseNoteLines, FEED } = require('../updater.cjs');
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
test('fixed feed, manual-only updates and strict artifact metadata', () => {
  assert.equal(require('../package.json').build.publish.url, FEED);
  const { engine } = fixture();
  for (const key of ['autoDownload', 'autoInstallOnAppQuit', 'allowDowngrade', 'allowPrerelease']) assert.equal(engine[key], false);
  assert(validInfo(info()));
  for (const url of ['https://evil.test/setup.exe', '../setup.exe', 'Nenova-Desktop-Setup-1.4.0-ia32.exe']) { const i = info(); i.files[0].url = url; assert(!validInfo(i)); }
  for (const change of [{size: 0}, {size: 9999999999}, {sha512: 'bad'}]) { const i = info(); Object.assign(i.files[0],change); assert(!validInfo(i)); }
  assert(!validInfo(info('1.4.0-beta')));
});
test('check/download do not restart, explicit install approval required', async () => {
  let approved = false;
  const { updater, installs } = fixture({prepare: () => approved});
  await updater.check(); assert.equal(updater.getState().phase, 'available');
  await updater.download(); assert.equal(updater.getState().phase, 'downloaded'); assert.equal(installs.length, 0);
  await updater.install(); assert.equal(installs.length, 0);
  approved = true; await updater.install(); assert.deepEqual(installs, [[true,true]]);
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
