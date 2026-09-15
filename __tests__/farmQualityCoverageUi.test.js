const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.join(__dirname,'..');
const page=fs.readFileSync(path.join(root,'pages/sales/farm-quality.js'),'utf8');
const coverage=fs.readFileSync(path.join(root,'components/FarmQualityCoverage.js'),'utf8');

assert.match(page,/FarmQualityCoverage coverage=\{data\.coverage\}/,'page renders server coverage independently of the graph unit');
assert.match(page,/>불량 분석</,'visible graph tab renamed');
assert.doesNotMatch(page,/>불량 그래프</,'old visible graph tab removed');
assert.match(page,/확인된 원본 기준 · 단위별 분석/,'misleading excluded aggregate removed from graph controls');
assert.match(page,/반복 패턴 후보만 자동 감지합니다/,'signals state their limited automatic scope');
assert.match(page,/업체 \{customer\.customerName\|\|'거래처 미상'\}/,'signal breakdown identifies the displayed customer name without an identifier');
assert.match(page,/flexWrap:'wrap'/,'signal customer names wrap instead of truncating');
assert.match(page,/\.signal-breakdown \.signal-customers\{grid-column:1\/-1/,'customer evidence spans the whole detail row, not the 48px week column');

for(const token of ['sourceTotal','activeTotal','inRangeCount','outOfRangeCount','invalidWeekCount','deletedCount','eligibleCount','incompleteCount','rangeStatus===\'IN_RANGE\'','rangeStatus===\'UNKNOWN_WEEK\'','rangeStatus!==\'OUT_OF_RANGE\''])assert(coverage.includes(token),`coverage contract: ${token}`);
assert.match(coverage,/setOpen\(true\)/,'out-of-range action opens the source list');
assert.match(coverage,/원본 범위를 불러오지 못했습니다/,'missing rollout coverage is surfaced, not shown as zero');
assert.match(coverage,/확인 필요/,'unknown quantity is not rendered as zero');
assert.match(coverage,/customerName,row\.farmName,row\.productName/,'local search includes customer, farm, and product');
assert.match(coverage,/parentWeek\(right\.orderWeek\)-parentWeek\(left\.orderWeek\)/,'rows sort newest parent week first');
assert.match(coverage,/max-height:380px;overflow:auto/,'dense source list scrolls');
assert.match(coverage,/position:sticky;top:0/,'source list header stays visible');
assert.match(coverage,/@media\(max-width:900px\)/,'900px responsive layout');
assert.match(coverage,/@media\(max-width:760px\)/,'760px responsive layout');
assert.doesNotMatch(coverage,/CustKey|customerKey|customerIdentity/,'customer identifiers are not rendered');

console.log('farm quality coverage UI source checks passed');
