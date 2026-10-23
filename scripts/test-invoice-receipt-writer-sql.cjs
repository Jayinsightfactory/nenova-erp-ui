#!/usr/bin/env node
/*
 * Isolated actual-SQL fixture for the invoice receipt writer.
 * No app configuration, .env, caller-supplied connection override, or production
 * connection is supported. The only dropped database is this invocation's
 * unique, absent-at-creation NenovaInvoiceFixture_* database.
 *
 * This is a web writer SQL integration test, not an execution of native
 * CommonLogic.CheckFixSave. Native CreateWarehouse/GetNextKey and stock gate
 * definitions are installed only in this isolated fixture database.
 */
'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { spawnSync } = require('node:child_process');
const sql = require('mssql');

const ROOT = path.resolve(__dirname, '..');
const CONTAINER = 'nenova-estimate-sql-test-20260826';
const HOST = '127.0.0.1';
const PORT = 14339;
const FIXTURE_COLLATION = 'Korean_Wansung_CI_AS';
const DB_PREFIX = 'NenovaInvoiceFixture_';
const SCHEMA_FILE = path.join(ROOT, '__tests__', 'fixtures', 'invoiceReceiptSchema.sql');
const MIGRATION_FILE = path.join(ROOT, 'docs', 'migrations', '2026-10-08_web_invoice_storage_v1.sql');
const CREATE_WAREHOUSE_FILE = path.join(ROOT, '__tests__', 'fixtures', 'invoiceNative_usp_CreateWarehouse.sql');
const NEXT_KEY_FILE = path.join(ROOT, '__tests__', 'fixtures', 'invoiceNative_usp_GetNextKey.sql');
const VIEW_ORDER_FILE = path.join(ROOT, '__tests__', 'fixtures', 'invoiceNative_ViewOrder.sql');
const GATE_FILE = path.join(ROOT, '__tests__', 'fixtures', 'orderStockCalculationNative.sql');
const WRITER_FILE = path.join(ROOT, 'lib', 'invoiceReceiptWriter.js');
const DOCUMENTS_FILE = path.join(ROOT, 'lib', 'invoiceReceiptDocuments.js');
const COST_FILE = path.join(ROOT, 'lib', 'invoiceReceiptCost.js');
const NATIVE_HASHES = {
  usp_CreateWarehouse: 'C52523F2A5735B9420E845AE601B3E3F730205E99DFD9309FEF29C8325C23BD8',
  usp_GetNextKey: '2CAA094745C908F29E31702EE1C563EF7C34C2AFA28B48E0A1A604D08A2A7418',
};
const TABLES = [
  'WebInvoiceDocument', 'WebInvoiceLine', 'WebInvoiceOperation', 'WebInvoiceHistory',
  'WebInvoiceCostRevision', 'WebInvoiceCostLine',
];
const DOC = '10000000-0000-4000-8000-000000000101';
const DOC_FAIL = '10000000-0000-4000-8000-000000000102';
const DOC_BUSY = '10000000-0000-4000-8000-000000000103';
const DOC_CONCURRENT_SAME = '10000000-0000-4000-8000-000000000104';
const DOC_CONCURRENT_DIFFERENT = '10000000-0000-4000-8000-000000000105';
const DOC_RESPONSE_LOST = '10000000-0000-4000-8000-000000000106';
const DOC_ORDER_VIEW = '10000000-0000-4000-8000-000000000107';
const DOC_COST_DUPLICATE = '10000000-0000-4000-8000-000000000108';
const LINE_A = '20000000-0000-4000-8000-000000000101';
const LINE_B = '20000000-0000-4000-8000-000000000102';
const OP_A = '30000000-0000-4000-8000-000000000101';
const OP_B = '30000000-0000-4000-8000-000000000102';
const OP_FAIL = '30000000-0000-4000-8000-000000000103';
const OP_BUSY = '30000000-0000-4000-8000-000000000104';
const OP_QUANTITY = '30000000-0000-4000-8000-000000000105';
const OP_PRICE_ONLY = '30000000-0000-4000-8000-000000000106';
const OP_CONCURRENT_SAME = '30000000-0000-4000-8000-000000000107';
const OP_CONCURRENT_DIFFERENT_A = '30000000-0000-4000-8000-000000000108';
const OP_CONCURRENT_DIFFERENT_B = '30000000-0000-4000-8000-000000000109';
const OP_RESPONSE_LOST = '30000000-0000-4000-8000-000000000110';
const OP_ORDER_VIEW = '30000000-0000-4000-8000-000000000111';
const OP_COST_DUPLICATE = '30000000-0000-4000-8000-000000000112';
const PART_A = '40000000-0000-4000-8000-000000000101';
const PART_B = '40000000-0000-4000-8000-000000000102';
const PART_FAIL = '40000000-0000-4000-8000-000000000103';
const PART_BUSY = '40000000-0000-4000-8000-000000000104';
const PART_CONCURRENT_SAME = '40000000-0000-4000-8000-000000000105';
const PART_CONCURRENT_DIFFERENT_A = '40000000-0000-4000-8000-000000000106';
const PART_CONCURRENT_DIFFERENT_B = '40000000-0000-4000-8000-000000000107';
const PART_RESPONSE_LOST = '40000000-0000-4000-8000-000000000108';
const PART_ORDER_VIEW = '40000000-0000-4000-8000-000000000109';
const PART_COST_DUPLICATE = '40000000-0000-4000-8000-000000000110';
let currentStage = 'startup';
let secretToRedact = '';

function fail(message) { throw new Error(`[invoice-receipt-writer-sql-fixture] ${message}`); }
function ensure(condition, message) { if (!condition) fail(message); }
function stage(name) {
  currentStage = name;
  console.log(`STAGE: ${name}`);
}
function safeLogString(value) {
  let text = String(value ?? '');
  if (secretToRedact) text = text.split(secretToRedact).join('[REDACTED]');
  return text.replace(/(password\s*[:=]\s*)[^\s,;]+/ig, '$1[REDACTED]');
}
function logFailure(error) {
  const info = error?.originalError?.info || error?.info || error?.originalError || error;
  const preceding = error?.precedingErrors || error?.originalError?.precedingErrors;
  const detail = {
    stage: currentStage,
    name: safeLogString(error?.name || 'Error'),
    message: safeLogString(error?.message || 'invoice receipt writer fixture failed'),
    code: safeLogString(error?.code || ''),
    number: Number.isFinite(error?.number ?? info?.number) ? (error?.number ?? info?.number) : null,
    procName: safeLogString(error?.procName || error?.procedure || info?.procName || info?.procedure || ''),
    lineNumber: Number.isFinite(error?.lineNumber ?? info?.lineNumber) ? (error?.lineNumber ?? info?.lineNumber) : null,
    state: Number.isFinite(error?.state ?? info?.state) ? (error?.state ?? info?.state) : null,
    class: Number.isFinite(error?.class ?? info?.class) ? (error?.class ?? info?.class) : null,
    stack: safeLogString(error?.stack || ''),
    precedingErrors: Array.isArray(preceding) ? preceding.map(item => ({
      message: safeLogString(item?.message || ''),
      number: Number.isFinite(item?.number) ? item.number : null,
      procName: safeLogString(item?.procName || ''),
      lineNumber: Number.isFinite(item?.lineNumber) ? item.lineNumber : null,
    })) : [],
  };
  console.error('FIXTURE_ERROR:', JSON.stringify(detail));
}

function parseArgs(argv) {
  if (argv.length === 3 && (argv[2] === '--help' || argv[2] === '-h')) return { help: true };
  if (argv.length !== 2) fail('no arguments are accepted (especially database, host, or credential overrides)');
  return { help: false };
}

function usage() {
  console.log('Usage: node scripts/test-invoice-receipt-writer-sql.cjs');
  console.log('Creates and drops one new NenovaInvoiceFixture_* DB on the approved loopback SQL2022 container.');
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
  const portBindings = info.HostConfig?.PortBindings || {};
  const published = Object.entries(portBindings).flatMap(([containerPort, bindings]) =>
    (bindings || []).map(binding => ({ containerPort, ...binding })));
  ensure(Object.keys(portBindings).every(port => port === '1433/tcp') && published.length === 1
    && published[0].HostIp === HOST && String(published[0].HostPort) === String(PORT),
  'fixture must have exactly one published SQL port on the approved loopback endpoint');
  const env = new Map((info.Config?.Env || []).map(entry => {
    const at = String(entry).indexOf('=');
    return [at < 0 ? String(entry) : entry.slice(0, at), at < 0 ? '' : entry.slice(at + 1)];
  }));
  const password = env.get('MSSQL_SA_PASSWORD');
  ensure(typeof password === 'string' && password.length > 0, 'fixture SA credential is unavailable');
  // Password is retained in process memory only and never printed or placed in an error.
  return { password, image: info.Config.Image };
}

function assertDatabaseName(name) {
  ensure(/^NenovaInvoiceFixture_[0-9]{8}_[0-9a-f]{12}$/.test(name), 'fixture database name guard failed');
}

function newDatabaseName() {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const name = `${DB_PREFIX}${date}_${crypto.randomBytes(6).toString('hex')}`;
  assertDatabaseName(name);
  return name;
}

function bracketDatabase(name) { assertDatabaseName(name); return `[${name}]`; }
function splitBatches(source) { return source.split(/^\s*GO\s*;?\s*$/gim).map(batch => batch.trim()).filter(Boolean); }

function readNativeDefinition(file) {
  // Rebuild the captured native CRLF text exactly; its trailing newline is
  // part of the verified definition hash.
  return fs.readFileSync(file, 'utf8').replace(/\r?\n/g, '\r\n');
}

function readInputs() {
  for (const file of [SCHEMA_FILE, MIGRATION_FILE, CREATE_WAREHOUSE_FILE, NEXT_KEY_FILE, VIEW_ORDER_FILE, GATE_FILE, WRITER_FILE, DOCUMENTS_FILE, COST_FILE]) {
    ensure(fs.existsSync(file), `required writer/fixture input is missing: ${path.relative(ROOT, file)}`);
  }
  const schema = fs.readFileSync(SCHEMA_FILE, 'utf8');
  ensure(schema.includes("DB_NAME() NOT LIKE N'NenovaInvoiceFixture[_]%'" )
    && /WdetailKey\s+int\s+IDENTITY/i.test(schema)
    && /Stock\s+float/i.test(schema)
    && /CREATE TABLE dbo\.TempWarehouseDetail/i.test(schema),
  'fixture schema prefix or native ERP schema markers are missing');
  const migration = fs.readFileSync(MIGRATION_FILE, 'utf8');
  for (const table of TABLES) ensure(new RegExp(`CREATE\\s+TABLE\\s+dbo\\.${table}`, 'i').test(migration),
    `web migration does not define ${table}`);
  ensure(/NenovaWebInvoiceV1CheckHash/.test(migration) && /SHA2_256/i.test(migration),
    'web migration fingerprint checks are missing');
  const writerSource = fs.readFileSync(WRITER_FILE, 'utf8');
  ensure(/export\s+async\s+function\s+createInvoiceReceipt\b/.test(writerSource)
    && /export\s+async\s+function\s+previewInvoiceReceipt\b/.test(writerSource),
  'writer must export createInvoiceReceipt and previewInvoiceReceipt');
  ensure(!/dotenv|process\.env|\.env\b/i.test(writerSource),
    'writer fixture target must not load production/app environment configuration');
  const costSource = fs.readFileSync(COST_FILE, 'utf8');
  ensure(!/dotenv|process\.env|\.env\b/i.test(costSource),
    'cost fixture target must not load production/app environment configuration');
  return {
    schema,
    migration,
    createWarehouse: readNativeDefinition(CREATE_WAREHOUSE_FILE),
    nextKey: readNativeDefinition(NEXT_KEY_FILE),
    viewOrder: fs.readFileSync(VIEW_ORDER_FILE, 'utf8'),
    gateSql: fs.readFileSync(GATE_FILE, 'utf8'),
    writerSource,
    costSource,
  };
}

function request(executor, params = {}, timeoutMs = 60000) {
  const req = new sql.Request(executor);
  req.timeout = timeoutMs;
  for (const [name, spec] of Object.entries(params)) req.input(name, spec.type, spec.value);
  return req;
}
function query(executor, statement, params = {}, timeoutMs = 60000) {
  return request(executor, params, timeoutMs).query(statement).catch(error => {
    const sqlText = safeLogString(statement);
    const parameterTypes = Object.entries(params).map(([name, spec]) => ({
      name: safeLogString(name),
      type: safeLogString(spec?.type?.name || spec?.type?.declaration || (typeof spec?.type === 'function' ? spec.type.name : typeof spec?.type)),
    }));
    console.error('SQL_FAILURE_CONTEXT:', JSON.stringify({
      stage: currentStage,
      statementPrefix: sqlText.slice(0,500),
      statementTruncated: sqlText.length>500,
      parameterTypes,
    }));
    if (Object.prototype.hasOwnProperty.call(params,'date') && /@date\b/i.test(statement)) {
      const value = params.date?.value;
      const rendered = value instanceof Date ? value.toISOString() : String(value);
      console.error('DATE_PARAM_FAILURE:', JSON.stringify({
        runtimeType: typeof value,
        stringValue: safeLogString(rendered),
      }));
    }
    throw error;
  });
}
async function runBatches(executor, source, label = 'SQL script') {
  const batches = splitBatches(source);
  for (let index = 0; index < batches.length; index += 1) {
    stage(`${label} batch ${index + 1}/${batches.length}`);
    await query(executor, batches[index]);
  }
}

function withTransactionFn(pool) {
  return async (callback, options = {}) => {
    const tx = new sql.Transaction(pool);
    await tx.begin(sql.ISOLATION_LEVEL.READ_COMMITTED);
    let committed = false;
    try {
      const value = await callback((statement, params = {}) => query(tx, statement, params, options.requestTimeout || 60000));
      await tx.commit();
      committed = true;
      return value;
    } finally {
      if (!committed) await tx.rollback().catch(() => {});
    }
  };
}

