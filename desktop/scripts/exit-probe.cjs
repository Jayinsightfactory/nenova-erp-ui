'use strict';
// Parent Node runner asserts real process exit; successful children never call
// app.exit. Every child has a fresh profile and fully intercepted HTTPS session.
if (!process.versions.electron) {
  const { spawnSync } = require('node:child_process');
  const assert = require('node:assert/strict');
  const electron = require('electron');
  for (const mode of ['--quit', '--window-close', '--cancel-double-close']) {
    const child = spawnSync(electron, [__filename, mode], { encoding: 'utf8', timeout: 15000, windowsHide: true });
    process.stdout.write(child.stdout || '');
    process.stderr.write(child.stderr || '');
    assert.ifError(child.error);
    assert.equal(child.status, 0, `${mode}: actual Electron process must exit normally`);
    assert.match(child.stdout, /EVENT will-quit/);
    if (mode === '--cancel-double-close') assert.match(child.stdout, /CANCEL PRESERVED/);
    console.log(`PASS ${mode}`);
  }
  return;
}
const { app, session, dialog, webContents } = require('electron');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'nenova-exit-probe-'));
app.setPath('userData', profile); app.setPath('sessionData', profile);
let answer = 0;
dialog.showMessageBoxSync = (_win, options) => { console.log('DIALOG', options.message); return answer; };
app.whenReady().then(() => {
  session.fromPartition('persist:nenova-work').protocol.handle('https', request => {
    const pathname = new URL(request.url).pathname;
    if (pathname === '/api/auth/me') return Response.json({ success: true, user: { userId: 'exit-probe' } });
    if (pathname === '/api/desktop/bootstrap') return Response.json({ success: true, schemaVersion: 1, user: { userId: 'exit-probe' }, webVersion: 'fixture', menuVersion: 'a'.repeat(64), menus: [{group:'Fixture',items:[{href:'/test/probe',labelKey:'Probe',popup:false}]}] });
    return new Response('<!doctype html><title>Isolated exit fixture</title><p>No live requests</p>', {headers:{'content-type':'text/html'}});
  });
});
const main = require('../main.cjs');
for (const event of ['before-quit','will-quit','quit','window-all-closed']) app.on(event, () => console.log('EVENT', event));
app.whenReady().then(async () => {
  await new Promise(r => setTimeout(r, 1500));
  await main.verifyAccount(true);
  const w = [...main.windows.values()][0];
  main.command(w, 'open', { url: '/test/probe' });
  await new Promise(r => setTimeout(r, 1000));
  console.log('BEFORE', main.windows.size, main.tabs.size, process.pid);
  const watchdog = setTimeout(() => {
    console.log('EXIT FAILED', main.windows.size, main.tabs.size, webContents.getAllWebContents().map(wc => ({id:wc.id,url:wc.getURL()})));
    app.exit(2);
  }, 8000); watchdog.unref();
  if (process.argv.includes('--cancel-double-close')) {
    answer = 1;
    w.win.close();
    await new Promise(r => setTimeout(r, 300));
    assert.equal(main.windows.size, 1);
    assert.equal(main.tabs.size, 1);
    assert.equal(w.win.isDestroyed(), false);
    console.log('CANCEL PRESERVED');
    answer = 0;
    w.win.close(); w.win.close();
  }
  else if (process.argv.includes('--window-close')) w.win.close();
  else main.command(w, 'quit', {});
}).catch(error => { console.error(error); app.exit(1); });
