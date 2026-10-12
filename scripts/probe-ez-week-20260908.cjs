const sql = require('mssql');
(async () => {
  const pool = await sql.connect({server:process.env.DB_SERVER, port:Number(process.env.DB_PORT||1433), database:process.env.DB_NAME, user:process.env.DB_USER, password:process.env.DB_PASSWORD, options:{encrypt:false,trustServerCertificate:true},connectionTimeout:10000,requestTimeout:30000});
  try {
    const result = await pool.request().query(`
SELECT COUNT(*) freightRows FROM FreightCost WHERE WarehouseKey IN (7211,7212);
SELECT WarehouseKey,OrderYear,OrderWeek,FarmName,isDeleted FROM WarehouseMaster WHERE WarehouseKey IN (7211,7212) ORDER BY WarehouseKey;
SELECT OrderYear,OrderWeek,COUNT(*) detailRows,SUM(TPrice) amount FROM ViewWarehouse WHERE WarehouseKey=7211 GROUP BY OrderYear,OrderWeek;
SELECT OrderYear,OrderWeek,COUNT(*) historyRows FROM StockHistory WHERE StockHistoryKey BETWEEN 462164 AND 462173 GROUP BY OrderYear,OrderWeek;
SELECT COUNT(*) auditRows FROM SystemActionLog WHERE Endpoint=N'one-off/ez-week-20260908' AND Result='SUCCESS';
SELECT COUNT(*) tempRows FROM TempWarehouseDetail WHERE WarehouseKey IN (7211,7212);
SELECT Category,Descr FROM CodeInfo WHERE Category='StockType';
SELECT OrderYear,OrderWeek,COUNT(*) rows FROM ViewShipment WHERE OrderYear='2026' AND OrderWeek IN ('07-09','37-01') AND ProdKey IN (3355,2829,2565,3354,3356,3357,3353) GROUP BY OrderYear,OrderWeek;
SELECT COUNT(*) fixedDestination FROM ViewShipment WHERE OrderYear='2026' AND OrderWeek='37-01' AND DetailFix=1 AND ProdKey IN (3355,2829,2565,3354,3356,3357,3353);
SELECT COLUMN_NAME,COLUMNPROPERTY(OBJECT_ID('SystemActionLog'),COLUMN_NAME,'IsIdentity') isIdentity,CHARACTER_MAXIMUM_LENGTH FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='SystemActionLog';
SELECT TOP 4 sm.OrderYear,sm.OrderWeek,sm.StockKey FROM StockMaster sm WHERE sm.OrderYear='2026' ORDER BY sm.OrderYearWeek DESC;
`);
    console.log(JSON.stringify(result.recordsets));
  } finally { await pool.close(); }
})().catch(e=>{console.error(e.code||e.name, String(e.message).replace(/password\s*[=:]\s*\S+/ig,'password=[redacted]'));process.exitCode=1});
