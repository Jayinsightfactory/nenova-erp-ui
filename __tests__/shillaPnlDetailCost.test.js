const assert = require('node:assert/strict');

async function main() {
  const {
    withShillaDetailCostBaseline,
    applyShillaDetailCostDraft,
    buildShillaDetailCostUpdates,
  } = await import('../lib/shillaPnlDetailCost.js');

  const source = [
    { itemKey: 11, name: '호접 · 화이트', prodKey: 3074, unit: '8스팀', costPrice: 11233, isCustom: false },
    { itemKey: 12, name: '호접 · 화이트', prodKey: 3074, unit: '8스팀', costPrice: 11233, isCustom: false },
    { itemKey: 13, name: '태국 샘플', prodKey: null, unit: '단', costPrice: 0, isCustom: true },
  ];
  const based = withShillaDetailCostBaseline(source);
  assert.equal(buildShillaDetailCostUpdates(based, { pnlKey: 77, major: 36 }).length, 0);

  const edited = applyShillaDetailCostDraft(based, 0, '10,500');
  assert.equal(edited[0].costPrice, '10,500');
  assert.equal(edited[1].costPrice, '10,500', 'same saved product/unit identity follows the one visible edit');
  assert.equal(edited[2].costPrice, 0, 'another identity and explicit zero are preserved');
  const updates = buildShillaDetailCostUpdates(edited, { pnlKey: 77, major: 36 });
  assert.equal(updates.length, 1);
  assert.equal(updates[0].costPrice, 10500);
  assert.deepEqual(updates[0].expected, [
    { itemKey: 11, costPrice: 11233 },
    { itemKey: 12, costPrice: 11233 },
  ]);

  const cleared = applyShillaDetailCostDraft(based, 2, '');
  const clearUpdates = buildShillaDetailCostUpdates(cleared, { pnlKey: 77, major: 36 });
  assert.equal(clearUpdates[0].costPrice, null, 'empty explicitly clears only that identity');
  assert.deepEqual(clearUpdates[0].expected, [{ itemKey: 13, costPrice: 0 }], 'zero baseline is not treated as missing');

  assert.throws(() => buildShillaDetailCostUpdates(applyShillaDetailCostDraft(based, 0, '-1'), { pnlKey: 77, major: 36 }), /0 이상의 숫자/);
  assert.throws(() => buildShillaDetailCostUpdates(edited, { pnlKey: 0, major: 36 }), /저장된 신라 결산/);
  console.log('Shilla detail purchase-cost edit policy tests passed');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