function firstProcedureBatch(source, procedureName) {
  const pattern = new RegExp(`\\bCREATE\\s+(?:OR\\s+ALTER\\s+)?PROCEDURE\\s+(?:(?:dbo|\\[dbo\\])\\.)?\\[?${procedureName}\\]?\\b`, 'i');
  return splitBatches(source).find(batch => pattern.test(batch));
}

async function installNativeObjects(pool, inputs) {
  // These procedure definitions are fixture-only. They are never submitted anywhere else.
  stage('install native usp_CreateWarehouse');
  await query(pool, inputs.createWarehouse);
  stage('install native usp_GetNextKey');
  await query(pool, inputs.nextKey);
  stage('install captured ViewOrder');
  const viewOrder = splitBatches(inputs.viewOrder).find(batch => /CREATE\s+VIEW\s+\[?dbo\]?\.\[?ViewOrder\]?/i.test(batch));
  ensure(viewOrder, 'captured ViewOrder definition is missing');
  await query(pool, viewOrder);
  for (const name of ['usp_NenovaStockWeekGateEnter', 'usp_NenovaStockWeekGateLeave', 'usp_StockCalculation']) {
    stage(`install native ${name}`);
    const batch = firstProcedureBatch(inputs.gateSql, name);
    ensure(batch, `native stock gate/calculation definition is missing ${name}`);
    await query(pool, batch);
  }
  stage('verify captured native definition hashes');
  const hashes = await query(pool, `SELECT
    CONVERT(varchar(64),HASHBYTES('SHA2_256',OBJECT_DEFINITION(OBJECT_ID(N'dbo.usp_CreateWarehouse'))),2) CreateWarehouseHash,
    CONVERT(varchar(64),HASHBYTES('SHA2_256',OBJECT_DEFINITION(OBJECT_ID(N'dbo.usp_GetNextKey'))),2) NextKeyHash;`);
  const row = hashes.recordset?.[0];
  ensure(row?.CreateWarehouseHash === NATIVE_HASHES.usp_CreateWarehouse
    && row?.NextKeyHash === NATIVE_HASHES.usp_GetNextKey,
  `fixture native definition hash mismatch: CreateWarehouse=${row?.CreateWarehouseHash || 'missing'}, GetNextKey=${row?.NextKeyHash || 'missing'}`);
  stage('verify ViewOrder and stock-gate capability');
  const viewHash = await query(pool, `SELECT OBJECT_DEFINITION(OBJECT_ID(N'dbo.ViewOrder',N'V')) AS Definition;`);
  ensure(typeof viewHash.recordset?.[0]?.Definition === 'string', 'fixture ViewOrder was not installed');
  const ready = await query(pool, 'EXEC dbo.usp_NenovaStockWeekGateCapability;');
  ensure(Number(ready.recordset?.[0]?.ProtocolVersion) === 2
    && [1,true].includes(ready.recordset?.[0]?.IsReady), 'fixture gate capability must report V2 ready');
}

async function seedSentinelsAndRows(pool) {
  stage('seed supporting master, stock and warehouse rows');
  await query(pool, `INSERT dbo.UserInfo(UserID,UserName) VALUES(N'invoice-fixture',N'Invoice Fixture');
    INSERT dbo.Country(CounName,isUseOrderCode) VALUES(N'중국',0);
    INSERT dbo.Customer(CustKey,CustName,CustArea,Manager,Descr) VALUES(7001,N'Fixture Customer',N'LOCAL',N'invoice-fixture',N'fixture');
    INSERT dbo.Farm(FarmKey,FarmName,CounKey,isDeleted) VALUES(7101,N'Fixture Farm',1,0);
    INSERT dbo.Product(ProdKey,ProdName,CountryFlower,CounName,FlowerName,OutUnit,EstUnit,Stock,isDeleted)
      VALUES(7201,N'Invoice Same Product',N'ORCHID',N'중국',N'ORCHID',N'단',N'단',20,0),
            (7202,N'Unchanged Fixture Product',N'ROSE',N'중국',N'ROSE',N'단',N'단',80,0);
    INSERT dbo.KeyNumbering(Category,LastKeyNo,Descr) VALUES(N'WarehouseKey',91000,N'fixture');
    INSERT dbo.StockMaster(StockKey,OrderYear,OrderWeek,OrderYearWeek,Descr,isFix,CreateID)
      VALUES(2501,N'2025',N'41-01',N'20254101',N'prior same week',1,N'fixture'),
            (2601,N'2026',N'41-01',N'20264101',N'current',1,N'fixture'),
            (2701,N'2027',N'01-01',N'20270101',N'next year',1,N'fixture');
    INSERT dbo.ProductStock(StockKey,ProdKey,Stock) VALUES(2501,7201,30),(2501,7202,40),(2701,7201,0),(2701,7202,40);
    INSERT dbo.WarehouseMaster(WarehouseKey,UploadDtm,FileName,OrderYear,OrderWeek,FarmName,InvoiceNo,InputDate,OrderNo,isDeleted,CreateID,CreateDtm)
      VALUES(2702,CONVERT(datetime,'2027-01-01T00:00:00',126),N'fixture-next.xlsx',N'2027',N'01-01',N'Fixture Farm',N'NEXT',
               CONVERT(datetime,'2027-01-01T00:00:00',126),N'NEXT',0,N'fixture',GETDATE()),
            (9900,CONVERT(datetime,'2026-10-01T00:00:00',126),N'staging-sentinel.xlsx',N'2026',N'10-01',N'Fixture Farm',N'SENTINEL',
               CONVERT(datetime,'2026-10-01T00:00:00',126),N'SENTINEL',0,N'fixture',GETDATE());
    INSERT dbo.WarehouseDetail(WarehouseKey,ProdKey,BoxQuantity,BunchQuantity,SteamQuantity,OutQuantity,EstQuantity,UPrice,TPrice)
      VALUES(2702,7201,0,2,2,2,2,5,10);
    INSERT dbo.TempWarehouseDetail(ProdName,BoxQuantity,BunchQuantity,SteamQuantity,OutQuantity,EstQuantity,UPrice,TPrice,Stock,OrderCode,WarehouseKey,SteamOf1Box,SteamOf1Bunch)
      VALUES(N'not-a-product-stage-sentinel-1',0,0,0,0,0,0,0,0,N'SENTINEL-1',9900,0,0),
            (N'not-a-product-stage-sentinel-2',0,0,0,0,0,0,0,0,N'SENTINEL-2',9900,0,0),
            (N'not-a-product-stage-sentinel-3',0,0,0,0,0,0,0,0,N'SENTINEL-3',9900,0,0),
            (N'not-a-product-stage-sentinel-4',0,0,0,0,0,0,0,0,N'SENTINEL-4',9900,0,0);`);
  stage('seed cross-year OrderMaster and OrderDetail rows for ViewOrder reconciliation');
  await query(pool, `INSERT dbo.OrderMaster(OrderMasterKey,OrderYear,OrderWeek,OrderYearWeek,CustKey,Manager,OrderCode,Descr)
      VALUES(8001,N'2025',N'41-01',N'20254101',7001,N'invoice-fixture',N'PREV',N'prior same week'),
            (8002,N'2026',N'41-01',N'20264101',7001,N'invoice-fixture',N'CURR',N'current');
    INSERT dbo.OrderDetail(OrderDetailKey,OrderMasterKey,ProdKey,BoxQuantity,BunchQuantity,SteamQuantity,OutQuantity,EstQuantity,NoneOutQuantity)
      VALUES(8101,8001,7201,0,10,10,10,10,0),(8102,8002,7201,0,100,100,100,100,0);`);
}

async function insertDocument(pool, documentId, invoiceNo, quantities = [2, 3]) {
  await query(pool, `INSERT dbo.WebInvoiceDocument
    (DocumentId,OrderYear,OrderWeek,Revision,FarmKey,InvoiceNo,InvoiceYear,SourceHash,OriginalFileName,BusinessKeyHash,
     ReceiptStatus,CostStatus,RawMetadataJson,ReviewedMetadataJson,CreatedBy,CreatedAt,UpdatedBy,UpdatedAt)
    VALUES(@id,N'2026',N'41-01',1,7101,@invoiceNo,N'2026',@sourceHash,N'fixture-invoice.pdf',NULL,
      N'DRAFT',N'PENDING',N'{"fixture":true}',N'{"country":"CN","farmName":"Fixture Farm","inputDate":"2026-10-08","transportMode":"SEA"}',
      N'invoice-fixture',SYSUTCDATETIME(),N'invoice-fixture',SYSUTCDATETIME());`, {
    id: { type: sql.UniqueIdentifier, value: documentId },
    invoiceNo: { type: sql.NVarChar(100), value: invoiceNo },
    sourceHash: { type: sql.Binary(32), value: Buffer.from('11'.repeat(32),'hex') },
  });
  ensure(Array.isArray(quantities) && quantities.length === 2 && quantities.every(value => Number.isFinite(value) && value > 0),
    'fixture document quantities must contain two positive numeric values');
  const lines = [
    { id: LINE_A, no: 1, quantity: quantities[0], unitPrice: 100, amount: quantities[0] * 100 },
    { id: LINE_B, no: 2, quantity: quantities[1], unitPrice: 200, amount: quantities[1] * 200 },
  ];
  for (const line of lines) await query(pool, `INSERT dbo.WebInvoiceLine
    (DocumentId,Revision,LineId,[LineNo],OriginalName,LengthText,ProdKey,BoxQuantity,BunchQuantity,StemQuantity,
     PriceUnit,UnitPrice,Currency,LineAmount,SourceEvidenceJson,ReviewedJson)
    VALUES(@documentId,1,@lineId,@lineNo,N'Invoice Same Product',N'50cm',7201,NULL,@quantity,NULL,
      N'단',@unitPrice,N'USD',@lineAmount,N'{"source":"fixture"}',N'{"unit":"단"}');`, {
    documentId: { type: sql.UniqueIdentifier, value: documentId },
    lineId: { type: sql.UniqueIdentifier, value: line.id },
    lineNo: { type: sql.Int, value: line.no },
    quantity: { type: sql.Decimal(18,6), value: line.quantity },
    unitPrice: { type: sql.Decimal(18,6), value: line.unitPrice },
    lineAmount: { type: sql.Decimal(18,6), value: line.amount },
  });
}

async function rows(pool, table, orderBy) {
  return (await query(pool, `SELECT * FROM dbo.[${table}] ORDER BY ${orderBy};`)).recordset;
}
async function protectedSnapshot(pool) {
  return {
    temp: await rows(pool,'TempWarehouseDetail','WdetailKey'),
    orders: await rows(pool,'OrderDetail','OrderDetailKey'),
    orderMasters: await rows(pool,'OrderMaster','OrderMasterKey'),
    shipmentDetails: await rows(pool,'ShipmentDetail','SdetailKey'),
    shipmentMasters: await rows(pool,'ShipmentMaster','ShipmentKey'),
  };
}
async function stockSnapshot(pool) {
  return {
    product: await rows(pool,'Product','ProdKey'),
    productStock: await rows(pool,'ProductStock','StockKey,ProdKey'),
    history: await rows(pool,'StockHistory','StockHistoryKey'),
    warehouse: await rows(pool,'WarehouseMaster','WarehouseKey'),
    detail: await rows(pool,'WarehouseDetail','WdetailKey'),
    keyNumbering: await rows(pool,'KeyNumbering','Category'),
  };
}

function writerContext(pool, writer) {
  return {
    types: sql,
    queryFn: (statement, params = {}) => query(pool, statement, params),
    withTransactionFn: withTransactionFn(pool),
    preview: (documentId, revision = 1) => writer.previewInvoiceReceipt({
      queryFn: (statement, params = {}) => query(pool, statement, params), types: sql, documentId, revision,
    }),
    create: args => writer.createInvoiceReceipt({
      withTransactionFn: withTransactionFn(pool),
      queryFn: (statement, params = {}) => query(pool, statement, params),
      types: sql, ...args,
    }),
  };
}

async function commitArgs(ctx, documentId, operationId, receiptPartId, baselineDigest, revision = 1) {
  return ctx.create({ documentId, revision, operationId, receiptPartId, baselineDigest,
    reason: 'isolated SQL writer fixture', allowPendingCost: true, actor: 'invoice-fixture' });
}

