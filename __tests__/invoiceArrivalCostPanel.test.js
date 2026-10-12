const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const React = require('react');
const { transformSync } = require('next/dist/build/swc');

const root = path.resolve(__dirname, '..');
const apiSource = fs.readFileSync(path.join(root, 'pages/api/arrival-cost/invoice-costs.js'), 'utf8');
const countries = { CN: '중국', NL: '네덜란드', CO: '콜롬비아' };
const executable = apiSource.replace(/^import .*;\r?\n/gm, '').replace(/export function /g, 'function ').replace('export default withAuth(createInvoiceArrivalCostHandler());', 'return { handler: withAuth(createInvoiceArrivalCostHandler()), createInvoiceArrivalCostHandler, normalizeInvoiceArrivalFilters };');
let wrapped = 0;
const api = new Function('withAuth', 'query', 'sql', 'readInvoiceCosts', 'PACKING_COUNTRIES', executable)(handler => { wrapped++; return handler; }, () => {}, {}, () => {}, countries);
const types = { Char: size => `Char(${size})`, NVarChar: size => `NVarChar(${size})`, Int: 'Int', MAX: 'MAX' };
const response = () => ({ headers: {}, setHeader(key, value) { this.headers[key] = value; }, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } });
const revision = (overrides = {}) => ({ basis: 'ACTUAL', status: 'APPROVED', revisionNo: 1, orderYear: '2026', orderWeek: '41-02', invoiceNo: 'CN-1', formulaId: 'CN_ACTUAL', totalCostKRW: 0, currency: 'KRW', approvedBy: 'user', approvedAt: null,
  InputSnapshotJson: 'PRIVATE', lines: [{ unit: 'BUNCH', quantity: 0, costPerUnitKRW: 0, totalCostKRW: 0, prodKey: 1, wdetailKey: 2, privateSource: 'PRIVATE' }], ...overrides });
const request = (query = {}) => ({ method: 'GET', user: { accountActive: true }, query: { orderYear: '2026', ...query } });

test('auth wrapper, inactive account, GET only, and strict explicit scope validation', async () => {
  assert.equal(wrapped, 1);
  let calls = 0;
  const handler = api.createInvoiceArrivalCostHandler({ queryFn: async () => { calls++; throw Error('unexpected'); }, types });
  for (const [req, status] of [[{ ...request(), user: { accountActive: false } }, 403], [{ ...request(), method: 'POST' }, 405], [request({ orderYear: '' }), 400], [request({ orderYear: '26' }), 400], [request({ orderWeek: '54-01' }), 400], [request({ orderWeek: '01-00' }), 400], [request({ country: 'XX' }), 400], [request({ beforeWarehouseKey: '-1' }), 400], [request({ orderYear: ['2025', '2026'] }), 400]]) {
    const res = response(); await handler(req, res); assert.equal(res.statusCode, status);
  }
  assert.equal(calls, 0);
  assert.deepEqual(api.normalizeInvoiceArrivalFilters({ orderYear: '2026', orderWeek: '1-2', country: '중국', limit: '90' }), { orderYear: '2026', orderWeek: '01-02', country: 'CN', limit: 20, beforeWarehouseKey: null });
});

test('missing tables return unavailable without schema mutation or cost reads', async () => {
  const sqls = [];
  const handler = api.createInvoiceArrivalCostHandler({ types, queryFn: async sql => { sqls.push(sql); return { recordset: [{ Available: 0 }] }; }, readCosts: () => { throw Error('must not read'); } });
  const res = response(); await handler(request(), res);
  assert.equal(res.statusCode, 200); assert.equal(res.body.available, false); assert.equal(sqls.length, 1);
  assert.match(sqls[0], /OBJECT_ID/); assert.doesNotMatch(sqls[0], /\b(CREATE|ALTER|INSERT|UPDATE|DELETE|MERGE|EXEC)\b/i);
});

