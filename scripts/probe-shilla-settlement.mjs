/**
 * 신라호텔 정산 대조 프로브 — 달력월 vs 차수, 출고일별 금액, 차감
 * node scripts/probe-shilla-settlement.mjs [year] [month]
 */
import sql from 'mssql';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(__dirname, '..', '.env.local');
for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

const year = parseInt(process.argv[2] || '2026', 10);
const month = parseInt(process.argv[3] || '6', 10);
const monthPad = String(month).padStart(2, '0');
const dateFrom = `${year}-${monthPad}-01`;
const lastDay = new Date(year, month, 0).getDate();
const dateTo = `${year}-${monthPad}-${String(lastDay).padStart(2, '0')}`;

const config = {
  server: process.env.DB_SERVER,
  port: parseInt(process.env.DB_PORT || '1433', 10),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  options: { encrypt: false, trustServerCertificate: true },
};

const pool = await sql.connect(config);

const custRes = await pool.request().query(`
  SELECT CustKey, CustName, OrderCode, ISNULL(BaseOutDay,0) AS BaseOutDay, ISNULL(Descr,N'') AS Descr
  FROM Customer
  WHERE (CustName LIKE N'%신라호텔%' OR CustName = N'신라호텔')
    AND ISNULL(isDeleted,0)=0
  ORDER BY CASE WHEN CustName = N'신라호텔' THEN 0 ELSE 1 END
`);
const cust = custRes.recordset[0];
if (!cust) { console.error('신라호텔 없음'); process.exit(1); }
const ck = cust.CustKey;
console.log('거래처:', cust.CustName, 'CustKey=', ck, 'BaseOutDay=', cust.BaseOutDay);

// ── 1) 달력월 기준 — ShipmentDate 출고일별 (견적 byDate와 동일 축)
const byCalendar = await pool.request()
  .input('ck', sql.Int, ck)
  .input('df', sql.Date, dateFrom)
  .input('dt', sql.Date, dateTo)
  .query(`
    SELECT
      CONVERT(date, sdd.ShipmentDtm) AS outDate,
      sm.OrderWeek,
      p.FlowerName,
      p.ProdName,
      p.OutUnit,
      p.EstUnit,
      ISNULL(p.SteamOf1Box,0) AS SteamOf1Box,
      SUM(sdd.ShipmentQuantity) AS outQty,
      AVG(sd.Cost) AS avgCost,
      SUM(ISNULL(sd.Cost,0) * sdd.ShipmentQuantity) AS supplyAmt,
      SUM(ISNULL(sd.Vat,0) * sdd.ShipmentQuantity / NULLIF(
        CASE WHEN sd.BunchQuantity>0 THEN sd.BunchQuantity
             WHEN sd.SteamQuantity>0 THEN sd.SteamQuantity
             ELSE sd.BoxQuantity END, 0)) AS vatAmt
    FROM ShipmentMaster sm
    JOIN ShipmentDetail sd ON sd.ShipmentKey = sm.ShipmentKey AND sd.isFix=1
    JOIN ShipmentDate sdd ON sdd.SdetailKey = sd.SdetailKey
    JOIN Product p ON p.ProdKey = sd.ProdKey
    WHERE sm.CustKey=@ck AND sm.isDeleted=0 AND sm.isFix=1
      AND CONVERT(date, sdd.ShipmentDtm) >= @df AND CONVERT(date, sdd.ShipmentDtm) <= @dt
    GROUP BY CONVERT(date, sdd.ShipmentDtm), sm.OrderWeek, p.FlowerName, p.ProdName, p.OutUnit, p.EstUnit, p.SteamOf1Box
    ORDER BY outDate, p.FlowerName, p.ProdName
  `);

