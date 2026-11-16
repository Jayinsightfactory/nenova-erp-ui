const {test}=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');const {APP_ID,windowAppDetails,applyWindowIdentity}=require('../windows-identity.cjs');
test('Windows taskbar uses a real icon outside asar and the Nenova relaunch identity',()=>{const args={platform:'win32',packaged:true,execPath:'C:/Program Files/Nenova Desktop/Nenova Desktop.exe',resourcesPath:'C:/Program Files/Nenova Desktop/resources',appDir:'unused.asar'},details=windowAppDetails(args),calls=[];applyWindowIdentity({setAppDetails:v=>calls.push(v),setSkipTaskbar:v=>calls.push(v)},args);assert.equal(details.appId,APP_ID);assert.equal(details.relaunchDisplayName,'네노바 업무');assert.equal(details.appIconPath,path.join(args.resourcesPath,'nenova-taskbar.ico'));assert(!details.appIconPath.includes('.asar'));assert.equal(details.relaunchCommand,'"'+args.execPath+'"');assert.deepEqual(calls,[details,false]);});
test('development launches the actual desktop folder and non-Windows skips native calls',()=>{const d=windowAppDetails({platform:'win32',packaged:false,execPath:'C:/Electron/electron.exe',appDir:'C:/Nenova desktop'});assert.equal(d.appId,APP_ID+'.dev');assert.equal(d.relaunchCommand,'"C:/Electron/electron.exe" "C:/Nenova desktop"');assert.equal(windowAppDetails({platform:'linux'}),null);assert.equal(applyWindowIdentity({}, {platform:'darwin'}),null);});
test('repair migrates a conflicting Electron shortcut and previous product icon only once', () => {
  const { DEV_APP_ID, repairTaskbarShortcuts } = require('../windows-identity.cjs');
  const appData = path.resolve('user-data');
  const execPath = path.join(appData, 'product', 'Nenova Desktop.exe');
  const resourcesPath = path.join(path.dirname(execPath), 'resources');
  const start = path.join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs');
  const pin = path.join(appData, 'Microsoft', 'Internet Explorer', 'Quick Launch', 'User Pinned', 'TaskBar');
  const dev = path.join(start, 'Electron.lnk'), installed = path.join(pin, '네노바 업무.lnk');
  const links = new Map([
    [dev, { target: path.join(appData, 'electron.exe'), appUserModelId: APP_ID, args: 'dev-folder' }],
    [installed, { target: execPath, icon: path.join(resourcesPath, 'app-icon.ico'), args: '--resume' }],
    [path.join(start, 'Nenova Desktop.lnk'), { target: execPath, appUserModelId: 'foreign.id' }],
    [path.join(start, '네노바 업무.lnk'), { target: execPath, icon: 'custom.ico' }],
    [path.join(pin, 'Nenova Desktop.lnk'), { target: path.join(appData, 'Nenova.exe') }]
  ]);
  const writes = [];
  const shell = {
    readShortcutLink(name) { return links.get(name); },
    writeShortcutLink(name, operation, fields) {
      assert.equal(operation, 'update');
      writes.push(name);
      Object.assign(links.get(name), fields);
      return true;
    }
  };
  const repair = () => repairTaskbarShortcuts({ shell, appData, execPath, resourcesPath });
  assert.equal(repair(), 2);
  assert.deepEqual(writes, [dev, installed]);
  assert.equal(links.get(dev).appUserModelId, DEV_APP_ID);
  assert.equal(links.get(dev).args, 'dev-folder');
  assert.deepEqual(links.get(installed), {
    target: execPath, icon: path.join(resourcesPath, 'nenova-taskbar.ico'),
    args: '--resume', appUserModelId: APP_ID, iconIndex: 0
  });
  assert.equal(repair(), 0);
});
