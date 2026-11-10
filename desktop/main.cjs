'use strict';
const { app, BrowserWindow, WebContentsView, ipcMain, protocol, session, screen, dialog, shell, Menu, safeStorage, net, Notification, clipboard } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { ORIGIN, trustedUrl, externalUrl, safeSnapshot, safeFavorites, text } = require('./policy.cjs');
const { parseBootstrap } = require('./bootstrap.cjs');
const { homeWorkspaceRequest } = require('./home-workspace.cjs');
const { createActivity } = require('./activity.cjs');
let menus = [], syncStatus = 'checking', menuVersion = '', webVersion = '';
const SHELL = 'nenova-app://shell/index.html';
const NOTES = 'nenova-app://shell/notes.html';
function shellInsets(w) { return { top: w.toolsOpen ? 128 : 44, bottom: w.toolsOpen || w.menuOpen ? 28 : 0 }; }
const windows = new Map(), tabs = new Map(), auxiliary = new Set();
const { syncAccountFavorites } = require('./account-favorites.cjs');
let favoritesMigrated = false, favoriteQueue = Promise.resolve();
function accountFavorites(action, w) {
  const owner = actor, generation = authGeneration;
  const current = () => !!owner && !locked && owner === actor && generation === authGeneration;
  const task = async () => {
    if (!current()) return;
    try {
      const entries = await syncAccountFavorites({ owner, fetch: (url, options) => webSession.fetch(url, options),
        current, legacy: favoritesMigrated ? [] : favorites, action });
      if (!current()) return;
      if (favoritesMigrated && !action && JSON.stringify(entries) === JSON.stringify(favorites)) return;
      favorites = entries;
      favoritesMigrated = true;
    } catch (error) {
      if (current()) reportFailure(w || [...windows.values()][0], error.message);
    }
    if (current()) broadcast();
  };
  favoriteQueue = favoriteQueue.then(task, task);
  return favoriteQueue;
}
let nextId = 1, favorites = [], actor = '', locked = true, quitting = false, restoring = false, saved = null, saveTimer, authTimer, authGeneration = 0;
let webSession, updater, updateScheduler, updateTimer, logoutInProgress = false;
let activity, activityTimer, activityWarning = '';
let notesWindow = null, notesTimer = null;
let aiBridge = null;
const { createUpdater, createUpdateScheduler, MIN_FREE } = require('./updater.cjs');
protocol.registerSchemesAsPrivileged([{ scheme: 'nenova-app', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
app.setName('Nenova Desktop');
app.setAppUserModelId('com.nenova.workspace');
if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', (_event, argv) => { if (argv.some(arg => /^nenova-notes:\/\/open\/?$/i.test(arg)) && !locked) { openNotesWindow(); return; } const w = [...windows.values()][0]?.win; if (w) { if (w.isMinimized()) w.restore(); w.show(); w.focus(); } });

function menuFavoriteEntry(item) { return safeSnapshot({ favorites: [{ url: item.href, title: item.labelKey }] }).favorites[0]; }
function state(w) {
  return { windowId: w.id, windows: [...windows.values()].map(v => ({ id: v.id, title: `업무 창 ${v.id}` })),
    tabs: w.ids.map(id => tabs.get(id)).filter(Boolean).map(t => ({ id: t.id, title: locked && new URL(t.url).pathname !== '/login' ? '로그인 대기' : t.title, url: locked ? '' : t.url, loading: t.loading, error: t.error, zoom: t.zoom })),
    activeId: w.activeId, menuOpen: w.menuOpen, toolsOpen: w.toolsOpen, favorites: locked ? [] : favorites, menus: locked ? [] : menus.map(group => ({ ...group, items: group.items.map(item => ({ ...item, favorite: favorites.some(f => f.url === menuFavoriteEntry(item)?.url) })) })), version: app.getVersion(), online: !locked,
    appUpdate: updater?.getState(), homeOwnerId: locked ? '' : actor, syncStatus, webVersion: locked ? '' : webVersion, menuVersion: locked ? '' : menuVersion, notice: w.notice || activityWarning,
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
  return safeSnapshot({ actor, favorites, favoritesMigrated, windows: [...windows.values()].map(w => ({ bounds: w.win.getNormalBounds(), maximized: w.win.isMaximized(), active: w.ids.indexOf(w.activeId), tabs: w.ids.map(id => tabs.get(id)) })) });
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
    // Finish the cancelled native close event before app.quit starts a new close
    // cycle. Re-entering synchronously can leave no windows but a live process.
    if (windows.size === 1) setImmediate(quit); else closeWindow(w);
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
function notesPrefsPath() { return path.join(app.getPath('userData'), 'notes-'+createHash('sha256').update(actor).digest('hex')+'.json'); }
function readNotesPrefs() {
  if (!actor || locked) return { pinned: true, reminder: '' };
  try { const value=JSON.parse(fs.readFileSync(notesPrefsPath(),'utf8')); return { pinned:value.pinned!==false, reminder:/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value.reminder)?value.reminder:'', lastNotified:/^20\d{2}-\d{2}-\d{2}$/.test(value.lastNotified)?value.lastNotified:'' }; }
  catch { return { pinned:true, reminder:'', lastNotified:'' }; }
}
function saveNotesPrefs(value) {
  const file=notesPrefsPath();fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file+'.tmp',JSON.stringify(value),{mode:0o600});fs.renameSync(file+'.tmp',file);
}
function notesState() { const prefs=readNotesPrefs();return { online:!locked&&!!actor, pinned:prefs.pinned, reminder:prefs.reminder, ownerId:locked?'':actor }; }
function openNotesWindow() {
  if (locked || !actor) throw new Error('먼저 로그인해 주세요.');
  if (notesWindow && !notesWindow.isDestroyed()) { if(notesWindow.isMinimized())notesWindow.restore();notesWindow.show();notesWindow.focus();return notesState(); }
  const work=screen.getPrimaryDisplay().workArea;
  const win=new BrowserWindow({width:410,height:780,minWidth:340,minHeight:480,x:Math.max(work.x,work.x+work.width-430),y:work.y+25,title:'네노바 업무 메모장',icon:path.join(__dirname,'assets','icon.png'),backgroundColor:'#fffdf5',alwaysOnTop:readNotesPrefs().pinned,show:false,
    webPreferences:{preload:path.join(__dirname,'notes-preload.cjs'),nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true,devTools:!app.isPackaged}});
  notesWindow=win;auxiliary.add(win);win.setMenuBarVisibility(false);
  win.webContents.setWindowOpenHandler(()=>({action:'deny'}));win.webContents.on('will-navigate',event=>event.preventDefault());win.webContents.on('will-attach-webview',event=>event.preventDefault());
  win.on('closed',()=>{auxiliary.delete(win);if(notesWindow===win)notesWindow=null;});
  win.loadURL(NOTES);win.once('ready-to-show',()=>win.show());activity?.record('notesOpen','/desktop/notes');return notesState();
}
function saveNotesShortcut(w) {
  if (locked || !actor) throw new Error('먼저 로그인해 주세요.');
  if (process.platform!=='win32' || !app.isPackaged || !app.setAsDefaultProtocolClient('nenova-notes')) throw new Error('설치된 Windows 앱에서 바로가기를 만들 수 있습니다.');
  const target=dialog.showSaveDialogSync(w.win,{title:'업무 메모장 바로가기 다운로드',defaultPath:path.join(app.getPath('downloads'),'네노바-업무-메모장.url'),filters:[{name:'Windows 바로가기',extensions:['url']}],properties:['createDirectory']});
  if (!target) return {saved:false};
  const file=target.toLowerCase().endsWith('.url')?target:target+'.url';
  fs.writeFileSync(file,'[InternetShortcut]\r\nURL=nenova-notes://open\r\n',{flag:'w'});
  activity?.record('notesShortcut','/desktop/notes');return {saved:true};
}
async function checkNotesReminder() {
  if (locked || !actor || quitting || !Notification.isSupported()) return;
  const prefs=readNotesPrefs(),date=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul'}).format(new Date());
  const time=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Seoul',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date());
  if (!prefs.reminder || prefs.lastNotified===date || time<prefs.reminder) return;
  const owner=actor,generation=authGeneration;
  try {
    const data=await homeWorkspaceRequest({payload:{method:'GET',date,limit:500},owner,fetch:(url,options)=>webSession.fetch(url,options),isCurrent:()=>!locked&&actor===owner&&authGeneration===generation,onUnauthorized:()=>{}});
    if (!data.success || locked || actor!==owner) return;
    prefs.lastNotified=date;saveNotesPrefs(prefs);
    if (data.tasks.some(task=>!task.done&&!task.archived)) {new Notification({title:'오늘의 내 업무',body:'아직 완료하지 않은 업무가 있습니다. 네노바 업무 메모장을 확인하세요.'}).show();activity?.record('notesReminder','/desktop/notes');}
  } catch { /* Network or account failures retry at the next interval. */ }
}
function confirm(w, message, actionLabel = '닫기') {
  const accepted = dialog.showMessageBoxSync(w.win, { type: 'question', title: '작업 확인', message, detail: '저장하지 않은 입력은 복원되지 않을 수 있습니다. 탭 이동·창 분리는 입력을 유지합니다.', buttons: [actionLabel, '취소'], defaultId: actionLabel === '닫기' ? 0 : 1, cancelId: 1, noLink: true }) === 0;
  activity?.record(accepted ? 'confirmAccepted' : 'confirmCanceled', tabs.get(w.activeId)?.url);
  return accepted;
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
  activity?.record('close', t.url);
  const w = windows.get(t.windowId);
  if (ask && !confirm(w, `“${t.title}” 탭을 닫을까요?`)) return;
  t.closing = true;
  t.view.webContents.close({ waitForBeforeUnload: true });
}
function closeWindow(w) {
  activity?.record('closeWindow', tabs.get(w.activeId)?.url);
  if ((w.ids.length || w.homeDirty) && !confirm(w, '이 창의 미저장 입력을 버리고 창을 닫을까요?')) return;
  w.confirmedClose = true; w.win.close();
}
function quit() {
  if (quitting) return;
  activity?.record('quit', '/desktop');
  const w = [...windows.values()].find(w => w.win.isFocused()) || [...windows.values()][0];
  if ((tabs.size || [...windows.values()].some(item => item.homeDirty)) && w && !confirm(w, '미저장 입력을 버리고 네노바 프로그램을 종료할까요?')) return;
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
          const t = openTab(w, { url: details.url || 'about:blank', popup: true }, options);
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
  const t = { id, windowId: w.id, view, url, title: text(data.title) || '네노바 업무', customTitle: Boolean(data.title), popup: Boolean(data.popup), zoom: Number.isFinite(data.zoom) ? Math.min(1.5, Math.max(.5, data.zoom)) : 1, loading: true, error: '' };
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
  // window.close() from the page itself: a popup tab (window.open from a work page, e.g. product match / ERP match picker)
  // closes without the tab-close prompt. beforeunload (will-prevent-unload) still guards unsaved input.
  wc.on('close', e => { if (!t.destroying && !t.closing) { e.preventDefault(); closeTab(t, !t.popup); } });
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
    if (input.control && key === 'w') action = () => command(w, 'close', {id:w.activeId});
    if (input.control && key === 'n') action = () => command(w, 'newWindow');
    if (input.control && key === 'tab') action = () => { const i = w.ids.indexOf(w.activeId), n = w.ids.length; if (n) command(w, 'activate', {id:w.ids[(i + (input.shift ? n - 1 : 1)) % n]}); };
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
  const auditAction = action === 'homeWorkspace' && p.method === 'POST'
    ? ({create:'homeCreate',update:'homeUpdate',complete:'homeComplete',archive:'homeArchive',restore:'homeRestore',stop:'homeStop',read:'homeRead'}[p.command?.action] || action) : action;
  if (!['close', 'closeWindow', 'quit'].includes(action) && !(action === 'appUpdate' && p.automatic === true)) activity?.record(auditAction, trustedUrl(p.url || p.href) || t?.url || '/desktop');
  switch (action) {
    case 'state': break;
    case 'homeDraft': w.homeDirty = p.dirty === true; return state(w);
    case 'homeWorkspace': {
      if (locked || !actor) return Promise.reject(new Error('로그인을 다시 확인하세요.'));
      const owner = actor, generation = authGeneration;
      return homeWorkspaceRequest({ payload: p, owner, fetch: (url, options) => webSession.fetch(url, options),
        isCurrent: () => !locked && actor === owner && authGeneration === generation,
        onUnauthorized: () => { lockAccount(); ++authGeneration; verifyAccount().catch(() => {}); } });
    }
    case 'notesOpen': return openNotesWindow();
    case 'notesShortcut': return saveNotesShortcut(w);
    case 'logout': return logout(w);
    case 'appUpdate': { if (p.automatic === true) { void updateScheduler?.tick(true); break; } const phase = updater?.getState().phase; if (phase === 'available') updater.download(); else if (phase === 'downloaded') updater.install(); else updater?.check(); break; }
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
    case 'menu': if (p.open && actor && !locked) void accountFavorites(); w.menuOpen = p.open === true || !w.ids.length; layout(w); if (w.menuOpen || !t || locked) w.win.webContents.focus(); else t.view.webContents.focus(); break;
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
    case 'renameFavorite': {
      const item = favorites.find(f => f.url === p.url);
      if (item && actor && !locked && typeof p.alias === 'string')
        return accountFavorites({ kind: 'rename', item, alias: text(p.alias,60).trim() }, w);
      break;
    }
    case 'menuFavorite':
    case 'favorite': {
      if (!actor || locked) break;
      const menu = menus.flatMap(group => group.items).find(item => item.href === p.href)
        || (p.href === '/dashboard' ? { href: '/dashboard', labelKey: '네노바 홈' } : null);
      const item = action === 'menuFavorite' ? menu && menuFavoriteEntry(menu) : t && safeSnapshot({ favorites:[t] }).favorites[0];
      if (item) return accountFavorites({ kind: favorites.some(f => f.url === item.url) ? 'remove' : 'add', item: { ...item, number: undefined } }, w);
      break;
    }
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
  for (const w of windows.values()) w.homeDirty = false;
  clearTimeout(saveTimer);
  for (const t of tabs.values()) if (new URL(t.url).pathname !== '/login') { t.view.webContents.stop(); t.view.setVisible(false); }
  for (const w of auxiliary) w.destroy();
  notesWindow = null;
  broadcast();
}
async function logout(w) {
  if (locked || !actor || logoutInProgress) return state(w);
  if (!confirm(w, '열린 업무 화면과 미저장 입력을 닫고 로그아웃할까요?', '로그아웃')) return state(w);
  const generation = ++authGeneration;
  clearTimeout(authTimer);
  logoutInProgress = true;
  try {
    const response = await webSession.fetch(`${ORIGIN}/api/auth/logout`, {
      method: 'POST', credentials: 'include', cache: 'no-store', redirect: 'error',
      headers: { Origin: ORIGIN }, signal: AbortSignal.timeout(12000),
    });
    if (!response.ok) throw new Error('Logout failed');
  } catch {
    logoutInProgress = false;
    reportFailure(w, '로그아웃에 실패했습니다. 연결을 확인하고 다시 시도하세요.');
    broadcast(); return state(w);
  }
  logoutInProgress = false;
  if (generation !== authGeneration || quitting) return state(w);
  lockAccount();
  clearTimeout(authTimer);
  ++authGeneration;
  for (const tab of [...tabs.values()]) destroyTab(tab);
  actor = ''; favorites = []; menus = []; menuVersion = ''; webVersion = ''; saved = null; syncStatus = 'error';
  try { fs.rmSync(statePath(), { force: true }); } catch { /* No old tabs are restored while logged out. */ }
  try {
    await webSession.clearStorageData({ origin: ORIGIN, storages: ['localstorage', 'indexdb', 'serviceworkers', 'cachestorage', 'websql', 'filesystem'] });
    await webSession.clearCache();
  } catch { reportFailure(w, '로그아웃했습니다. 이 PC의 화면 저장소 정리를 확인해 주세요.'); }
  const target = [...windows.values()][0] || w;
  for (const item of windows.values()) { item.menuOpen = true; item.message = '로그아웃했습니다. 다른 계정으로 로그인할 수 있습니다.'; layout(item); }
  openTab(target, { url: '/login', title: '네노바 로그인' });
  broadcast(); return state(w);
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
    actor = newActor; favorites = saved?.actor === actor ? saved.favorites : [];
    favoritesMigrated = saved?.actor === actor && saved.favoritesMigrated === true; locked = false;
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
  await accountFavorites();
  void updateScheduler?.tick();
}
// --- AI 브리지(로컬 전용 제어 통로) ---------------------------------------
// 기본 꺼짐. --ai-bridge 플래그 또는 NENOVA_AI_BRIDGE=1일 때만 127.0.0.1 HTTP 서버를 연다.
// 원격 페이지에 preload를 추가하지 않으며, 허용/차단 판정과 감사 로그는 ai-bridge.cjs가 담당한다.
const bridgeConsole = new Map();
function hookBridgeConsole(t) {
  if (!t || t.bridgeConsoleHooked) return;
  t.bridgeConsoleHooked = true;
  const wc = t.view.webContents;
  wc.on('console-message', (e, level, message) => {
    const rows = bridgeConsole.get(t.id) || [];
    rows.push({ ts: Date.now(), level: e?.level ?? level, message: String(e?.message ?? message ?? '').slice(0, 1000) });
    if (rows.length > 200) rows.shift();
    bridgeConsole.set(t.id, rows);
  });
  wc.on('destroyed', () => bridgeConsole.delete(t.id));
}
function bridgeTab(tabId) {
  if (typeof tabId === 'string' && tabId) return tabs.get(tabId) || null;
  const w = [...windows.values()].find(v => v.win.isFocused()) || [...windows.values()][0];
  return (w && tabs.get(w.activeId)) || [...tabs.values()][0] || null;
}
function bridgeTarget(tabId) {
  const t = bridgeTab(tabId);
  if (!t || t.view.webContents.isDestroyed()) throw new Error('대상 탭을 찾지 못했습니다.');
  hookBridgeConsole(t);
  return t;
}
function bridgeEval(t, code) { return t.view.webContents.executeJavaScript(code, true); }
async function startAiBridge() {
  if (!process.argv.includes('--ai-bridge') && process.env.NENOVA_AI_BRIDGE !== '1') return;
  const { createAiBridge } = require('./ai-bridge.cjs');
  aiBridge = createAiBridge({
    dir: app.getPath('userData'), trustedUrl, getMenus: () => (locked ? [] : menus),
    tools: {
      tabsList: () => {
        for (const t of tabs.values()) hookBridgeConsole(t);
        return { locked, tabs: [...tabs.values()].map(t => ({ id: t.id, windowId: t.windowId, url: locked ? '' : t.url, title: locked ? '로그인 대기' : t.title, active: windows.get(t.windowId)?.activeId === t.id, loading: t.loading, error: t.error })) };
      },
      tabsOpen: url => {
        if (locked) throw new Error('로그인이 필요합니다. 업무 화면에서 먼저 로그인하세요.');
        const w = [...windows.values()][0] || createWindow();
        const t = openTab(w, { url });
        if (!t) throw new Error('탭을 열지 못했습니다.');
        hookBridgeConsole(t);
        activity?.record('aiBridgeOpen', t.url);
        return { id: t.id, url: t.url, title: t.title };
      },
      resolveTabUrl: async tabId => bridgeTab(tabId)?.url || '',
      pageText: async tabId => {
        const t = bridgeTarget(tabId);
        const value = await bridgeEval(t, 'document.body ? document.body.innerText : ""');
        return { tabId: t.id, url: locked ? '' : t.url, text: String(value || '').slice(0, 200000) };
      },
      pageQuery: async ({ tabId, selector, attribute, all }) => {
        const t = bridgeTarget(tabId);
        const code = `(() => { const sel = ${JSON.stringify(selector)}, attr = ${JSON.stringify(attribute || '')};
          const list = ${all ? '[...document.querySelectorAll(sel)].slice(0, 50)' : '[document.querySelector(sel)].filter(Boolean)'};
          return list.map(el => attr ? String(el.getAttribute(attr) ?? '') : String(el.innerText ?? el.value ?? '').slice(0, 2000)); })()`;
        return { tabId: t.id, matches: await bridgeEval(t, code) };
      },
      pageClick: async ({ tabId, selector }) => {
        if (locked) throw new Error('로그인이 필요합니다.');
        const t = bridgeTarget(tabId);
        activity?.record('aiBridgeClick', t.url);
        return { tabId: t.id, ...(await bridgeEval(t, `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return { clicked: false, error: '요소를 찾지 못했습니다.' }; el.scrollIntoView({ block: 'center' }); el.click(); return { clicked: true }; })()`)) };
      },
      pageFill: async ({ tabId, selector, value }) => {
        if (locked) throw new Error('로그인이 필요합니다.');
        const t = bridgeTarget(tabId);
        activity?.record('aiBridgeFill', t.url);
        const code = `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return { filled: false, error: '요소를 찾지 못했습니다.' };
          const value = ${JSON.stringify(String(value ?? ''))};
          const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : el instanceof HTMLInputElement ? HTMLInputElement.prototype : null;
          const setter = proto && Object.getOwnPropertyDescriptor(proto, 'value')?.set;
          if (setter) setter.call(el, value); else if ('value' in el) el.value = value; else el.textContent = value;
          el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true }));
          return { filled: true }; })()`;
        return { tabId: t.id, ...(await bridgeEval(t, code)) };
      },
      pageScroll: async ({ tabId, selector, y }) => {
        const t = bridgeTarget(tabId);
        const code = selector
          ? `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return { scrolled: false, error: '요소를 찾지 못했습니다.' }; el.scrollIntoView({ block: 'center', behavior: 'instant' }); return { scrolled: true, y: Math.round(window.scrollY) }; })()`
          : `(() => { window.scrollTo({ top: ${JSON.stringify(y)}, behavior: 'instant' }); return { scrolled: true, y: Math.round(window.scrollY) }; })()`;
        return { tabId: t.id, ...(await bridgeEval(t, code)) };
      },
      pageScreenshot: async tabId => {
        const t = bridgeTarget(tabId);
        const image = await t.view.webContents.capturePage();
        const shotsDir = path.join(app.getPath('userData'), 'ai-bridge-shots');
        fs.mkdirSync(shotsDir, { recursive: true });
        const file = path.join(shotsDir, `${Date.now()}-tab${t.id}.png`);
        fs.writeFileSync(file, image.toPNG());
        return { tabId: t.id, url: locked ? '' : t.url, path: file };
      },
      consoleLogs: async ({ tabId, limit }) => {
        const t = bridgeTarget(tabId);
        return { tabId: t.id, logs: (bridgeConsole.get(t.id) || []).slice(-limit) };
      },
    },
  });
  const { port } = await aiBridge.start();
  console.log(`[ai-bridge] 127.0.0.1:${port} (token: ${path.basename(aiBridge.tokenFile)})`);
}
// ---------------------------------------------------------------------------
app.whenReady().then(async () => {
  const enabled = app.isPackaged && process.platform === 'win32';
  const engine = enabled ? require('electron-updater').autoUpdater : null;
  updater = createUpdater({ engine, enabled, enoughSpace: enoughUpdateSpace, prepareInstall: prepareUpdate, notify: () => broadcast() });
  updateScheduler = createUpdateScheduler({ updater, isReady: () => !locked && !!actor && !quitting, isOnline: () => net.isOnline() });
  updateTimer = setInterval(() => { void updateScheduler.tick(); }, 60 * 1000);
  updateTimer.unref();
  if (engine) {
    require('electron').autoUpdater.on('before-quit-for-update', () => { quitting = true; });
    engine.on('error', () => { quitting = false; });
  }
  protocol.handle('nenova-app', request => {
    const u = new URL(request.url);
    const name = u.pathname.slice(1);
    if (u.hostname !== 'shell' || !['index.html','shell.js','shell.css','home-workspace.js','notes.html','notes.js','notes.css'].includes(name)) return new Response('Not found', { status: 404 });
    return new Response(fs.readFileSync(path.join(__dirname, 'shell', name)), { headers: { 'content-type': name.endsWith('.html') ? 'text/html; charset=utf-8' : name.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'text/css; charset=utf-8', 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-src 'none'" } });
  });
  webSession = session.fromPartition('persist:nenova-work');
  const desktopUa = webSession.getUserAgent();
  webSession.setUserAgent(`${desktopUa.replace(/\bNenovaDesktop\/[\d.]+\b/g, '').trim()} NenovaDesktop/${require('./package.json').version}`);
  const activityPath = path.join(app.getPath('userData'), 'activity.encrypted');
  activity = createActivity({
    endpoint: `${ORIGIN}/api/work/activity`, owner: () => locked ? '' : actor,
    fetch: (url, options) => webSession.fetch(url, options),
    read: () => fs.existsSync(activityPath) ? JSON.parse(safeStorage.decryptString(fs.readFileSync(activityPath))) : [],
    write: rows => {
      if (!safeStorage.isEncryptionAvailable()) throw new Error('Encryption unavailable');
      fs.mkdirSync(path.dirname(activityPath), {recursive:true});
      fs.writeFileSync(activityPath + '.tmp', safeStorage.encryptString(JSON.stringify(rows)));
      fs.renameSync(activityPath + '.tmp', activityPath);
    },
    warn: message => { activityWarning = message; broadcast(); },
  });
  setInterval(() => { if (!locked && [...windows.values()].some(w => w.menuOpen && w.win.isFocused())) void accountFavorites(); }, 30000).unref();
  activityTimer = setInterval(() => void activity.flush(), 5000);
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
  ipcMain.handle('notes:command', (event, action, payload) => {
    if (!notesWindow || notesWindow.isDestroyed() || event.sender!==notesWindow.webContents || event.senderFrame!==event.sender.mainFrame || event.senderFrame.url!==NOTES) throw new Error('신뢰할 수 없는 메모장 요청');
    if (!payload || typeof payload!=='object' || Array.isArray(payload)) throw new Error('잘못된 요청');
    if (action==='state') return notesState();
    if (locked || !actor) throw new Error('로그인을 다시 확인하세요.');
    if (action==='workspace') { const owner=actor,generation=authGeneration;return homeWorkspaceRequest({payload,owner,fetch:(url,options)=>webSession.fetch(url,options),isCurrent:()=>!locked&&actor===owner&&authGeneration===generation,onUnauthorized:()=>{lockAccount();++authGeneration;verifyAccount().catch(()=>{});}}); }
    if (action==='copy') {const owner=actor,generation=authGeneration;return homeWorkspaceRequest({payload:{method:'GET',date:payload.date,limit:500},owner,fetch:(url,options)=>webSession.fetch(url,options),isCurrent:()=>!locked&&actor===owner&&authGeneration===generation,onUnauthorized:()=>{}}).then(data=>{if(!data.success)throw new Error('업무를 다시 확인해 주세요.');const active=data.tasks.filter(task=>!task.archived);clipboard.writeText([payload.date+' 오늘의 내 업무',...active.map(task=>`${task.done?'[완료]':'[ ]'} ${task.title}`)].join('\n'));activity?.record('notesCopy','/desktop/notes');return {copied:active.length,partial:data.nextOffset!=null};});}
    if (action==='pin') {const prefs=readNotesPrefs();prefs.pinned=payload.pinned===true;saveNotesPrefs(prefs);notesWindow.setAlwaysOnTop(prefs.pinned);activity?.record('notesPin','/desktop/notes');return notesState();}
    if (action==='reminder') {const prefs=readNotesPrefs();if (payload.time!==''&&!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(payload.time))throw new Error('알림 시간을 확인하세요.');prefs.reminder=payload.time;saveNotesPrefs(prefs);activity?.record('notesReminderSetting','/desktop/notes');void checkNotesReminder();return notesState();}
    throw new Error('지원하지 않는 메모장 동작');
  });
  Menu.setApplicationMenu(null);
  saved = readSaved(); createWindow();
  if (process.platform==='win32' && app.isPackaged) app.setAsDefaultProtocolClient('nenova-notes');
  webSession.cookies.on('changed', (_event, cookie, _cause, removed) => {
    if (logoutInProgress || (removed && locked && !actor)) return;
    if (cookie.name !== 'nenovaToken' || !['nenovaweb.com', '.nenovaweb.com'].includes(cookie.domain)) return;
    lockAccount(); ++authGeneration; clearTimeout(authTimer); authTimer = setTimeout(() => verifyAccount(), 150);
  });
  await startAiBridge().catch(error => console.error('[ai-bridge] 시작 실패:', error?.message || error));
  await verifyAccount(true);
  if (process.argv.some(arg=>/^nenova-notes:\/\/open\/?$/i.test(arg)) && !locked) openNotesWindow();
  notesTimer=setInterval(()=>void checkNotesReminder(),60*1000);notesTimer.unref();void checkNotesReminder();
});
app.on('before-quit', e => { if (!quitting && windows.size) { e.preventDefault(); quit(); } });
app.on('will-quit', () => { clearInterval(updateTimer); clearInterval(activityTimer); clearInterval(notesTimer); aiBridge?.stop(); });
app.on('window-all-closed', () => { if (!quitting) { quitting = true; app.quit(); } });
// Export only to the local Node test runner. No renderer receives this object.
module.exports = { windows, tabs, command, createWindow, moveTab, snapshot, verifyAccount };
