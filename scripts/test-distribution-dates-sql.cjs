// Fresh isolated Docker SQL only; never reads operational environment.
const assert=require('node:assert/strict'),crypto=require('node:crypto'),sql=require('mssql'),fixture=require('./test-weekday-distribution-sql.cjs');
async function main(){
 for(const k of ['DB_SERVER','DB_PORT','DB_NAME','DB_USER','DB_PASSWORD'])assert(!process.env[k]);
 const approved=fixture.inspectFixture(),name=`NenovaEstimateFixture_${new Date().toISOString().slice(0,10).replace(/-/g,'')}_${crypto.randomBytes(4).toString('hex')}`;fixture.assertDbName(name);
 const config={server:'127.0.0.1',port:14339,user:'sa',password:approved.password,options:{encrypt:false,trustServerCertificate:true}};
 let master,pool;
 try{
 master=await new sql.ConnectionPool({...config,database:'master'}).connect();await fixture.query(master,`CREATE DATABASE ${fixture.bracket(name)}`);pool=await new sql.ConnectionPool({...config,database:name}).connect();await fixture.installSchema(pool);await fixture.seed(pool);
 const q=(s,p)=>fixture.query(pool,s,p);
 await q(`DROP TABLE ShipmentDate; CREATE TABLE ShipmentDate(SdateKey int IDENTITY(1,1) PRIMARY KEY,SdetailKey int,ShipmentDtm datetime,ShipmentQuantity float,EstQuantity float,Cost float,Amount float,Vat float,Descr nvarchar(1000));
`);
 await q(`ALTER TABLE PeriodDay ADD BaseDay nvarchar(20); ALTER TABLE Customer ADD CustCode nvarchar(30); ALTER TABLE Product ADD ProdCode nvarchar(30);`);
 await q(`
 UPDATE Customer SET CustCode=N'FIX';UPDATE Product SET Cost=11500,BunchOf1Box=15,SteamOf1Bunch=20,SteamOf1Box=300,ProdCode=N'FIX';
 UPDATE ShipmentMaster SET OrderWeek=N'45-01',OrderYearWeek=N'202645' WHERE ShipmentKey=6266;
 UPDATE OrderMaster SET OrderWeek=N'45-01',OrderYearWeek=N'202645' WHERE OrderMasterKey=3701;
 UPDATE ShipmentDetail SET CustKey=NULL,OutQuantity=1,EstQuantity=15,BoxQuantity=1,BunchQuantity=15,SteamQuantity=300,Cost=11500,Amount=156818,Vat=15682,ShipmentDtm='2026-11-06' WHERE SdetailKey=89892;
 INSERT ShipmentDate(SdetailKey,ShipmentDtm,ShipmentQuantity,EstQuantity,Cost,Amount,Vat,Descr) VALUES(89892,'2026-11-06',1,15,11500,156818,15682,N'');
 INSERT ShipmentMaster(ShipmentKey,OrderYear,OrderWeek,OrderYearWeek,CustKey,isFix) VALUES(9000,N'2025',N'45-01',N'202545',533,1);
 INSERT ShipmentDetail(SdetailKey,ShipmentKey,CustKey,ProdKey,OutQuantity,EstQuantity,BoxQuantity,BunchQuantity,SteamQuantity,Cost,Amount,Vat,ShipmentDtm,isFix) VALUES(90000,9000,NULL,866,99,1485,99,1485,29700,11500,123456,12345,'2025-11-06',1);
 DELETE PeriodDay;`);
 for(let i=0;i<7;i++){const d=new Date(Date.UTC(2026,10,4+i));await q('INSERT PeriodDay(PeriodDayKey,OrderYearWeek,WeekDay,BaseYmd)VALUES(@id,N\'202645\',@day,@dt)',{id:{type:sql.Int,value:i+1},day:{type:sql.Int,value:d.getUTCDay()+1},dt:{type:sql.NVarChar,value:d.toISOString().slice(0,10)}});}
 await q(`CREATE TABLE WebProfitReport(ReportKey int,Amount float);INSERT WebProfitReport VALUES(1,172500);INSERT ShipmentFarm(FarmKey,ShipmentQuantity,SdetailKey)VALUES(1,1,89892);`);
 await q(`ALTER VIEW dbo.ViewOrder AS SELECT om.OrderMasterKey,od.OrderDetailKey,om.OrderYear,om.OrderWeek,om.OrderYearWeek+RIGHT(om.OrderWeek,2) OrderYearWeek2,om.CustKey,od.ProdKey,od.OutQuantity FROM OrderMaster om JOIN OrderDetail od ON od.OrderMasterKey=om.OrderMasterKey JOIN UserInfo ui ON ui.UserID=om.Manager JOIN Customer c ON c.CustKey=om.CustKey JOIN Product p ON p.ProdKey=od.ProdKey WHERE om.isDeleted=0 AND od.isDeleted=0 AND c.isDeleted=0 AND p.isDeleted=0`);
 const core=await import('../lib/shipmentDistributionDates.js'),gate=await import('../lib/estimateDirectionalQuantity.js'),presence=await import('../lib/erpEditPresence.js');
 const scope={orderYear:'2026',orderWeek:'45-01',custKey:533,prodKey:866};
 for(const [bad,restore] of [["UPDATE OrderMaster SET Manager=N'missing' WHERE OrderMasterKey=3701","UPDATE OrderMaster SET Manager=N'fixture-user' WHERE OrderMasterKey=3701"],['UPDATE Product SET isDeleted=1','UPDATE Product SET isDeleted=0'],['UPDATE Customer SET isDeleted=1','UPDATE Customer SET isDeleted=0'],['UPDATE OrderDetail SET isDeleted=1','UPDATE OrderDetail SET isDeleted=0']]){await q(bad);await assert.rejects(()=>core.readDistributionDateContext(q,sql,scope));await q(restore);}
 const ctx=await core.readDistributionDateContext(q,sql,scope);assert.equal(ctx.detail.RawCustKey,null);const snapshot=core.distributionDateSnapshot(ctx);
 const allocations=[{timestamp:'2026-11-05 00:00:00.000',quantity:.4},{timestamp:'2026-11-09 00:00:00.000',quantity:.6}];
 const protectedRead=async()=>JSON.stringify((await q(`SELECT (SELECT * FROM OrderMaster FOR JSON PATH) O,(SELECT * FROM OrderDetail FOR JSON PATH) OD,(SELECT * FROM ShipmentFarm FOR JSON PATH) F,(SELECT * FROM Estimate FOR JSON PATH) E,(SELECT * FROM ProductStock FOR JSON PATH) PS,(SELECT * FROM StockHistory FOR JSON PATH) SH,(SELECT * FROM WebProfitReport FOR JSON PATH) W,(SELECT * FROM ShipmentDetail WHERE SdetailKey=90000 FOR JSON PATH) Prior`)).recordset);
 const before=await protectedRead();
 const transact=async(f,rollback=false)=>{const tx=new sql.Transaction(pool);await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);try{const r=await f(fixture.tQuery(tx));if(rollback)await tx.rollback();else await tx.commit();return r;}catch(e){await tx.rollback();throw e;}};
 await assert.rejects(()=>transact(t=>core.executeDistributionDateSave(t,sql,{...scope,orderYear:'2025'},{snapshot,allocations},'fixture-user')));
 await assert.rejects(()=>transact(t=>core.executeDistributionDateSave(t,sql,scope,{snapshot:'stale',allocations},'fixture-user')),/재조회/);
 await assert.rejects(()=>transact(t=>core.executeDistributionDateSave(t,sql,scope,{snapshot,allocations:[{...allocations[0],quantity:1},{...allocations[1],quantity:1}]},'fixture-user')),/합계/);
 await assert.rejects(()=>transact(t=>core.executeDistributionDateSave(async(statement,params)=>{if(statement.includes('INSERT INTO SystemActionLog'))throw new Error('fixture audit failure');return t(statement,params);},sql,scope,{snapshot,allocations},'fixture-user')),/fixture audit failure/);
 assert.equal(core.distributionDateSnapshot(await core.readDistributionDateContext(q,sql,scope)),snapshot,'audit failure rolls back deleted/inserted Date rows and Detail date');
 await q("UPDATE NenovaStockWeekGate SET PendingCalc=1 WHERE GateKey='1'");await assert.rejects(()=>transact(t=>gate.lockDirectionalGate(t)));await q("UPDATE NenovaStockWeekGate SET PendingCalc=0 WHERE GateKey='1'");
 await transact(t=>core.executeDistributionDateSave(t,sql,scope,{snapshot,allocations},'fixture-user'),true);
 assert.equal(core.distributionDateSnapshot(await core.readDistributionDateContext(q,sql,scope)),snapshot,'rolled back physical rows');assert.equal((await q('SELECT COUNT(*) N FROM SystemActionLog')).recordset[0].N,0);
 const user={userId:'fixture-user',userName:'Fixture User'},leaseScope={orderYear:'2026',orderWeek:'45',custKey:533};
 const result=await transact(async t=>{await gate.assertDirectionalGateCapability(t);await gate.lockDirectionalGate(t);const a=await presence.acquireErpEditLease(t,leaseScope,user,{clientId:'fixture-dates',pageCode:'shipment-distribution-dates'});const editGuard={clientId:'fixture-dates',leaseToken:a.lease.leaseToken};await presence.assertErpEditGuard(t,leaseScope,user,{editGuard});const r=await core.executeDistributionDateSave(t,sql,scope,{snapshot,allocations},user.userId);await presence.advanceErpEditGuard(t,leaseScope,user,{editGuard});await presence.releaseErpEditLease(t,leaseScope,user,{editGuard});return r;});
 assert.equal(result.plan.gross,172500);assert.equal(await protectedRead(),before,'all protected tables and prior year exact');
 await assert.rejects(()=>transact(t=>core.executeDistributionDateSave(t,sql,scope,{snapshot,allocations},'fixture-user')),/재조회/);
 const {sqlEstimateGetExcelDetail,sqlEstimateGetDetail}=await import('../lib/exeEstimateViewSql.js');const {mapExcelDetailRowToEcount,buildEcountUploadSheet}=await import('../lib/estimateEcountExcel.js');
 const params={orderYearWeek:{type:sql.NVarChar,value:'202645'},custKey:{type:sql.Int,value:533}};
 const rows=(await q(sqlEstimateGetExcelDetail({weekDayIn:'1,2,3,4,5,6,7'}),params)).recordset;assert.equal(rows.length,1);
 const detailRows=(await q(sqlEstimateGetDetail({}),params)).recordset;assert.equal(detailRows.filter(r=>r.EstQuantity>0).length,2);
 for(const [day,expected] of [[5,6],[2,9]]){const one=(await q(sqlEstimateGetExcelDetail({weekDayIn:String(day)}),params)).recordset;assert.equal(one.length,1);assert.equal(Number(one[0].EstQuantity),expected);}
 assert.equal(rows.reduce((s,r)=>s+Number(r.EstQuantity),0),15);assert.equal(rows.reduce((s,r)=>s+Number(r.Amount)+Number(r.Vat),0),172500);
 const mapped=rows.map(mapExcelDetailRowToEcount);assert.equal(mapped.reduce((s,r)=>s+r.수량,0),15);assert(buildEcountUploadSheet(rows)['!ref']);
 const XLSX=require('xlsx'),wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,buildEcountUploadSheet(rows),'연습');assert(XLSX.read(XLSX.write(wb,{type:'buffer',bookType:'xlsx'}),{type:'buffer'}).Sheets['연습']);
 assert.equal((await q('SELECT COUNT(*) N FROM SystemActionLog')).recordset[0].N,1);
 console.log('PASS date-only native split: null detail customer, fixed state, native exact PeriodDay, 15 invoice units/172500 gross in ECOUNT XLSX, gate+lease, rollback/stale/cross-year; orders/farm/stock/Estimate/profit preserved. Operational writes0.');
 }finally{await pool?.close();if(master)await fixture.query(master,`IF DB_ID(N'${name}') IS NOT NULL BEGIN ALTER DATABASE ${fixture.bracket(name)} SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE ${fixture.bracket(name)}; END`);await master?.close();}
}
main().catch(e=>{console.error(e.stack);process.exitCode=1;});

