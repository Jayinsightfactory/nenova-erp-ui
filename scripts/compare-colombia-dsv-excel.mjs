/**
 * 25-1 콜롬비아 + DSV(수국/루스커스) Excel vs ERP 최신 반영 비교
 * node scripts/compare-colombia-dsv-excel.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import ExcelJS from 'exceljs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envText = fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8');
envText.split(/\r?\n/).forEach(line => {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) process.env[m[1]] = m[2];
});
const { query, sql } = await import('../lib/db.js');

const FILES = {
  colombia: 'C:\\Users\\USER\\Downloads\\25-1 콜롬비아 원가자료 (2).xlsx',
  dsv: 'C:\\Users\\USER\\Downloads\\단가원가 DSV (수국, 루스커스).xlsx',
};

function cellVal(v) {
  if (v == null) return '';
  if (typeof v === 'number' || typeof v === 'boolean') return v;
  if (typeof v === 'object' && v.richText) return v.richText.map(t => t.text).join('');
  if (typeof v === 'object' && v.formula != null) return v.result != null ? v.result : v.formula;
  return String(v).trim();
}

function norm(s) {
  return String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function excelWeekToDb(w) {
  const s = String(w || '').trim();
  const m = s.match(/^(\d{1,2})-(\d{1,2})([A-Z]?)$/i);
  if (m) return `${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}${(m[3] || '').toUpperCase()}`;
  return s;
}

function tokenSet(s) {
  return new Set(norm(s).replace(/[^\w\s가-힣/]/g, ' ').split(/\s+/).filter(t => t.length > 2));
}

function matchScore(a, b) {
  const ta = tokenSet(a);
  const tb = tokenSet(b);
  if (!ta.size || !tb.size) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return inter / Math.max(ta.size, tb.size);
}

/** 콜롬비아 원가자료 시트 (Farm col1, Product col2, FOB col6) */
function parseColombiaSheet(ws) {
  let week = ws.name;
  for (let r = 1; r <= 10; r++) {
    if (norm(cellVal(ws.getRow(r).getCell(2).value)) === '차수') {
      week = String(cellVal(ws.getRow(r).getCell(3).value)).trim() || week;
      break;
    }
  }
  let headerRow = -1;
  for (let r = 1; r <= 20; r++) {
    const t = norm(cellVal(ws.getRow(r).getCell(2).value));
    if (t.includes('color') && t.includes('grade')) { headerRow = r; break; }
  }
  const products = [];
  let curFarm = '';
  if (headerRow > 0) {
    for (let r = headerRow + 1; r <= ws.rowCount; r++) {
      const farm = String(cellVal(ws.getRow(r).getCell(1).value)).trim();
      const name = String(cellVal(ws.getRow(r).getCell(2).value)).replace(/\s+/g, ' ').trim();
      if (farm) curFarm = farm;
      if (!name || name.length < 3) continue;
      if (/^total$|^합계/i.test(name)) break;
      const qty = Number(cellVal(ws.getRow(r).getCell(5).value)) || 0;
      const fob = Number(cellVal(ws.getRow(r).getCell(6).value)) || 0;
      if (!fob && !qty) continue;
      const flower = name.split(/\s+/)[0].toUpperCase();
      products.push({ farm: curFarm, name, flower, qty, fob, week });
    }
  }
  return { week, dbWeek: excelWeekToDb(week.replace(/[A-Z]$/i, m => m)), products };
}

/** DSV 수국/루스커스 시트 */
function parseDsvSheet(ws) {
  let headerRow = -1;
  for (let r = 1; r <= 20; r++) {
    if (norm(cellVal(ws.getRow(r).getCell(1).value)) === '아이템') { headerRow = r; break; }
  }
  const products = [];
  if (headerRow > 0) {
    for (let r = headerRow + 1; r <= ws.rowCount; r++) {
      const item = String(cellVal(ws.getRow(r).getCell(1).value)).trim();
      const farm = String(cellVal(ws.getRow(r).getCell(2).value)).trim();
      const color = String(cellVal(ws.getRow(r).getCell(3).value)).trim();
      const size = String(cellVal(ws.getRow(r).getCell(4).value)).trim();
      if (!item || !farm) continue;
      const fob = Number(cellVal(ws.getRow(r).getCell(5).value)) || 0;
      const cnfKrw = Number(cellVal(ws.getRow(r).getCell(10).value)) || 0;
      if (!fob && !cnfKrw) continue;
      const name = `${item} ${farm} ${color} ${size}`.replace(/\s+/g, ' ').trim();
      products.push({ item, farm, color, size, name, fob, cnfKrw, sheet: ws.name });
    }
  }
  return products;
}

