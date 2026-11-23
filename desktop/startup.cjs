'use strict';
const fs = require('node:fs');
const path = require('node:path');
const NAME = 'NenovaDesktop';
const ARGS = ['nenova-autostart'];
function createStartup({ app, platform = process.platform, execPath = process.execPath, read, write }) {
  const supported = platform === 'win32' && app.isPackaged;
  const file = () => path.join(app.getPath('userData'), 'startup.json');
  read ||= () => { try { return JSON.parse(fs.readFileSync(file(), 'utf8')); } catch (e) { if (e.code === 'ENOENT') return null; throw e; } };
  write ||= value => { fs.mkdirSync(path.dirname(file()), { recursive: true }); fs.writeFileSync(file() + '.tmp', JSON.stringify(value)); fs.renameSync(file() + '.tmp', file()); };
  const options = { path: execPath, args: ARGS };
  let failure = false;
  function state() {
    if (!supported) return { supported: false, enabled: false, message: '설치된 Windows 앱에서 사용할 수 있습니다.' };
    try {
      const actual = app.getLoginItemSettings(options);
      const own=actual.launchItems?.find(item=>item.name===NAME&&item.path?.replace(/^"|"$/g,'').toLowerCase()===execPath.toLowerCase()&&JSON.stringify(item.args)===JSON.stringify(ARGS));
      return { supported: true, enabled: !!own?.enabled && actual.executableWillLaunchAtLogin===true,
        message: failure ? '자동 실행 설정을 확인하지 못했습니다. 다시 시도해 주세요.' : '' };
    } catch { return { supported: true, enabled: false, message: 'Windows 시작 앱 설정을 확인해 주세요.' }; }
  }
  function set(enabled) {
    if (!supported || typeof enabled !== 'boolean') throw Error('자동 실행 설정을 확인하세요.');
    try {
      // Save intent before touching Windows so a failed write never loses an opt-out.
      write({ initialized: true, enabled });
      app.setLoginItemSettings({ ...options, name: NAME, openAtLogin: enabled, enabled });
      failure = false;
      const result = state();
      if (result.message || Boolean(result.enabled) !== enabled) throw Error('STARTUP_VERIFY_FAILED');
      return result;
    } catch { failure = true; throw Error('자동 실행 설정을 저장하지 못했습니다. Windows 시작 앱을 확인해 주세요.'); }
  }
  function initialize() {
    if (!supported) return state();
    try {
      const prior = read();
      if (prior) return state(); // Never override an OS/user opt-out on later launches.
      const actual = app.getLoginItemSettings(options);
      const registered = actual.launchItems?.some(item => item.name === NAME);
      if (registered || actual.openAtLogin) { write({ initialized: true }); return state(); }
      return set(true);
    } catch { failure = true; return state(); }
  }
  return { initialize, state, set };
}
function startupDelay({ packaged, argv, random = Math.random }) {
  return packaged && argv.includes('nenova-autostart') ? 15000 + Math.floor(random() * 30000) : 0;
}
module.exports = { createStartup, startupDelay, NAME, ARGS };
