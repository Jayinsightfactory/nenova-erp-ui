// 17-2 MEL (China) / 18-1 (Ecuador) 입고 데이터 탐색
const fs = require('fs');
const path = require('path');
const envText = fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8');
envText.split(/\r?\n/).forEach(line => {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) process.env[m[1]] = m[2];
});
const sql = require('mssql');

const cfg = {
  server: process.env.DB_SERVER,
  port: parseInt(process.env.DB_PORT || '1433'),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  options: { encrypt: false, trustServerCertificate: true, enableArithAbort: true, connectTimeout: 30000, requestTimeout: 60000 },
};

(async () => {
  const pool = await sql.connect(cfg);
  console.log('# DB CONNECTED:', process.env.DB_NAME);

  // OrderYear / OrderWeek 분포
  console.log('\n## OrderYear/OrderWeek 분포 (최근)');
  const ywks = await pool.request().query(`
    SELECT TOP 30 OrderYear, OrderWeek, COUNT(*) cnt, MIN(InputDate) firstDate, MAX(InputDate) lastDate
    FROM WarehouseMaster WHERE isDeleted=0
    GROUP BY OrderYear, OrderWeek
    ORDER BY MAX(InputDate) DESC
  `);
  ywks.recordset.forEach(r => console.log(`  Yr=${r.OrderYear} Wk=${r.OrderWeek} cnt=${r.cnt} ${r.firstDate?.toISOString()?.slice(0,10)}~${r.lastDate?.toISOString()?.slice(0,10)}`));

  // FarmName 분포
  console.log('\n## FarmName 분포 (FREIGHT/MELODY/Ecuador 등)');
  const farms = await pool.request().query(`
    SELECT FarmName, COUNT(*) cnt
    FROM WarehouseMaster
    WHERE FarmName LIKE '%MELODY%' OR FarmName LIKE '%CHINA%' OR FarmName LIKE '%Ecuador%' OR FarmName LIKE '%ECUADOR%' OR FarmName LIKE '%FREIGHT%' OR FarmName LIKE '%FORWARD%'
    GROUP BY FarmName
    ORDER BY cnt DESC
  `);
  farms.recordset.forEach(r => console.log(`  Farm=${r.FarmName} (${r.cnt})`));

  // 17-2 MEL 후보
  console.log('\n## [17-2 MEL] OrderWeek=17 + Wk=2 조합 / 또는 FarmName MELODY');
  const mel = await pool.request().query(`
    SELECT TOP 30
      WarehouseKey, OrderNo, OrderYear, OrderWeek, FarmName, InvoiceNo,
      GrossWeight, ChargeableWeight, FreightRateUSD, DocFeeUSD, InputDate
    FROM WarehouseMaster
    WHERE FarmName LIKE '%MELODY%' AND isDeleted=0
    ORDER BY InputDate DESC
  `);
  console.log(`  hits: ${mel.recordset.length}`);
  mel.recordset.forEach(r => console.log(`  WK=${r.WarehouseKey} OrderNo=${r.OrderNo} Yr/Wk=${r.OrderYear}/${r.OrderWeek} Farm=${r.FarmName} Invoice=${r.InvoiceNo} GW=${r.GrossWeight} CW=${r.ChargeableWeight} Rate=${r.FreightRateUSD} Doc=${r.DocFeeUSD} ${r.InputDate?.toISOString()?.slice(0,10)}`));

  // 18-1 Ecuador
  console.log('\n## [18-1 Ecuador] FarmName Ecuador');
  const ecu = await pool.request().query(`
    SELECT TOP 30
      WarehouseKey, OrderNo, OrderYear, OrderWeek, FarmName, InvoiceNo,
      GrossWeight, ChargeableWeight, FreightRateUSD, DocFeeUSD, InputDate
    FROM WarehouseMaster
    WHERE (FarmName LIKE '%Ecuador%' OR FarmName LIKE '%ECUADOR%') AND isDeleted=0
    ORDER BY InputDate DESC
  `);
  console.log(`  hits: ${ecu.recordset.length}`);
  ecu.recordset.forEach(r => console.log(`  WK=${r.WarehouseKey} OrderNo=${r.OrderNo} Yr/Wk=${r.OrderYear}/${r.OrderWeek} Farm=${r.FarmName} Invoice=${r.InvoiceNo} GW=${r.GrossWeight} CW=${r.ChargeableWeight} Rate=${r.FreightRateUSD} Doc=${r.DocFeeUSD} ${r.InputDate?.toISOString()?.slice(0,10)}`));

  // Product 테이블 컬럼 확인
  console.log('\n## Product 컬럼:');
  const pcols = await pool.request().query(`
    SELECT COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='Product' ORDER BY ORDINAL_POSITION
  `);
  pcols.recordset.forEach(r => console.log(`  ${r.COLUMN_NAME} (${r.DATA_TYPE})`));

  // [MEL] 품목 검색 — Product 테이블에서
  console.log('\n## Product에서 [MEL] 접두사 검색');
  const prodMel = await pool.request().query(`
    SELECT TOP 10 ProdKey, ProductName, FlowerName, BoxWeight, BoxCBM, OutUnit, BunchOf1Box, SteamOf1Box, SteamOf1Bunch
    FROM Product WHERE ProductName LIKE '[[]MEL]%'
  `);
  console.log(`  hits: ${prodMel.recordset.length}`);
  prodMel.recordset.forEach(r => console.log(`  ${r.ProdKey} | ${r.ProductName} | Flower=${r.FlowerName} | BoxW=${r.BoxWeight} BoxCBM=${r.BoxCBM} OutUnit=${r.OutUnit} B1B=${r.BunchOf1Box} S1B=${r.SteamOf1Box} S1Bunch=${r.SteamOf1Bunch}`));

  console.log('\n## Product에서 Ecuador 시작 검색');
  const prodEcu = await pool.request().query(`
    SELECT TOP 10 ProdKey, ProductName, FlowerName, BoxWeight, BoxCBM, OutUnit, BunchOf1Box, SteamOf1Box, SteamOf1Bunch
    FROM Product WHERE ProductName LIKE 'Ecuador%'
  `);
  console.log(`  hits: ${prodEcu.recordset.length}`);
  prodEcu.recordset.forEach(r => console.log(`  ${r.ProdKey} | ${r.ProductName} | Flower=${r.FlowerName} | BoxW=${r.BoxWeight} BoxCBM=${r.BoxCBM} OutUnit=${r.OutUnit} B1B=${r.BunchOf1Box} S1B=${r.SteamOf1Box} S1Bunch=${r.SteamOf1Bunch}`));

  // FreightCost 테이블 확인
  console.log('\n## FreightCost 컬럼:');
  const fcols = await pool.request().query(`
    SELECT COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='FreightCost' ORDER BY ORDINAL_POSITION
  `);
  fcols.recordset.forEach(r => console.log(`  ${r.COLUMN_NAME} (${r.DATA_TYPE})`));

  console.log('\n## FreightCostDetail 컬럼:');
  const fdcols = await pool.request().query(`
    SELECT COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='FreightCostDetail' ORDER BY ORDINAL_POSITION
  `);
  fdcols.recordset.forEach(r => console.log(`  ${r.COLUMN_NAME} (${r.DATA_TYPE})`));

  await pool.close();
})().catch(e => { console.error('ERR:', e.message); process.exit(1); });
