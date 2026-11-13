'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),XLSX=require('xlsx');
const {EventEmitter}=require('node:events'),{createOrderFileReader}=require('../lib/orderImportFileAsync.cjs');
test('real child mirrors original bytes and matches canonical workbook preview with a responsive parent',async()=>{
 const {parseOrderImportWorkbook}=await import('../lib/orderImportParse.js');
 const old=process.cwd(),dir=fs.mkdtempSync(path.join(os.tmpdir(),'nenova-order-parse-')),r=createOrderFileReader({projectRoot:old});
 let beats=0,timer;try{
  process.chdir(dir);const book=XLSX.utils.book_new(),rows=[['품명','단위','수량','단가'],...Array.from({length:1000},(_,i)=>['합성 품목 '+i,'송이',5,1000])];
  XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([['참고']]),'참고');XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet(rows),'본문');
  const file=path.join(dir,'fixture.xlsx'),sourceName='47차 합성업체 출고 내역서.xlsx';XLSX.writeFile(book,file);
  const bytes=fs.readFileSync(file),expected=parseOrderImportWorkbook(XLSX,XLSX.read(Buffer.from(bytes),{type:'buffer',cellDates:false,cellNF:false,cellStyles:false}),{sourceName,sheetName:'본문'});assert.ok(expected.rows.length>=900);
  timer=setInterval(()=>beats++,5);const actual=await r.run({filepath:file,sourceName,sheetName:'본문',uploaderName:'합성 업무'});
  assert.deepEqual(actual,expected);assert.ok(beats>=2);const entries=fs.readFileSync(path.join(dir,'data/drive/index.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(entries.length,1);assert.equal(entries[0].source,'orders/import-parse');assert.equal(entries[0].uploaderName,'합성 업무');
  assert.ok(fs.readFileSync(path.join(dir,'data/drive',entries[0].rel)).equals(bytes),'mirrored original must equal the pre-parse file');
 }finally{clearInterval(timer);await r.close();process.chdir(old);fs.rmSync(dir,{recursive:true,force:true});}
});
test('bounded backlog and absolute expiry reject before dispatch; only four allowed fields reach child',async()=>{
 const w=new EventEmitter();let sent=[];Object.assign(w,{ref(){},unref(){},postMessage(v){sent.push(v);},terminate:async()=>{}});
 const r=createOrderFileReader({start:()=>w,maxQueued:1,queueMs:25});
 const hold=setInterval(()=>{},100);try{
  const first=r.run({filepath:'from-formidable',sourceName:'sample.xlsx',sheetName:'a',uploaderName:'test',token:'must-not-send',user:{private:true}}),second=r.run({});
  await assert.rejects(r.run({}),{statusCode:503});await assert.rejects(second,{statusCode:503});
  assert.equal(sent.length,1);assert.deepEqual(Object.keys(sent[0].input).sort(),['filepath','sheetName','sourceName','uploaderName']);w.emit('message',{id:sent[0].id,ok:true,parsed:7});assert.equal(await first,7);
 }finally{await r.close();clearInterval(hold);}
});
