const assert = require('node:assert/strict');
const fs = require('node:fs');

const migration = fs.readFileSync(
  'docs/migrations/2026-08-27_normalize_tiny_product_stock.sql',
  'utf8',
);

assert.match(migration, /CREATE OR ALTER TRIGGER dbo\.trg_Product_NormalizeTinyStock/);
assert.match(migration, /AFTER INSERT, UPDATE/);
assert.match(migration, /IF TRIGGER_NESTLEVEL\(\) > 1 OR NOT UPDATE\(Stock\)/);
assert.match(migration, /i\.Stock <> 0/);
assert.match(migration, /ABS\(i\.Stock\) < 0\.000001/);
assert.match(migration, /WHERE ProdKey = 436/);
assert.doesNotMatch(migration, /UPDATE\s+(?:dbo\.)?ProductStock/i);
assert.doesNotMatch(migration, /UPDATE\s+(?:dbo\.)?StockHistory/i);
assert.doesNotMatch(migration, /INSERT\s+INTO\s+(?:dbo\.)?StockHistory/i);
assert.doesNotMatch(migration, /DELETE\s+FROM\s+(?:dbo\.)?(?:ProductStock|StockHistory)/i);

console.log('tiny Product.Stock normalization contract passed');
