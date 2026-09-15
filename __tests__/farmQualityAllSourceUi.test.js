const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const source=fs.readFileSync(path.resolve(__dirname,'../pages/sales/farm-quality.js'),'utf8');

assert.match(source,/\[signalFilter,setSignalFilter\]=useState\('ALL'\),\[signalUnit,setSignalUnit\]=useState\('ALL'\)/,'automatic detection starts at all units independently');
assert.match(source,/자동 감지 단위 선택/,'automatic detection has its own unit control');
assert.match(source,/<option value="ALL">전체 단위<\/option>/,'automatic detection defaults to all units');
assert.match(source,/chosenSignalUnit==='ALL'\|\|s\.unit===chosenSignalUnit/,'automatic signal filtering does not reuse the trusted rate unit');

const kinds=['SAME_ITEM_WEEK','FARM_WEEK_CLUSTER','ITEM_PERSISTENT','FARM_RECURRING','UNASSIGNED_ITEM_WEEK','UNASSIGNED_ITEM_PERSISTENT'];
for(const kind of kinds)assert.match(source,new RegExp(`\\['${kind}'`),`compact kind filter includes ${kind}`);
assert.equal((source.match(/\['(?:SAME_ITEM_WEEK|FARM_WEEK_CLUSTER|ITEM_PERSISTENT|FARM_RECURRING|UNASSIGNED_ITEM_WEEK|UNASSIGNED_ITEM_PERSISTENT)'/g)||[]).length,6,'exactly six kind buttons are defined');

for(const token of ['analyzedSourceCount','confirmedSourceCount','additionalSourceCount','detectedSourceCount','noPatternSourceCount','reviewSignalCount','totalSignalCount'])assert(source.includes(`data.signalCoverage?.${token}`),`all-source coverage shows ${token}`);
assert.match(source,/감지 원본 <b>\{fmt\(data\.signalCoverage\?\.detectedSourceCount\)\}<\/b> \(중복 제거\)/,'detected sources state their unique count');
assert.match(source,/패턴 없음 <b>\{fmt\(data\.signalCoverage\?\.noPatternSourceCount\)\}/,'no-pattern source count is visible');
assert.match(source,/className="review-badge">확인 필요/,'review candidates have a visible badge');
assert.match(source,/className="review-reasons"/,'review reasons are expanded in the details');
assert.match(source,/업체 \{customer\.customerName\|\|'거래처 미상'\}/,'customer names remain visible in source evidence');
assert.match(source,/SIGNAL_ATTRIBUTION\[s\.attribution\]/,'farm, product, and customer-product attribution are distinguished');

assert.match(source,/function create\(g\)\{if\(saveLock\.current\|\|uploading\)return;if\(needsSignalReview\(g\)\)/,'create is defensively gated');
assert.match(source,/if\(existing\)\{setTab\('feedback'\);open\(existing\);return;\}if\(needsSignalReview\(candidate\)\)/,'existing issues remain openable before the review gate');
assert.match(source,/if\(draft&&needsSignalReview\(draft\)\)/,'save is defensively gated');
assert.match(source,/<Link className="source-review-link" href="\/sales\/defect-deductions">원본 확인<\/Link>/,'review candidates only navigate to the valid source route');
assert.doesNotMatch(source,/review\?<button onClick=\{\(\)=>issueAction\(s\)\}/,'review candidates cannot render a create action');

assert.match(source,/max-width:1920px/,'1920px desktop layout stays bounded');
assert.match(source,/\.signal-list\{display:grid;grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/,'1920px desktop shows dense two-column signals');
assert.match(source,/@media\(max-width:760px\)\{\.signal-controls label\{width:100%/,'760px signal controls stack');
assert.match(source,/\.signal-coverage\{display:grid;grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/,'760px coverage remains readable');

console.log('farm quality all-source signal UI static tests passed: all units, six kinds, review-only routing, 1920px and 760px layouts');
