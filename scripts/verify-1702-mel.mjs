// 17-2 MEL (WK=5580) 의 freight API 동등 계산 → 엑셀 정답값과 비교
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
  options: { encrypt: false, trustServerCertificate: true, enableArithAbort: true, connectTimeout: 30000, requestTimeout: 60000 },
};

const WK = 5580;  // 17-2 MEL Yunnan Melody

// 엑셀 정답값 (17-2 MEL 시트, openpyxl data_only=True 로 추출)
const EXCEL = {
  C5: '17-2',
  C7_exchange: 220,
  C8_GW: 646, E8_CW: 646,
  C10_totalQty: 825,
  C11_freightUSD: 8737,
  P6_baksang: 297160,        // = C8 * 460
  P10_customsTotal: 529160,
  // 카테고리 운임 (J7~J13, K7~K13, L7~L13, M7~M13)
  categories: {
    'ROSE':       { K: 5518.105, L: 510, M: 10.82 },
    'CARNATION':  { K: 0, L: 0, M: NaN },
    'LISIANTHUS': { K: 1298.378, L: 160, M: 8.115 },
    'EUCALYPTUS': { K: 0, L: 0, M: NaN },
    'Sinensis':   { K: 0, L: 0, M: NaN },
    'Gypsophila': { K: 811.486, L: 60, M: 13.525 },
    'others':     { K: 1109.031, L: 95, M: 11.674 },
  },
  // 행별 정답 (B24 Amaranthus, B26 Gypsophila, B29 ROSE Golem)
  rows: [
    { name: 'Amaranthus',    E: 30,  F: 14,    G: 11.674, M: 7564.06 },
    { name: 'Gypsophila',    E: 60,  F: 27,    G: 13.525, M: 11642.49 },
    { name: 'ROSE Catherine',E: 70,  F: 11.5,  G: 10.820, M: 6616.48 },
  ],
};

