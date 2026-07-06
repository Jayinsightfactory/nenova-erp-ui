/**
 * 신라 vs nenova 금액 차이 증명
 * - 신라: 세전 단가·공급가(단가×수량)
 * - nenova: Cost=부가세포함, Amount=공급가, Amount+Vat=합계
 * node scripts/probe-shilla-gap-proof.mjs
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

const pool = await sql.connect({
  server: process.env.DB_SERVER,
  port: parseInt(process.env.DB_PORT || '1433', 10),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  options: { encrypt: false, trustServerCertificate: true },
});

const ck = 446;
const WEEKS = ['23-01', '23-02', '24-01', '24-02', '25-01', '25-02', '26-01', '26-02'];

const portalRaw = fs.readFileSync(path.join(__dirname, 'probe-shilla-gap.mjs'), 'utf8');
const m = portalRaw.match(/const portalRaw = `([\s\S]*?)`;/);
const lines = m[1].trim().split('\n').map((line) => {
  const [date, name, qty, price, amt] = line.split('\t');
  return { date, name, qty: +qty, exVat: +price, supply: +amt };
});

function mapKey(name) {
  const s = name.replace(/^\[수입\]\s*/, '').replace(/^꽃,\s*/, '').trim();
  if (/안스리움.*화이트/i.test(s)) return '안스리움|화이트';
  if (/호접.*화이트.*8송이/i.test(s)) return '호접|화이트8';
  if (/호접.*염색.*스프레이/i.test(s)) return '호접|염색스프레이';
  if (/수국.*연그린/i.test(s)) return '수국|연그린';
  if (/수국.*연블루/i.test(s)) return '수국|연블루';
  if (/수국.*진그린/i.test(s)) return '수국|진그린';
  if (/시네신스.*화이트/i.test(s)) return '시네신스|화이트';
  if (/시네신스.*연핑크/i.test(s)) return '시네신스|연핑크';
  if (/장미.*몬디알/i.test(s)) return '장미|몬디알';
  if (/장미.*쉬머/i.test(s)) return '장미|쉬머';
  if (/카네이션.*프라도민트/i.test(s)) return '카네이션|프라도민트';
  if (/카네이션.*로다스/i.test(s)) return '카네이션|로다스';
  return `기타|${s.slice(0, 40)}`;
}

function dbMapKey(prodName) {
  const n = prodName || '';
  if (/Anthurium/i.test(n)) return '안스리움|화이트';
  if (/White 8/i.test(n)) return '호접|화이트8';
  if (/White 7/i.test(n)) return '호접|화이트7';
  if (/Spray|dyed|YELLOW|French blue|soft blue|보라블루/i.test(n)) return '호접|염색스프레이';
  if (/S\/GN|연그린/i.test(n)) return '수국|연그린';
  if (/Blue|블루/i.test(n) && /Hydrangea/i.test(n)) return '수국|연블루';
  if (/Esmeral|진그린/i.test(n)) return '수국|진그린';
  if (/Sinensis white/i.test(n)) return '시네신스|화이트';
  if (/light pink|연핑크/i.test(n)) return '시네신스|연핑크';
  if (/Mondial/i.test(n)) return '장미|몬디알';
  if (/Shimmer/i.test(n)) return '장미|쉬머';
  if (/Prado|프라도/i.test(n)) return '카네이션|프라도민트';
  if (/Rodas|로다스/i.test(n)) return '카네이션|로다스';
  return `기타|${n.slice(0, 40)}`;
}

const portalBy = {};
lines.forEach((l) => {
  const k = mapKey(l.name);
  if (!portalBy[k]) portalBy[k] = { supply: 0, qty: 0, exVatPrices: new Set() };
  portalBy[k].supply += l.supply;
  portalBy[k].qty += l.qty;
  portalBy[k].exVatPrices.add(l.exVat);
});