async function testWriterSuccessReplayAndCrossYear(pool, writer, documents, initialProtected) {
  await insertDocument(pool,DOC,'WRITER-SUCCESS');
  const ctx = writerContext(pool,writer);
  const preview = await ctx.preview(DOC,1);
  ensure(preview?.canCommit === true && typeof preview.baselineDigest === 'string' && preview.baselineDigest.length > 0,
    'positive fixture must produce a commit-capable preview with a baseline digest');
  await commitArgs(ctx,DOC,OP_A,PART_A,preview.baselineDigest);
  const operation = (await query(pool,`SELECT Status,WarehouseKey FROM dbo.WebInvoiceOperation WHERE OperationId=@id;`,{
    id:{type:sql.UniqueIdentifier,value:OP_A},
  })).recordset?.[0];
  ensure(operation?.Status === 'COMMITTED' && Number(operation.WarehouseKey)>0,
    'successful writer operation must persist COMMITTED and a positive WarehouseKey');
  const firstDetails = await query(pool,`SELECT ProdKey,BunchQuantity,UPrice,TPrice,OutQuantity
    FROM dbo.WarehouseDetail WHERE WarehouseKey=@warehouseKey ORDER BY UPrice,WdetailKey;`,{
    warehouseKey:{type:sql.Int,value:operation.WarehouseKey},
  });
  ensure(firstDetails.recordset?.length===2 && firstDetails.recordset.every(row=>Number(row.ProdKey)===7201),
    'two source price lines for the same product must remain two warehouse details');
  ensure(firstDetails.recordset.map(row=>Number(row.UPrice)).sort((a,b)=>a-b).join(',')==='100,200',
    'same-product line prices must be preserved independently');
  ensure(firstDetails.recordset.reduce((sum,row)=>sum+Number(row.OutQuantity),0)===5,
    'same-product receipt quantity should be the sum of both source lines');

  const product = (await query(pool,'SELECT Stock FROM dbo.Product WHERE ProdKey=7201;')).recordset?.[0];
  ensure(Math.abs(Number(product?.Stock)-25)<0.00001,
    'web writer must match native CreateWarehouse Product.Stock baseline + 5');
  const history = (await query(pool,`SELECT BeforeValue,AfterValue FROM dbo.StockHistory
    WHERE ProdKey=7201 AND OrderYear=N'2026' AND OrderWeek=N'41-01' ORDER BY StockHistoryKey DESC;`)).recordset?.[0];
  ensure(history && Math.abs(Number(history.BeforeValue)-20)<0.00001 && Math.abs(Number(history.AfterValue)-25)<0.00001,
    'web writer must emit native-compatible stock history values');
  const crossYear = await query(pool,`SELECT sm.OrderYear,ps.Stock FROM dbo.ProductStock ps
    JOIN dbo.StockMaster sm ON sm.StockKey=ps.StockKey WHERE ps.ProdKey=7201 ORDER BY sm.OrderYearWeek;`);
  ensure(crossYear.recordset?.length===3
    && Math.abs(Number(crossYear.recordset[0].Stock)-30)<0.00001
    && Math.abs(Number(crossYear.recordset[1].Stock)-35)<0.00001
    && Math.abs(Number(crossYear.recordset[2].Stock)-37)<0.00001,
  'stock cascade must use the immediately prior 2025 row, current receipt, and 2027 neighbor without same-week year collision');

  await commitArgs(ctx,DOC,OP_A,PART_A,preview.baselineDigest);
  const replayCount = await query(pool,`SELECT COUNT_BIG(*) CountRows FROM dbo.WebInvoiceOperation WHERE DocumentId=@id;`,{
    id:{type:sql.UniqueIdentifier,value:DOC},
  });
  const detailCount = await query(pool,`SELECT COUNT_BIG(*) CountRows FROM dbo.WarehouseDetail WHERE WarehouseKey=@warehouseKey;`,{
    warehouseKey:{type:sql.Int,value:operation.WarehouseKey},
  });
  ensure(Number(replayCount.recordset?.[0]?.CountRows)===1 && Number(detailCount.recordset?.[0]?.CountRows)===2,
    'same operation UUID/request replay must return without duplicating rows');

  // A new operation UUID cannot re-register the already committed same revision.
  const secondPreview = await ctx.preview(DOC,1);
  ensure(secondPreview?.canCommit===false && secondPreview.issues?.some(issue=>issue.code==='ALREADY_COMMITTED'),
    'a different operation UUID on the same committed document revision must be blocked by preview');
  let differentOperationError;
  try { await commitArgs(ctx,DOC,OP_B,PART_B,secondPreview.baselineDigest); } catch(error) { differentOperationError=error; }
  ensure(differentOperationError?.code==='ALREADY_COMMITTED',
    `different operation UUID on the same committed revision must reject with ALREADY_COMMITTED, got ${differentOperationError?.code||'no code'}`);
  const stillSingle=(await query(pool,`SELECT COUNT_BIG(*) OperationCount FROM dbo.WebInvoiceOperation WHERE DocumentId=@id;`,{
    id:{type:sql.UniqueIdentifier,value:DOC},
  })).recordset?.[0];
  ensure(Number(stillSingle?.OperationCount)===1,'different operation UUID must not create a second receipt for the same revision');

  await testNativeCreateWarehouseReference(pool,await stockSnapshot(pool));
  await testQuantityUpdateDelta(pool,writer,documents);
  assert.deepEqual(await protectedSnapshot(pool),initialProtected,
    'writer must preserve four TempWarehouseDetail sentinels and all order/shipment rows');
  console.log('ok - writer success/replay, different-operation refusal, same-product prices, native stock parity, and cross-year cascade');
}

async function testNativeCreateWarehouseReference(pool, initialStock) {
  const tx = new sql.Transaction(pool);
  await tx.begin(sql.ISOLATION_LEVEL.READ_COMMITTED);
  try {
    // Native usp_CreateWarehouse consumes every TempWarehouseDetail row, not
    // just the requested WarehouseKey. Isolate its inputs inside this
    // rollback-only transaction; the original staging sentinels are restored
    // automatically by the rollback below.
    await query(tx,`DELETE dbo.TempWarehouseDetail;
      UPDATE dbo.Product SET Stock=20 WHERE ProdKey=7201;
      INSERT dbo.WarehouseMaster(WarehouseKey,UploadDtm,FileName,OrderYear,OrderWeek,FarmName,InvoiceNo,InputDate,OrderNo,isDeleted)
      VALUES(99901,GETDATE(),N'native-reference.xlsx',N'2026',N'41-01',N'Fixture Farm',N'NATIVE-REF',GETDATE(),N'REF',0);
      INSERT dbo.TempWarehouseDetail(ProdName,BoxQuantity,BunchQuantity,SteamQuantity,OutQuantity,EstQuantity,UPrice,TPrice,
        Stock,OrderCode,WarehouseKey,SteamOf1Box,SteamOf1Bunch)
      VALUES(N'Invoice Same Product',0,2,0,NULL,NULL,100,200,0,N'REF-1',99901,0,0),
            (N'Invoice Same Product',0,3,0,NULL,NULL,200,600,0,N'REF-2',99901,0,0);`);
    const referenceInputs=(await query(tx,`SELECT WdetailKey,ProdName,ProdKey,BunchQuantity,OutQuantity,WarehouseKey
      FROM dbo.TempWarehouseDetail ORDER BY WdetailKey;`)).recordset;
    ensure(referenceInputs?.length===2
      && referenceInputs.every(row=>row.WarehouseKey===99901&&row.ProdName==='Invoice Same Product')
      && referenceInputs.reduce((sum,row)=>sum+Number(row.BunchQuantity),0)===5,
    'native reference must receive only its two same-product quantity rows inside the rollback transaction');
    const nativeUnit=(await query(tx,`SELECT CONVERT(nvarchar(128),DATABASEPROPERTYEX(DB_NAME(),'Collation')) DatabaseCollation,
        p.OutUnit NativeOutUnit,
        CASE WHEN p.OutUnit='박스' THEN N'BoxQuantity'
             WHEN p.OutUnit='단' THEN N'BunchQuantity'
             ELSE N'SteamQuantity' END NativeQuantityBranch
      FROM dbo.Product p WHERE p.ProdKey=7201;`)).recordset?.[0];
    console.log('NATIVE_UNIT_COLLATION_DIAGNOSTIC:',JSON.stringify(nativeUnit));
    ensure(nativeUnit?.DatabaseCollation===FIXTURE_COLLATION&&nativeUnit?.NativeOutUnit==='단'
      &&nativeUnit?.NativeQuantityBranch==='BunchQuantity',
    'native fixture must evaluate the captured Korean unit literal through the Korean database collation');
    const result = await query(tx,`DECLARE @o int=NULL,@r int=NULL;
      EXEC @r=dbo.usp_CreateWarehouse @iUserID=N'invoice-fixture',@oResult=@o OUTPUT;
      SELECT @r ReturnCode,@o ResultCode;`);
    ensure(Number(result.recordset?.[0]?.ReturnCode)===0 && Number(result.recordset[0].ResultCode)===0,
      'captured native usp_CreateWarehouse positive reference must return success');
    const stock = Number((await query(tx,'SELECT Stock FROM dbo.Product WHERE ProdKey=7201;')).recordset?.[0]?.Stock);
    if(Math.abs(stock-25)>=0.00001){
      const diagnostic={
        nativeUnit:(await query(tx,`SELECT CONVERT(nvarchar(128),DATABASEPROPERTYEX(DB_NAME(),'Collation')) DatabaseCollation,
          p.OutUnit NativeOutUnit,CASE WHEN p.OutUnit='박스' THEN N'BoxQuantity'
          WHEN p.OutUnit='단' THEN N'BunchQuantity' ELSE N'SteamQuantity' END NativeQuantityBranch
          FROM dbo.Product p WHERE p.ProdKey=7201;`)).recordset,
        product:(await query(tx,'SELECT ProdKey,ProdName,OutUnit,Stock FROM dbo.Product WHERE ProdKey=7201;')).recordset,
        tempRows:(await query(tx,'SELECT WdetailKey,ProdName,ProdKey,BunchQuantity,OutQuantity,WarehouseKey FROM dbo.TempWarehouseDetail ORDER BY WdetailKey;')).recordset,
        referenceDetails:(await query(tx,'SELECT ProdKey,BunchQuantity,UPrice,TPrice,OutQuantity,WarehouseKey FROM dbo.WarehouseDetail WHERE WarehouseKey=99901 ORDER BY WdetailKey;')).recordset,
        referenceHistory:(await query(tx,`SELECT BeforeValue,AfterValue,ProdKey,OrderYear,OrderWeek FROM dbo.StockHistory
          WHERE OrderYear=N'2026' AND OrderWeek=N'41-01' ORDER BY StockHistoryKey DESC;`)).recordset,
      };
      console.error('NATIVE_REFERENCE_VALUE_DIAGNOSTIC:',JSON.stringify(diagnostic));
    }
    ensure(Math.abs(stock-25)<0.00001, 'native CreateWarehouse reference must add both same-product source quantities');
    const nativeDetails = await query(tx,`SELECT ProdKey,BunchQuantity,UPrice,TPrice,OutQuantity
      FROM dbo.WarehouseDetail WHERE WarehouseKey=99901 ORDER BY UPrice,WdetailKey;`);
    ensure(nativeDetails.recordset?.length===2
      && nativeDetails.recordset.map(row=>Number(row.UPrice)).sort((a,b)=>a-b).join(',')==='100,200',
    'captured native CreateWarehouse must preserve two prices for one product as separate detail rows');
    const nativeHistory = (await query(tx,`SELECT BeforeValue,AfterValue FROM dbo.StockHistory
      WHERE ProdKey=7201 AND OrderYear=N'2026' AND OrderWeek=N'41-01';`)).recordset?.[0];
    ensure(nativeHistory && Math.abs(Number(nativeHistory.BeforeValue)-20)<0.00001
      && Math.abs(Number(nativeHistory.AfterValue)-25)<0.00001,
    'native reference history must match the writer baseline/after stock values');
  } finally {
    await tx.rollback().catch(()=>{});
  }
  assert.deepEqual(await stockSnapshot(pool),initialStock,
    'native parity reference runs in a rolled-back fixture transaction');
  console.log('ok - captured native usp_CreateWarehouse reference agrees on separate prices and Product.Stock/StockHistory');
}

async function testQuantityUpdateDelta(pool,writer,documents) {
  const save=documents.saveInvoiceDraft;
  ensure(typeof save==='function','invoice document store must export saveInvoiceDraft for the revision/update fixture');
  await save({withTransactionFn:withTransactionFn(pool),types:sql,actor:'invoice-fixture',documentId:DOC,input:{
    documentId:DOC,expectedRevision:1,orderYear:'2026',orderWeek:'41-01',sourceHash:'11'.repeat(32),
    originalFileName:'fixture-invoice.pdf',farmKey:7101,invoiceNo:'WRITER-SUCCESS',invoiceYear:'2026',
    rawMetadata:{fixture:true},reviewedMetadata:{country:'CN',farmName:'Fixture Farm',inputDate:'2026-10-08',transportMode:'SEA'},
    reason:'quantity delta fixture',
    lines:[
      {lineId:LINE_A,lineNo:1,originalName:'Invoice Same Product',lengthText:'50cm',prodKey:7201,
        boxQuantity:null,bunchQuantity:4,stemQuantity:null,priceUnit:'단',unitPrice:100,currency:'USD',lineAmount:400,
        sourceEvidence:{source:'fixture'},reviewed:{unit:'단'}},
      {lineId:LINE_B,lineNo:2,originalName:'Invoice Same Product',lengthText:'50cm',prodKey:7201,
        boxQuantity:null,bunchQuantity:3,stemQuantity:null,priceUnit:'단',unitPrice:200,currency:'USD',lineAmount:600,
        sourceEvidence:{source:'fixture'},reviewed:{unit:'단'}},
    ],
  }});
  const ctx=writerContext(pool,writer);
  const preview=await ctx.preview(DOC,2);
  ensure(preview?.canCommit===true && typeof preview.baselineDigest==='string',
    `quantity-only revision must be previewable: ${JSON.stringify(preview?.issues||[])}`);
  let splitPartError;
  try { await commitArgs(ctx,DOC,OP_B,PART_B,preview.baselineDigest,2); } catch(error) { splitPartError=error; }
  ensure(splitPartError?.code==='SPLIT_RECEIPT_NOT_SUPPORTED',
    `committed receipt revision must reject a different receiptPartId, got ${splitPartError?.code||'no code'}`);
  const beforeQuantityCommit=(await query(pool,`SELECT COUNT_BIG(*) CountRows FROM dbo.WebInvoiceOperation
    WHERE DocumentId=@id AND Status=N'COMMITTED';`,{id:{type:sql.UniqueIdentifier,value:DOC}})).recordset?.[0];
  ensure(Number(beforeQuantityCommit?.CountRows)===1,'different receiptPartId refusal must not append an operation');
  const quantityResult=await commitArgs(ctx,DOC,OP_QUANTITY,PART_A,preview.baselineDigest,2);
  ensure(quantityResult?.costStatus==='STALE','quantity edit on a committed receipt must leave actual cost stale');
  const detail=(await query(pool,`SELECT COUNT_BIG(*) DetailCount,SUM(OutQuantity) TotalQuantity,
      MIN(UPrice) MinPrice,MAX(UPrice) MaxPrice FROM dbo.WarehouseDetail WHERE WarehouseKey=
      (SELECT WarehouseKey FROM dbo.WebInvoiceOperation WHERE OperationId=@op);`,{
    op:{type:sql.UniqueIdentifier,value:OP_QUANTITY},
  })).recordset?.[0];
  ensure(Number(detail?.DetailCount)===2 && Number(detail?.TotalQuantity)===7
    && Number(detail?.MinPrice)===100 && Number(detail?.MaxPrice)===200,
  'quantity update must preserve detail identity and both per-line prices while applying the +2 delta');
  const histories=await query(pool,`SELECT BeforeValue,AfterValue FROM dbo.StockHistory
    WHERE ProdKey=7201 AND OrderYear=N'2026' AND OrderWeek=N'41-01' ORDER BY StockHistoryKey;`);
  ensure(histories.recordset?.length===2
    && Number(histories.recordset[1].BeforeValue)===25 && Number(histories.recordset[1].AfterValue)===27,
  'quantity update must record only the +2 Product.Stock delta, not the full new receipt quantity');
  const stock=(await query(pool,`SELECT p.Stock ProductStock,cur.Stock CurrentStock,nxt.Stock NextStock
    FROM dbo.Product p JOIN dbo.ProductStock cur ON cur.ProdKey=p.ProdKey AND cur.StockKey=2601
    JOIN dbo.ProductStock nxt ON nxt.ProdKey=p.ProdKey AND nxt.StockKey=2701 WHERE p.ProdKey=7201;`)).recordset?.[0];
  ensure(stock && Number(stock.ProductStock)===27 && Number(stock.CurrentStock)===37 && Number(stock.NextStock)===39,
    'native StockCalculation must recascade current and next-year stocks from updated quantity, preserving prior-year 30');
  const operationCount=(await query(pool,`SELECT COUNT_BIG(*) CountRows FROM dbo.WebInvoiceOperation
    WHERE DocumentId=@id AND Status=N'COMMITTED';`,{id:{type:sql.UniqueIdentifier,value:DOC}})).recordset?.[0];
  ensure(Number(operationCount?.CountRows)===2,'quantity revision must append a second committed operation');
  const part=(await query(pool,'SELECT ReceiptPartId FROM dbo.WebInvoiceOperation WHERE OperationId=@id;',{
    id:{type:sql.UniqueIdentifier,value:OP_QUANTITY},
  })).recordset?.[0]?.ReceiptPartId;
  ensure(String(part).toLowerCase()===PART_A,'quantity revision must reuse the existing ReceiptPartId');
  await testPriceOnlyUpdate(pool,writer,documents);
  console.log('ok - quantity revision reuses receipt part, changed part is refused, and price-only revision preserves stock');
}

