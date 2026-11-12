const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),fsSync=require('node:fs'),vm=require('node:vm'),os=require('node:os'),path=require('node:path');
const core=require('../lib/shipmentStatement.cjs'),store=require('../lib/shipmentStatementLabelStore.cjs'),{buildWorkbook}=require('../lib/shipmentStatementWorkbook.cjs');

test('표시명 매칭은 품목별로 저장되고 다시 읽어도 유지, 빈 값이면 해제, 잘못된 값은 거부',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'stmt-label-')),o={root};
 try{
  assert.deepEqual(await store.readAll(o),{});
  await store.setLabel(11,'  수국   블루 ','staff',o);await store.setLabel(12,'카네이션 문라이트','staff',o);
  assert.deepEqual(await store.readAll(o),{11:'수국 블루',12:'카네이션 문라이트'});
  await store.setLabel(11,'수국 하늘','staff-2',o);assert.equal((await store.readAll(o))[11],'수국 하늘');
  await store.setLabel(11,'   ','staff',o);assert.deepEqual(await store.readAll(o),{12:'카네이션 문라이트'});
  await store.setLabel(99,'','staff',o);
  await assert.rejects(()=>store.setLabel('../x','a','staff',o),{statusCode:400});
  await assert.rejects(()=>store.setLabel(0,'a','staff',o),{statusCode:400});
  await assert.rejects(()=>store.setLabel(5,'가'.repeat(101),'staff',o),{statusCode:400});
  await assert.rejects(()=>store.setLabel(5,'a','',o),{statusCode:400});
 }finally{await fs.rm(root,{recursive:true,force:true});}
});

const rows=[{id:'a',prodKey:11,name:'수국 블루 (블루）',originalName:'수국 블루 (블루）',category:JSON.stringify(['콜롬비아','수국']),country:'콜롬비아',flower:'수국',unit:'박스',cost:2800,qty:2,sources:[]},{id:'b',prodKey:12,name:'카네이션 문라이트',originalName:'카네이션 문라이트',category:JSON.stringify(['콜롬비아','카네이션']),country:'콜롬비아',flower:'카네이션',unit:'박스',cost:11500,qty:5,sources:[]}];
const calendar=['수','목','금','토','일','월','화'].map((day,i)=>({day,date:`2026-11-${String(11+i).padStart(2,'0')}`}));
const record={source:{customer:{name:'연습업체'},rows,calendar},draft:{defaultDay:'수',groups:[],entries:{}}};
const names=wb=>Object.values(wb.Sheets.수).filter(c=>c&&c.t==='s').map(c=>c.v);
test('엑셀은 매칭된 표시명을 우선 사용하고 없는 품목은 자동 이름, 원본 기록은 변경하지 않음',()=>{
 const before=JSON.stringify(record),base=names(buildWorkbook(record)),edited=names(buildWorkbook(record,{11:'블루수국 특대'}));
 assert.ok(!base.includes('블루수국 특대'));assert.ok(edited.includes('블루수국 특대'));assert.ok(edited.includes(base.find(v=>v.includes('문라이트'))));
 assert.equal(JSON.stringify(record),before);
});

function handler(deps){const src=fsSync.readFileSync('pages/api/shipment/statement.js','utf8').replace(/^import .*;\r?\n/gm,'').split('export default')[0].replace('export function','function')+'\nmodule.exports=statementHandler;';const box={module:{exports:{}},core,console};vm.runInNewContext(src,box);return box.module.exports(deps);}
const res=()=>({headers:{},setHeader(k,v){this.headers[k]=v;},status(n){this.code=n;return this;},json(d){this.body=d;return this;},send(d){this.body=d;return this;},end(){return this;}});
test('API: 표시명 저장은 로그인 필요·조회/다운로드에 매칭 전달',async()=>{
 const calls=[];const labels={readAll:async()=>({11:'X'}),setLabel:async(k,l,u)=>{calls.push([k,l,u]);return {prodKey:Number(k),label:l};}};
 let exported;const h=handler({labels,open:async()=>({draft:{}}),read:async()=>record,export:(r,m)=>{exported=m;return Buffer.from('x');}});
 let r=res();await h({method:'POST',query:{year:'2026',week:46,action:'label'},body:{prodKey:11,label:'X'}},r);assert.equal(r.code,401);assert.equal(calls.length,0);
 r=res();await h({method:'POST',query:{year:'2026',week:46,action:'label'},body:{prodKey:11,label:'X'},user:{userId:'staff'}},r);assert.equal(r.code,200);assert.deepEqual(calls,[[11,'X','staff']]);
 r=res();await h({method:'GET',query:{year:'2026',week:46,custKey:7},user:{userId:'staff'}},r);assert.deepEqual(r.body.labels,{11:'X'});
 r=res();await h({method:'GET',query:{year:'2026',week:46,custKey:7,action:'download',version:'1'},user:{userId:'staff'}},r);assert.equal(r.code,200);assert.deepEqual(exported,{11:'X'});
});
