/*
 * Executable integration harness for Dutch volume replacement.
 *
 * This script never loads .env files. It accepts only the named, unmounted
 * localhost MSSQL 2022 test container and creates/drops one random database
 * under the exact NenovaEstimateFixture_dutch_<12 hex> prefix. DB_* is set to
 * that database only after all container and database-name guards pass.
 */
'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { register } = require('node:module');
const { pathToFileURL } = require('node:url');
const sql = require('mssql');

const ROOT = path.resolve(__dirname, '..');
const CONTAINER = 'nenova-estimate-sql-test-20260826';
const HOST = '127.0.0.1';
const PORT = 14339;
const DB_NAME = `NenovaEstimateFixture_dutch_${crypto.randomBytes(6).toString('hex')}`;
const USER = { userId: 'dutch-fixture', userName: 'Dutch Fixture' };

/* Node's native ESM resolver requires explicit file extensions while this
 * app's source imports omit .js. Add only a workspace-relative .js fallback;
 * do not rewrite app modules or add a test-only copy of the feature logic.
 */
register(pathToFileURL(path.join(ROOT, '__tests__/fixtures/dutchVolumeLoaderHook.mjs')).href);
const originalRequestQuery = sql.Request.prototype.query;
sql.Request.prototype.query = function fixtureQueryWithErrorSql(...args) {
  const result = originalRequestQuery.apply(this, args);
  if (result && typeof result.catch === 'function') {
    return result.catch((error) => {
      console.error('[fixture sql failed]', String(args[0]).replace(/\s+/g, ' ').trim());
      throw error;
    });
  }
  return result;
};
const BASE_FIXTURES = [
  '__tests__/fixtures/estimateDirectionalSchema.sql',
  '__tests__/fixtures/estimateOverflowSchema.sql',
  '__tests__/fixtures/dutchVolumeDistributionSeed.sql',
];
const SNAPSHOT_MIGRATION = 'docs/migrations/2026-08-31_shipment_import_snapshot_rollback.sql';
const SNAPSHOT_TABLES = [
  'OrderMaster', 'OrderDetail', 'ShipmentMaster', 'ShipmentDetail', 'ShipmentDate',
  'ShipmentFarm', 'ShipmentImportAudit', 'ShipmentImportAuditRow', 'ShipmentImportSnapshot', 'PeriodDay',
  'Estimate', 'WebProfitReport', 'Product', 'CustomerProdCost', 'ProductStock', 'StockHistory',
  'ShipmentHistory', 'OrderHistory', 'KeyNumbering', 'WarehouseMaster', 'WarehouseDetail', 'SystemActionLog',
];

