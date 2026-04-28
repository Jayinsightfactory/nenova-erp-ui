// 17-2 MEL — display 단위 사용 시 입고 원본과 일치하는지 검증
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

const WK = 5580;

(async () => {
  const pool = await sql.connect(cfg);
  const dRes = await pool.request().query(`
    SELECT wd.WdetailKey, wd.ProdKey, wd.BoxQuantity, wd.BunchQuantity, wd.SteamQuantity, wd.UPrice, wd.TPrice,
           wm.FarmName, p.ProdName, p.FlowerName, p.CounName, p.OutUnit, p.SteamOf1Bunch, p.Cost,
           p.BoxWeight AS P_BoxWeight, p.BoxCBM AS P_BoxCBM, p.TariffRate AS P_TariffRate
    FROM WarehouseDetail wd INNER JOIN WarehouseMaster wm ON wd.WarehouseKey=wm.WarehouseKey
    LEFT JOIN Product p ON wd.ProdKey=p.ProdKey
    WHERE wd.WarehouseKey=${WK} ORDER BY wd.WdetailKey
  `);
  const fRes = await pool.request().query(`SELECT FlowerName, BoxWeight, BoxCBM, StemsPerBox FROM Flower WHERE isDeleted=0`);

  const allRows = dRes.recordset;
  const freightRows = allRows.filter(r => isFreightRow(r));
  const rows = allRows.filter(r => !isFreightRow(r));

  // 카테고리 오버라이드
  const cat = loadOverrides(true);
  for (const r of rows) {
    const ov = r.ProdKey ? cat[r.ProdKey] : null;
    if (ov && ov.category) r.FlowerName = ov.category;
  }

  // GW/CW 추출
  const isGwName = n => /^\s*gross\s*weig[h]?t[h]?\s*$/i.test(String(n||'').trim());
  const isCwName = n => /^\s*chargeable\s*weig[h]?t[h]?\s*$/i.test(String(n||'').trim());
  const weightOfRow = r => {
    const v = [r.BoxQuantity, r.BunchQuantity, r.SteamQuantity].map(x=>Number(x)||0).filter(x=>x>1);
    return v.length ? Math.max(...v) : 0;
  };
  const gw = freightRows.filter(r => isGwName(r.ProdName)).reduce((a,r)=>a+weightOfRow(r), 0);
  const cw = freightRows.filter(r => isCwName(r.ProdName)).reduce((a,r)=>a+weightOfRow(r), 0);
  const actualFreightUSD = freightRows.reduce((a,r)=>a+(Number(r.TPrice)||0), 0);

  const flowerMeta = {};
  for (const f of fRes.recordset) flowerMeta[normalizeFlower(f.FlowerName)] = {
    boxWeight: f.BoxWeight != null ? Number(f.BoxWeight) : null,
    boxCBM: f.BoxCBM != null ? Number(f.BoxCBM) : null,
    stemsPerBox: f.StemsPerBox != null ? Number(f.StemsPerBox) : null,
  };
  const productMeta = {};
  for (const r of rows) productMeta[r.ProdKey] = {
    boxWeight: r.P_BoxWeight != null ? Number(r.P_BoxWeight) : null,
    boxCBM: r.P_BoxCBM != null ? Number(r.P_BoxCBM) : null,
    tariffRate: r.P_TariffRate != null ? Number(r.P_TariffRate) : null,
  };
  // SIM 누락 BoxWeight 보충
  const SIM = { '장미':0.8, '안개꽃':1.0, '리시안서스':0.6, '기타':0.4 };
  for (const r of rows) if (productMeta[r.ProdKey].boxWeight == null) {
    const v = SIM[r.FlowerName]; if (v) productMeta[r.ProdKey].boxWeight = v;
  }

  const boxByFlower = new Map();
  for (const r of rows) boxByFlower.set((r.FlowerName||'').trim(), (boxByFlower.get((r.FlowerName||'').trim())||0) + (Number(r.BoxQuantity)||0));
  const seen = new Set();
  const details = rows.map(r => {
    const fn = (r.FlowerName||'').trim();
    const first = !seen.has(fn); if (first) seen.add(fn);
    return {
      warehouseDetailKey: r.WdetailKey, prodKey: r.ProdKey, prodName: r.ProdName,
      flowerName: fn, counName: r.CounName, farmName: r.FarmName,
      outUnit: (r.OutUnit||'').trim() || null,
      boxQty: first ? (boxByFlower.get(fn)||0) : 0,
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
    master: { warehouseKey: WK, gw, cw, rateUSD: 0, docFeeUSD: 0, exchangeRate: 220, invoiceUSD: 0, itemCount: 0, actualFreightUSD: actualFreightUSD || null },
    basis: 'AUTO',
    customs: { bakSangRate: 460, handlingFee: 33000, quarantinePerItem: 10000, domesticFreight: 99000, deductFee: 40000, extraFee: 0 },
    details, productMeta, flowerMeta,
  });

  console.log('# 17-2 MEL — display 단위 검증 (DB TPrice vs E×F)\n');
  console.log('| 품목 | OutUnit | display Qty | display FOB | E×F | DB TPrice | 일치? |');
  console.log('|---|---|---|---|---|---|---|');
  let ok = 0, fail = 0;
  for (const r of result.rows) {
    const tpExpected = (Number(r.displayQty)||0) * (Number(r.displayFobUSD)||0);
    const tpActual = Number(details.find(d => d.prodKey === r.prodKey)?.totalPriceUSD) || 0;
    const match = Math.abs(tpExpected - tpActual) < 0.01;
    if (match) ok++; else fail++;
    const name = (r.prodName || '').substring(0, 35);
    console.log(`| ${name} | ${r.displayUnit} | ${r.displayQty} | ${r.displayFobUSD} | ${tpExpected} | ${tpActual} | ${match?'✅':'❌'} |`);
  }
  console.log(`\n## 결과: ${ok}/${ok+fail} 일치 (${(ok/(ok+fail)*100).toFixed(0)}%)\n`);

  console.log('## 카테고리별 display 단위 + 운임');
  for (const c of result.categories) {
    console.log(`  - ${c.flowerName.padEnd(8)} | displayUnit=${c.displayUnit} displayQty=${c.displayQty} | freightUSD=${c.freightUSD.toFixed(2)} per${c.displayUnit}=${(c.freightPerDisplayUnit||0).toFixed(3)}`);
  }

  await pool.close();
})().catch(e => { console.error('ERR:', e.stack || e.message); process.exit(1); });