// Simpler amount from DB stored Amount prorated by date qty ratio
const byCalendarAmt = await pool.request()
  .input('ck', sql.Int, ck)
  .input('df', sql.Date, dateFrom)
  .input('dt', sql.Date, dateTo)
  .query(`
    SELECT
      CONVERT(date, sdd.ShipmentDtm) AS outDate,
      sm.OrderWeek,
      SUM(sdd.ShipmentQuantity) AS outQty,
      SUM(
        ISNULL(sd.Amount,0) * sdd.ShipmentQuantity / NULLIF(
          CASE WHEN sd.BunchQuantity>0 THEN sd.BunchQuantity
               WHEN sd.SteamQuantity>0 THEN sd.SteamQuantity
               ELSE NULLIF(sd.BoxQuantity,0) END, 0)
      ) AS supplyAmt,
      SUM(
        ISNULL(sd.Vat,0) * sdd.ShipmentQuantity / NULLIF(
          CASE WHEN sd.BunchQuantity>0 THEN sd.BunchQuantity
               WHEN sd.SteamQuantity>0 THEN sd.SteamQuantity
               ELSE NULLIF(sd.BoxQuantity,0) END, 0)
      ) AS vatAmt
    FROM ShipmentMaster sm
    JOIN ShipmentDetail sd ON sd.ShipmentKey = sm.ShipmentKey AND sd.isFix=1
    JOIN ShipmentDate sdd ON sdd.SdetailKey = sd.SdetailKey
    WHERE sm.CustKey=@ck AND sm.isDeleted=0 AND sm.isFix=1
      AND CONVERT(date, sdd.ShipmentDtm) >= @df AND CONVERT(date, sdd.ShipmentDtm) <= @dt
    GROUP BY CONVERT(date, sdd.ShipmentDtm), sm.OrderWeek
    ORDER BY outDate
  `);

// ── 2) 차수별 합계 (ShipmentDetail Amount — 견적서와 동일)
const byWeek = await pool.request()
  .input('ck', sql.Int, ck)
  .input('df', sql.Date, dateFrom)
  .input('dt', sql.Date, dateTo)
  .query(`
    SELECT sm.OrderWeek,
      SUM(ISNULL(sd.Amount,0)) AS shipSupply,
      SUM(ISNULL(sd.Vat,0)) AS shipVat,
      SUM(ISNULL(sd.Amount,0)+ISNULL(sd.Vat,0)) AS shipTotal
    FROM ShipmentMaster sm
    JOIN ShipmentDetail sd ON sd.ShipmentKey = sm.ShipmentKey AND sd.isFix=1
    WHERE sm.CustKey=@ck AND sm.isDeleted=0 AND sm.isFix=1
    GROUP BY sm.OrderWeek
    ORDER BY sm.OrderWeek
  `);

// 차수별 but only lines whose ShipmentDtm falls in calendar month
const byWeekInMonth = await pool.request()
  .input('ck', sql.Int, ck)
  .input('df', sql.Date, dateFrom)
  .input('dt', sql.Date, dateTo)
  .query(`
    SELECT sm.OrderWeek,
      SUM(ISNULL(sd.Amount,0)) AS shipSupply,
      SUM(ISNULL(sd.Vat,0)) AS shipVat
    FROM ShipmentMaster sm
    JOIN ShipmentDetail sd ON sd.ShipmentKey = sm.ShipmentKey AND sd.isFix=1
    WHERE sm.CustKey=@ck AND sm.isDeleted=0 AND sm.isFix=1
      AND CONVERT(date, sd.ShipmentDtm) >= @df AND CONVERT(date, sd.ShipmentDtm) <= @dt
    GROUP BY sm.OrderWeek ORDER BY sm.OrderWeek
  `);

// ── 3) 차감 (Estimate) — 달력월 / 차수
const deductions = await pool.request()
  .input('ck', sql.Int, ck)
  .input('df', sql.Date, dateFrom)
  .input('dt', sql.Date, dateTo)
  .query(`
    SELECT sm.OrderWeek,
      e.EstimateType,
      CONVERT(date, COALESCE(e.EstimateDtm, sd.ShipmentDtm)) AS estDate,
      p.ProdName,
      e.Quantity,
      e.Amount, e.Vat,
      ISNULL(e.Descr,N'') AS Descr
    FROM Estimate e
    JOIN ShipmentMaster sm ON e.ShipmentKey = sm.ShipmentKey
    LEFT JOIN ShipmentDetail sd ON sd.ShipmentKey = e.ShipmentKey AND sd.ProdKey = e.ProdKey
    LEFT JOIN Product p ON p.ProdKey = e.ProdKey
    WHERE sm.CustKey=@ck AND sm.isDeleted=0
      AND CONVERT(date, COALESCE(e.EstimateDtm, sd.ShipmentDtm)) >= @df
      AND CONVERT(date, COALESCE(e.EstimateDtm, sd.ShipmentDtm)) <= @dt
    ORDER BY estDate, sm.OrderWeek
  `);

