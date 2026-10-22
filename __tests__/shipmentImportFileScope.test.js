import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import XLSX from 'xlsx';
const source=fs.readFileSync('lib/shipmentImport.js','utf8').replace(/^import[\s\S]*?;\r?\n/gm,'').replace(/^export \{[^}]+\} from [^;]+;/gm,'').replace(/export /g,'');
const parser={normalizeOrderWeek:x=>x,cleanPivotProdName:x=>x};vm.createContext(parser);vm.runInContext(source+'\nthis.parse=parseAllocationWorkbook;',parser);
function workbook(name,family){const b=XLSX.utils.book_new();XLSX.utils.book_append_sheet(b,XLSX.utils.aoa_to_sheet([[family],[],['','Fixture A','주문','입고'],['PINK',5,5,0]]),name);return b;}
const old=workbook('카네이션','카네이션');assert.ok(parser.parse(XLSX,old).rows.every(r=>r.productFamily==='carnation'));
const fresh=workbook('Sheet1','수국');XLSX.utils.book_append_sheet(fresh,XLSX.utils.aoa_to_sheet([['kind','sheet','label','key'],['prod','카네이션','WHITE',502]]),'_keymap');
const parsed=parser.parse(XLSX,fresh,{sourceName:'old-carnation.xlsx'});assert.ok(parsed.rows.length>0);assert.ok(parsed.rows.every(r=>r.productFamily==='hydrangea'));assert.ok(!Array.from(parsed.prodKeysInScope).includes(502));
XLSX.utils.book_append_sheet(fresh,XLSX.utils.aoa_to_sheet([['장미'],[],['','Fixture A','주문','입고'],['ROSE',3,3,0]]),'장미');
assert.deepEqual([...new Set(parser.parse(XLSX,fresh).rows.map(r=>r.productFamily))].sort(),['hydrangea','rose']);
fresh.Workbook={Sheets:[{Hidden:0},{Hidden:1},{Hidden:1}]};assert.ok(parser.parse(XLSX,fresh).rows.every(r=>r.productFamily==='hydrangea'));
const pivot=XLSX.utils.book_new();XLSX.utils.book_append_sheet(pivot,XLSX.utils.aoa_to_sheet([['품명','컬러','출고수량','_CustKey','_ProdKey'],['수국','WHITE',5,533,501]]),'업체');assert.equal(parser.parse(XLSX,pivot).rows[0].productFamily,'hydrangea');
console.log('PASS fresh-file contents, header family, multiple visible sheets, hidden/stale keymap and pivot category');
