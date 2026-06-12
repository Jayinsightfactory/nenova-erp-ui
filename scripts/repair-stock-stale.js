// ProductStock vs 계산값 + Product.Stock gap — node scripts/repair-stock-stale.js [--apply]
const fs = require('fs');
const path = require('path');
fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8').split(/\r?\n/).forEach(line => {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) process.env[m[1]] = m[2];
});
const sql = require('mssql');

const APPLY = process.argv.includes('--apply');
const MANUAL_STOCK_CHANGE_FILTER =
  `(sh.ChangeType IS NULL OR sh.ChangeType NOT IN (N'확정', N'확정취소', N'입고', N'출고'))`;

function pad2(n) { return String(n).padStart(2, '0'); }
function shiftWeek(week, delta) {
  const m = String(week).match(/^(\d{2})-(\d{2})$/);
  if (!m) return week;
  let w = Number(m[1]); let s = Number(m[2]);
  const step = delta >= 0 ? 1 : -1;
  for (let i = 0; i < Math.abs(delta); i += 1) {
    s += step;
    if (s > 4) { s = 1; w += 1; }
    if (s < 1) { s = 4; w -= 1; }
  }
  return `${pad2(w)}-${pad2(s)}`;
}
function buildYws(year, week) { return `${year}${week.replace('-', '')}`; }

async function scanWeek(pool, year, week) {
  const yws = buildYws(year, week);
  const result = await pool.request().input('yws', sql.NVarChar, yws).query(`
    SELECT p.ProdKey, p.ProdName, p.CounName, p.FlowerName,
           cur.Stock AS storedStock, prev.Stock AS prevStock,
           ISNULL(inc.q,0) AS incoming, ISNULL(o.q,0) AS confirmedOut, ISNULL(adj.q,0) AS stockAdjust,
           ISNULL(p.Stock,0) AS productStockLive
      FROM Product p
      OUTER APPLY (SELECT TOP 1 ps.Stock FROM ProductStock ps JOIN StockMaster sm ON sm.StockKey=ps.StockKey
        WHERE ps.ProdKey=p.ProdKey AND sm.OrderYearWeek=@yws ORDER BY ps.StockKey DESC) cur
      OUTER APPLY (SELECT TOP 1 ps.Stock FROM ProductStock ps JOIN StockMaster sm ON sm.StockKey=ps.StockKey
        WHERE ps.ProdKey=p.ProdKey AND sm.OrderYearWeek<@yws ORDER BY sm.OrderYearWeek DESC, sm.OrderWeek DESC, ps.StockKey DESC) prev
      OUTER APPLY (SELECT SUM(ISNULL(wd.OutQuantity,0)) q FROM WarehouseDetail wd JOIN WarehouseMaster wm ON wm.WarehouseKey=wd.WarehouseKey AND ISNULL(wm.isDeleted,0)=0
        WHERE wd.ProdKey=p.ProdKey AND (wm.OrderYear+REPLACE(wm.OrderWeek,'-',''))=@yws) inc
      OUTER APPLY (SELECT SUM(ISNULL(sd.OutQuantity,0)) q FROM ShipmentDetail sd JOIN ShipmentMaster sm2 ON sm2.ShipmentKey=sd.ShipmentKey AND ISNULL(sm2.isDeleted,0)=0
        WHERE sd.ProdKey=p.ProdKey AND ISNULL(sd.isFix,0)=1 AND (sm2.OrderYear+REPLACE(sm2.OrderWeek,'-',''))=@yws) o
      OUTER APPLY (SELECT SUM(ISNULL(sh.AfterValue,0)-ISNULL(sh.BeforeValue,0)) q FROM StockHistory sh
        WHERE sh.ProdKey=p.ProdKey AND (sh.OrderYear+REPLACE(sh.OrderWeek,'-',''))=@yws AND ${MANUAL_STOCK_CHANGE_FILTER}) adj
      WHERE ISNULL(p.isDeleted,0)=0 AND cur.Stock IS NOT NULL`);
  const stale = [];
  for (const r of result.recordset) {
    const expected = Number(r.prevStock||0)+Number(r.incoming||0)-Number(r.confirmedOut||0)+Number(r.stockAdjust||0);
    const stored = Number(r.storedStock||0);
    const diff = stored - expected;
    if (Math.abs(diff) >= 1) stale.push({ prodKey:r.ProdKey, prodName:r.ProdName, country:r.CounName, flower:r.FlowerName, week, year, stored, expected, diff, live:Number(r.productStockLive||0) });
  }
  return stale;
}