// ── 4) ParentWeek 경계 — 차수별 출고일 min/max
const weekBounds = await pool.request()
  .input('ck', sql.Int, ck)
  .query(`
    SELECT sm.OrderWeek,
      MIN(CONVERT(date, sd.ShipmentDtm)) AS minShip,
      MAX(CONVERT(date, sd.ShipmentDtm)) AS maxShip,
      SUM(ISNULL(sd.Amount,0)+ISNULL(sd.Vat,0)) AS total
    FROM ShipmentMaster sm
    JOIN ShipmentDetail sd ON sd.ShipmentKey = sm.ShipmentKey AND sd.isFix=1
    WHERE sm.CustKey=@ck AND sm.isDeleted=0 AND sm.isFix=1
      AND sm.OrderYear = ${year}
    GROUP BY sm.OrderWeek ORDER BY sm.OrderWeek
  `);

// ── 5) 수국 stem 환산 체크
const hydrangea = await pool.request()
  .input('ck', sql.Int, ck)
  .input('df', sql.Date, dateFrom)
  .input('dt', sql.Date, dateTo)
  .query(`
    SELECT CONVERT(date, sdd.ShipmentDtm) AS outDate, sm.OrderWeek,
      p.ProdName, p.OutUnit, p.EstUnit, p.SteamOf1Box,
      SUM(sdd.ShipmentQuantity) AS outQtyOutUnit,
      SUM(sd.SteamQuantity) AS steamQty,
      SUM(sd.BoxQuantity) AS boxQty,
      SUM(ISNULL(sd.Amount,0) * sdd.ShipmentQuantity / NULLIF(
        CASE WHEN sd.SteamQuantity>0 THEN sd.SteamQuantity ELSE NULLIF(sd.BoxQuantity,0) END, 0)) AS supplyAmt
    FROM ShipmentMaster sm
    JOIN ShipmentDetail sd ON sd.ShipmentKey = sm.ShipmentKey AND sd.isFix=1
    JOIN ShipmentDate sdd ON sdd.SdetailKey = sd.SdetailKey
    JOIN Product p ON p.ProdKey = sd.ProdKey
    WHERE sm.CustKey=@ck AND sm.isDeleted=0 AND sm.isFix=1
      AND p.FlowerName LIKE N'%수국%'
      AND CONVERT(date, sdd.ShipmentDtm) >= @df AND CONVERT(date, sdd.ShipmentDtm) <= @dt
    GROUP BY CONVERT(date, sdd.ShipmentDtm), sm.OrderWeek, p.ProdName, p.OutUnit, p.EstUnit, p.SteamOf1Box
    ORDER BY outDate
  `);

// ── Summaries
const calRows = byCalendarAmt.recordset;
let calSupply = 0, calVat = 0;
calRows.forEach(r => { calSupply += Number(r.supplyAmt)||0; calVat += Number(r.vatAmt)||0; });

let dedSupply = 0, dedVat = 0;
deductions.recordset.forEach(r => { dedSupply += Number(r.Amount)||0; dedVat += Number(r.Vat)||0; });

console.log(`\n=== ${year}-${monthPad} 달력월 (${dateFrom} ~ ${dateTo}) ===`);
console.log('출고일 기준 공급가:', Math.round(calSupply).toLocaleString());
console.log('출고일 기준 부가세:', Math.round(calVat).toLocaleString());
console.log('출고일 기준 합계:', Math.round(calSupply+calVat).toLocaleString());
console.log('차감 공급가:', Math.round(dedSupply).toLocaleString());
console.log('차감 부가세:', Math.round(dedVat).toLocaleString());
console.log('차감 합계:', Math.round(dedSupply+dedVat).toLocaleString());
console.log('순매출(출고+차감):', Math.round(calSupply+calVat+dedSupply+dedVat).toLocaleString());
console.log('신라포털(붙여넣기) 참고:', '48,668,694 (6/4~6/26 일부)');

