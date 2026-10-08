#!/usr/bin/env node
/*
 * Isolated SQL Server fixture for docs/migrations/2026-10-08_web_invoice_storage_v1.sql.
 * Usage: node scripts/test-invoice-web-storage-sql.cjs
 * No app config, database/host/credential override, or keep-database option.
 * The only database dropped is the unique fixture database created by this run.
 */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const sql = require('mssql');

const REPO_ROOT = path.resolve(__dirname, '..');
const MIGRATION_FILE = path.join(REPO_ROOT, 'docs', 'migrations', '2026-10-08_web_invoice_storage_v1.sql');
const CONTAINER = 'nenova-estimate-sql-test-20260826';
const HOST = '127.0.0.1';
const PORT = 14339;
const DB_PREFIX = 'NenovaInvoiceFixture_';
const TABLES = [
  'WebInvoiceDocument', 'WebInvoiceLine', 'WebInvoiceOperation',
  'WebInvoiceHistory', 'WebInvoiceCostRevision', 'WebInvoiceCostLine',
];
const DOC1 = '10000000-0000-4000-8000-000000000001';
const DOC2 = '10000000-0000-4000-8000-000000000002';
const LINE1 = '20000000-0000-4000-8000-000000000001';
const LINE2 = '20000000-0000-4000-8000-000000000002';
const OP1 = '30000000-0000-4000-8000-000000000001';
const OP2 = '30000000-0000-4000-8000-000000000002';
const COST1 = '40000000-0000-4000-8000-000000000001';
const COST2 = '40000000-0000-4000-8000-000000000002';
const HASH1 = Buffer.from('11'.repeat(32), 'hex');
const HASH2 = Buffer.from('22'.repeat(32), 'hex');
const MOCK_SP = `CREATE PROCEDURE dbo.usp_CreateWarehouse AS BEGIN SET NOCOUNT ON; SELECT N'fixture-only' AS Fixture; END;`;

function fail(message) {
  throw new Error(`[invoice-web-storage-sql-fixture] ${message}`);
}

function ensure(condition, message) {
  if (!condition) fail(message);
}

function parseArgs(argv) {
  if (argv.length === 3 && (argv[2] === '--help' || argv[2] === '-h')) return { help: true };
  if (argv.length !== 2) fail('no arguments are accepted (especially no database, host, or credential overrides)');
  return { help: false };
}

function usage() {
  console.log('Usage: node scripts/test-invoice-web-storage-sql.cjs');
  console.log('Creates and drops one fresh NenovaInvoiceFixture_* database on the approved loopback SQL2022 container.');
}