async function runSp(pool, year, week, prodKey, uid='admin') {
  const r = await pool.request()
    .input('year', sql.NVarChar, year)
    .input('week', sql.NVarChar, week)
    .input('pk', sql.Int, prodKey)
    .input('uid', sql.NVarChar, uid)
    .query(`DECLARE @r INT, @m NVARCHAR(MAX);
      EXEC dbo.usp_StockCalculation @OrderYear=@year, @OrderWeek=@week, @ProdKey=@pk, @iUserID=@uid, @oResult=@r OUTPUT, @oMessage=@m OUTPUT;
      SELECT ISNULL(@r,0) AS result, @m AS message;`);
  return r.recordset[0] || { result: 0, message: '' };
}

(async () => {
  const year = '2026';
  const fromWeek = process.argv.find(a => /^\d{2}-\d{2}$/.test(a)) || '19-01';
  const toWeek = process.argv.find((a, i, arr) => /^\d{2}-\d{2}$/.test(a) && arr.indexOf(a) !== arr.findIndex(x => /^\d{2}-\d{2}$/.test(x))) || '24-04';

  const weeks = [];
  let w = fromWeek;
  for (let guard = 0; guard < 80 && w <= toWeek; guard += 1) {
    weeks.push(w);
    const next = shiftWeek(w, 1);
    if (next === w) break;
    w = next;
    if (w === toWeek) { weeks.push(w); break; }
  }
  if (!weeks.includes(toWeek)) weeks.push(toWeek);

  const pool = await sql.connect({
    server: process.env.DB_SERVER, port: parseInt(process.env.DB_PORT||'1433',10),
    database: process.env.DB_NAME, user: process.env.DB_USER, password: process.env.DB_PASSWORD,
    options: { encrypt:false, trustServerCertificate:true, enableArithAbort:true, connectTimeout:30000, requestTimeout:180000 },
  });

  console.log(`Mode: ${APPLY ? 'APPLY (repair)' : 'DRY-RUN (scan only)'}`);
  console.log(`Range: ${fromWeek} ~ ${toWeek} (${weeks.length} weeks)`);

  const earliestByProd = new Map();
  for (const week of weeks) {
    const rows = await scanWeek(pool, year, week);
    if (rows.length) console.log(`${week}: stale ${rows.length}`);
    for (const r of rows) {
      const prev = earliestByProd.get(r.prodKey);
      if (!prev || r.week < prev.week) earliestByProd.set(r.prodKey, r);
    }
  }

  const targets = [...earliestByProd.values()].sort((a,b)=>a.week.localeCompare(b.week) || Math.abs(b.diff)-Math.abs(a.diff));
  console.log(`\nRepair targets (earliest stale week per prodKey): ${targets.length}`);
  targets.slice(0, 20).forEach(t => console.log(`  ${t.week} pk=${t.prodKey} diff=${t.diff} stored=${t.stored}→${t.expected} live=${t.live} ${t.prodName}`));

  if (!APPLY) {
    console.log('\nRun with --apply to execute usp_StockCalculation');
    await pool.close();
    return;
  }

  let ok = 0; let fail = 0;
  for (const t of targets) {
    process.stdout.write(`Repair pk=${t.prodKey} from ${t.week}... `);
    const sp = await runSp(pool, year, t.week, t.prodKey);
    if (Number(sp.result||0) === 0) { ok += 1; console.log('OK'); }
    else { fail += 1; console.log(`FAIL result=${sp.result} ${sp.message||''}`); }
    await new Promise(r => setTimeout(r, 120));
  }

  console.log(`\nDone: ok=${ok} fail=${fail}`);
  console.log('\nRe-scan boundary week 22-01:');
  const after = await scanWeek(pool, year, '22-01');
  console.log(`stale remaining: ${after.length}`);
  after.slice(0, 10).forEach(r => console.log(`  pk=${r.prodKey} diff=${r.diff} ${r.prodName}`));

  await pool.close();
})().catch(e => { console.error(e); process.exit(1); });
