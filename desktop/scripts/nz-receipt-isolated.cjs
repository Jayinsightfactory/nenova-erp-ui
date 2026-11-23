'use strict';
// Test-only Electron window; no production session or network access.
const {app,BrowserWindow,session}=require('electron');
const os=require('node:os'),fs=require('node:fs'),path=require('node:path');
const origin='http://127.0.0.1:19462';
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'nenova-nz-receipt-'));
app.setPath('userData',profile);
app.setPath('sessionData',profile);
app.whenReady().then(async()=>{
  const status=await fetch(origin+'/__test/status').then(r=>r.json());
  if(status.testOnly!==true||!/^NenovaInvoiceFixture_/.test(status.database))throw Error('Isolated SQL fixture not verified');
  const ses=session.fromPartition('nz-invoice-test-only');
  ses.webRequest.onBeforeRequest({urls:['<all_urls>']},(request,cb)=>{
    const url=new URL(request.url);
    cb({cancel:!['blob:','data:','about:'].includes(url.protocol)&&url.origin!==origin});
  });
  const win=new BrowserWindow({title:'Nenova NZ Isolated SQL',width:1560,height:970,webPreferences:{
    session:ses,sandbox:true,contextIsolation:true,nodeIntegration:false,
  }});
  win.on('page-title-updated',event=>event.preventDefault());
  if(process.env.NENOVA_NZ_TRACE==='1'){
    const safeUrl=value=>{try{const url=new URL(value);return url.origin===origin?url.pathname:url.protocol;}catch{return 'unavailable';}};
    for(const event of ['did-start-navigation','did-navigate','did-navigate-in-page','did-finish-load'])
      win.webContents.on(event,(_event,url)=>console.log('ISOLATED_NAV',event,safeUrl(url)));
    win.webContents.on('console-message',(event,legacyLevel,legacyMessage)=>{
      const level=event.level??({2:'warning',3:'error'}[legacyLevel]);
      const message=event.message??legacyMessage;
      if(/^(warning|error)$/.test(level))
        console.log('ISOLATED_CONSOLE',level,String(message).slice(0,400));
    });
    win.webContents.on('dom-ready',()=>win.webContents.executeJavaScript(`
      for (const type of ['change','cancel']) document.addEventListener(type,event=>{
        if (event.target instanceof HTMLInputElement && event.target.type==='file')
          console.warn('ISOLATED_FILE',type,event.target.files.length);
      },true);
    `).catch(error=>console.error('ISOLATED_TRACE',error.message)));
  }
  win.webContents.setWindowOpenHandler(({url,frameName})=>{
    console.log('ISOLATED_POPUP',url,frameName);
    return {action:url==='about:blank'||new URL(url).origin===origin?'allow':'deny'};
  });
  await win.loadURL(origin+'/import/tools?popup=1');
}).catch(error=>{console.error(error.message);app.exit(1);});
app.on('window-all-closed',()=>app.quit());
