'use strict';
// 관리자 알림 새 창 — PM이 스스로 해결 못 해 사장님 승인·확인이 필요한 일이 새로 생기면 작은 창으로 띄운다.
// 관리자 여부는 서버가 로그인 때 주는 메뉴 응답(bootstrap)의 adminAlerts 표시로 안다. 표시가 없는 일반 계정은 알림 주소를 아예 조회하지 않는다.
// 알림 주소도 관리자 계정에만 200, 그 외 404 로 한 번 더 막는다.
// 창은 포커스를 뺏지 않고 뜬다(입력 중인 업무 화면을 방해하지 않게). 같은 알림은 한 번만 띄운다.
// 닫기는 창을 없애지 않고 작업 표시줄로 내린다: 홈 화면(shell.js·preload.cjs)은 가이드 영상 원본 해시에 묶여 있어
// 다시 여는 버튼을 넣을 수 없으므로, 작업 표시줄의 창이 다시 여는 길이다.
const path = require('node:path');
const { ORIGIN } = require('./policy.cjs');

const ALERTS_URL = 'nenova-app://shell/alerts.html';
const text = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : '');

function adminAlertList(body) {
  if (!body || body.success !== true || !Array.isArray(body.alerts)) return null;
  const seen = new Set();
  return body.alerts.slice(0, 50).flatMap(item => {
    const sig = text(item?.sig, 160), title = text(item?.title, 120);
    if (!sig || !title || seen.has(sig)) return [];
    seen.add(sig);
    return [{ sig, title, since: text(item.since, 20), todo: text(item.todo, 40), approval: item.approval === true,
      detail: text(item.detail, 400), decision: text(item.decision, 240) }];
  });
}

function createAdminAlerts({ BrowserWindow, screen, appDir, preload, fetch, getOwner, allowed, isQuitting = () => false, readSeen, writeSeen, onCreate, setIdentity, onChange = () => {}, now = () => Date.now() }) {
  let owner = '', admin = null, alerts = [], fresh = new Set(), checkedAt = 0, ageSec = null, failed = false, denied = false, window = null, busy = null;

  function snapshot() {
    return { admin: admin === true, failed, checkedAt, ageSec,
      alerts: alerts.map(item => ({ ...item, fresh: fresh.has(item.sig) })) };
  }
  function push() {
    if (window && !window.isDestroyed()) window.webContents.send('alerts:state', snapshot());
    onChange();
  }
  function closeWindow() {
    if (window && !window.isDestroyed()) window.destroy();
    window = null;
  }
  function lower() {
    if (window && !window.isDestroyed()) { window.flashFrame(false); window.minimize(); }
    fresh = new Set();
    if (window && !window.isDestroyed()) window.webContents.send('alerts:state', snapshot());
  }
  function reset(nextOwner = '') {
    owner = nextOwner; admin = null; alerts = []; fresh = new Set(); checkedAt = 0; ageSec = null; failed = false; denied = false;
    closeWindow();
  }
  function show(focus) {
    if (admin !== true) return false;
    if (!window || window.isDestroyed()) {
      const area = screen.getPrimaryDisplay().workArea;
      const width = Math.min(460, area.width), height = Math.min(600, area.height);
      const created = new BrowserWindow({
        width, height, minWidth: 360, minHeight: 320,
        x: area.x + area.width - width - 16, y: area.y + area.height - height - 16,
        title: '네노바 관리자 알림', icon: path.join(appDir, 'assets/icon.png'), backgroundColor: '#ffffff', show: false,
        webPreferences: { preload, nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true }
      });
      window = created;
      setIdentity(created);
      created.setMenuBarVisibility(false);
      created.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      created.webContents.on('will-navigate', event => event.preventDefault());
      created.webContents.on('will-attach-webview', event => event.preventDefault());
      created.once('ready-to-show', () => {
        if (created.isDestroyed()) return;
        if (focus) created.show(); else { created.showInactive(); created.flashFrame(true); }
      });
      created.on('focus', () => { if (!created.isDestroyed()) created.flashFrame(false); });
      created.on('close', event => { if (!isQuitting() && !created.isDestroyed()) { event.preventDefault(); lower(); } });
      created.on('closed', () => { if (window === created) { window = null; fresh = new Set(); } });
      onCreate(created);
      void created.loadURL(ALERTS_URL);
      return true;
    }
    if (focus) { if (window.isMinimized()) window.restore(); window.show(); window.focus(); }
    else if (window.isMinimized() || !window.isVisible()) window.showInactive();
    if (!focus) window.flashFrame(true);
    return true;
  }
  async function run() {
    const current = getOwner();
    if (!current) { if (owner) { reset(); onChange(); } return snapshot(); }
    if (current !== owner) reset(current);
    if (!allowed()) { if (admin !== false) { admin = false; alerts = []; fresh = new Set(); closeWindow(); onChange(); } return snapshot(); }
    if (denied) return snapshot();
    let response;
    try {
      response = await fetch(`${ORIGIN}/api/pm/admin-alerts`, { credentials: 'include', cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(12000) });
    } catch { if (getOwner() === current && owner === current) { failed = true; push(); } return snapshot(); }
    if (getOwner() !== current || owner !== current) return snapshot();
    if (response.status === 404 || response.status === 403) { admin = false; denied = true; closeWindow(); onChange(); return snapshot(); }
    let list = null;
    if (response.ok) { try { list = adminAlertList(await response.json()); } catch { list = null; } }
    if (getOwner() !== current || owner !== current) return snapshot();
    if (!list) { failed = true; push(); return snapshot(); }
    admin = true; failed = false; alerts = list; checkedAt = now();
    const known = new Set(readSeen(current));
    const added = list.filter(item => !known.has(item.sig)).map(item => item.sig);
    fresh = new Set([...fresh].filter(sig => list.some(item => item.sig === sig)).concat(added));
    // 지금 떠 있는 알림만 기억한다: 사라졌다가 다시 생긴 일은 새 알림으로 다시 띄운다.
    if (added.length || known.size !== list.length) writeSeen(current, list.map(item => item.sig));
    if (added.length) show(false);
    push();
    return snapshot();
  }
  return {
    url: ALERTS_URL,
    check() { busy = busy || run().finally(() => { busy = null; }); return busy; },
    open() { return show(true); },
    count() { return admin === true ? alerts.length : null; },
    owns(contents) { return Boolean(window && !window.isDestroyed() && window.webContents === contents); },
    reset() { reset(); },
    snapshot,
    // 클로드에 그대로 붙여 넣을 지시문. 알림 한 건의 제목·내용·정할 것을 담는다.
    prompt(sig) {
      const item = alerts.find(entry => entry.sig === sig);
      if (!item) return '';
      return [`[네노바 PM 알림] ${item.title}${item.since ? ` (${item.since})` : ''}`,
        item.detail ? `내용: ${item.detail}` : '', `정할 것: ${item.decision || item.todo || '사장님 확인 필요'}`, '',
        '위 건을 기록으로 확인한 뒤, 확인한 것·진행 방법·여쭐 것·확인 방법 순서로 보고하고 진행해 줘.'].filter((line, index) => line || index === 3).join('\n');
    },
    close() { lower(); return { closed: true }; }
  };
}

module.exports = { adminAlertList, createAdminAlerts, ALERTS_URL };
