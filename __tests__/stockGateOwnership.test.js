/*
 * Offline: node __tests__/stockGateOwnership.test.js
 * Mandatory isolated SQL: node __tests__/stockGateOwnership.test.js --sql
 * --sql reads ONE explicit JSON configuration from stdin, never .env/app config:
 * {"fixtureOnly":true,"server":"127.0.0.1","port":14339,
 *  "database":"NenovaStockGateOwnerFixture","user":"<fixture user>","password":"<fixture password>"}
 * Main must create that EMPTY dedicated database first. Tests refuse other hosts,
 * ports/databases and any non-test dbo objects. They do NOT create/drop a database.
 * SQL2022 fixture database is set to compatibility 130. No credentials are logged.
 * Test fixtures deliberately include native-style ROLLBACK-all then delayed Leave.
 * The default offline success is NOT evidence that SQL concurrency tests passed.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const root = path.resolve(__dirname, '..');
const migrationPath = path.join(root, 'docs/migrations/2026-08-26_nenova_stock_gate_owner.sql');
const migration = fs.readFileSync(migrationPath, 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'docs/contracts/stock-gate-owner.json'), 'utf8'));
const helperSource = fs.readFileSync(path.join(root, 'lib/stockGateOperation.js'), 'utf8');
const loadGateHelper = () => import(`data:text/javascript;base64,${Buffer.from(helperSource).toString('base64')}`);
let passed = 0;
async function test(label, run) { await run(); passed++; console.log(`ok ${passed} - ${label}`); }

// Executable state oracle, NOT a substitute for executing the SQL below.
function idle() { return { mode: null, action: null, year: null, week: null, owner: null, token: null, pending: false, prod: null }; }
function enter(state, { owner, action, year = '2026', week = '34-02', prod = null, version = 2 }) {
  const valid = version === 2 && ['FIX', 'CANCEL', 'CALC'].includes(action)
    && /^\d{4}$/.test(year) && /^\d{2}-\d{2}$/.test(week)
    && (action === 'CALC' ? Number.isInteger(prod) && prod >= 0 : prod === null);
  if (!valid) return { result: -98, token: null };
  if (!(state.mode === null || (state.mode === 'WAIT_CALC' && state.pending && action === 'CALC'
      && prod === 0 && state.year === year && state.week === week))) return { result: -99, token: null };
  const token = randomUUID();
  Object.assign(state, { mode: 'RUN', owner, token, action, year, week, prod });
  return { result: 0, token };
}
function leave(state, { owner, token, action, success, version = 2 }) {
  if (version !== 2 || !token) return -98;
  if (state.mode !== 'RUN' || state.owner !== owner || state.token !== token || state.action !== action) return -97;
  if ((['FIX', 'CANCEL'].includes(action) && success) || (action === 'CALC' && !success)) {
    Object.assign(state, { mode: 'WAIT_CALC', pending: true, prod: null });
  } else Object.assign(state, idle());
  return 0;
}
function configFromStdin(text) {
  const c = JSON.parse(text);
  assert.equal(c.fixtureOnly, true, 'explicit fixtureOnly acknowledgement required');
  assert(['127.0.0.1', 'localhost'].includes(c.server), 'loopback only');
  assert.equal(c.port, 14339, 'dedicated fixture port only');
  assert.equal(c.database, 'NenovaStockGateOwnerFixture', 'dedicated empty fixture database only');
  assert.equal(typeof c.user, 'string'); assert(c.user.length > 0);
  assert.equal(typeof c.password, 'string'); assert(c.password.length > 0);
  assert(Object.keys(c).every(k => ['fixtureOnly', 'server', 'port', 'database', 'user', 'password'].includes(k)), 'no connection overrides');
  return { server: '127.0.0.1', port: 14339, database: c.database, user: c.user, password: c.password,
    options: { encrypt: false, trustServerCertificate: true, enableArithAbort: true },
    pool: { min: 1, max: 1, idleTimeoutMillis: 60000 }, connectionTimeout: 5000, requestTimeout: 15000 };
}

async function offline() {
  await test('source protocol is SQL2016-compatible and has no timeout/session-death reclaim', () => {
    assert(!/\bSTRING_AGG\s*\(|\bDATETRUNC\s*\(|\bGREATEST\s*\(|\bLEAST\s*\(/i.test(migration));
    assert(!/^\s*GO\s*$/im.test(migration));
    assert(!/LockedAt\s*<|sys\.dm_exec_(sessions|requests)/i.test(migration));
    assert.match(migration, /NEWID\(\)/);
    assert.match(migration, /OwnerSessionID=@@SPID AND OwnerToken=@OwnerToken/);
    assert.match(migration, /Mode=N''RUN'' AND Action=@Action/);
    assert.match(migration, /@nenovaGateCalcProdKey int=ISNULL\(@ProdKey,0\)/);
    assert.match(migration, /NATIVE_EXTERNAL_SIGNATURE_CHANGED/);
    assert.match(migration, /NATIVE_MODULE_SET_OPTIONS_CHANGED/);
    assert.match(migration, /STOCK_GATE_UNSAFE_CLEAR_DISABLED/);
    assert.match(migration, /c.is_disabled=0 AND c.is_not_trusted=0/);
    assert.match(migration, /NenovaStockGateOwnerV2StateHash/);
    assert.match(migration, /HASHBYTES\(''SHA2_256'',m\.definition\)/);
    assert(!/(INSERT\s+(?:INTO\s+)?|UPDATE\s+|DELETE\s+FROM\s+)(?:dbo\.)?(Product|StockHistory|ShipmentDetail|ProductStock)\b/i.test(migration));
    assert(manifest.requiredCommands.includes('node __tests__/stockGateOwnership.test.js --sql'));
    assert.match(migration, /HEADER_TOKEN_PATCH_BEGIN/);
    assert.match(migration, /SET @after=@before;/);
    assert(!/SET @after=REPLACE\(@before/.test(migration), 'business whitespace must not be normalized');
  });
  await test('same-session repeat Enter and active RUN older than 90 sec remain blocked', () => {
    const s = idle(), a = enter(s, { owner: 51, action: 'FIX' }), before = { ...s };
    assert.equal(a.result, 0);
    assert.equal(enter(s, { owner: 51, action: 'FIX' }).result, -99);
    assert.equal(enter(s, { owner: 52, action: 'CALC', prod: 0 }).result, -99);
    assert.deepEqual(s, before);
  });
  await test('old Leave cannot clear a new owner or a new generation on the same SPID', () => {
    for (const newOwner of [51, 52]) {
      const s = idle(), old = enter(s, { owner: 51, action: 'FIX' });
      leave(s, { owner: 51, action: 'FIX', token: old.token, success: false });
      const next = enter(s, { owner: newOwner, action: 'FIX' }), before = { ...s };
      assert.notEqual(old.token, next.token);
      assert.equal(leave(s, { owner: 51, action: 'FIX', token: old.token, success: false }), -97);
      assert.deepEqual(s, before);
    }
  });
  await test('same-SPID CALC rollback restores WAIT(T0), not permission for Leave(T1)', () => {
    const s = idle(), a = enter(s, { owner: 51, action: 'FIX' });
    leave(s, { owner: 51, action: 'FIX', token: a.token, success: true });
    const before = { ...s }, b = enter(s, { owner: 51, action: 'CALC', prod: 0 });
    Object.assign(s, before); // SQL ROLLBACK restores the previous durable row, not SQL local token b.
    assert.equal(leave(s, { owner: 51, action: 'CALC', token: b.token, success: false }), -97);
    assert.deepEqual(s, before);
  });
  await test('WAIT transfers across EXE connections only for matching full calculation; failure retains it', () => {
    const s = idle(), a = enter(s, { owner: 51, action: 'CANCEL' });
    leave(s, { owner: 51, action: 'CANCEL', token: a.token, success: true });
    for (const input of [{ year: '2025' }, { week: '34-01' }, { prod: 101 }]) {
      const before = { ...s };
      assert.equal(enter(s, { owner: 52, action: 'CALC', prod: 0, ...input }).result, -99);
      assert.deepEqual(s, before);
    }
    const b = enter(s, { owner: 52, action: 'CALC', prod: 0 });
    assert.equal(b.result, 0);
    leave(s, { owner: 52, action: 'CALC', token: b.token, success: false });
    assert.equal(s.mode, 'WAIT_CALC'); assert.equal(s.pending, true);
    const c = enter(s, { owner: 53, action: 'CALC', prod: 0 });
    leave(s, { owner: 53, action: 'CALC', token: c.token, success: true });
    assert.deepEqual(s, idle());
  });
  await test('isolated configuration cannot fall back to app/production connection settings', () => {
    const c = { fixtureOnly: true, server: '127.0.0.1', port: 14339, database: 'NenovaStockGateOwnerFixture', user: 'fixture', password: 'fixture' };
    assert.equal(configFromStdin(JSON.stringify(c)).port, 14339);
    for (const override of [{ fixtureOnly: false }, { server: 'production' }, { port: 1433 }, { database: 'Nenova' }, { options: {} }])
      assert.throws(() => configFromStdin(JSON.stringify({ ...c, ...override })));
  });
  const { lockStockGateOperation, clearStockGateOperation } = await loadGateHelper();
  const types = { Int: 'Int', NVarChar: 'NVarChar' };
  const scope = { orderYear: '2026', orderWeek: '34-02', action: 'CANCEL' };
  function fake(version = 2, overrides = {}) {
    const calls = [];
    const tQ = async (text, params) => {
      calls.push({ text, params });
      if (overrides.error) throw overrides.error;
      let row;
      if (text.includes('@@SPID AS SessionID')) row = { GateKey: '1', Mode: null, LockedAt: null, Action: null,
        OrderYear: null, OrderWeek: null, SessionID: 51, TransactionCount: 1, TransactionState: 1, ...overrides.gate };
      else if (text.includes('OwnerColumnCount')) row = { OwnerColumnCount: version === 2 ? 5 : 0,
        TypedColumnCount: version === 2 ? 5 : 0, CapabilityObjectID: version === 2 ? 123 : null, ...overrides.metadata };
      else if (text === 'EXEC dbo.usp_NenovaStockWeekGateCapability') row = { ProtocolVersion: 2, IsReady: true, ...overrides.capability };
      else if (text.startsWith('SELECT OwnerSessionID')) row = { OwnerSessionID: null, OwnerToken: null,
        PendingCalc: false, CalcProdKey: null, ProtocolVersion: 2, ...overrides.owner };
      else if (text.includes('AS MarkerResult')) row = { MarkerResult: 0, ...overrides.marker };
      else if (text.includes('AS Cleared')) row = { Cleared: 1, OwnerToken: randomUUID(), ...overrides.clear };
      else assert.fail(`unexpected helper query: ${text}`);
      return { recordset: [row] };
    };
    return { tQ, calls };
  }
  await test('helper V2 locks first and clears only original transaction + owner token + exact scope', async () => {
    const f = fake(), operation = await lockStockGateOperation(f.tQ, types, scope);
    assert(Object.isFrozen(operation)); assert.equal(operation.protocolVersion, 2);
    assert.match(f.calls[0].text, /WITH \(UPDLOCK,HOLDLOCK,NOWAIT\)/);
    assert.match(f.calls[1].text, /OwnerColumnCount/);
    assert.match(f.calls.at(-1).text, /@LockOwner=N'Transaction'/);
    assert.match(f.calls.at(-1).params.marker.value, /^NenovaStockGateOperation:/);
    const result = await clearStockGateOperation(f.tQ, types, operation, { nativeResult: 0, nativeReturnCode: 0 });
    assert.equal(result.cleared, true);
    const clear = f.calls.at(-1);
    for (const pattern of [/APPLOCK_MODE/, /@@TRANCOUNT<>@trancount/, /OwnerSessionID=@@SPID AND OwnerToken=@ownedToken/,
      /OrderYear=@yr AND OrderWeek=@wk AND Action=@action/, /OwnerSessionID=NULL,OwnerToken=NULL,PendingCalc=0,CalcProdKey=NULL/,
      /@cleared<>1 THROW/]) assert.match(clear.text, pattern);
    assert.equal(clear.params.yr.value, '2026'); assert.equal(clear.params.wk.value, '34-02');
    assert(!f.calls.some(x => /EXEC\s+dbo\.usp_NenovaStockWeekGateClear/i.test(x.text)));
    await assert.rejects(clearStockGateOperation(f.tQ, types, operation, { nativeResult: 0 }), { code: 'STOCK_GATE_OPERATION_INVALID' });
  });
  await test('helper V1 bridge has same-transaction scoped clear; new quantity never downgrades', async () => {
    const f = fake(1), operation = await lockStockGateOperation(f.tQ, types, { ...scope, requireV2: false });
    assert.equal(operation.protocolVersion, 1);
    await clearStockGateOperation(f.tQ, types, operation, { nativeResult: 0, nativeReturnCode: 0 });
    assert.match(f.calls.at(-1).text, /OrderYear=@yr AND OrderWeek=@wk AND Action=@action/);
    assert(!/OwnerToken|usp_NenovaStockWeekGateClear/.test(f.calls.at(-1).text));
    const strict = fake(1);
    await assert.rejects(lockStockGateOperation(strict.tQ, types, { ...scope, requireV2: true }), { code: 'STOCK_GATE_CAPABILITY_REQUIRED' });
    assert(!strict.calls.some(x => /sp_getapplock/.test(x.text)));
  });
  await test('helper partial V2, capability drift and inconsistent idle ownership all fail closed', async () => {
    for (const change of [
      { metadata: { OwnerColumnCount: 4 } }, { metadata: { TypedColumnCount: 4 } },
      { metadata: { CapabilityObjectID: null } }, { metadata: { OwnerColumnCount: 0, TypedColumnCount: 0 } },
      { capability: { ProtocolVersion: 1 } }, { capability: { IsReady: false } },
      { owner: { OwnerToken: randomUUID() } }, { owner: { PendingCalc: true } }, { owner: { OwnerSessionID: 51 } }
    ]) {
      const f = fake(2, change);
      await assert.rejects(lockStockGateOperation(f.tQ, types, scope), { code: 'STOCK_GATE_CAPABILITY_REQUIRED' });
      assert(!f.calls.some(x => /AS Cleared/.test(x.text)));
    }
  });
  await test('helper rejects busy gate, missing transaction, invalid scope and unavailable transaction marker', async () => {
    for (const mode of ['RUN', 'WAIT_CALC']) {
      const f = fake(2, { gate: { Mode: mode } });
      await assert.rejects(lockStockGateOperation(f.tQ, types, scope), { code: 'STOCK_GATE_BUSY' });
      assert.equal(f.calls.length, 1);
    }
    for (const gate of [{ TransactionCount: 0 }, { TransactionState: -1 }, { SessionID: 0 }]) {
      const f = fake(2, { gate });
      await assert.rejects(lockStockGateOperation(f.tQ, types, scope), { code: 'STOCK_GATE_TRANSACTION_REQUIRED' });
    }
    for (const MarkerResult of [undefined, null, -1, NaN]) {
      const f = fake(2, { marker: { MarkerResult } });
      await assert.rejects(lockStockGateOperation(f.tQ, types, scope), { code: 'STOCK_GATE_TRANSACTION_REQUIRED' });
    }
    for (const invalid of [{ orderYear: '' }, { orderWeek: '' }, { action: 'CALC' }, { action: false }]) {
      const f = fake();
      await assert.rejects(lockStockGateOperation(f.tQ, types, { ...scope, ...invalid }), { code: 'STOCK_GATE_SCOPE_INVALID' });
      assert.equal(f.calls.length, 0);
    }
    const locked = fake(2, { error: Object.assign(new Error('locked'), { number: 1222 }) });
    await assert.rejects(lockStockGateOperation(locked.tQ, types, scope), { code: 'STOCK_GATE_BUSY' });
  });
  await test('helper does not clear on false/omitted native success, bad return code or different tQ', async () => {
    for (const output of [{}, { nativeResult: 0 }, { nativeResult: null, nativeReturnCode: 0 },
      { nativeResult: 0, nativeReturnCode: null }, { nativeResult: false }, { nativeResult: '0' },
      { nativeResult: -1 }, { nativeResult: 0, nativeReturnCode: -1 }]) {
      const f = fake(), operation = await lockStockGateOperation(f.tQ, types, scope), count = f.calls.length;
      await assert.rejects(clearStockGateOperation(f.tQ, types, operation, output), { code: 'STOCK_GATE_NATIVE_NOT_SUCCESSFUL' });
      assert.equal(f.calls.length, count);
    }
    const f = fake(), operation = await lockStockGateOperation(f.tQ, types, scope);
    await assert.rejects(clearStockGateOperation(async () => {}, types, operation, { nativeResult: 0 }), { code: 'STOCK_GATE_OPERATION_INVALID' });
    for (const Cleared of [0, 2, undefined]) {
      const bad = fake(2, { clear: { Cleared } }), op = await lockStockGateOperation(bad.tQ, types, scope);
      await assert.rejects(clearStockGateOperation(bad.tQ, types, op, { nativeResult: 0, nativeReturnCode: 0 }), { code: 'STOCK_GATE_CLEAR_ROWCOUNT_MISMATCH' });
    }
  });
}

// Minimal native bodies test gate/transaction mechanics, not ERP formula parity.
// Exact legacy gate injection is the same format as the existing installer.
function legacyNative(name, action) {
  const scopeArg = action === 'CALC' ? '@ProdKey int,' : '@CountryFlower nvarchar(100),';
  return `CREATE OR ALTER PROCEDURE dbo.${name}
 @OrderYear nvarchar(20), @OrderWeek nvarchar(20), ${scopeArg}
 @iUserID nvarchar(20), @oResult int OUTPUT, @oMessage nvarchar(max) OUTPUT
AS
BEGIN
 SET NOCOUNT ON;
 SET @oResult=0; SET @oMessage=N'';
 DECLARE @gateRes int, @gateMsg nvarchar(200);
 EXEC dbo.usp_NenovaStockWeekGateEnter
  @Action = N'${action}', @OrderYear = @OrderYear, @OrderWeek = @OrderWeek,
  @oResult = @gateRes OUTPUT, @oMessage = @gateMsg OUTPUT;
 IF ISNULL(@gateRes,0)<>0 BEGIN SET @oResult=@gateRes; SET @oMessage=@gateMsg; RETURN; END;
 BEGIN TRY
  BEGIN TRANSACTION;
  -- FIXTURE_BUSINESS_BEGIN (must be byte-for-byte preserved by migration)
  INSERT\tdbo.StockGateOwnerFixtureLedger(Kind) VALUES(N'${action}');
  IF @iUserID IN(N'fixture_fail',N'fixture_pause') THROW 51070, 'FIXTURE_NATIVE_FAILURE', 1;
  -- FIXTURE_BUSINESS_END
  COMMIT TRANSACTION;
  SET @oResult=0;
  EXEC dbo.usp_NenovaStockWeekGateLeave @Action = N'${action}', @Success = 1;
  RETURN 0;
 END TRY
 BEGIN CATCH
  IF @@TRANCOUNT>0 ROLLBACK TRANSACTION;
  IF @iUserID=N'fixture_pause'
  BEGIN
   INSERT dbo.StockGateOwnerFixtureLedger(Kind) VALUES(N'rollback_ready');
   WAITFOR DELAY '00:00:03';
  END;
  SET @oResult=-1; SET @oMessage=ERROR_MESSAGE();
  EXEC dbo.usp_NenovaStockWeekGateLeave @Action = N'${action}', @Success = 0;
  RETURN -1;
 END CATCH;
END;`.replace(/\r?\n/g, '\r\n');
}
const nativeNames = [['usp_ShipmentFix', 'FIX'], ['usp_ShipmentFixCancel', 'CANCEL'], ['usp_StockCalculation', 'CALC']];
async function sqlTests(config) {
  const sql = require('mssql'); // only reached after explicit --sql and strict target validation
  const pools = [];
  const connect = async () => { const p = await new sql.ConnectionPool(config).connect(); pools.push(p); return p; };
  const query = (p, text) => p.request().query(text);
  const injectedQuery = owner => async (text, params = {}) => {
    const request = new sql.Request(owner);
    for (const [name, parameter] of Object.entries(params)) request.input(name, parameter.type, parameter.value);
    return request.query(text);
  };
  const scalar = async (p, text) => (await query(p, text)).recordset[0];
  const escaped = s => String(s).replace(/'/g, "''");
  async function acquire(p, action = 'FIX', { year = '2026', week = '34-02', prod = null } = {}) {
    return scalar(p, `DECLARE @r int,@m nvarchar(200),@t uniqueidentifier;
      EXEC dbo.usp_NenovaStockWeekGateEnter @Action=N'${action}',@OrderYear=N'${year}',@OrderWeek=N'${week}',
        @oResult=@r OUTPUT,@oMessage=@m OUTPUT,@ProtocolVersion=2,@OwnerToken=@t OUTPUT,@CalcProdKey=${prod == null ? 'NULL' : prod};
      SELECT @r AS result,@t AS token,@@SPID AS spid;`);
  }
  async function release(p, action, token, success) {
    return scalar(p, `DECLARE @r int; EXEC dbo.usp_NenovaStockWeekGateLeave
      @Action=N'${action}',@Success=${success ? 1 : 0},@ProtocolVersion=2,@OwnerToken='${escaped(token)}',@oResult=@r OUTPUT;
      SELECT @r AS result;`);
  }
  const state = p => scalar(p, 'SELECT * FROM dbo.NenovaStockWeekGate WHERE GateKey=\'1\';');
  const capability = p => scalar(p, 'EXEC dbo.usp_NenovaStockWeekGateCapability;');
  const migrate = p => query(p, `EXEC sys.sp_set_session_context @key=N'nenova_stock_gate_owner_migration',@value=1;\n${migration}`);
  const nativeCall = (name, uid = 'fixture', outer = false, nullProd = false) => `${outer ? 'BEGIN TRANSACTION;' : ''}
    DECLARE @r int,@m nvarchar(max),@ret int;
    EXEC @ret=dbo.${name} @OrderYear=N'2026',@OrderWeek=N'34-02',
      ${name === 'usp_StockCalculation' ? `@ProdKey=${nullProd ? 'NULL' : 0}` : "@CountryFlower=N'fixture'"},
      @iUserID=N'${uid}',@oResult=@r OUTPUT,@oMessage=@m OUTPUT;
    ${outer ? 'IF @@TRANCOUNT>0 COMMIT TRANSACTION;' : ''}
    SELECT @r AS result,@ret AS returnCode,@@TRANCOUNT AS trancount;`;
  const { lockStockGateOperation, clearStockGateOperation } = await loadGateHelper();
  async function helperRoundTrip(p, version, action = 'FIX') {
    const tx = new sql.Transaction(p); await tx.begin();
    const tQ = injectedQuery(tx);
    try {
      const operation = await lockStockGateOperation(tQ, sql, { orderYear: '2026', orderWeek: '34-02', action });
      assert.equal(operation.protocolVersion, version);
      const output = (await tQ(nativeCall(action === 'FIX' ? 'usp_ShipmentFix' : 'usp_ShipmentFixCancel'))).recordset[0];
      assert.equal(output.trancount, 1);
      await clearStockGateOperation(tQ, sql, operation, { nativeResult: output.result, nativeReturnCode: output.returnCode });
      const cleared = (await tQ("SELECT * FROM dbo.NenovaStockWeekGate WHERE GateKey='1';")).recordset[0];
      assert.equal(cleared.Mode, null);
      if (version === 2) {
        assert.equal(cleared.OwnerSessionID, null); assert.equal(cleared.OwnerToken, null);
        assert.equal(cleared.PendingCalc, false); assert.equal(cleared.CalcProdKey, null);
      }
      await tx.commit();
    } catch (error) { await tx.rollback().catch(() => {}); throw error; }
  }
  try {
    const a = await connect(), b = await connect(), c = await connect();
    const db = await scalar(a, 'SELECT DB_NAME() AS db,CONVERT(int,SERVERPROPERTY(\'ProductMajorVersion\')) AS major;');
    assert.equal(db.db, 'NenovaStockGateOwnerFixture'); assert(db.major >= 13);
    const allowed = ['NenovaStockWeekGate', 'StockGateOwnerFixtureLedger', 'StockGateOwnerFixtureMarker',
      ...nativeNames.map(x => x[0]), 'usp_NenovaStockWeekGateEnter', 'usp_NenovaStockWeekGateLeave',
      'usp_NenovaStockWeekGateClear', 'usp_NenovaStockWeekGateCapability'];
    const objects = (await query(a, "SELECT name FROM sys.objects WHERE schema_id=SCHEMA_ID(N'dbo') AND type IN('U','P') AND is_ms_shipped=0;")).recordset;
    assert(objects.every(o => allowed.includes(o.name)), 'refusing a database containing non-fixture dbo tables/procedures');
    if (objects.length) {
      assert(objects.some(o => o.name === 'StockGateOwnerFixtureMarker'), 'existing objects require an explicit fixture marker');
      const marker = await scalar(a, 'SELECT Purpose FROM dbo.StockGateOwnerFixtureMarker;');
      assert.equal(marker.Purpose, 'stockGateOwnership.test.js fixtures only');
    }
    await query(a, 'ALTER DATABASE [NenovaStockGateOwnerFixture] SET COMPATIBILITY_LEVEL=130;');
    assert.equal((await scalar(a, 'SELECT compatibility_level AS level FROM sys.databases WHERE name=DB_NAME();')).level, 130);
    // Dedicated fixture reset only after target/objects/marker checks; never touches an application DB.
    for (const name of allowed.filter(n => n.startsWith('usp_'))) await query(a, `IF OBJECT_ID(N'dbo.${name}',N'P') IS NOT NULL DROP PROCEDURE dbo.${name};`);
    for (const name of ['NenovaStockWeekGate', 'StockGateOwnerFixtureLedger', 'StockGateOwnerFixtureMarker'])
      await query(a, `IF OBJECT_ID(N'dbo.${name}',N'U') IS NOT NULL DROP TABLE dbo.${name};`);
    await query(a, `CREATE TABLE dbo.StockGateOwnerFixtureMarker(Purpose nvarchar(100) NOT NULL);
      INSERT dbo.StockGateOwnerFixtureMarker VALUES(N'stockGateOwnership.test.js fixtures only');
      CREATE TABLE dbo.StockGateOwnerFixtureLedger(ID int IDENTITY PRIMARY KEY,Kind nvarchar(40) NOT NULL);`);
    const legacy = fs.readFileSync(path.join(root, 'docs/migrations/2026-08-23_nenova_stock_week_gate.sql'), 'utf8');
    for (const batch of legacy.split(/^\s*GO\s*$/gim).filter(s => s.trim())) await query(a, batch);
    const originals = new Map();
    for (const [name, action] of nativeNames) {
      await query(a, legacyNative(name, action));
      originals.set(name, (await scalar(a, `SELECT OBJECT_DEFINITION(OBJECT_ID(N'dbo.${name}')) AS d;`)).d);
    }
    const signatures = async () => (await query(a, `SELECT OBJECT_NAME(object_id) AS name,parameter_id,name AS param,
      system_type_id,max_length,precision,scale,is_output FROM sys.parameters
      WHERE object_id IN(${nativeNames.map(([n]) => `OBJECT_ID(N'dbo.${n}')`).join(',')}) ORDER BY object_id,parameter_id;`)).recordset;
    const beforeSignatures = await signatures();

    await test('SQL130 header scanner accepts whitespace/comments but never rewrites business text', async () => {
      const scanner = migration.split('-- HEADER_TOKEN_PATCH_BEGIN:')[1].split('-- HEADER_TOKEN_PATCH_END:')[0];
      // Keep the exact migration SQL executable, rather than a JS reimplementation.
      const fragment = scanner.slice(scanner.indexOf('SET @scan=1;'));
      const suffix = "PROCEDURE dbo.fixture @x int AS\r\nBEGIN\r\n\tSELECT N'CREATE   PROCEDURE  unchanged';\r\nEND;";
      const headers = ['CREATE ', 'CREATE   ', 'CREATE\t\r\n', 'CREATE\tOR\nALTER ', 'ALTER\t',
        '/* CREATE PROCEDURE decoy /* nested */ */\r\n-- CREATE PROCEDURE decoy\r\nCREATE   '];
      for (const header of headers) {
        const source = header + suffix;
        const request = a.request().input('after', sql.NVarChar(sql.MAX), source);
        const result = (await request.query(`DECLARE @scan int,@tokenStart int,@headerStart int,@procStart int,
          @phase int,@depth int,@word nvarchar(40),@ch nchar(1); ${fragment} SELECT @after AS d;`)).recordset[0].d;
        assert.equal(result.slice(result.indexOf('ALTER ') + 6), suffix);
        assert.equal(result.startsWith('/*'), source.startsWith('/*'));
      }
      for (const source of ['SELECT 1; CREATE PROCEDURE bad', 'CREATE PROCEDURE2 bad', '/* unclosed', '-- CREATE PROCEDURE bad']) {
        await assert.rejects(a.request().input('after', sql.NVarChar(sql.MAX), source).query(`DECLARE
          @scan int,@tokenStart int,@headerStart int,@procStart int,@phase int,@depth int,@word nvarchar(40),@ch nchar(1);
          ${fragment}`), /UNRECOGNIZED_NATIVE_HEADER/);
      }
    });
    await test('SQL130 V1 bridge uses original transaction scoped clear and refuses requireV2', async () => {
      await helperRoundTrip(a, 1, 'FIX'); await helperRoundTrip(a, 1, 'CANCEL');
      const tx = new sql.Transaction(a); await tx.begin();
      try {
        await assert.rejects(lockStockGateOperation(injectedQuery(tx), sql,
          { orderYear: '2026', orderWeek: '34-02', action: 'FIX', requireV2: true }), { code: 'STOCK_GATE_CAPABILITY_REQUIRED' });
      } finally { await tx.rollback(); }
    });
    await test('SQL130 migration refuses missing acknowledgement and committed pending work without clearing it', async () => {
      await assert.rejects(query(b, migration), /REQUIRES_MAIN_ACK_AND_DRAIN/);
      const native = await scalar(a, nativeCall('usp_ShipmentFix'));
      assert.equal(native.result, 0); assert.equal((await state(a)).Mode, 'WAIT_CALC');
      const pending = await state(a);
      await assert.rejects(migrate(b), /REQUIRES_IDLE_SINGLETON_NO_PENDING_WORK/);
      assert.deepEqual(await state(a), pending);
      assert.equal((await scalar(a, "SELECT COL_LENGTH(N'dbo.NenovaStockWeekGate',N'OwnerToken') AS n;")).n, null);
      await query(a, nativeCall('usp_StockCalculation'));
    });
    await test('SQL130 migration preserves native signatures/business bodies and is idempotent', async () => {
      const ledgerBefore = (await scalar(a, 'SELECT COUNT(*) AS n FROM dbo.StockGateOwnerFixtureLedger;')).n;
      await migrate(a); assert.equal((await capability(a)).IsReady, true);
      assert.equal((await scalar(a, 'SELECT COUNT(*) AS n FROM dbo.StockGateOwnerFixtureLedger;')).n, ledgerBefore);
      assert.deepEqual(await signatures(), beforeSignatures);
      for (const [name] of nativeNames) {
        const d = await scalar(a, `SELECT OBJECT_DEFINITION(OBJECT_ID(N'dbo.${name}')) AS definition;`);
        const business = text => text.match(/-- FIXTURE_BUSINESS_BEGIN[\s\S]*?-- FIXTURE_BUSINESS_END/)[0];
        assert.equal(business(d.definition), business(originals.get(name)));
        const reverseGatePatch = text => text
          .replace(', @nenovaGateOwnerToken uniqueidentifier; -- NENOVA_STOCK_GATE_OWNER_V2', ';')
          .replace(/\r?\nDECLARE @nenovaGateCalcProdKey int=ISNULL\(@ProdKey,0\);/, '')
          .replace(/@oMessage = @gateMsg OUTPUT, @ProtocolVersion = 2, @OwnerToken = @nenovaGateOwnerToken OUTPUT, @CalcProdKey = (?:@nenovaGateCalcProdKey|NULL);/, '@oMessage = @gateMsg OUTPUT;')
          .replace(/, @ProtocolVersion = 2, @OwnerToken = @nenovaGateOwnerToken;/g, ';');
        // External declaration and the ENTIRE remainder (not just a marker sample)
        // must match the original UTF-16 SQL definition after undoing gate-only edits.
        const fromParameters = text => text.slice(text.indexOf(' @OrderYear'));
        assert.equal(fromParameters(reverseGatePatch(d.definition)), fromParameters(originals.get(name)));
      }
      await migrate(a); assert.equal((await capability(a)).IsReady, true);
    });
    await test('SQL130 V2 helper sequential FIX/CANCEL clears all ownership fields inside one original transaction', async () => {
      await helperRoundTrip(a, 2, 'FIX'); await helperRoundTrip(a, 2, 'CANCEL');
    });
    await test('SQL130 helper rejects rollback/rebegin on the same SPID even with matching new WAIT scope', async () => {
      // One-connection pool deliberately reuses the physical SPID. Same SPID and
      // @@TRANCOUNT are insufficient; the transaction-owned random marker is gone.
      let current = new sql.Transaction(a); await current.begin();
      const tQ = (text, params) => injectedQuery(current)(text, params);
      try {
        const old = await lockStockGateOperation(tQ, sql, { orderYear: '2026', orderWeek: '34-02', action: 'FIX' });
        await current.rollback();
        current = new sql.Transaction(a); await current.begin();
        assert.equal((await tQ('SELECT @@SPID AS spid;')).recordset[0].spid, old.ownerSessionId);
        const output = (await tQ(nativeCall('usp_ShipmentFix'))).recordset[0];
        assert.equal(output.result, 0); assert.equal(output.trancount, 1);
        await assert.rejects(clearStockGateOperation(tQ, sql, old,
          { nativeResult: 0, nativeReturnCode: 0 }), /ORIGINAL_TRANSACTION_REQUIRED/);
      } finally { await current.rollback().catch(() => {}); }
      assert.equal((await state(c)).Mode, null);
    });
    await test('SQL130 same-SPID reentry is rejected; expired RUN is never reclaimed', async () => {
      const first = await acquire(a);
      assert.equal(first.result, 0); assert.equal((await acquire(a)).result, -99);
      await query(a, "UPDATE dbo.NenovaStockWeekGate SET LockedAt=DATEADD(second,-600,GETDATE()) WHERE GateKey='1';");
      assert.equal((await acquire(b)).result, -99);
      assert.equal((await state(a)).OwnerToken.toLowerCase(), first.token.toLowerCase());
      assert.equal((await release(a, 'FIX', first.token, false)).result, 0);
    });
    await test('SQL130 same-SPID token generation rejects old Leave after reacquisition', async () => {
      const old = await acquire(a); await release(a, 'FIX', old.token, false);
      const next = await acquire(a); assert.equal(old.spid, next.spid); assert.notEqual(old.token, next.token);
      assert.equal((await release(a, 'FIX', old.token, false)).result, -97);
      assert.equal((await state(a)).Mode, 'RUN'); await release(a, 'FIX', next.token, false);
    });
    await test('SQL130 foreign SPID with the correct token and legacy tokenless callers cannot release ownership', async () => {
      const owned = await acquire(a), before = await state(a);
      assert.equal((await release(b, 'FIX', owned.token, false)).result, -97);
      const result = await scalar(b, `DECLARE @r int,@m nvarchar(200),@leave int;
        EXEC dbo.usp_NenovaStockWeekGateEnter @Action=N'FIX',@OrderYear=N'2026',@OrderWeek=N'34-02',
          @oResult=@r OUTPUT,@oMessage=@m OUTPUT;
        EXEC dbo.usp_NenovaStockWeekGateLeave @Action=N'FIX',@Success=0,@oResult=@leave OUTPUT;
        SELECT @r AS entered,@leave AS released;`);
      assert.equal(result.entered, -98); assert.equal(result.released, -98);
      assert.deepEqual(await state(a), before);
      await release(a, 'FIX', owned.token, false);
    });
    await test('SQL130 EXE different-connection handoff rejects cross-year/week and partial calculation', async () => {
      const x = await acquire(a, 'CANCEL'); await release(a, 'CANCEL', x.token, true);
      for (const options of [{ year: '2025', prod: 0 }, { week: '34-01', prod: 0 }, { prod: 101 }])
        assert.equal((await acquire(b, 'CALC', options)).result, -99);
      const y = await acquire(b, 'CALC', { prod: 0 }); assert.equal(y.result, 0); assert.notEqual(y.spid, x.spid);
      assert.equal((await release(a, 'CANCEL', x.token, true)).result, -97);
      await release(b, 'CALC', y.token, false);
      assert.equal((await state(b)).Mode, 'WAIT_CALC');
      // NULL native @ProdKey remains the legacy full-product equivalent of 0.
      const done = await scalar(c, nativeCall('usp_StockCalculation', 'fixture', false, true));
      assert.equal(done.result, 0); assert.equal((await state(c)).Mode, null);
    });
    await test('SQL130 same-session outer rollback preserves the previous pending token', async () => {
      const x = await acquire(a); await release(a, 'FIX', x.token, true);
      const r = await scalar(a, `DECLARE @r int,@m nvarchar(200),@t uniqueidentifier,@lr int;
        BEGIN TRANSACTION;
        EXEC dbo.usp_NenovaStockWeekGateEnter @Action=N'CALC',@OrderYear=N'2026',@OrderWeek=N'34-02',
          @oResult=@r OUTPUT,@oMessage=@m OUTPUT,@ProtocolVersion=2,@OwnerToken=@t OUTPUT,@CalcProdKey=0;
        ROLLBACK TRANSACTION;
        EXEC dbo.usp_NenovaStockWeekGateLeave @Action=N'CALC',@Success=0,@ProtocolVersion=2,@OwnerToken=@t,@oResult=@lr OUTPUT;
        SELECT @r AS entered,@lr AS released;`);
      assert.equal(r.entered, 0); assert.equal(r.released, -97);
      assert.equal((await state(a)).OwnerToken.toLowerCase(), x.token.toLowerCase());
      const done = await acquire(c, 'CALC', { prod: 0 }); await release(c, 'CALC', done.token, true);
    });
    await test('SQL130 native failed CALC retains pending work and rolls back fixture ledger', async () => {
      const x = await acquire(a); await release(a, 'FIX', x.token, true);
      const before = (await scalar(b, 'SELECT COUNT(*) AS n FROM dbo.StockGateOwnerFixtureLedger;')).n;
      const result = await scalar(b, nativeCall('usp_StockCalculation', 'fixture_fail'));
      assert.equal(result.result, -1); assert.equal(result.returnCode, -1);
      assert.equal((await state(b)).Mode, 'WAIT_CALC');
      assert.equal((await scalar(b, 'SELECT COUNT(*) AS n FROM dbo.StockGateOwnerFixtureLedger;')).n, before);
      const done = await acquire(c, 'CALC', { prod: 0 }); await release(c, 'CALC', done.token, true);
    });
    for (const [name] of nativeNames) await test(`SQL130 ${name}: rollback-all then late Leave cannot clear a new session`, async () => {
      await query(c, "DELETE FROM dbo.StockGateOwnerFixtureLedger WHERE Kind=N'rollback_ready';");
      const pending = query(a, nativeCall(name, 'fixture_pause', true)).then(value => ({ value }), error => ({ error }));
      const deadline = Date.now() + 2500;
      let ready = false;
      while (Date.now() < deadline) {
        ready = (await scalar(c, "SELECT COUNT(*) AS n FROM dbo.StockGateOwnerFixtureLedger WHERE Kind=N'rollback_ready';")).n > 0;
        if (ready) break;
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      assert(ready, 'fixture did not reach its post-rollback/pre-Leave window');
      const next = await acquire(b); assert.equal(next.result, 0);
      await pending; // SQL may report transaction-count mismatch after native ROLLBACK-all.
      const after = await state(c);
      assert.equal(after.Mode, 'RUN'); assert.equal(after.OwnerSessionID, next.spid);
      assert.equal(after.OwnerToken.toLowerCase(), next.token.toLowerCase());
      await release(b, 'FIX', next.token, false);
    });
    await test('SQL130 atomic caller retains idle row lock through scoped native CALC', async () => {
      const tx = new sql.Transaction(a); await tx.begin();
      try {
        await new sql.Request(tx).query("SELECT GateKey FROM dbo.NenovaStockWeekGate WITH (UPDLOCK,HOLDLOCK) WHERE GateKey='1' AND Mode IS NULL;");
        assert.equal((await acquire(b)).result, -99);
        await new sql.Request(tx).query(nativeCall('usp_StockCalculation').replace('@ProdKey=0', '@ProdKey=101'));
        assert.equal((await acquire(b)).result, -99);
        await tx.commit();
      } catch (error) { await tx.rollback().catch(() => {}); throw error; }
      assert.equal((await state(c)).Mode, null);
    });
    await test('SQL130 both old global Clear and old raw clear fail closed', async () => {
      const x = await acquire(a); await release(a, 'FIX', x.token, true);
      await assert.rejects(query(b, 'EXEC dbo.usp_NenovaStockWeekGateClear;'), /UNSAFE_CLEAR_DISABLED/);
      await assert.rejects(query(b, "UPDATE dbo.NenovaStockWeekGate SET Mode=NULL,LockedAt=NULL,Action=NULL,OrderYear=NULL,OrderWeek=NULL WHERE GateKey='1';"), /CHECK constraint/i);
      assert.equal((await state(c)).Mode, 'WAIT_CALC');
      const done = await acquire(c, 'CALC', { prod: 0 }); await release(c, 'CALC', done.token, true);
    });
    await test('SQL130 capability fails closed on module drift and disabled state CHECK', async () => {
      const original = (await scalar(a, "SELECT OBJECT_DEFINITION(OBJECT_ID(N'dbo.usp_NenovaStockWeekGateClear')) AS d;")).d;
      const asAlter = text => text.replace(/^(\s*)CREATE(?:\s+OR\s+ALTER)?\s+(PROC(?:EDURE)?\b)/i, '$1ALTER $2');
      await query(a, asAlter(original) + '\n-- fixture drift');
      assert.equal((await capability(a)).IsReady, false);
      await query(a, asAlter(original));
      // Restore exact module text via migration because CREATE/ALTER text itself participates in the hash.
      await migrate(a); assert.equal((await capability(a)).IsReady, true);
      await query(a, 'ALTER TABLE dbo.NenovaStockWeekGate NOCHECK CONSTRAINT CK_NenovaStockWeekGate_OwnerV2_State;');
      assert.equal((await capability(a)).IsReady, false);
      await query(a, 'ALTER TABLE dbo.NenovaStockWeekGate WITH CHECK CHECK CONSTRAINT CK_NenovaStockWeekGate_OwnerV2_State;');
      assert.equal((await capability(a)).IsReady, true);
      await query(a, `ALTER TABLE dbo.NenovaStockWeekGate DROP CONSTRAINT CK_NenovaStockWeekGate_OwnerV2_State;
        ALTER TABLE dbo.NenovaStockWeekGate WITH CHECK ADD CONSTRAINT CK_NenovaStockWeekGate_OwnerV2_State CHECK (1=1);`);
      assert.equal((await capability(a)).IsReady, false, 'trusted but weakened CHECK must fail capability');
      await migrate(a); assert.equal((await capability(a)).IsReady, true);
    });
    console.log('SQL integration passed on the dedicated fixture database, compatibility_level=130.');
  } finally {
    for (const p of pools.reverse()) await p.close().catch(() => {});
  }
}

async function main() {
  const args = process.argv.slice(2);
  assert(args.every(a => a === '--sql'), 'only --sql is supported');
  await offline();
  if (args.includes('--sql')) await sqlTests(configFromStdin(fs.readFileSync(0, 'utf8')));
  else console.log('SKIP SQL integration: main must run --sql on the dedicated SQL fixture before deployment.');
  console.log(`${passed} ownership checks passed.`);
}
main().catch(error => {
  // Do not print connection objects, driver details, config, SQL batches or credentials.
  console.error(`FAIL: ${error instanceof assert.AssertionError ? error.message : String(error.message || 'ownership test failed')}`);
  process.exitCode = 1;
});
