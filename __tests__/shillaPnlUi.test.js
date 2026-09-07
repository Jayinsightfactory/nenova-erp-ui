const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

const pnl = read('pages/raum/pnl.js');
const costs = read('pages/raum/purchase-costs.js');
const shillaCosts = read('components/raum/ShillaPurchaseCosts.js');
const layout = read('components/Layout.js');

assert.match(pnl, /const \[importYear, setImportYear\]/, 'Shilla import needs an explicit browser year state');
assert.match(pnl, /aria-label="신라 결산 연도"/, 'Shilla year input must be visible');
assert.match(pnl, /fd\.append\('orderYear', importYear\)/, 'preview must send the explicit year');
assert.match(pnl, /fd\.append\('selectedMajors', JSON\.stringify\(selectedMajors\)\)/, 'save must send selected original weeks');
assert.match(pnl, /if \(!isShilla && canAutoCommitRaumPnlImport/, 'Shilla must never auto-save');
assert.match(pnl, /if \(isShilla \|\| batches\.length > 1\)/, 'a single Shilla sheet still uses bulk preview');
assert.match(pnl, /const selectedMajors = batches[\s\S]*\.filter\(batch => \(batch\.verification \|\| \[\]\)\.every\(check => check\?\.ok\)\)/, 'passing Shilla weeks are selected explicitly');
assert.match(pnl, /검증 실패 차수는 저장할 수 없습니다/, 'failed weeks are blocked client-side');
assert.match(pnl, /원본 \$\{check\.sourceRow\}행/, 'failed checks display their source row');
assert.match(pnl, /!isShilla \? <ErpSyncModal/, 'Shilla hides ERP sync');
assert.match(pnl, /!isShilla \? <MatchEditorModal/, 'Shilla hides fuzzy mapping');
assert.match(pnl, /!isShilla && hasRef/, 'Shilla hides reference-price autofill');
assert.match(pnl, /readOnly=\{isShilla\}/, 'source profit split is read-only for Shilla');
assert.match(pnl, /!isShilla \? <button style=\{st\.btnPrimary\} disabled=\{saving\} onClick=\{save\}/, 'Shilla hides the general optimistic-lock-free detail save');
assert.match(pnl, /신라 원가 수정은 차수별 매입단가 관리에서만 저장됩니다/, 'Shilla directs cost changes to the snapshot endpoint');
assert.match(pnl, /원본 행·단가·수량·매출·이익을 보존/, 'Shilla detail describes preserved source values');

assert.match(costs, /ShillaPurchaseCosts/, 'common cost screen includes a separate Shilla area');
assert.match(shillaCosts, /buildRaumPnlPurchaseCostMatrix\(rows, \{ orderYear, partnerCode: 'shilla' \}\)/, 'Shilla matrix is scoped to Shilla only');
assert.match(shillaCosts, /\/api\/raum\/shilla-purchase-costs\?year=/, 'Shilla cost area has its own GET');
assert.match(shillaCosts, /fetch\('\/api\/raum\/shilla-purchase-costs'/, 'Shilla cost area has its own POST');
assert.match(shillaCosts, /pnlKey: cell\.pnlKey, major: cell\.major, identity: cell\.identity, expected: cell\.snapshot/, 'Shilla saves the single-partner concurrency snapshot');
assert.match(shillaCosts, /수량 .*판매가/, 'compact Shilla cells show quantity and sale price');
assert.match(shillaCosts, /매입액 .*매출액/, 'compact Shilla cells show purchase and sale amount');
assert.doesNotMatch(shillaCosts, /buildRaumPnlSharedPurchaseCostMatrix|\/api\/raum\/purchase-costs/, 'Shilla area must not use the cross-partner shared matrix or endpoint');
assert.match(layout, /라움 초이문 손익계산서 · 신라호텔/);

console.log('Shilla weekly P&L UI tests passed');
