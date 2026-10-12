#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const envPath = fs.existsSync(path.join(__dirname, '..', '.env.local'))
  ? path.join(__dirname, '..', '.env.local')
  : 'C:\\Users\\USER\\nenova-erp-ui\\.env.local';
fs.readFileSync(envPath, 'utf8').split(/\r?\n/).forEach((line) => {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) process.env[m[1]] = m[2];
});
const sql = require('mssql');

async function main() {
  const pool = await sql.connect({
    server: process.env.DB_SERVER,
    port: parseInt(process.env.DB_PORT || '1433', 10),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    options: { encrypt: false, trustServerCertificate: true, requestTimeout: 120000 },
  });
  const q = async (title, text) => {
    const r = await pool.request().query(text);
    console.log(`\n===== ${title} =====`);
    console.log(JSON.stringify(r.recordset, null, 2));
  };

  await q('Mondial 1426 33-02/34-01/34-02', `
    SELECT sm.OrderWeek, CAST(ps.Stock AS decimal(18,2)) snap,
           CAST(p.Stock AS decimal(18,2)) live
      FROM StockMaster sm
      LEFT JOIN ProductStock ps ON ps.StockKey=sm.StockKey AND ps.ProdKey=1426
      CROSS JOIN Product p
     WHERE sm.OrderYear='2026' AND sm.OrderWeek IN ('33-01','33-02','34-01','34-02')
       AND p.ProdKey=1426
     ORDER BY sm.OrderWeek
  `);

  await q('Mondial 입고/출고', `
    SELECT 'WH' kind, OrderWeek, CAST(SUM(OutQuantity) AS decimal(18,2)) qty, NULL fix
      FROM ViewWarehouse WHERE OrderYear='2026' AND ProdKey=1426 AND OrderWeek IN ('33-01','33-02','34-01','34-02')
     GROUP BY OrderWeek
    UNION ALL
    SELECT 'SH', OrderWeek, CAST(SUM(OutQuantity) AS decimal(18,2)), CAST(MAX(CAST(ISNULL(DetailFix,0) AS int)) AS decimal(18,2))
      FROM ViewShipment WHERE OrderYear='2026' AND ProdKey=1426 AND OrderWeek IN ('33-01','33-02','34-01','34-02')
     GROUP BY OrderWeek
     ORDER BY kind, OrderWeek
  `);

  await q('34-01 스냅샷 합/음수/0 품목군', `
    SELECT ISNULL(p.CountryFlower,N'(없음)') grp,
           COUNT(*) rows,
           SUM(CASE WHEN ps.Stock < -0.001 THEN 1 ELSE 0 END) neg,
           SUM(CASE WHEN ABS(ps.Stock)<0.001 THEN 1 ELSE 0 END) zero,
           SUM(CASE WHEN ps.Stock > 0.001 THEN 1 ELSE 0 END) pos,
           CAST(SUM(ps.Stock) AS decimal(18,2)) snapSum
      FROM StockMaster sm
      JOIN ProductStock ps ON ps.StockKey=sm.StockKey
      JOIN Product p ON p.ProdKey=ps.ProdKey AND ISNULL(p.isDeleted,0)=0
     WHERE sm.OrderYear='2026' AND sm.OrderWeek='34-01'
     GROUP BY ISNULL(p.CountryFlower,N'(없음)')
     HAVING SUM(CASE WHEN ps.Stock < -0.001 THEN 1 ELSE 0 END)>0
         OR SUM(ps.Stock) <> 0
     ORDER BY snapSum
  `);

  await q('34-01 장미 스냅샷 vs 미확정출고', `
    SELECT p.ProdKey, p.ProdName,
           CAST(ps.Stock AS decimal(18,2)) snap,
           CAST(ISNULL(u.qty,0) AS decimal(18,2)) unfixOut,
           CAST(ps.Stock-ISNULL(u.qty,0) AS decimal(18,2)) screenRemain
      FROM StockMaster sm
      JOIN ProductStock ps ON ps.StockKey=sm.StockKey
      JOIN Product p ON p.ProdKey=ps.ProdKey
      LEFT JOIN (
        SELECT vs.ProdKey, SUM(vs.OutQuantity) qty
          FROM ViewShipment vs
         WHERE vs.OrderYear='2026' AND vs.OrderWeek='34-01' AND ISNULL(vs.DetailFix,0)=0
         GROUP BY vs.ProdKey
      ) u ON u.ProdKey=p.ProdKey
     WHERE sm.OrderYear='2026' AND sm.OrderWeek='34-01'
       AND p.CountryFlower=N'콜롬비아장미'
       AND (ps.Stock < 0 OR ps.Stock-ISNULL(u.qty,0) < 0 OR ISNULL(u.qty,0)>0)
     ORDER BY screenRemain
  `);

  await q('live 음수 합', `
    SELECT ISNULL(CountryFlower,N'(없음)') grp, COUNT(*) cnt, CAST(SUM(Stock) AS decimal(18,2)) liveSum
      FROM Product WHERE ISNULL(isDeleted,0)=0 AND Stock<0
     GROUP BY ISNULL(CountryFlower,N'(없음)')
     ORDER BY liveSum
  `);

  await q('34-01 입고 품목군', `
    SELECT ISNULL(p.CountryFlower,N'(없음)') grp, COUNT(*) rows, CAST(SUM(vw.OutQuantity) AS decimal(18,2)) qty
      FROM ViewWarehouse vw JOIN Product p ON p.ProdKey=vw.ProdKey
     WHERE vw.OrderYear='2026' AND vw.OrderWeek='34-01'
     GROUP BY ISNULL(p.CountryFlower,N'(없음)')
     ORDER BY qty DESC
  `);

  await pool.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
