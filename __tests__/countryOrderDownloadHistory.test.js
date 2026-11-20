import assert from 'node:assert/strict';
import {test} from 'node:test';
import * as XLSX from 'xlsx';
import {appendOrderDownload, compareOrderDownload, countryDownloadEvent, downloadHistoryKey, orderWorkbookRows, readOrderDownloads, saveOrderFile} from '../lib/countryOrderDownloadHistory.js';

test('compare product totals by unit and distinguish deleted and added rows',()=>{
  const workbook=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook,XLSX.utils.aoa_to_sheet([
    ['중국 발주서 2026 | Semana 46-01차'],[],['품목','단위','테스트 업체','합계'],
    ['장미'],['화이트','단',1,1],['화이트','송이',50,50],['화이트','단',2,2],
    ['TOTAL','',100,100],
  ]),'업체별 발주');
  const rows=orderWorkbookRows(workbook);
  assert.deepEqual(rows.map(row=>row.quantity),[3,50]);
  const next=[{name:'화이트',unit:'단',quantity:7},{name:'레드',unit:'송이',quantity:10}];
  assert.deepEqual(compareOrderDownload(rows,next).map(row=>[row.unit,row.before,row.after]),[
    ['단',3,7],['송이',50,null],['송이',null,10],
  ]);
});

test('comparison preserves five downloads and isolates year, file, account, country and exact subcycle',async()=>{
  const map=new Map(),storage={getItem:key=>map.get(key),setItem:(key,value)=>map.set(key,value)};
  const scope={country:'China',year:2026,week:'46-01'};
  const key=await downloadHistoryKey('fixture',scope,'46-01_A.xlsx');
  assert.deepEqual(readOrderDownloads(storage,key),[]);
  for(let i=1;i<=6;i++) await appendOrderDownload(storage,key,{id:i,rows:[]});
  assert.deepEqual(readOrderDownloads(storage,key).map(row=>row.id),[6,5,4,3,2]);
  for(const [user,context,file] of [
    ['fixture',{...scope,year:2025},'46-01_A.xlsx'],['fixture',{...scope,week:'46-02'},'46-01_A.xlsx'],
    ['fixture',{...scope,country:'Netherlands'},'46-01_A.xlsx'],['fixture',scope,'46-01_B.xlsx'],
    ['other',scope,'46-01_A.xlsx'],
  ]) assert.deepEqual(readOrderDownloads(storage,await downloadHistoryKey(user,context,file)),[]);
  assert(!key.includes('fixture'));
});

test('native browser success waits for writable close and cancellation/failure never signal completion',async()=>{
  const calls=[];
  const bytes=new Uint8Array([1,2,3]);
  const options={bytes,filename:'test.xlsx',openPicker:async()=>({createWritable:async()=>({
    write:async value=>calls.push(value),close:async()=>calls.push('close'),abort:async()=>calls.push('abort'),
  })})};
  assert.equal(await saveOrderFile(options),'completed');
  assert.deepEqual(calls,[bytes,'close']);
  await assert.rejects(saveOrderFile({...options,openPicker:async()=>{throw new DOMException('cancel','AbortError');}}),{name:'AbortError'});
  await assert.rejects(saveOrderFile({...options,openPicker:async()=>({createWritable:async()=>({
    write:async()=>{throw Error('disk full');},abort:async()=>calls.push('abort'),
  })})}),/disk full/);
  assert.equal(calls.at(-1),'abort');
});

test('desktop watches the exact blob, distinguishing success from cancellation and interruption',async()=>{
  const url='blob:https://nenovaweb.com/01234567-89ab-4cde-8123-456789abcdef';
  const view=new EventTarget();
  Object.assign(view,{setTimeout,clearTimeout,URL:{createObjectURL:()=>url,revokeObjectURL:()=>{}}});
  const done=(detail)=>view.dispatchEvent(new CustomEvent(countryDownloadEvent,{detail}));
  for(const status of ['completed','cancelled','interrupted']) {
    const document={defaultView:view,body:{appendChild(){}},createElement:()=>({
      remove(){},click(){done({url:'blob:other',status:'completed'});done({url,status});},
    })};
    const options={document,filename:'test.xlsx',bytes:new Uint8Array([1])};
    assert.equal(await saveOrderFile({...options,desktop:true}),status);
    assert.equal(await saveOrderFile(options),'requested');
  }
});
