'use strict';
// Actual Desktop main/shell with an isolated session and loopback-only synthetic backend.
// This harness never attaches to the installed user's profile or changes production policy.
const {app,session,BrowserWindow}=require('electron');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const base=process.env.COUNTRY_FIXTURE_BASE;
if(!/^http:\/\/127\.0\.0\.1:\d+$/.test(base||''))throw Error('Explicit loopback fixture required');
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'nenova-country-desktop-'));
app.setPath('userData',profile);app.setPath('sessionData',profile);
app.whenReady().then(()=>{
  const work=session.fromPartition('persist:nenova-work');
  for(const isolated of [session.defaultSession,work]){
    isolated.protocol.handle('http',()=>new Response('Blocked outside test transport',{status:403}));
    isolated.protocol.handle('https',async request=>{
      const url=new URL(request.url);if(url.origin!=='https://nenovaweb.com')return new Response('Blocked by isolated fixture',{status:403});
      const headers=Object.fromEntries(request.headers);delete headers.host;
      const response=await fetch(base+url.pathname+url.search,{method:request.method,headers,body:['GET','HEAD'].includes(request.method)?undefined:Buffer.from(await request.arrayBuffer()),redirect:'manual'});
      const outputHeaders=new Headers(response.headers);for(const name of ['content-encoding','content-length','transfer-encoding'])outputHeaders.delete(name);
      return new Response(await response.arrayBuffer(),{status:response.status,headers:outputHeaders});
    });
  }
});
app.on('browser-window-created',(_event,window)=>{window.on('page-title-updated',event=>{event.preventDefault();window.setTitle('TEST_ONLY 국가별 발주서 · 격리 Nenova Desktop');});window.once('ready-to-show',()=>window.setTitle('TEST_ONLY 국가별 발주서 · 격리 Nenova Desktop'));});
require('../main.cjs');
app.whenReady().then(()=>console.log('NATIVE_FIXTURE_PROFILE '+profile));
