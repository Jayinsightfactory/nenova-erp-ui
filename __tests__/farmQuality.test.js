import assert from 'node:assert/strict';
import fs from 'node:fs';
import {canDeleteFarmQuality,qualityScope,qualityWeek,qualityGroups,qualityAnalytics,qualitySignals,qualityStatus,transitionQuality} from '../lib/farmQuality.js';
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
assert.deepEqual(result.groups.find(g=>g.unit==='박스').sourceKeysByWeek,{36:[1],37:[3]});
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
assert.equal(canDeleteFarmQuality({userId:'nenovaSS3'}),true);
assert.equal(canDeleteFarmQuality({userId:'admin'}),false);
assert.equal(canDeleteFarmQuality({userId:'nenovaSS3 '}),false,'유사 계정이나 공백 변형을 관리자처럼 허용하면 안 된다.');
const analyticsGroups=qualityGroups([
 {...base,DeductionKey:101,OrderWeek:'35-01',ProdKey:1,ProductName:'A품목',Quantity:10},
 {...base,DeductionKey:102,OrderWeek:'36-02',ProdKey:1,ProductName:'A품목',Quantity:20},
 {...base,DeductionKey:103,OrderWeek:'36-01',ProdKey:2,ProductName:'B품목',Quantity:5,SourceUnit:'송이'},
 {...base,DeductionKey:104,OrderWeek:'37-01',FarmName:'Farm B',ProdKey:3,ProductName:'분모 없는 품목',Quantity:4}
],scope).groups;
const analytics=qualityAnalytics(analyticsGroups,[
 {OrderYear:2026,OrderWeek:'35-01',FarmName:' farm   a ',ProdKey:1,SourceUnit:'박스',IncomingQuantity:100},
 {OrderYear:2026,OrderWeek:'35-02',FarmName:'Farm A',ProdKey:9,SourceUnit:'박스',IncomingQuantity:50},
 {OrderYear:2026,OrderWeek:'36-01',FarmName:'Farm A',ProdKey:1,SourceUnit:'박스',IncomingQuantity:200},
 {OrderYear:2026,OrderWeek:'36-03',FarmName:'Farm A',ProdKey:9,SourceUnit:'박스',IncomingQuantity:100},
 {OrderYear:2026,OrderWeek:'37-01',FarmName:'Farm A',ProdKey:1,SourceUnit:'박스',IncomingQuantity:50},
 {OrderYear:2026,OrderWeek:'36-01',FarmName:'Farm A',ProdKey:2,SourceUnit:'박스',IncomingQuantity:500},
 {OrderYear:2026,OrderWeek:'36-01',FarmName:'Farm A',ProdKey:2,SourceUnit:'송이',IncomingQuantity:25},
 {OrderYear:2025,OrderWeek:'36-01',FarmName:'Farm A',ProdKey:1,SourceUnit:'박스',IncomingQuantity:999}
],scope);
const boxTrend=analytics.farmTrends.find(t=>t.unit==='박스');
assert.deepEqual(boxTrend.points.map(p=>[p.week,p.defectQuantity,p.incomingQuantity,p.defectRate]),[[35,10,150,10/150*100],[36,20,800,2.5],[37,0,50,0]],'farm rate uses all incoming products and keeps zero-defect inbound weeks');
const product35=analytics.issueCandidates.find(c=>c.prodKey===1&&c.week===35);
assert.equal(product35.incomingQuantity,100);assert.equal(product35.defectRate,10);assert.equal(product35.sourceKey,101);
const stem36=analytics.issueCandidates.find(c=>c.prodKey===2&&c.week===36);
assert.equal(stem36.incomingQuantity,25,'different units must never mix');assert.equal(stem36.defectRate,20);
assert.equal(analytics.issueCandidates.find(c=>c.prodKey===3).defectRate,null,'missing denominator must stay unknown, not zero percent');
const signalRows=[
 {...base,DeductionKey:201,OrderWeek:'35-01',CustKey:10,ProdKey:1,ProductName:'A품목',Quantity:1},
 {...base,DeductionKey:202,OrderWeek:'36-01',CustKey:10,ProdKey:1,ProductName:'A품목',Quantity:2},
 {...base,DeductionKey:203,OrderWeek:'36-02',CustKey:11,ProdKey:1,ProductName:'A품목',Quantity:3},
 {...base,DeductionKey:204,OrderWeek:'36-01',CustKey:12,ProdKey:2,ProductName:'B품목',Quantity:4},
 {...base,DeductionKey:205,OrderWeek:'37-01',CustKey:12,ProdKey:2,ProductName:'B품목',Quantity:5},
 {...base,DeductionKey:205,OrderWeek:'37-01',CustKey:99,ProdKey:2,ProductName:'B품목',Quantity:999},
 {...base,DeductionKey:206,OrderYear:2025,OrderWeek:'36-01',CustKey:13,ProdKey:3,ProductName:'전년도',Quantity:9}
];
const signals=qualitySignals(signalRows,scope);
assert.deepEqual(new Set(signals.map(s=>s.kind)),new Set(['SAME_ITEM_WEEK','FARM_WEEK_CLUSTER','ITEM_PERSISTENT','FARM_RECURRING']));
const repeated=signals.find(s=>s.kind==='SAME_ITEM_WEEK');
assert.equal(repeated.sourceCount,2,'headline count is distinct defect source rows, not customer count');
assert.deepEqual(repeated.breakdown.map(row=>[row.week,row.count,row.quantity]),[[36,2,5]]);
assert(!JSON.stringify(signals).includes('customerIdentity'),'customer identity must stay inside detection and never reach the API projection');
assert(signals.every(s=>s.sourceKeys.length===new Set(s.sourceKeys).size),'duplicate source keys must not inflate counts');
assert(!signals.some(s=>s.productName==='전년도'),'same major week in another year must be isolated');
const store=fs.readFileSync('lib/farmQualityStore.js','utf8');
const page=fs.readFileSync('pages/sales/farm-quality.js','utf8');
const api=fs.readFileSync('pages/api/sales/farm-quality.js','utf8');
assert.match(store,/RequestKey=@req/);assert.match(store,/PayloadHash!==hash/);
assert.match(store,/WITH\(UPDLOCK,HOLDLOCK\)/);assert.match(store,/OrderYear=@year/);
assert.match(store,/FROM dbo\.ViewWarehouse vw/);assert.match(store,/p\.OutUnit/);
assert.match(store,/kind!=='COMMENT'&&Number\(input.version\)!==current.Version/);
assert.doesNotMatch(store,/(INSERT|UPDATE|DELETE)\s+(?:dbo\.)?(?:Estimate|OrderDetail|ShipmentDetail|StockHistory|WebSalesDefectDeduction)\b/i);
assert.match(store,/d\.CustKey/,'CustKey is read only for server-side distinct-order detection');
assert.match(store,/qualitySignals\(sources\.recordset,scope\)/);
assert.match(store,/ROW_NUMBER\(\) OVER\(PARTITION BY e\.CaseKey ORDER BY e\.EventKey\) EventNo/);
assert.match(store,/FROM RankedEvents WHERE RecentRank<=3/);
assert.match(store,/RecentEvents,EventCount:Number/);
assert.match(store,/DELETE FROM dbo\.WebFarmQualityEvidence WHERE EventKey=@event/);
assert.match(store,/DELETE FROM dbo\.WebFarmQualityEvent WHERE CaseKey=@key/);
assert.match(store,/DELETE FROM dbo\.WebFarmQualityCase WHERE CaseKey=@key AND OrderYear=@year AND Version=@version/);
assert.doesNotMatch(store,/CustName|Customer/);
assert.match(page,/useState\('graph'\)/,'기존 불량 분석값이 진입 즉시 보여야 한다.');
assert.match(page,/기존 불량 분석 · 농장·품목 \{groups\.length\}개/,'분석에 반영된 농장·품목 수를 표시해야 한다.');
assert.match(page,/특정 농장 · 차수별 불량률 추이/);assert.match(page,/특정 차수 · 품목 불량 이슈 후보/);assert.match(page,/이슈로 처리/);
assert.match(page,/자동 감지 이슈/);assert.match(page,/불량 \{s\.sourceCount\}건/);assert.match(page,/<details className=/);
assert.doesNotMatch(page,/다중\s*거래처/);
assert.match(page,/Ctrl\+V/);assert.match(page,/이미지 선택/);assert.match(page,/첨부 이미지는 유지됩니다/);
assert.match(page,/코멘트 \{c\.EventCount\|\|0\}건/);
assert.match(page,/className="case-events"/);assert.match(page,/e\.EventNo/);
assert.match(page,/event-kind-REQUEST/);assert.match(page,/event-heading/);
assert.match(page,/data\.canDelete/);assert.match(page,/피드백 삭제/);
assert.match(api,/if\(!canDeleteFarmQuality\(req\.user\)\)return res\.status\(403\)/,'DELETE는 화면 표시와 별개로 서버에서도 nenovaSS3를 검증해야 한다.');
assert.match(api,/deleteQualityCase\(req\.body,req\.user\)/);
console.log('Farm quality: cross-year, source, units, status and write boundaries passed');
