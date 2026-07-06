/**
 * 신라호텔 금액 차이 분해 — 전산 vs 포털(부가세포함 단가)
 * node scripts/probe-shilla-gap.mjs [year] [month]
 */
import sql from 'mssql';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
for (const line of fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

const year = parseInt(process.argv[2] || '2026', 10);
const month = parseInt(process.argv[3] || '6', 10);
const monthPad = String(month).padStart(2, '0');
const dateFrom = `${year}-${monthPad}-01`;
const dateTo = `${year}-${monthPad}-${String(new Date(year, month, 0).getDate()).padStart(2, '0')}`;

const pool = await sql.connect({
  server: process.env.DB_SERVER,
  port: parseInt(process.env.DB_PORT || '1433', 10),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  options: { encrypt: false, trustServerCertificate: true },
});

const ck = (await pool.request().query(`
  SELECT TOP 1 CustKey FROM Customer WHERE CustName=N'신라호텔' AND ISNULL(isDeleted,0)=0
`)).recordset[0]?.CustKey;

const portalRaw = `2026-06-04	[수입] 행사용꽃, 시네신스, 연핑크 (PK)	25	9200	230000
2026-06-04	[수입] 행사용꽃, 안스리움, 화이트 (EA)	109	8300	904700
2026-06-04	[수입] 행사용꽃, 안스리움, 화이트 (EA)	41	8300	340300
2026-06-04	[수입] 행사용꽃, 안스리움, 화이트 (EA)	228	8300	1892400
2026-06-04	[수입] 행사용꽃, 안스리움, 화이트 (EA)	15	8300	124500
2026-06-04	[수입] 행사용꽃, 안스리움, 화이트 (EA)	19	8300	157700
2026-06-04	[수입] 행사용꽃, 안스리움, 화이트 (EA)	39	8300	323700
2026-06-04	[수입] 행사용꽃, 안스리움, 화이트 (EA)	14	8300	116200
2026-06-04	[수입] 행사용꽃, 호접, 염색, 스프레이, 8송이, VN (EA)	96	26000	2496000
2026-06-04	[수입] 행사용꽃, 호접, 화이트, 8송이, VN (EA)	4	13000	52000
2026-06-04	[수입] 행사용꽃, 호접, 화이트, 8송이, VN (EA)	240	13000	3120000
2026-06-04	[수입] 행사용꽃, 수국, 연그린, 콜롬비아 (EA)	54	2750	148500
2026-06-04	[수입] 행사용꽃, 수국, 연그린, 콜롬비아 (EA)	310	2750	852500
2026-06-04	[수입] 행사용꽃, 수국, 연블루, 콜롬비아 (EA)	120	2398	287760
2026-06-04	[수입] 행사용꽃, 수국, 연블루, 콜롬비아 (EA)	11	2398	26378
2026-06-04	[수입] 행사용꽃, 수국, 연블루, 콜롬비아 (EA)	45	2398	107910
2026-06-04	[수입] 행사용꽃, 수국, 연블루, 콜롬비아 (EA)	62	2398	148676
2026-06-04	[수입] 행사용꽃, 장미, 쉬머, 피치 (PK)	20	11970	239400
2026-06-04	[수입] 행사용꽃, 카네이션, 프라도민트, 연그린 (PK)	45	14500	652500
2026-06-05	[수입] 행사용꽃, 시네신스, 화이트 (PK)	60	9200	552000
2026-06-05	[수입] 행사용꽃, 시네신스, 화이트 (PK)	16	9200	147200
2026-06-05	[수입] 행사용꽃, 시네신스, 화이트 (PK)	47	9200	432400
2026-06-05	[수입] 행사용꽃, 시네신스, 화이트 (PK)	36	9200	331200
2026-06-05	[수입] 행사용꽃, 시네신스, 화이트 (PK)	24	9200	220800
2026-06-05	[수입] 행사용꽃, 카네이션, 프라도민트, 연그린 (PK)	3	14500	43500
2026-06-05	[수입] 꽃, 카네이션, 로다스, 아이보리 (PK)	30	14500	435000
2026-06-10	[수입] 행사용꽃, 수국, 연그린, 콜롬비아 (EA)	505	2750	1388750
2026-06-10	[수입] 행사용꽃, 수국, 연블루, 콜롬비아 (EA)	100	2398	239800
2026-06-10	[수입] 행사용꽃, 수국, 연블루, 콜롬비아 (EA)	50	2398	119900
2026-06-10	[수입] 행사용꽃, 시네신스, 화이트 (PK)	182	9200	1674400
2026-06-10	[수입] 행사용꽃, 시네신스, 화이트 (PK)	40	9200	368000
2026-06-10	[수입] 행사용꽃, 장미, 몬디알, 연핑크 (PK)	50	11490	574500
2026-06-10	[수입] 행사용꽃, 시네신스, 연핑크 (PK)	20	9200	184000
2026-06-10	[수입] 행사용꽃, 시네신스, 화이트 (PK)	95	9200	874000
2026-06-10	[수입] 행사용꽃, 안스리움, 화이트 (EA)	159	8300	1319700
2026-06-10	[수입] 행사용꽃, 안스리움, 화이트 (EA)	152	8300	1261600
2026-06-10	[수입] 행사용꽃, 안스리움, 화이트 (EA)	42	8300	348600
2026-06-12	[수입] 행사용꽃, 호접, 염색, 스프레이, 8송이, VN (EA)	64	26000	1664000
2026-06-12	[수입] 행사용꽃, 호접, 화이트, 8송이, VN (EA)	268	13000	3484000
2026-06-17	[수입] 행사용꽃, 시네신스, 화이트 (PK)	27	9200	248400
2026-06-17	[수입] 행사용꽃, 안스리움, 화이트 (EA)	54	8300	448200
2026-06-17	[수입] 행사용꽃, 안스리움, 화이트 (EA)	29	8300	240700
2026-06-17	[수입] 행사용꽃, 안스리움, 화이트 (EA)	15	8300	124500
2026-06-17	[수입] 행사용꽃, 안스리움, 화이트 (EA)	15	8300	124500
2026-06-17	[수입] 행사용꽃, 안스리움, 화이트 (EA)	49	8300	406700
2026-06-17	[수입] 행사용꽃, 수국, 연그린, 콜롬비아 (EA)	322	2750	885500
2026-06-17	[수입] 행사용꽃, 수국, 연블루, 콜롬비아 (EA)	8	2750	22000
2026-06-17	[수입] 행사용꽃, 수국, 연블루, 콜롬비아 (EA)	10	2398	23980
2026-06-17	[수입] 행사용꽃, 시네신스, 화이트 (PK)	106	9200	975200
2026-06-17	[수입] 행사용꽃, 시네신스, 화이트 (PK)	62	9200	570400
2026-06-17	[수입] 행사용꽃, 시네신스, 화이트 (PK)	40	9200	368000
2026-06-17	[수입] 행사용꽃, 시네신스, 화이트 (PK)	74	9200	680800
2026-06-17	[수입] 행사용꽃, 시네신스, 화이트 (PK)	82	9200	754400
2026-06-17	[수입] 행사용꽃, 시네신스, 화이트 (PK)	15	9200	138000
2026-06-17	[수입] 행사용꽃, 호접, 화이트, 8송이, VN (EA)	313	13000	4069000
2026-06-17	[수입] 행사용꽃, 호접, 화이트, 8송이, VN (EA)	7	13000	91000
2026-06-24	[수입] 행사용꽃, 시네신스, 화이트 (PK)	110	9200	1012000
2026-06-24	[수입] 행사용꽃, 시네신스, 화이트 (PK)	50	9200	460000
2026-06-24	[수입] 행사용꽃, 시네신스, 화이트 (PK)	144	9200	1324800
2026-06-24	[수입] 행사용꽃, 안스리움, 화이트 (EA)	58	8300	481400
2026-06-24	[수입] 행사용꽃, 안스리움, 화이트 (EA)	50	8300	415000
2026-06-24	[수입] 행사용꽃, 안스리움, 화이트 (EA)	30	8300	249000
2026-06-24	[수입] 행사용꽃, 안스리움, 화이트 (EA)	40	8300	332000
2026-06-24	[수입] 행사용꽃, 수국, 연그린, 콜롬비아 (EA)	190	2750	522500
2026-06-24	[수입] 행사용꽃, 시네신스, 화이트 (PK)	60	9200	552000
2026-06-24	[수입] 행사용꽃, 시네신스, 화이트 (PK)	57	9200	524400
2026-06-24	[수입] 행사용꽃, 장미, 몬디알, 연핑크 (PK)	6	11490	68940
2026-06-26	[수입] 행사용꽃, 호접, 화이트, 8송이, VN (EA)	332	13000	4316000
2026-06-04	[수입] 행사용꽃, 수국, 진그린, 콜롬비아 (EA)	120	2750	330000
2026-06-26	[수입] 행사용꽃, 안스리움, 화이트 (EA)	3	8300	24900`;

function portalKey(name) {
  const s = name.replace(/^\[수입\]\s*/, '').replace(/^꽃,\s*/, '행사용꽃, ').trim();
  const parts = s.replace('행사용꽃, ', '').split(',').map(x => x.trim().replace(/\s*\([^)]*\)/g, ''));
  return parts.slice(0, 3).join('|');
}