async function testPriceOnlyUpdate(pool,writer,documents) {
  const save=documents.saveInvoiceDraft;
  await save({withTransactionFn:withTransactionFn(pool),types:sql,actor:'invoice-fixture',documentId:DOC,input:{
    documentId:DOC,expectedRevision:2,orderYear:'2026',orderWeek:'41-01',sourceHash:'11'.repeat(32),
    originalFileName:'fixture-invoice.pdf',farmKey:7101,invoiceNo:'WRITER-SUCCESS',invoiceYear:'2026',
    rawMetadata:{fixture:true},reviewedMetadata:{country:'CN',farmName:'Fixture Farm',inputDate:'2026-10-08',transportMode:'SEA'},
    reason:'price-only revision fixture',
    lines:[
      {lineId:LINE_A,lineNo:1,originalName:'Invoice Same Product',lengthText:'50cm',prodKey:7201,
        boxQuantity:null,bunchQuantity:4,stemQuantity:null,priceUnit:'단',unitPrice:110,currency:'USD',lineAmount:440,
        sourceEvidence:{source:'fixture'},reviewed:{unit:'단'}},
      {lineId:LINE_B,lineNo:2,originalName:'Invoice Same Product',lengthText:'50cm',prodKey:7201,
        boxQuantity:null,bunchQuantity:3,stemQuantity:null,priceUnit:'단',unitPrice:210,currency:'USD',lineAmount:630,
        sourceEvidence:{source:'fixture'},reviewed:{unit:'단'}},
    ],
  }});
  const ctx=writerContext(pool,writer);
  const preview=await ctx.preview(DOC,3);
  ensure(preview?.canCommit===true&&typeof preview.baselineDigest==='string',
    `price-only revision must be previewable: ${JSON.stringify(preview?.issues||[])}`);
  const before={
    product:await rows(pool,'Product','ProdKey'),
    productStock:await rows(pool,'ProductStock','StockKey,ProdKey'),
    history:await rows(pool,'StockHistory','StockHistoryKey'),
  };
  // Any attempt to write ProductStock (including native recalculation) trips
  // the fixture trigger. A successful zero-delta price update proves it was skipped.
  await query(pool,'UPDATE dbo.FixtureNativeCalcControl SET FailNext=1 WHERE ControlKey=1;');
  let result,error;
  try { result=await commitArgs(ctx,DOC,OP_PRICE_ONLY,PART_A,preview.baselineDigest,3); }
  catch(caught) { error=caught; }
  await query(pool,'UPDATE dbo.FixtureNativeCalcControl SET FailNext=0 WHERE ControlKey=1;');
  ensure(!error,`price-only update must not invoke ProductStock/native stock calculation: ${error?.message||error?.code||''}`);
  ensure(result?.costStatus==='STALE','price-only committed revision must mark actual cost stale');
  assert.deepEqual({product:await rows(pool,'Product','ProdKey'),productStock:await rows(pool,'ProductStock','StockKey,ProdKey'),
    history:await rows(pool,'StockHistory','StockHistoryKey')},before,
  'price-only revision must preserve Product.Stock, ProductStock and StockHistory');
  const details=(await query(pool,`SELECT BunchQuantity,UPrice,TPrice FROM dbo.WarehouseDetail
    WHERE WarehouseKey=(SELECT WarehouseKey FROM dbo.WebInvoiceOperation WHERE OperationId=@op) ORDER BY UPrice;`,{
    op:{type:sql.UniqueIdentifier,value:OP_PRICE_ONLY},
  })).recordset;
  ensure(details?.length===2&&Number(details[0].BunchQuantity)===4&&Number(details[0].UPrice)===110
    &&Number(details[1].BunchQuantity)===3&&Number(details[1].UPrice)===210,
  'price-only revision must update prices while retaining committed quantities');
  const operation=(await query(pool,'SELECT ReceiptPartId,Status FROM dbo.WebInvoiceOperation WHERE OperationId=@id;',{
    id:{type:sql.UniqueIdentifier,value:OP_PRICE_ONLY},
  })).recordset?.[0];
  ensure(operation?.Status==='COMMITTED'&&String(operation.ReceiptPartId).toLowerCase()===PART_A,
    'price-only revision must commit under the original receipt part identifier');
  const committedCount=(await query(pool,`SELECT COUNT_BIG(*) CountRows FROM dbo.WebInvoiceOperation
    WHERE DocumentId=@id AND Status=N'COMMITTED';`,{id:{type:sql.UniqueIdentifier,value:DOC}})).recordset?.[0];
  ensure(Number(committedCount?.CountRows)===3,'quantity and price-only revisions must each append one committed operation');
}

async function testOmittedOrderViewBlocks(pool,writer) {
  await insertDocument(pool,DOC_ORDER_VIEW,'WRITER-ORDER-VIEW-OMITTED');
  const ctx=writerContext(pool,writer);
  await query(pool,`INSERT dbo.OrderMaster(OrderMasterKey,OrderYear,OrderWeek,OrderYearWeek,CustKey,Manager,OrderCode,Descr)
    VALUES(8003,N'2026',N'41-01',N'20264101',7001,N'missing-manager',N'OMITTED',N'not visible through ViewOrder');
    INSERT dbo.OrderDetail(OrderDetailKey,OrderMasterKey,ProdKey,BoxQuantity,BunchQuantity,SteamQuantity,OutQuantity,EstQuantity,NoneOutQuantity)
    VALUES(8103,8003,7201,0,1,1,1,1,0);`);
  try {
    const preview=await ctx.preview(DOC_ORDER_VIEW,1);
    ensure(preview?.canCommit===false && preview.issues?.some(item=>item.code==='ORDER_VIEW_INCOMPLETE'),
      `an active OrderDetail omitted by ViewOrder must block preview with ORDER_VIEW_INCOMPLETE: ${JSON.stringify(preview?.issues||[])}`);
    let caught;
    try { await commitArgs(ctx,DOC_ORDER_VIEW,OP_ORDER_VIEW,PART_ORDER_VIEW,preview.baselineDigest); }
    catch(error) { caught=error; }
    ensure(caught?.code==='ORDER_VIEW_INCOMPLETE',
      `writer must refuse the omitted OrderView row with its specific blocker, got ${caught?.code||'no code'}`);
    const op=(await query(pool,'SELECT COUNT_BIG(*) [RowCount] FROM dbo.WebInvoiceOperation WHERE OperationId=@id;',{
      id:{type:sql.UniqueIdentifier,value:OP_ORDER_VIEW},
    })).recordset?.[0];
    ensure(Number(op?.RowCount)===0,'OrderView completeness refusal must not persist an operation');
  } finally {
    await query(pool,'DELETE dbo.OrderDetail WHERE OrderDetailKey=8103; DELETE dbo.OrderMaster WHERE OrderMasterKey=8003;');
  }
  console.log('ok - missing active OrderDetail from ViewOrder blocks preview and commit without a write');
}

async function testConcurrentSameOperation(pool,writer) {
  await insertDocument(pool,DOC_CONCURRENT_SAME,'WRITER-CONCURRENT-SAME-OP');
  const ctx=writerContext(pool,writer);
  const preview=await ctx.preview(DOC_CONCURRENT_SAME,1);
  ensure(preview?.canCommit===true,'same-operation concurrency document must have a positive preview');
  const args={documentId:DOC_CONCURRENT_SAME,revision:1,operationId:OP_CONCURRENT_SAME,
    receiptPartId:PART_CONCURRENT_SAME,baselineDigest:preview.baselineDigest,
    reason:'simultaneous same-operation fixture',allowPendingCost:true,actor:'invoice-fixture'};
  const results=await Promise.all([ctx.create(args),ctx.create(args)]);
  assert.deepEqual(results[1],results[0],'same OperationId concurrent replay must return the committed result');
  const state=(await query(pool,`SELECT COUNT_BIG(*) OperationCount,COUNT(DISTINCT WarehouseKey) WarehouseCount,
      MIN(Status) MinStatus,MAX(Status) MaxStatus FROM dbo.WebInvoiceOperation WHERE DocumentId=@id;`,{
    id:{type:sql.UniqueIdentifier,value:DOC_CONCURRENT_SAME},
  })).recordset?.[0];
  ensure(Number(state?.OperationCount)===1&&Number(state?.WarehouseCount)===1
    &&state?.MinStatus==='COMMITTED'&&state?.MaxStatus==='COMMITTED',
  'simultaneous identical operation requests must produce exactly one committed operation and warehouse');
  const details=(await query(pool,`SELECT COUNT_BIG(*) [RowCount],SUM(OutQuantity) TotalQuantity
    FROM dbo.WarehouseDetail WHERE WarehouseKey=(SELECT WarehouseKey FROM dbo.WebInvoiceOperation WHERE OperationId=@id);`,{
    id:{type:sql.UniqueIdentifier,value:OP_CONCURRENT_SAME},
  })).recordset?.[0];
  ensure(Number(details?.RowCount)===2&&Number(details?.TotalQuantity)===5,
    'same-operation concurrency must materialize the receipt details once');
  console.log('ok - simultaneous same OperationId calls serialize to one receipt and return the same result');
}

async function testConcurrentDifferentOperations(pool,writer) {
  await insertDocument(pool,DOC_CONCURRENT_DIFFERENT,'WRITER-CONCURRENT-DIFFERENT-OPS');
  const ctx=writerContext(pool,writer);
  const preview=await ctx.preview(DOC_CONCURRENT_DIFFERENT,1);
  ensure(preview?.canCommit===true,'different-operation concurrency document must have a positive preview');
  const base={documentId:DOC_CONCURRENT_DIFFERENT,revision:1,baselineDigest:preview.baselineDigest,
    reason:'simultaneous different-operation fixture',allowPendingCost:true,actor:'invoice-fixture'};
  const results=await Promise.allSettled([
    ctx.create({...base,operationId:OP_CONCURRENT_DIFFERENT_A,receiptPartId:PART_CONCURRENT_DIFFERENT_A}),
    ctx.create({...base,operationId:OP_CONCURRENT_DIFFERENT_B,receiptPartId:PART_CONCURRENT_DIFFERENT_B}),
  ]);
  const fulfilled=results.filter(item=>item.status==='fulfilled');
  const rejected=results.filter(item=>item.status==='rejected');
  ensure(fulfilled.length===1&&rejected.length===1,
    `different concurrent operation IDs must have one winner and one refusal; got ${JSON.stringify(results.map(item=>item.status))}`);
  ensure(['ALREADY_COMMITTED','STOCK_GATE_BUSY'].includes(rejected[0].reason?.code),
    `losing concurrent operation must be refused by the committed-revision or active-gate guard, got ${rejected[0].reason?.code||'no code'}`);
  const state=(await query(pool,`SELECT COUNT_BIG(*) OperationCount,COUNT(DISTINCT WarehouseKey) WarehouseCount,
      MIN(Status) MinStatus,MAX(Status) MaxStatus FROM dbo.WebInvoiceOperation WHERE DocumentId=@id;`,{
    id:{type:sql.UniqueIdentifier,value:DOC_CONCURRENT_DIFFERENT},
  })).recordset?.[0];
  ensure(Number(state?.OperationCount)===1&&Number(state?.WarehouseCount)===1
    &&state?.MinStatus==='COMMITTED'&&state?.MaxStatus==='COMMITTED',
  'different concurrent operation IDs must never create two committed warehouses for one revision');
  console.log(`ok - simultaneous different OperationIds yield one commit and one ${rejected[0].reason.code} refusal`);
}

