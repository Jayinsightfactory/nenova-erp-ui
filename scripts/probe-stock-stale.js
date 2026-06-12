// stale ProductStock 스캔 — node scripts/probe-stock-stale.js [week] [year]
const fs = require('fs');
const path = require('path');
fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8').split(/\r?\n/).forEach(line => {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) process.env[m[1]] = m[2];
});
const sql = require('mssql');

const MANUAL_STOCK_CHANGE_FILTER =
  `(sh.ChangeType IS NULL OR sh.ChangeType NOT IN (N'확정', N'확정취소', N'입고', N'출고'))`;

function pad2(n) { return String(n).padStart(2, '0'); }

function shiftWeek(week, delta) {
  const m = String(week).match(/^(\d{2})-(\d{2})$/);
  if (!m) return week;
  let w = Number(m[1]);
  let s = Number(m[2]);
  const step = delta >= 0 ? 1 : -1;
  for (let i = 0; i < Math.abs(delta); i += 1) {
    s += step;
    if (s > 4) { s = 1; w += 1; }
    if (s < 1) { s = 4; w -= 1; }
  }
  return `${pad2(w)}-${pad2(s)}`;
}

function buildYws(year, week) {
  return `${year}${week.replace('-', '')}`;
}

async function scanWeek(pool, year, week) {
  const yws = buildYws(year, week);
  const result = await pool.request()
    .input('yws', sql.NVarChar, yws)
    .query(`
      SELECT TOP 2000
          p.ProdKey, p.CounName AS country, p.FlowerName AS flower, p.ProdName AS prodName,
          cur.Stock AS storedStock,
          prev.Stock AS prevStock,
          ISNULL(inc.q,0) AS incoming,
          ISNULL(o.q,0) AS confirmedOut,
          ISNULL(adj.q,0) AS stockAdjust,
          ISNULL(p.Stock,0) AS productStockLive
        FROM Product p
        OUTER APPLY (
          SELECT TOP 1 ps.Stock
            FROM ProductStock ps
            JOIN StockMaster sm ON sm.StockKey = ps.StockKey
           WHERE ps.ProdKey = p.ProdKey AND sm.OrderYearWeek = @yws
           ORDER BY ps.StockKey DESC
        ) cur
        OUTER APPLY (
          SELECT TOP 1 ps.Stock
            FROM ProductStock ps
            JOIN StockMaster sm ON sm.StockKey = ps.StockKey
           WHERE ps.ProdKey = p.ProdKey AND sm.OrderYearWeek < @yws
           ORDER BY sm.OrderYearWeek DESC, sm.OrderWeek DESC, ps.StockKey DESC
        ) prev
        OUTER APPLY (
          SELECT SUM(ISNULL(wd.OutQuantity,0)) AS q
            FROM WarehouseDetail wd
            JOIN WarehouseMaster wm ON wm.WarehouseKey = wd.WarehouseKey AND ISNULL(wm.isDeleted,0)=0
           WHERE wd.ProdKey = p.ProdKey
             AND (wm.OrderYear + REPLACE(wm.OrderWeek,'-','')) = @yws
        ) inc
        OUTER APPLY (
          SELECT SUM(ISNULL(sd.OutQuantity,0)) AS q
            FROM ShipmentDetail sd
            JOIN ShipmentMaster sm2 ON sm2.ShipmentKey = sd.ShipmentKey AND ISNULL(sm2.isDeleted,0)=0
           WHERE sd.ProdKey = p.ProdKey
             AND ISNULL(sd.isFix,0)=1
             AND (sm2.OrderYear + REPLACE(sm2.OrderWeek,'-','')) = @yws
        ) o
        OUTER APPLY (
          SELECT SUM(ISNULL(sh.AfterValue,0) - ISNULL(sh.BeforeValue,0)) AS q
            FROM StockHistory sh
           WHERE sh.ProdKey = p.ProdKey
             AND (sh.OrderYear + REPLACE(sh.OrderWeek,'-','')) = @yws
             AND ${MANUAL_STOCK_CHANGE_FILTER}
        ) adj
        WHERE ISNULL(p.isDeleted,0)=0
          AND cur.Stock IS NOT NULL
    `);

  const stale = [];
  for (const r of result.recordset) {
    const expected = Number(r.prevStock || 0) + Number(r.incoming || 0) - Number(r.confirmedOut || 0) + Number(r.stockAdjust || 0);
    const stored = Number(r.storedStock || 0);
    const diff = stored - expected;
    if (Math.abs(diff) >= 1) {
      stale.push({
        prodKey: r.ProdKey,
        prodName: r.prodName,
        country: r.country,
        flower: r.flower,
        stored,
        expected,
        diff,
        productStockLive: Number(r.productStockLive || 0),
        week,
        year,
      });
    }
  }
  stale.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));
  return stale;
}

(async () => {
  const year = String(process.argv[3] || new Date().getFullYear());
  const anchorWeek = process.argv[2] || '24-03';
  const weeks = [];
  let w = anchorWeek;
  for (let i = 0; i < 12; i += 1) {
    weeks.unshift(w);
    w = shiftWeek(w, -1);
  }

  const pool = await sql.connect({
    server: process.env.DB_SERVER,
    port: parseInt(process.env.DB_PORT || '1433', 10),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    options: { encrypt: false, trustServerCertificate: true, enableArithAbort: true, connectTimeout: 30000, requestTimeout: 120000 },
  });

  console.log(`=== stale ProductStock scan (${year}) weeks ${weeks[0]} ~ ${weeks[weeks.length - 1]} ===`);
  const all = [];
  for (const week of weeks) {
    const rows = await scanWeek(pool, year, week);
    console.log(`${week}: stale ${rows.length}`);
    rows.slice(0, 5).forEach(r => {
      console.log(`  pk=${r.prodKey} diff=${r.diff} stored=${r.stored} expected=${r.expected} live=${r.productStockLive} ${r.prodName}`);
    });
    all.push(...rows);
  }

  const byProd = new Map();
  for (const r of all) {
    const cur = byProd.get(r.prodKey);
    if (!cur || Math.abs(r.diff) > Math.abs(cur.diff)) byProd.set(r.prodKey, r);
  }
  const top = [...byProd.values()].sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff)).slice(0, 30);
  console.log('\n=== TOP stale products (max diff per prodKey) ===');
  for (const r of top) {
    console.log(`pk=${r.prodKey} week=${r.week} diff=${r.diff} stored=${r.stored} expected=${r.expected} live=${r.productStockLive} | ${r.country}/${r.flower} ${r.prodName}`);
  }

  await pool.close();
})().catch(e => { console.error(e); process.exit(1); });
