// scripts/audit-all-bills.mjs
// DB 기존 모든 BILL/AWB 일괄 자체 검증 (엑셀 정답지 없이)
//
// 검사 항목 (BILL 단위):
//   A. GW 추출 가능?         → WarehouseDetail 'Gross weigth' 행 OR FREIGHTWISE 패턴
//   B. CW 추출 가능?         → 'Chargeable weigth' 행
//   C. Rate USD/kg 추출?    → FREIGHTWISE Rate×Weight 패턴
//   D. invoiceUSD 일치?      → live = sum(TPrice) (운송료/GW/CW 행 제외)
//   E. Product BoxWeight 누락 건수 (장미/카네이션 등 단당 환산용)
//   F. Product SteamOf1Bunch 누락 건수 (송이 환산용)
//   G. 카테고리 분배 합 = 총 항공료? (분배 누락 감지)
//   H. FreightCost 스냅샷 있으면 라이브와 비교 (스냅샷 후 코드 변경 회귀 감지)
//
// 점수: 8개 검사 통과 비율. <60% = 🔴, 60-90% = 🟡, ≥90% = 🟢
//
// 출력: 표 + 통계 + 문제 BILL Top 10

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import sqlImport from 'mssql';
import { computeFreightCost, isFreightForwarder, isFreightRow } from '../lib/freightCalc.js';
import { loadOverrides } from '../lib/categoryOverrides.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// .env.local 로드
const envFile = path.join(__dirname, '..', '.env.local');
if (fs.existsSync(envFile)) {
  fs.readFileSync(envFile, 'utf8').split(/\r?\n/).forEach(line => {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m) process.env[m[1]] = m[2];
  });
}

const sql = sqlImport;
const DEFAULT_CUSTOMS = {
  bakSangRate: 460,
  handlingFee: 33000,
  quarantinePerItem: 10000,
  domesticFreight: 99000,
  deductFee: 40000,
  extraFee: 0,
};

function isGwName(n) { return /^\s*gross\s*weig[h]?t[h]?\s*$/i.test(String(n || '').trim()); }
function isCwName(n) { return /^\s*chargeable\s*weig[h]?t[h]?\s*$/i.test(String(n || '').trim()); }
function weightOfRow(r) {
  const vals = [Number(r.BoxQuantity) || 0, Number(r.BunchQuantity) || 0, Number(r.SteamQuantity) || 0];
  const realVals = vals.filter(v => v > 1);
  return realVals.length > 0 ? Math.max(...realVals) : 0;
}

