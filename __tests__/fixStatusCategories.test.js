// node __tests__/fixStatusCategories.test.js

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
    categoriesForPreset,
    resolveCountryFlowerFilter,
    normalizeCategoryList,
  } = await import('../lib/fixStatusCategories.js');

  const available = ['카네이션', '콜롬비아장미', '에콰도르장미', '수국', '네덜란드'];

  console.log('=== categoriesForPreset ===');
  assert('카네이션만', JSON.stringify(categoriesForPreset('carnation', available)) === JSON.stringify(['카네이션']));
  assert('장미 2개', categoriesForPreset('rose', available).length === 2);
  assert('전체 → []', categoriesForPreset('all', available).length === 0);

  console.log('\n=== resolveCountryFlowerFilter ===');
  assert('선택 없음 → 전체', resolveCountryFlowerFilter([], available).length === 0);
  assert('카네이션만', JSON.stringify(resolveCountryFlowerFilter(['카네이션'], available)) === JSON.stringify(['카네이션']));
  assert('존재하지 않는 값 제외', resolveCountryFlowerFilter(['없음', '카네이션'], available).length === 1);

  console.log('\n=== normalizeCategoryList ===');
  assert('trim + dedupe', JSON.stringify(normalizeCategoryList([' 카네이션 ', '카네이션', ''])) === JSON.stringify(['카네이션']));

  if (!process.exitCode) console.log('\n=== RESULT: all passed ===');
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
