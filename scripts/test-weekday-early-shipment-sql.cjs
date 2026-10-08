#!/usr/bin/env node
// Isolated loopback MSSQL only. No application environment or operational writes.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const sql = require('mssql');
const fixture = require('./test-weekday-distribution-sql.cjs');
const root = path.resolve(__dirname, '..');
const load = file => import(pathToFileURL(path.join(root, file)).href);
const user = { userId:'fixture-user', userName:'Fixture User' };

async function transaction(pool, run, commit = false) {
  const tx = new sql.Transaction(pool); await tx.begin();
  try { const result = await run(fixture.tQuery(tx));
    if (commit) await tx.commit(); else await tx.rollback(); return result;
  } catch (error) { await tx.rollback().catch(()=>{}); throw error; }
}

async function main() {
  for (const name of ['DB_SERVER','DB_PORT','DB_NAME','DB_USER','DB_PASSWORD'])
    assert.ok(!process.env[name], 'Operational database environment is forbidden.');
  const approved = fixture.inspectFixture();
  const dbName = `NenovaEstimateFixture_${new Date().toISOString().slice(0,10).replace(/-/g,'')}_${crypto.randomBytes(4).toString('hex')}`;
  fixture.assertDbName(dbName);
  const config = {user:'sa',password:approved.password,server:'127.0.0.1',port:14339,
    options:{encrypt:false,trustServerCertificate:true},requestTimeout:60000,pool:{max:4,min:0}};
  let master, pool;
  try {
    master = await new sql.ConnectionPool({...config,database:'master'}).connect();
    await fixture.query(master,`CREATE DATABASE ${fixture.bracket(dbName)}`);
    await fixture.query(master,`ALTER DATABASE ${fixture.bracket(dbName)} SET COMPATIBILITY_LEVEL=130`);
    pool = await new sql.ConnectionPool({...config,database:dbName}).connect();
    await fixture.installSchema(pool); await fixture.seed(pool);
    // Fixture's legacy key column has no IDENTITY. Give native unchanged INSERT
    // a generated key in this isolated database only, matching production behavior.
    await fixture.query(pool,`CREATE SEQUENCE dbo.EarlyFixtureStockKey AS int START WITH 50000 INCREMENT BY 1;
      ALTER TABLE dbo.StockMaster ADD CONSTRAINT DF_EarlyFixtureStockKey DEFAULT (NEXT VALUE FOR dbo.EarlyFixtureStockKey) FOR StockKey;`);
    await fixture.query(pool,fs.readFileSync(path.join(root,'docs/migrations/2026-10-08_weekday_early_shipment.sql'),'utf8'));
    await fixture.query(pool,`INSERT dbo.PeriodDay(PeriodDayKey,OrderYearWeek,BaseYmd,WeekDay)
      VALUES(10,N'202638',N'2026-09-17',5);
      INSERT dbo.StockMaster(StockKey,OrderYear,OrderWeek,OrderYearWeek,isFix,CreateID)
      VALUES(3801,N'2026',N'38-01',N'20263801',0,N'fixture-user');
      INSERT dbo.ProductStock(StockKey,ProdKey,Stock) VALUES(3801,866,0);
      UPDATE dbo.Product SET Stock=100 WHERE ProdKey=866;
      UPDATE dbo.WarehouseDetail SET OutQuantity=125,BoxQuantity=125,BunchQuantity=3750,SteamQuantity=3750 WHERE WdetailKey=3701;`);
    const [core, policy, early, store, gate, presence] = await Promise.all([
      load('lib/weekdayDistributionApply.js'),load('lib/weekdayDistributionPolicy.js'),
      load('lib/weekdayEarlyShipmentApply.js'),load('lib/weekdayEarlyShipmentStore.js'),
      load('lib/estimateDirectionalQuantity.js'),load('lib/erpEditPresence.js')]);
    const dependencies = fixture.leaseDependencies(gate,presence);
    async function body(tQ, {quantity=3, final=5, intent='MARK_EXISTING'}={}) {
      const change={year:'2026',orderWeek:'37-01',custKey:533,prodKey:866,unit:'박스'};
      const actual=await core.readActualScope(tQ,sql,change,{mode:'ALLOCATION'});
      const operationId=crypto.randomUUID(), reason='isolated early shipment';
      return {action:'APPLY',operationId,reason,sourceYear:2026,sourceMajorWeek:'37',
        targetYear:2026,targetMajorWeek:'38',custKey:533,prodKey:866,unit:'박스',quantity,
        sourceDate:'2026-09-10',allocationIntent:intent,expectedRevision:0,
        allocationBody:{mode:'ALLOCATION',operationId,reason,custKey:533,changes:[{
          ...change,expected:{detailRows:actual.detailRows,shipmentOutQuantity:actual.shipmentOutQuantity,
            shipmentDates:actual.shipmentDates,snapshotDigest:policy.weekdaySnapshotDigest(change,actual)},
          dates:[{date:'2026-09-10',quantity:final}]}]}};
    }
    await transaction(pool,async tQ=>{
      const request=await body(tQ), result=await early.applyEarlyShipment(tQ,request,user,dependencies);
      assert.equal(result.status,'APPLIED');
      assert.equal(Number((await tQ('SELECT OutQuantity FROM ShipmentDetail WHERE SdetailKey=89892')).recordset[0].OutQuantity),25);
      assert.equal(Number((await tQ('SELECT Stock FROM Product WHERE ProdKey=866')).recordset[0].Stock),100);
      const effects=(await tQ('SELECT EffectKind,Delta FROM WebEarlyShipmentEffect ORDER BY EffectKind')).recordset;
      assert.deepEqual(effects.map(r=>[r.EffectKind,Number(r.Delta)]),[['SOURCE',3],['TARGET',-3]]);
      const replay=await early.applyEarlyShipment(tQ,request,user,dependencies); assert.equal(replay.replayed,true);
      const invalid=await body(tQ,{final:3,intent:'APPLY_ABSOLUTE'});
      invalid.allocationBody.changes[0].dates[0].quantity=0;
      await assert.rejects(()=>core.executeWeekdayDistributionApply(tQ,sql,invalid.allocationBody,user,dependencies),
        error=>error.code==='EARLY_CLASSIFICATION_CAP','ordinary edits cannot silently cancel classified quantity');
      const exclusions=await store.getEarlyShipmentExclusions(tQ,{year:2026,majorWeek:'38',custKeys:[533],prodKeys:[866],orderWeek:'38-01'});
      assert.ok(exclusions);
      const reversed=await early.reverseEarlyShipment(tQ,{action:'REVERSE',operationId:request.operationId,
        reversalOperationId:crypto.randomUUID(),expectedRevision:1,reason:'clear classification'},user,dependencies);
      assert.equal(reversed.status,'REVERSED');
      assert.equal(Number((await tQ('SELECT OutQuantity FROM ShipmentDetail WHERE SdetailKey=89892')).recordset[0].OutQuantity),25);
      assert.equal(Number((await tQ('SELECT COUNT(*) c FROM WebEarlyShipmentEffect')).recordset[0].c),4);
    });
    await transaction(pool,async tQ=>{
      await early.applyEarlyShipment(tQ,await body(tQ),user,dependencies);
      await tQ('UPDATE ShipmentDate SET ShipmentQuantity=0 WHERE SdateKey=119701');
      await assert.rejects(()=>store.getEarlyShipmentExclusions(tQ,{year:2026,majorWeek:'38',custKeys:[533],prodKeys:[866],orderWeek:'38-01'}),
        error=>error.code==='EARLY_SOURCE_CLASSIFICATION_STALE','EXE source changes block false target subtraction');
      await assert.rejects(()=>store.assertEarlyShipmentSourceIntegrity(tQ,{year:2026,majorWeek:'37',custKeys:[533],prodKeys:[866]}),
        error=>error.code==='EARLY_SOURCE_CLASSIFICATION_STALE','source Excel replacement cannot commit invalidated classification');
    });
    for (const fixed of [true,false]) await transaction(pool,async tQ=>{
      if (!fixed) await tQ('UPDATE ShipmentMaster SET isFix=0 WHERE ShipmentKey=6266; UPDATE ShipmentDetail SET isFix=0 WHERE SdetailKey=89892');
      const result=await early.applyEarlyShipment(tQ,await body(tQ,{final:8,intent:'APPLY_ABSOLUTE'}),user,dependencies);
      assert.equal(result.status,'APPLIED');
      const after=(await tQ(`SELECT sd.OutQuantity,sd.isFix,p.Stock,
        (SELECT OutQuantity FROM OrderDetail WHERE OrderDetailKey=3701) OrderQty
        FROM ShipmentDetail sd CROSS JOIN Product p WHERE sd.SdetailKey=89892 AND p.ProdKey=866`)).recordset[0];
      assert.equal(Number(after.OutQuantity),28,'absolute day 8 replaces day 5 once');
      assert.equal(Boolean(after.isFix),fixed,'existing confirmation is preserved');
      assert.equal(Number(after.Stock),fixed?97:100,'only confirmed shipment delta affects live stock');
      assert.equal(Number(after.OrderQty),25,'existing order remains unchanged');
    });
    await transaction(pool,async tQ=>{
      await tQ(`DELETE ProductStock WHERE StockKey=3801; DELETE StockMaster WHERE StockKey=3801;
        INSERT ShipmentMaster(ShipmentKey,OrderYear,OrderWeek,OrderYearWeek,CustKey,isFix,isDeleted)
          VALUES(6381,N'2026',N'38-01',N'202638',533,0,0);`);
      const result=await early.applyEarlyShipment(tQ,await body(tQ),user,dependencies);
      assert.equal(result.status,'APPLIED');
      assert.equal(Number((await tQ(`SELECT COUNT(*) c FROM StockMaster sm JOIN ProductStock ps ON ps.StockKey=sm.StockKey
        WHERE sm.OrderYear='2026' AND sm.OrderWeek='38-01' AND ps.ProdKey=866`)).recordset[0].c),1,
        'native target anchor is materialized before earliest-source cascade');
    });
    // A target-only late error must roll back source adjustment, engine audit and ledger.
    await assert.rejects(()=>transaction(pool,async tQ=>{
      const request=await body(tQ);
      const failTarget=async(statement,params)=>{
        if (/DECLARE @effect TABLE/.test(statement) && params?.wk?.value==='38-01') throw new Error('fixture target failure');
        return tQ(statement,params);
      };
      return early.applyEarlyShipment(failTarget,request,user,dependencies);
    },true),/fixture target failure/);
    const counts=(await fixture.query(pool,`SELECT
      (SELECT COUNT(*) FROM WebEarlyShipmentOperation) operations,
      (SELECT COUNT(*) FROM WebWeekdayDistributionOperation) engineAudits,
      (SELECT COUNT(*) FROM StockHistory WHERE Descr LIKE N'선출고 연결 %') effects,
      (SELECT Stock FROM Product WHERE ProdKey=866) stock`)).recordset[0];
    assert.deepEqual(counts,{operations:0,engineAudits:0,effects:0,stock:100});
    // Native target subtraction can create a real shortage even after inner engine succeeds.
    await assert.rejects(()=>transaction(pool,async tQ=>{
      await tQ('UPDATE WarehouseDetail SET OutQuantity=25,BoxQuantity=25,BunchQuantity=750,SteamQuantity=750 WHERE WdetailKey=3701');
      await tQ(`INSERT ShipmentMaster(ShipmentKey,OrderYear,OrderWeek,OrderYearWeek,CustKey,isFix,isDeleted)
        VALUES(6380,N'2026',N'38-01',N'202638',533,1,0);
        INSERT ShipmentDetail(SdetailKey,ShipmentKey,CustKey,ProdKey,ShipmentDtm,OutQuantity,BoxQuantity,BunchQuantity,
          SteamQuantity,EstQuantity,Cost,Amount,Vat,isFix)
        VALUES(89893,6380,533,866,'2026-09-17',1,1,30,30,30,100,3000,0,1);`);
      return early.applyEarlyShipment(tQ,await body(tQ),user,dependencies);
    },true),error=>error.code==='EARLY_FUTURE_STOCK_SHORTAGE');
    assert.equal(Number((await fixture.query(pool,'SELECT COUNT(*) c FROM WebEarlyShipmentOperation')).recordset[0].c),0);
    await assert.rejects(()=>transaction(pool,async tQ=>{
      await tQ('UPDATE Product SET Stock=2 WHERE ProdKey=866');
      return early.applyEarlyShipment(tQ,await body(tQ,{final:8,intent:'APPLY_ABSOLUTE'}),user,dependencies);
    },true),error=>error.code==='EARLY_LIVE_STOCK_SHORTAGE');
    assert.equal(Number((await fixture.query(pool,'SELECT Stock FROM Product WHERE ProdKey=866')).recordset[0].Stock),100);
    console.log('PASS: isolated MSSQL early shipment classification/replay/reversal, fixed/unfixed absolute allocation, missing target anchor, target failure/future-negative atomic rollback');
  } finally {
    await pool?.close().catch(()=>{});
    if(master) await fixture.query(master,`IF DB_ID(N'${dbName}') IS NOT NULL BEGIN ALTER DATABASE ${fixture.bracket(dbName)} SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE ${fixture.bracket(dbName)}; END`).catch(()=>{});
    await master?.close().catch(()=>{});
  }
}
main().catch(error=>{console.error(error.stack||error.message);process.exitCode=1;});
