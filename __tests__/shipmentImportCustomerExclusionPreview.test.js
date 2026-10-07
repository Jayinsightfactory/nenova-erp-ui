import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

// Compile the actual preview and its matching/quantity/fix policies locally.
// DB and write-only dependencies cannot open a connection or run a transaction.
const require = createRequire(import.meta.url);
const suffix = process.platform === 'win32' ? '-msvc' : process.platform === 'linux' ? '-gnu' : '';
const { transformSync } = require(`@next/swc-${process.platform}-${process.arch}${suffix}`);
const lib = fileURLToPath(new URL('../lib/', import.meta.url));
const realModules = new Set(['shipmentImport', 'orderUtils', 'shipmentImportQty', 'shipmentFixScope',
  'shipmentFixScopeCore', 'shipmentDescr', 'distributeUnits', 'pivotProdName',
  'pivotVolumeProductLabel', 'dutchVolumeCustomerMatch']);
const cache = new Map();
const forbidden = () => { throw new Error('Preview fixture must never access a real DB or write dependency'); };
function load(filename) {
  if (cache.has(filename)) return cache.get(filename).exports;
  const mod = { exports: {} };
  cache.set(filename, mod);
  const compiled = transformSync(readFileSync(filename, 'utf8'), false, Buffer.from(JSON.stringify({
    filename, jsc: { target: 'es2020', parser: { syntax: 'ecmascript' } }, module: { type: 'commonjs' },
  })));
  new Function('require', 'module', 'exports', compiled.code)(name => {
    if (name === './db') return { query: forbidden, withTransaction: forbidden,
      sql: { NVarChar: 'NVarChar', Int: 'Int', Decimal: forbidden } };
    const target = resolve(dirname(filename), name.endsWith('.js') ? name : `${name}.js`);
    if (realModules.has(basename(target, '.js'))) return load(target);
    // Every unused write-only import is a throwing function if accidentally invoked.
    return new Proxy({}, { get: (_, key) => key === '__esModule' ? true : forbidden });
  }, mod, mod.exports);
  return mod.exports;
}
const { buildImportPreview } = load(resolve(lib, 'shipmentImport.js'));

const product = { ProdKey: 359, ProdName: 'ROSE / Brut', DisplayName: 'Brut',
  FlowerName: '장미', CounName: '에콰도르', CountryFlower: '에콰도르 장미',
  OutUnit: '박스', EstUnit: '박스', BunchOf1Box: 10, SteamOf1Bunch: 10, SteamOf1Box: 100 };
const customer = { CustKey: 533, CustName: '주광농원', OrderCode: 'JGW', Descr: '', BaseOutDay: 0 };
const ledger = [
  { year: '2026', week: '41-01', CustKey: 533, ProdKey: 359, orderQty: 5, currentOutQty: 4 },
  { year: '2026', week: '40-02', CustKey: 533, ProdKey: 359, orderQty: 3, currentOutQty: 3 },
  { year: '2025', week: '41-01', CustKey: 533, ProdKey: 359, orderQty: 99, currentOutQty: 99 },
];
const parsedRows = [
  { week: '41-01', customerLabel: '주광농원', prodName: product.ProdName, prodKey: 359,
    uploadQty: 5, outUnit: '박스', sheetName: '장미', rowNo: 4, colNo: 2 },
  { week: '41-01', customerLabel: '주광선출고', prodName: product.ProdName, prodKey: 359,
    uploadQty: 3, outUnit: '박스', sheetName: '장미', rowNo: 4, colNo: 3 },
];

