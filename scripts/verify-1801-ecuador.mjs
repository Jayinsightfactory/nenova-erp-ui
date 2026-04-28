// 18-1 Ecuador (WK=5592 Freightwise + WK=5593 La Rosaleda, AWB=00645341133) 검증
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import sql from 'mssql';
import { computeFreightCost, normalizeFlower, isFreightForwarder, isFreightRow } from '../lib/freightCalc.js';
import { loadOverrides } from '../lib/categoryOverrides.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8').split(/\r?\n/).forEach(line => {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) process.env[m[1]] = m[2];
});

const cfg = {
  server: process.env.DB_SERVER, port: parseInt(process.env.DB_PORT || '1433'),
  database: process.env.DB_NAME, user: process.env.DB_USER, password: process.env.DB_PASSWORD,
  options: { encrypt:false, trustServerCertificate:true, enableArithAbort:true, connectTimeout:30000, requestTimeout:60000 },
};

const AWB = '00645341133';

const EXCEL = {
  C5: '18-1', C7_exchange: 1500,
  C8_GW: 193, E8_CW: 277,
  C10_totalQty: 2500,
  C11_freightUSD: 1048.15,
  G11_rate: 3.45, E11_fixed: 92.5,
  P6_baksang: 88780,    // = GW * 460
  P7_handling: 27000,   // = 포목수3 * 9000
  P8_quarantine: 36000, // 하드코딩
  P9_domestic: 90000,
  R6_deduct: 20000,
  P10_total: 261780,
  rows: [
    { name: 'Channel  AS154',     E: 300, F: 0.65, M: 2109.57 },
    { name: 'Electric MO',        E: 700, F: 0.65, M: 2109.57 },
    { name: 'Tinted Dark Whisper',E: 600, F: 0.65, M: 2109.57 },
    { name: 'Tinted Shiny Pearl', E: 300, F: 0.75, M: 2297.07 },
    { name: 'Mayra Rose Bridal',  E: 100, F: 0.50, M: 1828.32 },
  ],
};