function inspectApprovedContainer() {
  const result = spawnSync('docker', ['inspect', CONTAINER], { encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) fail('approved SQL fixture container is not inspectable');
  let info;
  try { info = JSON.parse(result.stdout)[0]; } catch { fail('container inspect response is invalid'); }
  ensure(info && info.Name === `/${CONTAINER}`, 'container name guard failed');
  ensure(info.State?.Running === true, 'approved fixture container is not running');
  ensure(/^mcr\.microsoft\.com\/mssql\/server:2022(?:-|$)/i.test(String(info.Config?.Image || '')),
    'container image is not official SQL Server 2022');
  ensure((info.Mounts || []).length === 0 && (info.HostConfig?.Binds || []).length === 0,
    'fixture container has a mount; refusing to connect');
  const bindings = info.HostConfig?.PortBindings || {};
  const published = Object.entries(bindings).flatMap(([containerPort, items]) =>
    (items || []).map(item => ({ containerPort, ...item })));
  ensure(Object.keys(bindings).every(containerPort => containerPort === '1433/tcp')
    && published.length === 1 && published[0].HostIp === HOST && String(published[0].HostPort) === String(PORT),
  'fixture must have exactly one published port, 1433/tcp on the approved loopback endpoint');
  const env = new Map((info.Config?.Env || []).map(entry => {
    const at = String(entry).indexOf('=');
    return [at < 0 ? String(entry) : entry.slice(0, at), at < 0 ? '' : entry.slice(at + 1)];
  }));
  const password = env.get('MSSQL_SA_PASSWORD');
  ensure(typeof password === 'string' && password.length > 0, 'fixture SA credential is unavailable');
  // Password is retained only in process memory and is never printed or included in an error.
  return { password, image: info.Config.Image };
}

function assertFixtureDatabaseName(name) {
  ensure(/^NenovaInvoiceFixture_[0-9]{8}_[0-9a-f]{12}$/.test(name), 'fixture database name guard failed');
}

function newDatabaseName() {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const name = `${DB_PREFIX}${date}_${crypto.randomBytes(6).toString('hex')}`;
  assertFixtureDatabaseName(name);
  return name;
}

function bracketFixtureDatabase(name) {
  assertFixtureDatabaseName(name);
  return `[${name}]`;
}

function splitBatches(source) {
  return source.split(/^\s*GO\s*;?\s*$/gim).map(batch => batch.trim()).filter(Boolean);
}

function readMigration() {
  ensure(fs.existsSync(MIGRATION_FILE), `migration file is missing: ${path.relative(REPO_ROOT, MIGRATION_FILE)}`);
  const source = fs.readFileSync(MIGRATION_FILE, 'utf8');
  for (const name of TABLES) {
    ensure(new RegExp(`CREATE\\s+TABLE\\s+(?:\\[?dbo\\]?\\.)?\\[?${name}\\]?`, 'i').test(source),
      `migration does not declare expected web table ${name}`);
  }
  ensure(/XACT_ABORT\s+ON/i.test(source) && /LOCK_TIMEOUT/i.test(source),
    'migration must declare XACT_ABORT and a bounded LOCK_TIMEOUT');
  ensure(source.includes('NenovaWebInvoiceV1CheckHash') && /SHA2_256/i.test(source)
    && /sp_addextendedproperty/i.test(source),
  'migration must install per-CHECK SHA2_256 fingerprints as extended properties');
  ensure(!/\b(?:ALTER|UPDATE|DELETE|INSERT|GRANT|DENY|CREATE\s+(?:TRIGGER|INDEX))\b[\s\S]{0,120}\b(?:WarehouseMaster|TempWarehouseDetail|KeyNumbering)\b/i.test(source),
    'migration appears to write or alter a protected ERP sentinel');
  return source;
}

function request(executor, params = {}, timeoutMs = 60000) {
  const req = new sql.Request(executor);
  req.timeout = timeoutMs;
  for (const [name, spec] of Object.entries(params)) req.input(name, spec.type, spec.value);
  return req;
}

function query(executor, statement, params = {}, timeoutMs = 60000) {
  return request(executor, params, timeoutMs).query(statement);
}

async function applyMigration(pool, source) {
  for (const batch of splitBatches(source)) await query(pool, batch, {}, 60000);
}

async function tableExists(pool, name) {
  const result = await query(pool, `SELECT OBJECT_ID(@qualified,N'U') AS ObjectId;`, {
    qualified: { type: sql.NVarChar(256), value: `dbo.${name}` },
  });
  return result.recordset?.[0]?.ObjectId != null;
}

async function assertEmptyTables(pool) {
  for (const name of TABLES) {
    ensure(await tableExists(pool, name), `migration did not create dbo.${name}`);
    const result = await query(pool, `SELECT COUNT_BIG(*) AS [RowCount] FROM dbo.[${name}];`);
    ensure(Number(result.recordset?.[0]?.RowCount) === 0, `dbo.${name} must be empty after migration`);
  }
}

async function createSentinels(pool) {
  await query(pool, `CREATE TABLE dbo.WarehouseMaster (FixtureId int NOT NULL PRIMARY KEY, Marker nvarchar(40) NOT NULL);
    CREATE TABLE dbo.TempWarehouseDetail (FixtureId int NOT NULL PRIMARY KEY, Marker nvarchar(40) NOT NULL);
    CREATE TABLE dbo.KeyNumbering (Category nvarchar(40) NOT NULL PRIMARY KEY, LastKeyNo int NOT NULL);
    INSERT dbo.WarehouseMaster VALUES (1,N'keep-warehouse');
    INSERT dbo.TempWarehouseDetail VALUES (1,N'keep-temp');
    INSERT dbo.KeyNumbering VALUES (N'FixtureInvoiceProbe',731);`);
  await query(pool, MOCK_SP);
}

async function sentinelSnapshot(pool) {
  const rows = {};
  for (const name of ['WarehouseMaster', 'TempWarehouseDetail', 'KeyNumbering']) {
    const result = await query(pool, `SELECT * FROM dbo.[${name}] ORDER BY 1;`);
    rows[name] = result.recordset;
  }
  const proc = await query(pool, `SELECT OBJECT_DEFINITION(OBJECT_ID(N'dbo.usp_CreateWarehouse')) AS Definition;`);
  return { rows, definition: proc.recordset?.[0]?.Definition };
}

function valuesForDocument({ id, year, hash, invoiceNo, issueYear = 2025, week = '41-01' }) {
  return {
    DocumentId: id, OrderYear: year, OrderWeek: week, Revision: 1,
    FarmKey: null, InvoiceNo: invoiceNo, InvoiceYear: String(issueYear),
    SourceHash: HASH2, OriginalFileName: 'fixture-invoice.pdf', BusinessKeyHash: hash,
    ReceiptStatus: 'DRAFT', CostStatus: 'PENDING', RawMetadataJson: `N'{"source":"fixture"}'`,
    ReviewedMetadataJson: null, CreatedBy: 'invoice-fixture', UpdatedBy: 'invoice-fixture',
    CreatedAt: '2026-10-08T00:00:00Z', UpdatedAt: '2026-10-08T00:00:00Z',
  };
}

function valuesForLine({ documentId, lineId, revision = 1, lineNo = 1, quantity = 0, bunch = null, currency = null }) {
  return {
    DocumentId: documentId, Revision: revision, LineId: lineId, LineNo: lineNo,
    OriginalName: 'fixture product', LengthText: null, ProdKey: null,
    BoxQuantity: quantity, BunchQuantity: bunch, StemQuantity: null,
    PriceUnit: null, UnitPrice: null, Currency: currency, LineAmount: null,
    SourceEvidenceJson: `N'{"raw":"kept"}'`, ReviewedJson: null,
  };
}

function sqlValue(value) {
  if (value === null) return 'NULL';
  if (typeof value === 'number') return String(value);
  if (Buffer.isBuffer(value)) return `0x${value.toString('hex')}`;
  if (typeof value === 'string' && /^\d{4}-\d\d-\d\dT/.test(value)) return `CONVERT(datetime2,'${value}',127)`;
  if (typeof value === 'string' && value.startsWith("N'")) return value;
  if (typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(value)) return `CONVERT(uniqueidentifier,'${value}')`;
  return `N'${String(value).replace(/'/g, "''")}'`;
}

async function insertRow(pool, table, values) {
  const columns = Object.keys(values);
  const statement = `INSERT dbo.[${table}] (${columns.map(column => `[${column}]`).join(',')}) VALUES (${columns.map(column => sqlValue(values[column])).join(',')});`;
  await query(pool, statement);
}

function sqlErrorDetails(error) {
  const numbers = new Set();
  const messages = [];
  const visit = current => {
    if (!current || typeof current !== 'object') return;
    if (Number.isInteger(current.number)) numbers.add(current.number);
    if (Number.isInteger(current.info?.number)) numbers.add(current.info.number);
    if (typeof current.message === 'string') messages.push(current.message);
    if (typeof current.info?.message === 'string') messages.push(current.info.message);
    for (const nested of current.precedingErrors || []) visit(nested);
    if (current.originalError && current.originalError !== current) visit(current.originalError);
  };
  visit(error);
  return { numbers, message: messages.join('\n') };
}

async function expectSqlReject(executor, statement, label, expected) {
  let caught;
  try { await query(executor, statement); } catch (error) { caught = error; }
  ensure(caught, `${label}: expected SQL constraint/preflight rejection`);
  const details = sqlErrorDetails(caught);
  ensure(expected?.numbers?.some(number => details.numbers.has(number)),
    `${label}: expected error number ${expected?.numbers?.join('|')}, got ${[...details.numbers].join('|') || 'none'}; ${details.message}`);
  if (expected.includes) ensure(details.message.includes(expected.includes),
    `${label}: expected error text ${expected.includes}; ${details.message}`);
  if (expected.includesAny) ensure(expected.includesAny.some(token => details.message.includes(token)),
    `${label}: expected one of ${expected.includesAny.join('|')} in error text; ${details.message}`);
}

async function countWhere(pool, table, where) {
  const result = await query(pool, `SELECT COUNT_BIG(*) AS [RowCount] FROM dbo.[${table}] WHERE ${where};`);
  return Number(result.recordset?.[0]?.RowCount);
}

async function testPartialSchemaRefusal(pool, source) {
  await query(pool, `CREATE TABLE dbo.WebInvoiceDocument (PartialMarker int NOT NULL);`);
  const before = await query(pool, `SELECT name FROM sys.tables WHERE schema_id=SCHEMA_ID(N'dbo') ORDER BY name;`);
  let migrationFailed = false;
  try { await applyMigration(pool, source); } catch (error) {
    migrationFailed = true;
    const details = sqlErrorDetails(error);
    ensure(details.numbers.has(51004) && details.message.includes('WEB_INVOICE_V1_PARTIAL_SCHEMA_EXISTS'),
      `partial-schema refusal returned an unexpected error: ${details.message}`);
  }
  ensure(migrationFailed, 'migration must refuse a partial/mismatched pre-existing V1 object');
  const after = await query(pool, `SELECT name FROM sys.tables WHERE schema_id=SCHEMA_ID(N'dbo') ORDER BY name;`);
  assert.deepEqual(after.recordset, before.recordset, 'partial-schema refusal must not create additional tables');
  const marker = await query(pool, `SELECT PartialMarker FROM dbo.WebInvoiceDocument;`);
  ensure(marker.recordset?.length === 0, 'partial table must remain untouched');
  await query(pool, `DROP TABLE dbo.WebInvoiceDocument;`);
  console.log('ok - partial schema is refused without repairing or adding objects');
}

async function testStorageContracts(pool) {
  await insertRow(pool, 'WebInvoiceDocument', valuesForDocument({ id: DOC1, year: '2025', hash: HASH1, invoiceNo: 'INV-A' }));
  await insertRow(pool, 'WebInvoiceDocument', valuesForDocument({ id: DOC2, year: '2026', hash: HASH2, invoiceNo: 'INV-B', issueYear: 2026 }));
  ensure(await countWhere(pool, 'WebInvoiceDocument', `OrderWeek=N'41-01'`) === 2,
    'same business week must allow separate 2025 and 2026 drafts');
  const duplicateHash = valuesForDocument({
    id: '10000000-0000-4000-8000-000000000003', year: '2026', week: '42-01', hash: HASH1, invoiceNo: 'INV-A',
  });
  ensure(duplicateHash.OrderWeek !== '41-01', 'duplicate-hash probe must use a different business week');
  await expectSqlReject(pool,
    `INSERT dbo.WebInvoiceDocument (${Object.keys(duplicateHash).map(key => `[${key}]`).join(',')}) VALUES (${Object.values(duplicateHash).map(sqlValue).join(',')});`,
    'business hash duplicate across weeks', { numbers: [2601, 2627], includes: 'UX_WebInvoiceDocument_BusinessKeyHash' });
  for (const [invalidYear, invalidWeek, label] of [
    ['20X6', '40-01', 'invalid document year'], ['2026', '54-01', 'invalid document week'],
  ]) {
    const invalid = valuesForDocument({ id: '10000000-0000-4000-8000-000000000003', year: invalidYear, hash: null, invoiceNo: 'BAD' });
    invalid.OrderWeek = invalidWeek;
    await expectSqlReject(pool,
      `INSERT dbo.WebInvoiceDocument (${Object.keys(invalid).map(key => `[${key}]`).join(',')}) VALUES (${Object.values(invalid).map(sqlValue).join(',')});`,
      label, { numbers: [547], includes: 'CK_WebInvoiceDocument_OrderScope' });
  }

  await insertRow(pool, 'WebInvoiceLine', valuesForLine({ documentId: DOC1, lineId: LINE1, quantity: 0, bunch: null, currency: 'USD' }));
  await insertRow(pool, 'WebInvoiceLine', valuesForLine({ documentId: DOC2, lineId: LINE2, quantity: null, bunch: 0 }));
  const exact = await query(pool, `SELECT BoxQuantity,BunchQuantity,StemQuantity,Currency FROM dbo.WebInvoiceLine WHERE DocumentId=@id;`, {
    id: { type: sql.UniqueIdentifier, value: DOC1 },
  });
  ensure(exact.recordset?.[0]?.BoxQuantity === 0 && exact.recordset[0].BunchQuantity === null
    && exact.recordset[0].StemQuantity === null, 'explicit zero and null line values must be preserved distinctly');
  ensure(exact.recordset[0].Currency === 'USD', 'three-character currency USD must be accepted as the positive control');
  const shortCurrency = valuesForLine({ documentId: DOC1, lineId: '20000000-0000-4000-8000-000000000005', lineNo: 2, currency: 'U' });
  await expectSqlReject(pool,
    `INSERT dbo.WebInvoiceLine (${Object.keys(shortCurrency).map(key => `[${key}]`).join(',')}) VALUES (${Object.values(shortCurrency).map(sqlValue).join(',')});`,
    'short currency code', { numbers: [547], includes: 'CK_WebInvoiceLine_Currency' });
  const negativeLine = valuesForLine({ documentId: DOC1, lineId: '20000000-0000-4000-8000-000000000003', lineNo: 3, quantity: -1 });
  await expectSqlReject(pool,
    `INSERT dbo.WebInvoiceLine (${Object.keys(negativeLine).map(key => `[${key}]`).join(',')}) VALUES (${Object.values(negativeLine).map(sqlValue).join(',')});`,
    'negative line quantity', { numbers: [547], includes: 'CK_WebInvoiceLine_Quantities' });
  console.log('ok - cross-year drafts, cross-week duplicate hash, invalid year/week, and zero-vs-null/negative quantity');
}

async function testOperationsHistoryAndCost(pool) {
  await insertRow(pool, 'WebInvoiceOperation', {
    OperationId: OP1, DocumentId: DOC1, DocumentRevision: 1, ReceiptPartId: OP2,
    RequestHash: HASH1, Action: 'CREATE_RECEIPT', Status: 'COMMITTED', WarehouseKey: 91001,
    ResultJson: `N'{"ok":true}'`, ErrorCode: null, Actor: 'invoice-fixture',
    CreatedAt: '2026-10-08T00:00:00Z', CompletedAt: '2026-10-08T00:00:01Z',
  });
  const duplicateOperation = {
    OperationId: OP1, DocumentId: DOC1, DocumentRevision: 1, ReceiptPartId: OP2,
    RequestHash: HASH2, Action: 'CREATE_RECEIPT', Status: 'PENDING', Actor: 'invoice-fixture',
    CreatedAt: '2026-10-08T00:00:02Z',
  };
  await expectSqlReject(pool,
    `INSERT dbo.WebInvoiceOperation (${Object.keys(duplicateOperation).map(key => `[${key}]`).join(',')}) VALUES (${Object.values(duplicateOperation).map(sqlValue).join(',')});`,
    'duplicate operation UUID', { numbers: [2601, 2627], includesAny: [
      'PK_WebInvoiceOperation', 'UX_WebInvoiceOperation_DocumentRevisionOperation',
      'UX_WebInvoiceOperation_DocumentRevisionOperationWarehouse',
    ] });

  const validHistory = {
    DocumentId: DOC1, Revision: 1, OperationId: OP1, Action: 'RECEIPT_CREATED',
    BeforeJson: null, AfterJson: `N'{"status":"COMMITTED"}'`, Reason: 'positive fixture control',
    Actor: 'invoice-fixture', CreatedAt: '2026-10-08T00:00:02Z',
  };
  await insertRow(pool, 'WebInvoiceHistory', validHistory);
  ensure(await countWhere(pool, 'WebInvoiceHistory', `DocumentId='${DOC1}' AND OperationId='${OP1}'`) === 1,
    'valid same-document history-operation pair must persist');

  const crossDocumentHistory = {
    DocumentId: DOC2, Revision: 1, OperationId: OP1, Action: 'UPDATE',
    BeforeJson: null, AfterJson: null, Reason: 'fixture cross-scope probe',
    Actor: 'invoice-fixture', CreatedAt: '2026-10-08T00:00:03Z',
  };
  await expectSqlReject(pool,
    `INSERT dbo.WebInvoiceHistory (${Object.keys(crossDocumentHistory).map(key => `[${key}]`).join(',')}) VALUES (${Object.values(crossDocumentHistory).map(sqlValue).join(',')});`,
    'history operation belonging to another document', { numbers: [547], includes: 'FK_WebInvoiceHistory_OperationScope' });

  await insertRow(pool, 'WebInvoiceCostRevision', {
    CostRevisionId: COST1, DocumentId: DOC1, DocumentRevision: 1, OperationId: OP1,
    WarehouseKey: 91001, RevisionNo: 1, Basis: 'ACTUAL', Status: 'DRAFT', Currency: 'USD',
    FormulaId: 'fixture-formula', FormulaVersion: '1', FormulaSourceHash: HASH1,
    InputSnapshotJson: `N'{"fixture":true}'`, ApprovedBy: null, ApprovedAt: null,
    CreatedBy: 'invoice-fixture', CreatedAt: '2026-10-08T00:00:00Z',
  });

  const validCostLine = {
    CostRevisionId: COST1, LineId: LINE1, DocumentId: DOC1, DocumentRevision: 1,
    OperationId: OP1, WarehouseKey: 91001, WdetailKey: 91002, ProdKey: 91003,
    Unit: 'BUNCH', Quantity: 0, CostPerUnit: null, TotalCost: 0, ComponentAmountsJson: `N'{"freight":null}'`,
  };
  await insertRow(pool, 'WebInvoiceCostLine', validCostLine);
  ensure(await countWhere(pool, 'WebInvoiceCostLine', `CostRevisionId='${COST1}' AND LineId='${LINE1}'`) === 1,
    'valid cost line matching its revision and invoice snapshot must persist');

  const lineCost = {
    CostRevisionId: COST1, LineId: LINE2, DocumentId: DOC1, DocumentRevision: 1,
    OperationId: OP1, WarehouseKey: 91001, WdetailKey: 91002, ProdKey: 91003,
    Unit: 'BUNCH', Quantity: 0, CostPerUnit: null, TotalCost: 0, ComponentAmountsJson: `N'{"freight":null}'`,
  };
  await expectSqlReject(pool, `INSERT dbo.WebInvoiceCostLine (${Object.keys(lineCost).map(key => `[${key}]`).join(',')}) VALUES (${Object.values(lineCost).map(sqlValue).join(',')});`,
    'cost line referencing another document snapshot line', { numbers: [547], includes: 'FK_WebInvoiceCostLine_SourceLine' });
  await insertRow(pool, 'WebInvoiceCostRevision', {
    CostRevisionId: COST2, DocumentId: DOC1, DocumentRevision: 1, OperationId: OP1,
    WarehouseKey: 91001, RevisionNo: 2, Basis: 'ACTUAL', Status: 'DRAFT', Currency: 'USD',
    FormulaId: 'fixture-formula', FormulaVersion: '1', FormulaSourceHash: HASH2,
    InputSnapshotJson: `N'{"fixture":"second-scope-control"}'`, ApprovedBy: null, ApprovedAt: null,
    CreatedBy: 'invoice-fixture', CreatedAt: '2026-10-08T00:00:00Z',
  });
  const wrongWarehouseScope = { ...validCostLine, CostRevisionId: COST2, WarehouseKey: 91004 };
  await expectSqlReject(pool,
    `INSERT dbo.WebInvoiceCostLine (${Object.keys(wrongWarehouseScope).map(key => `[${key}]`).join(',')}) VALUES (${Object.values(wrongWarehouseScope).map(sqlValue).join(',')});`,
    'cost line with a different WarehouseKey than its cost revision',
    { numbers: [547], includes: 'FK_WebInvoiceCostLine_CostRevisionScope' });
  console.log('ok - duplicate operation UUID, valid/cross-scope history, and valid/cross-scope cost-line controls');
}

async function testRollback(pool) {
  const tx = new sql.Transaction(pool);
  await tx.begin(sql.ISOLATION_LEVEL.READ_COMMITTED);
  try {
    await insertRow(tx, 'WebInvoiceDocument', valuesForDocument({
      id: '10000000-0000-4000-8000-000000000004', year: '2026', week: '42-01', hash: null, invoiceNo: 'ROLLBACK',
    }));
    const invalidLine = valuesForLine({ documentId: DOC1, lineId: '20000000-0000-4000-8000-000000000004', lineNo: 5, quantity: -1 });
    await expectSqlReject(tx,
      `INSERT dbo.WebInvoiceLine (${Object.keys(invalidLine).map(key => `[${key}]`).join(',')}) VALUES (${Object.values(invalidLine).map(sqlValue).join(',')});`,
      'forced failure inside rollback transaction', { numbers: [547], includes: 'CK_WebInvoiceLine_Quantities' });
  } finally {
    await tx.rollback().catch(() => {});
  }
  const marker = await query(pool, `SELECT COUNT_BIG(*) AS [RowCount] FROM dbo.WebInvoiceDocument WHERE InvoiceNo=N'ROLLBACK';`);
  ensure(Number(marker.recordset?.[0]?.RowCount) === 0, 'failed multi-write transaction must leave no document row');
  console.log('ok - failed multi-write transaction leaves no partial document row');
}

async function testInstalledSchemaDrift(pool, source) {
  const before = await query(pool, `SELECT COUNT_BIG(*) AS [RowCount] FROM dbo.WebInvoiceDocument;`);
  await query(pool, `ALTER TABLE dbo.WebInvoiceDocument ADD FixtureDrift int NULL;`);
  let driftRejected = false;
  try { await applyMigration(pool, source); } catch (error) {
    driftRejected = true;
    const details = sqlErrorDetails(error);
    ensure(details.numbers.has(51005) && details.message.includes('WEB_INVOICE_V1_COLUMN_DRIFT'),
      `installed schema drift returned an unexpected error: ${details.message}`);
  }
  ensure(driftRejected, 'migration must reject drift after a valid six-table installation');
  const after = await query(pool, `SELECT COUNT_BIG(*) AS [RowCount] FROM dbo.WebInvoiceDocument;`);
  assert.deepEqual(after.recordset, before.recordset, 'drift refusal must preserve installed fixture rows');
  await query(pool, `ALTER TABLE dbo.WebInvoiceDocument DROP COLUMN FixtureDrift;`);
  await applyMigration(pool, source);

  const constraint = await query(pool, `SELECT checks.definition,checks.is_not_trusted,
      CONVERT(varbinary(32),properties.value) AS CheckHash
    FROM sys.check_constraints AS checks
    JOIN sys.extended_properties AS properties
      ON properties.class=1 AND properties.major_id=checks.object_id AND properties.minor_id=0
     AND properties.name=N'NenovaWebInvoiceV1CheckHash'
    WHERE checks.parent_object_id=OBJECT_ID(N'dbo.WebInvoiceLine')
      AND checks.name=N'CK_WebInvoiceLine_Quantities';`);
  const originalDefinition = constraint.recordset?.[0]?.definition;
  const originalFingerprint = constraint.recordset?.[0]?.CheckHash;
  ensure(typeof originalDefinition === 'string' && originalDefinition.length > 0,
    'cannot capture original CK_WebInvoiceLine_Quantities definition for fixture-only restoration');
  ensure(Buffer.isBuffer(originalFingerprint) && originalFingerprint.length === 32,
    'cannot capture 32-byte NenovaWebInvoiceV1CheckHash extended property for fixture-only restoration');
  try {
    await query(pool, `ALTER TABLE dbo.WebInvoiceLine DROP CONSTRAINT CK_WebInvoiceLine_Quantities;
      ALTER TABLE dbo.WebInvoiceLine WITH CHECK ADD CONSTRAINT CK_WebInvoiceLine_Quantities CHECK (1=1);
      EXEC sys.sp_addextendedproperty
        @name=N'NenovaWebInvoiceV1CheckHash',@value=@baselineHash,
        @level0type=N'SCHEMA',@level0name=N'dbo',
        @level1type=N'TABLE',@level1name=N'WebInvoiceLine',
        @level2type=N'CONSTRAINT',@level2name=N'CK_WebInvoiceLine_Quantities';`, {
      baselineHash: { type: sql.VarBinary(32), value: originalFingerprint },
    });
    const weakened = await query(pool, `SELECT checks.definition,
        CONVERT(varbinary(32),properties.value) AS CheckHash
      FROM sys.check_constraints AS checks
      JOIN sys.extended_properties AS properties
        ON properties.class=1 AND properties.major_id=checks.object_id AND properties.minor_id=0
       AND properties.name=N'NenovaWebInvoiceV1CheckHash'
      WHERE checks.parent_object_id=OBJECT_ID(N'dbo.WebInvoiceLine')
        AND checks.name=N'CK_WebInvoiceLine_Quantities';`);
    ensure(weakened.recordset?.[0]?.definition !== originalDefinition
      && Buffer.isBuffer(weakened.recordset?.[0]?.CheckHash)
      && weakened.recordset[0].CheckHash.equals(originalFingerprint),
    'weakened CHECK must carry the captured original fingerprint before the migration drift probe');
    let checkDriftRejected = false;
    try { await applyMigration(pool, source); } catch (error) {
      checkDriftRejected = true;
      const details = sqlErrorDetails(error);
      ensure(details.numbers.has(51007) && details.message.includes('WEB_INVOICE_V1_CHECK_CONSTRAINT_DRIFT'),
        `weakened same-name CHECK returned an unexpected error: ${details.message}`);
    }
    ensure(checkDriftRejected, 'migration must reject a weakened same-name CK_WebInvoiceLine_Quantities');
  } finally {
    await query(pool, `IF EXISTS (SELECT 1 FROM sys.check_constraints
        WHERE parent_object_id=OBJECT_ID(N'dbo.WebInvoiceLine') AND name=N'CK_WebInvoiceLine_Quantities')
        ALTER TABLE dbo.WebInvoiceLine DROP CONSTRAINT CK_WebInvoiceLine_Quantities;
      DECLARE @definition nvarchar(max)=@capturedDefinition;
      DECLARE @restore nvarchar(max)=N'ALTER TABLE dbo.WebInvoiceLine WITH CHECK ADD CONSTRAINT CK_WebInvoiceLine_Quantities CHECK '+@definition+N';';
      EXEC sys.sp_executesql @restore;`, {
      capturedDefinition: { type: sql.NVarChar(sql.MAX), value: originalDefinition },
    });
    await query(pool, `EXEC sys.sp_addextendedproperty
      @name=N'NenovaWebInvoiceV1CheckHash',@value=@baselineHash,
      @level0type=N'SCHEMA',@level0name=N'dbo',
      @level1type=N'TABLE',@level1name=N'WebInvoiceLine',
      @level2type=N'CONSTRAINT',@level2name=N'CK_WebInvoiceLine_Quantities';`, {
      baselineHash: { type: sql.VarBinary(32), value: originalFingerprint },
    });
  }
  const restored = await query(pool, `SELECT checks.definition,checks.is_not_trusted,
      CONVERT(varbinary(32),properties.value) AS CheckHash
    FROM sys.check_constraints AS checks
    JOIN sys.extended_properties AS properties
      ON properties.class=1 AND properties.major_id=checks.object_id AND properties.minor_id=0
     AND properties.name=N'NenovaWebInvoiceV1CheckHash'
    WHERE checks.parent_object_id=OBJECT_ID(N'dbo.WebInvoiceLine')
      AND checks.name=N'CK_WebInvoiceLine_Quantities';`);
  ensure(restored.recordset?.[0]?.definition === originalDefinition
    && Buffer.isBuffer(restored.recordset?.[0]?.CheckHash)
    && restored.recordset[0].CheckHash.equals(originalFingerprint)
    && (restored.recordset[0].is_not_trusted === false || Number(restored.recordset[0].is_not_trusted) === 0),
  'fixture-only CHECK restoration must match the captured definition/fingerprint and be trusted');
  await applyMigration(pool, source);
  console.log('ok - column and weakened same-name CHECK drift are rejected; original trusted CHECK restored from catalog definition');
}

async function testERPObjectsUnchanged(pool, expected) {
  assert.deepEqual(await sentinelSnapshot(pool), expected,
    'WarehouseMaster, TempWarehouseDetail, KeyNumbering, or mock usp_CreateWarehouse changed');
  const extra = await query(pool, `SELECT COUNT(*) AS TriggerCount FROM sys.triggers WHERE parent_class=1 AND is_ms_shipped=0;`);
  ensure(Number(extra.recordset?.[0]?.TriggerCount) === 0, 'migration must not add fixture ERP-table triggers');
  console.log('ok - ERP sentinel rows and mock usp_CreateWarehouse definition are unchanged; no table triggers added');
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) { usage(); return; }
  const migration = readMigration();
  const { password, image } = inspectApprovedContainer();
  const database = newDatabaseName();
  let master;
  let pool;
  let created = false;
  try {
    master = await new sql.ConnectionPool({ user: 'sa', password, server: HOST, port: PORT, database: 'master',
      options: { encrypt: false, trustServerCertificate: true, enableArithAbort: true },
      pool: { min: 0, max: 1, idleTimeoutMillis: 60000 }, connectionTimeout: 5000, requestTimeout: 15000 }).connect();
    const collision = await query(master, 'SELECT DB_ID(@name) AS ExistingId;', { name: { type: sql.NVarChar(128), value: database } });
    ensure(collision.recordset?.[0]?.ExistingId == null, 'unique fixture database name unexpectedly exists; refusing to reuse it');
    await query(master, `CREATE DATABASE ${bracketFixtureDatabase(database)};`);
    created = true;
    await query(master, `ALTER DATABASE ${bracketFixtureDatabase(database)} SET COMPATIBILITY_LEVEL=130;`);
    pool = await new sql.ConnectionPool({ user: 'sa', password, server: HOST, port: PORT, database,
      options: { encrypt: false, trustServerCertificate: true, enableArithAbort: true },
      pool: { min: 0, max: 1, idleTimeoutMillis: 60000 }, connectionTimeout: 5000, requestTimeout: 60000 }).connect();
    await query(pool, `SET LOCK_TIMEOUT 5000; SET XACT_ABORT ON;`);
    const level = await query(pool, `SELECT compatibility_level FROM sys.databases WHERE name=DB_NAME();`);
    ensure(Number(level.recordset?.[0]?.compatibility_level) === 130, 'fixture database compatibility must be 130');
    await createSentinels(pool);
    const sentinels = await sentinelSnapshot(pool);
    await testPartialSchemaRefusal(pool, migration);

    await applyMigration(pool, migration);
    await assertEmptyTables(pool);
    await applyMigration(pool, migration);
    await assertEmptyTables(pool);
    console.log(`SETUP: image=${image}, endpoint=${HOST}:${PORT}, database=${database}, compatibility=130, migration=apply+reapply`);
    console.log('SCHEMA: fixture inserts and assertions follow the current V1 migration columns and constraints.');
    console.log('ok - migration creates exactly six empty web tables and exact V1 reapply is a no-op');

    await testStorageContracts(pool);
    await testOperationsHistoryAndCost(pool);
    await testRollback(pool);
    await testInstalledSchemaDrift(pool, migration);
    await testERPObjectsUnchanged(pool, sentinels);
    console.log('PASS: isolated invoice web-storage SQL fixture scenarios completed.');
  } finally {
    await pool?.close().catch(() => {});
    if (master && created) {
      // This exact guarded name was checked absent and created by this invocation.
      await query(master, `ALTER DATABASE ${bracketFixtureDatabase(database)} SET SINGLE_USER WITH ROLLBACK IMMEDIATE;
        DROP DATABASE ${bracketFixtureDatabase(database)};`).catch(error => {
        console.error(`FIXTURE_CLEANUP_FAILED: database=${database}; ${error.message}`);
        process.exitCode = 1;
      });
    }
    await master?.close().catch(() => {});
  }
}

main().catch(error => {
  // Do not dump SQL connection options, docker inspect output, or any credential-bearing value.
  console.error(error?.message || 'fixture failed');
  process.exitCode = 1;
});
