import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {randomBytes,randomUUID} from 'node:crypto';
import {register} from 'node:module';
import sql from 'mssql';
import {computeIncomingApprovalProfit,approvalProfitPolicyHash,readIncomingApprovalProfit,writeIncomingApprovalProfit} from '../lib/incomingApprovalProfit.js';
import {saveInvoiceDraft} from '../lib/invoiceReceiptDocuments.js';
import {INVOICE_COST_FORMULAS,saveInvoiceCostRevision} from '../lib/invoiceReceiptCost.js';
import {withErpReadContext} from '../lib/erpReadContext.js';
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
 const q=async(s,params={})=>{const req=pool.request();for(const[k,p]of Object.entries(params))req.input(k,p.type,p.value);try{return await req.query(s);}catch(error){console.error("fixture SQL failure",s.slice(0,80),s.slice(-1200));throw error;}};

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
 // Actual approved invoice reader and calculator: cost-only revision, no receipt quantity edit.
 const transaction=async fn=>{const tx=new sql.Transaction(pool);await tx.begin();const ex=async(s,params={})=>{const req=new sql.Request(tx);for(const[k,p]of Object.entries(params))req.input(k,p.type,p.value);return req.query(s);};try{const value=await fn(ex);await tx.commit();return value;}catch(e){await tx.rollback().catch(()=>{});throw e;}};
 await q("INSERT Country(CounName) VALUES(N'중국'); INSERT Farm(FarmName,CounKey,isDeleted) VALUES(N'Invoice Farm',1,0); UPDATE Product SET CounName=N'중국',OutUnit=N'단',EstUnit=N'단',SteamOf1Bunch=10,SteamOf1Box=100,BunchOf1Box=10 WHERE ProdKey=1; INSERT WarehouseMaster(WarehouseKey,OrderYear,OrderWeek,FarmName,InvoiceNo,InputDate,isDeleted) VALUES(90,N'2026',N'41-01',N'Invoice Farm',N'INV-1','2026-10-08',0); INSERT WarehouseDetail(WarehouseKey,ProdKey,BoxQuantity,BunchQuantity,SteamQuantity,OutQuantity,EstQuantity,UPrice,TPrice,SteamOf1Box,SteamOf1Bunch) VALUES(90,1,10,100,1000,100,100,10,1000,100,10);");
 const documentId=randomUUID(),lineId=randomUUID(),operationId=randomUUID();
 const header=(await q("SELECT *,CONVERT(varchar(10),InputDate,23) InputDateISO FROM WarehouseMaster WHERE WarehouseKey=90")).recordset[0];
 const details=(await q('SELECT * FROM WarehouseDetail WHERE WarehouseKey=90')).recordset;
 await saveInvoiceDraft({withTransactionFn:transaction,types:sql,actor:'fixture',input:{documentId,orderYear:'2026',orderWeek:'41-01',farmKey:1,invoiceNo:'INV-1',invoiceYear:2026,sourceHash:'aa'.repeat(32),originalFileName:'profit-invoice.xlsx',rawMetadata:{},reviewedMetadata:{country:'CN',transportMode:'SEA',inputDate:'2026-10-08'},reason:'profit fixture',lines:[{lineId,lineNo:1,originalName:'invoice',prodKey:1,boxQuantity:10,bunchQuantity:100,stemQuantity:1000,priceUnit:'BUNCH',unitPrice:10,lineAmount:1000,currency:'CNY',reviewed:{},sourceEvidence:{}}]}});
 const linkedResult={receiptDigest:'bb'.repeat(32),receiptSnapshot:{header,details},linkMode:'EXISTING_CN',excludedDetailKeys:[],lineMappings:[{lineId,wdetailKey:details[0].WdetailKey,prodKey:1,unit:'단',outQuantity:100,boxQuantity:10,bunchQuantity:100,stemQuantity:1000,unitPrice:10,lineAmount:1000}]};
 await q("INSERT WebInvoiceOperation(OperationId,DocumentId,DocumentRevision,ReceiptPartId,RequestHash,Action,Status,WarehouseKey,ResultJson,Actor,CreatedAt,CompletedAt) VALUES(@op,@doc,1,@part,@hash,N'LINK_EXISTING_COST',N'COMMITTED',90,@result,N'fixture',SYSUTCDATETIME(),SYSUTCDATETIME()); UPDATE WebInvoiceDocument SET ReceiptStatus=N'COMMITTED' WHERE DocumentId=@doc",{op:{type:sql.UniqueIdentifier,value:operationId},doc:{type:sql.UniqueIdentifier,value:documentId},part:{type:sql.UniqueIdentifier,value:randomUUID()},hash:{type:sql.Binary(32),value:Buffer.alloc(32,1)},result:{type:sql.NVarChar(sql.MAX),value:JSON.stringify(linkedResult)}});
 const costInput={...INVOICE_COST_FORMULAS.CN_SEA_ACTUAL_V1,formulaApplicabilityConfirmed:true,formulaEffectiveDate:'2026-10-08',nativeCurrency:'CNY',freightCurrency:'CNY',exchangeRateKRW:200,exchangeRateType:'PURCHASE',exchangeRateDate:'2026-10-08',freightAmount:0,costSourceId:'profit-cost',allocationScope:'SINGLE_INVOICE',allocationShareNumerator:1,allocationShareDenominator:1,lineInputs:[{lineId,tariffRate:0,otherCostPerUnitKRW:0}]};
 const saveCost=input=>saveInvoiceCostRevision({withTransactionFn:transaction,types:sql,documentId,revision:1,actor:'fixture',input,reason:'cost only'});
 await saveCost(costInput);
 const {arrivalPriceEvidenceByProduct,carriedAcquisitionPriceEvidenceByProduct,profitInvoiceDependencies}=await import('../lib/profitReport.js');
 const readEvidence=()=>withErpReadContext({queryFn:q},()=>arrivalPriceEvidenceByProduct('2026','41-01'));
 const invoiceBefore=await readEvidence();assert.equal(invoiceBefore['1'].price,2000);
 await q("UPDATE ProductStock SET Stock=20 WHERE StockKey IN(SELECT StockKey FROM StockMaster WHERE OrderYear=N'2026' AND OrderWeek=N'41-01')");
 const invoiceFacts={policyHash:approvalProfitPolicyHash(),periods:[{orderYear:'2026',major:'41',confirm:null,confirmDetails:[],snapshot:null}]};
 const calcInvoice=async()=>{const externalEvidence={};for(let attempt=0;attempt<8;attempt++){try{return await computeIncomingApprovalProfit({q,types:sql,facts:invoiceFacts,externalEvidence});}catch(e){if(e.code!=='APPROVAL_EXTERNAL_EVIDENCE_REQUIRED')throw e;for(const key of e.evidenceKeys)externalEvidence[key]={available:false,rate:null,reason:'fixture_missing'};}}throw new Error('fixture evidence loop');};
 const costReportBefore=await calcInvoice();
 const depBefore=await withErpReadContext({queryFn:q},()=>profitInvoiceDependencies('2026','41'));
 await saveCost({...costInput,freightAmount:100});
 const invoiceAfter=await readEvidence();assert.equal(invoiceAfter['1'].price,2200);
 const costReportAfter=await calcInvoice();
 assert.equal(costReportBefore.periods[0].payload.rows.find(r=>r.category==='중국').auto.F,40000,'approved invoice values twenty remaining units');
 assert.equal(costReportAfter.periods[0].payload.rows.find(r=>r.category==='중국').auto.F,44000,'cost-only revision revalues remaining inventory in actual loader');
 assert.notEqual(costReportBefore.periods[0].sourceHash,costReportAfter.periods[0].sourceHash,'actual loader source hash includes cost-only approved revision');
 assert.notDeepEqual(costReportBefore.periods[0].payload.sourceDependencies,costReportAfter.periods[0].payload.sourceDependencies);
 assert.equal(costReportBefore.periods[0].payload.totals.C,costReportAfter.periods[0].payload.totals.C,'cost-only change preserves sales');
 const depAfter=await withErpReadContext({queryFn:q},()=>profitInvoiceDependencies('2026','41'));
 assert.notDeepEqual(depBefore,depAfter);
 const carry=await withErpReadContext({queryFn:q},()=>carriedAcquisitionPriceEvidenceByProduct('2026','48-01'));assert.equal(carry['1'].price,2200);
 await q("INSERT WebArrivalCostImport(OrderYear) VALUES(N'2026'); INSERT WebArrivalCostLine(ImportKey,OrderYear,OrderWeek,CountryName,ProdKey,FarmKey,Unit,Quantity,SelectedArrivalCostKRW,MatchStatus,SourceFileName,SheetName,SourceRow) VALUES(1,N'2026',N'41-01',N'중국',1,1,N'단',100,1000,N'MATCHED',N'legacy.xlsx',N'sheet',1); INSERT WebArrivalCostHistory(ArrivalLineKey,ImportKey,ActionType,ChangedBy) VALUES(1,1,N'MATCH',N'fixture')");
 assert.equal((await readEvidence())['1'].price,2200,'same-scope invoice replaces legacy Excel rather than averaging or adding');
 await q("INSERT WebArrivalCostLine(ImportKey,OrderYear,OrderWeek,CountryName,ProdKey,FarmKey,Unit,Quantity,SelectedArrivalCostKRW,MatchStatus,SourceFileName,SheetName,SourceRow) VALUES(1,N'2026',N'41-01',N'중국',1,2,N'단',100,3000,N'MATCHED',N'legacy.xlsx',N'sheet',2); INSERT WebArrivalCostHistory(ArrivalLineKey,ImportKey,ActionType,ChangedBy) VALUES(2,1,N'MATCH',N'fixture')");
 assert.equal((await readEvidence())['1'].price,2600,'other farm legacy evidence remains independently weighted');
 await q('DELETE WebArrivalCostHistory WHERE ArrivalLineKey=2; DELETE WebArrivalCostLine WHERE ArrivalLineKey=2');
 await q("INSERT WarehouseMaster(WarehouseKey,OrderYear,OrderWeek,FarmName,isDeleted) VALUES(91,N'2026',N'41-01',N'Unapproved Farm',0); INSERT WarehouseDetail(WarehouseKey,ProdKey,OutQuantity,EstQuantity,BunchQuantity) VALUES(91,1,50,50,50)");
 assert.equal((await readEvidence())['1'],undefined,'partial invoice coverage cannot value all same-week receipts');
 await q('DELETE WarehouseDetail WHERE WarehouseKey=91; DELETE WarehouseMaster WHERE WarehouseKey=91');
 await q('DROP TABLE WebArrivalCostHistory; DROP TABLE WebArrivalCostLine; DROP TABLE WebArrivalCostImport');
 assert.equal((await readEvidence())['1'].price,2200,'invoice-only schema still supplies approved evidence');


 }catch(error){console.error("profit fixture error",error.message,error.cause?.message);throw error;}finally{await pool?.close();await master.request().query(`ALTER DATABASE [${name}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [${name}]`);await master.close();}
});