console.log('\n=== 일자별 출고 (달력) ===');
const byDate = {};
calRows.forEach(r => {
  const d = String(r.outDate).slice(0,10);
  if (!byDate[d]) byDate[d] = { supply:0, vat:0, weeks: new Set() };
  byDate[d].supply += Number(r.supplyAmt)||0;
  byDate[d].vat += Number(r.vatAmt)||0;
  byDate[d].weeks.add(r.OrderWeek);
});
Object.entries(byDate).sort().forEach(([d,v]) => {
  console.log(d, '공급가', Math.round(v.supply).toLocaleString(), '부가세', Math.round(v.vat).toLocaleString(),
    '차수', [...v.weeks].join(','));
});

console.log('\n=== 차수별 전체 (연간 누적, 월필터 없음) — 2026 ===');
byWeek.recordset.filter(r => r.OrderWeek?.startsWith(String(year).slice(2)) || true)
  .slice(-20).forEach(r => {
    console.log(r.OrderWeek, '합계', Math.round((r.shipTotal||0)).toLocaleString());
  });

console.log('\n=== 차수별 — ShipmentDtm이', monthPad,'월인 것만 ===');
let wSupply = 0;
byWeekInMonth.recordset.forEach(r => {
  wSupply += Number(r.shipSupply)||0;
  console.log(r.OrderWeek, '공급가', Math.round(r.shipSupply||0).toLocaleString(), 'VAT', Math.round(r.shipVat||0).toLocaleString());
});
console.log('차수×월필터 공급가 합:', Math.round(wSupply).toLocaleString());

console.log('\n=== 2026 차수 출고일 범위 (겹침 확인) ===');
weekBounds.recordset.filter(r => {
  const pw = parseInt(String(r.OrderWeek).split('-')[0], 10);
  return pw >= 22 && pw <= 27;
}).forEach(r => {
  console.log(r.OrderWeek, String(r.minShip).slice(0,10), '~', String(r.maxShip).slice(0,10),
    '합계', Math.round(r.total||0).toLocaleString());
});

console.log('\n=== 차감 (불량/검역/단가) ===');
if (!deductions.recordset.length) console.log('(없음)');
deductions.recordset.forEach(r => {
  console.log(String(r.estDate).slice(0,10), r.OrderWeek, r.EstimateType, r.ProdName,
    'qty', r.Quantity, 'amt', Math.round((r.Amount||0)+(r.Vat||0)), r.Descr?.slice(0,40));
});

console.log('\n=== 수국 (stem 환산) ===');
hydrangea.recordset.forEach(r => {
  const stems = Number(r.steamQty) || (Number(r.boxQty)||0) * (Number(r.SteamOf1Box)||30);
  console.log(String(r.outDate).slice(0,10), r.OrderWeek, r.ProdName?.slice(0,40),
    'outUnit', r.outQtyOutUnit, 'box', r.boxQty, 'steam', r.steamQty, 'SteamOf1Box', r.SteamOf1Box,
    '→stem추정', stems, 'amt', Math.round(r.supplyAmt||0));
});

await pool.close();

