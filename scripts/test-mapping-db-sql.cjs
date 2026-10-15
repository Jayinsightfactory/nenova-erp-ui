// Real MSSQL tests on the exact disposable, loopback-only fixture. Never reads .env.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const sql = require('mssql');
const CONTAINER = 'nenova-estimate-sql-test-20260826';
const inspected = spawnSync('docker', ['inspect', CONTAINER], { encoding: 'utf8', windowsHide: true });
assert.equal(inspected.status, 0, 'isolated SQL fixture is required');
const info = JSON.parse(inspected.stdout)[0];
assert.equal(info.Name, `/${CONTAINER}`);
assert.equal(info.State.Running, true);
assert.match(info.Config.Image, /^mcr\.microsoft\.com\/mssql\/server:2022(?:-|$)/);
assert.equal(info.Mounts.length, 0);
assert.equal((info.HostConfig.Binds || []).length, 0);
assert(info.HostConfig.PortBindings['1433/tcp'].some(x => x.HostIp === '127.0.0.1' && x.HostPort === '14339'));
const passwordEntry = info.Config.Env.find(x => x.startsWith('MSSQL_SA_PASSWORD='));
assert(passwordEntry);
const password = passwordEntry.slice('MSSQL_SA_PASSWORD='.length);
const database = `NenovaMappingFixture_${new Date().toISOString().slice(0, 10).replaceAll('-', '')}_${crypto.randomBytes(4).toString('hex')}`;
assert.match(database, /^NenovaMappingFixture_\d{8}_[a-f0-9]{8}$/);
const config = { server: '127.0.0.1', port: 14339, user: 'sa', password,
  options: { encrypt: false, trustServerCertificate: true }, pool: { max: 20 } };

