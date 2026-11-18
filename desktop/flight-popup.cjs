'use strict';
const path = require('node:path');
const { ORIGIN, trustedUrl } = require('./policy.cjs');

function createFlightPopup({ BrowserWindow, session, screen, appDir, onCreate, openLink, setIdentity }) {
  let window = null, generation = 0;
  return {
    async open(viewId = '') {
      if (typeof viewId !== 'string' || viewId && !/^[a-f0-9]{64}$/.test(viewId)) throw Error('항공편 선택을 확인하세요.');
      const url = new URL('/desktop-flight', ORIGIN);
      if (viewId) url.searchParams.set('flight', viewId);
      if (!window || window.isDestroyed()) {
        const area = screen.getPrimaryDisplay().workAreaSize;
        window = new BrowserWindow({
          width: Math.min(1440, area.width), height: Math.min(960, area.height),
          minWidth: 640, minHeight: 480, title: '수입 비행기 현황',
          icon: path.join(appDir, 'assets/icon.png'), backgroundColor: '#f4f7fb', show: false,
          webPreferences: { session, nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true }
        });
        const created = window;
        const followLink = url => Promise.resolve().then(() => openLink(url, created)).catch(() => {});
        setIdentity(created);
        created.setMenuBarVisibility(false);
        created.webContents.setWindowOpenHandler(({ url }) => {
          void followLink(url);
          return { action: 'deny' };
        });
        created.webContents.on('will-attach-webview', event => event.preventDefault());
        for (const eventName of ['will-navigate', 'will-redirect']) {
          created.webContents.on(eventName, (event, target) => {
            if (!trustedUrl(target, { popup: false })) {
              event.preventDefault();
              if (eventName === 'will-navigate') void followLink(target);
            }
          });
        }
        created.once('ready-to-show', () => { if (!created.isDestroyed()) created.show(); });
        created.on('closed', () => {
          if (window === created) { window = null; ++generation; }
        });
        onCreate(created);
      }
      const target = window, ticket = ++generation;
      if (target.isMinimized()) target.restore();
      target.show();
      target.focus();
      try { await target.loadURL(url.href); }
      catch (error) {
        if (ticket === generation) throw error;
      }
      return { success: true };
    }
  };
}
module.exports = { createFlightPopup };