async function testCommitResponseLostRecovery(pool,writer) {
  await insertDocument(pool,DOC_RESPONSE_LOST,'WRITER-RESPONSE-LOST');
  const ctx=writerContext(pool,writer);
  const preview=await ctx.preview(DOC_RESPONSE_LOST,1);
  ensure(preview?.canCommit===true,'response-recovery document must have a positive preview');
  let committedBeforeResponseLoss;
  let boundaryError;
  try {
    committedBeforeResponseLoss=await commitArgs(ctx,DOC_RESPONSE_LOST,OP_RESPONSE_LOST,PART_RESPONSE_LOST,preview.baselineDigest);
    // This models a lost HTTP/client response after the commit promise resolved.
    // No database timeout, cancellation, or transaction failure is injected.
    const error=new Error('fixture simulated response loss after successful commit');
    error.code='SIMULATED_RESPONSE_LOST_AFTER_COMMIT';
    throw error;
  } catch(error) { boundaryError=error; }
  ensure(boundaryError?.code==='SIMULATED_RESPONSE_LOST_AFTER_COMMIT'&&committedBeforeResponseLoss,
    'response-loss scenario must occur strictly after a successful writer commit');
  const retry=await commitArgs(ctx,DOC_RESPONSE_LOST,OP_RESPONSE_LOST,PART_RESPONSE_LOST,preview.baselineDigest);
  assert.deepEqual(retry,committedBeforeResponseLoss,'retry after lost response must recover the exact committed result by OperationId');
  const counts=(await query(pool,`SELECT COUNT_BIG(*) OperationCount,COUNT(DISTINCT WarehouseKey) WarehouseCount
    FROM dbo.WebInvoiceOperation WHERE DocumentId=@id;`,{id:{type:sql.UniqueIdentifier,value:DOC_RESPONSE_LOST}})).recordset?.[0];
  ensure(Number(counts?.OperationCount)===1&&Number(counts?.WarehouseCount)===1,
    'post-commit response retry must not duplicate the operation or warehouse');
  console.log('ok - post-commit response-loss retry recovers the same result without simulating a DB timeout');
}

async function testStockCalculationFailureRollback(pool,writer,protectedBefore) {
  await insertDocument(pool,DOC_FAIL,'WRITER-FAIL-STOCK');
  const ctx=writerContext(pool,writer);
  const preview=await ctx.preview(DOC_FAIL,1);
  ensure(preview?.canCommit===true,'failure-injection document must have a positive preflight');
  const before=await stockSnapshot(pool);
  await query(pool,'UPDATE dbo.FixtureNativeCalcControl SET FailNext=1 WHERE ControlKey=1;');
  let caught;
  try { await commitArgs(ctx,DOC_FAIL,OP_FAIL,PART_FAIL,preview.baselineDigest); } catch(error) { caught=error; }
  await query(pool,'UPDATE dbo.FixtureNativeCalcControl SET FailNext=0 WHERE ControlKey=1;');
  ensure(caught,'injected native stock calculation failure must reject the writer');
  const op=await query(pool,'SELECT COUNT_BIG(*) CountRows FROM dbo.WebInvoiceOperation WHERE OperationId=@id;',{
    id:{type:sql.UniqueIdentifier,value:OP_FAIL},
  });
  ensure(Number(op.recordset?.[0]?.CountRows)===0,'failed stock calculation must roll back the operation row');
  assert.deepEqual(await stockSnapshot(pool),before,'failed stock calculation must roll back ERP warehouse/stock/history/key changes');
  assert.deepEqual(await protectedSnapshot(pool),protectedBefore,'failed transaction must preserve staging/order/shipment sentinels');
  console.log('ok - injected stock calculation failure rolls back the complete writer transaction');
}

async function testBusyGatePreserved(pool,writer,protectedBefore) {
  await insertDocument(pool,DOC_BUSY,'WRITER-GATE-BUSY');
  const ctx=writerContext(pool,writer);
  const preview=await ctx.preview(DOC_BUSY,1);
  ensure(preview?.baselineDigest,'busy-gate test requires the idle-state baseline digest');
  await query(pool,`UPDATE dbo.NenovaStockWeekGate SET Mode=N'RUN',LockedAt=GETDATE(),Action=N'FIX',
    OrderYear=N'2026',OrderWeek=N'41-01',OwnerSessionID=999999,OwnerToken='50000000-0000-4000-8000-000000000001',
    PendingCalc=0,CalcProdKey=NULL WHERE GateKey='1';`);
  const busyBefore=(await query(pool,'SELECT * FROM dbo.NenovaStockWeekGate WHERE GateKey=\'1\';')).recordset?.[0];
  let caught;
  try { await commitArgs(ctx,DOC_BUSY,OP_BUSY,PART_BUSY,preview.baselineDigest); } catch(error) { caught=error; }
  ensure(caught?.code==='STOCK_GATE_BUSY',`busy native gate must reject with STOCK_GATE_BUSY, got ${caught?.code||'no code'}`);
  const busyAfter=(await query(pool,'SELECT * FROM dbo.NenovaStockWeekGate WHERE GateKey=\'1\';')).recordset?.[0];
  assert.deepEqual(busyAfter,busyBefore,'writer must not clear or take over another owner\'s busy gate');
  const op=await query(pool,'SELECT COUNT_BIG(*) CountRows FROM dbo.WebInvoiceOperation WHERE OperationId=@id;',{
    id:{type:sql.UniqueIdentifier,value:OP_BUSY},
  });
  ensure(Number(op.recordset?.[0]?.CountRows)===0,'busy gate must reject before persistent operation/ERP writes');
  await query(pool,`UPDATE dbo.NenovaStockWeekGate SET Mode=NULL,LockedAt=NULL,Action=NULL,OrderYear=NULL,OrderWeek=NULL,
    OwnerSessionID=NULL,OwnerToken=NULL,PendingCalc=0,CalcProdKey=NULL WHERE GateKey='1';`);
  assert.deepEqual(await protectedSnapshot(pool),protectedBefore,'busy-gate refusal must preserve staging/order/shipment rows');
  console.log('ok - busy native gate is refused without changing its ownership or writing receipt rows');
}

function cnSeaCostInput(costApi,costSourceId) {
  const formula=costApi.INVOICE_COST_FORMULAS.CN_SEA_ACTUAL_V1;
  return {
    formulaId:formula.formulaId,formulaVersion:formula.formulaVersion,formulaSourceHash:formula.formulaSourceHash,
    formulaSourceSheet:formula.formulaSourceSheet,formulaSourceCells:formula.formulaSourceCells,
    formulaApplicabilityConfirmed:true,formulaEffectiveDate:'2026-10-08',
    nativeCurrency:'USD',freightCurrency:'USD',exchangeRateKRW:1300,exchangeRateType:'fixture',
    exchangeRateDate:'2026-10-08',freightAmount:10,customsTotalKRW:0,expected95Quantity:100,
    costSourceId,allocationScope:'SINGLE_INVOICE',
    allocationShareNumerator:1,allocationShareDenominator:1,
    lineInputs:[{lineId:LINE_A,tariffRate:0,otherCostPerUnitKRW:0},
      {lineId:LINE_B,tariffRate:0,otherCostPerUnitKRW:0}],
  };
}

async function testCostSaveReadIdempotencyAndStaleExeDetail(pool,writer,costApi) {
  const writerCtx=writerContext(pool,writer);
  const costInput=cnSeaCostInput(costApi,'fixture:china-sea:awb-cost-41');
  const saveArgs={withTransactionFn:withTransactionFn(pool),types:sql,documentId:DOC,revision:3,
    actor:'invoice-fixture-cost',input:costInput,reason:'fixture checked source and allocation'};
  const saved=await costApi.saveInvoiceCostRevision(saveArgs);
  ensure(saved?.idempotent===false&&saved.status==='APPROVED'
    &&saved.currentActual?.basis==='ACTUAL'&&saved.currentActual?.status==='APPROVED'
    &&saved.currentActual.lines.length===2&&saved.comparisons?.length===1
    &&saved.comparisons[0].basis==='EXPECTED_95'&&saved.comparisons[0].comparisonOnly===true,
  `CN SEA USD fixture cost must save as one approved actual revision with two lines: ${JSON.stringify({status:saved?.status,idempotent:saved?.idempotent})}`);
  const savedIds=saved.savedCostRevisionIds||[];
  ensure(savedIds.length===2&&saved.currentActual.costRevisionId===savedIds[0]
    &&saved.comparisons[0].costRevisionId===savedIds[1],
    'cost save must persist one ACTUAL revision plus its separate EXPECTED_95 comparison revision');
  const warehouseKey=saved.warehouseKey;
  const read=await costApi.readInvoiceCosts({queryFn:(statement,params={})=>query(pool,statement,params),types:sql,warehouseKey});
  ensure(read.status==='APPROVED'&&read.documentCostStatus==='APPROVED'
    &&read.currentActual?.costRevisionId===savedIds[0]&&read.currentActual.lines.length===2
    &&read.comparisons?.length===1&&read.comparisons[0].costRevisionId===savedIds[1],
  'actual cost read must return the persisted actual revision and separate 95% comparison');
  const replay=await costApi.saveInvoiceCostRevision(saveArgs);
  ensure(replay.idempotent===true&&replay.savedCostRevisionId===savedIds[0]
    &&replay.currentActual?.costRevisionId===savedIds[0],
  'identical actual-cost save must return the existing revision idempotently');
  const stored=(await query(pool,`SELECT COUNT_BIG(*) RevisionCount,MIN(Status) MinStatus,MAX(Status) MaxStatus
    FROM dbo.WebInvoiceCostRevision WHERE DocumentId=@id AND Basis=N'ACTUAL';`,{
    id:{type:sql.UniqueIdentifier,value:DOC},
  })).recordset?.[0];
  ensure(Number(stored?.RevisionCount)===1&&stored?.MinStatus==='APPROVED'&&stored?.MaxStatus==='APPROVED',
    'cost idempotency must leave exactly one approved ACTUAL revision in SQL');

  await insertDocument(pool,DOC_COST_DUPLICATE,'WRITER-COST-SOURCE-DUPLICATE',[1,1]);
  const duplicatePreview=await writerCtx.preview(DOC_COST_DUPLICATE,1);
  ensure(duplicatePreview?.canCommit===true,'small second receipt for shared-cost identity test must be commit-capable');
  await commitArgs(writerCtx,DOC_COST_DUPLICATE,OP_COST_DUPLICATE,PART_COST_DUPLICATE,duplicatePreview.baselineDigest);
  let duplicateError;
  try {
    await costApi.saveInvoiceCostRevision({...saveArgs,documentId:DOC_COST_DUPLICATE,revision:1});
  } catch(error) { duplicateError=error; }
  ensure(duplicateError?.code==='COST_SOURCE_ALREADY_APPROVED',
    `same approved shared-cost source on another document must be refused specifically, got ${duplicateError?.code||'no code'}`);
  const duplicateRows=(await query(pool,`SELECT COUNT_BIG(*) [RowCount] FROM dbo.WebInvoiceCostRevision WHERE DocumentId=@id;`,{
    id:{type:sql.UniqueIdentifier,value:DOC_COST_DUPLICATE},
  })).recordset?.[0];
  ensure(Number(duplicateRows?.RowCount)===0,'duplicate shared cost source refusal must not insert a revision for the second document');

  await query(pool,`UPDATE dbo.WarehouseDetail SET UPrice=UPrice+1
    WHERE WarehouseKey=@warehouseKey AND WdetailKey=(SELECT MIN(WdetailKey) FROM dbo.WarehouseDetail WHERE WarehouseKey=@warehouseKey);`,{
    warehouseKey:{type:sql.Int,value:warehouseKey},
  });
  const staleRead=await costApi.readInvoiceCosts({queryFn:(statement,params={})=>query(pool,statement,params),types:sql,warehouseKey});
  ensure(staleRead.documentCostStatus==='APPROVED'&&staleRead.status==='STALE'
    &&staleRead.currentActual===null&&staleRead.revisions.length===2
    &&staleRead.revisions.every(revision=>revision.storedStatus==='APPROVED'
      &&revision.status==='STALE'&&revision.liveReceiptStatus==='STALE'),
  'read-only cost read must detect changed live EXE warehouse detail as stale without rewriting stored approval state');
  const storedAfter=(await query(pool,`SELECT COUNT_BIG(*) RevisionCount,MIN(Status) MinStatus,MAX(Status) MaxStatus
    FROM dbo.WebInvoiceCostRevision WHERE DocumentId=@documentId AND WarehouseKey=@warehouseKey;`,{
    documentId:{type:sql.UniqueIdentifier,value:DOC},warehouseKey:{type:sql.Int,value:warehouseKey},
  })).recordset?.[0];
  ensure(Number(storedAfter?.RevisionCount)===2&&storedAfter?.MinStatus==='APPROVED'&&storedAfter?.MaxStatus==='APPROVED',
    'EXE-detail stale detection is a read projection; it must not mutate either persisted approval status');

  // Model an approved source whose cost revisions were later invalidated. The
  // source identity remains reserved even when its revision rows are STALE.
  await query(pool,`UPDATE dbo.WebInvoiceCostRevision SET Status=N'STALE' WHERE DocumentId=@documentId;`,{
    documentId:{type:sql.UniqueIdentifier,value:DOC},
  });
  const staleSourceRows=(await query(pool,`SELECT COUNT_BIG(*) [RowCount],MIN(Status) MinStatus,MAX(Status) MaxStatus
    FROM dbo.WebInvoiceCostRevision WHERE DocumentId=@documentId;`,{
    documentId:{type:sql.UniqueIdentifier,value:DOC},
  })).recordset?.[0];
  ensure(Number(staleSourceRows?.RowCount)===2&&staleSourceRows?.MinStatus==='STALE'&&staleSourceRows?.MaxStatus==='STALE',
    'same-source dedupe follow-up must begin from persisted STALE cost revisions');
  let staleSourceDuplicateError;
  try {
    await costApi.saveInvoiceCostRevision({...saveArgs,documentId:DOC_COST_DUPLICATE,revision:1});
  } catch(error) { staleSourceDuplicateError=error; }
  ensure(staleSourceDuplicateError?.code==='COST_SOURCE_ALREADY_APPROVED',
    `a STALE revision must continue reserving its costSourceId, got ${staleSourceDuplicateError?.code||'no code'}`);
  const rowsAfterStaleDuplicate=(await query(pool,`SELECT COUNT_BIG(*) [RowCount] FROM dbo.WebInvoiceCostRevision WHERE DocumentId=@id;`,{
    id:{type:sql.UniqueIdentifier,value:DOC_COST_DUPLICATE},
  })).recordset?.[0];
  ensure(Number(rowsAfterStaleDuplicate?.RowCount)===0,
    'STALE source identity refusal must not insert a cost revision for the second document');
  console.log('ok - actual CN SEA USD cost save/read/idempotency, shared-source duplicate refusal, and EXE-detail stale read');
}