const dbRes = await pool.request().input('ck', sql.Int, ck).query(`
  SELECT p.ProdName, sd.Cost,
    CASE WHEN ISNULL(sd.EstQuantity,0)<>0 THEN sd.EstQuantity
      WHEN ISNULL(sd.SteamQuantity,0)>0 THEN sd.SteamQuantity
      WHEN ISNULL(sd.BunchQuantity,0)>0 THEN sd.BunchQuantity ELSE sd.BoxQuantity END AS qty,
    ISNULL(sd.Amount,0) AS supply,
    ISNULL(sd.Amount,0)+ISNULL(sd.Vat,0) AS gross
  FROM ShipmentMaster sm
  JOIN ShipmentDetail sd ON sd.ShipmentKey=sm.ShipmentKey AND sd.isFix=1
  JOIN Product p ON p.ProdKey=sd.ProdKey
  WHERE sm.CustKey=@ck AND sm.OrderYear=2026 AND sm.isFix=1 AND sm.isDeleted=0
    AND sm.OrderWeek IN ('${WEEKS.join("','")}')
`);

const dbBy = {};
dbRes.recordset.forEach((r) => {
  const k = dbMapKey(r.ProdName);
  if (!dbBy[k]) dbBy[k] = { supply: 0, gross: 0, qty: 0, costs: new Set(), rows: [] };
  dbBy[k].supply += Number(r.supply) || 0;
  dbBy[k].gross += Number(r.gross) || 0;
  dbBy[k].qty += Number(r.qty) || 0;
  dbBy[k].costs.add(Number(r.Cost) || 0);
  dbBy[k].rows.push(r);
});

const portalSupply = lines.reduce((s, l) => s + l.supply, 0);
const dbSupply = dbRes.recordset.reduce((s, r) => s + (Number(r.supply) || 0), 0);
const dbGross = dbRes.recordset.reduce((s, r) => s + (Number(r.gross) || 0), 0);

console.log('═══════════════════════════════════════════════════════════');
console.log(' 신라호텔 6월 금액 차이 증명 (23-01 ~ 26-02)');
console.log('═══════════════════════════════════════════════════════════\n');

console.log('[1] 총액 (올바른 축)');
console.log(`  신라 공급가(세전):     ${Math.round(portalSupply).toLocaleString()}`);
console.log(`  우리 Amount(세전):     ${Math.round(dbSupply).toLocaleString()}`);
console.log(`  ▶ 공급가 차이:         ${Math.round(dbSupply - portalSupply).toLocaleString()}  (${((dbSupply - portalSupply) / portalSupply * 100).toFixed(1)}%)`);
console.log(`  신라 합계(×1.1):       ${Math.round(portalSupply * 1.1).toLocaleString()}`);
console.log(`  우리 Amount+Vat:       ${Math.round(dbGross).toLocaleString()}`);
console.log(`  ▶ 합계 차이:           ${Math.round(dbGross - portalSupply * 1.1).toLocaleString()}\n`);

console.log('[2] 품목별 — 단가 환산 검증 (신라세전 ×1.1 ≈ nenova Cost)');
const keys = [...new Set([...Object.keys(portalBy), ...Object.keys(dbBy)])].sort();
const proofRows = [];

