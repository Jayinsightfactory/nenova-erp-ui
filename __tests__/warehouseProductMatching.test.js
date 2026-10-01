const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

async function main() {
  const {
    WAREHOUSE_PRODUCT_NAME_SQL,
    WAREHOUSE_STAGE_GUARD_SQL,
    warehouseCatalogSql,
    validateWarehouseUploadInput,
    buildWarehouseMatchResult,
    resolveWarehouseProducts,
    warehouseExpectedQuantity,
    warehouseFixedCategories,
    warehouseDuplicateUploads,
  } = await import('../lib/warehouseProductMatching.js');

  const product = {
    ProdKey: 101, ProdName: 'Rose Red', CountryFlower: 'Kenya',
    OutUnit: '단', EstUnit: '송이', NameCount: 1,
  };
  const originalItems = [
    { sourceRow: 12, prodName: 'rose red', boxQty: 2, bunchQty: 10, steamQty: 100, unitPrice: 1.25 },
  ];
  const exact = buildWarehouseMatchResult(originalItems, [{ RowIndex: 0, ...product }]);
  assert.equal(exact.valid, true);
  assert.deepEqual(exact.rows[0], {
    index: 0, sourceRow: 12, originalName: 'rose red', prodKey: 101, prodName: 'Rose Red',
    countryFlower: 'Kenya', outUnit: '단', estUnit: '송이', status: 'exact', error: '',
  });
  assert.equal(exact.items[0].originalName, 'rose red');
  assert.equal(exact.items[0].prodName, 'Rose Red');
  assert.equal(exact.items[0].boxQty, 2);
  assert.equal(exact.items[0].bunchQty, 10);
  assert.equal(exact.items[0].steamQty, 100);
  assert.equal(exact.items[0].unitPrice, 1.25);

  const manual = buildWarehouseMatchResult(
    [{ ...originalItems[0], selectedProdKey: 101 }], [{ RowIndex: 0, ...product }],
  );
  assert.equal(manual.rows[0].status, 'manual');
  assert.equal(manual.items[0].prodKey, 101);
  assert.equal(manual.items[0].originalName, 'rose red');

  const missing = buildWarehouseMatchResult(originalItems, []);
  assert.equal(missing.valid, false);
  assert.equal(missing.rows[0].status, 'error');
  assert.match(missing.rows[0].error, /정확히 일치/);
  assert.deepEqual(missing.items, []);
  const deletedSelected = buildWarehouseMatchResult(
    [{ ...originalItems[0], selectedProdKey: 777 }], [],
  );
  assert.match(deletedSelected.rows[0].error, /삭제되었거나 존재하지 않습니다/);

  for (const matches of [
    [{ RowIndex: 0, ...product }, { RowIndex: 0, ...product, ProdKey: 102 }],
    [{ RowIndex: 0, ...product, NameCount: 2 }],
  ]) {
    const duplicate = buildWarehouseMatchResult(
      [{ ...originalItems[0], selectedProdKey: 101 }], matches,
    );
    assert.equal(duplicate.valid, false, 'manual key cannot bypass duplicate active names');
    assert.match(duplicate.rows[0].error, /품목명이 중복/);
    assert.deepEqual(duplicate.items, []);
  }

  let staleKeyParams;
  const staleKey = await resolveWarehouseProducts(async (_query, params) => {
    staleKeyParams = JSON.parse(params.rows.value);
    return { recordset: [] };
  }, { NVarChar: (size) => ({ type: 'nvarchar', size }), MAX: 'MAX' },
  [{ ...originalItems[0], selectedProdKey: 999 }]);
  assert.equal(staleKeyParams[0].key, 999);
  assert.equal(staleKey.valid, false, 'a stale selected key absent from active catalog must fail revalidation');
  assert.match(staleKey.rows[0].error, /삭제되었거나 존재하지 않습니다/);
  const mixed = buildWarehouseMatchResult(
    [originalItems[0], { sourceRow: 13, prodName: 'Unknown flower', boxQty: 4 }],
    [{ RowIndex: 0, ...product }],
  );
  assert.equal(mixed.valid, false);
  assert.equal(mixed.errors.length, 1);
  assert.equal(mixed.errors[0].row, 13);
  assert.deepEqual(mixed.items, [], 'one invalid row makes the whole upload ineligible');

  const base = {
    orderYear: '2026', orderWeek: '40-02', inputDate: '2026-10-01', farmName: 'Farm',
    fileName: 'packing.xlsx', invoiceNo: 'INV', awb: 'AWB', gw: 0, cw: 0,
    rate: 0, docFee: 0, items: [{ sourceRow: 6, prodName: 'Rose Red', boxQty: 0 }],
  };
  assert.deepEqual(validateWarehouseUploadInput(base), [], '2026 and zero quantities/metadata are valid');
  const expectInvalid = (patch, expected) => {
    const errors = validateWarehouseUploadInput({ ...base, ...patch });
    assert.ok(errors.some(({ error }) => expected.test(error)), `expected ${expected} in ${JSON.stringify(errors)}`);
  };
  expectInvalid({ orderYear: '2025' }, /2026년 이후/);
  expectInvalid({ orderYear: '' }, /2026년 이후/);
  expectInvalid({ orderWeek: '' }, /2026년 이후/);
  expectInvalid({ inputDate: '2026-02-30' }, /유효한 실제/);
  expectInvalid({ items: [{ prodName: 'Rose Red', boxQty: -1 }] }, /boxQty 값/);
  expectInvalid({ items: [{ prodName: 'Rose Red', boxQty: 'many' }] }, /boxQty 값/);
  expectInvalid({ items: [{ prodName: 'Rose Red', selectedProdKey: 'nope' }] }, /품목 키/);
  expectInvalid({ items: [null] }, /품목 행 형식/);
  expectInvalid({ items: [{ prodName: 'x'.repeat(251) }] }, /원본 품목명/);
  expectInvalid({ items: [] }, /1~2,000행/);

  assert.equal(warehouseCatalogSql().includes(WAREHOUSE_PRODUCT_NAME_SQL), true);
  assert.match(warehouseCatalogSql(), /WHERE isDeleted=0/);
  assert.match(warehouseCatalogSql(true), /FROM Product WITH \(HOLDLOCK\)/);
  assert.doesNotMatch(warehouseCatalogSql(), /LIKE|SOUNDEX|DIFFERENCE/i);

  for (const lock of [false, true]) {
    let callArgs;
    const db = async (...args) => {
      callArgs = args;
      return { recordset: [{ RowIndex: 0, ...product }] };
    };
    const resolved = await resolveWarehouseProducts(db, { NVarChar: (size) => ({ type: 'nvarchar', size }), MAX: 'MAX' }, originalItems, { lock });
    assert.equal(resolved.valid, true);
    assert.match(callArgs[0], new RegExp(WAREHOUSE_PRODUCT_NAME_SQL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.match(callArgs[0], /WHERE isDeleted=0/);
    assert.equal(/FROM Product WITH \(HOLDLOCK\)/.test(callArgs[0]), lock,
      'preview is unlocked and final resolution requests the catalog hold lock');
    assert.match(callArgs[0], /SelectedKey IS NOT NULL AND p\.ProdKey=r\.SelectedKey/);
    assert.match(callArgs[0], /SelectedKey IS NULL AND p\.NormalName=/);
    assert.equal(callArgs[1].rows.type.type, 'nvarchar');
  }

  const source = fs.readFileSync(path.join(__dirname, '..', 'lib/warehouseProductMatching.js'), 'utf8');
  assert.match(source, /WAREHOUSE_STAGE_GUARD_SQL/);
  assert.match(WAREHOUSE_STAGE_GUARD_SQL, /TABLOCKX, HOLDLOCK/);
  assert.match(WAREHOUSE_STAGE_GUARD_SQL, /EXCEPT/);
  assert.match(WAREHOUSE_STAGE_GUARD_SQL, /COUNT_BIG\(\*\)/,
    'staging guard compares duplicate row multiplicity; this source check is not a DB integration proof');
  assert.match(source, /warehouseCatalogSql\(lock\)/);
  assert.doesNotMatch(source, /INSERT\s+INTO\s+Product/i, 'matching must not autocreate product master records');
  assert.doesNotMatch(source, /SOUNDEX|DIFFERENCE\s*\(|LIKE\s+N?['"]/i,
    'matching must remain exact, without fuzzy SQL matching');

  assert.equal(warehouseExpectedQuantity({ boxQty: 3, bunchQty: 8, steamQty: 24 }, '단   '), 8,
    'trailing ordinary SQL spaces still select bunch quantity');
  assert.equal(warehouseExpectedQuantity({ boxQty: 3, bunchQty: 8, steamQty: 24 }, '박스 '), 3);
  assert.equal(warehouseExpectedQuantity({ boxQty: null, bunchQty: undefined, steamQty: 24 }, '단'), 0);

  const fixedCalls = [];
  const mockSql = { NVarChar: 'nvarchar', Bit: 'bit' };
  for (const lock of [false, true]) {
    for (const neighbors of [false, true]) {
      const db = async (query, params) => {
        fixedCalls.push({ query, params, lock, neighbors });
        return { recordset: [] };
      };
      await warehouseFixedCategories(db, mockSql, 2026, '40-02', ['Kenya', 'Ecuador'], { lock, neighbors });
    }
  }
  for (const { query, params, lock, neighbors } of fixedCalls) {
    assert.match(query, /FROM ViewShipment vs/);
    assert.match(query, /vs\.DetailFix/);
    assert.doesNotMatch(query, /vs\.MasterFix/);
    assert.match(query, /StockMaster/);
    assert.match(query, /OrderYearWeek/);
    assert.equal(query.includes('WITH (HOLDLOCK)'), lock);
    assert.equal(params.year.value, '2026');
    assert.equal(params.week.value, '40-02');
    assert.equal(params.neighbors.value, neighbors ? 1 : 0);
    assert.equal(params.categories.value, 'Kenya|Ecuador');
    assert.match(query, /@year\+REPLACE\(@week,'-',''\)/,
      'StockMaster adjacency is compared using year + two-part week key');
  }

  const duplicateCalls = [];
  const uploadBody = {
    orderYear: '2026', orderWeek: '40-02', farmName: 'Farm', fileName: 'pack.xlsx',
    invoiceNo: 'INV-1', awb: 'AWB-1',
  };
  for (const lock of [false, true]) {
    const db = async (query, params) => {
      duplicateCalls.push({ query, params, lock });
      return { recordset: [{ WarehouseKey: 123 }] };
    };
    assert.deepEqual(await warehouseDuplicateUploads(db, mockSql, uploadBody, lock), [{ WarehouseKey: 123 }]);
  }
  for (const { query, params, lock } of duplicateCalls) {
    assert.match(query, /FROM WarehouseMaster/);
    assert.match(query, /OrderYear=@year AND OrderWeek=@week/);
    assert.match(query, /FarmName=@farm AND FileName=@fn/);
    assert.match(query, /InvoiceNo/);
    assert.match(query, /ISNULL\(OrderNo,N''\)=@awb/);
    assert.match(query, /isDeleted=0/);
    assert.equal(/WITH \(UPDLOCK,HOLDLOCK\)/.test(query), lock,
      'duplicate check acquires update/hold lock only in final transaction');
    assert.equal(params.year.value, '2026');
    assert.equal(params.week.value, '40-02');
    assert.equal(params.farm.value, 'Farm');
    assert.equal(params.fn.value, 'pack.xlsx');
    assert.equal(params.inv.value, 'INV-1');
    assert.equal(params.awb.value, 'AWB-1');
  }

  const { parseWarehousePackingGrid } = await import('../lib/warehousePackingImport.js');
  const physicalRows = Array.from({ length: 10 }, () => []);
  physicalRows[1][2] = 'FARM';
  physicalRows[1][6] = '40-02';
  physicalRows[1][10] = 'INV';
  physicalRows[2][2] = 'AWB';
  physicalRows[2][6] = '2026/10/01';
  Object.assign(physicalRows[4], { 0: 'COD', 1: 'VARIETY NAME', 4: 'SIZE', 5: 'BOX', 8: 'TOTAL\nBUNCH', 9: 'TOTALSTEAM', 11: 'T.PRICE' });
  Object.assign(physicalRows[7], { 0: 'C-1', 1: 'Rose Red', 4: '60cm', 5: 1, 6: 20, 7: 200, 8: 20, 9: 200, 10: 0.2, 11: 4 });
  Object.assign(physicalRows[8], { 0: 'TOTAL', 1: 'skip me' });
  const physicalParsed = parseWarehousePackingGrid(physicalRows);
  assert.equal(physicalParsed.rows.length, 1);
  assert.equal(physicalParsed.rows[0].sourceRow, 8,
    'skipped physical worksheet rows do not renumber source row references');

  console.log('warehouse product rematch validation tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
