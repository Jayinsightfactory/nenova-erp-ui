import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import XLSX from 'xlsx';
import {parseJugwangWeekdaySheet,checkJugwangExisting,jugwangUploadScope} from '../lib/jugwangWeekdayUpload.js';
import {signJugwang,verifyJugwang} from '../lib/jugwangWeekdayUploadServer.js';
const scope={...jugwangUploadScope('2026','2026-42-01'),category:'카네이션'};
function book(rows,name='주광 발주내역'){const b=XLSX.utils.book_new();XLSX.utils.book_append_sheet(b,XLSX.utils.aoa_to_sheet(rows),name);return b;}
const source=book([
 ['주광 발주내역 · 42차'],['카네이션','품명','42-1 물량표 기준','42-1',null,null,'42-1 합계'],
 [null,null,null,'10/18 일','10/18 윌슨 일','10/18 일 합계'],
 [null,'상품A',7,6,1,7,7],['수국','상품B',5,5,null,5,5],
]);
let parsed=parseJugwangWeekdaySheet(XLSX,source,'주광 발주내역',scope);
assert.equal(parsed.rows.length,1);assert.equal(parsed.rows[0].dates[0].quantity,7);assert.equal(parsed.warnings.length,0);
assert.equal(parseJugwangWeekdaySheet(XLSX,source,'주광 발주내역',{...scope,category:'수국'}).rows[0].dates[0].quantity,5);
source.Sheets['주광 발주내역'].F4.v=8;
assert.match(parseJugwangWeekdaySheet(XLSX,source,'주광 발주내역',scope).warnings.join(),/불일치/);
source.Sheets['주광 발주내역'].F4.v=7;
source.Sheets['주광 발주내역'].D4.f='SUM(A1)';
assert.match(parseJugwangWeekdaySheet(XLSX,source,'주광 발주내역',scope).warnings.join(),/수식/);
assert.throws(()=>jugwangUploadScope('2026','2025-42-01'));
assert.throws(()=>parseJugwangWeekdaySheet(XLSX,source,'주광 발주내역',{...scope,orderWeek:'44-01'}));
const native=book([['2026년 9월 20일 일요일 오전 출고'],['카네이션','색상','선출고(목요일)','발주수량','부산윌슨',null,'(22일) 화요일 출고 예정',null,'수요일 사용'],[null,'A',20,6,1,null,2,null,99],[null,'B',null,null,0]],'주광 38차');
parsed=parseJugwangWeekdaySheet(XLSX,native,'주광 38차',{...scope,orderWeek:'38-01'});
assert.equal(parsed.rows.length,1);assert.equal(parsed.rows[0].dates[0].quantity,7);
parsed=parseJugwangWeekdaySheet(XLSX,native,'주광 38차',{...scope,orderWeek:'38-02'});
assert.equal(parsed.rows[0].dates[0].date,'2026-09-22');assert.equal(parsed.rows[0].dates[0].quantity,2);
assert.throws(()=>parseJugwangWeekdaySheet(XLSX,native,'주광 38차',{...scope,year:'2027'}));
const change={dates:[{date:'2026-10-18',quantity:7}]};
assert.equal(checkJugwangExisting(change,{detailRows:0,master:{MasterIsFix:0}},10),'NEW');
assert.throws(()=>checkJugwangExisting(change,{detailRows:0},6));
assert.throws(()=>checkJugwangExisting(change,{detailRows:0},0));
assert.throws(()=>checkJugwangExisting(change,{detailRows:0,master:{MasterIsFix:1}},10));
const actual={detailRows:1,shipmentOutQuantity:7,shipmentDates:[{date:'2026-10-18',shipmentQuantity:7}]};
assert.equal(checkJugwangExisting(change,actual,10),'UNCHANGED');
assert.throws(()=>checkJugwangExisting({...change,dates:[{date:'2026-10-18',quantity:8}]},actual,10));
const token=signJugwang({scope},'fixture','source','test-secret');
assert.deepEqual(verifyJugwang(token,'fixture','source','test-secret'),{scope});
assert.throws(()=>verifyJugwang(token,'other','source','test-secret'));
assert.throws(()=>verifyJugwang(token,'fixture','plan','test-secret'));
assert.throws(()=>verifyJugwang(token+'x','fixture','source','test-secret'));
// Execute the production allocation parser with stale _keymap data for a removed
// carnation sheet: it must never extend a hydrangea-only upload's scope.
const parserSource=fs.readFileSync('lib/shipmentImport.js','utf8').replace(/^import[\s\S]*?;\r?\n/gm,'').replace(/^export \{[^}]+\} from [^;]+;/gm,'').replace(/export /g,'');
const parser={normalizeOrderWeek:x=>x,cleanPivotProdName:x=>x};vm.createContext(parser);vm.runInContext(parserSource+'\nthis.parse=parseAllocationWorkbook;',parser);
const allocation=book([['수국'],['품목','Fixture A'],['Flower',1]],'수국');
XLSX.utils.book_append_sheet(allocation,XLSX.utils.aoa_to_sheet([['kind','sheet','label','key'],['cust','수국','Fixture A',533],['prod','수국','Flower',20],['cust','카네이션','Fixture A',533],['prod','카네이션','Other',30]]),'_keymap');
const scoped=parser.parse(XLSX,allocation,{sheetName:'수국'});
assert.ok(!Array.from(scoped.prodKeysInScope).includes(30));assert.ok(Array.from(scoped.prodKeysInScope).includes(20));
assert.ok(!Array.from(scoped.pairKeysInScope).includes('533|30'));
const repeated=book([
 ['주광 발주내역'],['카네이션','품목',null,'42-1'],[null,null,null,'10/18 일'],
 [null,'A',null,2],['수국','품목',null,'42-1'],[null,null,null,'10/18 일'],
 [null,'B',null,3],[null,'합 계',null,3],['기타','품목',null,'42-1'],[null,'Other',null,99],
]);
const selected=parseJugwangWeekdaySheet(XLSX,repeated,'주광 발주내역',{...scope,category:'수국'});
assert.equal(selected.rows.length,1);assert.equal(selected.rows[0].label,'B');assert.deepEqual(selected.warnings,[]);
native.Sheets['주광 38차'].A2.v='카네\r\n이션';
native.Sheets['주광 38차'].B4.v='합 계';native.Sheets['주광 38차'].D4={t:'n',v:7,f:'SUM(D3)'};
const spaced=parseJugwangWeekdaySheet(XLSX,native,'주광 38차',{...scope,orderWeek:'38-01'});
assert.equal(spaced.rows.length,1);assert.deepEqual(spaced.warnings,[]);
console.log('Jugwang weekday upload: source totals, selected category/sheet, stale keymap, blank/zero preservation, cross-year, duplicate/conflict, fixed and signed preview passed');
