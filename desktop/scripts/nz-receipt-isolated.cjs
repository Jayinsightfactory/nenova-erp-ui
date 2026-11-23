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
  win.webContents.setWindowOpenHandler(({url})=>({action:url==='about:blank'||new URL(url).origin===origin?'allow':'deny'}));
  await win.loadURL(origin+'/import/tools?popup=1');
}).catch(error=>{console.error(error.message);app.exit(1);});
app.on('window-all-closed',()=>app.quit());