test('read-only cross-year SQL, wrapper parameters, bounded concurrency, projection and pagination', async () => {
  let active = 0, peak = 0; const statements = [];
  const handler = api.createInvoiceArrivalCostHandler({ types,
    queryFn: async (sql, params) => {
      statements.push(sql);
      assert.doesNotMatch(sql, /\b(CREATE|ALTER|INSERT|UPDATE|DELETE|MERGE|EXEC)\b/i);
      if (sql.includes('OBJECT_ID')) return { recordset: [{ Available: 1 }] };
      if (sql.includes('invoice-arrival:product-names')) {
        assert.deepEqual(JSON.parse(params.productKeyChunks.value), [[1]]);
        assert.equal(params.productKeyChunks.type, 'NVarChar(MAX)');
        return { recordset: [{ ProdKey: 1, ProductName: '중국 장미' }] };
      }
      assert.match(sql, /d.OrderYear=@orderYear/); assert.match(sql, /d.OrderWeek=@orderWeek/); assert.match(sql, /JSON_VALUE/); assert.match(sql, /o.WarehouseKey<@beforeWarehouseKey/);
      assert.deepEqual(params.orderYear, { type: 'Char(4)', value: '2026' }); assert.equal(params.country.value, 'CN');
      return { recordset: Array.from({ length: 21 }, (_, i) => ({ WarehouseKey: 100 - i })) };
    },
    readCosts: async ({ warehouseKey }) => { active++; peak = Math.max(peak, active); await new Promise(resolve => setImmediate(resolve)); active--; return { warehouseKey, documentId: 'doc', status: 'APPROVED', currentActual: revision(), revisions: [] }; },
  });
  const res = response(); await handler(request({ orderWeek: '41-2', country: 'CN', beforeWarehouseKey: '101' }), res);
  assert.equal(res.statusCode, 200); assert.equal(peak, 2); assert.equal(res.body.rows.length, 20); assert.equal(res.body.nextCursor, 81); assert.equal(res.body.hasMore, true);
  assert.equal(res.body.rows[0].currentActual.totalCostKRW, 0); assert.equal(res.body.rows[0].currentActual.lines[0].quantity, 0);
  assert.equal(res.body.rows[0].currentActual.lines[0].productName, '중국 장미');
  assert.doesNotMatch(JSON.stringify(res.body), /PRIVATE|Snapshot|privateSource/); assert.equal(statements.length, 3);
});

test('STALE remains historical, cross-year readback and dependency errors fail closed with 503', async () => {
  const queryFn = async sql => ({ recordset: sql.includes('OBJECT_ID') ? [{ Available: 1 }] : [{ WarehouseKey: 1 }] });
  for (const mode of ['stale', 'year', 'error']) {
    const handler = api.createInvoiceArrivalCostHandler({ queryFn, types, readCosts: async () => {
      if (mode === 'error') throw Error('database offline');
      return { warehouseKey: 1, documentId: 'doc', status: 'STALE', currentActual: null, revisions: [revision({ status: 'STALE', orderYear: mode === 'year' ? '2025' : '2026' })] };
    } });
    const res = response(); await handler(request(), res);
    if (mode !== 'stale') { assert.equal(res.statusCode, 503); assert.equal(res.body.rows, undefined); }
    else { assert.equal(res.body.rows[0].currentActual, null); assert.equal(res.body.rows[0].latestStale.status, 'STALE'); assert.equal(res.body.rows[0].latestStale.totalCostKRW, 0); }
  }
});

// Real JSX compiled with the project's SWC, with a small deterministic hook driver.
test('product mapping is one parameterized page batch in 1000-key chunks, preserves names and missing products', async () => {
  let nameQueries = 0;
  const handler = api.createInvoiceArrivalCostHandler({ types,
    queryFn: async (sql, params) => {
      assert.doesNotMatch(sql, /\b(CREATE|ALTER|INSERT|UPDATE|DELETE|MERGE|EXEC)\b/i);
      if (sql.includes('OBJECT_ID')) return { recordset: [{ Available: 1 }] };
      if (!sql.includes('invoice-arrival:product-names')) return { recordset: [{ WarehouseKey: 10 }, { WarehouseKey: 9 }] };
      nameQueries++; assert.match(sql, /LEFT JOIN dbo.Product/); assert.match(sql, /p\.DisplayName/); assert.match(sql, /p\.ProdName/);
      const chunks = JSON.parse(params.productKeyChunks.value);
      assert.deepEqual(chunks.map(chunk => chunk.length), [1000, 1]);
      assert.equal(new Set(chunks.flat()).size, 1001); assert.equal(chunks.flat().includes(2000), false);
      return { recordset: [{ ProdKey: 1, ProductName: '장미 한글명' }, { ProdKey: 2, ProductName: 'ROSE' }] };
    },
    readCosts: async ({ warehouseKey }) => ({ warehouseKey, documentId: 'doc', status: 'APPROVED', currentActual: revision({ lines: [
      ...Array.from({ length: 1001 }, (_, index) => ({ prodKey: index + 1, quantity: 0, totalCostKRW: 0 })),
      { prodKey: 2000, productName: '기존 조회 이름' },
    ] }), revisions: [] }),
  });
  const res = response(); await handler(request(), res); assert.equal(res.statusCode, 200); assert.equal(nameQueries, 1);
  const lines = res.body.rows[0].currentActual.lines;
  assert.equal(lines[0].productName, '장미 한글명'); assert.equal(lines[1].productName, 'ROSE');
  assert.equal(lines[2].productName, null); assert.equal(lines.at(-1).productName, '기존 조회 이름'); assert.equal(lines[0].quantity, 0);
});

