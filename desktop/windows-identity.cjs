'use strict';

const path = require('node:path');
const APP_ID = 'com.nenova.workspace';
const DEV_APP_ID = APP_ID + '.dev';
const TASKBAR_ICON = 'nenova-taskbar.ico';
const appIdFor = packaged => packaged ? APP_ID : DEV_APP_ID;

function windowAppDetails({ platform = process.platform, packaged, execPath, resourcesPath, appDir }) {
  if (platform !== 'win32') return null;
  return {
    appId: appIdFor(packaged),
    relaunchDisplayName: packaged ? '네노바 업무' : '네노바 업무 (개발)',
    appIconPath: packaged ? path.join(resourcesPath, TASKBAR_ICON) : path.join(appDir, 'assets', 'icon.ico'),
    appIconIndex: 0,
    relaunchCommand: '"' + execPath + '"' + (packaged ? '' : ' "' + appDir + '"'),
  };
}

function applyWindowIdentity(win, options) {
  const details = windowAppDetails(options);
  if (details) { win.setAppDetails(details); win.setSkipTaskbar(false); }
  return details;
}

// Windows uses the shortcut AppUserModelID to group the installed app's taskbar windows.
function repairTaskbarShortcuts({ shell, appData, execPath, resourcesPath }) {
  const start = path.join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs');
  const pinned = path.join(appData, 'Microsoft', 'Internet Explorer', 'Quick Launch', 'User Pinned', 'TaskBar');
  const samePath = (a, b) => !!a && path.win32.normalize(a).toLowerCase() === path.win32.normalize(b).toLowerCase();
  const newIcon = path.join(resourcesPath, TASKBAR_ICON);
  const oldIcon = path.join(resourcesPath, 'app-icon.ico');
  const candidates = [path.join(start, 'Electron.lnk'), ...[start, pinned].flatMap(dir =>
    ['네노바 업무.lnk', 'Nenova Desktop.lnk'].map(name => path.join(dir, name)))];
  let repaired = 0;
  for (const shortcut of candidates) {
    try {
      const details = shell.readShortcutLink(shortcut);
      let update;
      if (path.basename(shortcut) === 'Electron.lnk' && details.appUserModelId === APP_ID &&
          path.win32.basename(details.target).toLowerCase() === 'electron.exe') {
        update = { appUserModelId: DEV_APP_ID };
      } else if (samePath(details.target, execPath) && (!details.appUserModelId || details.appUserModelId === APP_ID) &&
          (!details.icon || samePath(details.icon, oldIcon) || samePath(details.icon, execPath))) {
        update = { appUserModelId: APP_ID, icon: newIcon, iconIndex: 0 };
      }
      if (update && shell.writeShortcutLink(shortcut, 'update', update)) repaired++;
    } catch { /* Optional existing shortcuts only. Missing or protected files stay as configured. */ }
  }
  return repaired;
}

module.exports = { APP_ID, DEV_APP_ID, TASKBAR_ICON, appIdFor, windowAppDetails, applyWindowIdentity, repairTaskbarShortcuts };