const portalLines = portalRaw.trim().split('\n').map((line) => {
  const [date, name, qty, price, amt] = line.split('\t');
  return { date, name, qty: +qty, price: +price, amt: +amt, key: portalKey(name) };
});
const portalGross = portalLines.reduce((s, p) => s + p.amt, 0);
const portalByKey = {};
portalLines.forEach((p) => {
  if (!portalByKey[p.key]) portalByKey[p.key] = { gross: 0, qty: 0, price: p.price };
  portalByKey[p.key].gross += p.amt;
  portalByKey[p.key].qty += p.qty;
});

// DB lines — June weeks, gross = Amount+Vat, qty = EstQuantity
const dbLines = await pool.request().input('ck', sql.Int, ck).query(`
  SELECT sm.OrderWeek,
    CONVERT(date, sd.ShipmentDtm) AS shipDate,
    p.ProdKey, p.ProdName, p.FlowerName,
    sd.Cost,
    CASE WHEN ISNULL(sd.EstQuantity,0)<>0 THEN sd.EstQuantity
      WHEN ISNULL(sd.SteamQuantity,0)>0 THEN sd.SteamQuantity
      WHEN ISNULL(sd.BunchQuantity,0)>0 THEN sd.BunchQuantity ELSE sd.BoxQuantity END AS estQty,
    ISNULL(sd.Amount,0)+ISNULL(sd.Vat,0) AS gross,
    ISNULL(sd.Amount,0) AS supply
  FROM ShipmentMaster sm
  JOIN ShipmentDetail sd ON sd.ShipmentKey=sm.ShipmentKey AND sd.isFix=1
  JOIN Product p ON p.ProdKey=sd.ProdKey
  WHERE sm.CustKey=@ck AND sm.isFix=1 AND sm.isDeleted=0 AND sm.OrderYear=${year}
    AND sm.OrderWeek IN ('23-01','23-02','24-01','24-02','25-01','25-02','26-01','26-02')
`);

