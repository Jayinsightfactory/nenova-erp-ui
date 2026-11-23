'use strict';
// A disposable Windows Run entry, never the installed app's entry or settings.
const {app}=require('electron');
const assert=require('node:assert/strict');
const {createStartup}=require('../startup.cjs');
const name='NenovaStartupSmoke-'+process.pid;
let saved=null;
const options={path:process.execPath,args:['nenova-autostart']};
app.whenReady().then(()=>{
  if(process.platform!=='win32')throw Error('Windows required');
  const adapter={isPackaged:true,getLoginItemSettings:o=>{const r=app.getLoginItemSettings(o);return {...r,launchItems:r.launchItems?.filter(v=>v.name===name).map(v=>({...v,name:'NenovaDesktop'}))};},
    setLoginItemSettings:o=>app.setLoginItemSettings({...o,name})};
  const policy=createStartup({app:adapter,read:()=>saved,write:v=>{saved=v}});
  try {
    assert.equal(policy.set(true).enabled,true);
    assert.equal(policy.state().enabled,true);
    assert.equal(policy.set(false).enabled,false);
    assert.equal(policy.initialize().enabled,false);
    console.log('STARTUP_NATIVE_PASS: Windows registration/readback/disable; disposable name only, no reboot.');
  } finally {app.setLoginItemSettings({...options,name,openAtLogin:false,enabled:false});}
}).then(()=>app.exit(0)).catch(error=>{console.error(error.message);app.exit(1)});
