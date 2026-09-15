import assert from 'node:assert/strict';
import {qualityScope,qualitySignals,qualitySourceCoverage} from '../lib/farmQuality.js';

const scope=qualityScope({year:2026,from:35,to:36});
const active={OrderYear:2026,OrderWeek:'35-01',ProdKey:71,ProdName:'장미',FarmName:'Farm A',SourceUnit:'박스',Quantity:2,ImportConfirmed:true,IsDeleted:false};
const sources=[
 {...active,DeductionKey:1,OrderYear:2025,CustKey:50,CustName:'전년도 재사용 키'},
 {...active,DeductionKey:'1',CustKey:10,CustName:'업체 가'},
 {...active,DeductionKey:1,CustKey:99,CustName:'중복은 무시'},
 {...active,DeductionKey:2,OrderWeek:'36-02',SourceUnit:'송이',CustKey:11,CustName:'업체 나'},
 {...active,DeductionKey:3,OrderWeek:'34-01',FarmName:'',ImportConfirmed:false,Quantity:0},
 {...active,DeductionKey:4,OrderWeek:'2026-35-01',CustName:'업체 라'},
 {...active,DeductionKey:5,ImportConfirmed:false},
 {...active,DeductionKey:6,FarmName:''},
 {...active,DeductionKey:7,ProdKey:null},
 {...active,DeductionKey:8,OrderWeek:'36-01',Quantity:9,OriginalQuantity:0,CustName:''},
 {...active,DeductionKey:9,IsDeleted:true},
 {...active,DeductionKey:11,OrderWeek:'36-01',Quantity:9,OriginalQuantity:NaN,CustName:'업체 마'},
 {...active,DeductionKey:10,OrderYear:2025,CustName:'전년도 업체'},
];
const before=JSON.stringify(sources);
const coverage=qualitySourceCoverage(sources,scope);
assert.equal(JSON.stringify(sources),before,'coverage is a read-only projection of source rows');
assert.equal(coverage.sourceTotal,10,'selected-year source total is deduplicated once per DeductionKey after the year filter');
assert.equal(coverage.activeTotal,9);
assert.equal(coverage.deletedCount,1);
assert.equal(coverage.sourceTotal,coverage.activeTotal+coverage.deletedCount,'source conservation keeps deleted rows separate');
assert.equal(coverage.inRangeCount,7);
assert.equal(coverage.outOfRangeCount,1);
assert.equal(coverage.invalidWeekCount,1);
assert.equal(coverage.activeTotal,coverage.inRangeCount+coverage.outOfRangeCount+coverage.invalidWeekCount,'every active source has exactly one range status');
assert.equal(coverage.total,8,'total is the default UI view: in-range plus unknown-week rows');
assert.equal(coverage.defaultViewCount,coverage.total);
assert.equal(coverage.eligibleCount,2);
assert.equal(coverage.incompleteCount,6,'incomplete counts only in-range and unknown-week active rows');
assert.equal(coverage.outOfYearCount,2);
assert.equal(coverage.duplicateCount,1);
assert.equal(coverage.rows.length,coverage.activeTotal,'all and only selected-year active rows remain expandable');
assert(!coverage.rows.some(row=>row.sourceKey===9),'deleted sources are counted separately, never returned as active coverage rows');
assert(!coverage.rows.some(row=>row.sourceKey===10),'other-year sources are explicitly excluded from the selected-year rows');
assert.equal(coverage.rows.find(row=>row.sourceKey===1)?.customerName,'업체 가','a prior-year reused source key cannot hide the selected-year numeric/string key');
for(const pair of [[2025,2026],[2026,2025]]){
 const reused=qualitySourceCoverage(pair.map(OrderYear=>({...active,DeductionKey:801,OrderYear})),scope);
 assert.equal(reused.activeTotal,1,'selected year survives either ordering of reused keys');
 assert.equal(reused.outOfYearCount,1);
 assert.equal(reused.duplicateCount,0,'other-year keys are not selected-year duplicates');
}
assert.deepEqual(coverage.rows.filter(row=>[1,2].includes(row.sourceKey)).map(row=>row.unit),['박스','송이'],'coverage preserves exact source units without mixing rows');

const outside=coverage.rows.find(row=>row.sourceKey===3);
assert.deepEqual({rangeStatus:outside.rangeStatus,eligible:outside.eligible,reasons:outside.reasons},{rangeStatus:'OUT_OF_RANGE',eligible:false,reasons:['선택 기간 밖']},'out-of-range rows stay expandable without unrelated eligibility reasons');
const unknownWeek=coverage.rows.find(row=>row.sourceKey===4);
assert.equal(unknownWeek.rangeStatus,'UNKNOWN_WEEK');
assert.equal(unknownWeek.eligible,false,'invalid weeks never become eligible');
assert(unknownWeek.reasons.includes('차수 형식 확인 필요'));
const zeroQuantity=coverage.rows.find(row=>row.sourceKey===8);
assert.equal(zeroQuantity.customerName,'업체 미지정','empty stored display names use the safe snapshot fallback');
assert.equal(zeroQuantity.quantity,0,'zero remains a displayed source value');
assert(zeroQuantity.reasons.includes('수량이 0 이하이거나 확인 필요'));
const invalidQuantity=coverage.rows.find(row=>row.sourceKey===11);
assert.equal(invalidQuantity.quantity,null,'a non-finite original quantity is visible as unknown rather than falling back to Qty');
assert(invalidQuantity.reasons.includes('수량이 0 이하이거나 확인 필요'));
assert(!JSON.stringify(coverage).includes('CustKey'),'coverage does not leak customer identifiers');
assert(!JSON.stringify(coverage).includes('customerIdentity'),'coverage has no detection-only customer identity');

const signals=qualitySignals([
 {...active,DeductionKey:101,CustKey:1,CustName:'업체 가',Quantity:1},
 {...active,DeductionKey:102,CustKey:2,CustName:'업체 나',Quantity:2},
 {...active,DeductionKey:103,CustKey:1,CustName:'업체 가',Quantity:3},
],qualityScope({year:2026,from:35,to:35}));
const repeated=signals.find(signal=>signal.kind==='SAME_ITEM_WEEK');
assert.deepEqual(repeated.breakdown[0].customers,[
 {customerName:'업체 가',count:2,quantity:4,unit:'박스'},
 {customerName:'업체 나',count:1,quantity:2,unit:'박스'},
],'customer expansion counts source rows, not distinct customers');
assert(!JSON.stringify(repeated).includes('CustKey'));
assert(!JSON.stringify(repeated).includes('customerIdentity'));
console.log('Farm quality coverage: active-source conservation, range states, reasons and display-name privacy passed');