async function testExistingCostLink(pool, costs, thai = false) {
  const api=await import(pathToFileURL(path.join(ROOT,'lib/invoiceExistingReceipt.js')).href);
  const exporter=await import(pathToFileURL(path.join(ROOT,'lib/invoiceReceiptCostExport.js')).href);
  const id=crypto.randomUUID(), op=crypto.randomUUID();
  const wk=thai?99003:99001, invoice=thai?'EXISTING-TH':'EXISTING-NL';
  const seed={id:{type:sql.UniqueIdentifier,value:id},wk:{type:sql.Int,value:wk},prior:{type:sql.Int,value:wk+1},invoice:{type:sql.NVarChar,value:invoice}};
  await applyMigration(pool,fs.readFileSync(path.join(ROOT,'docs/migrations/2026-10-19_invoice_existing_cost_link.sql'),'utf8'));
  await applyMigration(pool,fs.readFileSync(path.join(ROOT,'docs/migrations/2026-10-19_invoice_existing_cost_link.sql'),'utf8'));
  await applyMigration(pool,fs.readFileSync(MIGRATION_FILE,'utf8'));
  await insertDocument(pool,id,invoice,[3,7]);
  await query(pool,`UPDATE dbo.WebInvoiceDocument SET ReviewedMetadataJson=N'{"country":"NL","transportMode":"AIR","inputDate":"2026-10-08"}' WHERE DocumentId=@id;
    UPDATE dbo.WebInvoiceLine SET StemQuantity=BunchQuantity,BunchQuantity=NULL,PriceUnit=N'송이',Currency=N'EUR',
      UnitPrice=2,LineAmount=StemQuantity,ReviewedJson=N'{"confirmed":true}' WHERE DocumentId=@id;
    UPDATE dbo.WebInvoiceLine SET LineAmount=StemQuantity*2 WHERE DocumentId=@id;
    INSERT dbo.WarehouseMaster(WarehouseKey,OrderYear,OrderWeek,FarmName,InvoiceNo,InputDate,isDeleted)
    VALUES(@wk,N'2026',N'41-01',N'Fixture Farm',@invoice,'2026-10-08',0),
          (@prior,N'2025',N'41-01',N'Fixture Farm',@invoice,'2025-10-08',0);
    INSERT dbo.WarehouseDetail(WarehouseKey,ProdKey,SteamQuantity,OutQuantity,EstQuantity,UPrice,TPrice)
    VALUES(@wk,7201,10,10,10,2,20);`,seed);
  if (thai) await query(pool,`UPDATE dbo.WebInvoiceDocument SET ReviewedMetadataJson=N'{"country":"TH","transportMode":"AIR","inputDate":"2026-10-08"}' WHERE DocumentId=@id;
    UPDATE dbo.WebInvoiceLine SET Currency=N'USD',BunchQuantity=StemQuantity/5 WHERE DocumentId=@id;
    UPDATE dbo.WarehouseDetail SET BoxQuantity=0,BunchQuantity=2,OutQuantity=2,EstQuantity=2 WHERE WarehouseKey=@wk;`,seed);
  const before=await stockSnapshot(pool), protectedBefore=await protectedSnapshot(pool);
  const args={queryFn:(s,p)=>query(pool,s,p),types:sql,documentId:id,revision:1};
  const preview=await api.previewExistingReceiptLink(args);
  assert.equal(preview.warehouseKey,wk);assert.equal(preview.sourceCount,2);assert.equal(preview.goodsCount,1);
  const linkArgs={...args,withTransactionFn:withTransactionFn(pool),baselineDigest:preview.baselineDigest,operationId:op,actor:'invoice-fixture'};
  const linked=await api.linkExistingReceipt(linkArgs);
  assert.deepEqual(await api.linkExistingReceipt(linkArgs),linked);
  const formula=costs.INVOICE_COST_FORMULAS[thai?'TH_GROUP_BOX_SHARE_V1':'NL_AMOUNT_V1'];
  const input={...formula,formulaApplicabilityConfirmed:true,formulaEffectiveDate:'2026-10-08',nativeCurrency:thai?'USD':'EUR',freightCurrency:thai?'USD':'EUR',
    exchangeRateKRW:1500,exchangeRateType:'TEST_ONLY',exchangeRateDate:'2026-10-08',freightAmount:12,customsTotalKRW:100,
    expenseBasis:'ESTIMATED',estimateSource:'TEST_ONLY previous fixture cost / weight ratio',costSourceId:`fixture:${id}`,
    allocationScope:'SINGLE_INVOICE',allocationShareNumerator:1,allocationShareDenominator:1,
    ...(thai?{groupBoxBasis:'PACKING_GROUP',packingBoxTotal:1,lossTreatmentConfirmed:true,costGroups:[{groupId:'OTHERS',boxQuantity:1,quantity:10}]}:{}),
    lineInputs:[LINE_A,LINE_B].map(lineId=>({lineId,tariffRate:thai?.05:0,stemsPerBunch:thai?5:1,...(thai?{groupId:'OTHERS'}:{})}))};
  const saved=await costs.saveInvoiceCostRevision({...args,withTransactionFn:withTransactionFn(pool),actor:'invoice-fixture',input,reason:'fixture cost only'});
  assert.equal(saved.currentActual.liveReceiptStatus,'MATCH');assert.equal(saved.currentActual.lines.length,2);
  const output=await exporter.exportCurrentInvoiceCost({...args,warehouseKey:String(wk),costRevisionId:saved.currentActual.costRevisionId});
  const book=require('xlsx').read(output.buffer);
  assert.deepEqual(book.SheetNames,['2026 41-01','원본수식 비교']);assert.match(book.Sheets['2026 41-01'].B1.v,/추정 통관비/);
  if(thai){assert.equal(book.Sheets['2026 41-01'].G15.v,2);assert.equal(book.Sheets['2026 41-01'].R15.v,'BUNCH');assert.equal(saved.currentActual.editableInput.input.packingBoxTotal,1);}
  else assert.equal(book.Sheets['2026 41-01'].C6.v,20);
  assert.deepEqual(await stockSnapshot(pool),before);assert.deepEqual(await protectedSnapshot(pool),protectedBefore);
  console.log('ok - existing receipt split-line cost link, replay, cross-year, cost save/read, estimated workbook and ERP preservation');
}

async function applyMigration(pool, source) { await runBatches(pool,source,'web invoice migration'); }

// Invoked only by the opt-in private workbook case, inside the invocation-owned DB.
async function testPrivateStageLogsAndCostExport(pool,scenario,committed,read,document) {
  const stageApi=await import(pathToFileURL(path.join(ROOT,'lib','invoiceReceiptStageLog.js')).href);
  const exportApi=await import(pathToFileURL(path.join(ROOT,'lib','invoiceReceiptCostExport.js')).href);
  const XLSX=require('xlsx-js-style'),JSZip=require('jszip');
  const queryFn=(statement,params={})=>query(pool,statement,params);
  const protectedBefore=await protectedSnapshot(pool),stockBefore=await stockSnapshot(pool);
  const costBefore={revisions:await rows(pool,'WebInvoiceCostRevision','CostRevisionId'),lines:await rows(pool,'WebInvoiceCostLine','CostRevisionId,LineId')};
  const historyCount=async()=>Number((await queryFn(`SELECT COUNT_BIG(*) N FROM dbo.WebInvoiceHistory
    WHERE DocumentId=@id AND Action=N'WORKFLOW_STAGE';`,{id:{type:sql.UniqueIdentifier,value:scenario.documentId}})).recordset[0].N);
  const historyBefore=await historyCount();
  const input={documentRevision:document.revision,sourceHash:scenario.sourceHash,stage:'costVerify',status:'passed',attemptId:crypto.randomUUID(),eventId:crypto.randomUUID()};
  const stageArgs={withTransactionFn:withTransactionFn(pool),types:sql,documentId:scenario.documentId,actor:'TEST_ONLY:invoice-cost-export-fixture',input};
  stage('TEST_ONLY private stage logging, idempotency and current-cost export');
  const logged=await stageApi.appendInvoiceReceiptStageEvent(stageArgs);
  ensure(logged.idempotent===false&&logged.event.stage==='costVerify'&&logged.event.status==='passed',
    'stage log must append the server-verified current actual cost event');
  ensure(logged.event.evidence?.origin==='SERVER_VERIFIED'&&logged.event.evidence?.erpProof===true
    &&logged.event.evidence?.costRevisionId===read.currentActual.costRevisionId
    &&logged.event.evidence?.warehouseKey===committed.warehouseKey&&logged.event.orderYear==='2026'
    &&logged.event.orderWeek==='41-02','stage evidence must retain exact current-year receipt and actual cost scope');
  const replay=await stageApi.appendInvoiceReceiptStageEvent(stageArgs);
  ensure(replay.idempotent===true&&replay.event.historyId===logged.event.historyId,'stage retry must reuse the same history event');
  assert.equal(await historyCount(),historyBefore+1,'stage replay must not append another history row');
  const rejects=async(action,label,prefix)=>{
    await assert.rejects(action,error=>typeof error.code==='string'&&error.code.startsWith(prefix)&&Number(error.statusCode)>=400,label);
  };
  await rejects(()=>stageApi.appendInvoiceReceiptStageEvent({...stageArgs,input:{...input,status:'failed',code:'COST_MISMATCH'}}),'changed event payload must not overwrite prior success','STAGE_');
  for(const changed of [{documentRevision:document.revision+1},{sourceHash:'f'.repeat(64)}]) {
    await rejects(()=>stageApi.appendInvoiceReceiptStageEvent({...stageArgs,input:{...input,...changed,eventId:crypto.randomUUID()}}),'stale revision/source must not append history','STAGE_');
  }
  const exportArgs={queryFn,types:sql,documentId:scenario.documentId,warehouseKey:String(committed.warehouseKey),costRevisionId:read.currentActual.costRevisionId};
  const exported=await exportApi.exportCurrentInvoiceCost(exportArgs);
  ensure(Buffer.isBuffer(exported.buffer)&&exported.buffer.length>0&&/\.xlsx$/i.test(exported.filename),'full SQL exporter must return an XLSX buffer and filename');
  const workbook=XLSX.read(exported.buffer,{type:'buffer',cellStyles:true});
  assert.equal(workbook.SheetNames.length,1,'export must contain only the approved snapshot sheet');
  const sheet=workbook.Sheets[workbook.SheetNames[0]],value=address=>sheet[address]?.v;
  assert.equal(value('C5'),'2026/41-02');assert.equal(value('C9'),28);
  ensure(Math.abs(Number(value('C10'))-read.currentActual.totalCostKRW)<0.0001,'export header must equal current approved total');
  assert.equal(value('C7'),230,'FX stays explicitly TEST_ONLY');
  assert.equal(value('C8'),1985.94);assert.equal(value('E8'),1985.94,'CW is TEST_ONLY equal GW, not actual-source CW');
  assert.equal(value('J13'),'환율 종류','exchange-rate basis must retain its current metadata label');
  assert.equal(value('K13'),'TEST_ONLY','workbook must disclose the synthetic FX basis');
  const expectedNames=document.lines.slice().sort((a,b)=>a.lineNo-b.lineNo).map(line=>line.originalName);
  let total=0,quantity=0;
  for(let index=0;index<28;index++){
    const row=24+index;
    assert.equal(value(`B${row}`),expectedNames[index],'all original product names must retain source order');
    assert.equal(value(`N${row}`),'BUNCH','no arbitrary ERP unit conversion');
    ensure(Number.isFinite(value(`O${row}`))&&Number.isFinite(value(`E${row}`)),'every exported actual line needs numeric quantity and total');
    total+=value(`O${row}`);quantity+=value(`E${row}`);
  }
  assert.equal(value('B52'),undefined,'export must not add a 29th product');
  ensure(Math.abs(total-read.currentActual.totalCostKRW)<0.0001&&Math.abs(quantity-2380)<0.000001,'28 exported lines must conserve approved cost and actual bunch totals');
  for(const cell of Object.values(sheet))if(cell&&typeof cell==='object')assert.equal(cell.f,undefined,'exported snapshot must contain no recalculation formulas');
  const zip=await JSZip.loadAsync(exported.buffer);
  const sheetXml=await zip.file('xl/worksheets/sheet1.xml').async('string');
  const stylesXml=await zip.file('xl/styles.xml').async('string');
  assert.match(sheetXml,/<cols>/);assert.match(sheetXml,/<mergeCell ref="B51:D51"/);
  for(const address of ['B23','B24','M24','O24','B51','M51','O51'])assert.match(sheetXml,new RegExp(`<c r="${address}" s="[1-9][0-9]*"`),'header, first and expanded final rows must retain style IDs');
  for(const kind of ['fonts','fills','borders','cellXfs'])assert.match(stylesXml,new RegExp(`<${kind}\\b`),'template font/fill/border/number styles must survive export');
  ensure(!Object.keys(zip.files).some(name=>/externalLinks|vbaProject/i.test(name)),'private snapshot must not include external links or macros');
  // Every near-miss mutates only a rollback-only transaction in the owned fixture.
  const misses=[
    ['same-week previous-year native receipt',`UPDATE dbo.WarehouseMaster SET OrderYear=N'2025' WHERE WarehouseKey=@wk;`],
    ['document revision',`UPDATE dbo.WebInvoiceDocument SET Revision=Revision+1 WHERE DocumentId=@id;`],
    ['source identity',`UPDATE dbo.WebInvoiceDocument SET SourceHash=@badHash WHERE DocumentId=@id;`],
    ['live native quantity drift',`UPDATE dbo.WarehouseDetail SET OutQuantity=OutQuantity+1 WHERE WdetailKey=(SELECT MIN(WdetailKey) FROM dbo.WarehouseDetail WHERE WarehouseKey=@wk);`],
  ];
  for(const [label,statement] of misses){
    const tx=new sql.Transaction(pool);await tx.begin(sql.ISOLATION_LEVEL.READ_COMMITTED);
    try{
      const txQuery=(text,params={})=>query(tx,text,params);
      await txQuery(statement,{id:{type:sql.UniqueIdentifier,value:scenario.documentId},wk:{type:sql.Int,value:committed.warehouseKey},badHash:{type:sql.Binary(32),value:Buffer.alloc(32,255)}});
      await rejects(()=>exportApi.exportCurrentInvoiceCost({...exportArgs,queryFn:txQuery}),`${label} must reject current actual export`,'COST_EXPORT_');
      await rejects(()=>stageApi.appendInvoiceReceiptStageEvent({...stageArgs,withTransactionFn:callback=>callback(txQuery),input:{...input,eventId:crypto.randomUUID()}}),`${label} must not receive a new verified stage success`,'STAGE_');
    }finally{await tx.rollback();}
  }
  await rejects(()=>exportApi.exportCurrentInvoiceCost({...exportArgs,costRevisionId:crypto.randomUUID()}),'noncurrent approved revision must not export','COST_EXPORT_');
  assert.equal(await historyCount(),historyBefore+1,'failed source/year/revision/stale requests must leave stage history unchanged');
  assert.deepEqual(await protectedSnapshot(pool),protectedBefore,'stage logs/export must preserve staging/order/shipment sentinels');
  assert.deepEqual(await stockSnapshot(pool),stockBefore,'stage logs/export and rollback probes must preserve warehouse/stock/history/key numbering');
  assert.deepEqual({revisions:await rows(pool,'WebInvoiceCostRevision','CostRevisionId'),lines:await rows(pool,'WebInvoiceCostLine','CostRevisionId,LineId')},costBefore,'stage logs/export must not rewrite persisted cost approvals');
  const output=path.join(ROOT,'outputs','invoice-cost-export-fixture.xlsx');
  fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,exported.buffer);
  console.log('ok - TEST_ONLY private 28-row SQL stage evidence/idempotency, source/year/revision/stale failures, ERP preservation, workbook totals/styles; private QA export: outputs/invoice-cost-export-fixture.xlsx');
}