const MAP = [
  { key: '안스리움|화이트', re: /Anthurium/i },
  { key: '호접|화이트|8송이', re: /White 8/i },
  { key: '호접|염색|스프레이', re: /Spray|dyed|YELLOW|blue/i },
  { key: '수국|연그린', re: /S\/GN|연그린/i },
  { key: '수국|연블루', re: /Blue|블루/i },
  { key: '수국|진그린', re: /Esmeral|진그린/i },
  { key: '시네신스|화이트', re: /Sinensis white/i },
  { key: '시네신스|연핑크', re: /light pink|연핑크/i },
  { key: '장미|몬디알|연핑크', re: /Mondial/i },
  { key: '장미|쉬머|피치', re: /Shimmer/i },
  { key: '카네이션|프라도민트|연그린', re: /Prado|프라도/i },
  { key: '카네이션|로다스|아이보리', re: /Rodas|로다스/i },
];

function dbKey(row) {
  const n = row.ProdName || '';
  for (const m of MAP) if (m.re.test(n)) return m.key;
  return `?|${n.slice(0, 30)}`;
}

const dbByKey = {};
let dbGross = 0, dbSupply = 0;
dbLines.recordset.forEach((r) => {
  const k = dbKey(r);
  if (!dbByKey[k]) dbByKey[k] = { gross: 0, supply: 0, qty: 0, cost: r.Cost };
  dbByKey[k].gross += Number(r.gross) || 0;
  dbByKey[k].supply += Number(r.supply) || 0;
  dbByKey[k].qty += Number(r.estQty) || 0;
  dbGross += Number(r.gross) || 0;
  dbSupply += Number(r.supply) || 0;
});

// Deductions in June calendar
const ded = await pool.request().input('ck', sql.Int, ck).input('df', sql.Date, dateFrom).input('dt', sql.Date, dateTo).query(`
  SELECT SUM(ISNULL(e.Amount,0)+ISNULL(e.Vat,0)) AS gross
  FROM Estimate e JOIN ShipmentMaster sm ON e.ShipmentKey=sm.ShipmentKey
  WHERE sm.CustKey=@ck AND CONVERT(date, COALESCE(e.EstimateDtm, GETDATE())) BETWEEN @df AND @dt
`);
const dedGross = Number(ded.recordset[0]?.gross) || 0;

// Full month all weeks
const fullMonth = await pool.request().input('ck', sql.Int, ck).input('df', sql.Date, dateFrom).input('dt', sql.Date, dateTo).query(`
  SELECT SUM(ISNULL(sd.Amount,0)+ISNULL(sd.Vat,0)) AS gross, SUM(ISNULL(sd.Amount,0)) AS supply
  FROM ShipmentMaster sm JOIN ShipmentDetail sd ON sd.ShipmentKey=sm.ShipmentKey AND sd.isFix=1
  WHERE sm.CustKey=@ck AND sm.isFix=1 AND sm.isDeleted=0
    AND CONVERT(date, sd.ShipmentDtm) BETWEEN @df AND @dt
`);

