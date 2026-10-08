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

async function applyMigration(pool, source) { await runBatches(pool,source,'web invoice migration'); }

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
