// Read-only schema/calendar/provenance evidence. Never imports application DDL helpers.
import fs from 'node:fs';
import sql from 'mssql';
for (const line of fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const match = line.match(/^([^#=]+)=(.*)$/);
  if (match) process.env[match[1].trim()] = match[2].trim().replace(/^(['"])(.*)\1$/, '$2');
}
const pool = await sql.connect({
  server: process.env.DB_SERVER, port: Number(process.env.DB_PORT || 1433),
  database: process.env.DB_NAME, user: process.env.DB_USER, password: process.env.DB_PASSWORD,
  connectionTimeout: 10000, requestTimeout: 20000,
  options: { encrypt: false, trustServerCertificate: true },
});
try {
  const probes = {
    schema: `SELECT TABLE_NAME,COLUMN_NAME,DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_NAME IN ('ShipmentFarm','WarehouseMaster','WarehouseDetail','PeriodDay','ShipmentHistory')
      ORDER BY TABLE_NAME,ORDINAL_POSITION`,
    customer: `SELECT CustKey,CustName FROM Customer WHERE CustName LIKE N'%주광%' AND ISNULL(isDeleted,0)=0`,
    calendar: `SELECT TOP 22 * FROM PeriodDay WHERE BaseYmd >= '2026-09-10' AND BaseYmd < '2026-10-02' ORDER BY BaseYmd`,
    shipments: `SELECT sm.OrderYear,sm.OrderWeek,sm.CustKey,COUNT(*) AS DetailCount,
      MIN(sd.isFix) AS MinFixed,MAX(sd.isFix) AS MaxFixed
      FROM ShipmentMaster sm JOIN ShipmentDetail sd ON sd.ShipmentKey=sm.ShipmentKey
      JOIN Customer c ON c.CustKey=sm.CustKey
      WHERE sm.OrderYear=2026 AND LEFT(sm.OrderWeek,2) IN ('37','38','39')
      AND c.CustName LIKE N'%주광%' AND ISNULL(sm.isDeleted,0)=0
      GROUP BY sm.OrderYear,sm.OrderWeek,sm.CustKey ORDER BY sm.OrderWeek`,
  };
  for (const [name, statement] of Object.entries(probes)) {
    const result = await pool.request().query(statement);
    console.log(JSON.stringify({ name, rows: result.recordset }));
  }
} finally { await pool.close(); }
