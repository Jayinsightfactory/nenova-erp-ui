// Session-local MSSQL fixtures only. Reads two native definitions, never executes permanent SPs.
// Usage: node scripts/test-warehouse-rematch-sql.cjs [--env C:/path/to/.env.local]
// No production business rows are read or written. Disconnect destroys all fixture objects.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const sql = require('mssql');

const TABLES = ['TempWarehouseDetail', 'WarehouseDetail', 'WarehouseMaster', 'Product', 'StockHistory', 'KeyNumbering'];
const CREATE_HASH = 'cbf745cd6831d45acfb387b9a9a0b80db29b1e3f86c828cf31d4e14cef8d27b6';
const KEY_APPROVED = `create PROCEDURE [dbo].[usp_GetNextKey]
 @iCategory nvarchar(30), @iInterval int = 1, @oNextKey int out
 AS BEGIN SET NOCOUNT ON; set @oNextKey = -1; declare @vCount int;
 BEGIN TRY BEGIN TRANSACTION
 select @vCount = Count(*) from KeyNumbering where Category = @iCategory;
 if @vCount = 0 begin insert into KeyNumbering values (@iCategory, 0, ''); end
 if @iInterval < 1 BEGIN set @iInterval = 1; END
 UPDATE KeyNumbering set LastKeyNo = LastKeyNo + @iInterval where Category = @iCategory;
 select @oNextKey = LastKeyNo from KeyNumbering where Category = @iCategory;
 if @@TRANCOUNT > 0 COMMIT TRANSACTION; return 0;
 END TRY BEGIN CATCH if @@TRANCOUNT > 0 ROLLBACK TRANSACTION; return -1; END CATCH; END`;
