// Read-only local evidence; never prints credentials or personal data.
const sql = require('mssql');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const filename = path.resolve(__dirname, '../lib/stockAdjustmentReportNotes.js');
const helper = new Module(filename, module);
helper._compile(require('next/dist/build/swc').transformSync(fs.readFileSync(filename, 'utf8'), { filename, jsc: { target: 'es2022' }, module: { type: 'commonjs' } }).code, filename);
(async () => {
  const pool = await sql.connect({ server: process.env.DB_SERVER, port: Number(process.env.DB_PORT || 1433), database: process.env.DB_NAME, user: process.env.DB_USER, password: process.env.DB_PASSWORD, options: { encrypt: false, trustServerCertificate: true } });
  try {
    for (const statement of [
      "SELECT OrderYear,OrderWeek,GW,CW FROM WebColombiaWeekly WHERE OrderYear IN ('2025','2026') AND OrderWeek='31-01'",
      "SELECT COUNT(*) eventCount, SUM(TRY_CONVERT(float,AfterValue)-TRY_CONVERT(float,BeforeValue)) net FROM StockHistory sh WHERE OrderYear='2026' AND OrderWeek LIKE '31-%' AND EXISTS(SELECT 1 FROM CodeInfo ci WHERE ci.Category=N'StockType' AND ci.Descr=sh.ChangeType)",
      "SELECT GrossWeight,ChargeableWeight FROM WarehouseMaster WHERE OrderYear='2026' AND OrderWeek='31-01' AND isDeleted=0 AND (GrossWeight>0 OR ChargeableWeight>0)",
    ]) console.log(JSON.stringify((await pool.request().query(statement)).recordset));
    const history = await pool.request().input('year', sql.NVarChar, '2026').input('major', sql.NVarChar, '31').input('prefix', sql.NVarChar, '31-%').query(helper.exports.STOCK_ADJUSTMENT_NOTES_SQL);
    console.log(JSON.stringify({ actualSqlEvents: history.recordset.length, exactValuationEvents: history.recordset.filter(row => row.valuationUnitPrice != null).length }));
  } finally { await pool.close(); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
