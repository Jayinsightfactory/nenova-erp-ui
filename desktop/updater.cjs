'use strict';
const fs = require('node:fs');
const path = require('node:path');

// Only main owns the feed and installer. The web renderer never supplies URLs.
const FEED = 'https://github.com/Jayinsightfactory/nenova-erp-ui/releases/latest/download';
// Zero-cost feed chain: the Cafe24 static feed is tried first (it keeps working after the GitHub
// repository goes private); GitHub Releases stays as the unchanged fallback. FEED remains the
// baked-in publish URL of already installed apps.
const FEED_PRIMARY = 'https://nenovaweb.com/desktop-releases';
const FEED_CHAIN = Object.freeze([FEED_PRIMARY, FEED]);
const MIN_FREE = 1024 ** 3;
const UPDATE_STATE_FILE = 'desktop-update-state.json';

function localDateKey(value = Date.now()) {
  const date = value instanceof Date ? value : new Date(value);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function createUpdateStateStore(userDataPath = '') {
  let memory = { lastCheckedDate: '', checkedAt: '', version: '', phase: '' };
  if (!userDataPath) {
    return {
      read: () => ({ ...memory }),
      write: (next) => { memory = { ...memory, ...next }; },
    };
  }
  const file = path.join(userDataPath, UPDATE_STATE_FILE);
  return {
    file,
    read() {
      try {
        const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (parsed && typeof parsed === 'object' && /^\d{4}-\d{2}-\d{2}$/.test(parsed.lastCheckedDate)) {
          return {
            lastCheckedDate: parsed.lastCheckedDate,
            checkedAt: typeof parsed.checkedAt === 'string' ? parsed.checkedAt : '',
            version: typeof parsed.version === 'string' ? parsed.version : '',
            phase: typeof parsed.phase === 'string' ? parsed.phase : '',
          };
        }
      } catch { /* Missing or corrupt state falls back cleanly to a fresh daily check. */ }
      return { ...memory };
    },
    write(next) {
      memory = { ...memory, ...next };
      try {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        const tmp = `${file}.tmp-${process.pid}`;
        fs.writeFileSync(tmp, JSON.stringify(memory), 'utf8');
        fs.renameSync(tmp, file);
      } catch { /* In-memory state still prevents duplicate checks within the session. */ }
    },
  };
}

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
function createUpdater({ engine, enabled, notify, enoughSpace, prepareInstall, feeds = FEED_CHAIN }) {
  let state = { phase: enabled ? 'idle' : 'unavailable', version: '', percent: 0, message: enabled ? '앱 업데이트를 확인할 수 있습니다.' : '설치된 Windows 앱에서 업데이트할 수 있습니다.' };
  let token, installBusy = false;
  const emit = (patch) => { state = { ...state, ...patch }; notify({ ...state }); };
  // Feeds are tried in order. A 404, network error or malformed metadata moves on to the next
  // feed; the first feed that answers with valid metadata wins (even if it offers nothing newer).
  async function checkFeeds() {
    let last;
    for (const url of feeds) {
      try {
        if (typeof engine.setFeedURL === 'function') engine.setFeedURL({ provider: 'generic', url });
        const result = await engine.checkForUpdates();
        if (!result || !validInfo(result.updateInfo)) throw Error('Invalid update metadata');
        return result;
      } catch (error) { last = error; }
    }
    throw last || Error('No update feed');
  }
  const fail = () => emit({ phase: 'error', message: '업데이트에 실패했습니다. 네트워크와 저장 공간을 확인한 뒤 다시 확인해 주세요.' });
  if (engine) {
    engine.autoDownload = false;
    engine.autoInstallOnAppQuit = true;
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
        const result = await checkFeeds();
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
        emit({ phase: 'downloaded', percent: 100, message: '다운로드 완료. 지금 재시작하거나 앱을 종료하면 업데이트가 적용됩니다.' });
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
// One scheduler per application, shared by all windows.
// Automatic checks run at most ONCE per local calendar day (YYYY-MM-DD persisted in
// userData/desktop-update-state.json) on the first authenticated online launch of the day.
// Explicit manual checks (Home update button or { manual: true / force: true }) and
// NENOVA_FORCE_UPDATE_CHECK=1 bypass the daily gate.
function createUpdateScheduler({
  updater,
  isReady,
  isOnline,
  userDataPath = '',
  readState,
  writeState,
  env = process.env,
  now = Date.now,
  dateKey = localDateKey,
}) {
  const defaultStore = createUpdateStateStore(userDataPath);
  const read = typeof readState === 'function' ? readState : () => defaultStore.read();
  const write = typeof writeState === 'function' ? writeState : next => defaultStore.write(next);
  let sessionCheckedDate = '';
  let busy = false;
  return {
    async tick(options = false) {
      const manualOrForce = Boolean(
        (typeof options === 'object' && options !== null && (options.force === true || options.manual === true)) ||
        env?.NENOVA_FORCE_UPDATE_CHECK === '1'
      );
      if (!isOnline() || !isReady() || busy) return false;
      if (!['idle', 'current', 'error'].includes(updater.getState().phase)) return false;
      const time = now();
      const today = dateKey(time);
      if (!manualOrForce) {
        const persisted = read();
        if (sessionCheckedDate === today || persisted?.lastCheckedDate === today) return false;
      }
      busy = true;
      try {
        await updater.check();
        const latestState = updater.getState();
        sessionCheckedDate = today;
        write({
          lastCheckedDate: today,
          checkedAt: new Date(time).toISOString(),
          version: latestState.version || '',
          phase: latestState.phase || '',
        });
        if (isReady() && isOnline() && latestState.phase === 'available') {
          await updater.download();
          if (isReady() && updater.getState().phase === 'downloaded') await updater.install();
        }
        return true;
      } finally {
        busy = false;
      }
    },
  };
}
module.exports = {
  createUpdater,
  createUpdateScheduler,
  createUpdateStateStore,
  localDateKey,
  validInfo,
  releaseNoteLines,
  FEED,
  FEED_PRIMARY,
  FEED_CHAIN,
  MIN_FREE,
  UPDATE_STATE_FILE,
};
