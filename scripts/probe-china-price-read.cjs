// Read-only native compatibility evidence; never prints credentials or names.
const fs = require('node:fs');
const sql = require('mssql');
async function main() {
  const env = require('node:util').parseEnv(fs.readFileSync('C:/Users/USER/nenova-erp-ui/.env.local', 'utf8'));
  const pool = await sql.connect({ server: env.DB_SERVER, port: Number(env.DB_PORT || 1433), database: env.DB_NAME, user: env.DB_USER, password: env.DB_PASSWORD, options: { encrypt: false, trustServerCertificate: true } });
  try {
    const result = await pool.request().query(`
      SELECT TOP 1 v.OrderYear,v.OrderWeek,v.CustKey,v.ProdKey,v.SdetailKey,v.OutQuantity,v.EstQuantity,v.Cost,v.Amount,v.Vat,v.DetailFix,
        (SELECT COUNT(*) FROM ViewOrder o WHERE o.OrderYear=v.OrderYear AND o.OrderWeek=v.OrderWeek AND o.CustKey=v.CustKey AND o.ProdKey=v.ProdKey) OrderRows,
        (SELECT SUM(d.ShipmentQuantity) FROM ShipmentDate d WHERE d.SdetailKey=v.SdetailKey) DateQty,
        (SELECT COUNT(*) FROM ShipmentFarm f WHERE f.SdetailKey=v.SdetailKey) FarmRows
      FROM ViewShipment v WHERE v.OrderYear='2026' AND v.CounName=N'중국' ORDER BY v.OrderWeek DESC;
    `);
    console.log(JSON.stringify(result.recordset));
    const row = result.recordset[0];
    if (row) {
      const downstream = await pool.request().input('year', sql.NVarChar(4), row.OrderYear).input('week', sql.NVarChar(10), row.OrderWeek)
        .input('ck', sql.Int, row.CustKey).input('pk', sql.Int, row.ProdKey).input('dk', sql.Int, row.SdetailKey).query(`
          SELECT COUNT(*) InGetDetail FROM ViewShipment v JOIN ViewOrder o
            ON o.OrderYear=v.OrderYear AND o.OrderWeek=v.OrderWeek AND o.CustKey=v.CustKey AND o.ProdKey=v.ProdKey
            JOIN ShipmentDate d ON d.SdetailKey=v.SdetailKey JOIN PeriodDay pd ON pd.BaseYmd=d.ShipmentDtm AND pd.OrderYearWeek=v.OrderYear+LEFT(v.OrderWeek,2)
            WHERE v.OrderYear=@year AND v.OrderWeek=@week AND v.CustKey=@ck AND v.ProdKey=@pk AND v.DetailFix=1;
          SELECT OrderYear,COUNT(*) Rows,SUM(Amount) Amount,SUM(Vat) Vat FROM ViewShipment
            WHERE OrderYear IN (@year,CONVERT(nvarchar(4),CONVERT(int,@year)-1)) AND OrderWeek=@week AND CustKey=@ck AND ProdKey=@pk AND DetailFix=1 GROUP BY OrderYear;
          SELECT Cost,EstQuantity,Amount,Vat FROM ShipmentDate WHERE SdetailKey=@dk;
        `);
      console.log(JSON.stringify(downstream.recordsets));
    }
  } finally { await pool.close(); }
}
main().catch(() => { console.error('SELECT-only China price probe failed'); process.exitCode = 1; });