async function preview(customerOverrides = {}) {
  const before = JSON.stringify({ ledger, parsedRows, product, customer });
  const calls = [];
  const queryFn = async (text, params = {}) => {
    assert.doesNotMatch(text, /\b(?:INSERT|UPDATE|DELETE|EXEC|MERGE)\b/i);
    calls.push({ text, params });
    if (params.weekKey) {
      assert.equal(params.yr.value, '2026');
      assert.equal(params.weekKey.value, '20264101');
      return { recordset: [] };
    }
    if (/FROM Product\s+WHERE/.test(text)) return { recordset: [structuredClone(product)] };
    if (/FROM Customer\s+WHERE/.test(text)) return { recordset: [structuredClone(customer)] };
    assert.equal(params.importYear?.value, '2026');
    assert.equal(params.week?.value, '41-01');
    if (/AS yr, COUNT/.test(text)) return { recordset: [{ yr: '2025', detailCount: 1 }] };
    assert.match(text, /ISNULL\(CAST\(sm\.OrderYear AS NVARCHAR\(4\)\), @importYear\) = @importYear/,
      'actual shipment query must filter selected year, not just fixture routing');
    if (/FROM OrderMaster om/.test(text) && !/NOT EXISTS/.test(text)) {
      assert.match(text, /ISNULL\(CAST\(om\.OrderYear AS NVARCHAR\(4\)\), @importYear\) = @importYear/);
      assert.match(text, /om\.OrderWeek\s*=\s*@week/);
      const rows = ledger.filter(r => r.year === params.importYear.value && r.week === params.week.value)
        .map(r => ({ ...r, CustName: customer.CustName, OrderCode: customer.OrderCode,
          ProdName: product.ProdName, OutUnit: product.OutUnit }));
      return { recordset: rows };
    }
    if (/FROM ShipmentMaster sm/.test(text) && /NOT EXISTS/.test(text)) return { recordset: [] };
    throw new Error(`Unexpected preview query: ${text}`);
  };
  const result = await buildImportPreview({ parsedRows, rawWeek: '41-01', rawYear: '2026',
    customerOverrides, queryFn });
  assert.equal(JSON.stringify({ ledger, parsedRows, product, customer }), before,
    'preview/exclusion never mutates current, previous-week or prior-year ledger fixtures');
  assert.equal(result.orderYear, '2026');
  assert.deepEqual(result.otherYearWeeks, [{ year: '2025', detailCount: 1 }]);
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].currentOutQty, 4, 'only selected-year/week allocation participates');
  assert.equal(result.rows[0].orderQty, 5, 'prior-year same-week order is excluded');
  assert.ok(calls.length >= 7, 'actual preview executes catalog, fix, order, shipment and year reads');
  return result;
}

test('unmatched original column blocks until explicitly excluded or connected; undo restores block', async () => {
  const unresolved = await preview();
  assert.equal(unresolved.unmatched.length, 1);
  assert.equal(unresolved.unmatched[0].customerLabel, '주광선출고');
  assert.match(unresolved.unmatched[0].reason, /업체/);
  assert.equal(unresolved.rows[0].uploadQty, 5);
  assert.equal(unresolved.ignoredCustomerCount, 0);

  const ignored = await preview({ '주광선출고': '__ignore__' });
  assert.equal(ignored.unmatched.length, 0);
  assert.equal(ignored.ignoredCustomerCount, 1);
  assert.equal(ignored.rows[0].uploadQty, 5, 'normal customer column remains; pseudo-column is not summed');
  assert.equal(ignored.rows[0].missingFromExcel, undefined, 'normal column prevents missing-to-zero synthesis');
  assert.deepEqual(ignored.rows[0].cells, ['장미!R4C2']);
  assert.equal(ignored.applyRows[0].shipmentDiffQty, 1, '5 is a final target relative to current 4');

  const connected = await preview({ '주광선출고': 533 });
  assert.equal(connected.unmatched.length, 0);
  assert.equal(connected.ignoredCustomerCount, 0);
  assert.equal(connected.rows[0].uploadQty, 8, 'explicit real-customer connection sums both original columns');
  assert.deepEqual(connected.rows[0].cells, ['장미!R4C2', '장미!R4C3']);
  assert.equal(connected.applyRows[0].shipmentDiffQty, 4);

  const undone = await preview({});
  assert.deepEqual(undone.unmatched, unresolved.unmatched);
  assert.equal(undone.rows[0].uploadQty, 5);

  const invalidConnection = await preview({ '주광선출고': 999999 });
  assert.equal(invalidConnection.unmatched.length, 1, 'invalid explicit mapping cannot silently resolve another customer');
  assert.equal(invalidConnection.rows[0].uploadQty, 5);
});

