#!/usr/bin/env node
/** 업체별 출고요일(PeriodDay) 분포 — 요일 필터 시 엑셀 0건 여부 */
const fs = require('fs');
const path = require('path');
fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8').split(/\r?\n/).forEach((line) => {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) process.env[m[1]] = m[2];
});
const sql = require('mssql');
const WEEK = process.argv[2] || '25-02';
const CUST = process.argv[3] || '';

async function main() {
  const pool = await sql.connect({
    server: process.env.DB_SERVER,
    port: parseInt(process.env.DB_PORT || '1433', 10),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    options: { encrypt: false, trustServerCertificate: true, requestTimeout: 180000 },
  });

  const custWhere = CUST ? 'AND c.CustName LIKE @q' : '';
  const req = pool.request().input('wk', sql.NVarChar, WEEK);
  if (CUST) req.input('q', sql.NVarChar, `%${CUST}%`);

  const r = await req.query(`
    SELECT c.CustName, sm.ShipmentKey,
           pd.WeekDay, pd.BaseYmd,
           COUNT(*) AS rows,
           SUM(ISNULL(sdd.ShipmentQuantity,0)) AS qty,
           SUM(ISNULL(sdd.Amount,0)+ISNULL(sdd.Vat,0)) AS amt
      FROM ShipmentMaster sm
      JOIN Customer c ON c.CustKey = sm.CustKey
      JOIN ViewShipment vs ON vs.ShipmentKey = sm.ShipmentKey
      JOIN ViewOrder vo ON vs.OrderYearWeek2 = vo.OrderYearWeek2 AND vs.CustKey = vo.CustKey AND vs.ProdKey = vo.ProdKey
      JOIN ShipmentDate sdd ON sdd.SdetailKey = vs.SdetailKey
      JOIN PeriodDay pd ON sdd.ShipmentDtm = pd.BaseYmd
     WHERE sm.OrderWeek = @wk AND sm.isDeleted = 0
       AND ISNULL(vs.OutQuantity, 0) > 0
       ${custWhere}
     GROUP BY c.CustName, sm.ShipmentKey, pd.WeekDay, pd.BaseYmd
     ORDER BY c.CustName, pd.BaseYmd`);

  console.log(`=== ${WEEK} ${CUST || 'all'} by weekday ===\n`);
  let last = '';
  for (const x of r.recordset) {
    if (x.CustName !== last) {
      if (last) console.log('');
      console.log(`[${x.CustName}] sk=${x.ShipmentKey}`);
      last = x.CustName;
    }
    console.log(`  ${x.WeekDay} ${String(x.BaseYmd).slice(0, 10)} rows=${x.rows} qty=${x.qty} amt=${x.amt}`);
  }
  await pool.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
