'use strict';
// Parent Node runner asserts real process exit; successful children never call
// app.exit. Every child has a fresh profile and fully intercepted HTTPS session.
if (!process.versions.electron) {
  const { spawnSync } = require('node:child_process');
  const assert = require('node:assert/strict');
  const electron = require('electron');
  for (const mode of ['--quit', '--window-close', '--cancel-double-close','--notes-survive','--notes-quit','--notes-dirty']) {
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
  const workSession = session.fromPartition('persist:nenova-work');
  session.defaultSession.protocol.handle('https', () => new Response('Blocked by exit fixture', { status: 403 }));
  for (const isolated of [session.defaultSession, workSession]) isolated.protocol.handle('http', () => new Response('Blocked by exit fixture', { status: 403 }));
  workSession.protocol.handle('https', async request => {
    const url = new URL(request.url), pathname = url.pathname;
    if (url.origin !== 'https://nenovaweb.com') return new Response('Blocked by exit fixture', { status: 403 });
    if (pathname === '/api/work/activity' && request.method === 'POST') {
      const body = await request.json();
      assert.equal(body.expectedUserId, 'exit-probe');
      assert.ok(body.events.length <= 50 && body.events.every(event => event.kind === 'desktop' && !event.path.includes('?')));
      return Response.json({ success: true, acceptedIds: body.events.map(event => event.id) });
    }
    assert.ok(['GET','HEAD'].includes(request.method)||pathname==='/api/desktop/home-workspace'&&request.method==='POST','no ERP mutation requests');
    if (pathname === '/api/desktop/home-workspace') return Response.json({ success: true, schemaVersion: 1, ownerId: 'exit-probe', revision: 0, tasks: [], guidance: [], feedback: [],...(request.method==='POST'?{revision:1}:{}) });
    if(pathname==='/api/desktop/company-calendar')return Response.json({success:true,schemaVersion:1,ownerId:'exit-probe',revision:0,events:[]});
    if(pathname==='/api/pm/staff-requests')return Response.json({success:true,requests:[]});
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
  if(process.argv.some(a=>a.startsWith('--notes-'))){
    await main.command(w,'notesOpen',{});await new Promise(r=>setTimeout(r,500));
    const notes=webContents.getAllWebContents().find(c=>c.getURL().includes('/notes.html'));assert.ok(notes);
    w.win.close();await new Promise(r=>setTimeout(r,500));assert.equal(main.windows.size,0);assert.equal(notes.isDestroyed(),false);
    assert.equal(await notes.executeJavaScript("window.notes.invoke('workspace',{method:'GET',date:'2026-11-13'})").then(r=>r.ownerId),'exit-probe');
    const created=await notes.executeJavaScript("window.notes.invoke('workspace',{method:'POST',command:{action:'create',date:'2026-11-13',expectedRevision:0,requestId:'notes-only-create',title:'fixture',frequency:'once',weekdays:[]}})");assert.equal(created.revision,1);
    await new Promise(r=>setTimeout(r,600));
    if(require('electron').safeStorage.isEncryptionAvailable()){const saved=JSON.parse(require('electron').safeStorage.decryptString(fs.readFileSync(path.join(profile,'workspace.encrypted'))));assert.equal(saved.windows[0].tabs.length,1,'notes-only background never replaces the saved workspace with empty windows');}
    console.log('NOTES SURVIVED AND SAVED');
    if(process.argv.includes('--notes-dirty')){
      await notes.executeJavaScript("window.notes.invoke('draft',{dirty:true})");answer=1;require('electron').BrowserWindow.fromWebContents(notes).close();await new Promise(r=>setTimeout(r,100));assert.equal(notes.isDestroyed(),false);answer=0;
    }
    if(process.argv.includes('--notes-survive')){
      await notes.executeJavaScript("window.notes.invoke('home')");await new Promise(r=>setTimeout(r,400));assert.equal(main.windows.size,1);const reopened=[...main.windows.values()][0];
      main.command(reopened,'open',{url:'/test/probe'});assert.equal(main.tabs.size,1);reopened.win.close();await new Promise(r=>setTimeout(r,400));assert.equal(main.windows.size,0);
      require('electron').BrowserWindow.fromWebContents(notes).close();
    }else await notes.executeJavaScript("window.notes.invoke('quit')").catch(()=>{});
  }
  else if (process.argv.includes('--cancel-double-close')) {
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
