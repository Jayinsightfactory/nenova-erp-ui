const test=require('node:test'),assert=require('node:assert/strict');
const {filterBoxSummary,boxSummaryTotals,boxSummaryYear,WAREHOUSE_BOX_SQL}=require('../lib/warehouseBoxSummary.js');
test('same week other year excluded; stored decimals, zero and missing distinguished',()=>{
 const rows=[{OrderYear:'2025',OrderWeek:'42-01',country:'중국',flower:'수국',boxes:999},
 {OrderYear:'2026',OrderWeek:'42-01',country:'중국',flower:'수국',boxes:1.5,lineCount:2,missingBoxes:0},
 {OrderYear:'2026',OrderWeek:'42-01',country:'중국',flower:'장미',boxes:0,lineCount:1,missingBoxes:0},
 {OrderYear:'2026',OrderWeek:'42-02',country:'미분류',flower:'미분류',boxes:null,lineCount:1,missingBoxes:1}];
 assert.deepEqual(boxSummaryTotals(filterBoxSummary(rows,{year:'2026'})),{boxes:1.5,lineCount:4,missingBoxes:1});
 assert.equal(filterBoxSummary(rows,{year:'2026',week:'42-01',country:'중국',flower:'장미'})[0].boxes,0);
 assert.equal(filterBoxSummary(rows,{year:'2026',country:'콜롬비아'}).length,0);
 for(const value of [undefined,'','0','2026 OR 1=1',false])assert.throws(()=>boxSummaryYear(value));
 assert.match(WAREHOUSE_BOX_SQL,/wm.OrderYear=@year/);assert.doesNotMatch(WAREHOUSE_BOX_SQL,/JOIN (?:Farm|Order)|p.isDeleted|wd.isDeleted|SteamOf1Box|\b(?:INSERT|UPDATE|DELETE)\b/i);
});
