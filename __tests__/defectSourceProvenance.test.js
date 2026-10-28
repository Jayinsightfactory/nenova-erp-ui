import assert from 'node:assert/strict';
import fs from 'node:fs';
import { resolveDefectRowSourceFile } from '../lib/defectSourceProvenance.js';
import { detectDefectAutoSource, autoSourceStateFromRow } from '../lib/salesDefectAutoSource.js';
import { saveDraftRows } from '../lib/salesDefectDeductions.js';
assert.equal(resolveDefectRowSourceFile({sourceFileName:''},'kakao-defect:first'),'');
assert.equal(resolveDefectRowSourceFile({sourceFileName:'second.xlsx'},'first.xlsx'),'second.xlsx');
assert.equal(resolveDefectRowSourceFile({note:'kakao-defect:event:1 / 원문'},'kakao-defect:event'),'kakao-defect:event');
assert.throws(()=>resolveDefectRowSourceFile({note:''},'kakao-defect:event'));
assert.equal(resolveDefectRowSourceFile({},'legacy.xlsx'),'legacy.xlsx');
assert.equal(resolveDefectRowSourceFile({},''),'');
const manual={SourceFileName:'kakao-defect:event',Note:'kakao-defect:event:1',AutoSourceExcluded:true,ManualSourceConfirmed:true};
assert.equal(detectDefectAutoSource({row:manual}).excluded,false);
assert.equal(autoSourceStateFromRow(manual).excluded,false);
const captured=[];let stored,key=2000;
const query=async(q,p)=>{
  if(/INSERT INTO WebSalesDefectDeduction\s/.test(q)){
    key++;captured.push(p.file.value);stored={DeductionKey:key,OrderYear:p.year.value,OrderWeek:p.week.value,
      CustKey:p.ck.value,CustName:p.cn.value,ProdKey:p.pk.value,ProdName:p.pn.value,Quantity:p.qty.value,SourceUnit:p.unit.value,
      SourceFileName:p.file.value,Note:p.note.value,Status:'DRAFT',CreatedBy:'test',RowVersionNo:1};return {recordset:[{DeductionKey:key}]};
  }
  if(/FROM WebSalesDefectDeduction d/.test(q))return {recordset:[stored]};
  if(/INSERT INTO WebSalesDefectDeductionHistory/.test(q))return {rowsAffected:[1]};
  throw Error('unexpected source save query');
};
const row={customerName:'가상업체',custKey:100,productName:'가상품목',prodKey:200,quantity:1,sourceUnit:'단'};
for(const year of [2025,2026])await saveDraftRows({year,week:43,user:{authority:0,userId:'test'},sourceFileName:'kakao-defect:first',
  rows:[{...row,sourceFileName:'kakao-defect:first'},{...row,sourceFileName:''},{...row,sourceFileName:'second.xlsx'}]},
  {ensure:async()=>{},transaction:fn=>fn(query)});
assert.deepEqual(captured,['kakao-defect:first','','second.xlsx','kakao-defect:first','','second.xlsx']);
const page=fs.readFileSync(new URL('../pages/sales/defect-deductions.js',import.meta.url),'utf8');
assert.doesNotMatch(page,/sourceFileName:\s*rows\.find/);
assert.match(page.slice(page.indexOf('const emptyRow'),page.indexOf('const salesRowHasInput')),/sourceFileName:\s*''/);
console.log('row provenance: mixed auto/manual/Excel actual save isolation, explicit empty/missing/common defaults, 2025/2026 and manual-origin confirmation passed');