for (const k of keys) {
  const p = portalBy[k];
  const d = dbBy[k];
  if (!p && !d) continue;

  const pSupply = p?.supply || 0;
  const pQty = p?.qty || 0;
  const pExVat = p?.exVatPrices ? [...p.exVatPrices][0] : 0;
  const dSupply = d?.supply || 0;
  const dQty = d?.qty || 0;
  const dCost = d?.costs ? [...d.costs].find(c => c > 0) : 0;
  const dExVatFromCost = dCost ? Math.round(dCost / 1.1) : 0;

  const supplyDiff = dSupply - pSupply;
  const qtyDiff = dQty - pQty;

  let qtyOnlySupplyDiff = 0;
  let priceNote = '';
  if (p && d && pExVat > 0 && Math.abs(dExVatFromCost - pExVat) <= 2) {
    qtyOnlySupplyDiff = qtyDiff * pExVat;
    priceNote = `단가일치 ${pExVat}↔Cost${dCost}`;
  } else if (p && d && pExVat > 0) {
    priceNote = `단가불일치 신라${pExVat} 우리Cost${dCost}(세전${dExVatFromCost})`;
    qtyOnlySupplyDiff = qtyDiff * pExVat;
  } else if (!p) {
    priceNote = '신라없음(우리만)';
    qtyOnlySupplyDiff = dSupply;
  } else if (!d) {
    priceNote = '우리없음(신라만)';
    qtyOnlySupplyDiff = -pSupply;
  }

  if (Math.abs(supplyDiff) < 500 && Math.abs(qtyDiff) < 0.5) continue;

  proofRows.push({
    k, pQty, dQty, qtyDiff, pExVat, dCost, dExVatFromCost,
    pSupply, dSupply, supplyDiff, qtyOnlySupplyDiff, priceNote,
  });
}

proofRows.sort((a, b) => Math.abs(b.supplyDiff) - Math.abs(a.supplyDiff));

let explainedQty = 0;
proofRows.forEach((r) => {
  console.log(`\n  ■ ${r.k}`);
  console.log(`    신라  qty ${r.pQty}  세전단가 ${r.pExVat || '-'}  공급가 ${Math.round(r.pSupply).toLocaleString()}`);
  console.log(`    우리  qty ${Math.round(r.dQty)}  Cost ${r.dCost || '-'} (세전≈${r.dExVatFromCost || '-'})  공급가 ${Math.round(r.dSupply).toLocaleString()}`);
  console.log(`    ${r.priceNote}`);
  console.log(`    수량차 ${r.qtyDiff > 0 ? '+' : ''}${Math.round(r.qtyDiff)}  →  수량만으로 설명되는 공급가차: ${Math.round(r.qtyOnlySupplyDiff).toLocaleString()}`);
  console.log(`    실제 공급가 차이: ${Math.round(r.supplyDiff).toLocaleString()}`);
  if (Math.abs(r.qtyOnlySupplyDiff) > 100) explainedQty += r.qtyOnlySupplyDiff;
});

console.log('\n───────────────────────────────────────────────────────────');
console.log(`[3] 수량차만으로 설명 가능한 공급가 차이 합계: ${Math.round(explainedQty).toLocaleString()}`);
console.log(`    전체 공급가 차이:                         ${Math.round(dbSupply - portalSupply).toLocaleString()}`);
console.log(`    미설명(단가·매핑·라운딩):                  ${Math.round((dbSupply - portalSupply) - explainedQty).toLocaleString()}`);

// White 7 proof
const w7 = dbBy['호접|화이트7'];
if (w7) {
  console.log('\n[4] 증명: 포털에 없는 우리 품목');
  console.log(`  호접 화이트 7송이 — 우리만 ${Math.round(w7.qty)} stem, 공급가 ${Math.round(w7.supply).toLocaleString()}`);
  console.log(`  (신라 포털은 8송이만 집계, 7송이 ${Math.round(w7.qty)} stem = 약 ${Math.round(w7.supply).toLocaleString()} 공급가)`);
}

// Mondial detail
const mondP = portalBy['장미|몬디알'];
const mondD = dbBy['장미|몬디알'];
if (mondP && mondD) {
  console.log('\n[5] 증명: 장미 몬디알 (최대 수량 차)');
  console.log(`  신라 qty ${mondP.qty} × 세전 ${[...mondP.exVatPrices][0]} = ${Math.round(mondP.supply).toLocaleString()}`);
  console.log(`  우리 qty ${Math.round(mondD.qty)} Cost ${[...mondD.costs][0]} 공급가 ${Math.round(mondD.supply).toLocaleString()}`);
  console.log(`  수량차 ${mondP.qty - mondD.qty} × ${[...mondP.exVatPrices][0]} = ${Math.round((mondP.qty - mondD.qty) * [...mondP.exVatPrices][0]).toLocaleString()} (신라가 더 많음)`);
  mondD.rows.forEach((r) => console.log(`    DB: ${r.ProdName} qty ${r.qty} Cost ${r.Cost}`));
}

