// Connection-local temporary fixtures only. No operational table writes.
const fs=require('node:fs'),assert=require('node:assert/strict'),sql=require('mssql');
async function main(){
 const file=process.argv.find(a=>a.startsWith('--env-file='))?.slice(11)||'.env.local';
 const env=require('node:util').parseEnv(fs.readFileSync(file,'utf8'));
 const pool=await sql.connect({server:env.DB_SERVER,port:Number(env.DB_PORT||1433),database:env.DB_NAME,user:env.DB_USER,password:env.DB_PASSWORD,options:{encrypt:false,trustServerCertificate:true},pool:{max:1,min:0}});
 try{
 const {SHIPMENT_EXPORT_SQL,shipmentExportLines}=await import('../lib/shipmentExportExcel.js');
 const fixture=SHIPMENT_EXPORT_SQL.replace(/\bViewShipment\b/g,'#ExportView').replace(/\bShipmentDate\b/g,'#ExportDates').replace(/\bPeriodDay\b/g,'#ExportCalendar').replace(/\bProduct\b/g,'#ExportProduct');
 const result=await pool.request().input('year',sql.NVarChar,'2025').input('week',sql.NVarChar,'46-01').input('major',sql.NVarChar,'202546').input('custKey',sql.Int,null).query(`
 CREATE TABLE #ExportView(OrderYear nvarchar(4),OrderWeek nvarchar(5),CustKey int,CustName nvarchar(50),SdetailKey int,ProdKey int,ProdName nvarchar(50),FlowerName nvarchar(20),CountryFlower nvarchar(50),OutQuantity decimal(18,3));
 CREATE TABLE #ExportDates(SdateKey int,SdetailKey int,ShipmentQuantity decimal(18,3),ShipmentDtm datetime);
 CREATE TABLE #ExportCalendar(OrderYearWeek nvarchar(6),BaseYmd datetime);
 CREATE TABLE #ExportProduct(ProdKey int,OutUnit nvarchar(10));
 INSERT #ExportView VALUES('2025','46-01',1,N'연습',1,1,N'연습품목',N'수국',N'미국 수국',1),('2026','46-01',1,N'연습',2,1,N'연습품목',N'수국',N'미국 수국',9),('2025','46-02',1,N'연습',3,1,N'연습품목',N'수국',N'미국 수국',8),('2025','46-01',2,N'연습2',4,1,N'연습품목',N'수국',N'미국 수국',2),('2025','46-01',1,N'연습',5,1,N'영수량',N'수국',N'미국 수국',0);
 INSERT #ExportProduct VALUES(1,N'박스');
 INSERT #ExportDates VALUES(1,1,.4,'20251115'),(2,1,.6,'20251116'),(3,2,9,'20261114');
 INSERT #ExportCalendar VALUES('202546','20251115'),('202546','20251116'),('202646','20261114');
 ${fixture};
 SET @year=N'2026';SET @major=N'202646';${fixture};
 SET @year=N'2025';SET @major=N'202546';SET @custKey=1;${fixture};
 `);
 const [prior,current,customer]=result.recordsets;
 assert.equal(prior.length,3);assert.equal(current.length,1);assert.equal(customer.length,2);
 assert.equal(shipmentExportLines(prior,{orderYear:'2025',orderWeek:'46-01',custKey:null}).reduce((s,r)=>s+r.qty,0),3);
 assert.equal(shipmentExportLines(current,{orderYear:'2026',orderWeek:'46-01',custKey:null})[0].qty,9);
 assert.equal(shipmentExportLines(customer,{orderYear:'2025',orderWeek:'46-01',custKey:1}).reduce((s,r)=>s+r.qty,0),1);
 console.log('PASS actual MSSQL shared export SQL: explicit2025/2026 same46-01 isolated; other subweek/customer/zero excluded; weekend .4+.6 preserved; date-less once. Operational writes0.');
 }finally{await pool.close();}
}main().catch(()=>{console.error('Temporary export SQL fixture failed (no operational row payloads logged).');process.exitCode=1});
