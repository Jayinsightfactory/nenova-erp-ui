const {test}=require('node:test'),assert=require('node:assert/strict');
const {launchTaskShortcut}=require('../task-launcher.cjs');
const {requestOptions}=require('../home-workspace.cjs');
test('launch validates current menu and rejects account races; moving never writes completion',async()=>{
 let calls=[],current=true;
 const deps={owner:'fixture',isCurrent:()=>current,menus:[{items:[{href:'/orders/new',labelKey:'주문등록',popup:false}]}],openMenu:async data=>calls.push(data),confirmWeb:async()=>true,openWeb:async url=>calls.push(url)};
 assert.deepEqual(await launchTaskShortcut({...deps,payload:{shortcut:{kind:'desktop',target:'/orders/new',label:'열기'}}}),{opened:true});assert.equal(calls[0].url,'https://nenovaweb.com/orders/new');
 await assert.rejects(()=>launchTaskShortcut({...deps,payload:{shortcut:{kind:'desktop',target:'/admin/secret',label:'열기'}}}),/계정/);assert.equal(calls.length,1);
 assert.deepEqual(await launchTaskShortcut({...deps,confirmWeb:async()=>false,payload:{shortcut:{kind:'web',target:'https://example.com',label:'웹'}}}),{opened:false});
 await assert.rejects(()=>launchTaskShortcut({...deps,confirmWeb:async()=>{current=false;return true;},payload:{shortcut:{kind:'web',target:'https://example.com',label:'웹'}}}),/계정/);assert.equal(calls.length,1);
 current=true;await launchTaskShortcut({...deps,payload:{shortcut:{kind:'web',target:'http://example.com',label:'웹'}}});assert.equal(calls[1],'http://example.com/');
});
test('IPC body forwards explicit clearing and strips owner/URL fields',()=>{
 const result=requestOptions({method:'POST',command:{action:'update',expectedRevision:3,requestId:'schedule-001',date:'2026-01-01',title:'업무',startTime:'',endTime:'',shortcut:null,ownerId:'other',url:'file:///x'}},'owner');
 const body=JSON.parse(result.options.body);assert.equal(body.startTime,'');assert.equal(body.shortcut,null);assert.equal(body.expectedOwnerId,'owner');assert.equal('url' in body,false);
});
