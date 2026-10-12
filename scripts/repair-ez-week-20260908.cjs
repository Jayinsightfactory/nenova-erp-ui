// One-off, user-authorized receipt rekey. Default is read-only; no fix/unfix or stock SP.
const sql=require('mssql');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const apply=process.argv.includes('--apply');
const scope=`SELECT DISTINCT ProdKey FROM WarehouseDetail WHERE WarehouseKey=7211`;
async function snapshot(q){return (await q(`
SELECT * FROM WarehouseMaster WITH(HOLDLOCK) WHERE WarehouseKey IN (7211,7212) ORDER BY WarehouseKey;
SELECT * FROM WarehouseDetail WITH(HOLDLOCK) WHERE WarehouseKey IN (7211,7212) ORDER BY WarehouseKey,WdetailKey;
SELECT * FROM StockHistory WITH(HOLDLOCK) WHERE StockHistoryKey BETWEEN 462164 AND 462173 ORDER BY StockHistoryKey;
SELECT ProdKey,Stock FROM Product WITH(HOLDLOCK) WHERE ProdKey IN (${scope}) ORDER BY ProdKey;
SELECT * FROM StockMaster WITH(HOLDLOCK) ORDER BY StockKey;
SELECT * FROM ProductStock WITH(HOLDLOCK) WHERE ProdKey IN (${scope}) ORDER BY StockKey,ProdKey;
SELECT * FROM ViewOrder WHERE OrderYear IN ('2025','2026') AND OrderWeek IN ('07-09','37-01') AND ProdKey IN (${scope}) ORDER BY OrderYear,OrderWeek,ProdKey;
SELECT * FROM ViewShipment WHERE OrderYear IN ('2025','2026') AND OrderWeek IN ('07-09','37-01') AND ProdKey IN (${scope}) ORDER BY OrderYear,OrderWeek,ShipmentKey,SdetailKey;
`)).recordsets;}
(async()=>{
 const p=await sql.connect({server:process.env.DB_SERVER,port:Number(process.env.DB_PORT||1433),database:process.env.DB_NAME,user:process.env.DB_USER,password:process.env.DB_PASSWORD,options:{encrypt:false,trustServerCertificate:true},requestTimeout:30000,connectionTimeout:10000});
 const tx=new sql.Transaction(p);let began=false;
 try {
  await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);began=true;
  const q=text=>new sql.Request(tx).query(text);
  await q('SET LOCK_TIMEOUT 10000; SET XACT_ABORT ON;');
  const before=await snapshot(q);
  const wm=before[0].find(r=>r.WarehouseKey===7211);
  assert(wm && wm.OrderYear==='2026' && wm.OrderWeek==='07-09' && wm.FarmName==='EZ Flower' && wm.InvoiceNo==='PROFORMA' && !wm.isDeleted,'Target changed');
  assert.equal(before[1].length,11);assert(before[1].every(r=>r.WarehouseKey===7211));
  assert.equal(before[2].length,10);assert(before[2].every(r=>r.OrderYear==='2026'&&r.OrderWeek==='07-09'&&r.ChangeID==='nenovaIC2'&&r.ChangeType==='입고'&&r.Descr==='파킹리스트 업로드'));
  for(const h of before[2]){const sum=before[1].filter(d=>d.ProdKey===h.ProdKey).reduce((s,d)=>s+d.OutQuantity,0);assert(Math.abs(h.AfterValue-h.BeforeValue-sum)<0.00001,'History quantity mismatch');}
  const checks=(await q(`
SELECT COUNT(*) n FROM WarehouseMaster WITH(UPDLOCK,HOLDLOCK) WHERE OrderYear='2026' AND OrderWeek='37-01' AND FarmName='EZ Flower' AND isDeleted=0;
SELECT COUNT(*) n FROM StockMaster WHERE OrderYear='2026' AND OrderWeek='07-09';
SELECT COUNT(*) n FROM FreightCost WHERE WarehouseKey IN (7211,7212);
SELECT COUNT(*) n FROM sys.triggers WHERE parent_id IN (OBJECT_ID('WarehouseMaster'),OBJECT_ID('StockHistory')) AND is_disabled=0;
SELECT COUNT(*) n FROM ViewShipment WHERE OrderYear='2026' AND OrderWeek='37-01' AND DetailFix=1 AND ProdKey IN (${scope});
`)).recordsets;
  assert(checks.every(rs=>rs[0].n===0),'Concurrent target/fixed receipt/dependency/trigger requires review');
  assert.equal(before[7].length,0,'Related shipment scope is no longer empty');
  if(!apply){await tx.rollback();began=false;console.log(JSON.stringify({dryRun:true,warehouseKey:7211,detailRows:11,historyRows:10,from:'2026/07-09',to:'2026/37-01',stockRowsPreserved:before[5].length}));return;}
  const backup=path.resolve('scripts/ez-week-20260908-before.json');
  fs.writeFileSync(backup,JSON.stringify(before,null,2),{flag:'wx'});
  const result=await q(`UPDATE WarehouseMaster SET OrderWeek='37-01' WHERE WarehouseKey=7211 AND OrderYear='2026' AND OrderWeek='07-09' AND FarmName='EZ Flower' AND InvoiceNo='PROFORMA' AND isDeleted=0;
UPDATE StockHistory SET OrderWeek='37-01' WHERE StockHistoryKey BETWEEN 462164 AND 462173 AND OrderYear='2026' AND OrderWeek='07-09' AND ChangeID='nenovaIC2' AND ChangeType=N'입고' AND Descr=N'파킹리스트 업로드';`);
  assert.deepEqual(result.rowsAffected,[1,10]);
  const after=await snapshot(q);
  const normalized=JSON.parse(JSON.stringify(after));
  normalized[0].find(r=>r.WarehouseKey===7211).OrderWeek='07-09';normalized[2].forEach(r=>r.OrderWeek='07-09');
  assert.deepEqual(normalized,JSON.parse(JSON.stringify(before)),'Unexpected side effect');
  const view=(await q("SELECT OrderYear,OrderWeek,COUNT(*) n,SUM(TPrice) amount FROM ViewWarehouse WHERE WarehouseKey=7211 GROUP BY OrderYear,OrderWeek")).recordset;
  assert.equal(view.length,1);assert.equal(view[0].OrderYear,'2026');assert.equal(view[0].OrderWeek,'37-01');assert.equal(view[0].n,11);
  const audit=new sql.Request(tx);audit.input('payload',sql.NVarChar(sql.MAX),JSON.stringify({warehouseKey:7211,from:'07-09',to:'37-01',year:'2026',historyKeys:before[2].map(h=>h.StockHistoryKey),userRequest:'EZ Flower wrong upload week correction; preserve stock and fix states',backupFile:path.basename(backup)}));
  await audit.query("INSERT INTO SystemActionLog(ActionDtm,Actor,ActionType,Method,Endpoint,AffectedTable,AffectedCount,Payload,Result,ResultDesc,RiskLevel) VALUES(GETDATE(),N'Codex:user-request',N'WAREHOUSE_WEEK_REPAIR','SQL',N'one-off/ez-week-20260908',N'WarehouseMaster,StockHistory',11,@payload,'SUCCESS',N'2026 EZ Flower 7211: 07-09 -> 37-01; stock/fix/quantity/price preserved','HIGH')");
  await tx.commit();began=false;
  console.log(JSON.stringify({committed:true,warehouseRows:1,historyRows:10,view,stockAndFixUnchanged:true,backup}));
 }finally{if(began)await tx.rollback().catch(()=>{});await p.close();}
})().catch(e=>{console.error(e.code||e.name,e.message);if(e instanceof ReferenceError)console.error(e.stack);process.exitCode=1});
