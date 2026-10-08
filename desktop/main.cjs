'use strict';
const { app, BrowserWindow, WebContentsView, ipcMain, protocol, session, screen, dialog, shell, Menu, safeStorage } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { ORIGIN, trustedUrl, externalUrl, safeSnapshot, text } = require('./policy.cjs');
const { parseBootstrap } = require('./bootstrap.cjs');
let menus = [], syncStatus = 'checking', menuVersion = '', webVersion = '';
const SHELL = 'nenova-app://shell/index.html';
function shellInsets(w) { return { top: w.toolsOpen ? 128 : 44, bottom: w.toolsOpen || w.menuOpen ? 28 : 0 }; }
const windows = new Map(), tabs = new Map(), auxiliary = new Set();
let nextId = 1, favorites = [], actor = '', locked = true, quitting = false, restoring = false, saved = null, saveTimer, authTimer, authGeneration = 0;
let webSession, updater;
const { createUpdater, MIN_FREE } = require('./updater.cjs');
protocol.registerSchemesAsPrivileged([{ scheme: 'nenova-app', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
app.setName('Nenova Desktop');
app.setAppUserModelId('com.nenova.workspace');
if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', () => { const w = [...windows.values()][0]?.win; if (w) { if (w.isMinimized()) w.restore(); w.show(); w.focus(); } });

function state(w) {
  return { windowId: w.id, windows: [...windows.values()].map(v => ({ id: v.id, title: `업무 창 ${v.id}` })),
    tabs: w.ids.map(id => tabs.get(id)).filter(Boolean).map(t => ({ id: t.id, title: locked && new URL(t.url).pathname !== '/login' ? '로그인 대기' : t.title, url: locked ? '' : t.url, loading: t.loading, error: t.error, zoom: t.zoom })),
    activeId: w.activeId, menuOpen: w.menuOpen, toolsOpen: w.toolsOpen, favorites: locked ? [] : favorites, menus: locked ? [] : menus, version: app.getVersion(), online: !locked,
    appUpdate: updater?.getState(), syncStatus, webVersion: locked ? '' : webVersion, menuVersion: locked ? '' : menuVersion, notice: w.notice || '',
    message: w.message || (locked ? '로그인이 필요합니다. 업무 화면에서 로그인해 주세요.' : '탭 이동은 작업을 유지합니다 · 종료 전 업무 내용을 저장해 주세요.') };
}
function broadcast() {
  for (const w of windows.values()) if (!w.win.isDestroyed()) w.win.webContents.send('desktop:state', state(w));
  if (!restoring && !quitting && actor && !locked) { clearTimeout(saveTimer); saveTimer = setTimeout(persist, 500); }
}
function reportFailure(w, message) {
  if (!w) return;
  w.message = message;
  w.notice = w.toolsOpen ? '' : message;
}
function snapshot() {
  return safeSnapshot({ actor, favorites, windows: [...windows.values()].map(w => ({ bounds: w.win.getNormalBounds(), maximized: w.win.isMaximized(), active: w.ids.indexOf(w.activeId), tabs: w.ids.map(id => tabs.get(id)) })) });
}
function statePath() { return path.join(app.getPath('userData'), 'workspace.encrypted'); }
function persist(value = snapshot()) {
  if (!safeStorage.isEncryptionAvailable() || !value.actor) return false;
  try { fs.mkdirSync(app.getPath('userData'), { recursive: true }); fs.writeFileSync(statePath() + '.tmp', safeStorage.encryptString(JSON.stringify(value))); fs.renameSync(statePath() + '.tmp', statePath()); return true; }
  catch {
    for (const w of windows.values()) {
      reportFailure(w, '창 구성 저장에 실패했습니다. 디스크 여유 공간을 확인해 주세요.');
      if (!w.win.isDestroyed()) w.win.webContents.send('desktop:state', state(w));
    }
  }
}
function enoughUpdateSpace() {
  try { return [app.getPath('userData'), app.getPath('temp'), path.dirname(app.getPath('exe'))].every(p => { const s = fs.statfsSync(p); return s.bavail * s.bsize >= MIN_FREE; }); } catch { return false; }
}
function prepareUpdate() {
  const w = [...windows.values()].find(w => w.win.isFocused()) || [...windows.values()][0];
  if (!w || !confirm(w, '모든 창이 닫힙니다. 업무를 저장하셨나요? 미저장 입력은 사라집니다.', '재시작하여 업데이트')) return false;
  clearTimeout(saveTimer);
  if (actor && !locked && !persist()) return false;
  return true;
}
function readSaved() {
  try { if (!safeStorage.isEncryptionAvailable() || fs.statSync(statePath()).size > 1024 * 1024) return null; return safeSnapshot(JSON.parse(safeStorage.decryptString(fs.readFileSync(statePath())))); } catch { return null; }
}
function layout(w) {
  if (w.win.isDestroyed()) return;
  const [width, height] = w.win.getContentSize();
  const { top, bottom } = shellInsets(w);
  for (const id of w.ids) {
    const t = tabs.get(id); if (!t) continue;
    t.view.setBounds({ x: 0, y: top, width, height: Math.max(1, height - top - bottom) });
    t.view.setVisible(!w.menuOpen && id === w.activeId && (!locked || new URL(t.url).pathname === '/login'));
  }
}
function syncRemoteTools(t) {
  const wc = t?.view?.webContents;
  if (!wc || wc.isDestroyed()) return;
  const w = windows.get(t.windowId);
  if (!w) return;
  const value = w.toolsOpen ? 'open' : 'closed';
  wc.executeJavaScript(`document.documentElement.dataset.nenovaDesktopTools = ${JSON.stringify(value)}`).catch(() => {});
}
function boundsOnScreen(bounds) {
  const displays = screen.getAllDisplays();
  const b = bounds || { ...screen.getPrimaryDisplay().workArea, width: 1600, height: 1000 };
  const d = displays.find(({ workArea: a }) => b.x + 100 > a.x && b.x < a.x + a.width - 100 && b.y + 50 > a.y && b.y < a.y + a.height - 50) || screen.getPrimaryDisplay();
  const a = d.workArea, width = Math.min(a.width, Math.max(800, b.width)), height = Math.min(a.height, Math.max(600, b.height));
  return { width, height, x: Math.max(a.x, Math.min(b.x, a.x + a.width - width)), y: Math.max(a.y, Math.min(b.y, a.y + a.height - height)) };
}
function createWindow(config = {}) {
  const id = String(nextId++);
  const win = new BrowserWindow({ ...boundsOnScreen(config.bounds), minWidth: 800, minHeight: 600, title: '네노바 업무', titleBarStyle: 'hidden', titleBarOverlay: { color: '#e9eef6', symbolColor: '#244766', height: 44 }, icon: path.join(__dirname, 'assets', 'icon.png'), backgroundColor: '#eef3fa', show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true, devTools: !app.isPackaged } });
  const w = { id, win, ids: [], activeId: null, menuOpen: true, toolsOpen: false, message: '', notice: '', confirmedClose: false };
  windows.set(id, w);
  win.setMenuBarVisibility(false);
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', e => e.preventDefault());
  win.webContents.on('will-attach-webview', e => e.preventDefault());
  win.on('resize', () => { layout(w); broadcast(); });
  win.on('move', broadcast);
  win.on('close', e => {
    if (quitting || w.confirmedClose) return;
    e.preventDefault();
    if (windows.size === 1) quit(); else closeWindow(w);
  });
  win.on('closed', () => {
    for (const id of [...w.ids]) destroyTab(tabs.get(id));
    windows.delete(w.id); broadcast();
  });
  win.webContents.on('did-finish-load', () => { layout(w); broadcast(); });
  shortcuts(win.webContents, () => w);
  win.loadURL(SHELL);
  win.once('ready-to-show', () => { if (config.maximized) win.maximize(); win.show(); });
  broadcast(); return w;
}
function confirm(w, message, actionLabel = '닫기') {
  return dialog.showMessageBoxSync(w.win, { type: 'question', title: '작업 확인', message, detail: '저장하지 않은 입력은 복원되지 않을 수 있습니다. 탭 이동·창 분리는 입력을 유지합니다.', buttons: [actionLabel, '취소'], defaultId: 1, cancelId: 1, noLink: true }) === 0;
}
function destroyTab(t) {
  if (!t) return;
  const w = windows.get(t.windowId);
  if (w) { if (!w.win.isDestroyed()) w.win.contentView.removeChildView(t.view); w.ids = w.ids.filter(id => id !== t.id); if (w.activeId === t.id) w.activeId = w.ids.at(-1) || null; if (!w.ids.length) w.menuOpen = true; }
  tabs.delete(t.id);
  t.destroying = true;
  const contents = t.view.webContents;
  if (contents && !contents.isDestroyed()) contents.close();
  if (w) layout(w);
}
function closeTab(t, ask = true) {
  if (!t) return;
  const w = windows.get(t.windowId);
  if (ask && !confirm(w, `“${t.title}” 탭을 닫을까요?`)) return;
  t.closing = true;
  t.view.webContents.close({ waitForBeforeUnload: true });
}
function closeWindow(w) {
  if (w.ids.length && !confirm(w, '이 창의 모든 탭에서 미저장 입력을 버리고 창을 닫을까요?')) return;
  w.confirmedClose = true; w.win.close();
}
function quit() {
  if (quitting) return;
  const w = [...windows.values()].find(w => w.win.isFocused()) || [...windows.values()][0];
  if (tabs.size && w && !confirm(w, '모든 탭의 미저장 입력을 버리고 네노바 프로그램을 종료할까요?')) return;
  clearTimeout(saveTimer); if (actor && !locked) persist();
  quitting = true; app.quit();
}
function activate(w, id) {
  if (!w.ids.includes(id)) return;
  w.activeId = id; w.menuOpen = false; layout(w); broadcast();
  const t = tabs.get(id); if (!locked || new URL(t.url).pathname === '/login') t.view.webContents.focus();
}
async function openExternal(w, input) {
  const url = externalUrl(input); if (!url) return;
  const result = await dialog.showMessageBox(w.win, { type: 'question', title: '외부 링크', message: '기본 브라우저에서 외부 사이트를 열까요?', detail: new URL(url).origin, buttons: ['취소', '열기'], defaultId: 0, cancelId: 0 });
  if (result.response === 1) await shell.openExternal(url);
}
function secureContents(wc, owner) {
  wc.on('will-attach-webview', e => e.preventDefault());
  wc.on('will-navigate', (e, url) => { if (!trustedUrl(url, { popup: false })) { e.preventDefault(); openExternal(owner(), url).catch(() => {}); } });
  wc.on('will-redirect', (e, url) => { if (!trustedUrl(url, { popup: false })) e.preventDefault(); });
  wc.on('will-frame-navigate', e => {
    if (e.isMainFrame && !trustedUrl(e.url, { popup: false }) && e.url !== 'about:blank') e.preventDefault();
    if (!e.isMainFrame && !/^(https:|about:blank|blob:https:\/\/nenovaweb\.com\/)/.test(e.url)) e.preventDefault();
  });
  wc.on('will-prevent-unload', e => {
    const t = [...tabs.values()].find(t => t.view.webContents === wc);
    if (confirm(owner(), '화면이 저장되지 않은 변경을 감지했습니다. 화면을 떠날까요?', t?.closing ? '닫기' : '이동')) e.preventDefault();
    else if (t) t.closing = false;
  });
  wc.setWindowOpenHandler(details => {
    const w = owner();
    const url = trustedUrl(details.url);
    if (!locked && tabs.size < 50 && (url || details.url === 'about:blank' || details.url === '')) {
      return { action: 'allow', overrideBrowserWindowOptions: { webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true, preload: undefined, devTools: !app.isPackaged } },
        createWindow: options => {
          const t = openTab(w, { url: details.url || 'about:blank', title: details.frameName || '새 업무' }, options);
          if (!options.webContents) t.view.webContents.loadURL(details.url || 'about:blank').catch(() => {});
          return t.view.webContents;
        }
      };
    }
    if (!url) openExternal(w, details.url).catch(() => {});
    return { action: 'deny' };
  });
  wc.on('did-create-window', child => { auxiliary.add(child); secureContents(child.webContents, owner); child.on('closed', () => auxiliary.delete(child)); });
  shortcuts(wc, owner);
  wc.on('context-menu', (_event, p) => {
    const template = [];
    if (p.isEditable) template.push({ role: 'undo', label: '실행 취소' }, { role: 'redo', label: '다시 실행' }, { type: 'separator' }, { role: 'cut', label: '잘라내기' }, { role: 'copy', label: '복사' }, { role: 'paste', label: '붙여넣기' }, { role: 'selectAll', label: '전체 선택' });
    else if (p.selectionText) template.push({ role: 'copy', label: '복사' });
    if (trustedUrl(p.linkURL)) template.push({ label: '새 업무 탭으로 열기', click: () => openTab(owner(), { url: p.linkURL }) });
    if (template.length) Menu.buildFromTemplate(template).popup({ window: owner().win });
  });
}
function openTab(w, data = {}, adoption = null) {
  let url = adoption && data.url === 'about:blank' ? 'about:blank' : trustedUrl(data.url || '/dashboard');
  if (!url) return null;
  if (locked && new URL(url).pathname !== '/login') url = `${ORIGIN}/login`;
  if (tabs.size >= 50) { reportFailure(w, '열린 탭이 50개입니다. 사용하지 않는 탭을 닫아 주세요.'); broadcast(); return null; }
  const id = String(nextId++);
  const view = new WebContentsView({ ...(adoption?.webContents ? { webContents: adoption.webContents } : {}), webPreferences: { session: webSession, nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true, allowRunningInsecureContent: false, devTools: !app.isPackaged } });
  const t = { id, windowId: w.id, view, url, title: text(data.title) || '네노바 업무', customTitle: Boolean(data.title), zoom: Number.isFinite(data.zoom) ? Math.min(1.5, Math.max(.5, data.zoom)) : 1, loading: true, error: '' };
  tabs.set(id, t); w.ids.push(id); w.win.contentView.addChildView(view);
  const wc = view.webContents;
  wc.setZoomMode('isolated');
  secureContents(wc, () => windows.get(t.windowId));
  wc.on('did-start-loading', () => { t.loading = true; t.error = ''; broadcast(); });
  wc.on('did-stop-loading', () => { t.loading = false; broadcast(); });
  const navigation = (_e, newUrl) => { if (trustedUrl(newUrl, { popup: false })) { t.url = newUrl; layout(windows.get(t.windowId)); broadcast(); } };
  wc.on('did-navigate', navigation); wc.on('did-navigate-in-page', navigation);
  wc.on('page-title-updated', (_e, title) => { if (!t.customTitle) t.title = text(title) || t.title; broadcast(); });
  wc.on('did-fail-load', (_e, code, description, _url, mainFrame) => { if (mainFrame && code !== -3) { t.error = '화면을 불러오지 못했습니다. 연결을 확인하고 새로고침해 주세요.'; t.loading = false; reportFailure(windows.get(t.windowId), t.error); broadcast(); } });
  wc.on('render-process-gone', () => { t.error = '화면이 중단되었습니다. 새로고침해 주세요. 저장 여부를 먼저 확인해 주세요.'; reportFailure(windows.get(t.windowId), t.error); broadcast(); });
  wc.on('close', e => { if (!t.destroying && !t.closing) { e.preventDefault(); closeTab(t); } });
  wc.on('destroyed', () => { if (tabs.has(t.id)) { destroyTab(t); broadcast(); } });
  wc.on('did-finish-load', () => { wc.setZoomFactor(t.zoom); syncRemoteTools(t); });
  if (!adoption) wc.loadURL(url).catch(() => {}); activate(w, id); return t;
}
function moveTab(t, target, beforeId) {
  if (!t || !target) return;
  const source = windows.get(t.windowId);
  if (source !== target) { source.win.contentView.removeChildView(t.view); source.ids = source.ids.filter(id => id !== t.id); if (source.activeId === t.id) source.activeId = source.ids.at(-1) || null; if (!source.ids.length) source.menuOpen = true; target.win.contentView.addChildView(t.view); t.windowId = target.id; layout(source); }
  target.ids = target.ids.filter(id => id !== t.id);
  const index = target.ids.indexOf(beforeId); target.ids.splice(index < 0 ? target.ids.length : index, 0, t.id);
  activate(target, t.id); syncRemoteTools(t); target.win.show(); target.win.focus();
}
function detach(t, point) {
  if (!t) return;
  const source = windows.get(t.windowId);
  const b = source.win.getNormalBounds();
  const target = createWindow({ bounds: { ...b, x: point?.x ?? b.x + 40, y: point?.y ?? b.y + 40 } });
  moveTab(t, target);
}
function shortcuts(wc, owner) {
  wc.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    const key = input.key.toLowerCase(), w = owner(); if (!w) return;
    let action;
    if (input.control && key === 't') action = () => command(w, 'menu', { open: true });
    if (input.control && key === 'w') action = () => closeTab(tabs.get(w.activeId));
    if (input.control && key === 'n') action = () => createWindow();
    if (input.control && key === 'tab') action = () => { const i = w.ids.indexOf(w.activeId), n = w.ids.length; if (n) activate(w, w.ids[(i + (input.shift ? n - 1 : 1)) % n]); };
    if (input.control && key === 'p') action = () => command(w, 'print');
    if ((input.control && key === 'r') || key === 'f5') action = () => command(w, 'reload');
    if (input.control && key === 'd') action = () => command(w, 'favorite', { id: w.activeId });
    if (input.control && ['l', 'k'].includes(key)) action = () => command(w, 'menu', { open: true });
    if (input.control && input.shift && key === 'b') action = () => command(w, 'tools');
    if (input.alt && key === 'arrowleft') action = () => command(w, 'navigate', { direction: 'back' });
    if (input.alt && key === 'arrowright') action = () => command(w, 'navigate', { direction: 'forward' });
    if (action) { event.preventDefault(); action(); }
  });
}
function command(w, action, p = {}) {
  const t = tabs.get(typeof p.id === 'string' ? p.id : w.activeId);
  switch (action) {
    case 'state': break;
    case 'appUpdate': { const phase = updater?.getState().phase; if (phase === 'available') updater.download(); else if (phase === 'downloaded') updater.install(); else updater?.check(); break; }
    case 'cancelUpdate': updater?.cancel(); break;
    case 'sync': verifyAccount().catch(() => {}); break;
    case 'open': openTab(w, p); break;
    case 'activate': activate(w, p.id); break;
    case 'close': if (t?.windowId === w.id) closeTab(t); break;
    case 'reorder': if (t) moveTab(t, w, p.beforeId); break;
    case 'move': if (t?.windowId === w.id) moveTab(t, windows.get(p.targetWindowId)); break;
    case 'detach': if (t?.windowId === w.id) detach(t); break;
    case 'dragEnd': {
      if (!t || t.windowId !== w.id || !Number.isFinite(p.screenX) || !Number.isFinite(p.screenY)) break;
      const point = screen.getCursorScreenPoint();
      const target = [...windows.values()].find(v => { const b = v.win.getBounds(); return point.x >= b.x && point.x <= b.x + b.width && point.y >= b.y && point.y <= b.y + b.height; });
      if (target && target !== w) moveTab(t, target); else if (!target) detach(t, point);
      break;
    }
    case 'menu': w.menuOpen = p.open === true || !w.ids.length; layout(w); if (w.menuOpen || !t || locked) w.win.webContents.focus(); else t.view.webContents.focus(); break;
    case 'tools':
      w.toolsOpen = !w.toolsOpen;
      if (w.toolsOpen) w.notice = '';
      layout(w);
      for (const id of w.ids) syncRemoteTools(tabs.get(id));
      if (!w.toolsOpen) {
        w.win.webContents.focus();
        w.win.webContents.executeJavaScript('document.getElementById("toolsButton")?.focus()').catch(() => {});
      }
      break;
    case 'favorite': if (t && actor && !locked) { const url = safeSnapshot({ favorites: [t] }).favorites[0]?.url; if (url) favorites = favorites.some(f => f.url === url) ? favorites.filter(f => f.url !== url) : [...favorites, { url, title: t.title, zoom: t.zoom }]; } break;
    case 'rename': if (t?.windowId === w.id && text(p.title)) { t.title = text(p.title); t.customTitle = true; } break;
    case 'navigate': if (t && !locked && confirm(w, '이전·다음 화면으로 이동할까요?', '이동')) { const h = t.view.webContents.navigationHistory; if (p.direction === 'back' && h.canGoBack()) h.goBack(); if (p.direction === 'forward' && h.canGoForward()) h.goForward(); } break;
    case 'reload': if (t && confirm(w, '현재 화면을 새로고침할까요?', '새로고침')) { w.message = ''; if (locked) verifyAccount(); t.view.webContents.reload(); } break;
    case 'zoom': if (t && Number.isFinite(p.value)) { t.zoom = Math.round(Math.min(1.5, Math.max(.5, p.value)) * 100) / 100; t.view.webContents.setZoomFactor(t.zoom); } break;
    case 'print': if (t && !locked) t.view.webContents.print({ silent: false, printBackground: true }, (ok, reason) => { if (!ok && reason !== 'cancelled') { reportFailure(w, '인쇄를 완료하지 못했습니다. 프린터 설정을 확인해 주세요.'); broadcast(); } }); break;
    case 'newWindow': createWindow(); break;
    case 'closeWindow': closeWindow(w); break;
    case 'quit': quit(); break;
    default: throw new Error('지원하지 않는 동작');
  }
  broadcast(); return state(w);
}
function lockAccount() {
  locked = true;
  clearTimeout(saveTimer);
  for (const t of tabs.values()) if (new URL(t.url).pathname !== '/login') { t.view.webContents.stop(); t.view.setVisible(false); }
  for (const w of auxiliary) w.destroy();
  broadcast();
}
async function verifyAccount(initial = false) {
  const generation = ++authGeneration;
  syncStatus = 'checking'; broadcast();
  let newActor = '';
  try {
    const response = await webSession.fetch(`${ORIGIN}/api/auth/me`, { credentials: 'include', cache: 'no-store', signal: AbortSignal.timeout(12000) });
    const data = response.ok ? await response.json() : null;
    if (data?.success && typeof data.user?.userId === 'string') newActor = data.user.userId;
  } catch { /* Fail closed; the existing login screen remains available. */ }
  if (generation !== authGeneration || quitting) return;
  if (!newActor) {
    menus = []; syncStatus = 'error';
    lockAccount();
    const w = [...windows.values()][0] || createWindow();
    if (![...tabs.values()].some(t => new URL(t.url).pathname === '/login')) openTab(w, { url: '/login', title: '네노바 로그인' });
    return;
  }
  const changed = actor !== newActor;
  if (changed) lockAccount();
  let latest = null;
  try {
    const response = await webSession.fetch(`${ORIGIN}/api/desktop/bootstrap`, { credentials: 'include', cache: 'no-store', signal: AbortSignal.timeout(12000) });
    if (!response.ok) throw new Error('Bootstrap unavailable');
    const body = await response.text();
    if (body.length > 256 * 1024) throw new Error('Bootstrap too large');
    latest = parseBootstrap(JSON.parse(body), newActor);
    if (generation !== authGeneration || quitting) return;
    if (!webVersion || latest.webVersion !== webVersion) await webSession.clearCache();
  } catch { latest = null; }
  if (generation !== authGeneration || quitting) return;
  const updatedOpenViews = latest && webVersion && latest.webVersion !== webVersion && !changed && tabs.size > 0;
  menus = latest?.menus || [];
  menuVersion = latest?.menuVersion || '';
  webVersion = latest?.webVersion || '';
  syncStatus = latest ? 'ready' : 'error';
  if (changed) {
    restoring = true;
    const previousActor = actor || saved?.actor;
    for (const t of [...tabs.values()]) destroyTab(t);
    if (previousActor !== newActor) {
      try {
        await webSession.clearStorageData({ origin: ORIGIN, storages: ['localstorage', 'indexdb', 'serviceworkers', 'cachestorage', 'websql', 'filesystem'] });
        await webSession.clearCache();
      } catch {
        restoring = false;
        const w = [...windows.values()][0] || createWindow();
        reportFailure(w, '이전 계정의 화면 정리를 완료하지 못했습니다. 새로고침으로 다시 시도해 주세요.');
        openTab(w, { url: '/login', title: '로그인 다시 확인' }); broadcast(); return;
      }
      if (generation !== authGeneration || quitting) { restoring = false; return; }
    }
    actor = newActor; favorites = []; locked = false;
    if (saved?.actor === actor && saved.windows.length) {
      favorites = saved.favorites;
      const existing = [...windows.values()];
      saved.windows.forEach((config, i) => {
        const w = existing[i] || createWindow(config);
        if (existing[i]) { w.win.setBounds(boundsOnScreen(config.bounds)); if (config.maximized) w.win.maximize(); }
        for (const entry of config.tabs) openTab(w, entry);
        if (w.ids.length) activate(w, w.ids[Math.min(config.active, w.ids.length - 1)]);
        w.menuOpen = true;
      });
    } else {
      for (const w of windows.values()) { w.menuOpen = true; w.message = '로그인되었습니다. 업무 메뉴를 선택해 새 탭을 여세요.'; }
    }
    saved = null; restoring = false;
  } else locked = false;
  const count = menus.reduce((sum, group) => sum + group.items.length, 0);
  for (const w of windows.values()) {
    if (latest) w.message = `웹 최신 메뉴 ${count}개 반영 완료${updatedOpenViews ? ' · 작업 중인 화면은 저장 후 새로고침하면 최신 기능이 적용됩니다.' : ' · 새로 여는 화면은 최신 웹 기능을 사용합니다.'}`;
    else reportFailure(w, '최신 메뉴 확인에 실패했습니다. 업데이트 확인으로 다시 시도하거나 네노바 홈에서 업무를 여세요.');
  }
  for (const w of windows.values()) layout(w);
  broadcast();
}
app.whenReady().then(async () => {
  const enabled = app.isPackaged && process.platform === 'win32';
  const engine = enabled ? require('electron-updater').autoUpdater : null;
  updater = createUpdater({ engine, enabled, enoughSpace: enoughUpdateSpace, prepareInstall: prepareUpdate, notify: () => broadcast() });
  if (engine) {
    require('electron').autoUpdater.on('before-quit-for-update', () => { quitting = true; });
    engine.on('error', () => { quitting = false; });
  }
  protocol.handle('nenova-app', request => {
    const u = new URL(request.url);
    const name = u.pathname.slice(1);
    if (u.hostname !== 'shell' || !['index.html','shell.js','shell.css'].includes(name)) return new Response('Not found', { status: 404 });
    return new Response(fs.readFileSync(path.join(__dirname, 'shell', name)), { headers: { 'content-type': name.endsWith('.html') ? 'text/html; charset=utf-8' : name.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'text/css; charset=utf-8', 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-src 'none'" } });
  });
  webSession = session.fromPartition('persist:nenova-work');
  const desktopUa = webSession.getUserAgent();
  webSession.setUserAgent(`${desktopUa.replace(/\bNenovaDesktop\/[\d.]+\b/g, '').trim()} NenovaDesktop/${require('./package.json').version}`);
  webSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  webSession.setPermissionCheckHandler(() => false);
  webSession.webRequest.onBeforeRequest({ urls: [`${ORIGIN}/*`] }, (details, callback) => {
    const pathname = new URL(details.url).pathname;
    callback({ cancel: locked && !['GET', 'HEAD', 'OPTIONS'].includes(details.method) && !['/api/auth/login', '/api/auth/logout'].includes(pathname) });
  });
  webSession.on('will-download', (_e, item, wc) => {
    const owner = [...tabs.values()].find(t => t.view.webContents === wc);
    const w = windows.get(owner?.windowId) || [...windows.values()][0];
    item.setSaveDialogOptions({ title: '네노바 파일 저장', defaultPath: path.join(app.getPath('downloads'), path.basename(item.getFilename()).replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')) });
    item.once('done', (_event, status) => { if (w && windows.has(w.id)) { if (status === 'completed') w.message = '파일 저장을 완료했습니다.'; else if (status === 'cancelled') w.message = '파일 저장을 취소했습니다.'; else reportFailure(w, '파일 저장에 실패했습니다. 다시 다운로드해 주세요.'); broadcast(); } });
  });
  ipcMain.handle('desktop:command', (event, action, payload) => {
    const w = [...windows.values()].find(w => w.win.webContents === event.sender);
    if (!w || event.senderFrame !== event.sender.mainFrame || event.senderFrame.url !== SHELL) throw new Error('신뢰할 수 없는 요청');
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('잘못된 요청');
    return command(w, action, payload);
  });
  Menu.setApplicationMenu(null);
  saved = readSaved(); createWindow();
  webSession.cookies.on('changed', (_event, cookie) => {
    if (cookie.name !== 'nenovaToken' || !['nenovaweb.com', '.nenovaweb.com'].includes(cookie.domain)) return;
    lockAccount(); ++authGeneration; clearTimeout(authTimer); authTimer = setTimeout(() => verifyAccount(), 150);
  });
  await verifyAccount(true);
});
app.on('before-quit', e => { if (!quitting && windows.size) { e.preventDefault(); quit(); } });
app.on('window-all-closed', () => { if (!quitting) { quitting = true; app.quit(); } });
// Export only to the local Node test runner. No renderer receives this object.
module.exports = { windows, tabs, command, createWindow, moveTab, snapshot, verifyAccount };
