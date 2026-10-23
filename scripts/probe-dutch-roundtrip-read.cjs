// Explicit SELECT-only compatibility baseline. Never prints credentials.
const fs = require('node:fs');
const sql = require('mssql');
async function main() {
  const env = require('node:util').parseEnv(fs.readFileSync('C:/Users/USER/nenova-erp-ui/.env.local','utf8'));
  const pool = await sql.connect({server:env.DB_SERVER,port:Number(env.DB_PORT||1433),database:env.DB_NAME,user:env.DB_USER,password:env.DB_PASSWORD,options:{encrypt:false,trustServerCertificate:true}});
  try {
    const result = await pool.request().query(`
      SELECT TOP 1 vs.OrderYear,vs.OrderWeek,vs.CustKey,vs.ProdKey,vs.OutQuantity,vs.DetailFix,
        sd.Amount,sd.Vat,
        (SELECT COUNT(*) FROM ShipmentDate d INNER JOIN PeriodDay pd ON pd.BaseYmd=d.ShipmentDtm
          AND pd.OrderYearWeek=vs.OrderYear+LEFT(vs.OrderWeek,2) WHERE d.SdetailKey=vs.SdetailKey) NativeDateJoins,
        (SELECT COUNT(*) FROM ShipmentFarm f WHERE f.SdetailKey=vs.SdetailKey) FarmRows
      FROM ViewShipment vs INNER JOIN ViewOrder vo ON vo.OrderYear=vs.OrderYear AND vo.OrderWeek=vs.OrderWeek
        AND vo.CustKey=vs.CustKey AND vo.ProdKey=vs.ProdKey
      INNER JOIN ShipmentDetail sd ON sd.SdetailKey=vs.SdetailKey
      WHERE vs.OrderYear='2026' AND vs.OrderWeek='43-02' AND vs.CustKey=533 AND vs.ProdKey=1487;
      SELECT COUNT(*) FixedRows,SUM(sd.Amount) Amount,SUM(sd.Vat) Vat
      FROM ShipmentDetail sd INNER JOIN ShipmentMaster sm ON sm.ShipmentKey=sd.ShipmentKey
      WHERE sm.OrderYear='2026' AND sm.OrderWeek='43-02' AND sd.isFix=1;
      SELECT vw.OrderYear,vw.OrderWeek,vw.ProdKey,p.OutUnit,SUM(ISNULL(vw.OutQuantity,0)) Incoming,
        (SELECT COUNT(*) FROM ViewOrder vo WHERE vo.OrderYear=vw.OrderYear
          AND vo.OrderWeek=vw.OrderWeek AND vo.ProdKey=vw.ProdKey) OrderRows
      FROM ViewWarehouse vw INNER JOIN Product p ON p.ProdKey=vw.ProdKey
      WHERE vw.OrderYear='2026' AND vw.OrderWeek='43-01' AND p.CounName=N'네덜란드'
      GROUP BY vw.OrderYear,vw.OrderWeek,vw.ProdKey,p.OutUnit
      HAVING NOT EXISTS(SELECT 1 FROM ViewOrder vo WHERE vo.OrderYear=vw.OrderYear
        AND vo.OrderWeek=vw.OrderWeek AND vo.ProdKey=vw.ProdKey);
    `);
    console.log(JSON.stringify(result.recordsets));
  } finally { await pool.close(); }
}
main().catch(()=>{ console.error('SELECT-only probe failed'); process.exitCode=1; });
