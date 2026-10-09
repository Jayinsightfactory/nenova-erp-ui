'use strict';

// Only main owns the feed and installer. The web renderer never supplies URLs.
const FEED = 'https://github.com/Jayinsightfactory/nenova-erp-ui/releases/latest/download';
const MIN_FREE = 1024 ** 3;
function releaseNoteLines(notes) {
  const text = typeof notes === 'string' ? notes : Array.isArray(notes) ? notes.slice(0, 3).map(item => typeof item?.note === 'string' ? item.note : '').join('\n') : '';
  return text.slice(0, 6000).split(/\r?\n/).map(line => line.replace(/^\s*[-*#]+\s*/, '').trim()).filter(Boolean).slice(0, 3).map(line => line.slice(0, 240));
}
function validInfo(info) {
  if (!info || !/^\d+\.\d+\.\d+$/.test(info.version) || !Array.isArray(info.files) || info.files.length !== 1) return false;
  const f = info.files[0];
  return f.url === `Nenova-Desktop-Setup-${info.version}-x64.exe` &&
    Number.isSafeInteger(f.size) && f.size > 0 && f.size <= 500 * 1024 ** 2 &&
    typeof f.sha512 === 'string' && /^[A-Za-z0-9+/]{86}==$/.test(f.sha512);
}
function createUpdater({ engine, enabled, notify, enoughSpace, prepareInstall }) {
  let state = { phase: enabled ? 'idle' : 'unavailable', version: '', percent: 0, message: enabled ? '앱 업데이트를 확인할 수 있습니다.' : '설치된 Windows 앱에서 업데이트할 수 있습니다.' };
  let token, installBusy = false;
  const emit = (patch) => { state = { ...state, ...patch }; notify({ ...state }); };
  const fail = () => emit({ phase: 'error', message: '업데이트에 실패했습니다. 네트워크와 저장 공간을 확인한 뒤 다시 확인해 주세요.' });
  if (engine) {
    engine.autoDownload = false;
    engine.autoInstallOnAppQuit = false;
    engine.allowDowngrade = false;
    engine.allowPrerelease = false;
    engine.disableWebInstaller = true;
    engine.disableDifferentialDownload = true;
    engine.logger = null;
    // Check/download promises report their errors. quitAndInstall can instead
    // emit an error and return without throwing; expose that installation failure.
    // Late events must not erase available or already downloaded releases.
    engine.on('error', () => { if (state.phase === 'installing') fail(); });
    engine.on('download-progress', p => { if (state.phase === 'downloading') emit({ percent: Math.max(0, Math.min(100, Math.floor(p.percent))), message: `앱 업데이트 다운로드 중 ${Math.floor(p.percent)}%` }); });
  }
  return {
    getState: () => ({ ...state }),
    async check() {
      if (!enabled || ['checking', 'available', 'downloading', 'downloaded', 'installing'].includes(state.phase)) return;
      emit({ phase: 'checking', version: '', releaseNotes: [], percent: 0, message: '앱 새 버전을 확인하고 있습니다.' });
      try {
        const result = await engine.checkForUpdates();
        if (!result || !validInfo(result.updateInfo)) throw Error('Invalid update metadata');
        const current = engine.currentVersion.version;
        const newer = result.updateInfo.version.split('.').map(Number);
        const old = current.split('.').map(Number);
        const index = newer.findIndex((n, i) => n !== old[i]);
        const available = index >= 0 && newer[index] > old[index];
        emit({ phase: available ? 'available' : 'current', version: result.updateInfo.version, releaseNotes: available || result.updateInfo.version === current ? releaseNoteLines(result.updateInfo.releaseNotes) : [], message: available ? `업데이트가 필요합니다. 현재 ${current} → 새 버전 ${result.updateInfo.version}. 다운로드 중에도 작업할 수 있습니다.` : `현재 ${current} · 배포 버전 ${result.updateInfo.version}. 적용할 새 업데이트가 없습니다.` });
      } catch { fail(); }
    },
    async download() {
      if (state.phase !== 'available') return;
      emit({ phase: 'downloading', percent: 0, message: '앱 업데이트 다운로드를 준비합니다.' });
      try {
        if (!enoughSpace()) throw Error('Low disk space');
        const { CancellationToken } = require('builder-util-runtime');
        token = new CancellationToken();
        await engine.downloadUpdate(token);
        if (token.cancelled) { emit({ phase: 'available', message: '다운로드를 취소했습니다. 업무를 계속할 수 있습니다.' }); return; }
        emit({ phase: 'downloaded', percent: 100, message: '다운로드 완료. 업무를 저장한 뒤 재시작하여 업데이트하세요.' });
      } catch { if (token?.cancelled) emit({ phase: 'available', message: '다운로드를 취소했습니다. 업무를 계속할 수 있습니다.' }); else fail(); }
      finally { token = null; }
    },
    cancel() { token?.cancel(); },
    async install() {
      if (state.phase !== 'downloaded' || installBusy) return;
      installBusy = true;
      try {
        if (!enoughSpace()) { emit({ message: '업데이트할 공간이 부족합니다. C드라이브에 1GB 이상 확보해 주세요.' }); return; }
        if (!await prepareInstall()) return;
        emit({ phase: 'installing', message: '앱을 종료하고 업데이트를 적용합니다.' });
        engine.quitAndInstall(true, true);
      } catch { fail(); }
      finally { installBusy = false; }
    },
  };
}
// One scheduler per application, shared by all windows. Network restoration can
// retry early, but repeated online events cannot cause a request storm.
function createUpdateScheduler({ updater, isReady, isOnline, now = Date.now }) {
  const interval = 6 * 60 * 60 * 1000, retry = 15 * 60 * 1000, cooldown = 60 * 1000;
  let nextAt = 0, lastAttempt = -Infinity, wasOnline = false, busy = false;
  return {
    async tick(reconnected = false) {
      const online = isOnline(), restored = online && (!wasOnline || reconnected);
      wasOnline = online;
      if (!online || !isReady() || busy) return;
      const time = now();
      if (time < nextAt && !restored || time - lastAttempt < cooldown) return;
      if (!['idle', 'current', 'error'].includes(updater.getState().phase)) return;
      busy = true; lastAttempt = time; nextAt = time + interval;
      try { await updater.check(); }
      finally {
        if (updater.getState().phase === 'error') nextAt = now() + retry;
        busy = false;
      }
    },
  };
}
module.exports = { createUpdater, createUpdateScheduler, validInfo, releaseNoteLines, FEED, MIN_FREE };
