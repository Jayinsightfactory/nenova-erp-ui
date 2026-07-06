import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import ExcelJS from 'exceljs';

const files = [
  'C:\\Users\\USER\\Downloads\\25-1 콜롬비아 원가자료 (2).xlsx',
  'C:\\Users\\USER\\Downloads\\단가원가 DSV (수국, 루스커스).xlsx',
];

function cellVal(v) {
  if (v == null) return '';
  if (typeof v === 'number' || typeof v === 'boolean') return v;
  if (typeof v === 'object' && v.richText) return v.richText.map(t => t.text).join('');
  if (typeof v === 'object' && v.formula != null) return v.result != null ? v.result : v.formula;
  return String(v).trim();
}

for (const fp of files) {
  if (!fs.existsSync(fp)) { console.log('MISSING', fp); continue; }
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(fp);
  console.log('\n===', path.basename(fp), '===');
  console.log('sheets:', wb.worksheets.map(w => w.name).join(' | '));
  for (const ws of wb.worksheets.slice(0, 3)) {
    console.log('\n-- sheet:', ws.name, 'rows', ws.rowCount);
    for (let r = 1; r <= Math.min(20, ws.rowCount); r++) {
      const row = [];
      for (let c = 1; c <= Math.min(12, ws.columnCount); c++) {
        const v = cellVal(ws.getRow(r).getCell(c).value);
        if (v !== '' && v != null) row.push(`${c}:${String(v).slice(0, 35)}`);
      }
      if (row.length) console.log(`R${r}`, row.join(' | '));
    }
  }
}