async function testPrivateChinaInvoiceWriterAndAirCost(pool,writer,costApi,documents) {
  const {loadChinaInvoiceReceiptScenario,chinaAirTestOnlyCostInput}=require('../__tests__/fixtures/chinaInvoiceReceiptScenario.cjs');
  // File input only: HOST/PORT/database/credentials and parseArgs stay closed.
  const scenario=await loadChinaInvoiceReceiptScenario(process.env.NENOVA_FIXTURE_CHINA_WORKBOOK);
  if(!scenario){
    console.log('SKIP: optional private 41-2 XLSX case (NENOVA_FIXTURE_CHINA_WORKBOOK absent); mandatory synthetic scenarios completed.');
    return;
  }
  stage('actual invoice quantities/prices with synthetic fixture matching and TEST_ONLY cost inputs');
  console.log('MODE: actual invoice quantities/prices with synthetic fixture matching and TEST_ONLY cost inputs');
  console.log('TEST_ONLY: synthetic ProdKey 7300..7327/farm 7101; CW=actual GW (actual CW is missing), FX=230, tariff=0, customs=1000, combined freight classification=27514.9 CNY.');
  console.log('NOT VERIFIED: actual ERP matching; the 12 real unmatched ERP rows are not resolved or altered by this fixture.');
  const sourceBefore=scenario.rawInvoiceJson;
  const costInput=chinaAirTestOnlyCostInput(costApi,scenario);
  const invoiceNo=`TEST_ONLY_CN41_2_${scenario.documentId.slice(0,8)}`;
  const metadata={country:'CN',farmName:'Fixture Farm',inputDate:'2026-10-10',transportMode:'AIR',
    gw:scenario.invoice.gross_weight,cw:scenario.invoice.gross_weight,
    testOnly:{syntheticMatching:true,metadataConfirmedForFixtureOnly:true,cw:'TEST_ONLY equal GW; source CW missing',
      costClassification:'TEST_ONLY combined charges; not real approval'}};
  const assertCanonicalMetadata=value=>{
    assert.equal(value.gw,scenario.invoice.gross_weight,'saved/reloaded canonical gw must retain actual source GW');
    assert.equal(value.cw,scenario.invoice.gross_weight,'saved/reloaded canonical cw must retain the explicit TEST_ONLY CW');
    assert.equal(Object.hasOwn(value,'grossWeight'),false,'noncanonical grossWeight must not be stored or reintroduced');
    assert.equal(Object.hasOwn(value,'chargeableWeight'),false,'noncanonical chargeableWeight must not be stored or reintroduced');
  };
  assertCanonicalMetadata(metadata);
  await query(pool,`INSERT dbo.StockMaster(StockKey,OrderYear,OrderWeek,OrderYearWeek,Descr,isFix,CreateID)
      VALUES(2512,N'2025',N'41-02',N'20254102',N'TEST_ONLY previous-year sentinel',1,N'fixture'),
            (2612,N'2026',N'41-02',N'20264102',N'TEST_ONLY actual invoice fixture',1,N'fixture');
    INSERT dbo.OrderMaster(OrderMasterKey,OrderYear,OrderWeek,OrderYearWeek,CustKey,Manager,OrderCode,Descr)
      VALUES(8300,N'2025',N'41-02',N'20254102',7001,N'invoice-fixture',N'TEST_PREV',N'TEST_ONLY previous-year sentinel'),
            (8301,N'2026',N'41-02',N'20264102',7001,N'invoice-fixture',N'TEST_CURR',N'TEST_ONLY synthetic matching');`);
  for(const line of scenario.lines){
    const p=line.source;
    await query(pool,`INSERT dbo.Product(ProdKey,ProdName,CountryFlower,CounName,FlowerName,OutUnit,EstUnit,
        BunchOf1Box,SteamOf1Bunch,SteamOf1Box,Stock,isDeleted)
      VALUES(@pk,@name,N'ORCHID',N'중국',N'ORCHID',N'단',N'단',@bunchPerBox,@stemPerBunch,@stemPerBox,0,0);
      INSERT dbo.ProductStock(StockKey,ProdKey,Stock) VALUES(2512,@pk,0);
      INSERT dbo.OrderDetail(OrderDetailKey,OrderMasterKey,ProdKey,BoxQuantity,BunchQuantity,SteamQuantity,OutQuantity,EstQuantity,NoneOutQuantity)
      VALUES(@previousDetail,8300,@pk,@box,@bunch,@stem,@sentinel,@sentinel,0),
            (@currentDetail,8301,@pk,@box,@bunch,@stem,@bunch,@bunch,0);`,{
      pk:{type:sql.Int,value:line.prodKey},name:{type:sql.NVarChar(250),value:line.syntheticName},
      bunchPerBox:{type:sql.Float,value:p.total_bunch/p.pcs},stemPerBunch:{type:sql.Float,value:p.total_stems/p.total_bunch},
      stemPerBox:{type:sql.Float,value:p.total_stems/p.pcs},box:{type:sql.Float,value:p.pcs},
      bunch:{type:sql.Float,value:p.total_bunch},stem:{type:sql.Float,value:p.total_stems},sentinel:{type:sql.Float,value:p.total_bunch+10000},
      previousDetail:{type:sql.Int,value:8400+line.lineNo},currentDetail:{type:sql.Int,value:8500+line.lineNo},
    });
  }
  await query(pool,`INSERT dbo.WebInvoiceDocument
    (DocumentId,OrderYear,OrderWeek,Revision,FarmKey,InvoiceNo,InvoiceYear,SourceHash,OriginalFileName,BusinessKeyHash,
     ReceiptStatus,CostStatus,RawMetadataJson,ReviewedMetadataJson,CreatedBy,CreatedAt,UpdatedBy,UpdatedAt)
    VALUES(@id,N'2026',N'41-02',1,7101,@invoice,N'2026',@hash,@filename,NULL,N'DRAFT',N'PENDING',@raw,@reviewed,
      N'invoice-fixture',SYSUTCDATETIME(),N'invoice-fixture',SYSUTCDATETIME());`,{
    id:{type:sql.UniqueIdentifier,value:scenario.documentId},invoice:{type:sql.NVarChar(100),value:invoiceNo},
    hash:{type:sql.Binary(32),value:Buffer.from(scenario.sourceHash,'hex')},filename:{type:sql.NVarChar(500),value:scenario.originalFileName},
    raw:{type:sql.NVarChar(sql.MAX),value:sourceBefore},reviewed:{type:sql.NVarChar(sql.MAX),value:JSON.stringify(metadata)},
  });
  for(const line of scenario.lines){
    const p=line.source;
    await query(pool,`INSERT dbo.WebInvoiceLine
      (DocumentId,Revision,LineId,[LineNo],OriginalName,LengthText,ProdKey,BoxQuantity,BunchQuantity,StemQuantity,
       PriceUnit,UnitPrice,Currency,LineAmount,SourceEvidenceJson,ReviewedJson)
      VALUES(@id,1,@lineId,@lineNo,@name,@length,@pk,@box,@bunch,@stem,N'단',@price,N'CNY',@amount,@source,@reviewed);`,{
      id:{type:sql.UniqueIdentifier,value:scenario.documentId},lineId:{type:sql.UniqueIdentifier,value:line.lineId},lineNo:{type:sql.Int,value:line.lineNo},
      name:{type:sql.NVarChar(500),value:p.source_description||p.description},length:{type:sql.NVarChar(100),value:p.stem_length||''},
      pk:{type:sql.Int,value:line.prodKey},box:{type:sql.Decimal(18,6),value:p.pcs},bunch:{type:sql.Decimal(18,6),value:p.total_bunch},
      stem:{type:sql.Decimal(18,6),value:p.total_stems},price:{type:sql.Decimal(18,6),value:p.u_price},amount:{type:sql.Decimal(18,6),value:p.t_price},
      source:{type:sql.NVarChar(sql.MAX),value:JSON.stringify(p)},
      reviewed:{type:sql.NVarChar(sql.MAX),value:JSON.stringify({unit:'단',TEST_ONLY:'synthetic fixture mapping; not actual ERP matching'})},
    });
  }
  const protectedBefore=await protectedSnapshot(pool);
  const ctx=writerContext(pool,writer);
  const preview=await ctx.preview(scenario.documentId,1);
  assertCanonicalMetadata(preview.document.reviewedMetadata);
  ensure(preview.canCommit===true,`28-row synthetic mapping writer preview must pass: ${JSON.stringify(preview.issues)}`);
  const committed=await commitArgs(ctx,scenario.documentId,scenario.operationId,scenario.receiptPartId,preview.baselineDigest);
  const replay=await commitArgs(ctx,scenario.documentId,scenario.operationId,scenario.receiptPartId,preview.baselineDigest);
  assert.deepEqual(replay,committed,'private 28-row writer replay must be idempotent');
  const details=(await query(pool,`SELECT ProdKey,BoxQuantity,BunchQuantity,SteamQuantity,OutQuantity,EstQuantity,UPrice,TPrice
    FROM dbo.WarehouseDetail WHERE WarehouseKey=@wk ORDER BY ProdKey;`,{wk:{type:sql.Int,value:committed.warehouseKey}})).recordset;
  ensure(details.length===28,'actual source must create exactly 28 distinct warehouse price lines');
  const sum=key=>details.reduce((total,row)=>total+Number(row[key]),0);
  for(const [key,value] of Object.entries({BoxQuantity:159,BunchQuantity:2380,SteamQuantity:30900,TPrice:57330}))
    ensure(Math.abs(sum(key)-value)<0.000001,`actual workbook ${key} must be conserved in WarehouseDetail`);
  for(const [i,detail] of details.entries()){
    const line=scenario.lines[i],p=line.source;
    ensure(detail.ProdKey===line.prodKey&&Math.abs(detail.UPrice-p.u_price)<0.000001&&Math.abs(detail.TPrice-p.t_price)<0.000001
      &&Math.abs(detail.BoxQuantity-p.pcs)<0.000001&&Math.abs(detail.BunchQuantity-p.total_bunch)<0.000001
      &&Math.abs(detail.SteamQuantity-p.total_stems)<0.000001&&Math.abs(detail.OutQuantity-p.total_bunch)<0.000001
      &&Math.abs(detail.EstQuantity-p.total_bunch)<0.000001,'each original quantity and separate unit/total price must survive writer commit');
  }
  const stock=(await query(pool,`SELECT p.ProdKey,p.Stock,ps.Stock WeekStock,prior.Stock PriorYearStock,
      sh.BeforeValue,sh.AfterValue,sh.OrderYear,sh.OrderWeek,
      (SELECT COUNT_BIG(*) FROM dbo.StockHistory allSh WHERE allSh.ProdKey=p.ProdKey) HistoryCount
    FROM dbo.Product p JOIN dbo.ProductStock ps ON ps.ProdKey=p.ProdKey AND ps.StockKey=2612
    JOIN dbo.ProductStock prior ON prior.ProdKey=p.ProdKey AND prior.StockKey=2512
    JOIN dbo.StockHistory sh ON sh.ProdKey=p.ProdKey
    WHERE p.ProdKey>=7300 AND p.ProdKey<7328 ORDER BY p.ProdKey;`)).recordset;
  ensure(stock.length===28,'28 synthetic products must have native stock and history readback');
  for(const [i,row] of stock.entries())ensure(row.ProdKey===scenario.lines[i].prodKey&&row.PriorYearStock===0&&row.BeforeValue===0
    &&Math.abs(row.Stock-scenario.lines[i].source.total_bunch)<0.000001
    &&Math.abs(row.WeekStock-scenario.lines[i].source.total_bunch)<0.000001
    &&Math.abs(row.AfterValue-scenario.lines[i].source.total_bunch)<0.000001
    &&Number(row.HistoryCount)===1&&row.OrderYear==='2026'&&row.OrderWeek==='41-02',
  'synthetic stock/history must match source bunches once and preserve previous-year sentinel');
  assert.deepEqual(await protectedSnapshot(pool),protectedBefore,'28-row writer must preserve staging and all order/shipment sentinels');
  const saveArgs={withTransactionFn:withTransactionFn(pool),types:sql,documentId:scenario.documentId,revision:1,
    actor:'invoice-fixture-cost',input:costInput,reason:'TEST_ONLY synthetic matching, CW/FX/tariff/customs and combined-charge classification; not real approval'};
  const saved=await costApi.saveInvoiceCostRevision(saveArgs);
  ensure(saved.idempotent===false&&saved.status==='APPROVED'&&saved.currentActual?.lines.length===28,
    'TEST_ONLY CN_AIR cost must save 28 actual-quantity lines');
  const read=await costApi.readInvoiceCosts({queryFn:(statement,params={})=>query(pool,statement,params),types:sql,warehouseKey:committed.warehouseKey});
  ensure(read.status==='APPROVED'&&read.currentActual?.lines.length===28&&read.currentActual.formulaId==='CN_AIR_WEIGHT_CBM_V1',
    'TEST_ONLY CN_AIR SQL read must return all 28 approved fixture cost lines');
  const editable=read.currentActual.editableInput;
  ensure(editable&&typeof editable==='object','actual 28-row cost read must expose sanitized editableInput');
  assert.deepEqual(Object.keys(editable).sort(),['input','invoiceSourceHash'],'editableInput must contain only the approved input and source identity');
  assert.equal(editable.invoiceSourceHash,scenario.sourceHash,'editable input must belong to the actual source workbook');
  assert.deepEqual(Object.keys(editable.input).sort(),[
    'formulaEffectiveDate','nativeCurrency','freightCurrency','exchangeRateType','exchangeRateDate','costSourceId','allocationScope',
    'exchangeRateKRW','freightAmount','customsTotalKRW','allocationShareNumerator','allocationShareDenominator','expected95Quantity',
    'formulaId','formulaVersion','formulaSourceHash','formulaSourceSheet','formulaSourceCells','formulaApplicabilityConfirmed','lineInputs',
  ].sort(),'editable input must expose only explicitly allowed formula/cost fields');
  assert.equal(editable.input.formulaApplicabilityConfirmed,false,'restored approved costs require explicit applicability reconfirmation');
  assert.equal(editable.input.lineInputs.length,28,'editable input must restore all actual source line weights');
  const remainingSourceLines=new Map(scenario.lines.map(line=>[line.lineId.toLowerCase(),line]));
  let editableGrossWeight=0;
  for(const line of editable.input.lineInputs){
    assert.deepEqual(Object.keys(line).sort(),['lineId','tariffRate','otherCostPerUnitKRW','stemsPerBunch','grossWeightKg','volumeWeightKg'].sort(),
      'restored line input must contain only approved numeric fields and line identity');
    const sourceLine=remainingSourceLines.get(line.lineId);
    ensure(sourceLine,'editable line identity must be unique and belong to the actual 28-row invoice');
    remainingSourceLines.delete(line.lineId);
    assert.equal(line.grossWeightKg,sourceLine.source.gross_weight,'editable line GW must retain the actual workbook weight');
    assert.equal(line.volumeWeightKg,null,'GW=CW fixture must restore blank CBM/volume weight as null, not invent a value');
    assert.equal(line.tariffRate,0);assert.equal(line.otherCostPerUnitKRW,0);
    assert.equal(line.stemsPerBunch,null,'unused cost inputs must not be invented during restoration');
    editableGrossWeight+=line.grossWeightKg;
  }
  assert.equal(remainingSourceLines.size,0,'editable input must cover every source line exactly once');
  ensure(Math.abs(editableGrossWeight-metadata.gw)<0.000001&&Math.abs(editableGrossWeight-metadata.cw)<0.000001,
    'restored line weights must match canonical document gw and explicit TEST_ONLY cw');
  const assertNoPrivateSnapshots=value=>{
    if(!value||typeof value!=='object')return;
    for(const [key,child] of Object.entries(value)){
      ensure(!['_snapshot','snapshot','rawsnapshot','rawinput','inputsnapshotjson','receiptsnapshot'].includes(key.toLowerCase()),
        'actual cost read must not expose private snapshots or unsanitized raw input');
      assertNoPrivateSnapshots(child);
    }
  };
  assertNoPrivateSnapshots(read);
  const totals=read.currentActual.lines.reduce((sum,line)=>{
    for(const key of ['goodsNative','freightNative','customsKRW'])sum[key]+=Number(line.componentAmounts[key]);
    sum.totalCostKRW+=Number(line.totalCostKRW);return sum;
  },{goodsNative:0,freightNative:0,customsKRW:0,totalCostKRW:0});
  for(const [key,value] of Object.entries({goodsNative:57330,freightNative:27514.9,customsKRW:1000,totalCostKRW:84844.9*230+1000}))
    ensure(Math.abs(totals[key]-value)<0.0001,`TEST_ONLY CN_AIR cost ${key} must conserve all allocated totals`);
  const costReplay=await costApi.saveInvoiceCostRevision(saveArgs);
  ensure(costReplay.idempotent===true&&costReplay.savedCostRevisionId===saved.currentActual.costRevisionId,
    'private CN_AIR cost replay must reuse the original revision');
  const stored=(await query(pool,`SELECT r.InputSnapshotJson,
    (SELECT COUNT_BIG(*) FROM dbo.WebInvoiceCostLine l WHERE l.CostRevisionId=r.CostRevisionId) LineCount,
    d.RawMetadataJson,d.ReviewedMetadataJson,d.SourceHash FROM dbo.WebInvoiceCostRevision r
    JOIN dbo.WebInvoiceDocument d ON d.DocumentId=r.DocumentId WHERE r.DocumentId=@id;`,{
    id:{type:sql.UniqueIdentifier,value:scenario.documentId},
  })).recordset;
  ensure(stored.length===1&&Number(stored[0].LineCount)===28,'idempotent private CN_AIR cost must leave one revision and 28 lines');
  ensure(JSON.parse(stored[0].InputSnapshotJson).invoiceSourceHash===scenario.sourceHash
    &&Buffer.from(stored[0].SourceHash).toString('hex')===scenario.sourceHash,'cost and document must retain actual workbook SHA-256');
  assert.equal(stored[0].RawMetadataJson,sourceBefore,'raw actual source must not gain synthetic mappings or a fabricated CW');
  assertCanonicalMetadata(JSON.parse(stored[0].ReviewedMetadataJson));
  const reloaded=await documents.getInvoiceDocument({queryFn:(statement,params={})=>query(pool,statement,params),types:sql,documentId:scenario.documentId});
  assertCanonicalMetadata(reloaded.reviewedMetadata);
  assert.equal(JSON.stringify(scenario.invoice),sourceBefore,'actual parser output must remain unmodified');
  assert.deepEqual(await protectedSnapshot(pool),protectedBefore,'cost save/read must preserve order/shipment/staging sentinels');
  await testPrivateStageLogsAndCostExport(pool,scenario,committed,read,reloaded);
  console.log('ok - actual invoice quantities/prices with synthetic fixture matching and TEST_ONLY cost inputs: 28 lines, 159 boxes, 2380 bunches, 30900 stems, CNY goods 57330 / grand 84844.9, GW 1985.94; writer/stock/cost readback and idempotency passed.');
}

