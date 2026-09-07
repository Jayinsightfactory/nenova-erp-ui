const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

const pnl = read('pages/raum/pnl.js');
const costs = read('pages/raum/purchase-costs.js');
const shillaCosts = read('components/raum/ShillaPurchaseCosts.js');
const shillaMatchModal = read('components/raum/ShillaProductMatchModal.js');
const combinedCell = read('components/raum/CombinedPurchaseCostCell.js');
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
assert.match(pnl, /ShillaProductMatchModal/, 'saved Shilla detail uses the dedicated row-mapping modal');
assert.match(pnl, /shillaDetailSaved/, 'only a saved Shilla detail exposes row mapping');
assert.match(pnl, /<VerifyPanel verification=\{detail\.verification\} items=\{detail\.items\} isShilla=\{isShilla\}/, 'Shilla verification explicitly suppresses ERP cross-check display');
assert.match(pnl, /shillaMatching/, 'partner/year/detail changes are frozen while a Shilla mapping save is active');
assert.match(pnl, /return true;[\s\S]*return false;/, 'list/detail loaders expose guarded refresh success without changing their request guards');
assert.match(pnl, /품목 연결은 저장됐지만 화면을 다시 불러오지 못했습니다. 다시 조회해 주세요/, 'a post-save reload failure never falsely claims the mapping view refreshed');

assert.match(shillaMatchModal, /\/api\/raum\/item-mapping\?q=/, 'Shilla mapping reuses only the existing product-search GET');
assert.match(shillaMatchModal, /Array\.isArray\(result\.products\)/, 'Shilla product search follows the existing products response contract');
assert.match(shillaMatchModal, /fetchRaumPnlJson\('\/api\/raum\/shilla-item-mapping'/, 'Shilla mapping uses its dedicated save API with safe response reading');
assert.match(shillaMatchModal, /shillaPnlProductMatchSnapshot\(item\)/, 'Shilla mapping sends the complete source-row snapshot');
assert.match(shillaMatchModal, /product\.DisplayName, product\.FlowerName, product\.CounName, product\.OutUnit/, 'search candidates show disambiguating product fields without changing the source unit');
assert.doesNotMatch(shillaMatchModal, /fetch\('\/api\/raum\/item-mapping', \{[\s\S]*method: 'POST'/, 'Shilla mapping must never save through global item mapping');

assert.match(costs, /buildRaumPnlCombinedPurchaseCostMatrix\(sharedRows, shillaRows, \{ orderYear \}\)/, 'cost screen co-locates shared and Shilla data through the combined matrix');
assert.match(costs, /\/api\/raum\/purchase-costs\?year=/, 'shared costs keep their existing GET');
assert.match(costs, /\/api\/raum\/shilla-purchase-costs\?year=/, 'Shilla costs use an independent GET');
assert.match(costs, /fetch\('\/api\/raum\/purchase-costs'/, 'shared costs keep their existing POST');
assert.match(costs, /fetch\('\/api\/raum\/shilla-purchase-costs'/, 'Shilla costs use an independent POST');
assert.match(costs, /pnlKey: cell\.pnlKey, major: cell\.major, identity: cell\.identity, expected: cell\.snapshot/, 'Shilla saves the single-partner concurrency snapshot');
assert.match(costs, /matrixConflicts/, 'ambiguous duplicate Shilla weeks are visible and excluded from edits');
assert.match(costs, /setSharedRows\(\[\]\)/, 'a failed shared reload clears only stale shared rows');
assert.match(costs, /setShillaRows\(\[\]\)/, 'a failed Shilla reload clears only stale Shilla rows');
assert.match(costs, /신라 원본: \{item\.shillaName\}/, 'a differing Shilla source name stays visible beside the shared name');
assert.doesNotMatch(costs, /<ShillaPurchaseCosts/, 'Shilla is no longer rendered as a separate bottom area');
assert.match(shillaCosts, /수량 .*판매가/, 'compact Shilla cells show quantity and sale price');
assert.match(shillaCosts, /매입액 .*매출액/, 'compact Shilla cells show purchase and sale amount');
assert.match(shillaCosts, /저장 원본 단가 \{storedValues\}/, 'multiple original Shilla costs remain visible without averaging');
assert.doesNotMatch(shillaCosts, /fetch\(|buildRaumPnl/, 'the Shilla cell is presentational and cannot issue shared or Shilla requests');
assert.match(combinedCell, /라움·초이문 공통/, 'same product-week cell displays the shared side');
assert.match(combinedCell, /ShillaPurchaseCostInput/, 'same product-week cell displays the independent Shilla side');
assert.match(layout, /라움 초이문 손익계산서 · 신라호텔/);

console.log('Shilla weekly P&L UI tests passed');
