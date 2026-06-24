// node __tests__/shipmentFixGuards.test.js

const assert = (label, cond) => {
  if (!cond) {
    console.error(`  ✗ ${label}`);
    process.exitCode = 1;
  } else {
    console.log(`  ✓ ${label}`);
  }
};

async function main() {
  const {
    evaluatePartialCategoryFixBlock,
    targetMatchesCountryFlowerFilter,
  } = await import('../lib/shipmentFixGuards.js');

  const unfixed = [
    { countryFlower: '카네이션', label: '카네이션' },
    { countryFlower: '네덜란드', label: '네덜란드' },
  ];

  console.log('=== evaluatePartialCategoryFixBlock ===');
  {
    const r = evaluatePartialCategoryFixBlock(unfixed, new Set(['카네이션']));
    assert('subset blocked', r.blocked === true);
    assert('code', r.code === 'PARTIAL_CATEGORY_FIX_BLOCKED');
    assert('remaining', r.remainingCategories.includes('네덜란드'));
  }
  {
    const r = evaluatePartialCategoryFixBlock(unfixed, new Set(['카네이션', '네덜란드']));
    assert('all included ok', r.blocked === false);
  }
  {
    const r = evaluatePartialCategoryFixBlock(unfixed, null);
    assert('no filter ok', r.blocked === false);
  }
  {
    const r = evaluatePartialCategoryFixBlock([unfixed[0]], new Set(['카네이션']));
    assert('single unfixed ok', r.blocked === false);
  }

  console.log('\n=== targetMatchesCountryFlowerFilter ===');
  assert('label match', targetMatchesCountryFlowerFilter({ countryFlower: '', label: '카네이션' }, new Set(['카네이션'])));

  const { formatFixApiErrorMessage } = await import('../lib/shipmentFixGuards.js');
  assert('error msg partial', formatFixApiErrorMessage({ code: 'PARTIAL_CATEGORY_FIX_BLOCKED', remainingCategories: ['장미'] }, '25-01').includes('장미'));

  if (!process.exitCode) console.log('\n=== RESULT: all passed ===');
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