// ── appendix: 6월 관련 8개 SubWeek 견적서 금액
async function appendix() {
  const pool2 = await sql.connect(config);
  const weeks = ['23-01','23-02','24-01','24-02','25-01','25-02','26-01','26-02'];
  console.log('\n=== 6월 납품 SubWeek 견적 금액 (출고+차감) ===');
  let sumShip = 0, sumDed = 0;
  for (const w of weeks) {
    const r = await pool2.request().input('ck', sql.Int, ck).input('w', sql.NVarChar, w).query(`
      SELECT SUM(ISNULL(sd.Amount,0)+ISNULL(sd.Vat,0)) AS total
      FROM ShipmentMaster sm JOIN ShipmentDetail sd ON sd.ShipmentKey=sm.ShipmentKey AND sd.isFix=1
      WHERE sm.CustKey=@ck AND sm.OrderWeek=@w AND sm.isDeleted=0 AND sm.isFix=1`);
    const e = await pool2.request().input('ck', sql.Int, ck).input('w', sql.NVarChar, w).query(`
      SELECT SUM(ISNULL(e.Amount,0)+ISNULL(e.Vat,0)) AS ded
      FROM Estimate e JOIN ShipmentMaster sm ON e.ShipmentKey=sm.ShipmentKey
      WHERE sm.CustKey=@ck AND sm.OrderWeek=@w`);
    const ship = Number(r.recordset[0]?.total) || 0;
    const ded = Number(e.recordset[0]?.ded) || 0;
    sumShip += ship; sumDed += ded;
    console.log(w, '출고', Math.round(ship).toLocaleString(), '차감', Math.round(ded).toLocaleString(), '순', Math.round(ship+ded).toLocaleString());
  }
  console.log('8차수 합', '출고', Math.round(sumShip).toLocaleString(), '차감', Math.round(sumDed).toLocaleString(), '순', Math.round(sumShip+sumDed).toLocaleString());

  const supOnly = await pool2.request().input('ck', sql.Int, ck).query(`
    SELECT SUM(ISNULL(sd.Amount,0)) AS supply
    FROM ShipmentMaster sm JOIN ShipmentDetail sd ON sd.ShipmentKey=sm.ShipmentKey AND sd.isFix=1
    WHERE sm.CustKey=@ck AND sm.OrderYear=2026 AND sm.isFix=1 AND sm.isDeleted=0
      AND sm.OrderWeek IN ('23-01','23-02','24-01','24-02','25-01','25-02','26-01','26-02')`);
  console.log('8차수 공급가만:', Math.round(supOnly.recordset[0].supply).toLocaleString());

  const junShipDtm = await pool2.request().input('ck', sql.Int, ck).input('df', sql.Date, dateFrom).input('dt', sql.Date, dateTo).query(`
    SELECT SUM(ISNULL(sd.Amount,0)) AS supply, SUM(ISNULL(sd.Vat,0)) AS vat
    FROM ShipmentMaster sm JOIN ShipmentDetail sd ON sd.ShipmentKey=sm.ShipmentKey AND sd.isFix=1
    WHERE sm.CustKey=@ck AND sm.isFix=1 AND sm.isDeleted=0
      AND CONVERT(date, sd.ShipmentDtm) BETWEEN @df AND @dt`);
  const js = junShipDtm.recordset[0];
  console.log('6월 ShipmentDtm 공급가:', Math.round(js.supply).toLocaleString(), 'VAT', Math.round(js.vat).toLocaleString());
  console.log('6월 ShipmentDtm 합계(부가세포함):', Math.round((js.supply||0)+(js.vat||0)).toLocaleString());

  const gross8 = await pool2.request().input('ck', sql.Int, ck).query(`
    SELECT SUM(ISNULL(sd.Amount,0)+ISNULL(sd.Vat,0)) AS gross,
      SUM(ISNULL(sd.Amount,0)) AS supply,
      SUM(ISNULL(sd.Cost,0) * CASE WHEN ISNULL(sd.EstQuantity,0)<>0 THEN sd.EstQuantity
        WHEN ISNULL(sd.SteamQuantity,0)>0 THEN sd.SteamQuantity
        WHEN ISNULL(sd.BunchQuantity,0)>0 THEN sd.BunchQuantity ELSE sd.BoxQuantity END) AS costXqtyEst
    FROM ShipmentMaster sm JOIN ShipmentDetail sd ON sd.ShipmentKey=sm.ShipmentKey AND sd.isFix=1
    WHERE sm.CustKey=@ck AND sm.OrderYear=2026 AND sm.isFix=1 AND sm.isDeleted=0
      AND sm.OrderWeek IN ('23-01','23-02','24-01','24-02','25-01','25-02','26-01','26-02')`);
  const g = gross8.recordset[0];
  console.log('8차수 부가세포함(Cost×EstQty):', Math.round(g.costXqtyEst).toLocaleString());
  console.log('8차수 부가세포함(Amount+Vat):', Math.round(g.gross).toLocaleString());
  console.log('신라포털 합계(단가×수량=부가세포함 가정):', '48,668,694');
  console.log('차이(Amount+Vat - 포털):', Math.round((g.gross||0) - 48668694).toLocaleString());

  await pool2.close();
}
await appendix();
