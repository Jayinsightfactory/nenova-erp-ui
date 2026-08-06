import assert from 'node:assert/strict';

const { buildPivotProductSearchAliases, pivotProductOptionMatches } = await import('../lib/pivotProductSearch.js');

const aliases = buildPivotProductSearchAliases([
  { country: '콜롬비아', flower: '수국', prodName: 'White' },
  { country: '콜롬비아', flower: '카네이션', prodName: 'Moon Light' },
]);

assert.equal(pivotProductOptionMatches('White', '수국화이트', aliases), true);
assert.equal(pivotProductOptionMatches('White', 'Hydrangea White', aliases), true);
assert.equal(pivotProductOptionMatches('Moon Light', '문라이트', aliases), true);
assert.equal(pivotProductOptionMatches('White', '장미화이트', aliases), false);

console.log('pivot product alias search tests passed');