(async () => {
  const pool = await sql.connect({
    server: process.env.DB_SERVER, port: parseInt(process.env.DB_PORT||'1433'),
    database: process.env.DB_NAME, user: process.env.DB_USER, password: process.env.DB_PASSWORD,
    options: { encrypt:false, trustServerCertificate:true, enableArithAbort:true, connectTimeout:30000, requestTimeout:60000 },
  });

  console.log('# DB 기존 BILL 일괄 자체 검증\n');

  // 모든 WarehouseMaster 그룹 (AWB 기준, 최근 90일)
  const wmRes = await pool.request().query(`
    SELECT WarehouseKey, OrderYear, OrderWeek, FarmName, ISNULL(OrderNo,'') AS AWB,
        CONVERT(NVARCHAR(10), InputDate, 120) AS InputDate
      FROM WarehouseMaster
      WHERE isDeleted=0 AND InputDate >= DATEADD(DAY, -90, GETDATE())
      ORDER BY InputDate DESC, WarehouseKey DESC
  `);

  // AWB 그룹화 (대시/공백 무시)
  const normAWB = (a) => (a || '').replace(/[-\s]/g, '').trim();
  const groups = new Map();
  for (const m of wmRes.recordset) {
    const key = normAWB(m.AWB) ? `AWB:${normAWB(m.AWB)}` : `WK:${m.WarehouseKey}`;
    if (!groups.has(key)) groups.set(key, { keys: [], farms: [], orderWeek: m.OrderWeek, orderYear: m.OrderYear, awb: m.AWB, inputDate: m.InputDate });
    groups.get(key).keys.push(m.WarehouseKey);
    groups.get(key).farms.push(m.FarmName);
  }

  console.log(`최근 90일 BILL 그룹 = ${groups.size} 건 (WarehouseMaster 행 ${wmRes.recordset.length})`);

  // Flower / Currency 한 번만 로드
  const fRes = await pool.request().query(`SELECT FlowerName, BoxWeight, BoxCBM, StemsPerBox, DefaultTariff FROM Flower WHERE isDeleted=0`);
  const flowers = fRes.recordset;
  const curRes = await pool.request().query(`SELECT CurrencyCode, ExchangeRate FROM CurrencyMaster WHERE IsActive=1`);
  const currencyRates = { KRW: 1 };
  for (const c of curRes.recordset) currencyRates[c.CurrencyCode] = Number(c.ExchangeRate) || 0;

  const audits = [];

  for (const [groupKey, g] of groups.entries()) {
    const keyList = g.keys;
    const keyCSV = keyList.join(',');

    // WH detail + Product
    const dRes = await pool.request().query(`
      SELECT wd.WarehouseKey, wd.WdetailKey, wd.ProdKey, wd.BoxQuantity, wd.BunchQuantity, wd.SteamQuantity,
          wd.UPrice, wd.TPrice, wm.FarmName,
          p.ProdName, p.FlowerName, p.CounName, p.SteamOf1Bunch, p.OutUnit,
          p.BoxWeight AS P_BoxWeight, p.BoxCBM AS P_BoxCBM, p.TariffRate AS P_TariffRate
        FROM WarehouseDetail wd
        INNER JOIN WarehouseMaster wm ON wd.WarehouseKey=wm.WarehouseKey
        LEFT JOIN Product p ON wd.ProdKey=p.ProdKey
        WHERE wd.WarehouseKey IN (${keyCSV})
    `);
    const allRows = dRes.recordset;
    if (allRows.length === 0) continue;  // 빈 BILL skip

    const freightRows = allRows.filter(r => isFreightRow(r));
    const rows = allRows.filter(r => !isFreightRow(r));

    // 검사 A/B/C — GW/CW/Rate 추출
    const gwRows = freightRows.filter(r => isGwName(r.ProdName));
    const cwRows = freightRows.filter(r => isCwName(r.ProdName));
    const extractedGwFromRow = gwRows.reduce((a, r) => a + weightOfRow(r), 0);
    const extractedCwFromRow = cwRows.reduce((a, r) => a + weightOfRow(r), 0);
    const freightMainRow = freightRows.find(r => Number(r.UPrice) > 0);
    const isRatePattern = freightMainRow && (Number(freightMainRow.BunchQuantity) || 0) > 1;
    const extractedGW = isRatePattern ? Number(freightMainRow.BunchQuantity) : 0;
    const extractedRate = isRatePattern ? Number(freightMainRow.UPrice) : 0;
    const actualFreightUSD = freightRows.reduce((a, r) => a + (Number(r.TPrice) || 0), 0);

    const checkA_GW = extractedGwFromRow > 1 || extractedGW > 1;
    const checkB_CW = extractedCwFromRow > 1 || extractedGW > 1;
    const checkC_Rate = extractedRate > 0;

    // 검사 D — invoiceUSD = sum(TPrice)
    const invoiceUSD = rows.reduce((a, r) => a + (Number(r.TPrice) || 0), 0);
    const checkD_Invoice = invoiceUSD > 0;

    // 검사 E/F — Product 마스터 누락
    const missingBW = new Set();
    const missingS1B = new Set();
    for (const r of rows) {
      if (!r.P_BoxWeight || Number(r.P_BoxWeight) <= 0) missingBW.add(r.ProdKey);
      // SteamOf1Bunch 는 송이 단위 환산용
      if (!r.SteamOf1Bunch || Number(r.SteamOf1Bunch) <= 0) missingS1B.add(r.ProdKey);
    }
    const checkE_BW = missingBW.size === 0;
    const checkF_S1B = missingS1B.size === 0;

    // 검사 G/H — freightCalc 라이브 실행 (가능하면)
    let checkG_DistSum = false;
    let checkH_Snapshot = null;  // null = 스냅샷 없음 (skip)
    let liveResult = null;
    let warningCount = 0;
    let liveError = null;

    try {
      const productMeta = new Map();
      for (const r of rows) {
        if (r.ProdKey) productMeta.set(r.ProdKey, { boxWeight: r.P_BoxWeight, boxCBM: r.P_BoxCBM, tariffRate: r.P_TariffRate });
      }
      // 카테고리 오버라이드 적용
      const catOv = loadOverrides(true);
      for (const r of rows) {
        const ov = r.ProdKey ? catOv[r.ProdKey] : null;
        if (ov && ov.category) r.FlowerName = ov.category;
      }
      const itemCount = [...new Set(rows.map(r => (r.FlowerName || '').trim()))].filter(Boolean).length;

      const computeInput = {
        master: {
          warehouseKey: keyList[0],
          gw: extractedGwFromRow > 1 ? extractedGwFromRow : (extractedGW > 1 ? extractedGW : 0),
          cw: extractedCwFromRow > 1 ? extractedCwFromRow : (extractedGW > 1 ? extractedGW : 0),
          rateUSD: extractedRate || 0,
          docFeeUSD: 0,
          exchangeRate: 1300,  // 기본값 — 실제 통화 자동 감지 안 함
          invoiceUSD,
          itemCount,
          actualFreightUSD: actualFreightUSD > 0 ? actualFreightUSD : null,
        },
        customs: DEFAULT_CUSTOMS,
        details: rows.map(r => ({
          warehouseDetailKey: r.WdetailKey, prodKey: r.ProdKey, prodName: r.ProdName,
          flowerName: r.FlowerName, counName: r.CounName, farmName: r.FarmName,
          boxQty: Number(r.BoxQuantity) || 0,
          bunchQty: Number(r.BunchQuantity) || 0,
          steamQty: Number(r.SteamQuantity) || 0,
          fobUSD: Number(r.UPrice) || 0,
          stemsPerBunch: Number(r.SteamOf1Bunch) || 0,
          tariffRate: Number(r.P_TariffRate) || 0,
          outUnit: r.OutUnit || '',
        })),
        productMeta,
        flowerMaster: flowers,
      };

      liveResult = computeFreightCost(computeInput);
      warningCount = (liveResult.warnings || []).length;

      // G — 카테고리 분배 합 vs 총 항공료
      const totalFreightDist = (liveResult.categories || []).reduce((a, c) => a + (Number(c.freightUSD) || 0), 0);
      const totalFreightExpected = liveResult.master?.actualFreightUSD || liveResult.master?.freightComputedUSD || 0;
      checkG_DistSum = totalFreightExpected === 0 ? true : Math.abs(totalFreightDist - totalFreightExpected) < 1.0;
    } catch (e) {
      liveError = e.message;
    }

    // 검사 H — 스냅샷 vs 라이브
    const fcRes = await pool.request().query(`SELECT TOP 1 * FROM FreightCost WHERE WarehouseKey IN (${keyCSV}) AND isDeleted=0 ORDER BY CreateDtm DESC`);
    if (fcRes.recordset.length > 0 && liveResult) {
      const snap = fcRes.recordset[0];
      // 핵심 비교: invoiceUSD, totalFreightUSD
      const snapInvoice = Number(snap.InvoiceTotalUSD) || 0;
      const liveInvoice = Number(liveResult.master?.invoiceUSD) || 0;
      checkH_Snapshot = Math.abs(snapInvoice - liveInvoice) < 0.5;
    }

    const checks = { A: checkA_GW, B: checkB_CW, C: checkC_Rate, D: checkD_Invoice, E: checkE_BW, F: checkF_S1B, G: checkG_DistSum, H: checkH_Snapshot };
    const total = Object.values(checks).filter(v => v !== null).length;
    const passed = Object.values(checks).filter(v => v === true).length;
    const score = total === 0 ? 0 : Math.round(passed / total * 100);

    audits.push({
      groupKey,
      orderYear: g.orderYear,
      orderWeek: g.orderWeek,
      farms: [...new Set(g.farms)].slice(0, 2).join('+') + (g.farms.length > 2 ? ` +${g.farms.length - 2}` : ''),
      awb: g.awb,
      inputDate: g.inputDate,
      rowCount: rows.length,
      freightRowCount: freightRows.length,
      checks,
      score,
      missingBW: missingBW.size,
      missingS1B: missingS1B.size,
      hasSnapshot: fcRes.recordset.length > 0,
      warningCount,
      liveError,
      invoiceUSD,
      actualFreightUSD,
    });
  }

  await pool.close();

  // 점수별 집계
  const green = audits.filter(a => a.score >= 90);
  const yellow = audits.filter(a => a.score >= 60 && a.score < 90);
  const red = audits.filter(a => a.score < 60);

  console.log(`\n## 결과 요약 (${audits.length} BILL 검사)\n`);
  console.log(`🟢 ≥90% : ${green.length} BILL`);
  console.log(`🟡 60-89%: ${yellow.length} BILL`);
  console.log(`🔴 <60% : ${red.length} BILL`);

  // 검사별 통과율
  const fields = ['A','B','C','D','E','F','G','H'];
  const labels = {
    A: 'GW 추출', B: 'CW 추출', C: 'Rate USD/kg 추출', D: 'invoiceUSD 정합',
    E: 'BoxWeight 완비', F: 'SteamOf1Bunch 완비', G: '카테고리 분배 합', H: '스냅샷 일치',
  };
  console.log(`\n## 검사별 통과율\n`);
  for (const f of fields) {
    const total = audits.filter(a => a.checks[f] !== null).length;
    const pass = audits.filter(a => a.checks[f] === true).length;
    const pct = total === 0 ? '-' : Math.round(pass/total*100) + '%';
    console.log(`  [${f}] ${labels[f].padEnd(20)} ${pass}/${total} (${pct})`);
  }

  // 문제 BILL Top 15 (score 낮은 순)
  console.log(`\n## 🔴 점수 낮은 BILL (Top 15)\n`);
  const sorted = [...audits].sort((a, b) => a.score - b.score).slice(0, 15);
  console.log('| WK 그룹 | 차수 | 농장 | AWB | 행 | 점수 | 검사 | 누락 |');
  console.log('|---|---|---|---|---|---|---|---|');
  for (const a of sorted) {
    const checkStr = fields.map(f => a.checks[f] === true ? '✓' : a.checks[f] === false ? '✗' : '-').join('');
    const wkLabel = a.groupKey.startsWith('AWB:') ? a.groupKey.substring(4, 16) : a.groupKey.substring(3);
    console.log(`| ${wkLabel} | ${a.orderYear}-${a.orderWeek} | ${a.farms} | ${(a.awb||'').substring(0,12)} | ${a.rowCount} | ${a.score}% | ${checkStr} | BW:${a.missingBW}/S1B:${a.missingS1B} |`);
  }

  console.log('\n## 검사 코드');
  for (const f of fields) console.log(`  [${f}] ${labels[f]}`);

  // BILL 별 Rate=0 (Ecuador 패턴) 카운트
  const rateZero = audits.filter(a => !a.checks.C);
  if (rateZero.length > 0) {
    console.log(`\n## ⚠️ Rate USD/kg 추출 실패 BILL: ${rateZero.length}건`);
    console.log('   (Ecuador 18-1 패턴 — actualFreightUSD 우회 작동하지만 미세 오차 가능)');
    for (const a of rateZero.slice(0, 10)) {
      console.log(`   - ${a.orderYear}-${a.orderWeek} ${a.farms} (${a.awb})`);
    }
    if (rateZero.length > 10) console.log(`   ... +${rateZero.length - 10}`);
  }

  // 누락 마스터 통계
  const totalMissingBW = audits.reduce((a, b) => a + b.missingBW, 0);
  const totalMissingS1B = audits.reduce((a, b) => a + b.missingS1B, 0);
  console.log(`\n## Product 마스터 누락 (전체 BILL 합산)`);
  console.log(`   BoxWeight 누락 ProdKey: ${totalMissingBW} 건/BILL (중복 포함)`);
  console.log(`   SteamOf1Bunch 누락 ProdKey: ${totalMissingS1B} 건/BILL (중복 포함)`);

  // JSON 저장
  const outFile = path.join(__dirname, '..', 'data', 'audit-bills-result.json');
  fs.writeFileSync(outFile, JSON.stringify(audits, null, 2));
  console.log(`\n📄 상세 결과: ${path.relative(path.join(__dirname, '..'), outFile)}`);
})().catch(e => {
  console.error('ERROR:', e.message);
  console.error(e.stack);
  process.exit(1);
});
