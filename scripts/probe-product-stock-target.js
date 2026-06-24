const fs = require('fs');
const path = require('path');
fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8').split(/\r?\n/).forEach((line) => {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) process.env[m[1]] = m[2];
});
const sql = require('mssql');

(async () => {
  const pool = await sql.connect({
    server: process.env.DB_SERVER,
    port: 1433,
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    options: { encrypt: false, trustServerCertificate: true },
  });

  const pks = [889, 368, 1260, 1435];
  for (const pk of pks) {
    const r = await pool.request().input('pk', sql.Int, pk).query(`
      SELECT TOP 5 sm.OrderWeek, sm.OrderYearWeek, ps.Stock, ISNULL(sm.isFix,0) AS isFix, p.Stock AS live
        FROM ProductStock ps
        JOIN StockMaster sm ON sm.StockKey = ps.StockKey
        JOIN Product p ON p.ProdKey = ps.ProdKey
       WHERE ps.ProdKey = @pk
       ORDER BY sm.OrderYearWeek DESC`);
    console.log('pk', pk);
    r.recordset.forEach((x) => console.log(' ', x.OrderWeek, 'ps', x.Stock, 'live', x.live));
  }

  const hist = await pool.request().input('pk', sql.Int, 889).query(`
    SELECT TOP 20 sh.ChangeDtm, sh.ChangeType, sh.BeforeValue, sh.AfterValue, sh.OrderWeek
      FROM StockHistory sh WHERE sh.ProdKey = @pk ORDER BY sh.ChangeDtm DESC`);
  console.log('\nStockHistory pk=889');
  hist.recordset.forEach((h) => console.log(String(h.ChangeDtm).slice(0, 19), h.ChangeType, h.BeforeValue, '->', h.AfterValue, h.OrderWeek));

  await pool.close();
})().catch((e) => { console.error(e); process.exit(1); });
