const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

async function main() {
  const {
    stripConsignedSuffix,
    raumPnlConsignedMatchKey,
    fillConsignedCostsFromOrdinary,
  } = await import('../lib/raumPnlConsignedCost.js');
  const { raumPnlCostIdentity, buildRaumPnlSharedPurchaseCostMatrix } = await import('../lib/raumPnlCostComparison.js');

  // ---------------------------------------------------------------------
  // stripConsignedSuffix — trailing "(사입)"/"사입" only, never a leading/embedded one.
  // ---------------------------------------------------------------------
  assert.equal(stripConsignedSuffix('카네이션 옐로우(사입)'), '카네이션 옐로우');
  assert.equal(stripConsignedSuffix('카네이션 옐로우 (사입)'), '카네이션 옐로우');
  assert.equal(stripConsignedSuffix('카네이션 옐로우（사입）'), '카네이션 옐로우', 'full-width parens must also strip');
  assert.equal(stripConsignedSuffix('카네이션 옐로우 사입'), '카네이션 옐로우');
  assert.equal(stripConsignedSuffix('  카네이션   옐로우   (사입)  '), '카네이션 옐로우', 'whitespace is normalized around the suffix');
  assert.equal(stripConsignedSuffix('카네이션 옐로우'), '카네이션 옐로우', 'names without the suffix are untouched');
  assert.equal(stripConsignedSuffix('사입카네이션'), '사입카네이션', 'a leading 사입 must not be stripped');
  assert.equal(stripConsignedSuffix('카네이션(사입) 특수'), '카네이션(사입) 특수', 'an embedded (not trailing) marker must not be stripped');
  assert.equal(stripConsignedSuffix(''), '');
  assert.equal(stripConsignedSuffix(null), '');

  // ---------------------------------------------------------------------
  // raumPnlConsignedMatchKey — name(suffix stripped)+unit only; ProdKey/IsCustom excluded.
  // ---------------------------------------------------------------------
  assert.equal(
    raumPnlConsignedMatchKey({ name: '카네이션 옐로우(사입)', unit: '단' }),
    raumPnlConsignedMatchKey({ name: '카네이션 옐로우', unit: '단' }),
    'suffix-stripped ordinary/consigned names must share one matching key'
  );
  assert.notEqual(
    raumPnlConsignedMatchKey({ name: '카네이션 옐로우', unit: '단' }),
    raumPnlConsignedMatchKey({ name: '카네이션 옐로우', unit: '박스' }),
    'unit must be part of the matching key'
  );
  assert.notEqual(
    raumPnlConsignedMatchKey({ name: '카네이션 옐로우', unit: '단' }),
    raumPnlConsignedMatchKey({ name: '카네이션 화이트', unit: '단' }),
    'different base names must not match'
  );
  assert.equal(raumPnlConsignedMatchKey({ name: '', unit: '단' }), null, 'a blank name has no matching key');

  // ---------------------------------------------------------------------
  // fillConsignedCostsFromOrdinary — the core linking rule.
  // ---------------------------------------------------------------------

  // (a) unique candidate fills a blank consigned row, by suffix-stripped name+unit.
  {
    const items = [
      { name: '카네이션 옐로우', unit: '단', qty: 10, price: 900, costPrice: 500, consigned: false, isCustom: false },
      { name: '카네이션 옐로우(사입)', unit: '단', qty: 3, price: 950, costPrice: null, consigned: true, isCustom: false },
    ];
    const before = JSON.parse(JSON.stringify(items));
    const filled = fillConsignedCostsFromOrdinary(items);
    assert.equal(filled[1].costPrice, 500, 'unique ordinary candidate fills the blank consigned cost');
    assert.equal(filled[1].costSource, 'linked');
    assert.equal(filled[0].costPrice, 500, 'ordinary row itself is untouched');
    assert.equal(filled[1].qty, 3, 'quantity is never merged/changed');
    assert.equal(filled[1].price, 950, 'sale price is never merged/changed');
    assert.equal(filled[0].qty, 10, 'ordinary quantity untouched');
    assert.deepEqual(items, before, 'input array must not be mutated');
  }

  // (b) conflicting candidates -> never averaged/guessed, stays blank.
  {
    const items = [
      { name: '수국 화이트', unit: '단', costPrice: 300, consigned: false, isCustom: false },
      { name: '수국 화이트', unit: '단', costPrice: 500, consigned: false, isCustom: false },
      { name: '수국 화이트(사입)', unit: '단', costPrice: null, consigned: true, isCustom: false },
    ];
    const filled = fillConsignedCostsFromOrdinary(items);
    assert.equal(filled[2].costPrice, null, 'multiple differing candidates must not be filled in');
    assert.equal(filled[2].costSource, undefined);
  }

  // (c) existing direct-input cost on the consigned row is always preserved.
  {
    const items = [
      { name: '장미 A', unit: '단', costPrice: 400, consigned: false, isCustom: false },
      { name: '장미 A(사입)', unit: '단', costPrice: 999, costSource: 'manual', consigned: true, isCustom: false },
    ];
    const filled = fillConsignedCostsFromOrdinary(items);
    assert.equal(filled[1].costPrice, 999, 'a manually entered consigned cost must never be overwritten');
    assert.equal(filled[1].costSource, 'manual');
    assert.equal(filled[1], items[1], 'unchanged row keeps the same object reference');
  }

  // (d) custom rows never participate — neither as a candidate source nor as a fill target.
  {
    const items = [
      { name: '손실', unit: '', costPrice: 111, consigned: false, isCustom: true },
      { name: '손실(사입)', unit: '', costPrice: null, consigned: true, isCustom: true },
    ];
    const filled = fillConsignedCostsFromOrdinary(items);
    assert.equal(filled[1].costPrice, null, 'a custom consigned-like row must never be auto-filled');
    assert.equal(filled, items, 'no candidate exists, so nothing changes and the same array is returned');
  }

  // (e) unit isolation — same base name, different unit must not link.
  {
    const items = [
      { name: '카네이션', unit: '박스', costPrice: 700, consigned: false, isCustom: false },
      { name: '카네이션(사입)', unit: '단', costPrice: null, consigned: true, isCustom: false },
    ];
    const filled = fillConsignedCostsFromOrdinary(items);
    assert.equal(filled[1].costPrice, null, 'a different unit must not be treated as a matching candidate');
  }

  // (f) suffix-form variety all resolve to the same identity.
  {
    for (const suffix of ['(사입)', ' (사입)', '（사입）', ' 사입']) {
      const items = [
        { name: '루스커스', unit: '단', costPrice: 250, consigned: false, isCustom: false },
        { name: `루스커스${suffix}`, unit: '단', costPrice: null, consigned: true, isCustom: false },
      ];
      const filled = fillConsignedCostsFromOrdinary(items);
      assert.equal(filled[1].costPrice, 250, `suffix form "${suffix}" must still link to the ordinary cost`);
    }
  }

  // (g) idempotent / stable reference — nothing to fill means the identical array comes back.
  {
    const items = [
      { name: '장미 A', unit: '단', costPrice: 400, consigned: false, isCustom: false },
      { name: '장미 A(사입)', unit: '단', costPrice: 400, consigned: true, isCustom: false },
    ];
    assert.equal(fillConsignedCostsFromOrdinary(items), items, 'no blank consigned rows -> same array reference');
    assert.deepEqual(fillConsignedCostsFromOrdinary([]), [], 'an empty item list is handled without error');
    assert.deepEqual(fillConsignedCostsFromOrdinary(undefined), [], 'a non-array input fails closed to an empty list');
  }

  // (h) a linked value follows a later ordinary edit; manual values were already proven preserved above.
  {
    let items = [
      { name: '장미 A', unit: '단', costPrice: 500, consigned: false, isCustom: false },
      { name: '장미 A(사입)', unit: '단', costPrice: null, consigned: true, isCustom: false },
    ];
    items = fillConsignedCostsFromOrdinary(items);
    assert.equal(items[1].costPrice, 500);
    items = [{ ...items[0], costPrice: 600 }, items[1]];
    const refilled = fillConsignedCostsFromOrdinary(items);
    assert.equal(refilled[1].costPrice, 600, 'an auto-linked consigned row follows the unique ordinary cost after an edit');
    assert.equal(refilled[1].costSource, 'linked');
  }

  // ---------------------------------------------------------------------
  // raumPnlCostIdentity — ProdKey rows unaffected; name-fallback rows share suffix-stripped identity.
  // ---------------------------------------------------------------------
  assert.equal(
    raumPnlCostIdentity({ prodKey: 10, unit: '단', name: '카네이션(사입)' }),
    raumPnlCostIdentity({ prodKey: 10, unit: '단', name: '카네이션' }),
    'ProdKey identity must stay untouched by any name suffix'
  );
  assert.equal(
    raumPnlCostIdentity({ prodKey: null, unit: '단', name: '카네이션 옐로우(사입)' }),
    raumPnlCostIdentity({ prodKey: null, unit: '단', name: '카네이션 옐로우' }),
    'ProdKey-less rows must share identity once the (사입) suffix is stripped'
  );
  assert.notEqual(
    raumPnlCostIdentity({ prodKey: null, unit: '단', name: '카네이션 옐로우', isCustom: true }),
    raumPnlCostIdentity({ prodKey: null, unit: '단', name: '카네이션 옐로우', isCustom: false }),
    'custom vs ordinary must remain separate identities'
  );

  // ---------------------------------------------------------------------
  // Shared purchase-cost matrix: ProdKey-less ordinary + consigned rows show as ONE row.
  // ---------------------------------------------------------------------
  const rows = [
    { orderYear: '2026', major: '12', partnerCode: 'raum', pnlKey: 1, itemKey: 1, name: '카네이션 옐로우', prodKey: null, unit: '단', qty: 5, costPrice: 300, isCustom: false },
    { orderYear: '2026', major: '12', partnerCode: 'raum', pnlKey: 1, itemKey: 2, name: '카네이션 옐로우(사입)', prodKey: null, unit: '단', qty: 2, costPrice: null, isCustom: false },
    // same base name/unit but a different year must stay isolated
    { orderYear: '2025', major: '12', partnerCode: 'raum', pnlKey: 2, itemKey: 3, name: '카네이션 옐로우', prodKey: null, unit: '단', qty: 9, costPrice: 999, isCustom: false },
  ];
  const matrix2026 = buildRaumPnlSharedPurchaseCostMatrix(rows, { orderYear: '2026' });
  const matchingItems = matrix2026.items.filter(item => item.name.startsWith('카네이션 옐로우'));
  assert.equal(matchingItems.length, 1, 'ordinary row and its (사입) counterpart must appear as one combined matrix row');
  assert.equal(matchingItems[0].cells[0].rowCount, 2, 'both underlying rows are counted in the cell');

  const matrix2025 = buildRaumPnlSharedPurchaseCostMatrix(rows, { orderYear: '2025' });
  assert.equal(matrix2025.items.length, 1, '2025 must only see its own row');
  assert.equal(matrix2025.items[0].cells[0].values[0], 999, '2025/2026 identical suffix-stripped identities must not leak across years');

  // ---------------------------------------------------------------------
  // Wiring: server save guarantees the same fill right before every write path,
  // and the pure helper module itself never touches the database.
  // ---------------------------------------------------------------------
  const helperSource = read('lib/raumPnlConsignedCost.js');
  assert.doesNotMatch(helperSource, /\b(?:INSERT\s+INTO|UPDATE\s+\w|DELETE\s+FROM|MERGE\s+\w)\b/i, 'the consigned-cost helper must stay a pure, DB-free module');
  assert.doesNotMatch(helperSource, /^import\b/m, 'the helper must have zero imports — no DB, no framework');

  const raumPnlSource = read('lib/raumPnl.js');
  assert.match(raumPnlSource, /import \{ fillConsignedCostsFromOrdinary \} from '\.\/raumPnlConsignedCost'/);
  assert.match(raumPnlSource, /fillConsignedCostsFromOrdinary\(items \|\| \[\]\)/, 'single-week save must re-apply the fill right before the insert loop');
  assert.match(raumPnlSource, /fillConsignedCostsFromOrdinary\(combined\)/, 'multi-week import merge must apply the same fill before preview/save fingerprinting');

  const pnlPageSource = read('pages/raum/pnl.js');
  assert.match(pnlPageSource, /import \{ fillConsignedCostsFromOrdinary \} from '\.\.\/\.\.\/lib\/raumPnlConsignedCost'/);
  assert.match(pnlPageSource, /fillConsignedCostsFromOrdinary\(detail\.items\)/, 'live editing must immediately reflect blank-consigned linking');
  // Ordinary and consigned rows still render as fully separate rows — never merged/deduped.
  assert.match(pnlPageSource, /detail\.items\.map\(\(it, i\) => \{/, 'every stored row (ordinary or consigned) still renders as its own line');

  const purchasePageSource = read('pages/raum/purchase-costs.js');
  assert.match(purchasePageSource, /item\.cells\.filter\(Boolean\)/, 'the product-centric screen must omit absent week cells rather than render blank filler columns');
  assert.doesNotMatch(purchasePageSource, /matrix\.weeks\.map\(week => <th/, 'the screen must not restore a global fixed week-column header');

  const comparisonSource = read('lib/raumPnlCostComparison.js');
  assert.match(comparisonSource, /stripConsignedSuffix/, 'shared matrix identity must use the same suffix-stripping helper');

  // ---------------------------------------------------------------------
  // Write allowlist unchanged by this feature — still WebRaumPnlItem.CostPrice/CostSource
  // and WebRaumPnl.UpdatedBy/UpdatedAt only.
  // ---------------------------------------------------------------------
  const contract = JSON.parse(read('docs/contracts/raum-pnl-settlement.json'));
  const action = contract.actions.find(item => item.name === 'RAUM_PNL_PURCHASE_COST_EDIT');
  assert.deepEqual(action.writeAllowlist, ['WebRaumPnlItem.CostPrice', 'WebRaumPnlItem.CostSource', 'WebRaumPnl.UpdatedBy', 'WebRaumPnl.UpdatedAt']);
  assert.ok(contract.scope.includes('lib/raumPnlConsignedCost.js'), 'the new pure helper must be declared in the contract scope');
  assert.ok(contract.requiredTestFiles.includes('__tests__/raumPnlConsignedCost.test.js'));
  assert.ok(contract.consignedCostLinking, 'contract must document the ordinary/consigned cost-linking rule');

  console.log('Raum/Choimun consigned-cost linking tests passed');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
