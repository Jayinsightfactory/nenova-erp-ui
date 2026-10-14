// scripts/work-drive-pairs-recompute.mjs
// 업무 드라이브 기존 파일 전체로 인보이스↔결과엑셀 짝 일괄 재계산. 서버(/var/www/nenova-erp)에서: node scripts/work-drive-pairs-recompute.mjs
// 1) 아직 캐시 없는 PDF(텍스트·총액)/엑셀(시트명·합계행 숫자) 내용을 읽어 data/drive/pair-features.json 에 저장
// 2) lib/workDrivePairs.recomputePairs → data/drive/pairs.json. 파일만 읽고 쓴다(MSSQL 무관).
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { latestDriveRows, readFeatures, writeFeatures, recomputePairs } from '../lib/workDrivePairs.js';

const require = createRequire(import.meta.url);
const driveRoot = path.join(process.cwd(), 'data', 'drive');
const toNum = (s) => {
  let t = String(s).trim();
  if (/,\d{1,2}$/.test(t)) t = t.replace(/\./g, '').replace(',', '.'); // 1.234,56
  else t = t.replace(/,/g, '');                                       // 1,234.56
  return parseFloat(t);
};
const amounts = (s) => [...String(s).matchAll(/(?:total|amount|importe|valor|合计|总额|총액|합계)[^\d]{0,40}([\d.,]{3,})/gi)]
  .map((m) => toNum(m[1])).filter((n) => n > 0);

async function pdfText(abs) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(abs)), disableWorker: true, isEvalSupported: false }).promise;
  let t = '';
  for (let i = 1; i <= Math.min(doc.numPages, 6); i++) t += (await (await doc.getPage(i)).getTextContent()).items.map((x) => x.str).join(' ') + '\n';
  return t;
}
function bookFeat(abs) {
  const XLSX = require('xlsx');
  const wb = XLSX.readFile(abs, { cellFormula: false, sheetRows: 400 });
  const totals = [];
  for (const n of wb.SheetNames.slice(0, 12)) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true });
    for (const r of rows) {
      const lab = r.find((c) => typeof c === 'string');
      if (lab && /total|합계|총액|합 계/i.test(lab)) for (const c of r) if (typeof c === 'number' && c > 10) totals.push(+c.toFixed(2));
    }
  }
  return { sheets: wb.SheetNames, totals: [...new Set(totals)].slice(0, 40) };
}

const rows = latestDriveRows().filter((r) => !r.deleted);
const feats = readFeatures();
let read = 0, failed = 0;
for (const r of rows) {
  if (feats[r.id] || !r.rel) continue;
  const abs = path.join(driveRoot, r.rel);
  if (!fs.existsSync(abs)) continue;
  try {
    if (/\.pdf$/i.test(r.filename)) { const text = (await pdfText(abs)).slice(0, 20000); feats[r.id] = { text, totals: [...new Set(amounts(text))].slice(0, 20) }; read++; }
    else if (/\.(xlsx|xlsm|xls)$/i.test(r.filename)) { feats[r.id] = bookFeat(abs); read++; }
  } catch (e) { feats[r.id] = { error: String(e.message).slice(0, 120) }; failed++; }
}
writeFeatures(feats);
const out = recomputePairs({ rows, features: feats });
console.log(JSON.stringify({ filesRead: read, readFailed: failed, ...out.summary }));
for (const p of out.pairs.slice(0, 60)) console.log(`[${p.status}] ${p.confidence} ${p.invoiceName} -> ${p.matches.map((m) => `${m.excelName}(${m.confidence})`).join(' | ')}`);
