#!/usr/bin/env node
// Real SQL regression. Only the inspected loopback fixture; no application env.
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const sql=require('mssql');
const fixture=require('./test-weekday-distribution-sql.cjs');
const root=path.resolve(__dirname,'..');
const load=file=>import(pathToFileURL(path.join(root,file)).href);
const user={userId:'fixture-user',userName:'Fixture User'};
async function transaction(pool,run,commit=false) {
  const tx=new sql.Transaction(pool); await tx.begin();
  try {const result=await run(fixture.tQuery(tx)); if(commit) await tx.commit(); else await tx.rollback(); return result;}
  catch(error) {await tx.rollback().catch(()=>{});throw error;}
}
async function main() {
  for(const key of ['DB_SERVER','DB_PORT','DB_NAME','DB_USER','DB_PASSWORD']) assert.ok(!process.env[key],'Operational environment forbidden');
  const approved=fixture.inspectFixture();
  const name=`NenovaEstimateFixture_${new Date().toISOString().slice(0,10).replace(/-/g,'')}_${crypto.randomBytes(4).toString('hex')}`;
  fixture.assertDbName(name);
  const config={user:'sa',password:approved.password,server:'127.0.0.1',port:14339,
    options:{encrypt:false,trustServerCertificate:true},requestTimeout:60000,pool:{max:4,min:0}};
  let master,pool;
  try {
    master=await new sql.ConnectionPool({...config,database:'master'}).connect();
    await fixture.query(master,`CREATE DATABASE ${fixture.bracket(name)}`);
    await fixture.query(master,`ALTER DATABASE ${fixture.bracket(name)} SET COMPATIBILITY_LEVEL=130`);
    pool=await new sql.ConnectionPool({...config,database:name}).connect();
    await fixture.installSchema(pool);await fixture.seed(pool);
    await fixture.query(pool,`CREATE SEQUENCE dbo.LifecycleStockKey AS int START WITH 50000 INCREMENT BY 1;
      ALTER TABLE dbo.StockMaster ADD CONSTRAINT DF_LifecycleStockKey DEFAULT(NEXT VALUE FOR dbo.LifecycleStockKey) FOR StockKey;
      UPDATE Product SET Stock=100 WHERE ProdKey=866;
      UPDATE WarehouseDetail SET OutQuantity=125,BoxQuantity=125,BunchQuantity=3750,SteamQuantity=3750 WHERE WdetailKey=3701;
      INSERT CustomerProdCost(CustKey,ProdKey,Cost) VALUES(533,866,2500.1234);
      INSERT Customer(CustKey,CustName) VALUES(534,N'Other customer');
      INSERT ShipmentMaster(ShipmentKey,OrderYear,OrderWeek,OrderYearWeek,CustKey,isFix,isDeleted)
        VALUES(8001,N'2026',N'37-01',N'202637',534,1,0),(8002,N'2025',N'37-01',N'202537',533,1,0);
      INSERT ShipmentDetail(SdetailKey,ShipmentKey,CustKey,ProdKey,ShipmentDtm,OutQuantity,
        BoxQuantity,BunchQuantity,SteamQuantity,EstQuantity,Cost,Amount,Vat,isFix)
        SELECT 90001,8001,534,ProdKey,ShipmentDtm,2,2,60,60,60,Cost,136370,13637,1 FROM ShipmentDetail WHERE SdetailKey=89892;
      INSERT ShipmentDetail(SdetailKey,ShipmentKey,CustKey,ProdKey,ShipmentDtm,OutQuantity,
        BoxQuantity,BunchQuantity,SteamQuantity,EstQuantity,Cost,Amount,Vat,isFix)
        SELECT 90002,8002,533,ProdKey,ShipmentDtm,3,3,90,90,90,Cost,204555,20455,1 FROM ShipmentDetail WHERE SdetailKey=89892;`);
    const [core,policy,gate,presence,print,bundle]=await Promise.all([
      load('lib/weekdayDistributionApply.js'),load('lib/weekdayDistributionPolicy.js'),
      load('lib/estimateDirectionalQuantity.js'),load('lib/erpEditPresence.js'),
      load('lib/weekdayEstimatePrint.js'),load('lib/weekdayEstimatePrintBundle.js')]);
    const deps={...fixture.leaseDependencies(gate,presence),confirmationLifecycle:true};
    async function body(tQ,dates,week='37-01') {
      const change={year:'2026',orderWeek:week,custKey:533,prodKey:866,unit:'박스'};
      const actual=await core.readActualScope(tQ,sql,change,{mode:'ALLOCATION'});
      return {operationId:crypto.randomUUID(),mode:'ALLOCATION',reason:'isolated confirmation lifecycle',custKey:533,changes:[{
        ...change,expected:{detailRows:actual.detailRows,shipmentOutQuantity:actual.shipmentOutQuantity,
          shipmentDates:actual.shipmentDates,snapshotDigest:policy.weekdaySnapshotDigest(change,actual)},dates}]};
    }
    async function state(tQ) {
      const rows=await tQ(`SELECT SdetailKey,ShipmentKey,OutQuantity,isFix FROM ShipmentDetail ORDER BY SdetailKey;
        SELECT Stock FROM Product WHERE ProdKey=866;
        SELECT BeforeValue,AfterValue,Descr FROM StockHistory WHERE ChangeType=N'출고' ORDER BY ChangeDtm,BeforeValue;
        SELECT SdetailKey,CONVERT(varchar(10),ShipmentDtm,23) date,ShipmentQuantity FROM ShipmentDate ORDER BY SdateKey;
        SELECT COUNT(*) n FROM Estimate;
        SELECT ShipmentKey,isFix FROM ShipmentMaster ORDER BY ShipmentKey;
        SELECT StockKey,ProdKey,Stock FROM ProductStock ORDER BY StockKey,ProdKey;
        SELECT OrderDetailKey,OutQuantity,OrderQuantity FROM OrderDetail ORDER BY OrderDetailKey;
        SELECT UUID,RequestHash,ResponseJson FROM WebWeekdayDistributionOperation ORDER BY UUID;
        SELECT ShipmentHistoryKey,SdetailKey,CONVERT(varchar(23),ShipmentDtm,121) date,
          ChangeType,BeforeValue,AfterValue,Descr,ChangeID FROM ShipmentHistory ORDER BY ShipmentHistoryKey;`);
      return {details:rows.recordsets[0],stock:Number(rows.recordsets[1][0].Stock),history:rows.recordsets[2],dates:rows.recordsets[3],estimates:rows.recordsets[4][0].n,
        masters:rows.recordsets[5],snapshots:rows.recordsets[6],orders:rows.recordsets[7],operations:rows.recordsets[8],shipmentHistory:rows.recordsets[9]};
    }
    async function unfixed(tQ) {
      await tQ(`UPDATE ShipmentDetail SET isFix=0 WHERE SdetailKey=89892;
        UPDATE ShipmentMaster SET isFix=0 WHERE ShipmentKey=6266;
        UPDATE Product SET Stock=125 WHERE ProdKey=866;`);
    }
    function sentinels(result) {
      assert.deepEqual(result.details.filter(row=>[90001,90002].includes(row.SdetailKey)).map(row=>[row.SdetailKey,Number(row.OutQuantity),Boolean(row.isFix)]),
        [[90001,2,true],[90002,3,true]],'other customer and prior year untouched');
      assert.equal(result.estimates,0,'normal quote must not manufacture Estimate rows');
    }
    const cases=[
      {label:'fixed quantity refixes',fixed:true,dates:[{date:'2026-09-13',quantity:18}],total:23,final:true,stock:102,history:2},
      {label:'fixed weekday preserves fixation',fixed:true,dates:[{date:'2026-09-10',quantity:0},{date:'2026-09-11',quantity:5}],total:25,final:true,stock:100,history:0},
      {label:'unfixed weekday confirms first',fixed:false,dates:[{date:'2026-09-10',quantity:0},{date:'2026-09-11',quantity:5}],total:25,final:true,stock:100,history:1},
      {label:'unfixed quantity remains draft',fixed:false,dates:[{date:'2026-09-13',quantity:18}],total:23,final:false,stock:125,history:0},
      {label:'unfixed combined confirms',fixed:false,dates:[{date:'2026-09-10',quantity:0},{date:'2026-09-11',quantity:7}],total:27,final:true,stock:98,history:1},
      {label:'fixed combined refixes before move',fixed:true,dates:[{date:'2026-09-10',quantity:0},{date:'2026-09-11',quantity:7}],total:27,final:true,stock:98,history:2},
      {label:'fixed zero purges without refix',fixed:true,dates:[{date:'2026-09-10',quantity:0},{date:'2026-09-13',quantity:0}],total:0,final:false,stock:125,history:1},
    ];
    for(const scenario of cases) await transaction(pool,async tQ=>{
      if(!scenario.fixed) await unfixed(tQ);
      const request=await body(tQ,scenario.dates);
      const applied=await core.executeWeekdayDistributionApply(tQ,sql,request,user,deps);
      assert.equal(applied.success,true);
      assert.equal(applied.changes[0].confirmationLifecycle.beforeFixed,scenario.fixed);
      assert.equal(applied.changes[0].confirmationLifecycle.finalFixed,scenario.final);
      const result=await state(tQ);sentinels(result);
      const detail=result.details.find(row=>row.SdetailKey===89892);
      assert.equal(detail?Number(detail.OutQuantity):0,scenario.total,scenario.label);
      if(scenario.total) assert.equal(Boolean(detail.isFix),scenario.final,scenario.label);
      assert.equal(result.stock,scenario.stock,scenario.label);
      assert.equal(result.history.length,scenario.history,scenario.label);
      assert.equal(Boolean(result.masters.find(row=>row.ShipmentKey===6266).isFix),scenario.final,scenario.label);
      if(scenario.history===2) assert.deepEqual(result.history.map(row=>row.Descr).sort(),['출고확정','출고확정 취소'].sort());
      const audit=(await tQ('SELECT AfterJson,StockValuesIfKnown FROM WebWeekdayDistributionChange')).recordset[0];
      assert.equal(JSON.parse(audit.AfterJson).confirmationLifecycle.finalFixed,scenario.final);
      assert.equal(JSON.parse(audit.StockValuesIfKnown).transitions.length,scenario.history);
      if(scenario.label==='unfixed weekday confirms first') {
        const baseline=result.shipmentHistory.filter(row=>row.Descr==='주광 출고확정 이력 대조');
        assert.deepEqual(baseline.map(row=>[row.date.slice(0,10),row.ChangeType,Number(row.BeforeValue),Number(row.AfterValue)]).sort(),
          [['2026-09-10','신규',0,5],['2026-09-13','신규',0,20]],'confirmation records original dates before movement');
      }
      if(scenario.label==='fixed quantity refixes') {
        assert.equal(result.shipmentHistory.filter(row=>row.date.startsWith('2026-09-13')&&Number(row.AfterValue)===18).length,1,
          'quantity save history is not duplicated by confirmation reconciliation');
      }
      const replay=await core.executeWeekdayDistributionApply(tQ,sql,request,user,deps);
      assert.deepEqual(replay,applied,'UUID returns the recorded original response');
      assert.deepEqual(await state(tQ),result,'UUID replay is physically inert');
      console.log(`PASS ${scenario.label}`);
    });
    await transaction(pool,async tQ=>{
      await unfixed(tQ);
      await tQ(`INSERT ShipmentHistory(SdetailKey,ShipmentDtm,ChangeType,BeforeValue,AfterValue,Descr,ChangeID,ChangeDtm)
        VALUES(89892,CONVERT(datetime,'2026-09-13 00:00:00.000',121),N'신규',N'0',N'20',N'preexisting matching baseline',N'fixture-user',DATEADD(day,-1,GETDATE()));`);
      const request=await body(tQ,[{date:'2026-09-10',quantity:0},{date:'2026-09-11',quantity:5}]);
      const applied=await core.executeWeekdayDistributionApply(tQ,sql,request,user,deps);
      const result=await state(tQ);
      assert.equal(result.shipmentHistory.filter(row=>row.date.startsWith('2026-09-13')).length,1,'matching latest original date needs no duplicate history');
      assert.deepEqual(await core.executeWeekdayDistributionApply(tQ,sql,request,user,deps),applied);
      assert.deepEqual(await state(tQ),result,'history reconciliation and UUID replay remain inert');
      console.log('PASS matching latest original date history is not duplicated');
    });
    for(const fixed of [true,false]) await transaction(pool,async tQ=>{
      if(!fixed) await unfixed(tQ);
      const request=await body(tQ,[{date:'2026-09-13',quantity:15}]);
      request.changes.push((await body(tQ,[{date:'2026-09-15',quantity:5}],'37-02')).changes[0]);
      await core.executeWeekdayDistributionApply(tQ,sql,request,user,deps);
      const result=await state(tQ);sentinels(result);
      assert.equal(result.stock,100,'same total cross-subweek movement consumes only original unfixed allocation');
      const scopeDetails=result.details.filter(row=>[6266,6267].includes(row.ShipmentKey));
      assert.equal(scopeDetails.reduce((sum,row)=>sum+Number(row.OutQuantity),0),25);
      assert.ok(scopeDetails.every(row=>Boolean(row.isFix)),'source and destination fixed after date movement');
      console.log(`PASS cross-subweek ${fixed?'fixed':'unfixed'}`);
    });
    await transaction(pool,async tQ=>{
      await tQ('UPDATE Product SET Stock=0 WHERE ProdKey=866');
      const request=await body(tQ,[{date:'2026-09-13',quantity:10}]);
      request.changes.push((await body(tQ,[{date:'2026-09-15',quantity:5}],'37-02')).changes[0]);
      await core.executeWeekdayDistributionApply(tQ,sql,request,user,deps);
      const result=await state(tQ);sentinels(result);
      assert.equal(result.stock,5,'net decrease credits the source before confirming new target');
      assert.equal(result.details.filter(row=>[6266,6267].includes(row.ShipmentKey)).reduce((sum,row)=>sum+Number(row.OutQuantity),0),20);
      console.log('PASS cross-subweek net reduction at zero current stock');
    });
    for(const dateOnly of [false,true]) await transaction(pool,async tQ=>{
      await tQ('UPDATE Product SET Stock=-10 WHERE ProdKey=866');
      const dates=dateOnly?[{date:'2026-09-10',quantity:0},{date:'2026-09-11',quantity:5}]:[{date:'2026-09-13',quantity:18}];
      await core.executeWeekdayDistributionApply(tQ,sql,await body(tQ,dates),user,deps);
      const result=await state(tQ);sentinels(result);
      assert.equal(result.stock,dateOnly?-10:-8,'existing negative current stock does not block date-only or quantity reduction');
      assert.equal(Boolean(result.details.find(row=>row.SdetailKey===89892).isFix),true);
      console.log(`PASS existing negative stock ${dateOnly?'date-only':'quantity reduction'}`);
    });
    // Trigger a failure after lifecycle writes inside the same real transaction.
    const before=await transaction(pool,state);
    await assert.rejects(()=>transaction(pool,async tQ=>{
      await tQ('UPDATE CustomerProdCost SET Cost=99 WHERE CustKey=533 AND ProdKey=866');
      const request=await body(tQ,[{date:'2026-09-13',quantity:15}]);
      request.changes.push((await body(tQ,[{date:'2026-09-15',quantity:5}],'37-02')).changes[0]);
      await core.executeWeekdayDistributionApply(tQ,sql,request,user,deps);
    },true),error=>/단가/.test(error.message));
    assert.deepEqual(await transaction(pool,state),before,'mismatched cross-subweek price rolls back without changing original dates');
    console.log('PASS cross-subweek mismatched price rejected');
    await assert.rejects(()=>transaction(pool,async tQ=>{
      await tQ('UPDATE FixtureNativeCalcControl SET FailNext=1 WHERE ControlKey=1');
      await core.executeWeekdayDistributionApply(tQ,sql,await body(tQ,[{date:'2026-09-13',quantity:18}]),user,deps);
    },true));
    assert.deepEqual(await transaction(pool,state),before,'native failure rolls back quantities, fixation, dates, stock and history');
    console.log('PASS native failure full rollback');
    for(const stage of ['cancel','quantity','confirm','dates','audit','unfixed-date-only']) {
      let fired=false;
      await assert.rejects(()=>transaction(pool,async tQ=>{
        if(stage==='unfixed-date-only') await unfixed(tQ);
        const request=await body(tQ,[{date:'2026-09-10',quantity:0},{date:'2026-09-11',quantity:stage==='unfixed-date-only'?5:7}]);
        const injected=async(statement,params={})=>{
          const result=await tQ(statement,params);
          const match=stage==='cancel' ? /INSERT INTO StockHistory/.test(statement)&&params.descr?.value==='출고확정 취소'
            :stage==='confirm' ? /INSERT INTO StockHistory/.test(statement)&&params.descr?.value==='출고확정'
            :stage==='quantity' ? /UPDATE\s+ShipmentDetail\s+SET[\s\S]*OutQuantity/i.test(statement)
            :['dates','unfixed-date-only'].includes(stage) ? /DELETE FROM\s+ShipmentDate\b/i.test(statement)&&Number(params.dateKey?.value)===119701
            :/INSERT INTO dbo\.WebWeekdayDistributionChange/i.test(statement);
          if(match) {fired=true;throw Object.assign(new Error(`injected after ${stage}`),{code:'FIXTURE_STAGE_FAILURE'});}
          return result;
        };
        await core.executeWeekdayDistributionApply(injected,sql,request,user,deps);
      },true),error=>{
        assert.equal(error.code,'FIXTURE_STAGE_FAILURE');
        assert.equal(error.failureStage,{cancel:'CANCEL_CONFIRMATION',quantity:'SAVE_QUANTITY',confirm:'CONFIRM',dates:'MOVE_DATES',audit:'AUDIT','unfixed-date-only':'MOVE_DATES'}[stage]);
        return true;
      });
      assert.equal(fired,true,`${stage} failure reached real SQL write`);
      assert.deepEqual(await transaction(pool,state),before,`${stage} failure rolls back all business and audit state`);
      console.log(`PASS rollback after ${stage}`);
    }
    await transaction(pool,async tQ=>{
      await unfixed(tQ);await tQ('UPDATE Product SET Stock=0 WHERE ProdKey=866');
      const request=await body(tQ,[{date:'2026-09-10',quantity:0},{date:'2026-09-11',quantity:5}]);
      await assert.rejects(()=>core.executeWeekdayDistributionApply(tQ,sql,request,user,deps),
        error=>error.code==='STOCK_SHORTAGE','unfixed date move must check full confirmation consumption');
      console.log('PASS current stock shortage blocks unfixed date movement');
    });
    await transaction(pool,async tQ=>{
      await tQ(`INSERT Product(ProdKey,ProdName,CountryFlower,CounName,FlowerName,OutUnit,EstUnit,
        BunchOf1Box,SteamOf1Bunch,SteamOf1Box,Cost,Stock)
        SELECT 867,N'Unrelated unfixed product',CountryFlower,CounName,FlowerName,OutUnit,EstUnit,
          BunchOf1Box,SteamOf1Bunch,SteamOf1Box,Cost,0 FROM Product WHERE ProdKey=866;
        INSERT ShipmentDetail(SdetailKey,ShipmentKey,CustKey,ProdKey,ShipmentDtm,OutQuantity,
          BoxQuantity,BunchQuantity,SteamQuantity,EstQuantity,Cost,Amount,Vat,isFix)
          SELECT 90003,ShipmentKey,CustKey,867,ShipmentDtm,1,1,30,30,30,Cost,68185,6818,0
            FROM ShipmentDetail WHERE SdetailKey=89892;
        UPDATE ShipmentMaster SET isFix=0 WHERE ShipmentKey=6266;`);
      await core.executeWeekdayDistributionApply(tQ,sql,await body(tQ,[{date:'2026-09-13',quantity:18}]),user,deps);
      const result=await state(tQ);
      assert.equal(Boolean(result.details.find(row=>row.SdetailKey===89892).isFix),true);
      assert.equal(Boolean(result.details.find(row=>row.SdetailKey===90003).isFix),false);
      assert.equal(Boolean(result.masters.find(row=>row.ShipmentKey===6266).isFix),false,'master remains unfixed while any unrelated child is unfixed');
      console.log('PASS mixed master derives all children without touching unrelated child');
    });
    await assert.rejects(()=>transaction(pool,async tQ=>{
      await tQ(`INSERT StockMaster(StockKey,OrderYear,OrderWeek,OrderYearWeek,isFix,CreateID)
        VALUES(270101,N'2027',N'01-01',N'20270101',1,N'fixture-user');
        INSERT ProductStock(StockKey,ProdKey,Stock) VALUES(270101,866,100);
        INSERT StockHistory(ChangeDtm,OrderYear,OrderWeek,ChangeID,ChangeType,ColumName,BeforeValue,AfterValue,Descr,ProdKey)
          VALUES(GETDATE(),N'2027',N'01-01',N'fixture-user',N'재고조정',N'수량',100,-900,N'future shortage fixture',866);`);
      await core.executeWeekdayDistributionApply(tQ,sql,await body(tQ,[{date:'2026-09-13',quantity:22}]),user,deps);
    },true),error=>error.code==='FUTURE_STOCK_SHORTAGE');
    assert.deepEqual(await transaction(pool,state),before,'following-year native shortage rolls back current and future records');
    console.log('PASS following-year actual native recalculation shortage rollback');
    // Exercise the production eligibility, EXE quote SQL and HTML print bundle.
    await transaction(pool,async tQ=>{
      await core.executeWeekdayDistributionApply(tQ,sql,await body(tQ,[{date:'2026-09-13',quantity:18}]),user,deps);
      const request=print.normalizeWeekdayPrintRequest({year:2026,majorWeek:'37',custKey:533,mode:'dates',dates:['2026-09-13']});
      const result=await print.readWeekdayPrintInTransaction(request,tQ,sql);
      assert.equal(result.eligibility.eligible,true);
      assert.equal(result.items.reduce((sum,row)=>sum+row.Quantity,0),540,'18 boxes x 30 estimate units');
      const output=bundle.buildWeekdayEstimatePrintBundle({requests:[request],results:[{...result,scope:request,success:true,readOnly:true,draftIncluded:false}],printDate:'2026-09-13'});
      assert.equal(output.documentCount,1);assert.ok(output.html.includes('Fixture Carnation'));
      console.log('PASS actual weekday quote joins and print HTML');
    });
    console.log('PASS all isolated confirmation lifecycle scenarios');
  } finally {
    await pool?.close().catch(()=>{});
    if(master) await fixture.query(master,`IF DB_ID(N'${name}') IS NOT NULL BEGIN ALTER DATABASE ${fixture.bracket(name)} SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE ${fixture.bracket(name)}; END`).catch(()=>{});
    await master?.close().catch(()=>{});
  }
}
main().catch(error=>{console.error(error.stack||error.message);process.exitCode=1;});
