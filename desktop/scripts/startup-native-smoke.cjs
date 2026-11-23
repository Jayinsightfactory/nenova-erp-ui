'use strict';
// A disposable Windows Run entry, never the installed app's entry or settings.
const {app}=require('electron');
const assert=require('node:assert/strict');
const path=require('node:path');
const {createStartup}=require('../startup.cjs');
const name='NenovaStartupSmoke-'+process.pid;
app.whenReady().then(()=>{
  if(process.platform!=='win32')throw Error('Windows required');
  // Run entries are never executed. Include the spaces found in the NSIS install path.
  for(const execPath of [process.execPath,path.join(app.getPath('temp'),'Nenova Startup Smoke','Nenova Desktop.exe')]) {
  let saved=null;
  const options={path:execPath,args:['nenova-autostart']};
  const adapter={isPackaged:true,getLoginItemSettings:o=>{const r=app.getLoginItemSettings(o);return {...r,launchItems:r.launchItems?.filter(v=>v.name===name).map(v=>({...v,name:'NenovaDesktop'}))};},
    setLoginItemSettings:o=>app.setLoginItemSettings({...o,name})};
  const policy=createStartup({app:adapter,execPath,read:()=>saved,write:v=>{saved=v}});
  try {
    assert.equal(policy.set(true).enabled,true);
    assert.equal(policy.state().enabled,true);
    assert.equal(policy.set(false).enabled,false);
    assert.equal(policy.initialize().enabled,false);
    console.log('STARTUP_NATIVE_PASS: Windows registration/readback/disable; spaces='+execPath.includes(' ')+'; disposable name only, no reboot.');
  } finally {app.setLoginItemSettings({...options,name,openAtLogin:false,enabled:false});}
  }
}).then(()=>app.exit(0)).catch(error=>{console.error(error.message);app.exit(1)});
