'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createFlightPopup } = require('../flight-popup.cjs');

test('desktop flight popup reuses a secured native window and changes the selected flight', async () => {
  const windows = [], links = [], session = {};
  class Window extends EventEmitter {
    constructor(options) {
      super(); this.options = options; this.urls = []; this.webContents = new EventEmitter();
      this.webContents.setWindowOpenHandler = handler => { this.openHandler = handler; };
      windows.push(this);
    }
    isDestroyed() { return !!this.destroyed; }
    isMinimized() { return !!this.minimized; }
    restore() { this.minimized = false; }
    setMenuBarVisibility(value) { assert.equal(value,false); }
    show() {}
    focus() {}
    async loadURL(url) { this.urls.push(url); }
  }
  const created = [];
  const popup = createFlightPopup({
    BrowserWindow:Window,session,screen:{getPrimaryDisplay:()=>({workAreaSize:{width:1280,height:800}})},
    appDir:'desktop',onCreate:w=>created.push(w),setIdentity:w=>{w.branded=true;},
    openLink:url=>links.push(url)
  });
  await assert.rejects(popup.open('../orders'), /항공편/);
  assert.equal(windows.length,0);
  await popup.open();
  const win = windows[0];
  assert.equal(win.options.width,1280);
  assert.equal(win.options.webPreferences.session,session);
  assert.equal(win.options.webPreferences.preload,undefined);
  assert.equal(win.options.webPreferences.nodeIntegration,false);
  assert.equal(win.options.webPreferences.sandbox,true);
  assert.equal(win.branded,true);
  assert.deepEqual(created,[win]);
  await popup.open();
  assert.equal(win.urls.length,2);
  win.minimized=true;
  await popup.open('a'.repeat(64));
  assert.equal(windows.length,1);
  assert.equal(win.minimized,false);
  assert.equal(new URL(win.urls[2]).pathname,'/desktop-flight');
  assert.equal(new URL(win.urls[2]).searchParams.get('flight'),'a'.repeat(64));
  let prevented=false;
  win.webContents.emit('will-navigate',{preventDefault(){prevented=true;}},'https://elsewhere.example/');
  assert.equal(prevented,true);
  await Promise.resolve();
  assert.equal(links.at(-1),'https://elsewhere.example/');
  assert.deepEqual(win.openHandler({url:'https://elsewhere.example/'}),{action:'deny'});
  win.destroyed=true;win.emit('closed');
  await popup.open();
  assert.equal(windows.length,2);
});
