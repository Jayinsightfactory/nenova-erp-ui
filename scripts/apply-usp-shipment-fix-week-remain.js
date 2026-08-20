#!/usr/bin/env node
/**
 * Apply docs/migrations/2026-08-20_usp_shipment_fix_week_remain_check.sql
 * to the live Nenova MSSQL. Dry-run unless --apply is passed.
 */
const fs = require('fs');
const path = require('path');

const envPath = fs.existsSync(path.join(__dirname, '..', '.env.local'))
  ? path.join(__dirname, '..', '.env.local')
  : 'C:\\Users\\USER\\nenova-erp-ui\\.env.local';
fs.readFileSync(envPath, 'utf8').split(/\r?\n/).forEach((line) => {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) process.env[m[1]] = m[2];
});
const sql = require(fs.existsSync(path.join(__dirname, '..', 'node_modules', 'mssql'))
  ? 'mssql'
  : 'C:/Users/USER/nenova-erp-ui/node_modules/mssql');

const ALTER_SQL_PATH = path.join(
  __dirname,
  '..',
  'docs',
  'migrations',
  '2026-08-20_usp_shipment_fix_week_remain_check.sql',
);

function remainProbeSql(year, week, countryFlower) {
  return `
    DECLARE @OrderYear nvarchar(20) = N'${year}';
    DECLARE @OrderWeek nvarchar(20) = N'${week}';
    DECLARE @CountryFlower nvarchar(100) = N'${countryFlower}';
    DECLARE @OrderYearWeek nvarchar(20) = @OrderYear + REPLACE(@OrderWeek, '-', '');
    DECLARE @BeforeStockKey INT;
    SELECT TOP 1 @BeforeStockKey = StockKey
      FROM StockMaster WHERE OrderYearWeek < @OrderYearWeek
     ORDER BY OrderYearWeek DESC, OrderWeek DESC;

    SELECT vs.ProdKey, SUM(vs.OutQuantity) OutQuantity
    INTO #sl FROM ViewShipment vs
    WHERE vs.OrderYear=@OrderYear AND vs.OrderWeek=@OrderWeek
      AND vs.CountryFlower=@CountryFlower AND ISNULL(vs.DetailFix,0)=0
    GROUP BY vs.ProdKey;

    SELECT
      N'${year} ${week} ${countryFlower}' AS scope,
      SUM(CASE WHEN ROUND(ISNULL(ns.Stock,0)-ISNULL(s.OutQuantity,0),0)<0 THEN 1 ELSE 0 END) oldNeg,
      SUM(CASE WHEN ROUND(ISNULL(prev.Stock,0)+ISNULL(wr.qty,0)-ISNULL(cf.qty,0)+ISNULL(adj.qty,0)-ISNULL(s.OutQuantity,0),0)<0 THEN 1 ELSE 0 END) newNeg,
      COUNT(*) shipped
    FROM #sl s
    LEFT JOIN (SELECT ps.ProdKey, ps.Stock FROM StockMaster sm JOIN ProductStock ps ON sm.StockKey=ps.StockKey WHERE sm.OrderYearWeek=@OrderYearWeek) ns ON ns.ProdKey=s.ProdKey
    LEFT JOIN (SELECT ps.ProdKey, ISNULL(ps.Stock,0) Stock FROM StockMaster sm JOIN ProductStock ps ON sm.StockKey=ps.StockKey WHERE sm.StockKey=@BeforeStockKey) prev ON prev.ProdKey=s.ProdKey
    LEFT JOIN (SELECT ProdKey, ROUND(SUM(OutQuantity),2) qty FROM ViewWarehouse WHERE OrderYear=@OrderYear AND OrderWeek=@OrderWeek GROUP BY ProdKey) wr ON wr.ProdKey=s.ProdKey
    LEFT JOIN (SELECT ProdKey, ROUND(SUM(OutQuantity),2) qty FROM ViewShipment WHERE OrderYear=@OrderYear AND OrderWeek=@OrderWeek AND DetailFix=1 GROUP BY ProdKey) cf ON cf.ProdKey=s.ProdKey
    LEFT JOIN (SELECT sh.ProdKey, ROUND(SUM(sh.AfterValue-sh.BeforeValue),2) qty FROM StockHistory sh JOIN CodeInfo ci ON ci.Category=N'StockType' AND sh.ChangeType=ci.Descr WHERE sh.OrderYear=@OrderYear AND sh.OrderWeek=@OrderWeek GROUP BY sh.ProdKey) adj ON adj.ProdKey=s.ProdKey;

    DROP TABLE #sl;
  `;
}

async function main() {
  const apply = process.argv.includes('--apply');
  const pool = await sql.connect({
    server: process.env.DB_SERVER,
    port: parseInt(process.env.DB_PORT || '1433', 10),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    options: { encrypt: false, trustServerCertificate: true, requestTimeout: 120000 },
  });

  const def = await pool.request().query(`
    SELECT LEN(OBJECT_DEFINITION(OBJECT_ID(N'dbo.usp_ShipmentFix'))) AS defLen,
           CASE WHEN OBJECT_DEFINITION(OBJECT_ID(N'dbo.usp_ShipmentFix')) LIKE N'%leftover = 직전 StockMaster%' THEN 1 ELSE 0 END AS patched,
           CASE WHEN OBJECT_DEFINITION(OBJECT_ID(N'dbo.usp_ShipmentFix')) LIKE N'%WITH stock%' THEN 1 ELSE 0 END AS hasOldCte
  `);
  console.log('definition', def.recordset[0]);

  for (const [year, week, cf] of [
    ['2026', '33-01', '콜롬비아카네이션'],
    ['2026', '33-02', '콜롬비아카네이션'],
  ]) {
    const r = await pool.request().query(remainProbeSql(year, week, cf));
    console.log(JSON.stringify(r.recordset[0], null, 2));
  }

  if (!apply) {
    console.log('dry-run only. pass --apply to ALTER dbo.usp_ShipmentFix');
    await pool.close();
    return;
  }

  if (def.recordset[0].patched) {
    console.log('already patched; skip ALTER');
    await pool.close();
    return;
  }

  const alterSql = fs.readFileSync(ALTER_SQL_PATH, 'utf8');
  if (!alterSql.includes('ALTER PROCEDURE') || !alterSql.includes('@BeforeStockKey')) {
    throw new Error('ALTER SQL file is missing expected markers');
  }
  await pool.request().batch(alterSql);

  const after = await pool.request().query(`
    SELECT LEN(OBJECT_DEFINITION(OBJECT_ID(N'dbo.usp_ShipmentFix'))) AS defLen,
           CASE WHEN OBJECT_DEFINITION(OBJECT_ID(N'dbo.usp_ShipmentFix')) LIKE N'%leftover = 직전 StockMaster%' THEN 1 ELSE 0 END AS patched,
           CASE WHEN OBJECT_DEFINITION(OBJECT_ID(N'dbo.usp_ShipmentFix')) LIKE N'%WITH stock%' THEN 1 ELSE 0 END AS hasOldCte,
           CASE WHEN OBJECT_DEFINITION(OBJECT_ID(N'dbo.usp_ShipmentFix')) LIKE N'%제품 잔량이 마이너스인 출고 정보가 존재합니다.%' THEN 1 ELSE 0 END AS keepsMessage
  `);
  console.log('after ALTER', after.recordset[0]);
  if (!after.recordset[0].patched || after.recordset[0].hasOldCte || !after.recordset[0].keepsMessage) {
    throw new Error('usp_ShipmentFix definition did not match expected post-ALTER markers');
  }
  await pool.close();
  console.log('usp_ShipmentFix remain check patched');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
