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
      const rows=await tQ(`SELECT SdetailKey,ShipmentKey,CustKey,ProdKey,OutQuantity,Cost,Amount,Vat,isFix FROM ShipmentDetail ORDER BY SdetailKey;
        SELECT Stock FROM Product WHERE ProdKey=866;
        SELECT BeforeValue,AfterValue,Descr FROM StockHistory WHERE ChangeType=N'출고' ORDER BY ChangeDtm,BeforeValue;
        SELECT SdateKey,SdetailKey,CONVERT(varchar(23),ShipmentDtm,121) date,ShipmentQuantity,EstQuantity,Cost,Amount,Vat,Descr FROM ShipmentDate ORDER BY SdateKey;
        SELECT COUNT(*) n FROM Estimate;
        SELECT ShipmentKey,OrderYear,OrderWeek,CustKey,isFix FROM ShipmentMaster ORDER BY ShipmentKey;
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
    for(const createMaster of [false,true]) await transaction(pool,async tQ=>{
      await unfixed(tQ);
      await tQ(`UPDATE Customer SET Manager=N'담당자 이름' WHERE CustKey=533;
        DELETE OrderDetail WHERE OrderMasterKey=3701;`);
      if(createMaster) await tQ('DELETE OrderMaster WHERE OrderMasterKey=3701');
      const request=await body(tQ,[{date:'2026-09-13',quantity:21}]);
      const applied=await core.executeWeekdayDistributionApply(tQ,sql,request,user,deps);
      assert.equal(applied.saved,true);
      const orders=(await tQ(`SELECT om.Manager,od.OutQuantity FROM OrderMaster om JOIN OrderDetail od ON od.OrderMasterKey=om.OrderMasterKey
        WHERE om.OrderYear=N'2026' AND om.OrderWeek=N'37-01' AND om.CustKey=533 AND od.ProdKey=866`)).recordset;
      assert.equal(orders.length,1);assert.equal(orders[0].Manager,'fixture-user');
      assert.ok(Number(orders[0].OutQuantity)>0);sentinels(await state(tQ));
      assert.equal((await tQ('SELECT Manager FROM Customer WHERE CustKey=533')).recordset[0].Manager,'담당자 이름');
      console.log(`PASS business contact name preserved; ${createMaster?'new master uses login':'existing master keeps manager'}`);
    });
    const beforeManagerFailure=await transaction(pool,state);
    await assert.rejects(()=>transaction(pool,async tQ=>{
      await unfixed(tQ);
      await tQ(`DELETE OrderDetail WHERE OrderMasterKey=3701; DELETE OrderMaster WHERE OrderMasterKey=3701;
        UPDATE UserInfo SET isDeleted=1 WHERE UserID=N'fixture-user';`);
      await core.executeWeekdayDistributionApply(tQ,sql,await body(tQ,[{date:'2026-09-13',quantity:21}]),user,deps);
    }),error=>error.code==='ALLOCATION_SCOPE_UNVERIFIED');
    assert.deepEqual(await transaction(pool,state),beforeManagerFailure,'invalid new-order actor rolls back all business and audit writes');
    await transaction(pool,async tQ=>{
      await gate.lockDirectionalGate(tQ);
      const row=(await tQ('SELECT Mode,PendingCalc,OwnerToken,OwnerSessionID FROM NenovaStockWeekGate')).recordset[0];
      assert.equal(row.Mode,null);assert.equal(Boolean(row.PendingCalc),false);assert.equal(row.OwnerToken,null);assert.equal(row.OwnerSessionID,null);
    });
    console.log('PASS manager failure rollback releases gate for the next transaction');
    const busyRequest=await transaction(pool,tQ=>body(tQ,[{date:'2026-09-13',quantity:18}]));
    const gateOwner=new sql.Transaction(pool);await gateOwner.begin();
    try {
      await fixture.tQuery(gateOwner)('SELECT GateKey FROM NenovaStockWeekGate WITH (UPDLOCK,HOLDLOCK) WHERE GateKey=\'1\'');
      await assert.rejects(()=>transaction(pool,tQ=>core.executeWeekdayDistributionApply(tQ,sql,busyRequest,user,deps)),error=>{
        assert.equal(error.code,'STOCK_GATE_BUSY');assert.equal(error.preWriteGateBusy,true);return true;
      });
    } finally {await gateOwner.rollback();}
    assert.deepEqual(await transaction(pool,state),beforeManagerFailure,'contended gate produces no business/audit writes');
    await transaction(pool,async tQ=>{
      const saved=await core.executeWeekdayDistributionApply(tQ,sql,busyRequest,user,deps);
      assert.equal(saved.saved,true);sentinels(await state(tQ));
    });
    console.log('PASS active gate rejects before writes; identical UUID succeeds after owner rollback');
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
    // Native legacy rows may retain -01 on Monday. Correct the business week
    // while preserving the date, total allocation, exact price and other days.
    async function seedSameDateTransfer(tQ) {
      await tQ(`INSERT PeriodDay(PeriodDayKey,OrderYearWeek,BaseYmd,WeekDay)
          VALUES(6,N'202638',N'2026-09-14',2);
        UPDATE ShipmentDate SET ShipmentQuantity=3,EstQuantity=90,
          Amount=ROUND(Cost*90/1.1,0),Vat=Cost*90-ROUND(Cost*90/1.1,0) WHERE SdateKey=119701;
        INSERT ShipmentDate(SdateKey,SdetailKey,ShipmentDtm,ShipmentQuantity,EstQuantity,Cost,Amount,Vat,Descr)
          SELECT 119702,89892,CONVERT(datetime,'2026-09-14 00:00:00.000',121),2,60,Cost,
            ROUND(Cost*60/1.1,0),Cost*60-ROUND(Cost*60/1.1,0),N'legacy Monday under -01'
          FROM ShipmentDetail WHERE SdetailKey=89892;
        UPDATE ShipmentDetail SET Amount=d.Amount,Vat=d.Vat FROM ShipmentDetail s
          CROSS APPLY(SELECT SUM(Amount) Amount,SUM(Vat) Vat FROM ShipmentDate WHERE SdetailKey=s.SdetailKey)d
          WHERE s.SdetailKey=89892;`);
      const request=await body(tQ,[{date:'2026-09-14',quantity:0}]);
      request.changes.push((await body(tQ,[{date:'2026-09-14',quantity:2}],'37-02')).changes[0]);
      return request;
    }
    await transaction(pool,async tQ=>{
      const request=await seedSameDateTransfer(tQ),beforeTransfer=await state(tQ);
      const applied=await core.executeWeekdayDistributionApply(tQ,sql,request,user,deps);
      const result=await state(tQ);sentinels(result);
      assert.equal(applied.success,true);
      assert.equal(applied.changes.length,2);
      assert.ok(applied.changes.every(change=>change.confirmationLifecycle.finalFixed));
      const source=result.details.find(row=>row.SdetailKey===89892);
      const target=result.details.find(row=>row.ShipmentKey===6267&&row.ProdKey===866);
      assert.equal(Number(source.OutQuantity),23);
      assert.equal(Number(target.OutQuantity),2);
      assert.ok(Boolean(source.isFix)&&Boolean(target.isFix));
      assert.equal(source.CustKey,533);assert.equal(target.CustKey,533);
      assert.equal(Number(source.Cost),Number(target.Cost));
      assert.deepEqual(result.dates.filter(row=>row.SdetailKey===source.SdetailKey),
        beforeTransfer.dates.filter(row=>row.SdetailKey===source.SdetailKey&&!row.date.startsWith('2026-09-14')),
        'other source dates retain physical keys, quantities, timestamps, costs and gross');
      const targetDates=result.dates.filter(row=>row.SdetailKey===target.SdetailKey);
      assert.equal(targetDates.length,1);
      assert.equal(targetDates[0].date,'2026-09-14 00:00:00.000');
      assert.equal(Number(targetDates[0].ShipmentQuantity),2);
      const gross=snapshot=>snapshot.dates.reduce((sum,row)=>sum+Number(row.Amount)+Number(row.Vat),0);
      assert.ok(Math.abs(gross(result)-gross(beforeTransfer))<0.000001,'same-date transfer preserves total date gross');
      assert.equal(result.stock,beforeTransfer.stock,'confirmed same-total transfer has zero net stock consumption');
      assert.deepEqual(result.orders,beforeTransfer.orders,'both existing orders remain unchanged');
      assert.deepEqual(result.details.filter(row=>[90001,90002].includes(row.SdetailKey)),
        beforeTransfer.details.filter(row=>[90001,90002].includes(row.SdetailKey)),
        'other customer and prior-year detail amounts remain unchanged');
      assert.ok(result.masters.filter(row=>[6266,6267].includes(row.ShipmentKey)).every(row=>Boolean(row.isFix)));
      assert.deepEqual(await core.executeWeekdayDistributionApply(tQ,sql,request,user,deps),applied);
      assert.deepEqual(await state(tQ),result,'same-date transfer UUID replay is physically inert');
      console.log('PASS same-date legacy subweek transfer preserves 23/2, other dates, gross, stock, orders and sentinels');
    });
    await transaction(pool,async tQ=>{
      await seedSameDateTransfer(tQ);
      await tQ(`UPDATE ShipmentDate SET ShipmentDtm=CONVERT(datetime,'2026-09-15 00:00:00.000',121)
          WHERE SdateKey=119702;
        INSERT ShipmentDetail(SdetailKey,ShipmentKey,CustKey,ProdKey,ShipmentDtm,OutQuantity,
          BoxQuantity,BunchQuantity,SteamQuantity,EstQuantity,Cost,Amount,Vat,isFix)
          SELECT 90004,6267,533,866,CONVERT(datetime,'2026-09-14 00:00:00.000',121),3,
            3,90,90,90,Cost,ROUND(Cost*90/1.1,0),Cost*90-ROUND(Cost*90/1.1,0),1
          FROM ShipmentDetail WHERE SdetailKey=89892;
        INSERT ShipmentDate(SdateKey,SdetailKey,ShipmentDtm,ShipmentQuantity,EstQuantity,Cost,Amount,Vat,Descr)
          SELECT 119703,SdetailKey,ShipmentDtm,3,90,Cost,Amount,Vat,N'existing confirmed target Monday'
          FROM ShipmentDetail WHERE SdetailKey=90004;
        UPDATE Product SET Stock=97 WHERE ProdKey=866;`);
      const request=await body(tQ,[{date:'2026-09-15',quantity:0}]);
      request.changes.push((await body(tQ,[{date:'2026-09-14',quantity:0},{date:'2026-09-15',quantity:2}],'37-02')).changes[0]);
      const beforeTransfer=await state(tQ);
      const applied=await core.executeWeekdayDistributionApply(tQ,sql,request,user,deps);
      const result=await state(tQ);sentinels(result);
      assert.equal(applied.success,true);assert.equal(applied.changes.length,2);
      const source=result.details.find(row=>row.SdetailKey===89892);
      const target=result.details.find(row=>row.SdetailKey===90004);
      assert.equal(Number(source.OutQuantity),23);assert.equal(Number(target.OutQuantity),2);
      assert.ok(Boolean(source.isFix)&&Boolean(target.isFix));
      assert.equal(source.CustKey,533);assert.equal(target.CustKey,533);
      const scopedTotal=snapshot=>snapshot.details.filter(row=>[89892,90004].includes(row.SdetailKey))
        .reduce((sum,row)=>sum+Number(row.OutQuantity),0);
      assert.equal(scopedTotal(beforeTransfer),28);assert.equal(scopedTotal(result),25);
      assert.equal(result.stock,beforeTransfer.stock+3,'cancelling target Monday credits net three boxes');
      assert.deepEqual(result.orders,beforeTransfer.orders,'both active order quantities and identities are preserved');
      assert.deepEqual(result.details.filter(row=>![89892,90004].includes(row.SdetailKey)),
        beforeTransfer.details.filter(row=>![89892,90004].includes(row.SdetailKey)),
        'other customer/prior-year details and amounts are unchanged');
      assert.deepEqual(result.dates.filter(row=>row.SdetailKey===89892),
        beforeTransfer.dates.filter(row=>row.SdetailKey===89892&&!row.date.startsWith('2026-09-15')),
        'other source dates and exact stored price fields are unchanged');
      assert.deepEqual(result.dates.filter(row=>row.SdetailKey===90004)
        .map(row=>[row.date,Number(row.ShipmentQuantity),Number(row.EstQuantity)]),
        [['2026-09-15 00:00:00.000',2,60]],'existing target Monday is replaced by Tuesday two');
      const dateGross=snapshot=>snapshot.dates.reduce((sum,row)=>sum+Number(row.Amount)+Number(row.Vat),0);
      const detailGross=snapshot=>snapshot.details.reduce((sum,row)=>sum+Number(row.Amount)+Number(row.Vat),0);
      const cancelledGross=3*30*Number(target.Cost);
      assert.ok(Math.abs(dateGross(beforeTransfer)-dateGross(result)-cancelledGross)<0.000001,
        'date gross decreases by exactly three boxes times conversion and original cost');
      assert.ok(Math.abs(detailGross(beforeTransfer)-detailGross(result)-cancelledGross)<0.000001,
        'detail gross agrees with the net cancelled quantity');
      assert.ok(result.masters.filter(row=>[6266,6267].includes(row.ShipmentKey)).every(row=>Boolean(row.isFix)));
      assert.deepEqual(await core.executeWeekdayDistributionApply(tQ,sql,request,user,deps),applied);
      assert.deepEqual(await state(tQ),result,'existing-target correction UUID replay is physically inert');
      console.log('PASS existing confirmed target Monday3 -> Tuesday2 plus source Tuesday2 -> 0: 28->25, stock+3, gross/order/sentinel preservation');
    });
    const beforeSameDateFailure=await transaction(pool,state);
    for(const stage of ['target-materialization','target-confirmation']) {
      let fired=false;
      await assert.rejects(()=>transaction(pool,async tQ=>{
        const request=await seedSameDateTransfer(tQ);
        const injected=async(statement,params={})=>{
          const result=await tQ(statement,params);
          const match=stage==='target-materialization'
            ? /INSERT INTO ShipmentDetail\b/i.test(statement)&&Number(params.sk?.value)===6267
            : /INSERT INTO StockHistory/i.test(statement)&&params.descr?.value==='출고확정'&&params.wk?.value==='37-02';
          if(match) {fired=true;throw Object.assign(new Error(`injected same-date ${stage}`),{code:'FIXTURE_SAME_DATE_FAILURE'});}
          return result;
        };
        await core.executeWeekdayDistributionApply(injected,sql,request,user,deps);
      },true),error=>error.code==='FIXTURE_SAME_DATE_FAILURE');
      assert.equal(fired,true,`${stage} failure reached target SQL write`);
      assert.deepEqual(await transaction(pool,state),beforeSameDateFailure,
        `${stage} failure rolls back source/target quantities, amounts, dates, stock, orders, fixation and audit`);
      console.log(`PASS same-date transfer rollback after ${stage}`);
    }
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
