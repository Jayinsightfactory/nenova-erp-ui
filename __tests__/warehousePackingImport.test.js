const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

async function main() {
  const {
    parseWarehousePackingGrid,
    parseWarehousePackingWorkbook,
    prepareExactProductMatches,
    decideWarehousePackingImport,
  } = await import('../lib/warehousePackingImport.js');

  const grid = Array.from({ length: 9 }, () => []);
  grid[1][2] = 'CLOUD';
  grid[1][6] = '33-01';
  grid[1][10] = 'INV-33';
  grid[2][2] = 'AWB-100';
  grid[2][6] = '2026/08/17';
  Object.assign(grid[4], {
    0: 'COD', 1: 'VARIETY NAME', 4: 'SIZE', 5: 'BOX',
    8: 'TOTAL\nBUNCH', 9: 'TOTALSTEAM', 11: 'T.PRICE',
  });
  Object.assign(grid[5], {
    0: 'C-01', 1: 'CARNATION Doncel', 4: '60cm', 5: 2,
    6: 20, 7: 200, 8: 40, 9: 400, 10: 0.15, 11: 60,
  });
  Object.assign(grid[6], { 0: 'TOTAL', 1: 'ignored', 5: 2 });

  const parsed = parseWarehousePackingGrid(grid);
  assert.deepEqual(parsed.meta, {
    farmName: 'CLOUD', orderWeek: '33-01', invoiceNo: 'INV-33',
    awb: 'AWB-100', orderNo: 'AWB-100', inputDate: '2026/08/17', orderYear: '2026',
  });
  assert.deepEqual(parsed.rows, [{
    prodName: 'CARNATION Doncel 60cm', orderCode: 'C-01', boxQty: 2,
    steamOf1Bunch: 20, steamOf1Box: 200, bunchQty: 40, steamQty: 400,
    unitPrice: 0.15, totalPrice: 60,
  }]);

  const fakeXlsx = {
    read(buffer, options) {
      assert.equal(buffer, 'buffer');
      assert.deepEqual(options, { type: 'array', cellDates: true });
      return { SheetNames: ['PACKING'], Sheets: { PACKING: { grid } } };
    },
    utils: { sheet_to_json(sheet, options) {
      assert.deepEqual(options, { header: 1, defval: '', raw: true });
      return sheet.grid;
    } },
  };
  assert.equal(parseWarehousePackingWorkbook('buffer', fakeXlsx).rows[0].orderCode, 'C-01');

  const product2026 = { ProdKey: 101, ProdName: 'carnation doncel 60cm', isDeleted: 0 };
  const exact = prepareExactProductMatches(parsed.rows, [product2026]);
  assert.equal(exact.ok, true);
  assert.equal(exact.items[0].prodKey, 101);

  const unmatched = prepareExactProductMatches(parsed.rows, [
    { ProdKey: 102, ProdName: 'CARNATION Doncel', isDeleted: 0 },
  ]);
  assert.equal(unmatched.ok, false);
  assert.deepEqual(unmatched.items, [], '한 품목이라도 실패하면 성공 품목도 저장 후보로 내보내지 않는다.');
  assert.equal(unmatched.errors[0].reason, 'UNREGISTERED_PRODUCT');

  const ambiguous = prepareExactProductMatches(parsed.rows, [product2026, { ...product2026, ProdKey: 999 }]);
  assert.equal(ambiguous.ok, false);
  assert.equal(ambiguous.errors[0].reason, 'AMBIGUOUS_PRODUCT');

  assert.equal(decideWarehousePackingImport({
    rows: parsed.rows, products: [product2026], orderYear: '2026', orderWeek: '33-01',
  }).ok, true);
  assert.equal(decideWarehousePackingImport({
    rows: parsed.rows, products: [product2026], orderYear: '', orderWeek: '33-01',
  }).errors[0].reason, 'YEAR_WEEK_REQUIRED');

  // 전년도 동일 차수의 원장은 품목 매칭이나 현재 업로드 업무키를 바꾸지 않는다.
  const priorYearSameWeek = { orderYear: '2025', orderWeek: '33-01', warehouseKey: 1 };
  const current = decideWarehousePackingImport({
    rows: parsed.rows, products: [product2026], orderYear: '2026', orderWeek: priorYearSameWeek.orderWeek,
  });
  assert.equal(current.orderYear, '2026');
  assert.equal(current.orderWeek, '33-01');

  const badHeader = grid.map((row) => [...row]);
  badHeader[4][9] = 'TOTAL STEMS';
  assert.throws(() => parseWarehousePackingGrid(badHeader), /TOTALSTEAM/);

  const badNumber = grid.map((row) => [...row]);
  badNumber[5][5] = 'two';
  assert.throws(() => parseWarehousePackingGrid(badNumber), /BOX 값이 숫자가 아닙니다/);

  const apiSource = fs.readFileSync(path.join(__dirname, '..', 'pages/api/warehouse/index.js'), 'utf8');
  assert.doesNotMatch(apiSource, /TempWarehouseDetail/, '신규 Excel 업로드는 EXE의 공용 staging을 변경하지 않는다');
  assert.match(apiSource, /nextInvoiceWarehouseKey\(tQuery/);
  assert.match(apiSource, /insertInvoiceWarehouseDetail\(tQuery/);
  assert.match(apiSource, /applyInvoiceWarehouseStockDelta\(tQuery/);
  assert.match(apiSource, /calculateInvoiceStock\(tQuery/);
  assert.match(apiSource, /map\(Number\)\.filter\(\(key\) => Number\.isInteger\(key\) && key >= 0\)/,
    'ProdKey=0 전체 재계산을 제거하면 안 된다.');
  assert.match(apiSource, /IF ISNULL\(@r,-1\)<>0 THROW 51001/,
    '재고계산 실패는 같은 트랜잭션 전체를 롤백해야 한다.');
  assert.doesNotMatch(apiSource, /INSERT INTO WarehouseDetail/);
  assert.doesNotMatch(apiSource, /INSERT INTO StockHistory/);

  const { resolveReceiptBunch } = await import('../lib/receiptBunchQuantity.js');
  const { WAREHOUSE_WEIGHT_ROW_SQL } = await import('../lib/warehouseWeightRows.js');
  const babel = require('next/dist/compiled/babel/core');
  const compiled = babel.transformSync(apiSource, {
    plugins:[require('next/dist/compiled/babel/plugin-transform-modules-commonjs')],
    configFile:false,babelrc:false,
  }).code;
  const out = {exports:{}};
  const product = {ProdKey:670,CountryFlower:1,OutUnit:'박스',EstUnit:'단'};
  const transactionSql = [];
  let replaceUnit = false;
  const database = {
    sql:new Proxy({},{get:(_,key)=>key}),
    query:async()=>({recordset:[product]}),
    withTransaction:async callback=>callback(async statement=>{
      transactionSql.push(statement);
      return {recordset: [replaceUnit ? {...product,ProdKey:999} : product]};
    }),
  };
  const mocks = {
    '../../../lib/db':database, '../../../lib/auth':{withAuth:handler=>handler},
    '../../../lib/exeParity/common.js':{}, '../../../lib/exeWarehouseViewSql.js':{},
    '../../../lib/invoiceReceiptNative.js':{},
    '../../../lib/invoiceReceiptAccess.js':{canManageInvoiceReceipt:()=>true},
    '../../../lib/receiptBunchQuantity.js':{resolveReceiptBunch},
    '../../../lib/warehouseWeightRows.js':{WAREHOUSE_WEIGHT_ROW_SQL},
  };
  new Function('require','module','exports',compiled)(key=>mocks[key],out,out.exports);
  const handler=out.exports.default;
  const legacyBody={orderYear:'2026',orderWeek:'47-01',inputDate:'2026-11-20',
    items:[{prodName:'Douglas Fir',boxQty:150,steamQty:30000,bunchQty:null}]};
  const run=async body=>{
    const response={status(code){this.code=code;return this;},json(value){this.result=value;return this;}};
    await handler({method:'POST',body,user:{userId:'test'}},response);
    return response;
  };
  assert.equal((await run({...legacyBody,previewOnly:true})).code,400);
  assert.equal((await run(legacyBody)).code,400);
  assert.deepEqual(transactionSql,[]);
  const automatic = await run({...legacyBody,previewOnly:true,items:[{...legacyBody.items[0],steamOf1Bunch:10}]});
  assert.equal(automatic.code,200);
  assert.deepEqual(automatic.result.bunchQuantities,[3000]);
  const corrected={...legacyBody,items:[{...legacyBody.items[0],bunchQty:3000}]};
  assert.equal((await run({...corrected,previewOnly:true})).code,200);
  assert.deepEqual(transactionSql,[]);
  replaceUnit=true;
  assert.equal((await run(corrected)).code,400);
  assert.equal(transactionSql.length,1);
  assert.match(transactionSql[0], /UPDLOCK,HOLDLOCK/);
  console.log('warehouse packing import parser/policy tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