async function main() {
  stage('argument and local-input preflight');
  const args=parseArgs(process.argv);
  if(args.help){usage();return;}
  const inputs=readInputs();
  stage('load writer and document adapters');
  const writer=await import(pathToFileURL(WRITER_FILE).href);
  const documents=await import(pathToFileURL(DOCUMENTS_FILE).href);
  const costs=await import(pathToFileURL(COST_FILE).href);
  ensure(typeof writer.createInvoiceReceipt==='function'&&typeof writer.previewInvoiceReceipt==='function',
    'invoice writer exports are incomplete');
  ensure(typeof costs.saveInvoiceCostRevision==='function'&&typeof costs.readInvoiceCosts==='function'
    &&costs.INVOICE_COST_FORMULAS?.CN_SEA_ACTUAL_V1,
  'invoice cost adapter exports are incomplete');
  stage('inspect approved loopback fixture container');
  const {password,image}=inspectApprovedContainer();
  secretToRedact = password;
  const database=newDatabaseName();
  let master,pool,created=false;
  try{
    stage('connect to approved fixture SQL endpoint');
    master=await new sql.ConnectionPool({user:'sa',password,server:HOST,port:PORT,database:'master',
      options:{encrypt:false,trustServerCertificate:true,enableArithAbort:true},pool:{min:0,max:1,idleTimeoutMillis:60000},
      connectionTimeout:5000,requestTimeout:15000}).connect();
    stage('verify generated database name is absent');
    const collision=await query(master,'SELECT DB_ID(@name) ExistingId;',{name:{type:sql.NVarChar(128),value:database}});
    ensure(collision.recordset?.[0]?.ExistingId==null,'unique fixture database unexpectedly exists; refusing reuse');
    stage('create invocation-owned fixture database');
    await query(master,`CREATE DATABASE ${bracketDatabase(database)};`);
    created=true;
    stage(`set fixture database collation ${FIXTURE_COLLATION}`);
    await query(master,`ALTER DATABASE ${bracketDatabase(database)} COLLATE ${FIXTURE_COLLATION};`);
    stage('set fixture compatibility level 130');
    await query(master,`ALTER DATABASE ${bracketDatabase(database)} SET COMPATIBILITY_LEVEL=130;`);
    stage('connect to invocation-owned fixture database');
    pool=await new sql.ConnectionPool({user:'sa',password,server:HOST,port:PORT,database,
      options:{encrypt:false,trustServerCertificate:true,enableArithAbort:true},pool:{min:0,max:2,idleTimeoutMillis:60000},
      connectionTimeout:5000,requestTimeout:60000}).connect();
    stage('initialize fixture transaction settings and verify compatibility');
    await query(pool,'SET LOCK_TIMEOUT 5000; SET XACT_ABORT ON;');
    const level=await query(pool,'SELECT compatibility_level FROM sys.databases WHERE name=DB_NAME();');
    ensure(Number(level.recordset?.[0]?.compatibility_level)===130,'fixture database must use compatibility level 130');
    const collation=(await query(pool,`SELECT CONVERT(nvarchar(128),DATABASEPROPERTYEX(DB_NAME(),'Collation')) DatabaseCollation;`)).recordset?.[0]?.DatabaseCollation;
    ensure(collation===FIXTURE_COLLATION,`fixture database collation must be ${FIXTURE_COLLATION}, got ${collation||'missing'}`);
    stage('apply isolated invoice receipt base schema');
    await runBatches(pool,inputs.schema,'invoice receipt base schema');
    await installNativeObjects(pool,inputs);
    stage('apply six-table web invoice migration');
    await applyMigration(pool,inputs.migration);
    stage('verify six migrated tables are empty');
    for(const table of TABLES){
      const count=await query(pool,`SELECT COUNT_BIG(*) AS [RowCount] FROM dbo.[${table}];`);
      ensure(Number(count.recordset?.[0]?.RowCount)===0,`fresh ${table} must be empty before fixture seeding`);
    }
    await seedSentinelsAndRows(pool);
    if(process.env.NENOVA_FIXTURE_42_EVIDENCE){
      await require('./test-packing-42-receipt-browser.cjs')({pool,sql,query,writer,documents,ctx:writerContext(pool,writer),protectedSnapshot});
      return;
    }
    console.log(`SETUP: image=${image}, endpoint=${HOST}:${PORT}, database=${database}, compatibility=130, collation=${collation}`);
    console.log('MODE: actual web invoice writer SQL fixture; native CommonLogic eligibility SP is not executed.');
    stage('omitted ViewOrder blocker scenario');
    await testOmittedOrderViewBlocks(pool,writer);
    stage('capture protected fixture baseline');
    const protectedBefore=await protectedSnapshot(pool);
    stage('writer success, native parity, and quantity revision scenarios');
    await testWriterSuccessReplayAndCrossYear(pool,writer,documents,protectedBefore);
    stage('simultaneous same-operation concurrency scenario');
    await testConcurrentSameOperation(pool,writer);
    stage('simultaneous different-operation concurrency scenario');
    await testConcurrentDifferentOperations(pool,writer);
    stage('post-commit lost-response recovery scenario');
    await testCommitResponseLostRecovery(pool,writer);
    stage('stock calculation failure rollback scenario');
    await testStockCalculationFailureRollback(pool,writer,protectedBefore);
    stage('busy gate preservation scenario');
    await testBusyGatePreserved(pool,writer,protectedBefore);
    stage('actual invoice cost save/read/idempotency and EXE-detail stale-read scenarios');
    await testCostSaveReadIdempotencyAndStaleExeDetail(pool,writer,costs);
    // Optional private case is deliberately last; existing protected baselines
    // and every mandatory synthetic scenario above retain their original scope.
    await testPrivateChinaInvoiceWriterAndAirCost(pool,writer,costs,documents);
    await testExistingCostLink(pool,costs);
    await testExistingCostLink(pool,costs,true);
    stage('fixture scenarios passed');
    console.log('PASS: isolated invoice receipt writer SQL fixture scenarios completed.');
  }finally{
    await pool?.close().catch(()=>{});
    if(master&&created){
      await query(master,`ALTER DATABASE ${bracketDatabase(database)} SET SINGLE_USER WITH ROLLBACK IMMEDIATE;
        DROP DATABASE ${bracketDatabase(database)};`).catch(error=>{
        console.error(`FIXTURE_CLEANUP_FAILED: database=${database}; ${error.message}`);process.exitCode=1;
      });
    }
    await master?.close().catch(()=>{});
  }
}

main().catch(error=>{
  // Only structured, password-redacted diagnostics are emitted; never dump connection settings.
  logFailure(error);
  process.exitCode=1;
});
