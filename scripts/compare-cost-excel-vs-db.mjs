/**
 * Compare supplier 원가자료 Excel vs ERP WarehouseMaster/Detail (운송기준원가 업로드)
 * Usage: node scripts/compare-cost-excel-vs-db.mjs
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

const COST_DIR = 'C:\\Users\\USER\\Downloads\\원가자료';

/** filename → ERP FarmName search hints */
const FILE_FARM_HINTS = {
  'Hood Canal': ['Hood Canal'],
  'NZBLOOM': ['NZ Bloom', 'NZBLOOM'],
  'PREMIUM GREENS': ['Premium Greens'],
  'VT SUNPRIDE': ['Royal Base', 'Sunpride', 'SUNPRIDE'],
  '덴파레': ['덴파레', 'Denpa', 'Apollo', '태국'],
  '2중국': ['Cloudland', 'Yunnan Melody', 'Melody'],
  'Ecuador': ['Ecuador', 'Freightwise Ecuador'],
  'NL': ['Holex'],
};

function excelWeekToDb(w) {
  const n = normWeek(w);
  const m = n.match(/^(\d{1,2})-(\d)$/);
  if (m) return `${m[1].padStart(2, '0')}-0${m[2]}`;
  const m2 = n.match(/^(\d{1,2})-(\d{2})$/);
  if (m2) return `${m2[1].padStart(2, '0')}-${m2[2]}`;
  return n;
}

function cellVal(v) {
  if (v == null) return '';
  if (typeof v === 'number' || typeof v === 'boolean') return v;
  if (typeof v === 'object' && v.richText) return v.richText.map(t => t.text).join('');
  if (typeof v === 'object' && v.formula != null) return v.result != null ? v.result : v.formula;
  return String(v).trim();
}

