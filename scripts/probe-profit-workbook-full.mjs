#!/usr/bin/env node
// scripts/probe-profit-workbook-full.mjs — 22~27차 "매출원가 양식" 원본 워크북 전체 시트 read-only 구조 덤프.
// 운영 DB에 접속하지 않고 Downloads 폴더의 xlsx만 읽는다. 결과는 stdout JSON.
//   node scripts/probe-profit-workbook-full.mjs --outline
//   node scripts/probe-profit-workbook-full.mjs --sheet "그외통관비" --week 27
import fs from 'node:fs';
import path from 'node:path';
import XLSX from 'xlsx';

const DOWNLOADS = process.env.PROFIT_WORKBOOK_DIR
  || path.join(process.env.USERPROFILE || process.env.HOME || '.', 'Downloads');
const WEEKS = ['22', '23', '24', '25', '26', '27'];
const fileFor = w => path.join(DOWNLOADS, `매출원가 양식 - ${w}차_재고수정.xlsx`);

const args = process.argv.slice(2);
const flag = name => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true) : null;
};

function loadWeek(w) {
  const f = fileFor(w);
  if (!fs.existsSync(f)) throw new Error(`missing workbook: ${f}`);
  return XLSX.read(fs.readFileSync(f), { cellFormula: true, cellNF: true, cellDates: true });
}

function sheetCells(ws, { maxRows = 200, maxCols = 30 } = {}) {
  const ref = ws['!ref'];
  if (!ref) return { rows: [] };
  const range = XLSX.utils.decode_range(ref);
  const rows = [];
  const rowEnd = Math.min(range.e.r, range.s.r + maxRows - 1);
  const colEnd = Math.min(range.e.c, range.s.c + maxCols - 1);
  for (let r = range.s.r; r <= rowEnd; r++) {
    const cells = {};
    let any = false;
    for (let c = range.s.c; c <= colEnd; c++) {
      const addr = XLSX.utils.encode_cell({ r, c });
      const cell = ws[addr];
      if (!cell) continue;
      any = true;
      cells[XLSX.utils.encode_col(c)] = { v: cell.v ?? null, f: cell.f ?? null, t: cell.t };
    }
    if (any) rows.push({ row: r + 1, cells });
  }
  return { ref, rows };
}

const outline = flag('outline');
const onlySheet = typeof flag('sheet') === 'string' ? flag('sheet') : null;
const onlyWeek = typeof flag('week') === 'string' ? flag('week') : null;
const maxRows = Number(flag('maxRows')) || 200;

const out = {};
for (const w of WEEKS) {
  if (onlyWeek && w !== onlyWeek) continue;
  const wb = loadWeek(w);
  if (outline) {
    out[w] = wb.SheetNames.map(n => ({ sheet: n, ref: wb.Sheets[n]['!ref'] || null }));
    continue;
  }
  out[w] = {};
  for (const name of wb.SheetNames) {
    if (onlySheet && name !== onlySheet) continue;
    out[w][name] = sheetCells(wb.Sheets[name], { maxRows });
  }
}
if (flag('grid')) {
  for (const [w, sheets] of Object.entries(out)) {
    for (const [name, data] of Object.entries(sheets)) {
      process.stdout.write(`\n### ${w}차 / ${name} (${data.ref})\n`);
      for (const r of data.rows) {
        const parts = Object.entries(r.cells)
          .map(([c, v]) => `${c}=${JSON.stringify(v.v)}${v.f ? `{=${v.f}}` : ''}`);
        process.stdout.write(`${r.row}: ${parts.join(' | ')}\n`);
      }
    }
  }
} else {
  process.stdout.write(JSON.stringify(out, null, 1));
}