function fail(message) { throw new Error(`[dutch-volume-sql-fixture] ${message}`); }
function splitBatches(text) {
  return text.split(/^\s*GO\s*;?\s*$/gim).map((batch) => batch.trim()).filter(Boolean);
}
function assertFixtureDbName(name) {
  if (!/^NenovaEstimateFixture_dutch_[0-9a-f]{12}$/.test(name)) fail('database name guard failed');
}
function quoteFixtureDb(name) {
  assertFixtureDbName(name);
  return `[${name.replace(/]/g, ']]')}]`;
}
function inspectFixture() {
  const result = spawnSync('docker', ['inspect', CONTAINER], { encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) fail('approved local SQL fixture container is not inspectable');
  const info = JSON.parse(result.stdout)[0];
  if (!info?.State?.Running || info.Name !== `/${CONTAINER}`) fail('fixture container identity/running guard failed');
  if (!/^mcr\.microsoft\.com\/mssql\/server:2022(?:-|$)/i.test(String(info.Config?.Image || ''))) fail('fixture image guard failed');
  if ((info.Mounts || []).length || (info.HostConfig?.Binds || []).length) fail('mounted SQL fixture is not allowed');
  const bindings = info.HostConfig?.PortBindings?.['1433/tcp'] || [];
  if (!bindings.some((binding) => binding.HostIp === HOST && Number(binding.HostPort) === PORT)) fail('loopback fixture port guard failed');
  const passwordEntry = (info.Config?.Env || []).find((value) => String(value).startsWith('MSSQL_SA_PASSWORD='));
  if (!passwordEntry || !passwordEntry.slice('MSSQL_SA_PASSWORD='.length)) fail('fixture-only SA password is absent');
  return { password: passwordEntry.slice('MSSQL_SA_PASSWORD='.length) };
}
function query(executor, statement, params = {}) {
  const request = new sql.Request(executor);
  for (const [name, spec] of Object.entries(params)) request.input(name, spec.type, spec.value);
  return request.query(statement);
}
function readFixture(relativePath) {
  const absolutePath = path.resolve(ROOT, relativePath);
  if (!absolutePath.startsWith(`${ROOT}${path.sep}`)) fail('fixture path escaped repository root');
  return fs.readFileSync(absolutePath, 'utf8');
}
async function installFixture(pool) {
  for (const relativePath of BASE_FIXTURES) {
    for (const batch of splitBatches(readFixture(relativePath))) await query(pool, batch);
  }
  await query(pool, `
    INSERT dbo.KeyNumbering(Category,LastKeyNo,Descr)
      VALUES (N'ShipmentDetailKey',64003,N'Dutch fixture'),
             (N'OrderMasterKey',44002,N'Dutch fixture'),
             (N'OrderDetailKey',44002,N'Dutch fixture');
  `);
}
async function snapshot(pool) {
  const result = {};
  for (const table of SNAPSHOT_TABLES) {
    const exists = await query(pool, `SELECT OBJECT_ID(N'dbo.${table}',N'U') AS TableId`);
    if (!exists.recordset[0].TableId) continue;
    result[table] = (await query(pool, `SELECT * FROM dbo.[${table}] ORDER BY 1`)).recordset;
  }
  return result;
}
async function assertNativeReadJoins(pool) {
  const joined = await query(pool, `
    SELECT COUNT(*) AS JoinedRows
      FROM dbo.ViewOrder vo
      JOIN dbo.ViewShipment vs
        ON vs.OrderYear=vo.OrderYear AND vs.OrderWeek=vo.OrderWeek
       AND vs.CustKey=vo.CustKey AND vs.ProdKey=vo.ProdKey
      JOIN dbo.ShipmentDate sdt ON sdt.SdetailKey=vs.SdetailKey
      JOIN dbo.PeriodDay pd ON sdt.ShipmentDtm=pd.BaseYmd
                           AND pd.OrderYearWeek=vo.OrderYear+LEFT(vo.OrderWeek,2)
     WHERE vo.OrderYear=N'2026' AND vo.OrderWeek=N'40-01'
       AND vo.CustKey=533 AND vo.ProdKey=2231 AND vs.DetailFix=0;
  `);
  assert.equal(Number(joined.recordset[0].JoinedRows), 1, 'fixture must exercise native year/week/customer/product + quote/date join');
}
function businessLedgers(state) {
  const omit = new Set(['ShipmentImportAudit', 'ShipmentImportAuditRow', 'PeriodDay']);
  return Object.fromEntries(Object.entries(state).filter(([table]) => !omit.has(table)));
}
function makeBody(entries) { return { year: '2026', week: '40-01', entries }; }
function makeEntry(id, customer, custKey, product, prodKey, quantity, unit, unitPrice, color = '') {
  return {
    id, product, color, customer, quantity, unit, custKey, prodKey,
    ...(unitPrice === undefined ? {} : { unitPrice }),
  };
}
async function preview(app, body, trace = false) {
  if (!trace) return app.previewDutchVolume(body, USER);
  const withTransaction = (callback) => app.withTransaction(async (tQ, metadata) => {
    const tracedQuery = async (statement, params) => {
      const label = String(statement).replace(/\s+/g, ' ').trim().slice(0, 90);
      console.log(`[fixture sql] start ${label}`);
      const result = await tQ(statement, params);
      console.log(`[fixture sql] done ${label}`);
      return result;
    };
    return callback(tracedQuery, metadata);
  });
  const buildPreview = async (options) => {
    console.log('[fixture] buildImportPreview start');
    const result = await app.buildImportPreview(options);
    console.log('[fixture] buildImportPreview done');
    return result;
  };
  return app.previewDutchVolume(body, USER, { withTransaction, buildPreview });
}
async function apply(app, plan) {
  assert(plan?.planToken, `expected an applicable plan, blockers=${JSON.stringify(plan?.blockers || [])}`);
  return app.applyDutchVolume({ planToken: plan.planToken, jobId: crypto.randomUUID(), ackQtyWarnings: true }, USER);
}

async function runScenarios(app) {
  /*
   * The service calls below intentionally use exported API-level helpers, not a
   * source-string assertion or a test-only SQL reimplementation. This checks the
   * same preview/plan/apply and read-back core the web endpoints use.
   */
  const previewDutchVolume = app.previewDutchVolume;
  const applyDutchVolume = app.applyDutchVolume;
  if (typeof previewDutchVolume !== 'function' || typeof applyDutchVolume !== 'function') {
    fail('Dutch preview/apply service helpers are not exported for executable integration testing');
  }

  // Exercise the real SQL Product query and API preview without caller-supplied
  // ERP keys: species plus exporter color must resolve one actual Dutch item,
  // while duplicate exact aliases remain unmatched and cannot create a plan.
  const actualNamePreview = await preview(app, makeBody([
    makeEntry('actual-exporter-lily', 'Dutch existing-order', null, '백합', null, 1, '송이', undefined, 'la Nubia'),
    makeEntry('ambiguous-hydrangea-color', 'Dutch existing-order', null, '수국', null, 1, '송이', undefined, 'RoyalPalaceOldPinkGreen 60cm-18cm'),
  ]));
  const matchedActualName = actualNamePreview.entryMatches.find(row => row.id === 'actual-exporter-lily');
  assert.equal(matchedActualName?.status, 'matched', 'species plus exporter label must match through SQL Product rows without explicit prodKey');
  assert.equal(Number(matchedActualName?.prodKey), 2236, 'Lily exporter item must resolve to its actual Dutch ERP Product');
  const ambiguousActualName = actualNamePreview.entryMatches.find(row => row.id === 'ambiguous-hydrangea-color');
  assert.equal(ambiguousActualName?.status, 'unmatched', 'duplicate actual Dutch item aliases must remain unmatched');
  assert.equal(actualNamePreview.planToken, null, 'an ambiguous actual-name match must prevent any apply plan');
  assert((actualNamePreview.blockers || []).some(value => /미매칭|연결/.test(value)), 'ambiguous item must be an explicit preview blocker');

  const alstroBlankUnitPreview = await preview(app, makeBody([
    makeEntry('actual-alstro-blank-unit', 'Dutch existing-order', null, '알스트로', null, 1, '', undefined, 'ALSTROMERIA Lavender'),
  ]));
  assert.equal(alstroBlankUnitPreview.entryMatches.find(row => row.id === 'actual-alstro-blank-unit')?.status, 'matched', 'Alstro item should resolve from real SQL Product fields');
  assert((alstroBlankUnitPreview.blockers || []).some(value => /단위를 직접 선택/.test(value)), 'positive Alstro volume with blank unit must be blocked');
  assert.equal(alstroBlankUnitPreview.planToken, null, 'positive Alstro volume with blank unit must not receive a plan token');
  const alstroExplicitUnitPreview = await preview(app, makeBody([
    makeEntry('actual-alstro-explicit-unit', 'Dutch existing-order', null, '알스트로', null, 1, '단', undefined, 'ALSTROMERIA Lavender'),
  ]));
  assert.equal(alstroExplicitUnitPreview.entryMatches.find(row => row.id === 'actual-alstro-explicit-unit')?.status, 'matched', 'explicit-unit Alstro row should resolve through real SQL Product fields');
  assert(!(alstroExplicitUnitPreview.blockers || []).some(value => /단위를 직접 선택/.test(value)), 'explicit Alstro OutUnit must clear the blank-unit blocker');

  const requestBody = makeBody([
    makeEntry('existing-blank', 'Dutch existing-order', 533, 'Dutch Test Rose Red', 2231, 60, '송이'),
    makeEntry('new-order-zero-price', 'Dutch new-order', 534, 'Dutch Test Rose White', 2232, 5, '단', 0),
    makeEntry('fractional-multi-date', 'Dutch new-order', 534, 'Dutch Fractional Date Product', 2235, 1, '단'),
  ]);
  const before = await snapshot(app.pool);
  console.log('[fixture] baseline snapshot captured; requesting preview');
  const initialPlan = await preview(app, requestBody, true);
  console.log('[fixture] initial preview returned');
  assert.equal(initialPlan.scopeMode, 'CATEGORY_REPLACE');
  assert.equal(initialPlan.sourceMode, 'DUTCH_VOLUME_KRW');
  const omitted = initialPlan.rows.find((row) => Number(row.custKey) === 534 && Number(row.prodKey) === 2233);
  assert(omitted, 'category replacement must include a shipment-only row missing from upload');
  assert.equal(Number(omitted.currentOutQty), 50);
  assert.equal(Number(omitted.uploadQty), 0, 'omitted shipment row must be explicit final zero');
  assert.equal(initialPlan.rows.find((row) => row.entryIds?.includes('new-order-zero-price'))?.unitPrice, 0);
  assert(initialPlan.planToken, 'eligible preview must issue a server plan token');

  const applied = await apply(app, initialPlan);
  console.log('[fixture] initial apply returned');
  assert.equal(applied.success, true, `apply must succeed: ${applied.error || JSON.stringify(applied.verification || {})}`);
  const after = await snapshot(app.pool);
  const orders = after.OrderDetail;
  assert.equal(Number(orders.find((row) => row.OrderDetailKey === 44001).OrderQuantity), 77, 'existing positive order must be preserved');
  const newOrderMaster = after.OrderMaster.find((row) => String(row.OrderYear) === '2026' && row.OrderWeek === '40-01' && Number(row.CustKey) === 534 && !row.isDeleted);
  assert(newOrderMaster, 'new current-year order master must be created for the target customer');
  const newOrderDetail = orders.find((row) => row.OrderMasterKey === newOrderMaster.OrderMasterKey && Number(row.ProdKey) === 2232 && !row.isDeleted);
  assert.equal(Number(newOrderDetail?.OutQuantity), 5, 'new positive order detail must be created under the correct year/week/customer master');
  assert.equal(orders.filter((row) => Number(row.ProdKey) === 2233).length, 0, 'zero replacement must not create a fake zero order');
  const current = after.ShipmentDetail.find((row) => row.SdetailKey === 64001);
  assert.equal(Number(current.OutQuantity), 60);
  assert.equal(Number(current.Cost), 2100, 'blank/missing KRW price must preserve the prior cost');
  assert.equal(current.CustKey, null, 'native NULL ShipmentDetail.CustKey must not be repaired');
  const zeroPrice = after.ShipmentDetail.find((row) => Number(row.ProdKey) === 2232);
  assert.equal(Number(zeroPrice.Cost), 0, 'explicit KRW zero must be persisted');
  assert.equal(Number(zeroPrice.EstQuantity), 50, 'EstUnit conversion must be retained when OutUnit differs');
  assert.equal(Number(after.ShipmentDetail.find(row => row.SdetailKey === 64004)?.OutQuantity), 13, 'other-category shipment sentinel must survive category replacement');
  assert(!after.ShipmentDetail.some((row) => row.SdetailKey === 64003), 'missing category row must be purged to final SET zero');
  assert(!after.ShipmentDate.some((row) => row.SdetailKey === 64003), 'zeroed row dates must be removed');
  assert(!after.ShipmentFarm.some((row) => row.SdetailKey === 64003), 'zeroed row farm allocations must be removed');
  assert.deepEqual(after.OrderDetail.find((row) => row.OrderDetailKey === 44002), before.OrderDetail.find((row) => row.OrderDetailKey === 44002), 'prior-year same-week order sentinel must remain unchanged');
  assert.deepEqual(after.ShipmentDetail.find((row) => row.SdetailKey === 64002), before.ShipmentDetail.find((row) => row.SdetailKey === 64002), 'prior-year same-week shipment sentinel must remain unchanged');
  for (const table of ['Estimate', 'WebProfitReport', 'ProductStock', 'StockHistory', 'WarehouseMaster', 'WarehouseDetail']) {
    assert.deepEqual(after[table], before[table], `${table} downstream/unrelated ledger must be preserved`);
  }
  await assertNativeReadJoins(app.pool);

  // Cost-only write changes the detail/date money while keeping shipment qty,
  // shipment date, farm allocation, confirmation and downstream ledgers intact.
  const beforePriceOnly = await snapshot(app.pool);
  const dateBeforePriceOnly = beforePriceOnly.ShipmentDate.filter(row => Number(row.SdetailKey) === 64001);
  const priceOnly = await preview(app, makeBody([
    makeEntry('existing-cost-only', 'Dutch existing-order', 533, 'Dutch Test Rose Red', 2231, 60, '송이', 2500),
    makeEntry('new-existing-no-override', 'Dutch new-order', 534, 'Dutch Test Rose White', 2232, 5, '단'),
    makeEntry('fractional-price-only', 'Dutch new-order', 534, 'Dutch Fractional Date Product', 2235, 1, '단', 1200),
  ]));
  console.log('[fixture] price-only preview returned');
  assert.equal(priceOnly.rows.find(row => row.entryIds?.includes('existing-cost-only'))?.unitPrice, 2500);
  await apply(app, priceOnly);
  console.log('[fixture] price-only apply returned');
  const afterPriceOnly = await snapshot(app.pool);
  const detailAfterPriceOnly = afterPriceOnly.ShipmentDetail.find(row => row.SdetailKey === 64001);
  assert.equal(Number(detailAfterPriceOnly.OutQuantity), 60);
  assert.equal(detailAfterPriceOnly.ShipmentDtm.getTime(), beforePriceOnly.ShipmentDetail.find(row => row.SdetailKey === 64001).ShipmentDtm.getTime());
  assert.equal(Number(detailAfterPriceOnly.Cost), 2500);
  assert.equal(Number(detailAfterPriceOnly.Amount), Math.round(2500 * 60 / 1.1));
  assert.equal(Number(detailAfterPriceOnly.Vat), 2500 * 60 - Math.round(2500 * 60 / 1.1));
  const fractionalAfterPriceOnly = afterPriceOnly.ShipmentDetail.find(row => row.SdetailKey === 64005);
  const fractionalBeforePriceOnly = beforePriceOnly.ShipmentDetail.find(row => row.SdetailKey === 64005);
  assert.equal(Number(fractionalAfterPriceOnly.OutQuantity), Number(fractionalBeforePriceOnly.OutQuantity), 'price-only update must preserve fractional multi-date aggregate quantity');
  assert.equal(Number(fractionalAfterPriceOnly.EstQuantity), Number(fractionalBeforePriceOnly.EstQuantity), 'price-only update must preserve fractional product EstQuantity');
  assert.equal(Number(fractionalAfterPriceOnly.Cost), 1200);
  assert.deepEqual(afterPriceOnly.ShipmentDate.filter(row => Number(row.SdetailKey) === 64005).map(row => ({
    dt: row.ShipmentDtm.getTime(), qty: Number(row.ShipmentQuantity), est: Number(row.EstQuantity),
  })), beforePriceOnly.ShipmentDate.filter(row => Number(row.SdetailKey) === 64005).map(row => ({
    dt: row.ShipmentDtm.getTime(), qty: Number(row.ShipmentQuantity), est: Number(row.EstQuantity),
  })), 'price-only save must preserve every fractional date row and its independent estimate quantity');
  assert.deepEqual(afterPriceOnly.ShipmentDate.filter(row => Number(row.SdetailKey) === 64001).map(row => ({
    dt: row.ShipmentDtm.getTime(), qty: Number(row.ShipmentQuantity), est: Number(row.EstQuantity),
  })), dateBeforePriceOnly.map(row => ({
    dt: row.ShipmentDtm.getTime(), qty: Number(row.ShipmentQuantity), est: Number(row.EstQuantity),
  })), 'price-only update must preserve date and quantity columns');
  for (const table of ['Estimate', 'WebProfitReport', 'ProductStock', 'StockHistory', 'WarehouseMaster', 'WarehouseDetail']) {
    assert.deepEqual(afterPriceOnly[table], beforePriceOnly[table], `${table} remains unchanged after price-only save`);
  }

  // Farm allocations make shipment quantity changes unsafe, while price-only
  // edits remain covered by the preceding multi-date scenario.
  await query(app.pool, `INSERT dbo.ShipmentFarm(FarmKey,SdetailKey,ShipmentQuantity) VALUES(1,64001,10)`);
  const farmBlocked = await preview(app, makeBody([
    makeEntry('farm-assigned-change', 'Dutch existing-order', 533, 'Dutch Test Rose Red', 2231, 61, '송이', 2500),
    makeEntry('farm-preserve-new', 'Dutch new-order', 534, 'Dutch Test Rose White', 2232, 5, '단'),
    makeEntry('farm-preserve-fractional', 'Dutch new-order', 534, 'Dutch Fractional Date Product', 2235, 1, '단'),
  ]));
  assert.equal(farmBlocked.planToken, null, 'farm-assigned positive quantity change must not receive an apply token');
  assert((farmBlocked.blockers || []).some(value => /농장|farm/i.test(value)), 'farm quantity-change blocker must be explicit');
  await query(app.pool, `DELETE dbo.ShipmentFarm WHERE SdetailKey=64001`);

  // Exact native EXE date visibility is part of commit. A one-second calendar
  // mismatch is tampered after preview and must roll back business ledgers.
  const calendarPlan = await preview(app, makeBody([
    makeEntry('calendar-check', 'Dutch existing-order', 533, 'Dutch Test Rose Red', 2231, 60, '송이', 2600),
    makeEntry('calendar-check-new', 'Dutch new-order', 534, 'Dutch Test Rose White', 2232, 5, '단'),
    makeEntry('calendar-check-fractional', 'Dutch new-order', 534, 'Dutch Fractional Date Product', 2235, 1, '단'),
  ]));
  const beforeCalendarApply = businessLedgers(await snapshot(app.pool));
  const priorPeriodDay = (await query(app.pool, `SELECT BaseYmd FROM dbo.PeriodDay WHERE OrderYearWeek=N'202640' AND WeekDay=4`)).recordset[0].BaseYmd;
  await query(app.pool, `UPDATE dbo.PeriodDay SET BaseYmd=DATEADD(second,1,BaseYmd) WHERE OrderYearWeek=N'202640' AND WeekDay=4`);
  await assert.rejects(() => apply(app, calendarPlan), /전산|달력|PeriodDay|연결|visibility/i, 'exact PeriodDay datetime mismatch must fail before commit');
  assert.deepEqual(businessLedgers(await snapshot(app.pool)), beforeCalendarApply, 'calendar mismatch must roll back all business ledgers and snapshots');
  await query(app.pool, `UPDATE dbo.PeriodDay SET BaseYmd=@prior WHERE OrderYearWeek=N'202640' AND WeekDay=4`, { prior: { type: sql.DateTime, value: priorPeriodDay } });

  // Staleness is detected by the server snapshot, not by trusting the client plan.
  const stalePlan = await preview(app, makeBody([
    makeEntry('stale-plan', 'Dutch existing-order', 533, 'Dutch Test Rose Red', 2231, 61, '송이', 2400),
    makeEntry('stale-plan-fractional', 'Dutch new-order', 534, 'Dutch Fractional Date Product', 2235, 1, '단'),
  ]));
  await query(app.pool, `UPDATE dbo.ShipmentDetail SET Descr=N'external fixture mutation' WHERE SdetailKey=64001`);
  const beforeStaleApply = businessLedgers(await snapshot(app.pool));
  await assert.rejects(() => apply(app, stalePlan), /미리보기|변경|다시|계획/i, 'stale preview must be blocked');
  assert.deepEqual(businessLedgers(await snapshot(app.pool)), beforeStaleApply, 'stale plan cannot mutate ERP ledgers');
  await query(app.pool, `UPDATE dbo.ShipmentDetail SET Descr=N'native-null-customer-preserve' WHERE SdetailKey=64001`);

  // A single fixed detail blocks the whole replacement plan.
  await query(app.pool, `UPDATE dbo.ShipmentDetail SET isFix=1 WHERE SdetailKey=64001`);
  const fixedPlan = await preview(app, requestBody);
  assert.equal(fixedPlan.planToken, null, 'fixed target must not issue an apply token');
  assert((fixedPlan.blockers || []).some(value => /확정/.test(value)), 'fixed blocker must be explicit');
  await query(app.pool, `UPDATE dbo.ShipmentDetail SET isFix=0 WHERE SdetailKey=64001`);

  // Duplicate business keys are not resolved with TOP 1 or silently merged.
  await query(app.pool, `
    INSERT dbo.ShipmentDetail(SdetailKey,ShipmentKey,CustKey,ProdKey,OutQuantity,EstQuantity,EstQuantity2,
      BoxQuantity,BunchQuantity,SteamQuantity,Cost,Amount,Vat,Descr,ShipmentDtm,isFix,EstDescr)
    VALUES(64999,54001,NULL,2231,1,1,1,0,0,0,2100,1909,191,N'duplicate fixture','2026-10-02',0,N'');
  `);
  await assert.rejects(() => preview(app, requestBody), /중복|duplicate/i, 'duplicate order/shipment pair must be rejected');

  // Failure on the second product after the first row entered the write path
  // must roll back quantities, costs, dates and snapshots for the entire batch.
  await query(app.pool, `DELETE dbo.ShipmentDetail WHERE SdetailKey=64999`);
  const rollbackPlan = await preview(app, makeBody([
    makeEntry('rollback-first', 'Dutch existing-order', 533, 'Dutch Test Rose Red', 2231, 62, '송이', 2600),
    makeEntry('rollback-second', 'Dutch new-order', 534, 'Dutch Test Rose White', 2232, 6, '단', 1900),
  ]));
  const beforeRollback = businessLedgers(await snapshot(app.pool));
  await query(app.pool, `
    CREATE TRIGGER dbo.TR_DutchFixtureFailSecondRow ON dbo.ShipmentDetail AFTER UPDATE AS
    IF EXISTS(SELECT 1 FROM inserted WHERE ProdKey=2232)
      THROW 51001,'forced Dutch second-row failure',1;
  `);
  await assert.rejects(() => apply(app, rollbackPlan), /second-row|forced|51001/i);
  await query(app.pool, `DROP TRIGGER dbo.TR_DutchFixtureFailSecondRow`);
  assert.deepEqual(businessLedgers(await snapshot(app.pool)), beforeRollback, 'later-row failure must roll back every business ledger and snapshot');

  console.log('PASS Dutch volume SQL: existing-order preservation, positive order creation, CATEGORY_REPLACE missing→0 with other-category sentinel, blank/0/KRW prices, fractional multi-date price-only preservation, farm quantity blocker, exact PeriodDay rollback, EstUnit conversion, cross-year isolation, fixed/stale/duplicate blockers, atomic later-row rollback, native NULL and downstream preservation');
}

async function main() {
  let master;
  let fixturePool;
  let applicationPool;
  try {
    const { password } = inspectFixture();
    assertFixtureDbName(DB_NAME);
    const baseConfig = {
      server: HOST, port: PORT, user: 'sa', password,
      requestTimeout: 60000,
      options: { encrypt: false, trustServerCertificate: true },
    };
    master = await new sql.ConnectionPool({ ...baseConfig, database: 'master' }).connect();
    await query(master, `CREATE DATABASE ${quoteFixtureDb(DB_NAME)}`);
    console.log(`[fixture] created ${DB_NAME}`);
    fixturePool = await new sql.ConnectionPool({ ...baseConfig, database: DB_NAME }).connect();
    await installFixture(fixturePool);
    console.log('[fixture] schema and seed installed');

    // The app DB module captures these values at import time. No dotenv/config
    // package is loaded, and every field points only at our newly-created DB.
    process.env.DB_SERVER = HOST;
    process.env.DB_PORT = String(PORT);
    process.env.DB_NAME = DB_NAME;
    process.env.DB_USER = 'sa';
    process.env.DB_PASSWORD = password;
    assertFixtureDbName(process.env.DB_NAME);
    if (process.env.DB_SERVER !== HOST || Number(process.env.DB_PORT) !== PORT) fail('application database target guard failed');

    const audit = await import('../lib/shipmentImportAudit.js');
    await audit.createShipmentImportAuditBatch({ orderYear: '2026', week: '40-01', rows: [], user: USER, sourceFileName: 'fixture-schema-bootstrap' });
    for (const batch of splitBatches(readFixture(SNAPSHOT_MIGRATION))) await query(fixturePool, batch);
    console.log('[fixture] audit/snapshot schema installed');

    const app = await import('../pages/api/shipment/dutch-volume-preview.js');
    console.log('[fixture] preview module imported');
    const apply = await import('../pages/api/shipment/dutch-volume-apply.js');
    const { getPool } = await import('../lib/db.js');
    const db = await import('../lib/db.js');
    const importCore = await import('../lib/shipmentImport.js');
    applicationPool = await getPool();
    console.log('[fixture] isolated app pool connected');
    await runScenarios({
      previewDutchVolume: app.previewDutchVolume,
      applyDutchVolume: apply.applyDutchVolume,
      withTransaction: db.withTransaction,
      buildImportPreview: importCore.buildImportPreview,
      pool: applicationPool,
    });
  } finally {
    if (applicationPool) await applicationPool.close().catch(() => {});
    if (fixturePool) await fixturePool.close().catch(() => {});
    if (master) {
      assertFixtureDbName(DB_NAME);
      await query(master, `IF DB_ID(N'${DB_NAME}') IS NOT NULL BEGIN ALTER DATABASE ${quoteFixtureDb(DB_NAME)} SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE ${quoteFixtureDb(DB_NAME)}; END`);
      await master.close();
    }
  }
}

main().then(() => {
  process.exit(0);
}).catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});
