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
// background(기본 켬, 사장님 지시 2026-11-16 A안): 새 버전이 확인되면 조용히 내려받아 두고, 직원이 앱을 끌 때 설치한다.
// 업무 중에 앱이 스스로 꺼지거나 재시작하는 일은 없다 — 예전에 자동 설치를 꺼 둔 이유(저장 안 한 입력 보호, 명시적 확인)는 그대로 지킨다:
//   · 지금 재시작(install)은 여전히 확인 창을 거친다. · 끌 때 설치는 직원이 스스로 종료를 마친 뒤(종료 확인 통과 후)에만 실행된다.
//   · 버전·파일명·크기·sha512 검사, 낮은 버전 금지, 여유 공간 1GB 확인은 내려받기 전과 끌 때 모두 적용한다.
function createUpdater({ engine, enabled, notify, enoughSpace, prepareInstall, background = true }) {
  let state = { phase: enabled ? 'idle' : 'unavailable', version: '', percent: 0, message: enabled ? '앱 업데이트를 확인할 수 있습니다.' : '설치된 Windows 앱에서 업데이트할 수 있습니다.' };
  let token, installBusy = false, userCancelled = false, quitInstallBlocked = false;
  const emit = (patch) => { state = { ...state, ...patch }; notify({ ...state }); };
  const fail = () => emit({ phase: 'error', message: '업데이트에 실패했습니다. 네트워크와 저장 공간을 확인한 뒤 다시 확인해 주세요.' });
  if (engine) {
    engine.autoDownload = false;
    // electron-updater 는 이 값이 켜져 있을 때만 '끌 때 설치' 처리기를 등록하고, 실제 종료 순간에 값을 다시 읽는다.
    // 그래서 등록용으로만 켜 두고(내려받기 전), 내려받은 뒤에는 꺼 두었다가 armQuitInstall() 이 조건을 확인한 경우에만 켠다.
    engine.autoInstallOnAppQuit = background;
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
  const api = {
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
        // 직원이 이번 실행에서 내려받기를 직접 취소했다면 다시 자동으로 받지 않는다(버튼으로는 받을 수 있다).
        if (available && background && !userCancelled) void api.download(true);
      } catch { fail(); }
    },
    async download(automatic = false) {
      if (state.phase !== 'available') return;
      if (!automatic) userCancelled = false;
      emit({ phase: 'downloading', percent: 0, message: automatic ? '새 버전을 조용히 받는 중입니다. 업무는 그대로 하시면 됩니다.' : '앱 업데이트 다운로드를 준비합니다.' });
      try {
        if (!enoughSpace()) throw Error('Low disk space');
        const { CancellationToken } = require('builder-util-runtime');
        token = new CancellationToken();
        await engine.downloadUpdate(token);
        if (token.cancelled) { emit({ phase: 'available', message: '다운로드를 취소했습니다. 업무를 계속할 수 있습니다.' }); return; }
        if (engine && background) engine.autoInstallOnAppQuit = false; // 끌 때 armQuitInstall() 이 조건을 본 뒤에만 켠다
        emit({ phase: 'downloaded', percent: 100, message: background ? '새 버전을 받아 두었습니다. 앱을 끄면 설치되고, 다음에 켜면 새 버전입니다. 지금 바꾸려면 업무를 저장한 뒤 버튼을 누르세요.' : '다운로드 완료. 업무를 저장한 뒤 재시작하여 업데이트하세요.' });
      } catch { if (token?.cancelled) emit({ phase: 'available', message: '다운로드를 취소했습니다. 업무를 계속할 수 있습니다.' }); else fail(); }
      finally { token = null; }
    },
    cancel() { if (token) userCancelled = true; token?.cancel(); },
    // 앱이 정상 종료되는 마지막 순간(will-quit)에 한 번 부른다. 받아 둔 새 버전이 있고 조건이 맞을 때만 '끌 때 설치'를 켠다.
    // Windows 로그오프·종료 중(blockQuitInstall)에는 설치를 시작하지 않는다 — 설치 도중 전원이 꺼지면 앱이 깨질 수 있다. 다음 정상 종료 때 설치된다.
    armQuitInstall() {
      if (!engine || !background) return false;
      let ok = false;
      try { ok = state.phase === 'downloaded' && !installBusy && !quitInstallBlocked && enoughSpace() === true; } catch { ok = false; }
      engine.autoInstallOnAppQuit = ok;
      return ok;
    },
    blockQuitInstall() { quitInstallBlocked = true; if (engine && background) engine.autoInstallOnAppQuit = false; },
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
  return api;
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