async function getDbWeekDetails(orderWeek, orderYear = '2026') {
  const yws = orderYear + orderWeek.replace(/-/g, '').replace(/[A-Z]/gi, '');
  const r = await query(
    `SELECT wm.FarmName, wm.OrderWeek, wm.OrderNo AS AWB,
            p.ProdKey, p.ProdName, p.FlowerName, p.CounName,
            wd.UPrice, wd.OutQuantity
     FROM WarehouseDetail wd
     JOIN WarehouseMaster wm ON wd.WarehouseKey = wm.WarehouseKey
     LEFT JOIN Product p ON wd.ProdKey = p.ProdKey AND p.isDeleted = 0
     WHERE wm.isDeleted = 0
       AND wm.OrderYear = @y
       AND wm.OrderWeek = @wk
       AND ISNULL(p.ProdName,'') NOT LIKE N'%운송%'
       AND ISNULL(p.ProdName,'') NOT LIKE N'%weight%'
       AND ISNULL(wd.OutQuantity,0) > 0
     ORDER BY wm.FarmName, p.ProdName`,
    {
      y: { type: sql.NVarChar, value: orderYear },
      wk: { type: sql.NVarChar, value: orderWeek },
    },
  );
  return r.recordset;
}

async function getLatestWeek(year = '2026') {
  const r = await query(
    `SELECT TOP 1 OrderYear, OrderWeek
     FROM WarehouseMaster WHERE isDeleted=0 AND OrderYear=@y AND OrderWeek IS NOT NULL
     ORDER BY OrderYear + REPLACE(REPLACE(OrderWeek,'-',''),' ','') DESC`,
    { y: { type: sql.NVarChar, value: year } },
  );
  return r.recordset[0] || null;
}

async function getDbFlowersForWeek(orderWeek, orderYear = '2026') {
  const rows = await getDbWeekDetails(orderWeek, orderYear);
  const map = new Map();
  for (const r of rows) {
    const fn = r.FlowerName || '(null)';
    if (!map.has(fn)) map.set(fn, { count: 0, farms: new Set(), products: [] });
    const e = map.get(fn);
    e.count += 1;
    e.farms.add(r.FarmName?.trim());
    e.products.push(r);
  }
  return { rows, map };
}

function flowerFromProductName(name) {
  const n = norm(name);
  if (n.includes('carnation') || n.includes('카네')) return 'CARNATION';
  if (n.includes('rose') || n.includes('장미')) return 'ROSE';
  if (n.includes('alstro') || n.includes('알스트로')) return 'ALSTROMERIA';
  if (n.includes('ruscus') || n.includes('루스커스')) return 'RUSCUS';
  if (n.includes('hydrangea') || n.includes('수국')) return 'HYDRANGEA';
  if (n.includes('limonium') || n.includes('리모')) return 'LIMONIUM';
  if (n.includes('gypsophila') || n.includes('안개')) return 'GYPSOPHILA';
  return name.split(/\s+/)[0].toUpperCase();
}

function summarizeFlowers(products, keyFn) {
  const m = new Map();
  for (const p of products) {
    const k = keyFn(p);
    if (!m.has(k)) m.set(k, 0);
    m.set(k, m.get(k) + 1);
  }
  return m;
}