(async () => {
  const admin = await new sql.ConnectionPool({ ...config, database: 'master' }).connect();
  let appPool, secondPool;
  try {
    await admin.request().query(`CREATE DATABASE [${database}]`);
    Object.assign(process.env, { DB_SERVER: '127.0.0.1', DB_PORT: '14339', DB_NAME: database, DB_USER: 'sa', DB_PASSWORD: password });
    const db = await import('../lib/db.js');
    appPool = await db.getPool();
    const migration = await import('../lib/mappingMigration.js');
    const storeModule = await import('../lib/mappingDbStore.js');
    const product = await import('../lib/parseMappings.js');
    const customer = await import('../lib/customerMappings.js');
    const scoped = await import('../lib/orderImportCustomerProductMappings.js');
    const ddl = fs.readFileSync('docs/migrations/2026-10-15_web_mapping_store.sql', 'utf8');
    const originals = {
      customer: { '그대로': { custKey: 77, custName: 'old', savedAt: '2025-10-01', unknown: { zero: 0, flag: false } } },
      product: { A: { prodKey: 1, manual: true, unit: '단', savedAt: 'old' }, a: { prodKey: 2 }, 'Á': { prodKey: 3 } },
      customerProduct: { '77': { custKey: 77, custName: 'original', mappings: { '장미 50cm': { prodKey: 11, manual: true } },
        history: [{ key: '장미 50cm', before: null, after: { prodKey: 11 }, actor: 'account-a', savedAt: '2025-10-01' }], custom: ['preserve', null] } },
    };
    const snapshot = migration.prepareMappingMigration(Object.fromEntries(Object.entries(originals).map(([k, v]) => [k, Buffer.from(JSON.stringify(v))])));
    await db.query('CREATE TABLE dbo.OrderDetail (OrderYear int, OrderWeek nvarchar(10), CustKey int, ProdKey int, Quantity decimal(18,3)); INSERT dbo.OrderDetail VALUES (2025,N\'41-02\',77,1,12),(2026,N\'41-02\',77,1,34)');
    const erpBefore = (await db.query('SELECT * FROM dbo.OrderDetail ORDER BY OrderYear')).recordset;

    // A failure after real inserts must roll back DDL, payloads and marker together.
    await assert.rejects(db.withTransaction(tQuery => migration.applyMappingSnapshot({
      tQuery: async (statement, params) => {
        if (statement.includes('INSERT INTO dbo.WebMappingMigration')) throw new Error('injected migration failure');
        return tQuery(statement, params);
      }, sql, snapshot, ddl,
    }), { retries: 0 }), /injected migration failure/);
    const absent = await db.query("SELECT OBJECT_ID(N'dbo.WebMappingStore') AS StoreId, OBJECT_ID(N'dbo.WebMappingMigration') AS MarkerId");
    assert.equal(absent.recordset[0].StoreId, null);
    assert.equal(absent.recordset[0].MarkerId, null);
    await assert.rejects(product.loadMappings());
    await db.withTransaction(tQuery => migration.applyMappingSnapshot({ tQuery, sql, snapshot, ddl }), { retries: 0 });
    assert.deepEqual(await customer.loadCustomerMappings(), originals.customer);
    assert.deepEqual(await product.loadMappings(), originals.product);
    assert.deepEqual(await scoped.loadCustomerProductMappings(), originals.customerProduct);

    // A separate connection is another process/account reader, with no local cache.
    secondPool = await new sql.ConnectionPool({ ...config, database }).connect();
    const secondQuery = async (statement, params = {}) => {
      const request = secondPool.request();
      for (const [key, spec] of Object.entries(params)) request.input(key, spec.type, spec.value);
      return request.query(statement);
    };
    const secondStore = storeModule.createMappingDbStore({ query: secondQuery, withTransaction: db.withTransaction, sql });
    assert.equal((await customer.saveCustomerMapping('새 업체', { custKey: 88, custName: 'shared' })).saved, true);
    assert.equal((await secondStore.readMappingDocument('customer'))['새업체'].custKey, 88);
    const names = ['가나다', '라마바', '사아자', '차카타', '파하가', '나라마', '바사아', '자차카'];
    await Promise.all(names.map((name, i) => product.saveMapping(name, { prodKey: 100 + i, manual: true }, { force: true })));
    const concurrent = await secondStore.readMappingDocument('product');
    names.forEach((name, i) => assert.equal(concurrent[name].prodKey, 100 + i));
    await product.saveMapping('수동확정', { prodKey: 123, manual: true, unit: '송이' });
    assert.equal((await product.saveMapping('수동확정', { prodKey: 456 }, { force: true })).reason, 'manual-mapping-protected');
    assert.equal((await secondStore.readMappingDocument('product'))['수동확정'].prodKey, 123);
    await scoped.saveCustomerProductMapping(77, '장미 50cm', { prodKey: 22, manual: true }, { actor: 'account-b' });
    const sharedScope = (await secondStore.readMappingDocument('customer-product'))['77'];
    assert.equal(sharedScope.history.at(-1).actor, 'account-b');
    assert.deepEqual(sharedScope.history[0], originals.customerProduct['77'].history[0]);
    assert.deepEqual(sharedScope.custom, ['preserve', null]);
    assert.equal((await product.deleteMapping('A')).deleted, true);
    await assert.rejects(db.withTransaction(tQuery => migration.applyMappingSnapshot({ tQuery, sql, snapshot, ddl }), { retries: 0 }), /완료 표식/);
    assert.equal((await product.loadMappings()).A, undefined);
    assert.equal((await product.loadMappings()).a.prodKey, 2);
    assert.deepEqual((await db.query('SELECT * FROM dbo.OrderDetail ORDER BY OrderYear')).recordset, erpBefore);

    await db.query("DELETE dbo.WebMappingStore WHERE StoreKey=N'product'");
    await assert.rejects(product.loadMappings(), /문서가 없습니다/);
    await db.query('DELETE dbo.WebMappingMigration');
    await assert.rejects(customer.loadCustomerMappings(), /이전이 완료되지/);
    console.log('Real MSSQL mapping tests passed: lossless migration, atomic rollback, independent reader, 8 concurrent writes, manual guard, full history, no resurrection, cross-year ERP preservation, fail closed.');
  } finally {
    if (secondPool) await secondPool.close();
    if (appPool) await appPool.close();
    await admin.request().query(`IF DB_ID(N'${database}') IS NOT NULL BEGIN ALTER DATABASE [${database}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [${database}]; END`);
    await admin.close();
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
