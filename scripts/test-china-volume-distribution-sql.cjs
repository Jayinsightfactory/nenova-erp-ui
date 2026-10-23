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
  if (!trace) return app.previewChinaVolume(body, USER);
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
  return app.previewChinaVolume(body, USER, { withTransaction, buildPreview });
}
async function apply(app, plan) {
  assert(plan?.planToken, `expected an applicable plan, blockers=${JSON.stringify(plan?.blockers || [])}`);
  return app.applyChinaVolume({ planToken: plan.planToken, jobId: crypto.randomUUID(), ackQtyWarnings: true }, USER);
}

async function runScenarios(app) {
  // Convert only this disposable seed, never production. Keep another category
  // and same-category omitted rows to prove explicit-pair semantics.
  await query(app.pool, `INSERT Country(CounName) VALUES(N'중국'); UPDATE OrderDetail SET SteamQuantity=OutQuantity WHERE ProdKey=2231; UPDATE Product SET CounName=N'중국',CountryFlower=N'중국장미' WHERE ProdKey BETWEEN 2231 AND 2239;`);
  const entry=(id,ck,pk,qty,unit='송이')=>makeEntry(id,ck===533?'Dutch existing-order':'Dutch new-order',ck,pk===2231?'Dutch Test Rose Red':'Dutch Test Rose White',pk,qty,unit);
  const before=await snapshot(app.pool);
  const baselineOrder=before.OrderDetail.find(r=>r.OrderDetailKey===44001);
  const verifyPreserved=async()=>{
    const after=await snapshot(app.pool);
    assert.deepEqual(after.OrderDetail.find(r=>r.OrderDetailKey===44001),baselineOrder,'all original order columns unchanged');
    assert.deepEqual(after.OrderDetail.find(r=>r.OrderDetailKey===44002),before.OrderDetail.find(r=>r.OrderDetailKey===44002),'2025 order unchanged');
    assert.deepEqual(after.ShipmentDetail.find(r=>r.SdetailKey===64002),before.ShipmentDetail.find(r=>r.SdetailKey===64002),'2025 shipment unchanged');
    for(const id of [64003,64004,64005]) assert.deepEqual(after.ShipmentDetail.find(r=>r.SdetailKey===id),before.ShipmentDetail.find(r=>r.SdetailKey===id),'omitted pairs unchanged');
    for(const table of ['Estimate','WebProfitReport','ProductStock','StockHistory','WarehouseMaster','WarehouseDetail']) assert.deepEqual(after[table],before[table],table+' unchanged');
    return after;
  };
  for(const qty of [60,20,0,12]) {
    const plan=await preview(app,makeBody([entry('existing',533,2231,qty)]));
    assert.equal(plan.rows.length,1,'no category zero synthesis');
    assert.equal(plan.rows[0].orderAfterQty,77);
    assert.equal((await apply(app,plan)).success,true);
    const after=await verifyPreserved();
    assert.equal(Number(after.ShipmentDetail.find(r=>r.ShipmentKey===54001&&r.ProdKey===2231)?.OutQuantity||0),qty);
    console.log('PASS existing order unchanged at shipment SET '+qty);
  }
  const fresh=await preview(app,makeBody([entry('new',534,2232,5,'단')]));
  assert.equal((await apply(app,fresh)).success,true);
  let after=await verifyPreserved();
  const added=after.OrderDetail.find(r=>r.OrderMasterKey===44003&&r.ProdKey===2232);
  assert.equal(Number(added.OutQuantity),5);
  assert.equal(Number(after.ShipmentDetail.find(r=>r.ShipmentKey===54003&&r.ProdKey===2232).EstQuantity),50);
  const zero=await preview(app,makeBody([entry('zero-new-existing',534,2232,0,'단')]));
  assert.equal((await apply(app,zero)).success,true);
  after=await verifyPreserved();
  assert.deepEqual(after.OrderDetail.find(r=>r.OrderDetailKey===added.OrderDetailKey),added);
  const absentZero=await preview(app,makeBody([entry('zero-absent',533,2232,0,'단')]));
  assert.equal(absentZero.planToken,null,'zero absent has no change and creates no order');
  await assert.rejects(()=>preview(app,{...makeBody([entry('missing-year',533,2231,10)]),year:null}),/연도|year/i);
  await query(app.pool,`UPDATE ShipmentDetail SET isFix=1 WHERE ShipmentKey=54001 AND ProdKey=2231`);
  const fixed=await preview(app,makeBody([entry('fixed',533,2231,10)]));
  assert.equal(fixed.planToken,null);
  assert.ok(fixed.blockers.some(message=>message.includes('ERP 확정 출고 1건')));
  await query(app.pool,`UPDATE ShipmentDetail SET isFix=0 WHERE ShipmentKey=54001 AND ProdKey=2231`);
  const stale=await preview(app,makeBody([entry('stale',533,2231,13)]));
  await query(app.pool,`UPDATE ShipmentDetail SET Descr=N'fixture external edit' WHERE ShipmentKey=54001 AND ProdKey=2231`);
  const beforeStale=businessLedgers(await snapshot(app.pool));
  await assert.rejects(()=>apply(app,stale),/미리보기|변경/);
  assert.deepEqual(businessLedgers(await snapshot(app.pool)),beforeStale);
  const rollback=await preview(app,makeBody([entry('first',533,2231,14),entry('second',534,2232,6,'단')]));
  const beforeRollback=businessLedgers(await snapshot(app.pool));
  await query(app.pool,`CREATE TRIGGER TR_ChinaFailSecond ON ShipmentDetail AFTER INSERT,UPDATE AS IF EXISTS(SELECT 1 FROM inserted WHERE ProdKey=2232) THROW 51001,'forced China second-row failure',1;`);
  await assert.rejects(()=>apply(app,rollback),/forced|second-row/);
  await query(app.pool,`DROP TRIGGER TR_ChinaFailSecond`);
  assert.deepEqual(businessLedgers(await snapshot(app.pool)),beforeRollback);
  // A trigger mutating an existing order must also roll back, even when final
  // shipment quantities still match. This is the explicit preservation guard.
  const corrupt=await preview(app,makeBody([entry('trigger-order',533,2231,14)]));
  const beforeCorrupt=businessLedgers(await snapshot(app.pool));
  await query(app.pool,`CREATE TRIGGER TR_ChinaCorruptOrder ON ShipmentDetail AFTER INSERT,UPDATE AS UPDATE OrderDetail SET OrderQuantity=1 WHERE OrderDetailKey=44001;`);
  await assert.rejects(()=>apply(app,corrupt),/기존 주문|주문/);
  await query(app.pool,`DROP TRIGGER TR_ChinaCorruptOrder`);
  assert.deepEqual(businessLedgers(await snapshot(app.pool)),beforeCorrupt);
  // User's exact example: an existing 100 order stays 100 when final shipment is 80.
  await query(app.pool, `UPDATE OrderDetail SET OutQuantity=100,EstQuantity=100,SteamQuantity=100 WHERE OrderDetailKey=44001;`);
  const hundredBefore=await snapshot(app.pool);
  const eighty=await preview(app,makeBody([entry('exact-100-to-80',533,2231,80)]));
  assert.equal(eighty.rows[0].orderBeforeQty,100);
  assert.equal(eighty.rows[0].orderAfterQty,100);
  assert.equal((await apply(app,eighty)).success,true);
  const hundredAfter=await snapshot(app.pool);
  assert.deepEqual(hundredAfter.OrderDetail,hundredBefore.OrderDetail);
  const exactShipment=hundredAfter.ShipmentDetail.find(r=>r.ShipmentKey===54001&&r.ProdKey===2231);
  assert.equal(Number(exactShipment.OutQuantity),80);
  assert.equal(hundredAfter.ShipmentDate.filter(r=>r.SdetailKey===exactShipment.SdetailKey).reduce((sum,r)=>sum+Number(r.ShipmentQuantity),0),80);
  await assertNativeReadJoins(app.pool);
  // A DB customer with no order or shipment master in this year/week.
  await query(app.pool, `INSERT Customer(CustKey,CustName,Manager,OrderCode,BaseOutDay) VALUES(535,N'China new customer',N'dutch-fixture',N'C535',4);`);
  const newCustomer=await preview(app,makeBody([makeEntry('new-customer', 'China new customer',535,'Dutch Test Rose White',2232,8,'단')]));
  assert.equal((await apply(app,newCustomer)).success,true);
  const newState=await snapshot(app.pool);
  const newOm=newState.OrderMaster.filter(r=>r.CustKey===535&&r.OrderYear==='2026'&&r.OrderWeek==='40-01');
  const newSm=newState.ShipmentMaster.filter(r=>r.CustKey===535&&r.OrderYear==='2026'&&r.OrderWeek==='40-01');
  assert.equal(newOm.length,1); assert.equal(newSm.length,1);
  assert.equal(newSm[0].OrderYearWeek,'202640');
  const newOd=newState.OrderDetail.find(r=>r.OrderMasterKey===newOm[0].OrderMasterKey&&r.ProdKey===2232);
  const newSd=newState.ShipmentDetail.find(r=>r.ShipmentKey===newSm[0].ShipmentKey&&r.ProdKey===2232);
  assert.equal(Number(newOd.OutQuantity),8); assert.equal(Number(newOd.EstQuantity),80);
  assert.equal(Number(newSd.OutQuantity),8); assert.equal(Number(newSd.EstQuantity),80);
  assert.deepEqual(newState.OrderDetail.filter(r=>r.OrderDetailKey!==newOd.OrderDetailKey),hundredAfter.OrderDetail);
  const repeated=await preview(app,makeBody([makeEntry('repeat','China new customer',535,'Dutch Test Rose White',2232,8,'단')]));
  assert.equal(repeated.planToken,null,'same final value cannot duplicate order or shipment');
  const reduceNew=await preview(app,makeBody([makeEntry('reduce','China new customer',535,'Dutch Test Rose White',2232,4,'단')]));
  assert.equal((await apply(app,reduceNew)).success,true);
  assert.deepEqual((await snapshot(app.pool)).OrderDetail,newState.OrderDetail);
  const corruptEst=await preview(app,makeBody([makeEntry('corrupt-est','China new customer',535,'Dutch Test Rose Red',2231,9,'송이')]));
  const beforeEstCorrupt=businessLedgers(await snapshot(app.pool));
  await query(app.pool,`CREATE TRIGGER TR_ChinaCorruptEst ON OrderDetail AFTER INSERT AS UPDATE od SET EstQuantity=1 FROM OrderDetail od JOIN inserted i ON i.OrderDetailKey=od.OrderDetailKey;`);
  await assert.rejects(()=>apply(app,corruptEst),/단위 환산 검증/);
  await query(app.pool,`DROP TRIGGER TR_ChinaCorruptEst`);
  assert.deepEqual(businessLedgers(await snapshot(app.pool)),beforeEstCorrupt);
  await query(app.pool,`INSERT Customer(CustKey,CustName,Manager,OrderCode,BaseOutDay) VALUES(536,N'China deleted header',N'dutch-fixture',N'C536',4);
    INSERT ShipmentMaster(ShipmentKey,OrderYear,OrderWeek,OrderYearWeek,CustKey,isFix,isDeleted,WebCreated,CreateID)
    VALUES(65000,N'2026',N'40-01',N'202640',536,0,1,1,N'dutch-fixture');`);
  const deletedBody=makeBody([makeEntry('deleted-header','China deleted header',536,'Dutch Test Rose White',2232,8,'단')]);
  const beforeDeleted=businessLedgers(await snapshot(app.pool));
  await assert.rejects(()=>preview(app,deletedBody),/삭제된 출고 연결 헤더/);
  assert.deepEqual(businessLedgers(await snapshot(app.pool)),beforeDeleted);
  await query(app.pool,`UPDATE ShipmentMaster SET OrderYear=N'2025',OrderYearWeek=N'202540' WHERE ShipmentKey=65000;`);
  const priorDeleted=await preview(app,deletedBody);
  assert.ok(priorDeleted.planToken,'prior-year deleted header does not block selected year');
  await query(app.pool,`UPDATE ShipmentMaster SET OrderYear=N'2026',OrderYearWeek=N'202640' WHERE ShipmentKey=65000;`);
  const beforeHeaderRace=businessLedgers(await snapshot(app.pool));
  await assert.rejects(()=>apply(app,priorDeleted),/삭제된 출고 연결 헤더/);
  assert.deepEqual(businessLedgers(await snapshot(app.pool)),beforeHeaderRace);
  await query(app.pool,`UPDATE Product SET SteamOf1Bunch=0 WHERE ProdKey=2232;`);
  const missingRatio=await preview(app,makeBody([entry('missing-native-ratio',533,2232,8,'단')]));
  assert.equal(missingRatio.planToken,null);
  assert.ok(missingRatio.blockers.some(message=>message.includes('신규 주문의 견적단위 환산값')));
  console.log('PASS exact order100/shipment80/date80 and new customer order8/shipment8/estimate80/native headers');
  console.log('PASS repeated/reduced new order preserved, new estimate corruption rollback, deleted-header/cross-year/race guards');
  console.log('PASS China SQL: new positive/zero, existing increase/decrease/zero, immutable original orders, prior-year, omitted pairs, downstream, fixed/stale, atomic rollback and order-trigger guard');
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

    const app = await import('../pages/api/shipment/china-volume-preview.js');
    console.log('[fixture] preview module imported');
    const apply = await import('../pages/api/shipment/china-volume-apply.js');
    const { getPool } = await import('../lib/db.js');
    const db = await import('../lib/db.js');
    const importCore = await import('../lib/shipmentImport.js');
    applicationPool = await getPool();
    console.log('[fixture] isolated app pool connected');
    await runScenarios({
      previewChinaVolume: app.previewChinaVolume,
      applyChinaVolume: apply.applyChinaVolume,
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
