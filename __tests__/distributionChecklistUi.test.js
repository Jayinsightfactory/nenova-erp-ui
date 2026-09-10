const assert=require('node:assert/strict');
const fs=require('node:fs');

const inbox=fs.readFileSync(require.resolve('../components/orders/DistributionSalesInbox.js'),'utf8');
const review=fs.readFileSync(require.resolve('../components/orders/DistributionChecklistReview.js'),'utf8');

assert.match(review,/CHECKLIST_STATUSES=\['PENDING','REVIEWED','NOT_NEEDED','LATER'\]/);
assert.match(review,/memo:String\(draft\.memo\|\|''\)\.slice\(0,1000\)/);
assert.match(review,/maxLength=\{1000\}/);
assert.match(review,/원문 수동 확인 목록/);
assert.match(review,/미확인 항목이 있어도 등록·분배·확정 작업은 계속할 수 있습니다/);
assert.match(review,/shortChecklistWeek/);
assert.match(review,/match\[1\]===String\(year\|\|''\)/);
assert.match(review,/fetch\(`\/api\/orders\/distribution-checklist\?/);
assert.match(review,/method:'POST'/);
assert.match(review,/sourceIdentity:identity/);
assert.match(review,/requestId:id/);
assert.doesNotMatch(review,/parse-paste|adjust-batch|handleAllMixedDistribute|\/api\/orders\/index/);
assert.doesNotMatch(review,/\bthrow\b|onError|onSaveError/);
assert.match(inbox,/DistributionChecklistReview key=\{`review:\$\{year\|\|''\}:\$\{week\|\|''\}`\}/);
assert.match(inbox,/rows\.slice\(currentReviewPage\*200,\(currentReviewPage\+1\)\*200\)/);
assert.match(inbox,/다음 검토 목록/);
assert.doesNotMatch(inbox,/method:\s*['"]POST/);
console.log('distribution checklist UI tests passed');
