const assert = require('node:assert/strict');
const fs = require('node:fs');

async function main() {
  const { resolveStockTargetAdjustment } = await import('../lib/stockTargetAdjustment.js');
  const api = fs.readFileSync('pages/api/stock/adjust-batch.js', 'utf8');
  const policy = fs.readFileSync('lib/stockTargetAdjustment.js', 'utf8');

  assert.deepEqual(
    resolveStockTargetAdjustment({ liveStock: -20, selectedStock: 9, targetStock: 0 }),
    { selectedBefore: 9, targetStock: 0, delta: -9, liveBefore: -20, liveAfter: -29 },
  );
  assert.deepEqual(
    resolveStockTargetAdjustment({ liveStock: 15, selectedStock: -3, targetStock: 2 }),
    { selectedBefore: -3, targetStock: 2, delta: 5, liveBefore: 15, liveAfter: 20 },
  );
  assert.match(api, /Product WITH \(UPDLOCK, HOLDLOCK\)/);
  assert.match(api, /targetStock: e\.after/);
  assert.match(api, /selectedStock: e\.expectedSelectedStock/);
  assert.match(fs.readFileSync('pages/stock.js', 'utf8'), /expectedSelectedStock: before/);
  assert.match(policy, /liveAfter: live \+ delta/);
  assert.doesNotMatch(api, /const before = Number\(beforeResult/);
  assert.doesNotMatch(api, /errors\.length \? 207/);
  assert.match(api, /const results = await withTransaction/);
  assert.match(api, /THROW 51000, @m, 1/);
  assert.match(api, /loadFixedEditedProdKeys/);
  assert.match(api, /sd\.ProdKey=e\.ProdKey AND ISNULL\(sd\.isFix,0\)=1/);
  assert.doesNotMatch(api, /SELECT TOP 1 1 AS x FROM/);
  console.log('stock target adjustment tests passed');
}

main().catch((error) => { console.error(error); process.exit(1); });
