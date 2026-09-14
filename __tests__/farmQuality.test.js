import assert from 'node:assert/strict';
import fs from 'node:fs';
import {qualityScope,qualityWeek,qualityGroups,qualityStatus,transitionQuality} from '../lib/farmQuality.js';
const scope=qualityScope({year:2026,from:35,to:37});
const base={OrderYear:2026,OrderWeek:'36',ProdKey:5,FarmName:'Farm A',SourceUnit:'박스',Quantity:2,ImportConfirmed:true,IsDeleted:false};
const rows=[{...base,DeductionKey:1},{...base,DeductionKey:1},
 {...base,DeductionKey:2,OrderYear:2025}, {...base,DeductionKey:3,OrderWeek:'37-01',Quantity:5,OriginalQuantity:3},
 {...base,DeductionKey:4,SourceUnit:'송이',Quantity:40}, {...base,DeductionKey:5,ImportConfirmed:false},
 {...base,DeductionKey:6,IsDeleted:true}, {...base,DeductionKey:7,FarmName:''}, {...base,DeductionKey:8,Quantity:0},
 {...base,DeductionKey:9,OrderWeek:'38'}, {...base,DeductionKey:10,OrderWeek:'36',ProdKey:null}];
const result=qualityGroups(rows,scope);
assert.equal(result.groups.length,2);
assert.equal(result.groups.find(g=>g.unit==='박스').quantity,5,'OriginalQuantity avoids carryover quantity duplication');
assert.equal(result.groups.find(g=>g.unit==='송이').quantity,40,'No mixing box and stem counts');
assert.equal(result.excluded,5);
assert.equal(qualityGroups(rows,qualityScope({year:2025})).groups[0].quantity,2);
assert.equal(qualityWeek('37-02'),37);assert.equal(qualityWeek('2026-37-02'),null);
for(const bad of [{year:0},{year:2026,from:38,to:35},{year:2026,to:54}])assert.throws(()=>qualityScope(bad));
assert.equal(qualityStatus({Status:'WAITING',DueDate:'2026-09-13'},'2026-09-14'),'OVERDUE');
assert.equal(qualityStatus({Status:'WAITING',DueDate:'2026-09-14'},'2026-09-14'),'WAITING');
assert.equal(qualityStatus({Status:'ANSWERED',DueDate:'2026-09-13'},'2026-09-14'),'ANSWERED');
for(const status of ['NEW','WAITING','ANSWERED','OBSERVING','CLOSED','RECURRED']) {
 assert.equal(transitionQuality(status,'COMMENT',false),status);
 assert.equal(transitionQuality(status,'REQUEST',true),'WAITING');
 assert.throws(()=>transitionQuality(status,'REQUEST',false));
}
assert.equal(transitionQuality('WAITING','RESPONSE',true),'ANSWERED');
assert.equal(transitionQuality('ANSWERED','APPLY',true),'OBSERVING');
assert.equal(transitionQuality('OBSERVING','CLOSE',true),'CLOSED');
assert.equal(transitionQuality('CLOSED','RECUR',true),'RECURRED');
assert.throws(()=>transitionQuality('NEW','RESPONSE',true));
assert.throws(()=>transitionQuality('WAITING','CLOSE',true));
const store=fs.readFileSync('lib/farmQualityStore.js','utf8');
const page=fs.readFileSync('pages/sales/farm-quality.js','utf8');
assert.match(store,/RequestKey=@req/);assert.match(store,/PayloadHash!==hash/);
assert.match(store,/WITH\(UPDLOCK,HOLDLOCK\)/);assert.match(store,/OrderYear=@year/);
assert.match(store,/kind!=='COMMENT'&&Number\(input.version\)!==current.Version/);
assert.doesNotMatch(store,/(INSERT|UPDATE|DELETE)\s+(?:dbo\.)?(?:Estimate|OrderDetail|ShipmentDetail|StockHistory|WebSalesDefectDeduction)\b/i);
assert.doesNotMatch(store,/CustName|CustKey|Customer/);
assert.match(page,/useState\('graph'\)/,'기존 불량 분석값이 진입 즉시 보여야 한다.');
assert.match(page,/기존 불량 분석 · 농장·품목 \{groups\.length\}개/,'분석에 반영된 농장·품목 수를 표시해야 한다.');
console.log('Farm quality: cross-year, source, units, status and write boundaries passed');
