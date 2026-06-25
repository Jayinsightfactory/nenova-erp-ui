#!/usr/bin/env node
/**
 * Product.Stock 음수 복구 — ProductStock(25-02 → 25-01) 스냅샷과 동기화
 *
 * 🚫 운영 --apply 금지 (2026-06-24 사고: 26-1 유령재고 +1,665)
 *    → docs/STOCK_INTEGRITY_DESIGN.md §2.3 복구 사다리 사용
 *
 * Usage: node scripts/repair-negative-product-stock.js 25-01          # dry-run only
 *        node scripts/repair-negative-product-stock.js 25-01 --apply # 🚫 DO NOT
 */
const fs = require('fs');
const path = require('path');
fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8').split(/\r?\n/).forEach((line) => {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) process.env[m[1]] = m[2];
});
const sql = require('mssql');

const APPLY = process.argv.includes('--apply');
const ALL_2026 = process.argv.includes('--all');
const YEAR = '2026';
const REF_WEEK = process.argv.find((a) => /^\d{2}-\d{2}$/.test(a)) || '25-01';
const FALLBACK_WEEKS = ['25-02', '25-01', '24-02', '24-01'];
const UID = 'nenovaSS3';

async function connect() {
  return sql.connect({
    server: process.env.DB_SERVER,
    port: parseInt(process.env.DB_PORT || '1433', 10),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    options: { encrypt: false, trustServerCertificate: true, requestTimeout: 300000 },
  });
}

async function loadTargets(pool) {
  const whereShipment = ALL_2026
    ? `EXISTS (
         SELECT 1 FROM ShipmentDetail sd
         JOIN ShipmentMaster sm ON sm.ShipmentKey=sd.ShipmentKey
         WHERE sd.ProdKey=p.ProdKey AND ISNULL(sm.OrderYear,@yr)=@yr AND sm.isDeleted=0
       )`
    : `EXISTS (
         SELECT 1 FROM ShipmentDetail sd
         JOIN ShipmentMaster sm ON sm.ShipmentKey=sd.ShipmentKey
         WHERE sd.ProdKey=p.ProdKey AND sm.OrderWeek=@wk AND sm.isDeleted=0 AND ISNULL(sd.OutQuantity,0)>0
       )`;
  const r = await pool.request()
    .input('wk', sql.NVarChar, REF_WEEK)
    .input('yr', sql.NVarChar, YEAR)
    .query(`
    SELECT p.ProdKey, p.ProdName, ISNULL(p.Stock,0) AS liveStock
      FROM Product p
     WHERE p.isDeleted=0 AND ISNULL(p.Stock,0) < 0
       AND ${whereShipment}
     ORDER BY p.Stock ASC`);
  const targets = [];
  for (const row of r.recordset) {
    let target = null;
    let sourceWeek = null;
    for (const wk of FALLBACK_WEEKS) {
      const ps = await pool.request()
        .input('pk', sql.Int, row.ProdKey)
        .input('yr', sql.NVarChar, YEAR)
        .input('wk', sql.NVarChar, wk)
        .query(`
          SELECT TOP 1 ps.Stock
            FROM ProductStock ps
            JOIN StockMaster sm ON sm.StockKey=ps.StockKey
           WHERE ps.ProdKey=@pk AND sm.OrderYear=@yr AND sm.OrderWeek=@wk
           ORDER BY ps.StockKey DESC`);
      if (ps.recordset[0] && ps.recordset[0].Stock != null) {
        target = Number(ps.recordset[0].Stock);
        sourceWeek = wk;
        break;
      }
    }
    if (target == null) target = 0;
    targets.push({
      prodKey: row.ProdKey,
      prodName: row.ProdName,
      liveStock: Number(row.liveStock),
      targetStock: target,
      sourceWeek: sourceWeek || '0',
      delta: target - Number(row.liveStock),
    });
  }
  return targets;
}

async function repairOne(pool, t) {
  const before = t.liveStock;
  const after = t.targetStock;
  await pool.request()
    .input('pk', sql.Int, t.prodKey)
    .input('before', sql.Float, before)
    .input('after', sql.Float, after)
    .input('uid', sql.NVarChar, UID)
    .input('yr', sql.NVarChar, YEAR)
    .input('wk', sql.NVarChar, t.sourceWeek || REF_WEEK)
    .input('descr', sql.NVarChar, `웹복구:Product.Stock→ProductStock(${t.sourceWeek}) 음수정리`)
    .query(`
      BEGIN TRANSACTION;
      INSERT INTO StockHistory
        (ChangeDtm, OrderYear, OrderWeek, ChangeID, ChangeType, ColumName,
         BeforeValue, AfterValue, Descr, ProdKey)
      VALUES (GETDATE(), @yr, @wk, @uid, N'재고조정', N'재고수량',
         @before, @after, @descr, @pk);
      UPDATE Product SET Stock = @after WHERE ProdKey = @pk;
      COMMIT;`);
}

async function main() {
  const pool = await connect();
  const targets = await loadTargets(pool);
  console.log(`Mode: ${APPLY ? 'APPLY' : 'DRY-RUN'} | refWeek=${REF_WEEK} | targets=${targets.length}\n`);
  for (const t of targets) {
    console.log(
      `pk=${t.prodKey} live=${t.liveStock} → target=${t.targetStock} (ps@${t.sourceWeek}) delta=${t.delta.toFixed(2)} | ${t.prodName}`,
    );
  }

  if (!APPLY) {
    console.log('\nDry-run only. --apply is blocked — see docs/STOCK_INTEGRITY_DESIGN.md');
    await pool.close();
    return;
  }

  console.error('\n🚫 BLOCKED: --apply is disabled for this script.');
  console.error('   2026-06-24 run caused phantom stock in 26-01. See docs/STOCK_INTEGRITY_DESIGN.md');
  await pool.close();
  process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