test('existing line names skip Product lookup and lookup errors remain 503 rather than healthy empty results', async () => {
  for (const named of [true, false]) {
    let lookups = 0;
    const handler = api.createInvoiceArrivalCostHandler({ types,
      queryFn: async sql => {
        if (sql.includes('OBJECT_ID')) return { recordset: [{ Available: 1 }] };
        if (sql.includes('invoice-arrival:product-names')) { lookups++; throw Error('unavailable'); }
        return { recordset: [{ WarehouseKey: 1 }] };
      }, readCosts: async () => ({ warehouseKey: 1, documentId: 'doc', currentActual: revision({ lines: [{ prodKey: 1, productName: named ? '원가 조회 품목명' : null }] }), revisions: [] }),
    });
    const res = response(); await handler(request(), res);
    assert.equal(res.statusCode, named ? 200 : 503); assert.equal(lookups, named ? 0 : 1);
    if (!named) assert.equal(res.body.rows, undefined);
  }
});

test('arrival page wires the panel to applied filters after header and before existing panels', () => {
  const page = fs.readFileSync(path.join(root, 'pages/arrival-cost.js'), 'utf8');
  assert.match(page, /import InvoiceArrivalCostPanel from ['"]\.\.\/components\/import-tools\/InvoiceArrivalCostPanel['"]/);
  const wiring = '<InvoiceArrivalCostPanel orderYear={appliedFilters.orderYear} orderWeek={appliedFilters.orderWeek} country={appliedFilters.country} />';
  assert.equal(page.split(wiring).length - 1, 1);
  assert.ok(page.indexOf('arrival-title-row') < page.indexOf(wiring));
  assert.ok(page.indexOf(wiring) < page.indexOf('<ArrivalDriveAutoPanel'));
});

function panelHarness() {
  const values = [], dependencies = [], cleanups = []; let cursor = 0, effects = [], tree;
  const fakeReact = { ...React,
    useState(initial) { const key = cursor++; if (!(key in values)) values[key] = initial; return [values[key], next => { values[key] = typeof next === 'function' ? next(values[key]) : next; }]; },
    useRef(initial) { const key = cursor++; if (!(key in values)) values[key] = { current: initial }; return values[key]; },
    useEffect(fn, deps) { const key = cursor++; if (!dependencies[key] || deps.some((d, i) => d !== dependencies[key][i])) { dependencies[key] = deps; effects.push(() => { cleanups[key]?.(); cleanups[key] = fn(); }); } },
  };
  const filename = path.join(root, 'components/import-tools/InvoiceArrivalCostPanel.js');
  const code = transformSync(fs.readFileSync(filename, 'utf8'), { filename, jsc: { parser: { syntax: 'ecmascript', jsx: true }, target: 'es2022', transform: { react: { runtime: 'classic' } } }, module: { type: 'commonjs' } }).code;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)(name => name === 'react' ? fakeReact : {}, module, module.exports);
  let props = { orderYear: '2026', orderWeek: '41-02', country: 'CN' };
  const render = next => { if (next) props = { ...props, ...next }; cursor = 0; tree = module.exports.default(props); const pending = effects; effects = []; pending.forEach(fn => fn()); return tree; };
  const flatten = node => !node || typeof node !== 'object' ? [] : [node, ...React.Children.toArray(node.props?.children).flatMap(flatten)];
  return { render, nodes: () => flatten(tree), click(label) { const button = flatten(tree).find(node => node.type === 'button' && node.props.children === label); assert.ok(button, label); button.props.onClick(); render(); }, unmount() { cleanups.forEach(fn => fn?.()); } };
}
const tick = () => new Promise(resolve => setImmediate(resolve));
const payload = (key, extras = {}) => ({ success: true, available: true, rows: [{ warehouseKey: key, orderYear: '2026', orderWeek: '41-02', invoiceNo: 'CN', currentActual: revision(), status: 'APPROVED' }], hasMore: false, nextCursor: null, ...extras });

test('panel lazy loading, stale-response race, preserved error rows, and scoped pagination', async () => {
  const original = global.fetch; const requests = [];
  global.fetch = (url, options) => new Promise(resolve => requests.push({ url, options, resolve }));
  try {
    const panel = panelHarness(); panel.render(); assert.equal(requests.length, 0);
    panel.click('인보이스 입고 원가 조회'); assert.equal(requests.length, 1);
    panel.render({ orderYear: '2025' }); assert.equal(requests[0].options.signal.aborted, true); assert.equal(requests.length, 2);
    requests[0].resolve({ ok: true, json: async () => payload(999) });
    requests[1].resolve({ ok: true, json: async () => payload(20, { hasMore: true, nextCursor: 20 }) }); await tick(); panel.render();
    assert.equal(panel.nodes().some(node => node.type === 'td' && node.props.children === 999), false);
    panel.click('다음 20건 조회'); assert.match(requests[2].url, /orderYear=2025/); assert.match(requests[2].url, /beforeWarehouseKey=20/);
    requests[2].resolve({ ok: true, json: async () => payload(19) }); await tick(); panel.render();
    for (const key of [20, 19]) assert.ok(panel.nodes().some(node => node.type === 'td' && node.props.children === key));
    panel.click('인보이스 입고 원가 조회'); requests[3].resolve({ ok: false, json: async () => ({ error: 'offline' }) }); await tick(); panel.render();
    assert.ok(panel.nodes().some(node => node.props.role === 'alert')); assert.ok(panel.nodes().some(node => node.type === 'td' && node.props.children === 20));
    panel.render({ orderYear: '2024' }); assert.equal(panel.nodes().some(node => node.type === 'td' && node.props.children === 20), false);
    requests[4].resolve({ ok: false, json: async () => ({ error: 'offline' }) }); await tick(); panel.render();
    assert.equal(panel.nodes().some(node => node.type === 'td' && node.props.children === 20), false); panel.unmount();
  } finally { global.fetch = original; }
});

test('panel renders real zero approval, missing dash, and STALE as historical comparison only', async () => {
  const original = global.fetch;
  global.fetch = async () => ({ ok: true, json: async () => ({ success: true, available: true, rows: [
    { ...payload(1).rows[0], currentActual: revision({ lines: [{ prodKey: 1, productName: '영업용 장미', quantity: 0, totalCostKRW: 0 }, { prodKey: 2, productName: null }] }) },
    { warehouseKey: 2, orderYear: '2026', orderWeek: '41-02', invoiceNo: null, currentActual: null, status: 'STALE', latestStale: { formulaId: 'HISTORICAL', totalCostKRW: 123, approvedBy: 'old' } },
    { warehouseKey: 3, orderYear: '2026', orderWeek: '41-02', currentActual: null, latestStale: null, status: null },
  ], hasMore: false }) });
  try {
    const panel = panelHarness(); panel.render(); panel.click('인보이스 입고 원가 조회'); await tick();
    const html = require('react-dom/server').renderToStaticMarkup(panel.render());
    assert.match(html, /승인된 실제 원가/); assert.match(html, /0 KRW/); assert.match(html, /STALE · 현재 원가 없음/);
    assert.match(html, /과거 비교용 · 현재 원가 아님/); assert.match(html, /123/); assert.match(html, /—/);
    assert.match(html, /<th>품목명<\/th>/); assert.match(html, /영업용 장미/);
    assert.match(html, /href="\/incoming"/); assert.match(html, /href="\/import\/tools"/);
    panel.unmount();
  } finally { global.fetch = original; }
});
