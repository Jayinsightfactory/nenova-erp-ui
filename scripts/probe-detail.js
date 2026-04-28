// 17-2 MEL (WK=5580, AWB=78468955552) / 18-1 Ecuador (WK=5592, AWB=00645341133) 디테일 조회
const fs = require('fs');
const path = require('path');
const envText = fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8');
envText.split(/\r?\n/).forEach(line => {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) process.env[m[1]] = m[2];
});
const sql = require('mssql');
const cfg = {
  server: process.env.DB_SERVER, port: parseInt(process.env.DB_PORT || '1433'),
  database: process.env.DB_NAME, user: process.env.DB_USER, password: process.env.DB_PASSWORD,
  options: { encrypt: false, trustServerCertificate: true, enableArithAbort: true, connectTimeout: 30000, requestTimeout: 60000 },
};

async function dumpAwb(pool, label, awbNorm) {
  console.log(`\n${'='.repeat(100)}\n# ${label} — AWB normalized=${awbNorm}\n${'='.repeat(100)}`);

  // AWB로 묶인 WarehouseMaster 행 (OrderNo 정규화: '-' 제거)
  const masters = await pool.request().query(`
    SELECT WarehouseKey, OrderNo, OrderYear, OrderWeek, FarmName, InvoiceNo,
           GrossWeight, ChargeableWeight, FreightRateUSD, DocFeeUSD, InputDate
    FROM WarehouseMaster
    WHERE REPLACE(OrderNo, '-', '') = '${awbNorm}' AND isDeleted=0
    ORDER BY InputDate
  `);
  console.log(`\n## [Master rows for AWB=${awbNorm}] (${masters.recordset.length}건)`);
  masters.recordset.forEach(r => console.log(`  WK=${r.WarehouseKey} OrderNo=${r.OrderNo} Yr/Wk=${r.OrderYear}/${r.OrderWeek} Farm=${r.FarmName} Invoice=${r.InvoiceNo} GW=${r.GrossWeight} CW=${r.ChargeableWeight} Rate=${r.FreightRateUSD} Doc=${r.DocFeeUSD}`));

  if (masters.recordset.length === 0) return;
  const wkList = masters.recordset.map(r => r.WarehouseKey).join(',');

  // WarehouseDetail + Product 조인
  console.log(`\n## [Detail rows] (WK in [${wkList}])`);
  const dets = await pool.request().query(`
    SELECT wd.WdetailKey, wd.WarehouseKey, wd.ProdKey, wd.OrderCode,
           wd.BoxQuantity, wd.BunchQuantity, wd.SteamQuantity, wd.OutQuantity, wd.EstQuantity,
           wd.UPrice, wd.TPrice,
           p.ProdName, p.ProdGroup, p.FlowerName, p.CounName, p.CountryFlower,
           p.BoxWeight, p.BoxCBM, p.TariffRate, p.OutUnit, p.BunchOf1Box, p.SteamOf1Box, p.SteamOf1Bunch
    FROM WarehouseDetail wd
    LEFT JOIN Product p ON wd.ProdKey=p.ProdKey
    WHERE wd.WarehouseKey IN (${wkList})
    ORDER BY wd.WarehouseKey, wd.WdetailKey
  `);
  console.log(`  ${dets.recordset.length}건`);
  dets.recordset.forEach(r => {
    const isFW = /freight|forward/i.test(r.ProdName || '') || /weig[h]?t[h]?/i.test(r.ProdName || '');
    const tag = isFW ? ' [FW/WEIGHT]' : '';
    console.log(`  WK=${r.WarehouseKey} ProdKey=${r.ProdKey}${tag} | ${r.ProdName} | Group=${r.ProdGroup} Flower=${r.FlowerName} Country=${r.CounName}/${r.CountryFlower} | Box=${r.BoxQuantity} Bunch=${r.BunchQuantity} Steam=${r.SteamQuantity} Out=${r.OutQuantity} | UPrice=${r.UPrice} TPrice=${r.TPrice} | BoxW=${r.BoxWeight} CBM=${r.BoxCBM} Tariff=${r.TariffRate} OutUnit=${r.OutUnit} B1B=${r.BunchOf1Box} S1B=${r.SteamOf1Box}`);
  });

  // 같은 OrderYear/OrderWeek 의 추가 농장행 — 같은 차수에 다른 농장이 있나?
  const m0 = masters.recordset[0];
  console.log(`\n## [같은 차수 ${m0.OrderYear}/${m0.OrderWeek} 의 다른 Farm/AWB] (위 외)`);
  const others = await pool.request().query(`
    SELECT WarehouseKey, OrderNo, FarmName, InvoiceNo, GrossWeight, ChargeableWeight, FreightRateUSD
    FROM WarehouseMaster
    WHERE OrderYear='${m0.OrderYear}' AND OrderWeek='${m0.OrderWeek}'
      AND REPLACE(OrderNo,'-','') != '${awbNorm}' AND isDeleted=0
    ORDER BY FarmName, InputDate
  `);
  console.log(`  ${others.recordset.length}건`);
  others.recordset.forEach(r => console.log(`  WK=${r.WarehouseKey} OrderNo=${r.OrderNo} Farm=${r.FarmName} Invoice=${r.InvoiceNo} GW=${r.GrossWeight} CW=${r.ChargeableWeight} Rate=${r.FreightRateUSD}`));
}

(async () => {
  const pool = await sql.connect(cfg);
  console.log('# DB CONNECTED:', process.env.DB_NAME);

  // 17-2 MEL
  await dumpAwb(pool, '17-2 MEL (Yunnan Melody)', '78468955552');
  // 18-1 Ecuador
  await dumpAwb(pool, '18-1 Ecuador (Freightwise Ecuador)', '00645341133');

  // CurrencyMaster 환율
  console.log('\n## CurrencyMaster (USD/CNY 등 환율)');
  const cur = await pool.request().query(`SELECT * FROM CurrencyMaster`);
  cur.recordset.forEach(r => console.log(`  ${JSON.stringify(r)}`));

  // WarehouseMaster 의 FreightRateUSD/GW/CW가 NULL 비율
  console.log('\n## WarehouseMaster GW/CW/Rate NULL 비율');
  const nulls = await pool.request().query(`
    SELECT
      COUNT(*) total,
      SUM(CASE WHEN GrossWeight IS NULL THEN 1 ELSE 0 END) gwNull,
      SUM(CASE WHEN ChargeableWeight IS NULL THEN 1 ELSE 0 END) cwNull,
      SUM(CASE WHEN FreightRateUSD IS NULL THEN 1 ELSE 0 END) rateNull,
      SUM(CASE WHEN DocFeeUSD IS NULL THEN 1 ELSE 0 END) docNull
    FROM WarehouseMaster WHERE isDeleted=0
  `);
  console.log(`  ${JSON.stringify(nulls.recordset[0])}`);

  // FreightCost 17-2/18-1 차수 저장본이 있는지
  console.log('\n## FreightCost 17-2 / 18-1 저장본 검색');
  const fc = await pool.request().query(`
    SELECT TOP 20 * FROM FreightCost
    WHERE BillKey IS NOT NULL OR AWB IS NOT NULL
    ORDER BY ISNULL(LastUpdateDtm, CreateDtm) DESC
  `).catch(e => ({ recordset: [], _err: e.message }));
  if (fc._err) console.log(`  (오류: ${fc._err})`);
  else fc.recordset.forEach(r => console.log(`  ${JSON.stringify(r).slice(0, 300)}`));

  await pool.close();
})().catch(e => { console.error('ERR:', e.message); process.exit(1); });
