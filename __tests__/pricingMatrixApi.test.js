const assert = require('node:assert/strict');

async function main() {
  const { normalizePricingChanges } = await import('../lib/pricingMatrix.js');

  assert.deepEqual(normalizePricingChanges([
    { custKey: '12', prodKey: 34, cost: '0' },
  ]), [{ ck: 12, pk: 34, cost: 0 }], '명시적 0원은 유효한 단가로 보존해야 한다.');

  for (const cost of [null, undefined, '', '   ', 'abc', -1, Infinity]) {
    assert.throws(() => normalizePricingChanges([{ custKey: 1, prodKey: 2, cost }]),
      /단가는/, `잘못된 단가 ${String(cost)}를 거부해야 한다.`);
  }
  assert.throws(() => normalizePricingChanges([
    { custKey: 1, prodKey: 2, cost: 100 },
    { custKey: 1, prodKey: 2, cost: 200 },
  ]), /중복/, '동일 업체·품목 중복 입력은 조용히 버리면 안 된다.');

  const source = require('node:fs').readFileSync('pages/api/master/pricing-matrix.js', 'utf8');
  assert.match(source, /await withTransaction\(async \(tQ\)/, '전체 단가 일괄 저장은 하나의 트랜잭션이어야 한다.');
  assert.match(source, /MERGE CustomerProdCost WITH \(HOLDLOCK\)/, '동시 단가 저장은 MERGE HOLDLOCK을 사용해야 한다.');
  assert.match(source, /const valid = normalizePricingChanges\(req\.body\?\.changes\)/, '저장 전에 엄격한 입력 검증을 실행해야 한다.');
  assert.doesNotMatch(source, /parseFloat\(ch\.cost\)\s*\|\|\s*0/, '빈/잘못된 단가를 0으로 묵시 변환하면 안 된다.');
  console.log('pricing matrix API tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