(async () => {
  const latest = await getLatestWeek('2026');
  console.log('ERP 최신 입고 차수:', latest?.OrderYear, latest?.OrderWeek);

  // ── Colombia 25-1 ──
  const wb1 = new ExcelJS.Workbook();
  await wb1.xlsx.readFile(FILES.colombia);
  const sheet25 = wb1.getWorksheet('25-1') || wb1.worksheets[wb1.worksheets.length - 1];
  const col = parseColombiaSheet(sheet25);
  console.log(`\n=== 콜롬비아 Excel 시트 ${sheet25.name} ===`);
  console.log(`품목 ${col.products.length}건, Excel 차수=${col.week}, DB형식=${col.dbWeek}`);

  const targetWeeks = ['25-01', '24-02', '24-01'];
  let db25 = await getDbWeekDetails('25-01', '2026');
  if (!db25.length) {
    console.log('⚠ DB에 2026-25-01 입고 없음 — 최신차수/24-02 와 비교');
    db25 = await getDbWeekDetails(latest?.OrderWeek || '24-02', '2026');
  }
  const compareWeek = db25[0]?.OrderWeek || latest?.OrderWeek || '24-02';
  console.log(`DB 비교 차수: ${compareWeek} (${db25.length}품목)`);

  const excelFlowers = summarizeFlowers(col.products, p => flowerFromProductName(p.name));
  const dbFlowers = summarizeFlowers(db25, r => (r.FlowerName || '').trim());

  console.log('\n[품종별 Excel 25-1]');
  [...excelFlowers.entries()].sort((a, b) => b[1] - a[1]).forEach(([f, c]) => console.log(`  ${f}: ${c}품목`));
  console.log(`\n[품종별 DB ${compareWeek}]`);
  [...dbFlowers.entries()].sort((a, b) => b[1] - a[1]).forEach(([f, c]) => console.log(`  ${f}: ${c}품목`));

  const excelOnlyFlowers = [...excelFlowers.keys()].filter(f => !dbFlowers.has(f) && f !== '(NULL)');
  const dbOnlyFlowers = [...dbFlowers.keys()].filter(f => !excelFlowers.has(f));

  console.log('\n🔴 Excel 25-1에만 있는 품종 (DB 최신차수 미반영):');
  excelOnlyFlowers.forEach(f => {
    const samples = col.products.filter(p => flowerFromProductName(p.name) === f).slice(0, 3);
    console.log(`  ${f} (${excelFlowers.get(f)}품목) — e.g. ${samples.map(s => s.name).join(' | ')}`);
  });

  console.log('\n🟡 DB에만 있는 품종 (Excel 25-1 없음):');
  dbOnlyFlowers.slice(0, 15).forEach(f => console.log(`  ${f}: ${dbFlowers.get(f)}품목`));

  // Product level match
  const matched = [];
  const excelOnly = [];
  const priceMismatch = [];
  for (const ex of col.products) {
    let best = null;
    let bestScore = 0;
    for (const db of db25) {
      const s = matchScore(ex.name, db.ProdName);
      if (s > bestScore) { bestScore = s; best = db; }
      if (norm(ex.farm).includes(norm(db.FarmName).slice(0, 4)) || norm(db.FarmName).includes(norm(ex.farm).slice(0, 4))) {
        const s2 = matchScore(ex.name, db.ProdName) + 0.1;
        if (s2 > bestScore) { bestScore = s2; best = db; }
      }
    }
    if (bestScore >= 0.35 && best) {
      matched.push({ ex, db: best, score: bestScore });
      if (ex.fob > 0 && best.UPrice > 0 && Math.abs(ex.fob - best.UPrice) > 0.02) {
        priceMismatch.push({ ex, db: best, diff: ex.fob - best.UPrice });
      }
    } else {
      excelOnly.push(ex);
    }
  }

  console.log(`\n[25-1 품목 매칭] match=${matched.length} excel-only=${excelOnly.length} FOB차이=${priceMismatch.length}`);
  console.log('\nExcel-only 샘플 (최대 15):');
  excelOnly.slice(0, 15).forEach(x => console.log(`  [${x.farm}] ${x.name} FOB=${x.fob}`));

  console.log('\nFOB 불일치 샘플 (최대 10):');
  priceMismatch.slice(0, 10).forEach(m => {
    console.log(`  ${m.ex.name}: Excel=${m.ex.fob} DB=${m.db.UPrice} (${m.db.FarmName})`);
  });

  // Check if 25-01 exists at all in DB
  const wkCheck = await query(
    `SELECT OrderWeek, COUNT(DISTINCT wm.WarehouseKey) farms, COUNT(DISTINCT wd.ProdKey) prods
     FROM WarehouseMaster wm
     LEFT JOIN WarehouseDetail wd ON wd.WarehouseKey=wm.WarehouseKey
     LEFT JOIN Product p ON wd.ProdKey=p.ProdKey
     WHERE wm.isDeleted=0 AND wm.OrderYear='2026' AND wm.OrderWeek LIKE '25-%'
       AND ISNULL(wd.OutQuantity,0)>0 AND p.isDeleted=0
     GROUP BY OrderWeek ORDER BY OrderWeek`,
  );
  console.log('\n[DB 2026 25-xx 차수]');
  wkCheck.recordset.forEach(r => console.log(`  ${r.OrderWeek}: farms=${r.farms} prods=${r.prods}`));

  // ── DSV 수국/루스커스 ──
  const wb2 = new ExcelJS.Workbook();
  await wb2.xlsx.readFile(FILES.dsv);
  const dsvProducts = [];
  for (const sn of ['수국', '루스커스', '콜롬비아 DSV', '콜롬비아 KG']) {
    const ws = wb2.getWorksheet(sn);
    if (ws) dsvProducts.push(...parseDsvSheet(ws).map(p => ({ ...p, sourceSheet: sn })));
  }
  console.log(`\n=== DSV Excel (수국/루스커스) ===`);
  console.log(`품목 ${dsvProducts.length}건`);

  const dsvItems = summarizeFlowers(dsvProducts, p => p.item);
  console.log('[DSV 아이템]');
  [...dsvItems.entries()].forEach(([k, v]) => console.log(`  ${k}: ${v}`));

  // DB hydrangea/ruscus products latest week
  const hrDb = await query(
    `SELECT p.ProdKey, p.ProdName, p.FlowerName, wm.FarmName, wm.OrderWeek, wd.UPrice, wd.OutQuantity
     FROM WarehouseDetail wd
     JOIN WarehouseMaster wm ON wd.WarehouseKey=wm.WarehouseKey
     JOIN Product p ON wd.ProdKey=p.ProdKey AND p.isDeleted=0
     WHERE wm.isDeleted=0 AND wm.OrderYear='2026'
       AND (p.FlowerName LIKE N'%수국%' OR p.FlowerName LIKE N'%HYDR%' OR p.FlowerName LIKE N'%Ruscus%'
            OR p.FlowerName LIKE N'%루스%' OR p.ProdName LIKE N'%Hydrangea%' OR p.ProdName LIKE N'%Ruscus%'
            OR p.ProdName LIKE N'%수국%')
       AND ISNULL(wd.OutQuantity,0) > 0
       AND (wm.OrderYear + REPLACE(wm.OrderWeek,'-','')) >= '20262401'
     ORDER BY wm.OrderWeek DESC, p.ProdName`,
  );
  console.log(`\n[DB 수국/루스커스 24-01 이후] ${hrDb.recordset.length}건 (최신순)`);
  const dbHrFarms = new Set(hrDb.recordset.map(r => norm(r.FarmName)));
  const excelHrFarms = new Set(dsvProducts.map(p => norm(p.farm)));

  console.log('\nDSV Excel farms:', [...excelHrFarms].filter(Boolean).slice(0, 20).join(', '));
  console.log('DB farms (recent):', [...dbHrFarms].filter(Boolean).slice(0, 20).join(', '));

  const dsvExcelOnly = [];
  for (const ex of dsvProducts) {
    let best = null;
    let bestScore = 0;
    for (const db of hrDb.recordset) {
      const s = matchScore(`${ex.farm} ${ex.color}`, db.ProdName) * 0.7
        + matchScore(ex.item, db.FlowerName) * 0.3;
      if (norm(db.FarmName).includes(norm(ex.farm)) || norm(ex.farm).includes(norm(db.FarmName))) {
        const s2 = s + 0.15;
        if (s2 > bestScore) { bestScore = s2; best = db; }
      } else if (s > bestScore) { bestScore = s; best = db; }
    }
    if (bestScore < 0.3) dsvExcelOnly.push(ex);
  }

  console.log(`\n[DSV] DB 미매칭 ${dsvExcelOnly.length}건 / Excel ${dsvProducts.length}건`);
  console.log('DSV Excel-only 샘플:');
  dsvExcelOnly.slice(0, 20).forEach(x =>
    console.log(`  [${x.sourceSheet}] ${x.item} ${x.farm} ${x.color} ${x.size} FOB=${x.fob} CNF=${Math.round(x.cnfKrw)}`),
  );

  // Farms in DSV not in recent DB
  const farmNotInDb = [...excelHrFarms].filter(f => f && ![...dbHrFarms].some(d => d.includes(f) || f.includes(d)));
  console.log('\n🔴 DSV Excel farm → DB 최근 입고 없음:');
  farmNotInDb.slice(0, 15).forEach(f => {
    const items = dsvProducts.filter(p => norm(p.farm) === f);
    console.log(`  ${f} (${items.length}품목, ${items[0]?.item})`);
  });

  const report = {
    generatedAt: new Date().toISOString(),
    latestDbWeek: latest,
    colombia25: {
      excelWeek: col.week,
      excelProducts: col.products.length,
      dbCompareWeek: compareWeek,
      dbProducts: db25.length,
      excelOnlyFlowers,
      dbOnlyFlowers,
      excelOnlyCount: excelOnly.length,
      priceMismatchCount: priceMismatch.length,
      excelOnlySample: excelOnly.slice(0, 30).map(x => ({ farm: x.farm, name: x.name, fob: x.fob, flower: flowerFromProductName(x.name) })),
      priceMismatchSample: priceMismatch.slice(0, 20).map(m => ({ name: m.ex.name, excelFob: m.ex.fob, dbFob: m.db.UPrice, dbFarm: m.db.FarmName })),
    },
    dsv: {
      excelProducts: dsvProducts.length,
      dbHydrangeaRuscusRecent: hrDb.recordset.length,
      dsvExcelOnlyCount: dsvExcelOnly.length,
      farmNotInDb: farmNotInDb.slice(0, 20),
      dsvExcelOnlySample: dsvExcelOnly.slice(0, 30),
    },
  };
  fs.writeFileSync(path.join(__dirname, 'colombia-dsv-compare-report.json'), JSON.stringify(report, null, 2), 'utf8');
  console.log('\nReport: scripts/colombia-dsv-compare-report.json');
})().catch(e => { console.error(e); process.exit(1); });
