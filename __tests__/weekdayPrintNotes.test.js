import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createWeekdayPrintNoteService} from '../lib/weekdayPrintNoteService.js';
import {weekdayPrintRowKey} from '../lib/weekdayPrintNotes.js';
import {buildWeekdayEstimatePrintBundle} from '../lib/weekdayEstimatePrintBundle.js';
const scope={source:'ALLOCATION',year:2026,majorWeek:'43',orderYearWeek:'202643',custKey:533,mode:'dates',dates:['2026-10-25']};
const row={ProdKey:359,ProdName:'브루트',Cost:100,Quantity:18,Unit:'단',UnitQuantity:'18단(1.2)',Amount:1636,Vat:164,EstimateType:'정상출고',_exePrint:true};
const user={userId:'fixture-user'};
test('durable row notes preserve ERP, separate year/customer/date/cost/type, CAS and explicit clearing',async()=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'nenova-print-notes-'));
  let reads=0;
  const service=createWeekdayPrintNoteService({directory,read:async()=>{reads++;return {items:[row]};}});
  const payload={scope,rowKey:weekdayPrintRowKey(row),note:'배송 전 연락 <script>',expectedRevision:0};
  try {
    const saved=await service.save(payload,user,()=>{throw Error('ERP mutation forbidden');},{});
    assert.equal(saved.note.revision,1);assert.equal(reads,1);
    const fresh=createWeekdayPrintNoteService({directory});
    assert.equal((await fresh.list(scope,[row]))[payload.rowKey].note,payload.note);
    for(const other of [{...scope,year:2025},{...scope,custKey:534},{...scope,dates:['2026-10-26']},{...scope,mode:'major',dates:[]}])assert.deepEqual(await fresh.list(other,[row]),{});
    for(const other of [{...row,Cost:101},{...row,EstimateType:'검역차감',EstimateKey:7},{...row,ProdKey:360}])assert.deepEqual(await fresh.list(scope,[other]),{});
    await assert.rejects(service.save(payload,user,null,{}),e=>e.code==='REVISION_CONFLICT');
    await assert.rejects(service.save({...payload,rowKey:'missing'},user,null,{}),e=>e.code==='PRINT_ROW_CHANGED');
    await assert.rejects(service.save({...payload,note:'x'.repeat(1001)},user,null,{}),e=>e.code==='INVALID_INPUT');
    await assert.rejects(service.save(payload,{...user,accountActive:false},null,{}),e=>e.statusCode===401);
    await assert.rejects(service.save({...payload,scope:{...scope,dates:['2026-10-25','2026-10-26']}},user,null,{}),e=>e.code==='INVALID_SCOPE');
    const cleared=await service.save({...payload,note:'',expectedRevision:1},user,null,{});
    assert.equal(cleared.note.note,'');assert.equal(cleared.note.revision,2);
  }finally{assert.ok(directory.startsWith(path.join(os.tmpdir(),'nenova-print-notes-')));await fs.rm(directory,{recursive:true,force:true});}
});
test('preview editable notes, explicit box false, header week only, escape HTML and unchanged quantities',()=>{
  const result={success:true,readOnly:true,draftIncluded:false,source:'ALLOCATION',scope,customer:{CustKey:533,CustName:'주광'},items:[row],confirmation:{required:false,fixedCount:0,unfixedCount:1,unknownCount:0},printNotes:{[weekdayPrintRowKey(row)]:{note:'<img src=x onerror=alert(1)>',revision:1}}};
  const before=JSON.stringify(result),args={requests:[scope],results:[result],printDate:'2026-10-23',editableRemarks:true};
  const yes=buildWeekdayEstimatePrintBundle(args),no=buildWeekdayEstimatePrintBundle({...args,showBoxQty:false});
  assert.match(yes.html,/18단<wbr>\(1.2\)/);assert.doesNotMatch(no.html,/18단<wbr>\(/);
  assert.match(no.html,/data-print-note-id=/);assert.match(no.html,/&lt;img src=x onerror=alert\(1\)&gt;/);assert.doesNotMatch(no.html,/<img src=x/);
  assert.match(no.html,/>43차</);assert.doesNotMatch(no.html,/43차 .*분배 기준/);
  assert.equal(no.noteEntries[0].text,result.printNotes[weekdayPrintRowKey(row)].note);assert.equal(JSON.stringify(result),before);
});

test('document header is durable, separate from rows and years, clears explicitly, and rejects concurrent saves',async()=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'nenova-print-header-'));
  const key='@document-header',read=async()=>({items:[row]});
  const service=createWeekdayPrintNoteService({directory,read});
  const payload={scope,rowKey:key,note:'43차 추가 출고',expectedRevision:0};
  try{
    await service.save(payload,user,null,{});
    const fresh=createWeekdayPrintNoteService({directory,read});
    assert.equal((await fresh.list(scope,[row]))[key].note,payload.note);
    assert.deepEqual(await fresh.list({...scope,year:2025},[row]),{});
    assert.deepEqual(await fresh.list({...scope,dates:['2026-10-26']},[row]),{});
    await assert.rejects(fresh.save(payload,user,null,{}),e=>e.code==='REVISION_CONFLICT');
    await assert.rejects(fresh.save({...payload,note:'bad\nline'},user,null,{}),e=>e.code==='INVALID_INPUT');
    await fresh.save({...payload,note:'',expectedRevision:1},user,null,{});
    assert.equal((await fresh.list(scope,[row]))[key].note,'');
    assert.equal((await fresh.list(scope,[row]))[weekdayPrintRowKey(row)],undefined);
    const result={success:true,readOnly:true,draftIncluded:false,source:'ALLOCATION',scope,customer:{CustKey:533,CustName:'fixture'},items:[row],confirmation:{required:false,fixedCount:0,unfixedCount:1,unknownCount:0},printNotes:await fresh.list(scope,[row])};
    const bundle=buildWeekdayEstimatePrintBundle({requests:[scope],results:[result],editableRemarks:true});
    assert.equal(bundle.noteEntries.find(e=>e.rowKey===key).text,'');
    assert.ok(bundle.html.includes('aria-label="견적서 차수 표시"'));
    assert.ok(bundle.html.includes('@page { size:A4; margin:10mm 15mm; }'));
    assert.ok(bundle.html.includes('tr { break-inside:avoid; page-break-inside:avoid; }'));
  }finally{await fs.rm(directory,{recursive:true,force:true});}
});

test('customer phone and header text are escaped without changing printable quantities',()=>{
  const result={success:true,readOnly:true,draftIncluded:false,source:'ALLOCATION',scope,customer:{CustKey:533,CustName:'fixture',Tel:'<test-phone>'},items:[row],confirmation:{required:false,fixedCount:1,unfixedCount:0,unknownCount:0},printNotes:{'@document-header':{note:'43차 <추가>',revision:1}}};
  const output=buildWeekdayEstimatePrintBundle({requests:[scope],results:[result],editableRemarks:true});
  assert.ok(output.html.includes('&lt;test-phone&gt;'));
  assert.ok(output.html.includes('43차 &lt;추가&gt;'));
  assert.ok(output.html.includes('18단<wbr>(1.2)'));
  assert.equal(result.items[0].Quantity,18);
});
