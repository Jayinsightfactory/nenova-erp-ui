import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import {createRequire} from 'node:module';
import {appendCostWorkbookHistory,costWorkbookDigest} from '../lib/invoiceCostWorkbookHistory.js';
import {preserveCostHistory} from '../lib/invoiceCostHistoryStore.js';
import {createInvoiceCostWorkbook} from '../lib/invoiceReceiptCostExport.js';
import {invoiceCostExportFixture} from './invoiceReceiptCostExport.test.js';
const XLSX=createRequire(import.meta.url)('xlsx');
test('past worksheet XML remains exact and new references target renamed calculation sheets',async()=>{
 const f=invoiceCostExportFixture(3,'TH_GROUP_BOX_SHARE_V1'),first=await createInvoiceCostWorkbook(f);
 f.document.orderWeek='44-01';const next=await createInvoiceCostWorkbook(f);
 const result=await appendCostWorkbookHistory(first,next,{label:'44-01'}),old=await JSZip.loadAsync(first),zip=await JSZip.loadAsync(result);
 for(const n of ['sheet1.xml','sheet2.xml','sheet3.xml'])assert.equal(await zip.file('xl/worksheets/'+n).async('string'),await old.file('xl/worksheets/'+n).async('string'));
 const book=XLSX.read(result,{cellFormula:true});assert.equal(book.SheetNames.length,6);
 const formula=book.Sheets['44-01 원본 양식 계산'].M15.f;assert.ok(formula);
 assert.match(book.Sheets['44-01 원본수식 비교'].B4.f,/44-01 원본 양식 계산/);
 assert.ok(book.Sheets['원본 양식 계산'].F15);
});
test('private archive is idempotent and separates user/year/country scope',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'cost-history-'));
 try{
  const f=invoiceCostExportFixture(3,'NL_AMOUNT_V1'),bytes=await createInvoiceCostWorkbook(f),user={userId:'fixture-user'};
  const run=(context=f,u=user)=>preserveCostHistory({bytes,context,user:u,root});
  const a=await run();assert.deepEqual(await run(),a);
  f.document.orderWeek='44-01';const next=await createInvoiceCostWorkbook(f);
  const b=await preserveCostHistory({bytes:next,context:f,user,root});assert.equal(XLSX.read(b).SheetNames.length,6);
  assert.equal(XLSX.read(await run(f,{userId:'other'})).SheetNames.length,3);
  f.document.orderYear='2025';assert.equal(XLSX.read(await run()).SheetNames.length,3);
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
test('archive digest ignores ZIP timestamps and dollar format codes stay valid',async()=>{
 const f=invoiceCostExportFixture(3,'NL_AMOUNT_V1'),bytes=await createInvoiceCostWorkbook(f),zip=await JSZip.loadAsync(bytes);
 for(const file of Object.values(zip.files))file.date=new Date('2020-01-01T00:00:00Z');
 const repacked=await zip.generateAsync({type:'nodebuffer'});
 assert.equal(await costWorkbookDigest(bytes),await costWorkbookDigest(repacked));
 let styles=await zip.file('xl/styles.xml').async('string');
 styles=styles.replace(/formatCode="[^"]*"/,()=>`formatCode="$&amp; #,##0"`);zip.file('xl/styles.xml',styles);
 const result=await appendCostWorkbookHistory(await zip.generateAsync({type:'nodebuffer'}),bytes,{label:'44-01'});
 const out=await JSZip.loadAsync(result),merged=await out.file('xl/styles.xml').async('string');
 assert.equal((merged.match(/<numFmts\b/g)||[]).length,1);
 assert.ok(merged.includes('formatCode="$&amp; #,##0"'));
 assert.equal((merged.match(/<styleSheet\b/g)||[]).length,1);
});
test('history lock and revoked seed access never overwrite the saved archive',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'cost-history-access-'));
 try{
  const context=invoiceCostExportFixture(3,'NL_AMOUNT_V1'),bytes=await createInvoiceCostWorkbook(context),user={userId:'fixture-user'};
  await preserveCostHistory({bytes,context,user,root});
  const dir=path.join(root,(await fs.readdir(root))[0]),pointer=path.join(dir,'latest.json');
  const before=await fs.readFile(pointer,'utf8');await fs.writeFile(path.join(dir,'lock'),'test');
  await assert.rejects(preserveCostHistory({bytes,context,user,root}),e=>e.statusCode===409);
  assert.equal(await fs.readFile(pointer,'utf8'),before);await fs.unlink(path.join(dir,'lock'));
  await fs.writeFile(pointer,JSON.stringify({...JSON.parse(before),seedId:'revoked-source'}));
  await assert.rejects(preserveCostHistory({bytes,context,user,root}),/접근 권한/);
  assert.equal((await fs.readdir(dir)).includes('lock'),false);
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