const fm = fullMonth.recordset[0];

console.log('=== 총액 비교 (부가세포함) ===');
console.log('신라 포털(붙여넣기 6/4~6/26):', Math.round(portalGross).toLocaleString());
console.log('우리 8차수(23-01~26-02):', Math.round(dbGross).toLocaleString());
console.log('우리 6월 전체(ShipmentDtm):', Math.round(fm.gross).toLocaleString());
console.log('차이 8차수-포털:', Math.round(dbGross - portalGross).toLocaleString());
console.log('차이 6월달력-포털:', Math.round(fm.gross - portalGross).toLocaleString());

console.log('\n=== 공급가만 비교 (잘못된 비교 시 350만 근처) ===');
console.log('우리 공급가 8차수:', Math.round(dbSupply).toLocaleString());
console.log('우리 공급가 6월:', Math.round(fm.supply).toLocaleString());
console.log('신라 포털(부가세포함으로 봐야 함):', Math.round(portalGross).toLocaleString());
console.log('공급가 - 포털합:', Math.round(dbSupply - portalGross).toLocaleString(), '← 약 318만');
console.log('포털을 공급가로 착각(÷1.1) 후 차이:', Math.round(dbGross - portalGross / 1.1).toLocaleString());

console.log('\n=== 6월 차감 (Estimate) ===');
console.log('차감 부가세포함:', Math.round(dedGross).toLocaleString());
console.log('8차수 - 차감:', Math.round(dbGross + dedGross).toLocaleString());

console.log('\n=== 품목별 차이 (부가세포함) ===');
const allKeys = new Set([...Object.keys(portalByKey), ...Object.keys(dbByKey)]);
[...allKeys].sort().forEach((k) => {
  const p = portalByKey[k] || { gross: 0, qty: 0 };
  const d = dbByKey[k] || { gross: 0, qty: 0 };
  const diff = d.gross - p.gross;
  if (Math.abs(diff) < 1000 && Math.abs(d.qty - p.qty) < 1) return;
  console.log(
    k.padEnd(28),
    '신라', Math.round(p.gross).toLocaleString().padStart(11), `(${p.qty})`,
    '우리', Math.round(d.gross).toLocaleString().padStart(11), `(${Math.round(d.qty)})`,
    '차이', Math.round(diff).toLocaleString().padStart(10),
  );
});

// Unmapped DB only
const unmapped = Object.entries(dbByKey).filter(([k]) => k.startsWith('?|'));
if (unmapped.length) {
  console.log('\n=== 포털에 없는 우리 품목 ===');
  unmapped.forEach(([k, v]) => console.log(k, Math.round(v.gross).toLocaleString(), 'qty', Math.round(v.qty)));
}

// Portal only keys
const portalOnly = Object.keys(portalByKey).filter((k) => !dbByKey[k] || dbByKey[k].gross === 0);
if (portalOnly.length) {
  console.log('\n=== 우리 DB에 없는 신라 품목 ===');
  portalOnly.forEach((k) => console.log(k, Math.round(portalByKey[k].gross).toLocaleString()));
}

// quick orchid breakdown
const orchid = await pool.request().input('ck', sql.Int, ck).query(`
  SELECT p.ProdName, sd.Cost,
    SUM(CASE WHEN ISNULL(sd.EstQuantity,0)<>0 THEN sd.EstQuantity
      WHEN ISNULL(sd.SteamQuantity,0)>0 THEN sd.SteamQuantity ELSE sd.BoxQuantity END) AS qty,
    SUM(ISNULL(sd.Amount,0)+ISNULL(sd.Vat,0)) AS gross
  FROM ShipmentMaster sm JOIN ShipmentDetail sd ON sd.ShipmentKey=sm.ShipmentKey AND sd.isFix=1
  JOIN Product p ON p.ProdKey=sd.ProdKey
  WHERE sm.CustKey=@ck AND sm.OrderYear=2026 AND sm.isFix=1 AND sm.isDeleted=0
    AND sm.OrderWeek IN ('23-01','23-02','24-01','24-02','25-01','25-02','26-01','26-02')
    AND (p.ProdName LIKE N'%ORCHID%' OR p.ProdName LIKE N'%호접%')
  GROUP BY p.ProdName, sd.Cost ORDER BY gross DESC`);
console.log('\n=== 호접 품목별 ===');
orchid.recordset.forEach((r) => console.log(Math.round(r.qty), 'stem', Math.round(r.gross).toLocaleString(), r.ProdName?.slice(0,50), 'Cost', r.Cost));
console.log('호접8 포털 1164×13000=', (1164*13000).toLocaleString());
console.log('우리-포털 호접8 stem차', 1417-1164, '×13000=', ((1417-1164)*13000).toLocaleString());
await pool.close();
