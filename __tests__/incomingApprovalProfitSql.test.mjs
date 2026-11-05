import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {register} from 'node:module';
import sql from 'mssql';
import {computeIncomingApprovalProfit,approvalProfitPolicyHash,readIncomingApprovalProfit,writeIncomingApprovalProfit} from '../lib/incomingApprovalProfit.js';
register('./fixtures/erpRealModuleLoader.mjs',import.meta.url);
test('actual profit loader reads isolated SQL transaction', {skip:process.env.INCOMING_APPROVAL_SQL!=='1',timeout:180000},async()=>{
 const info=JSON.parse(execFileSync('docker',['inspect','nenova-estimate-sql-test-20260826'],{encoding:'utf8',windowsHide:true}))[0];
 assert.equal(info.State.Running,true);assert.equal(info.Mounts.length,0);
 assert.deepEqual(info.HostConfig.PortBindings,{'1433/tcp':[{HostIp:'127.0.0.1',HostPort:'14339'}]});
 const password=info.Config.Env.find(s=>s.startsWith('MSSQL_SA_PASSWORD=')).split('=').slice(1).join('=');
 const config={server:'127.0.0.1',port:14339,user:'sa',password,options:{encrypt:false,trustServerCertificate:true},requestTimeout:30000};
 const name='NenovaInvoiceFixture_profit_'+randomBytes(8).toString('hex');
 const master=await new sql.ConnectionPool({...config,database:'master'}).connect();let pool;
 try{
 await master.request().query(`CREATE DATABASE [${name}] COLLATE Korean_Wansung_CI_AS; ALTER DATABASE [${name}] SET COMPATIBILITY_LEVEL=130;`);
 pool=await new sql.ConnectionPool({...config,database:name}).connect();
 for(const batch of fs.readFileSync(new URL('./fixtures/incomingApprovalProfit.sql',import.meta.url),'utf8').split(/^\s*GO\s*;?\s*$/gim).filter(s=>s.trim()))await pool.request().batch(batch);
 const q=async(s,params={})=>{const req=pool.request();for(const[k,p]of Object.entries(params))req.input(k,p.type,p.value);return req.query(s);};

 await q("INSERT Customer(CustName,isDeleted) VALUES(N'Fixture',0); INSERT Product(ProdName,CounName,FlowerName,isDeleted) VALUES(N'Fixture',N'베트남',N'장미',0);");
 for(const [id,year,major] of [[1,'2025','41'],[2,'2026','41'],[3,'2026','44'],[4,'2027','01']]){
 await q(`INSERT ShipmentMaster(ShipmentKey,OrderYear,OrderWeek,OrderYearWeek,CustKey,isFix,isDeleted) VALUES(${id},N'${year}',N'${major}-01',N'${year}${major}',1,1,0);
 INSERT ShipmentDetail(SdetailKey,ShipmentKey,ProdKey,OutQuantity,Amount,Vat,isFix) VALUES(${id},${id},1,100,1000,100,1);
 INSERT WebProfitReportConfirm(OrderYear,MajorWeek,RevisionNo,IsActive,ConfirmedBy) VALUES(N'${year}',N'${major}',1,1,N'fixture');`);
 }
 for(const [year,major] of [['2026','40'],['2026','41'],['2026','43'],['2026','44'],['2026','52'],['2027','01']])await q(`INSERT StockMaster(OrderYear,OrderWeek,OrderYearWeek,isFix) VALUES(N'${year}',N'${major}-01',N'${year}${major}',1); INSERT ProductStock(ProdKey,StockKey,Stock) VALUES(1,SCOPE_IDENTITY(),0);`);
 const scope={orderYear:'2026',orderWeek:'41-01'};
 const facts=await readIncomingApprovalProfit(q,sql,scope);
 assert.deepEqual(facts.periods.map(p=>p.orderYear+':'+p.major),['2026:41','2026:44','2027:01']);
 const before=await computeIncomingApprovalProfit({q,types:sql,facts});
 assert.equal(before.periods[0].payload.totals.C,1000);
 // Seed immutable confirmed details with the actual calculator's baseline, not synthetic totals.
 for(const period of before.periods){
 const key=facts.periods.find(p=>p.orderYear===period.orderYear&&p.major===period.major).confirm.ConfirmKey;
 await q('UPDATE WebProfitReportConfirm SET SourceHash=@hash WHERE ConfirmKey=@key',{hash:{type:sql.NVarChar,value:period.sourceHash},key:{type:sql.Int,value:key}});
 for(const d of period.detailRows)await q('INSERT WebProfitReportConfirmDetail(ConfirmKey,Category,ColType,ColKey,Value,TextValue) VALUES(@key,@category,@type,@column,@value,@text)',{key:{type:sql.Int,value:key},category:{type:sql.NVarChar,value:d.category},type:{type:sql.NVarChar,value:d.colType},column:{type:sql.NVarChar,value:d.colKey},value:{type:sql.Decimal(38,10),value:d.value},text:{type:sql.NVarChar,value:d.textValue}});
 }
 const storedBefore=await readIncomingApprovalProfit(q,sql,scope);
 const oldDetails=JSON.stringify((await q('SELECT * FROM WebProfitReportConfirmDetail ORDER BY ConfirmDetailKey')).recordset);
 const tx=new sql.Transaction(pool); await tx.begin();
 const tq=async(s,params={})=>{const req=new sql.Request(tx);for(const[k,p]of Object.entries(params))req.input(k,p.type,p.value);return req.query(s);};
 try{
 await tq('UPDATE ShipmentDetail SET OutQuantity=80,Amount=800,Vat=80 WHERE SdetailKey=2');
 const after=await computeIncomingApprovalProfit({q:tq,types:sql,facts});
 assert.equal(after.periods[0].payload.totals.C,800);
 assert.equal(after.periods[1].payload.totals.C,1000);
 await writeIncomingApprovalProfit({q:tq,types:sql,before:storedBefore,after,actor:'fixture',requestId:1,reason:'quantity correction'});
 await tx.commit();
 }catch(e){await tx.rollback().catch(()=>{});console.error(e.message,e.cause?.message,e.evidenceKeys);throw e;}
 assert.equal(JSON.stringify((await q('SELECT * FROM WebProfitReportConfirmDetail WHERE ConfirmKey IN(2,3,4) ORDER BY ConfirmDetailKey')).recordset),oldDetails);
 assert.equal((await q('SELECT COUNT(*) n FROM WebProfitReportConfirm WHERE IsActive=1')).recordset[0].n,4);
 assert.equal((await q('SELECT COUNT(*) n FROM WebProfitReportSnapshot')).recordset[0].n,3);
 assert.equal((await q("SELECT RevisionNo FROM WebProfitReportConfirm WHERE OrderYear='2025' AND IsActive=1")).recordset[0].RevisionNo,1);

 const snapshot=async()=>JSON.stringify((await q('SELECT * FROM ShipmentDetail ORDER BY SdetailKey; SELECT * FROM WebProfitReportConfirm ORDER BY ConfirmKey; SELECT * FROM WebProfitReportConfirmDetail ORDER BY ConfirmDetailKey; SELECT * FROM WebProfitReportSnapshot ORDER BY SnapKey')).recordsets);
 const stable=await snapshot();
 await q("ALTER TABLE WebProfitReportSnapshot ADD CONSTRAINT FixtureProfitCacheFail CHECK (CreatedBy <> N'fixture-fail')");
 const failureTx=new sql.Transaction(pool);await failureTx.begin();
 const fq=async(s,params={})=>{const req=new sql.Request(failureTx);for(const[k,p]of Object.entries(params))req.input(k,p.type,p.value);return req.query(s);};
 try{
 const f=await readIncomingApprovalProfit(fq,sql,scope,true);
 await fq('UPDATE ShipmentDetail SET OutQuantity=0,Amount=0,Vat=0 WHERE SdetailKey=2');
 const computed=await computeIncomingApprovalProfit({q:fq,types:sql,facts:f});
 assert.equal(computed.periods[0].payload.totals.C,0);
 await assert.rejects(()=>writeIncomingApprovalProfit({q:fq,types:sql,before:f,after:computed,actor:'fixture-fail',requestId:2,reason:'failure'}),/FixtureProfitCacheFail/);
 }finally{await failureTx.rollback().catch(()=>{});}
 assert.equal(await snapshot(),stable,'cache failure rolls back ERP quantity, confirmed revision and all details');

 }finally{await pool?.close();await master.request().query(`ALTER DATABASE [${name}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [${name}]`);await master.close();}
});



