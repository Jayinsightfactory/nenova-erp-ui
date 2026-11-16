'use strict';

// Real updater transport/hash verification only. Fixture bytes are not an installer.
// Run with Electron; all state and cache paths belong to a fresh temporary directory.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { createHash } = require('node:crypto');
const { app, session } = require('electron');
const { NsisUpdater } = require('electron-updater');
const { ElectronHttpExecutor } = require('electron-updater/out/electronHttpExecutor');
const { validInfo, createUpdater } = require('../updater.cjs');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nenova-updater-download-'));
app.setPath('userData', root);
app.setPath('sessionData', root);
const bytes = Buffer.from('Nenova updater checksum fixture: never execute this file.\n'.repeat(64));
const sha512 = createHash('sha512').update(bytes).digest('base64');
let server, installAttempts = 0;
const forbidInstall = () => { installAttempts++; throw new Error('Installer execution is forbidden in this test'); };

async function testCase(baseUrl, corrupt) {
  const name = corrupt ? 'corrupt' : 'valid';
  const caseDir = path.join(root, name);
  fs.mkdirSync(caseDir);
  const configPath = path.join(caseDir, 'app-update.yml');
  fs.writeFileSync(configPath, JSON.stringify({ provider: 'generic', url: `${baseUrl}/${name}/`, updaterCacheDirName: name }));
  const adapter = {
    version: '1.3.0', name: `NenovaUpdaterTest-${name}`, isPackaged: true,
    appUpdateConfigPath: configPath, userDataPath: caseDir, baseCachePath: caseDir,
    whenReady: async () => {}, quit: forbidInstall, relaunch: forbidInstall, onQuit: forbidInstall,
  };
  const engine = new NsisUpdater(null, adapter);
  engine.httpExecutor = new ElectronHttpExecutor(() => {});
  engine.setFeedURL({ provider: 'generic', url: `${baseUrl}/${name}/` });
  engine.autoDownload = false;
  engine.autoInstallOnAppQuit = false;
  engine.disableDifferentialDownload = true;
  engine.disableWebInstaller = true;
  engine.logger = null;
  engine.quitAndInstall = forbidInstall;
  engine.doInstall = forbidInstall;
  let downloaded = 0;
  engine.on('update-downloaded', () => downloaded++);
  const result = await engine.checkForUpdates();
  assert.equal(validInfo(result.updateInfo), true);
  assert.equal(result.updateInfo.version, '1.3.1');
  if (corrupt) {
    await assert.rejects(engine.downloadUpdate(), /checksum mismatch/i);
    assert.equal(downloaded, 0);
    assert.equal(engine.installerPath, null);
  } else {
    const files = await engine.downloadUpdate();
    assert.equal(downloaded, 1);
    assert.equal(files.length, 1);
    assert.ok(path.resolve(files[0]).startsWith(caseDir + path.sep));
    assert.deepEqual(fs.readFileSync(files[0]), bytes);
    assert.equal(createHash('sha512').update(fs.readFileSync(files[0])).digest('base64'), sha512);
  }
}

// 실제 electron-updater 로 '조용히 받기 → 끌 때 설치' 배선을 본다. 설치 파일은 실행하지 않고(doInstall 기록만), 종료 처리기만 직접 부른다.
async function quitInstallCase(baseUrl) {
  const caseDir = path.join(root, 'quit'); fs.mkdirSync(caseDir);
  const configPath = path.join(caseDir, 'app-update.yml');
  fs.writeFileSync(configPath, JSON.stringify({ provider: 'generic', url: `${baseUrl}/valid/`, updaterCacheDirName: 'quit' }));
  const quitHandlers = [], installs = [];
  const adapter = {
    version: '1.3.0', name: 'NenovaUpdaterTest-quit', isPackaged: true,
    appUpdateConfigPath: configPath, userDataPath: caseDir, baseCachePath: caseDir,
    whenReady: async () => {}, quit: forbidInstall, relaunch: forbidInstall, onQuit: handler => quitHandlers.push(handler),
  };
  const engine = new NsisUpdater(null, adapter);
  engine.httpExecutor = new ElectronHttpExecutor(() => {});
  engine.setFeedURL({ provider: 'generic', url: `${baseUrl}/valid/` });
  engine.quitAndInstall = forbidInstall;
  engine.doInstall = options => { installs.push({ isSilent: options.isSilent, isForceRunAfter: options.isForceRunAfter, installer: path.basename(options.installerPath || engine.installerPath || '') }); return true; };
  const disk = { ok: true }, phases = [];
  const updater = createUpdater({ engine, enabled: true, enoughSpace: () => disk.ok, prepareInstall: () => false, notify: state => phases.push(state.phase) });
  assert.equal(engine.autoDownload, false);
  await updater.check();
  for (let i = 0; i < 200 && updater.getState().phase !== 'downloaded'; i++) await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal(updater.getState().phase, 'downloaded', 'background download finished without any click');
  assert.equal(quitHandlers.length, 1, 'the library registered its quit handler');
  assert.deepEqual(fs.readFileSync(engine.installerPath), bytes);
  // 1) 업무 중(끄지 않음)·조건 미확인 상태에서 종료 처리기가 불려도 설치하지 않는다.
  quitHandlers[0](0); assert.deepEqual(installs, []);
  // 2) 여유 공간이 없으면 끌 때도 설치하지 않는다.
  disk.ok = false; assert.equal(updater.armQuitInstall(), false); quitHandlers[0](0); assert.deepEqual(installs, []);
  // 3) 비정상 종료 코드에서는 설치하지 않는다.
  disk.ok = true; assert.equal(updater.armQuitInstall(), true); quitHandlers[0](1); assert.deepEqual(installs, []);
  // 4) 정상 종료 + 조건 충족: 조용히 설치(재실행 없음)를 한 번만 시작한다.
  quitHandlers[0](0);
  assert.deepEqual(installs, [{ isSilent: true, isForceRunAfter: false, installer: 'Nenova-Desktop-Setup-1.3.1-x64.exe' }]);
  quitHandlers[0](0); assert.equal(installs.length, 1, 'never started twice');
  assert.ok(!phases.includes('installing'), 'no in-session restart was requested');
}

app.whenReady().then(async () => {
  server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (url.pathname.endsWith('/latest.yml')) {
      res.setHeader('Content-Type', 'application/yaml');
      res.end(JSON.stringify({ version: '1.3.1', files: [{ url: 'Nenova-Desktop-Setup-1.3.1-x64.exe', size: bytes.length, sha512 }] }));
    } else if (url.pathname.endsWith('/Nenova-Desktop-Setup-1.3.1-x64.exe')) {
      const body = Buffer.from(bytes);
      if (url.pathname.startsWith('/corrupt/')) body[0] ^= 1;
      res.setHeader('Content-Length', body.length);
      res.end(body);
    } else { res.statusCode = 404; res.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    const url = new URL(details.url);
    callback({ cancel: url.origin !== baseUrl });
  });
  await testCase(baseUrl, false);
  await testCase(baseUrl, true);
  await quitInstallCase(baseUrl);
  assert.equal(installAttempts, 0);
  console.log('PASS: real NSIS updater download bytes and SHA512; corrupt bytes rejected; background download + install-on-quit armed only on normal quit with disk space (silent, no relaunch); installers never executed.');
  server.close();
  app.exit(0);
}).catch(error => {
  console.error(error);
  server?.close();
  app.exit(1);
});