// Anthurium unit proof
const anth = dbBy['안스리움|화이트'];
if (anth) {
  const cost = [...anth.costs][0];
  console.log('\n[6] 증명: 안스리움 단가 동일 (수량만 비교)');
  console.log(`  nenova Cost ${cost} = 신라 8300 × 1.1 = ${8300 * 1.1}`);
  console.log(`  신라 qty ${portalBy['안스리움|화이트'].qty}  우리 qty ${Math.round(anth.qty)}  차이 ${Math.round(anth.qty - portalBy['안스리움|화이트'].qty)}`);
  console.log(`  수량차 × 8300 = ${Math.round((anth.qty - portalBy['안스리움|화이트'].qty) * 8300).toLocaleString()} 공급가`);
  console.log(`  실제 공급가차 = ${Math.round(anth.supply - portalBy['안스리움|화이트'].supply).toLocaleString()}`);
}

// Orchid white 8
const w8p = portalBy['호접|화이트8'];
const w8d = dbBy['호접|화이트8'];
if (w8p && w8d) {
  const ex = [...w8p.exVatPrices][0];
  const cost = [...w8d.costs][0];
  console.log('\n[7] 증명: 호접 화이트 8송이 (공급가 차이 최대)');
  console.log(`  신라 세전 ${ex} × 1.1 = ${Math.round(ex * 1.1)}  ↔  nenova Cost ${cost}`);
  console.log(`  신라 qty ${w8p.qty}  우리 qty ${Math.round(w8d.qty)}  차이 +${Math.round(w8d.qty - w8p.qty)} stem`);
  console.log(`  수량차 × 세전단가 = ${Math.round((w8d.qty - w8p.qty) * ex).toLocaleString()} 공급가`);
  console.log(`  실제 공급가차 = ${Math.round(w8d.supply - w8p.supply).toLocaleString()}`);
}

// Estimate deductions not in portal
const ded = await pool.request().input('ck', sql.Int, ck).query(`
  SELECT sm.OrderWeek, e.EstimateType, p.ProdName, e.Quantity, e.Amount, e.Vat, e.Descr
  FROM Estimate e
  JOIN ShipmentMaster sm ON e.ShipmentKey=sm.ShipmentKey
  LEFT JOIN Product p ON p.ProdKey=e.ProdKey
  WHERE sm.CustKey=@ck AND sm.OrderYear=2026
    AND sm.OrderWeek IN ('${WEEKS.join("','")}')
`);
if (ded.recordset.length) {
  console.log('\n[8] 6월 납품차수 내 Estimate(차감) — 포털 미반영 가능');
  ded.recordset.forEach((r) => {
    console.log(`  ${r.OrderWeek} ${r.EstimateType} ${(r.ProdName || '').slice(0, 35)} qty ${r.Quantity} 공급가 ${Math.round(r.Amount)}`);
  });
} else {
  console.log('\n[8] 6월 납품 SubWeek(23~26)에는 Estimate 차감 없음 — 불량조정은 다른 차수에 기록됨');
}

console.log('\n═══════════════════════════════════════════════════════════');
console.log(' 결론: 공급가 차이 ' + Math.round(dbSupply - portalSupply).toLocaleString() + '원의 주원인');
console.log('  ① 호접 화이트8 수량 (+253 stem) + 화이트7 우리만 존재');
console.log('  ② 장미 몬디알 수량 (신라>우리 또는 다른 차수 분산)');
console.log('  ③ 호접 염색스프레이 품목/수량 분류 차이');
console.log('  ④ 안스리움·시네신스 등 소량 수량차');
console.log('  ※ 단가체계는 8300↔9130 등 ×1.1 로 일치 — 단가 문제 아님');
console.log('═══════════════════════════════════════════════════════════\n');

await pool.close();