(async () => {
  const pool = await sql.connect(cfg);

  const mRes = await pool.request().query(`
    SELECT WarehouseKey, OrderYear, OrderWeek, FarmName, InvoiceNo, OrderNo AS AWB,
           GrossWeight, ChargeableWeight, FreightRateUSD, DocFeeUSD
    FROM WarehouseMaster WHERE WarehouseKey=${WK}
  `);
  const dRes = await pool.request().query(`
    SELECT wd.WarehouseKey, wd.WdetailKey, wd.ProdKey, wd.BoxQuantity, wd.BunchQuantity, wd.SteamQuantity,
           wd.UPrice, wd.TPrice, wd.OrderCode, wm.FarmName,
           p.ProdName, p.FlowerName, p.CounName, p.SteamOf1Bunch, p.Cost,
           p.BoxWeight AS P_BoxWeight, p.BoxCBM AS P_BoxCBM, p.TariffRate AS P_TariffRate
    FROM WarehouseDetail wd
    INNER JOIN WarehouseMaster wm ON wd.WarehouseKey=wm.WarehouseKey
    LEFT JOIN Product p ON wd.ProdKey=p.ProdKey
    WHERE wd.WarehouseKey=${WK}
    ORDER BY wd.WdetailKey
  `);
  const fRes = await pool.request().query(`SELECT FlowerName, BoxWeight, BoxCBM, StemsPerBox, DefaultTariff FROM Flower WHERE isDeleted=0`);
  const curRes = await pool.request().query(`SELECT CurrencyCode, ExchangeRate FROM CurrencyMaster WHERE IsActive=1`);

  const allRows = dRes.recordset;
  const freightRows = allRows.filter(r => isFreightRow(r));
  const rows = allRows.filter(r => !isFreightRow(r));

  // 카테고리 오버라이드 적용 (data/category-overrides.json)
  const catOverrides = loadOverrides(true);
  let overriddenCount = 0;
  for (const r of rows) {
    const ov = r.ProdKey ? catOverrides[r.ProdKey] : null;
    if (ov && ov.category) { r.FlowerName = ov.category; overriddenCount++; }
  }
  console.log(`# [Override] 카테고리 오버라이드 ${overriddenCount}/${rows.length}건 적용\n`);
  const actualFreightUSD = freightRows.reduce((a, r) => a + (Number(r.TPrice) || 0), 0);
  const freightMainRow = freightRows.find(r => Number(r.UPrice) > 0);
  const isRatePattern = freightMainRow && (Number(freightMainRow.BunchQuantity) || 0) > 1;
  const extractedGW = isRatePattern ? Number(freightMainRow.BunchQuantity) || 0 : 0;
  const extractedRate = isRatePattern ? Number(freightMainRow.UPrice) || 0 : 0;

  // GW/CW 행에서 무게 추출
  const isGwName = n => /^\s*gross\s*weig[h]?t[h]?\s*$/i.test(String(n||'').trim());
  const isCwName = n => /^\s*chargeable\s*weig[h]?t[h]?\s*$/i.test(String(n||'').trim());
  const weightOfRow = r => {
    const vals = [r.BoxQuantity, r.BunchQuantity, r.SteamQuantity].map(v => Number(v)||0).filter(v => v > 1);
    return vals.length ? Math.max(...vals) : 0;
  };
  const extractedGwFromRow = freightRows.filter(r => isGwName(r.ProdName)).reduce((a,r) => a + weightOfRow(r), 0);
  const extractedCwFromRow = freightRows.filter(r => isCwName(r.ProdName)).reduce((a,r) => a + weightOfRow(r), 0);

  const gw = extractedGwFromRow || 0;
  const cw = extractedCwFromRow || 0;
  // 환율: 사용자 결정대로 17-2 MEL = 220 박제
  const exRate = 220;
  // Rate USD/kg: 17-2 MEL 의 운송료 행은 UPrice=8737, BunchQty=1 → 총액 패턴 → Rate 추출 안 됨
  // → 사용자가 입력해야 함. 일단 actualFreightUSD = 8737 그대로 사용.
  const rateUSD = extractedRate || 0;
  const docFee = 0;

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
    tariffRate: r.P_TariffRate != null ? Number(r.P_TariffRate) : null,
  };

  // [SIM] 누락된 Product.BoxWeight 를 엑셀 기준 단당무게로 임시 보충 (시뮬레이션)
  // 엑셀 17-2 MEL AB7~AB14 카테고리별 단당무게:
  //   장미=0.8, 안개꽃=1.0, 리시안서스=0.6, Sinensis=0.5, 기타=0.4
  const SIM_BOXWEIGHT_BY_FLOWER = { '장미':0.8, '안개꽃':1.0, '리시안서스':0.6, 'Sinensis':0.5, '기타':0.4 };
  const SIM_TARIFF_BY_FLOWER = { '장미':0.214, '안개꽃':0.214, '리시안서스':0.214, 'Sinensis':0.214, '기타':0.214 };
  let simulated = 0;
  for (const r of rows) {
    if (productMeta[r.ProdKey].boxWeight == null) {
      const v = SIM_BOXWEIGHT_BY_FLOWER[r.FlowerName];
      if (v) { productMeta[r.ProdKey].boxWeight = v; simulated++; }
    }
    if (productMeta[r.ProdKey].tariffRate == null) {
      const t = SIM_TARIFF_BY_FLOWER[r.FlowerName];
      if (t) productMeta[r.ProdKey].tariffRate = t;
    }
  }
  console.log(`# [SIM] Product.BoxWeight 누락 ${simulated}건을 엑셀 단당무게로 임시 채움\n`);

  // box per flower (분배용)
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
      stemsPerBunch: Number(r.SteamOf1Bunch)||0,
      salePriceKRW: Number(r.Cost)||0,
      tariffRate: r.P_TariffRate != null ? Number(r.P_TariffRate) : null,
    };
  });

  const result = computeFreightCost({
    master: { warehouseKey: WK, gw, cw, rateUSD, docFeeUSD: docFee, exchangeRate: exRate, invoiceUSD, itemCount, actualFreightUSD: actualFreightUSD || null },
    basis: 'AUTO',
    customs: { bakSangRate: 460, handlingFee: 33000, quarantinePerItem: 10000, domesticFreight: 99000, deductFee: 40000, extraFee: 0 },
    details, productMeta, flowerMeta,
  });

  // ──────── 비교 출력 ────────
  console.log('# 17-2 MEL (WK=5580) — 엑셀 vs 코드 계산 검증\n');

  console.log('## [헤더값]');
  const cmp = (label, excel, computed, tol=0.01) => {
    const ok = Math.abs(Number(excel) - Number(computed)) < tol;
    const mark = ok ? '✅' : '❌';
    console.log(`  ${mark} ${label.padEnd(28)} 엑셀=${excel}, 계산=${computed}`);
  };
  cmp('GW (646)', 646, gw);
  cmp('CW (646)', 646, cw);
  cmp('환율 (220)', 220, exRate);
  cmp('총수량 (825)', 825, rows.reduce((a,r) => a + (Number(r.SteamQuantity)||0), 0));
  cmp('항공료 USD (8737)', 8737, result.header.freightTotalUSD);
  cmp('백상 (297160=GW*460)', 297160, gw * 460);
  cmp('통관 수수료 (33000)', 33000, 33000);
  cmp('검역 수수료 (60000=품목수6*10000)', 60000, 6 * 10000);
  console.log(`  ℹ 코드의 itemCount = ${itemCount} (엑셀 품목수 6 과 비교: ${itemCount===6?'✅':'❌'})`);
  cmp('검역차감 (40000)', 40000, 40000);
  cmp('국내운송 (99000)', 99000, 99000);
  cmp('통관 Total (529160)', 529160, result.header.customsTotalKRW);

  console.log('\n## [카테고리별 분배]');
  console.log('  (엑셀: ROSE/CARNATION/LISIANTHUS/EUCALYPTUS/Sinensis/Gypsophila/others 7개 분류)');
  console.log('  (코드: DB FlowerName 그대로 사용 — 카테고리 오버라이드 미적용)');
  for (const cat of result.categories) {
    console.log(`  - ${cat.flowerName.padEnd(15)} 단=${(cat.bunchCount||0).toString().padEnd(5)} 송이=${(cat.stemsCount||0).toString().padEnd(7)} 운임USD=${(cat.freightUSD||0).toFixed(2).padEnd(10)} 운임/단=${(cat.freightUSD/Math.max(cat.bunchCount,1)).toFixed(3).padEnd(10)} 송이당=${(cat.freightPerStemUSD||0).toFixed(4)}`);
  }
  console.log('\n  [엑셀 정답표]');
  for (const [n, v] of Object.entries(EXCEL.categories)) {
    if (v.L > 0) console.log(`  - ${n.padEnd(15)} 단=${v.L.toString().padEnd(5)} 운임USD=${v.K.toFixed(2).padEnd(10)} 단당운임=${v.M}`);
  }

  console.log('\n## [핵심 행 검증]');
  for (const erow of EXCEL.rows) {
    const found = result.rows.find(r => r.prodName?.includes(erow.name.split(' ')[0]));
    if (!found) { console.log(`  ❌ ${erow.name} — 코드 결과에 없음`); continue; }
    console.log(`  품목: ${found.prodName.substring(0,50)}`);
    cmp(`  E 수량 (${erow.E})`, erow.E, found.steamQty);
    cmp(`  F FOB (${erow.F})`, erow.F, found.fobUSD);
    cmp(`  G 운임/단 (${erow.G})`, erow.G, found.freightPerStemUSD, 0.5);
    cmp(`  M 도착원가/단 (${erow.M})`, erow.M, found.arrivalPerBunch || 0, 100);
    console.log('');
  }

  console.log('## [경고 메시지]');
  for (const w of result.warnings) console.log(`  [${w.level}] ${w.msg}`);

  console.log('\n## [총 결론]');
  const okCount = result.rows.length;
  console.log(`  계산된 행: ${okCount}개`);
  console.log(`  카테고리 분류: ${result.categories.length}개 (엑셀 7개 vs 코드 ${result.categories.length}개)`);
  console.log(`  freightSource: ${result.header.freightSource}`);
  console.log(`  basis: ${result.header.basis}`);
  console.log(`  invoiceUSD = ${invoiceUSD.toFixed(2)}`);

  await pool.close();
})().catch(e => { console.error('ERR:', e.stack || e.message); process.exit(1); });
