// SELECT-only aggregate evidence; never print names, credentials or row payloads.
const fs=require('node:fs'),sql=require('mssql');
async function main(){
 const env=require('node:util').parseEnv(fs.readFileSync('C:/Users/USER/nenova-erp-ui/.env.local','utf8'));
 const pool=await sql.connect({server:env.DB_SERVER,port:Number(env.DB_PORT||1433),database:env.DB_NAME,user:env.DB_USER,password:env.DB_PASSWORD,connectionTimeout:30000,requestTimeout:120000,options:{encrypt:false,trustServerCertificate:true},pool:{max:1,min:0}});
 console.error('SELECT-only connection ready');
 try{
 const r=await pool.request().query(`
 SELECT sm.OrderYear,sm.OrderWeek,COUNT(*) Details,SUM(sd.OutQuantity) Quantity,
 SUM(CASE WHEN sd.CustKey IS NULL THEN 1 ELSE 0 END) NativeNullCustomer,
 SUM(CASE WHEN sd.Cost IS NULL THEN 1 ELSE 0 END) MissingCost,
 SUM(CASE WHEN sd.isFix=1 THEN 1 ELSE 0 END) FixedDetails
 FROM ShipmentMaster sm JOIN ShipmentDetail sd ON sd.ShipmentKey=sm.ShipmentKey
 JOIN Product p ON p.ProdKey=sd.ProdKey AND p.isDeleted=0
 JOIN Customer c ON c.CustKey=sm.CustKey AND c.isDeleted=0
 WHERE sm.OrderYear IN ('2025','2026') AND sm.OrderWeek LIKE '45-%' AND sm.isDeleted=0 AND sd.OutQuantity>0
 GROUP BY sm.OrderYear,sm.OrderWeek ORDER BY sm.OrderYear,sm.OrderWeek;
 SELECT OrderYearWeek,WeekDay,CONVERT(varchar(10),BaseYmd,120) Date FROM PeriodDay WHERE OrderYearWeek IN ('202545','202645') ORDER BY OrderYearWeek,BaseYmd;
 SELECT sm.OrderYear,COUNT(DISTINCT sd.SdetailKey) Details,COUNT(DISTINCT sf.FarmKey) Farms,COUNT(DISTINCT CONVERT(varchar(23),dt.ShipmentDtm,121)) Dates,
 SUM(CASE WHEN sd.isFix=1 THEN sd.Amount ELSE 0 END) FixedAmount,SUM(CASE WHEN sd.isFix=1 THEN sd.Vat ELSE 0 END) FixedVat
 FROM ShipmentMaster sm JOIN ShipmentDetail sd ON sd.ShipmentKey=sm.ShipmentKey
 LEFT JOIN ShipmentDate dt ON dt.SdetailKey=sd.SdetailKey LEFT JOIN ShipmentFarm sf ON sf.SdetailKey=sd.SdetailKey
 WHERE sm.OrderYear IN ('2025','2026') AND sm.OrderWeek LIKE '45-%' AND sm.isDeleted=0 GROUP BY sm.OrderYear;
 SELECT 'ViewOrder' ObjectName,OrderYear,COUNT(*) RowsCount FROM ViewOrder WHERE OrderYear IN ('2025','2026') AND OrderWeek LIKE '45-%' GROUP BY OrderYear
 UNION ALL SELECT 'ViewShipment',OrderYear,COUNT(*) FROM ViewShipment WHERE OrderYear IN ('2025','2026') AND OrderWeek LIKE '45-%' GROUP BY OrderYear;
 SELECT v.OrderYear,COUNT(*) FixedRows,SUM(v.Amount) FixedAmount,SUM(v.Vat) FixedVat
 FROM ViewShipment v WHERE v.OrderYear IN ('2025','2026') AND v.OrderWeek LIKE '45-%' AND v.DetailFix=1 GROUP BY v.OrderYear;
 SELECT v.OrderYear,COUNT(*) InGetDetail FROM ViewShipment v WHERE v.OrderYear IN ('2025','2026') AND v.OrderWeek LIKE '45-%' AND v.DetailFix=1
 AND EXISTS(SELECT 1 FROM ViewOrder o WHERE o.OrderYear=v.OrderYear AND o.OrderWeek=v.OrderWeek AND o.CustKey=v.CustKey AND o.ProdKey=v.ProdKey)
 AND EXISTS(SELECT 1 FROM ShipmentDate d JOIN PeriodDay p ON CONVERT(datetime,p.BaseYmd,121)=d.ShipmentDtm WHERE d.SdetailKey=v.SdetailKey AND p.OrderYearWeek=v.OrderYear+LEFT(v.OrderWeek,2)) GROUP BY v.OrderYear;
 SELECT sm.OrderYear,COUNT(*) EstimateRows FROM Estimate e JOIN ShipmentMaster sm ON sm.ShipmentKey=e.ShipmentKey WHERE sm.OrderYear IN ('2025','2026') AND sm.OrderWeek LIKE '45-%' GROUP BY sm.OrderYear;
 SELECT OrderYear,COUNT(*) ProfitRows FROM WebProfitReport WHERE OrderYear IN ('2025','2026') AND MajorWeek='45' GROUP BY OrderYear;
 `);
 console.log(JSON.stringify(r.recordsets,null,2));
 const vm=require('node:vm');const source=fs.readFileSync('lib/shipmentStatementService.js','utf8').replace(/^import .*;\r?\n/gm,'').replace(/export (const|async function)/g,'$1')+'\nmodule.exports={loadStatementSource,listStatementCustomers};';
 const query=async(statement,params={})=>{if(!/^\s*SELECT/.test(statement))throw Error('SELECT_ONLY');const request=pool.request();for(const [k,p] of Object.entries(params))request.input(k,p.type,p.value);return request.query(statement);};
 const box={module:{exports:{}},core:require('../lib/shipmentStatement.cjs'),sql,query,createHash:require('crypto').createHash};vm.runInNewContext(source,box);
 for(const year of ['2025','2026']){const customers=await box.module.exports.listStatementCustomers({year,week:45});const first=customers[0];const data=await box.module.exports.loadStatementSource({year,week:45,custKey:first.CustKey});console.log(JSON.stringify({year,customerCount:customers.length,sampleRows:data.rows.length,subweeks:[...new Set(data.rows.flatMap(r=>r.sources.map(x=>x.week)))],calendar:data.calendar.map(d=>d.date),defaultDay:data.customer.baseDay}));}
 }finally{await pool.close();}
}
main().catch(e=>{console.error(e.code||'READ_ONLY_PROBE_FAILED');process.exitCode=1;});
