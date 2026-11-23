const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createStartup,startupDelay}=require('../startup.cjs');
function fixture({prior=null,actual={openAtLogin:false,executableWillLaunchAtLogin:false},packaged=true,fail=false}={}) {
 const calls=[];const app={isPackaged:packaged,getLoginItemSettings:()=>actual,setLoginItemSettings:v=>{calls.push(v);if(fail)throw Error('denied');actual={openAtLogin:false,executableWillLaunchAtLogin:v.enabled,launchItems:v.openAtLogin?[{name:v.name,path:v.path,args:v.args,enabled:v.enabled}]:[]};}};
 return {calls,service:createStartup({app,platform:'win32',execPath:'C:\\Program Files\\Nenova Desktop.exe',read:()=>prior,write:v=>{prior=v;}})};
}
test('first packaged launch registers once with the installed executable',()=>{const f=fixture();assert.equal(f.service.initialize().enabled,true);f.service.initialize();assert.equal(f.calls.length,1);assert.deepEqual(f.calls[0].args,['nenova-autostart']);assert.match(f.calls[0].path,/Program Files/);});
test('Windows disabled setting stays disabled after update',()=>{const f=fixture({prior:{initialized:true},actual:{openAtLogin:true,executableWillLaunchAtLogin:false}});assert.equal(f.service.initialize().enabled,false);assert.equal(f.calls.length,0);});
test('existing disabled registration is not overridden on migration',()=>{const f=fixture({actual:{openAtLogin:false,executableWillLaunchAtLogin:false,launchItems:[{name:'NenovaDesktop',enabled:false}]}});f.service.initialize();assert.equal(f.calls.length,0);});
test('explicit off persists across initialization and explicit on works',()=>{const f=fixture();f.service.initialize();assert.equal(f.service.set(false).enabled,false);f.service.initialize();assert.equal(f.calls.length,2);assert.equal(f.service.set(true).enabled,true);});
test('development and unsupported platforms do not touch startup',()=>{const f=fixture({packaged:false});assert.equal(f.service.initialize().supported,false);assert.equal(f.calls.length,0);});
test('registration failure is visible and does not crash startup',()=>{const f=fixture({fail:true});assert.match(f.service.initialize().message,/설정/);assert.equal(f.service.state().enabled,false);});
test('only login launches stagger; manual launches are immediate',()=>{assert.equal(startupDelay({packaged:true,argv:[]}),0);assert.equal(startupDelay({packaged:false,argv:['nenova-autostart']}),0);assert.equal(startupDelay({packaged:true,argv:['nenova-autostart'],random:()=>0}),15000);assert.equal(startupDelay({packaged:true,argv:['nenova-autostart'],random:()=>0.999}),44970);});