(async () => {
  const pool = await sql.connect(cfg);

  // AWB 그룹의 모든 WK 조회
  const wkRes = await pool.request().query(`
    SELECT WarehouseKey FROM WarehouseMaster
    WHERE REPLACE(REPLACE(OrderNo,'-',''),' ','')='${AWB}' AND isDeleted=0
    ORDER BY WarehouseKey
  `);
  const wkList = wkRes.recordset.map(r => r.WarehouseKey).join(',');
  console.log(`# AWB=${AWB} → WK=[${wkList}]\n`);

  const dRes = await pool.request().query(`
    SELECT wd.WarehouseKey, wd.WdetailKey, wd.ProdKey, wd.BoxQuantity, wd.BunchQuantity, wd.SteamQuantity,
           wd.UPrice, wd.TPrice, wd.OrderCode, wm.FarmName,
           p.ProdName, p.FlowerName, p.CounName, p.SteamOf1Bunch, p.Cost,
           p.BoxWeight AS P_BoxWeight, p.BoxCBM AS P_BoxCBM, p.TariffRate AS P_TariffRate
    FROM WarehouseDetail wd
    INNER JOIN WarehouseMaster wm ON wd.WarehouseKey=wm.WarehouseKey
    LEFT JOIN Product p ON wd.ProdKey=p.ProdKey
    WHERE wd.WarehouseKey IN (${wkList})
    ORDER BY wd.WdetailKey
  `);
  const fRes = await pool.request().query(`SELECT FlowerName, BoxWeight, BoxCBM, StemsPerBox, DefaultTariff FROM Flower WHERE isDeleted=0`);

  const allRows = dRes.recordset;
  const freightRows = allRows.filter(r => isFreightRow(r));
  const rows = allRows.filter(r => !isFreightRow(r));

  // 카테고리 오버라이드 적용
  const catOverrides = loadOverrides(true);
  let overriddenCount = 0;
  for (const r of rows) {
    const ov = r.ProdKey ? catOverrides[r.ProdKey] : null;
    if (ov && ov.category) { r.FlowerName = ov.category; overriddenCount++; }
  }
  console.log(`# 카테고리 오버라이드 ${overriddenCount}/${rows.length}건 적용 (Ecuador 는 모두 장미라 기본 0건 예상)\n`);

  // 항공료 추출 (운송료 행 TPrice 합산)
  const actualFreightUSD = freightRows.reduce((a, r) => a + (Number(r.TPrice) || 0), 0);
  const freightMainRow = freightRows.find(r => Number(r.UPrice) > 0);
  const isRatePattern = freightMainRow && (Number(freightMainRow.BunchQuantity) || 0) > 1;
  const extractedRate = isRatePattern ? Number(freightMainRow.UPrice) || 0 : 0;

  // GW/CW 추출
  const isGwName = n => /^\s*gross\s*weig[h]?t[h]?\s*$/i.test(String(n||'').trim());
  const isCwName = n => /^\s*chargeable\s*weig[h]?t[h]?\s*$/i.test(String(n||'').trim());
  const weightOfRow = r => {
    const vals = [r.BoxQuantity, r.BunchQuantity, r.SteamQuantity].map(v => Number(v)||0).filter(v => v > 1);
    return vals.length ? Math.max(...vals) : 0;
  };
  const gw = freightRows.filter(r => isGwName(r.ProdName)).reduce((a,r) => a + weightOfRow(r), 0);
  const cw = freightRows.filter(r => isCwName(r.ProdName)).reduce((a,r) => a + weightOfRow(r), 0);

  const exRate = 1500;  // 사용자 박제 (USD)

  const flowerMeta = {};
  for (const f of fRes.recordset) flowerMeta[normalizeFlower(f.FlowerName)] = {
    boxWeight: f.BoxWeight != null ? Number(f.BoxWeight) : null,
    boxCBM: f.BoxCBM != null ? Number(f.BoxCBM) : null,
    stemsPerBox: f.StemsPerBox != null ? Number(f.StemsPerBox) : null,
    defaultTariff: f.DefaultTariff != null ? Number(f.DefaultTariff) : null,
  };

  const productMeta = {};
  for (const r of rows) productMeta[r.ProdKey] = {
    boxWeight: r.P_BoxWeight != null ? Number(r.P_BoxWeight) : null,
    boxCBM: r.P_BoxCBM != null ? Number(r.P_BoxCBM) : null,
    tariffRate: r.P_TariffRate != null ? Number(r.P_TariffRate) : 0.25,  // 에콰도르 모두 0.25
  };

  // [SIM] 에콰도르 장미 단당무게 (엑셀에는 명시 없음, GW=193 / 2500송이 = 0.0772)
  // 모두 동일 단가/조건이므로 boxWeight 균등하게 부여
  const SIM_BW = 193 / 2500;  // = 0.0772
  let simulated = 0;
  for (const r of rows) {
    if (productMeta[r.ProdKey].boxWeight == null) {
      productMeta[r.ProdKey].boxWeight = SIM_BW;
      simulated++;
    }
  }
  console.log(`# [SIM] Product.BoxWeight 누락 ${simulated}건을 GW/총수량=${SIM_BW.toFixed(4)}로 임시 채움\n`);

  const boxByFlower = new Map();
  for (const r of rows) {
    const fn = (r.FlowerName || '').trim();
    boxByFlower.set(fn, (boxByFlower.get(fn) || 0) + (Number(r.BoxQuantity) || 0));
  }
  const itemCount = [...new Set(rows.map(r => (r.FlowerName||'').trim()))].filter(Boolean).length;
  const invoiceUSD = rows.reduce((a,r) => a + (Number(r.TPrice)||0), 0);

  const flowerSeen = new Set();
  const details = rows.map(r => {
    const fn = (r.FlowerName||'').trim();
    const isFirst = !flowerSeen.has(fn);
    if (isFirst) flowerSeen.add(fn);
    return {
      warehouseDetailKey: r.WdetailKey, prodKey: r.ProdKey, prodName: r.ProdName,
      flowerName: fn, counName: r.CounName, farmName: r.FarmName,
      boxQty: isFirst ? (boxByFlower.get(fn)||0) : 0,
      rawBoxQty: Number(r.BoxQuantity)||0,
      bunchQty: Number(r.BunchQuantity)||0,
      steamQty: Number(r.SteamQuantity)||0,
      fobUSD: Number(r.UPrice)||0,
      totalPriceUSD: Number(r.TPrice)||0,
      stemsPerBunch: Number(r.SteamOf1Bunch)||1,  // Ecuador 송이당=단당
      salePriceKRW: Number(r.Cost)||0,
      tariffRate: r.P_TariffRate != null ? Number(r.P_TariffRate) : 0.25,
    };
  });

  const result = computeFreightCost({
    master: { warehouseKey: wkRes.recordset[0].WarehouseKey, gw, cw, rateUSD: extractedRate, docFeeUSD: 0, exchangeRate: exRate, invoiceUSD, itemCount, actualFreightUSD: actualFreightUSD || null },
    basis: 'AUTO',
    customs: { bakSangRate: 460, handlingFee: 0, quarantinePerItem: 9000, domesticFreight: 90000, deductFee: 20000, extraFee: 36000 },
    // 18-1: 통관수수료 = 포목수*9000 = 27000 → quarantinePerItem 으로 매핑 (포목수=3)
    // 검역수수료 36000 → extraFee 로 분리
    details, productMeta, flowerMeta,
  });

  const cmp = (label, excel, computed, tol=1) => {
    const ok = Math.abs(Number(excel) - Number(computed)) < tol;
    console.log(`  ${ok?'✅':'❌'} ${label.padEnd(28)} 엑셀=${excel}, 계산=${computed}`);
  };

  console.log('# 18-1 Ecuador (AWB=00645341133) — 엑셀 vs 코드 계산 검증\n');
  console.log('## [헤더값]');
  cmp('GW (193)', 193, gw);
  cmp('CW (277)', 277, cw);
  cmp('환율 (1500)', 1500, exRate);
  cmp('Rate USD/kg (3.45)', 3.45, extractedRate, 0.01);
  cmp('항공료 USD (1048.15)', 1048.15, result.header.freightTotalUSD, 1);
  cmp('백상 (88780=GW*460)', 88780, gw * 460);

  console.log('\n## [카테고리별 분배]');
  console.log('  (Ecuador: 카테고리 1개 = 장미 만, 분배 = 100%)');
  for (const cat of result.categories) {
    console.log(`  - ${cat.flowerName.padEnd(10)} 단=${cat.bunchCount} 송이=${cat.stemsCount} 운임USD=${(cat.freightUSD||0).toFixed(2)} 송이당=${(cat.freightPerStemUSD||0).toFixed(4)}`);
  }

  console.log('\n## [핵심 행 검증]');
  for (const erow of EXCEL.rows) {
    const found = result.rows.find(r => r.prodName?.includes(erow.name.split(' ')[0]) && r.prodName?.includes(erow.name.split(' ').slice(-1)[0]));
    if (!found) { console.log(`  ❌ ${erow.name} — 코드 결과에 없음`); continue; }
    console.log(`  품목: ${found.prodName.substring(0,55)}`);
    cmp(`  E 수량 (${erow.E})`, erow.E, found.steamQty);
    cmp(`  F FOB (${erow.F})`, erow.F, found.fobUSD, 0.01);
    cmp(`  M 도착원가 (${erow.M})`, erow.M, found.arrivalPerStem, 50);
    console.log('');
  }

  console.log('## [경고]');
  for (const w of result.warnings) console.log(`  [${w.level}] ${w.msg}`);

  console.log('\n## [총 결론]');
  console.log(`  계산된 행: ${result.rows.length}개`);
  console.log(`  카테고리 분류: ${result.categories.length}개`);
  console.log(`  freightSource: ${result.header.freightSource}`);
  console.log(`  invoiceUSD = ${invoiceUSD.toFixed(2)}`);

  await pool.close();
})().catch(e => { console.error('ERR:', e.stack || e.message); process.exit(1); });
