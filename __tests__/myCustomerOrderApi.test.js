/*
 * Executable API contract tests for source=my-customer ADD/REPLACE.
 *
 * This deliberately loads pages/api/orders/index.js as a small CommonJS
 * fixture.  The production module has Next.js/ESM imports and a real MSSQL
 * connection at module load time, neither of which is needed here.  The
 * handler is still the production createOrder function; only its imported
 * dependencies are replaced with the transactional fixture below.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const API_FILE = path.join(process.cwd(), 'pages/api/orders/index.js');

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeUnit(value, fallback = '박스') {
  const v = String(value || '').trim().toLowerCase();
  if (v === '단' || v === 'bunch' || v === 'bunches') return '단';
  if (v === '송이' || v === 'stem' || v === 'stems' || v === 'ea') return '송이';
  if (v === '박스' || v === 'box' || v === 'boxes') return '박스';
  return fallback;
}

function orderYearFrom(week, year) {
  const raw = String(week || '').trim();
  const m = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return { orderYear: m[1], orderWeek: `${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}` };
  if (!/^\d{1,2}-\d{1,2}$/.test(raw)) throw new Error('차수 형식이 올바르지 않습니다.');
  const y = String(year || '').trim();
  if (!/^\d{4}$/.test(y)) throw new Error('주문 연도가 필요합니다.');
  const [major, sequence] = raw.split('-');
  return { orderYear: y, orderWeek: `${major.padStart(2, '0')}-${sequence.padStart(2, '0')}` };
}

function baseState(overrides = {}) {
  return {
    customers: [{ CustKey: 317, OrderCode: 'C317', Manager: 'admin', isDeleted: 0 }],
    products: [
      { ProdKey: 53, ProdName: 'Rose 50cm', FlowerName: 'Rose', OutUnit: '단', EstUnit: '송이', B1B: 10, S1B: 100, isDeleted: 0 },
      { ProdKey: 54, ProdName: 'Hydrangea', FlowerName: 'Hydrangea', OutUnit: '박스', EstUnit: '송이', B1B: 20, S1B: 100, isDeleted: 0 },
      { ProdKey: 55, ProdName: 'Other product', FlowerName: 'Other', OutUnit: '박스', EstUnit: '박스', B1B: 1, S1B: 1, isDeleted: 0 },
    ],
    masters: [{ OrderMasterKey: 100, OrderYear: '2026', OrderWeek: '32-01', CustKey: 317, isDeleted: 0, Manager: 'admin', OrderCode: 'C317' }],
    details: [{ OrderDetailKey: 200, OrderMasterKey: 100, ProdKey: 53, BoxQuantity: 0.2, BunchQuantity: 2, SteamQuantity: 20, OutQuantity: 2, EstQuantity: 200, NoneOutQuantity: 0, isDeleted: 0 }],
    shipmentDetails: [],
    histories: [],
    ...overrides,
  };
}

function makeDb(initial = baseState()) {
  const seed = { ...baseState(), ...initial };
  const db = {
    state: clone(seed),
    writes: [],
    queries: [],
    committed: false,
  };

  function paramsOf(params) {
    const out = {};
    for (const [key, value] of Object.entries(params || {})) out[key] = value && Object.prototype.hasOwnProperty.call(value, 'value') ? value.value : value;
    return out;
  }

  function activeMaster(s, mk) {
    return s.masters.find(row => Number(row.OrderMasterKey) === Number(mk));
  }

  function activeDetails(s, mk, pk) {
    return s.details.filter(row => Number(row.OrderMasterKey) === Number(mk)
      && (pk === undefined || Number(row.ProdKey) === Number(pk))
      && Number(row.isDeleted || 0) === 0);
  }

  function markQuery(sqlText, params, transaction) {
    const compact = String(sqlText).replace(/\s+/g, ' ').trim();
    db.queries.push({ sql: compact, params: paramsOf(params), transaction });
    if (/\b(?:INSERT|UPDATE|DELETE)\b/i.test(compact) && !/\bAppLog\b|\bKeyNumbering\b/i.test(compact)) {
      db.writes.push({ sql: compact, params: paramsOf(params), transaction });
      if (/\b(?:ShipmentMaster|ShipmentDetail|ShipmentDate|ShipmentFarm|Estimate|WebProfitReport)\b/i.test(compact)) {
        throw new Error(`forbidden shipment/estimate mutation in API test: ${compact}`);
      }
    }
  }

  async function execute(s, sqlText, rawParams, transaction) {
    const text = String(sqlText);
    const compact = text.replace(/\s+/g, ' ').trim();
    const p = paramsOf(rawParams);
    markQuery(text, rawParams, transaction);

    // Logging and capability probes are intentionally inert.
    if (/INSERT INTO AppLog/i.test(text) || /COL_LENGTH\(/i.test(text)) {
      if (/COL_LENGTH/i.test(text)) return { recordset: [{ HasColumn: 1 }] };
      return { recordset: [] };
    }
    if (/usp_StockCalculation/i.test(text)) return { recordset: [] };

    if (/FROM Customer .*CustKey=@ck/i.test(text) || /FROM Customer c .*CustKey=@ck/i.test(text)) {
      const row = s.customers.find(x => Number(x.CustKey) === Number(p.ck) && Number(x.isDeleted || 0) === 0);
      return { recordset: row ? [{ CustKey: row.CustKey, OrderCode: row.OrderCode || '', UserID: row.Manager || 'admin' }] : [] };
    }
    if (/FROM UserInfo/i.test(text)) return { recordset: [{ UserID: 'admin' }] };

    if (/FROM OrderMaster WITH .*WHERE CustKey=@ck/i.test(text)) {
      const rows = s.masters.filter(x => Number(x.CustKey) === Number(p.ck) && x.OrderWeek === p.wk
        && (x.OrderYear === p.year || (['2025', '2024'].includes(String(p.year)) && !x.OrderYear)))
        .sort((a, b) => Number(a.isDeleted || 0) - Number(b.isDeleted || 0) || Number(a.OrderMasterKey) - Number(b.OrderMasterKey));
      return { recordset: rows.slice(0, 1).map(x => ({ OrderMasterKey: x.OrderMasterKey, isDeleted: x.isDeleted || 0 })) };
    }
    if (/SELECT ISNULL\(MAX\(OrderMasterKey\)/i.test(text)) {
      return { recordset: [{ nk: Math.max(0, ...s.masters.map(x => Number(x.OrderMasterKey) || 0)) + 1 }] };
    }
    if (/INSERT INTO OrderMaster/i.test(text)) {
      s.masters.push({ OrderMasterKey: Number(p.mk), OrderYear: String(p.year), OrderWeek: String(p.week), CustKey: Number(p.custKey), isDeleted: 0, Manager: p.mgr, OrderCode: p.oc });
      return { recordset: [] };
    }
    if (/UPDATE OrderMaster SET/i.test(text)) {
      const row = activeMaster(s, p.mk);
      if (!row) return { recordset: [] };
      if (/isDeleted=0/i.test(text)) row.isDeleted = 0;
      if (/isDeleted=1/i.test(text) && /NOT EXISTS/i.test(text) && activeDetails(s, row.OrderMasterKey).length === 0) row.isDeleted = 1;
      if (/Manager\s*=|Manager\s+CASE/i.test(text) && p.mgr !== undefined) row.Manager = p.mgr;
      if (/OrderCode/i.test(text) && p.oc !== undefined) row.OrderCode = p.oc;
      return { recordset: [] };
    }

    if (/FROM Product WHERE ProdKey=@pk/i.test(text)) {
      const row = s.products.find(x => Number(x.ProdKey) === Number(p.pk) && Number(x.isDeleted || 0) === 0);
      if (!row) return { recordset: [] };
      return { recordset: [{ ProdKey: row.ProdKey, ProdName: row.ProdName, FlowerName: row.FlowerName, OutUnit: row.OutUnit, EstUnit: row.EstUnit || row.OutUnit, CounName: row.CounName || '', ProdDescr: row.ProdDescr || '', B1B: row.B1B || 0, S1B: row.S1B || 0 }] };
    }
    if (/SELECT TOP 1 ProdKey FROM Product/i.test(text)) {
      const name = String(p.name || '').replace(/%/g, '').toLowerCase();
      const row = s.products.find(x => String(x.ProdName).toLowerCase().includes(name));
      return { recordset: row ? [{ ProdKey: row.ProdKey }] : [] };
    }

    // The my-customer path locks every active row across all current-year
    // masters before deciding whether a single detail is safe to update.
    if (/JOIN OrderDetail od/i.test(text) && /od\.ProdKey=@pk/i.test(text) && /om\.OrderYear=@year/i.test(text)) {
      const masters = s.masters.filter(x => String(x.OrderYear) === String(p.year) && x.OrderWeek === p.wk
        && Number(x.CustKey) === Number(p.ck) && Number(x.isDeleted || 0) === 0);
      const rows = s.details.filter(x => masters.some(m => Number(m.OrderMasterKey) === Number(x.OrderMasterKey))
        && Number(x.ProdKey) === Number(p.pk) && Number(x.isDeleted || 0) === 0)
        .sort((a, b) => Number(a.OrderDetailKey) - Number(b.OrderDetailKey))
        .map(x => ({ OrderDetailKey: x.OrderDetailKey, OrderMasterKey: x.OrderMasterKey, OutQuantity: x.OutQuantity, isDeleted: 0 }));
      return { recordset: rows };
    }

    // Both the old TOP 1 query and the new duplicate-aware aggregate query
    // are answered from every active row.  A second active row must never be
    // silently selected by this fixture.
    if (/FROM OrderDetail/i.test(text) && /OrderMasterKey=@mk/i.test(text) && /ProdKey=@pk/i.test(text)) {
      const rows = activeDetails(s, p.mk, p.pk).map(x => ({ OrderDetailKey: x.OrderDetailKey, OutQuantity: x.OutQuantity, isDeleted: x.isDeleted || 0 }));
      if (/COUNT\(\*\)|RecordCount|ActiveCount|Duplicate/i.test(text)) {
        return { recordset: [{ RecordCount: rows.length, ActiveCount: rows.length, Qty: rows.reduce((sum, x) => sum + Number(x.OutQuantity || 0), 0) }] };
      }
      return { recordset: rows.slice(0, 1) };
    }
    if (/SELECT ISNULL\(MAX\(OrderDetailKey\)/i.test(text)) {
      return { recordset: [{ nk: Math.max(0, ...s.details.map(x => Number(x.OrderDetailKey) || 0)) + 1 }] };
    }
    if (/INSERT INTO OrderDetail/i.test(text)) {
      s.details.push({ OrderDetailKey: Number(p.nk), OrderMasterKey: Number(p.mk), ProdKey: Number(p.pk), BoxQuantity: Number(p.box || 0), BunchQuantity: Number(p.bunch || 0), SteamQuantity: Number(p.steam || 0), OutQuantity: Number(p.oq || 0), EstQuantity: p.est !== undefined ? Number(p.est || 0) : Number(p.oq || 0), NoneOutQuantity: 0, isDeleted: 0 });
      return { recordset: [] };
    }
    if (/UPDATE OrderDetail SET/i.test(text)) {
      const row = s.details.find(x => Number(x.OrderDetailKey) === Number(p.dk));
      if (!row) return { recordset: [] };
      const increment = /ISNULL\(BoxQuantity,0\)\s*\+\s*@box/i.test(text) || /OutQuantity\s*=\s*ISNULL\(OutQuantity,0\)\s*\+/i.test(text);
      row.BoxQuantity = increment ? Number(row.BoxQuantity || 0) + Number(p.box || 0) : Number(p.box || 0);
      row.BunchQuantity = increment ? Number(row.BunchQuantity || 0) + Number(p.bunch || 0) : Number(p.bunch || 0);
      row.SteamQuantity = increment ? Number(row.SteamQuantity || 0) + Number(p.steam || 0) : Number(p.steam || 0);
      row.OutQuantity = increment ? Number(row.OutQuantity || 0) + Number(p.oq || 0) : Number(p.oq || 0);
      row.EstQuantity = p.est !== undefined ? Number(p.est || 0) : (increment ? Number(row.EstQuantity || 0) + Number(p.oq || 0) : Number(p.oq || 0));
      row.NoneOutQuantity = 0;
      if (/isDeleted\s*=\s*1/i.test(text)) row.isDeleted = 1;
      if (/isDeleted\s*=\s*0/i.test(text)) row.isDeleted = 0;
      return { recordset: [] };
    }
    if (/INSERT INTO OrderHistory/i.test(text)) {
      s.histories.push({ OrderDetailKey: Number(p.dk), BeforeValue: p.before, AfterValue: p.after });
      return { recordset: [] };
    }

    // REPLACE zero is only legal when the corresponding shipment row is absent.
    if (/ShipmentDetailCount/i.test(text)) {
      const rows = s.shipmentDetails.filter(x => Number(x.ProdKey) === Number(p.pk)
        && Number(x.CustKey) === Number(p.ck) && String(x.OrderYear) === String(p.year)
        && String(x.OrderWeek) === String(p.wk));
      return { recordset: [{ ShipmentDetailCount: rows.length }] };
    }
    if (/FROM ShipmentDetail/i.test(text)) {
      const rows = s.shipmentDetails.filter(x => Number(x.ProdKey) === Number(p.pk)
        && Number(x.CustKey) === Number(p.ck || x.CustKey)
        && (!p.year || String(x.OrderYear) === String(p.year))
        && (!p.wk || String(x.OrderWeek) === String(p.wk))
        && Number(x.OutQuantity || x.Quantity || 0) !== 0);
      return { recordset: rows };
    }

    // Post-write verification over the same exact business key.
    if (/rawOrder\.RecordCount|RawOrderCount|FROM ViewOrder/i.test(text) && /@yr/.test(text)) {
      const masterRows = s.masters.filter(x => String(x.OrderYear) === String(p.yr) && x.OrderWeek === p.wk && Number(x.CustKey) === Number(p.ck) && Number(x.isDeleted || 0) === 0);
      const rows = s.details.filter(d => masterRows.some(m => Number(m.OrderMasterKey) === Number(d.OrderMasterKey)) && Number(d.ProdKey) === Number(p.pk) && Number(d.isDeleted || 0) === 0);
      const qty = rows.reduce((sum, x) => sum + Number(x.OutQuantity || 0), 0);
      return { recordset: [{ RawOrderCount: rows.length, RawOrderQty: qty, ViewOrderCount: rows.length, ViewOrderQty: qty }] };
    }

    // KeyNumbering and edit-presence helpers issue statements that do not
    // affect the order fixture.
    return { recordset: [] };
  }

  db.query = (text, params) => execute(db.state, text, params, false);
  db.withTransaction = async (callback) => {
    const staged = clone(db.state);
    const txQuery = (text, params) => execute(staged, text, params, true);
    const value = await callback(txQuery);
    db.state = staged;
    db.committed = true;
    return value;
  };
  return db;
}

function loadCreateOrder(db) {
  let source = fs.readFileSync(API_FILE, 'utf8');
  // Remove ESM imports, retaining all production function bodies.
  source = source.replace(/^import[\s\S]*?from ['"][^'"]+['"];?\s*/gm, '');
  source = source.replace(/export\s+default\s+/, 'const handlerExport = ');
  source = source.replace(/export\s*\{[^}]*\};?/g, '');
  const policySource = fs.readFileSync(path.join(process.cwd(), 'lib/myCustomerOrderWritePolicy.js'), 'utf8')
    .replace(/export\s+(?=const|function)/g, '');
  const policy = new Function(`${policySource}\nreturn { MY_CUSTOMER_ORDER_MODE, assertMyCustomerExpectedCurrentQty, isMyCustomerOrderSource, planMyCustomerOrderWrite, validateMyCustomerOrderWriteRequest };`)();
  const dependencies = {
    query: db.query,
    withTransaction: db.withTransaction,
    sql: { Int: 'Int', NVarChar: 'NVarChar', Float: 'Float', Bit: 'Bit', Date: 'Date' },
    withAuth: fn => fn,
    withActionLog: fn => fn,
    normalizeOrderUnit: normalizeUnit,
    requireOrderYear: orderYearFrom,
    resolveOrderListYearScope: () => ({ orderYear: '2026', orderWeek: '32-01' }),
    useExeParityFlag: () => false,
    sqlOrderViewGetData: () => '',
    sqlOrderAddGetDataCountry: () => '',
    sqlOrderAddGetDataFlower: () => '',
    sqlOrderAddGetDataProduct: () => '',
    quantitiesMatch: (a, b) => Math.abs(Number(a) - Number(b)) < 1e-6,
    allowHotelMiuMissingCancel: () => false,
    resolveHotelMiuOverflowCancel: (source, applyDeltaAdd, oldOutQty, computedNext) => {
      if (computedNext < 0 && !applyDeltaAdd) return { kind: 'reject' };
      return { kind: 'normal', nextOutQty: computedNext };
    },
    assertErpEditGuard: async () => undefined,
    advanceErpEditGuard: async () => ({ editDigestAfter: 'fixture', revision: 1 }),
    evaluateOrderRegistrationPostWrite: ({ expectedOrderOut, facts }) => ({ verified: Math.abs(Number(expectedOrderOut) - Number(facts.rawOrderQty)) < 1e-6 }),
    orderRegistrationPostWriteMismatchError: () => new Error('post-write verification mismatch'),
    // Names used by the pending pure policy seam are supplied as harmless
    // defaults; policy behavior is asserted through the actual API writes.
    ...policy,
  };
  const names = Object.keys(dependencies);
  const values = names.map(name => dependencies[name]);
  const body = `${source}\nreturn { createOrder: typeof createOrder === 'function' ? createOrder : null, handlerExport };`;
  const factory = new Function(...names, body);
  const loaded = factory(...values);
  if (typeof loaded.createOrder !== 'function') throw new Error('API seam missing: createOrder must be exported or remain loadable');
  return loaded.createOrder;
}