function norm(s) {
  return String(s || '')
    .replace(/[\r\n_x000b_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function normWeek(w) {
  const s = String(w || '').trim().replace(/\./g, '-');
  const m = s.match(/(\d{1,2})\s*[-–]\s*(\d+)/);
  if (m) return `${m[1].padStart(2, '0')}-${m[2]}`;
  return s;
}

function parseSheet(ws) {
  let farmName = '';
  let week = '';
  let headerRow = -1;
  let fobCol = -1;
  let qtyCol = -1;
  let nameCol = 2;
  let gradeCol = 3;
  let arrivalCol = -1;

  for (let r = 1; r <= Math.min(30, ws.rowCount); r++) {
    const c2 = cellVal(ws.getRow(r).getCell(2).value);
    const c3 = cellVal(ws.getRow(r).getCell(3).value);
    if (!farmName && r <= 4 && c2 && c2.length > 5) {
      const line = String(c2).replace(/\s+/g, ' ').trim();
      if (/[A-Za-z가-힣]/.test(line) && !/Invoice|Gross|총수량|품목수|차수|Color|Grade|Ecuador [A-Z]/.test(line)) {
        farmName = line;
      }
    }
    if (norm(c2) === '차수' || c2 === '차수') week = normWeek(c3);
    const rowText = [];
    for (let c = 2; c <= 12; c++) rowText.push(norm(cellVal(ws.getRow(r).getCell(c).value)));
    if (rowText.some(t => t.includes('color') && t.includes('grade')) || rowText.includes('color grade')) {
      headerRow = r;
      for (let c = 2; c <= 15; c++) {
        const h = norm(cellVal(ws.getRow(r).getCell(c).value));
        if (h === 'fob' || h.startsWith('fob')) fobCol = c;
        if (h.includes('수량') || h === 'qty') qtyCol = c;
        if (h.includes('도착단가') || h.includes('도착 원가')) arrivalCol = c;
      }
      if (fobCol < 0) {
        // CNF layout (NZBLOOM etc): col5=CNF, col12=도착단가
        for (let c = 2; c <= 15; c++) {
          const h = norm(cellVal(ws.getRow(r).getCell(c).value));
          if (h.includes('cnf') && !h.includes('총') && fobCol < 0) fobCol = c;
        }
      }
    }
  }

  const products = [];
  if (headerRow > 0) {
    for (let r = headerRow + 1; r <= ws.rowCount; r++) {
      const name = String(cellVal(ws.getRow(r).getCell(nameCol).value)).replace(/\s+/g, ' ').trim();
      const grade = String(cellVal(ws.getRow(r).getCell(gradeCol).value)).replace(/\s+/g, ' ').trim();
      if (!name || name.length < 2) continue;
      if (/^total$|^합계|^소계/i.test(name)) break;
      const qty = qtyCol > 0 ? Number(cellVal(ws.getRow(r).getCell(qtyCol).value)) || 0 : 0;
      const fob = fobCol > 0 ? Number(cellVal(ws.getRow(r).getCell(fobCol).value)) || 0 : 0;
      const arrival = arrivalCol > 0 ? Number(cellVal(ws.getRow(r).getCell(arrivalCol).value)) || 0 : 0;
      if (!name && !fob && !qty) continue;
      const fullName = grade && grade !== name ? `${name} / ${grade}` : name;
      if (qty > 0 || fob > 0) {
        products.push({ name: fullName, rawName: name, grade, qty, fob, arrival });
      }
    }
  }

  return { farmName, week, headerRow, fobCol, qtyCol, products };
}

function pickLatestSheet(wb, preferWeek) {
  const names = wb.worksheets.map(w => w.name);
  if (preferWeek) {
    const hit = names.find(n => normWeek(n).includes(preferWeek.replace(/^(\d)-/, '0$1-')) || n.includes(preferWeek));
    if (hit) return wb.getWorksheet(hit);
  }
  // pick sheet with highest week number pattern
  let best = wb.worksheets[0];
  let bestScore = -1;
  for (const ws of wb.worksheets) {
    const parsed = parseSheet(ws);
    const m = (parsed.week || ws.name).match(/(\d+)-(\d+)/);
    const score = m ? parseInt(m[1], 10) * 100 + parseInt(m[2], 10) : 0;
    if (parsed.products.length > 0 && score >= bestScore) {
      bestScore = score;
      best = ws;
    }
  }
  return best;
}

function hintsFromFilename(fn) {
  for (const [key, hints] of Object.entries(FILE_FARM_HINTS)) {
    if (fn.includes(key)) return hints;
  }
  return [];
}

async function findDbMasters(farmHints, week) {
  const conditions = farmHints.map((_, i) => `FarmName LIKE @f${i}`).join(' OR ');
  const params = {};
  farmHints.forEach((h, i) => { params[`f${i}`] = { type: sql.NVarChar, value: `%${h}%` }; });

  let sqlText = `SELECT WarehouseKey, FarmName, OrderYear, OrderWeek, OrderNo AS AWB, InvoiceNo
     FROM WarehouseMaster WHERE isDeleted=0 AND (${conditions})`;
  if (week) {
    const wkNorm = normWeek(week);
    const wkAlt = wkNorm.replace(/^0(\d)-/, '$1-');
    sqlText += ` AND (OrderWeek = @wk OR OrderWeek = @wkAlt OR REPLACE(OrderWeek,'-','') LIKE @wkLike)`;
    params.wk = { type: sql.NVarChar, value: wkNorm };
    params.wkAlt = { type: sql.NVarChar, value: wkAlt };
    params.wkLike = { type: sql.NVarChar, value: `%${wkNorm.replace('-', '')}%` };
  }
  sqlText += ' ORDER BY OrderYear DESC, REPLACE(OrderWeek,\'-\',\'\') DESC';
  const r = await query(sqlText, params);
  return r.recordset;
}

async function getDbDetails(warehouseKeys) {
  if (!warehouseKeys.length) return [];
  const csv = warehouseKeys.join(',');
  const r = await query(
    `SELECT wd.WarehouseKey, wd.ProdKey, wd.UPrice, wd.OutQuantity,
            p.ProdName, p.FlowerName, wm.FarmName, wm.OrderWeek, wm.OrderYear
     FROM WarehouseDetail wd
     INNER JOIN WarehouseMaster wm ON wd.WarehouseKey = wm.WarehouseKey
     LEFT JOIN Product p ON wd.ProdKey = p.ProdKey
     WHERE wd.WarehouseKey IN (${csv})
       AND ISNULL(p.ProdName,'') NOT LIKE N'%운송%'
     ORDER BY wm.FarmName, p.ProdName`,
  );
  return r.recordset;
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

function findBestDbMatch(excelName, dbRows) {
  let best = null;
  let bestScore = 0;
  for (const row of dbRows) {
    const dbName = row.ProdName || '';
    const s = matchScore(excelName, dbName);
    if (s > bestScore) { bestScore = s; best = row; }
  }
  return bestScore >= 0.25 ? { row: best, score: bestScore } : null;
}

async function main() {
  const files = fs.readdirSync(COST_DIR).filter(f => f.endsWith('.xlsx'));
  const report = [];

  console.log('=== ERP FarmName samples (recent) ===');
  const farmSample = await query(
    `SELECT DISTINCT TOP 50 FarmName FROM WarehouseMaster WHERE isDeleted=0 ORDER BY FarmName`,
  );
  console.log(farmSample.recordset.map(r => r.FarmName).join('\n'));

  for (const fn of files) {
    const fp = path.join(COST_DIR, fn);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(fp);

    const preferWeek = excelWeekToDb(fn.match(/(\d{1,2}-\d)/)?.[1] || '');
    const ws = pickLatestSheet(wb, preferWeek.replace('-0', '-'));
    const parsed = parseSheet(ws);
    const hints = hintsFromFilename(fn);
    const dbWeek = excelWeekToDb(parsed.week || preferWeek);

    const uniqueHints = [...new Set(hints.filter(Boolean))].slice(0, 6);
    let masters = await findDbMasters(uniqueHints, dbWeek);
    if (!masters.length) masters = await findDbMasters(uniqueHints, null);
    const wkeys = masters.slice(0, 5).map(m => m.WarehouseKey);
    const dbDetails = await getDbDetails(wkeys);

    const mismatches = [];
    const excelOnly = [];
    const matched = [];

    for (const ex of parsed.products) {
      const m = findBestDbMatch(ex.name, dbDetails);
      if (!m) {
        excelOnly.push(ex);
        continue;
      }
      const dbFob = Number(m.row.UPrice) || 0;
      const diff = ex.fob > 0 && dbFob > 0 ? Math.abs(ex.fob - dbFob) : null;
      if (diff != null && diff > 0.02) {
        mismatches.push({
          excel: ex.name,
          excelFob: ex.fob,
          dbName: m.row.ProdName,
          dbFob,
          diff,
          score: m.score,
        });
      } else {
        matched.push({ excel: ex.name, dbName: m.row.ProdName, fob: ex.fob || dbFob });
      }
    }

    const dbOnly = dbDetails.filter(d => {
      const dn = d.ProdName || '';
      return !parsed.products.some(ex => matchScore(ex.name, dn) >= 0.25);
    });

    const entry = {
      file: fn,
      sheet: ws.name,
      excelFarm: parsed.farmName,
      excelWeek: parsed.week || preferWeek,
      dbWeek,
      excelProducts: parsed.products.length,
      dbMasters: masters.length,
      dbMasterSample: masters.slice(0, 3).map(m => `${m.FarmName} ${m.OrderYear}-${m.OrderWeek} AWB:${m.AWB}`),
      matched: matched.length,
      priceMismatch: mismatches.length,
      excelOnly: excelOnly.length,
      dbOnly: dbOnly.length,
      mismatches: mismatches.slice(0, 8),
      excelOnlySample: excelOnly.slice(0, 5).map(x => `${x.name} FOB:${x.fob} Q:${x.qty}`),
      dbOnlySample: dbOnly.slice(0, 5).map(x => `${x.ProdName} FOB:${x.UPrice}`),
    };
    report.push(entry);

    console.log('\n' + '='.repeat(70));
    console.log('FILE:', fn);
    console.log('Sheet:', ws.name, '| Excel farm:', parsed.farmName, '| Week:', parsed.week);
    console.log('Excel products:', parsed.products.length, '| DB masters found:', masters.length);
    if (masters.length) console.log('DB:', entry.dbMasterSample.join(' ; '));
    else console.log('⚠ NO DB MASTER MATCH — hints:', uniqueHints.join(', '));
    console.log(`Match: ${matched.length} | Price diff: ${mismatches.length} | Excel-only: ${excelOnly.length} | DB-only: ${dbOnly.length}`);
    if (mismatches.length) {
      console.log('Price mismatches (sample):');
      mismatches.slice(0, 5).forEach(m => console.log(`  ${m.excel} excel=${m.excelFob} db=${m.dbFob} (${m.dbName})`));
    }
    if (excelOnly.length) {
      console.log('Excel-only (sample):', excelOnly.slice(0, 3).map(x => x.name).join(' | '));
    }
    if (dbOnly.length && masters.length) {
      console.log('DB-only (sample):', dbOnly.slice(0, 3).map(x => x.ProdName).join(' | '));
    }
  }

  fs.writeFileSync('scripts/cost-excel-compare-report.json', JSON.stringify(report, null, 2), 'utf8');
  console.log('\n\nReport saved: scripts/cost-excel-compare-report.json');
}

main().catch(e => { console.error(e); process.exit(1); });