const stripComments = text => text.replace(/--[^\r\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
const canonical = text => stripComments(text).replace(/\s+/g, '').toLowerCase();

function temporaryTables(text) {
  let out = text;
  for (const name of TABLES) {
    out = out.replace(new RegExp(`(?:\\[dbo\\]\\.|dbo\\.)?\\[${name}\\]`, 'gi'), `#${name}`);
    out = out.replace(new RegExp(`(?<![#\\w])(?:dbo\\.)?${name}\\b`, 'gi'), `#${name}`);
  }
  for (const name of TABLES) assert(!new RegExp(`(?<!#)\\b${name}\\b`, 'i').test(out), `Permanent name survived: ${name}`);
  assert(!/\bdbo\s*\.|\[dbo\]|\bEXEC(?:UTE)?\b|\bOPENROWSET\b|\bOPENDATASOURCE\b|\bUSE\b/i.test(out), 'External SQL dependency rejected');
  return out;
}

function cloneNative(definition, name) {
  assert.equal(typeof definition, 'string', `Definition unavailable: ${name}`);
  if (name === 'usp_CreateWarehouse') {
    assert.equal(crypto.createHash('sha256').update(definition.replace(/\r\n/g, '\n')).digest('hex'), CREATE_HASH,
      'Native create definition changed; inspect before updating fixture approval');
  } else {
    assert.equal(canonical(definition), canonical(KEY_APPROVED), 'Native key definition changed; inspect before approval');
  }
  let out = stripComments(definition).trim();
  const header = new RegExp(`^CREATE\\s+PROCEDURE\\s+\\[dbo\\]\\.\\[${name}\\]`, 'i');
  assert(header.test(out), 'Unrecognized procedure header');
  out = out.replace(header, `CREATE PROCEDURE #${name}`);
  out = temporaryTables(out);
  assert(!/(?<!#)\busp_\w+/i.test(out), 'Permanent SP identifier survived');
  // Exact approved body + these target checks fail closed, including aliases used by native UPDATE.
  for (const match of out.matchAll(/\b(?:FROM|JOIN|INTO|UPDATE)\s+([#\w]+)/gi)) {
    assert(TABLES.some(name => match[1].toLowerCase() === `#${name}`.toLowerCase()) || ['p', 'td'].includes(match[1].toLowerCase()), `Unknown table/alias: ${match[1]}`);
  }
  return out;
}

const SETUP = `SET NOCOUNT ON;
CREATE TABLE #Product(ProdKey int PRIMARY KEY, ProdName nvarchar(200), OutUnit nvarchar(10), EstUnit nvarchar(10), isDeleted bit, Stock float);
CREATE TABLE #WarehouseMaster(WarehouseKey int PRIMARY KEY, OrderYear nvarchar(4), OrderWeek nvarchar(20));
CREATE TABLE #TempWarehouseDetail(WdetailKey int IDENTITY, WarehouseKey int, ProdKey int, ProdName nvarchar(250), OrderCode nvarchar(20),
 BoxQuantity float, BunchQuantity float, SteamQuantity float, OutQuantity float, EstQuantity float, SteamOf1Box float, SteamOf1Bunch float, UPrice float, TPrice float);
CREATE TABLE #WarehouseDetail(WdetailKey int IDENTITY, WarehouseKey int, ProdKey int, OrderCode nvarchar(20),
 BoxQuantity float, BunchQuantity float, SteamQuantity float, OutQuantity float, EstQuantity float, SteamOf1Box float, SteamOf1Bunch float, UPrice float, TPrice float);
CREATE TABLE #StockHistory(ChangeDtm datetime, OrderYear nvarchar(20), OrderWeek nvarchar(20), ChangeID nvarchar(20), ChangeType nvarchar(20),
 ColumName nvarchar(20), BeforeValue float, AfterValue float, Descr nvarchar(200), ProdKey int);
CREATE TABLE #KeyNumbering(Category nvarchar(30) PRIMARY KEY, LastKeyNo int, Descr nvarchar(200));
INSERT #Product VALUES(101,N'Rose Red',N'박스 ',N'단 ',0,20);
INSERT #KeyNumbering VALUES(N'WarehouseKey',7000,N'');
INSERT #WarehouseMaster VALUES(6000,N'2025',N'40-02');
INSERT #TempWarehouseDetail(WarehouseKey,ProdKey,ProdName,OrderCode,BoxQuantity,BunchQuantity,SteamQuantity,OutQuantity,EstQuantity,SteamOf1Box,SteamOf1Bunch,UPrice,TPrice)
 VALUES(6000,101,N'old original name',N'OLD',1,10,100,1,10,100,10,0.5,50);
INSERT #WarehouseDetail(WarehouseKey,ProdKey,OrderCode,BoxQuantity,BunchQuantity,SteamQuantity,OutQuantity,EstQuantity,SteamOf1Box,SteamOf1Bunch,UPrice,TPrice)
 SELECT WarehouseKey,ProdKey,OrderCode,BoxQuantity,BunchQuantity,SteamQuantity,OutQuantity,EstQuantity,SteamOf1Box,SteamOf1Bunch,UPrice,TPrice FROM #TempWarehouseDetail;
SELECT @@SPID AS spid;`;

async function main() {
  const args = process.argv.slice(2);
  assert(args.length === 0 || (args.length === 2 && args[0] === '--env'), 'Usage: [--env path]');
  if (args.length) process.loadEnvFile(args[1]);
  for (const key of ['DB_SERVER', 'DB_NAME', 'DB_USER', 'DB_PASSWORD']) assert(process.env[key], `${key} required`);
  const { WAREHOUSE_STAGE_GUARD_SQL } = await import('../lib/warehouseProductMatching.js');
  const guard = temporaryTables(WAREHOUSE_STAGE_GUARD_SQL);
  assert(!/\b(?:INSERT|UPDATE|DELETE|MERGE|EXEC|CREATE|ALTER|DROP|TRUNCATE|INTO)\b/i.test(stripComments(guard)), 'Stage guard must be read-only');
  for (const match of guard.matchAll(/\b(?:FROM|JOIN)\s+([#\w]+)/gi)) assert(['#TempWarehouseDetail', '#WarehouseDetail'].includes(match[1]), 'Unknown stage guard source');
  const pool = new sql.ConnectionPool({ server: process.env.DB_SERVER, database: process.env.DB_NAME,
    port: Number(process.env.DB_PORT || 1433), user: process.env.DB_USER, password: process.env.DB_PASSWORD,
    options: { encrypt: false, trustServerCertificate: true }, pool: { max: 1, min: 1, idleTimeoutMillis: 600000 } });
  let spid;
  const batch = async text => {
    const result = await pool.request().batch(text);
    return result;
  };
  const assertSession = async () => {
    const r = await batch('SELECT @@SPID spid, OBJECT_ID(N\'tempdb..#Product\') fixtureId;');
    assert.equal(r.recordset[0].spid, spid, 'Connection changed; refuse fixture continuation');
    assert(r.recordset[0].fixtureId, 'Fixture tables disappeared; refusing continuation');
  };
  const snapshot = async () => {
    await assertSession();
    const state = {};
    for (const name of TABLES) state[name] = (await batch(`SELECT * FROM #${name} ORDER BY 1;`)).recordset;
    return state;
  };
  try {
    await pool.connect();
    // The sole permanent-object access is read-only definition metadata.
    const definitions = (await batch("SELECT OBJECT_DEFINITION(OBJECT_ID(N'dbo.usp_CreateWarehouse')) createSql, OBJECT_DEFINITION(OBJECT_ID(N'dbo.usp_GetNextKey')) keySql;")).recordset[0];
    const create = cloneNative(definitions.createSql, 'usp_CreateWarehouse');
    const key = cloneNative(definitions.keySql, 'usp_GetNextKey');
    spid = (await batch(SETUP)).recordset[0].spid;
    await batch(create);
    await assertSession();
    await batch(key);
    const baseline = await snapshot();

    // Single-connection transactions pin the session; every fixture restores the same baseline.
    async function fixture(name, body, expectedError = null) {
      await assertSession();
      const tx = new sql.Transaction(pool);
      await tx.begin();
      let caught;
      try {
        const identity = await new sql.Request(tx).batch('SELECT @@SPID spid;');
        assert.equal(identity.recordset[0].spid, spid);
        await new sql.Request(tx).batch(body);
      } catch (error) { caught = error; }
      finally { await tx.rollback().catch(() => {}); }
      if (expectedError) {
        const number = expectedError === true ? 51003 : expectedError;
        assert(caught && (caught.number === number || caught.precedingErrors?.some(e => e.number === number)), `${name}: expected SQL error ${number}, got ${caught?.message || 'success'}`);
      }
      else if (caught) throw caught;
      assert.deepEqual(await snapshot(), baseline, `${name}: baseline rows changed after rollback`);
      console.log(`PASS ${name}`);
    }
    await fixture('completed residue / renamed product', guard);
    await fixture('pending EXE rows', `UPDATE #TempWarehouseDetail SET ProdKey=NULL, OutQuantity=NULL, EstQuantity=NULL; ${guard}`, true);
    await fixture('partial consumed file', `INSERT #TempWarehouseDetail(WarehouseKey,ProdKey,ProdName,BoxQuantity) VALUES(6000,101,N'Rose Red',2); ${guard}`, true);
    await fixture('duplicate multiplicity mismatch', `INSERT #TempWarehouseDetail(WarehouseKey,ProdKey,ProdName,OrderCode,BoxQuantity,BunchQuantity,SteamQuantity,OutQuantity,EstQuantity,SteamOf1Box,SteamOf1Bunch,UPrice,TPrice)
 SELECT WarehouseKey,ProdKey,ProdName,OrderCode,BoxQuantity,BunchQuantity,SteamQuantity,OutQuantity,EstQuantity,SteamOf1Box,SteamOf1Bunch,UPrice,TPrice FROM #TempWarehouseDetail; ${guard}`, true);
    await fixture('completed duplicate multiset', `INSERT #TempWarehouseDetail(WarehouseKey,ProdKey,ProdName,OrderCode,BoxQuantity,BunchQuantity,SteamQuantity,OutQuantity,EstQuantity,SteamOf1Box,SteamOf1Bunch,UPrice,TPrice)
 SELECT WarehouseKey,ProdKey,ProdName,OrderCode,BoxQuantity,BunchQuantity,SteamQuantity,OutQuantity,EstQuantity,SteamOf1Box,SteamOf1Bunch,UPrice,TPrice FROM #TempWarehouseDetail;
 INSERT #WarehouseDetail(WarehouseKey,ProdKey,OrderCode,BoxQuantity,BunchQuantity,SteamQuantity,OutQuantity,EstQuantity,SteamOf1Box,SteamOf1Bunch,UPrice,TPrice)
 SELECT WarehouseKey,ProdKey,OrderCode,BoxQuantity,BunchQuantity,SteamQuantity,OutQuantity,EstQuantity,SteamOf1Box,SteamOf1Bunch,UPrice,TPrice FROM #WarehouseDetail; ${guard}`);
    const upload = `${guard}
 DECLARE @wk int, @rc int, @result int;
 EXEC @rc=#usp_GetNextKey @iCategory=N'WarehouseKey',@oNextKey=@wk OUTPUT;
 IF @rc<>0 OR @wk<>7001 THROW 51100,'Native key fixture failed',1;
 INSERT #WarehouseMaster VALUES(@wk,N'2026',N'40-02');
 DELETE FROM #TempWarehouseDetail;
 INSERT #TempWarehouseDetail(WarehouseKey,ProdName,OrderCode,BoxQuantity,BunchQuantity,SteamQuantity,SteamOf1Box,SteamOf1Bunch,UPrice,TPrice)
 VALUES(@wk,N'  Rose'+NCHAR(160)+N'Red  ',N'NEW',2,20,200,100,10,0.5,100);
 EXEC #usp_CreateWarehouse @iUserID=N'fixture',@oResult=@result OUTPUT;
 IF @result<>0 THROW 51100,'Native create fixture failed',1;
 IF NOT EXISTS(SELECT 1 FROM #WarehouseDetail WHERE WarehouseKey=@wk AND ProdKey=101 AND OutQuantity=2 AND EstQuantity=20 AND TPrice=100) THROW 51100,'Native quantity/name parity failed',1;
 IF NOT EXISTS(SELECT 1 FROM #Product WHERE ProdKey=101 AND Stock=22) THROW 51100,'Native Product.Stock update missing',1;
 IF NOT EXISTS(SELECT 1 FROM #StockHistory WHERE OrderYear=N'2026' AND OrderWeek=N'40-02' AND ProdKey=101 AND BeforeValue=20 AND AfterValue=22) THROW 51100,'Native history missing',1;
 IF @@TRANCOUNT<>1 THROW 51100,'Native nested transaction escaped outer boundary',1;`;
    await fixture('native success and cross-year preservation', upload);
    await fixture('native create failure rolls back key/master/detail/product/history',
      `ALTER TABLE #StockHistory ADD CONSTRAINT CK_fixture_reject_history CHECK (AfterValue<21); ${upload}`, 51100);
    // Deliberate post-create failure: no native StockCalculation call or global gate access.
    await fixture('post-create simulated calculation failure rolls back every fixture table', `${upload}
 THROW 51123,'SIMULATED_STOCK_CALCULATION_FAILURE',1;`, 51123);
    console.log('Temp-only fixtures passed. Not a live SP deployment, stock-calculation, or two-session concurrency proof.');
  } finally { await pool.close(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