async function call(createOrder, db, body) {
  const response = { statusCode: 200, payload: undefined, status(code) { this.statusCode = code; return this; }, json(value) { this.payload = value; return this; }, end() { return this; } };
  await createOrder({ method: 'POST', body, user: { userId: 'fixture-user' } }, response);
  return response;
}

function detail(db, prodKey, year = '2026', week = '32-01', custKey = 317) {
  const masters = db.state.masters.filter(x => String(x.OrderYear) === String(year) && x.OrderWeek === week && Number(x.CustKey) === Number(custKey) && Number(x.isDeleted || 0) === 0);
  return db.state.details.filter(x => masters.some(m => Number(m.OrderMasterKey) === Number(x.OrderMasterKey)) && Number(x.ProdKey) === Number(prodKey) && Number(x.isDeleted || 0) === 0);
}

async function main() {
  // ADD: 2 + 3 = 5, while the other product is untouched.
  {
    const db = makeDb(); const createOrder = loadCreateOrder(db);
    const response = await call(createOrder, db, { source: 'my-customer', custKey: 317, week: '32-01', year: '2026', orderMode: 'ADD', items: [{ prodKey: 53, qty: 3, unit: '단', expectedCurrentQty: 2 }] });
    assert.equal(response.statusCode, 201, JSON.stringify(response.payload));
    assert.equal(detail(db, 53)[0].OutQuantity, 5);
    assert.equal(response.payload.results.find(x => Number(x.prodKey) === 53).previousQty, 2);
    assert.equal(response.payload.results.find(x => Number(x.prodKey) === 53).finalQty, 5);
  }

  // REPLACE: 2 -> 3 is absolute, not additive; omitted rows remain intact.
  {
    const db = makeDb({ details: [
      { OrderDetailKey: 200, OrderMasterKey: 100, ProdKey: 53, BoxQuantity: 0.2, BunchQuantity: 2, SteamQuantity: 20, OutQuantity: 2, EstQuantity: 200, isDeleted: 0 },
      { OrderDetailKey: 201, OrderMasterKey: 100, ProdKey: 55, BoxQuantity: 7, BunchQuantity: 7, SteamQuantity: 7, OutQuantity: 7, EstQuantity: 7, isDeleted: 0 },
    ] }); const createOrder = loadCreateOrder(db);
    const response = await call(createOrder, db, { source: 'my-customer', custKey: 317, week: '32-01', year: '2026', orderMode: 'REPLACE', items: [{ prodKey: 53, qty: 3, unit: '단', expectedCurrentQty: 2 }] });
    assert.equal(response.statusCode, 201, JSON.stringify(response.payload));
    assert.equal(detail(db, 53)[0].OutQuantity, 3);
    assert.equal(detail(db, 55)[0].OutQuantity, 7, 'omitted product must be preserved');
    assert.equal(response.payload.results.find(x => Number(x.prodKey) === 53).previousQty, 2);
    assert.equal(response.payload.results.find(x => Number(x.prodKey) === 53).finalQty, 3);
  }

  // Explicit zero with a shipment row must reject and roll the whole tx back.
  {
    const initial = makeDb({ shipmentDetails: [{ CustKey: 317, OrderYear: '2026', OrderWeek: '32-01', ProdKey: 53, OutQuantity: 1 }] });
    const before = clone(initial.state); const createOrder = loadCreateOrder(initial);
    const response = await call(createOrder, initial, { source: 'my-customer', custKey: 317, week: '32-01', year: '2026', orderMode: 'REPLACE', items: [{ prodKey: 53, qty: 0, unit: '단', expectedCurrentQty: 2 }] });
    assert.equal(response.statusCode, 400, JSON.stringify(response.payload));
    assert.deepEqual(initial.state, before, 'shipment-protected zero must rollback staged updates');
    assert.equal(initial.committed, false);
  }

  // Explicit zero with no shipment detail soft-deletes only that product.
  {
    const db = makeDb(); const createOrder = loadCreateOrder(db);
    const response = await call(createOrder, db, { source: 'my-customer', custKey: 317, week: '32-01', year: '2026', orderMode: 'REPLACE', items: [{ prodKey: 53, qty: 0, unit: '단', expectedCurrentQty: 2 }] });
    assert.equal(response.statusCode, 201, JSON.stringify(response.payload));
    assert.equal(detail(db, 53).length, 0);
    assert.equal(db.state.details.find(x => x.ProdKey === 53).isDeleted, 1);
    assert.equal(db.state.shipmentDetails.length, 0);
  }

  // Stale expected quantity is an optimistic-concurrency 409 with no commit.
  {
    const db = makeDb(); const before = clone(db.state); const createOrder = loadCreateOrder(db);
    const response = await call(createOrder, db, { source: 'my-customer', custKey: 317, week: '32-01', year: '2026', orderMode: 'REPLACE', items: [{ prodKey: 53, qty: 3, unit: '단', expectedCurrentQty: 99 }] });
    assert.equal(response.statusCode, 409, JSON.stringify(response.payload));
    assert.deepEqual(db.state, before);
    assert.equal(db.committed, false);
  }

  // Duplicate active rows are ambiguous and must not update an arbitrary row.
  {
    const db = makeDb({ details: [
      { OrderDetailKey: 200, OrderMasterKey: 100, ProdKey: 53, OutQuantity: 2, BoxQuantity: 0.2, BunchQuantity: 2, SteamQuantity: 20, isDeleted: 0 },
      { OrderDetailKey: 202, OrderMasterKey: 100, ProdKey: 53, OutQuantity: 3, BoxQuantity: 0.3, BunchQuantity: 3, SteamQuantity: 30, isDeleted: 0 },
    ] }); const before = clone(db.state); const createOrder = loadCreateOrder(db);
    const response = await call(createOrder, db, { source: 'my-customer', custKey: 317, week: '32-01', year: '2026', orderMode: 'REPLACE', items: [{ prodKey: 53, qty: 4, unit: '단', expectedCurrentQty: 5 }] });
    assert.equal(response.statusCode, 409, JSON.stringify(response.payload));
    assert.deepEqual(db.state, before);
  }

  // A missing product after an earlier staged update must rollback everything.
  {
    const db = makeDb(); const before = clone(db.state); const createOrder = loadCreateOrder(db);
    const response = await call(createOrder, db, { source: 'my-customer', custKey: 317, week: '32-01', year: '2026', orderMode: 'REPLACE', items: [{ prodKey: 53, qty: 3, unit: '단', expectedCurrentQty: 2 }, { prodKey: 99999, qty: 1, unit: '단', expectedCurrentQty: 0 }] });
    assert.equal(response.statusCode, 404, JSON.stringify(response.payload));
    assert.deepEqual(db.state, before);
    assert.equal(db.committed, false);
  }

  // Year is a business-key parameter: a prior-year same week must not be reused.
  {
    const db = makeDb({ masters: [
      { OrderMasterKey: 100, OrderYear: '2026', OrderWeek: '32-01', CustKey: 317, isDeleted: 0 },
      { OrderMasterKey: 101, OrderYear: '2025', OrderWeek: '32-01', CustKey: 317, isDeleted: 0 },
    ], details: [
      { OrderDetailKey: 200, OrderMasterKey: 100, ProdKey: 53, OutQuantity: 2, BoxQuantity: 0.2, BunchQuantity: 2, SteamQuantity: 20, isDeleted: 0 },
      { OrderDetailKey: 201, OrderMasterKey: 101, ProdKey: 53, OutQuantity: 700, BoxQuantity: 70, BunchQuantity: 700, SteamQuantity: 7000, isDeleted: 0 },
    ] }); const createOrder = loadCreateOrder(db);
    const response = await call(createOrder, db, { source: 'my-customer', custKey: 317, week: '32-01', year: '2026', orderMode: 'ADD', items: [{ prodKey: 53, qty: 3, unit: '단', expectedCurrentQty: 2 }] });
    assert.equal(response.statusCode, 201, JSON.stringify(response.payload));
    assert.equal(detail(db, 53, '2025')[0].OutQuantity, 700, 'prior-year order must be preserved and excluded');
    assert.equal(detail(db, 53, '2026')[0].OutQuantity, 5);
    const omSelect = db.queries.find(q => /FROM OrderMaster WITH/i.test(q.sql));
    assert.equal(omSelect.params.year, '2026');
    assert.equal(omSelect.params.wk, '32-01');
  }

  // Product.EstUnit is used for REPLACE's EstQuantity conversion (OutUnit is
  // the display/order unit).  The fixture also acts as a safety net against
  // accidental ShipmentDetail/Estimate writes.
  {
    const db = makeDb(); const createOrder = loadCreateOrder(db);
    const response = await call(createOrder, db, { source: 'my-customer', custKey: 317, week: '32-01', year: '2026', orderMode: 'REPLACE', items: [{ prodKey: 53, qty: 3, unit: '단', expectedCurrentQty: 2 }] });
    assert.equal(response.statusCode, 201, JSON.stringify(response.payload));
    const row = db.state.details.find(x => x.ProdKey === 53);
    assert.equal(row.OutQuantity, 3);
    assert.equal(row.EstQuantity, 30, '3단 with EstUnit=송이 must persist 30, not OutUnit=단 quantity 3');
    assert.equal(db.queries.filter(q => /usp_StockCalculation/i.test(q.sql)).length, 0, 'REPLACE must skip stock recalculation');
    assert.ok(!db.writes.some(w => /ShipmentMaster|ShipmentDetail|ShipmentDate|ShipmentFarm|Estimate|WebProfitReport/i.test(w.sql)));
  }

  // Fractional bunch input follows the same EstUnit conversion (0.5단 =
  // 5송이 with this product master), including values that are easy to lose
  // through integer/rounding helpers.
  {
    const db = makeDb(); const createOrder = loadCreateOrder(db);
    const response = await call(createOrder, db, { source: 'my-customer', custKey: 317, week: '32-01', year: '2026', orderMode: 'REPLACE', items: [{ prodKey: 53, qty: 0.5, unit: '단', expectedCurrentQty: 2 }] });
    assert.equal(response.statusCode, 201, JSON.stringify(response.payload));
    assert.equal(db.state.details.find(x => x.ProdKey === 53).EstQuantity, 5);
  }

  console.log('my customer order API integration tests passed');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
