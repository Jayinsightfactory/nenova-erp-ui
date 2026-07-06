import fs from 'fs';
import path from 'path';
import ExcelJS from 'exceljs';

const dir = 'C:\\Users\\USER\\Downloads\\원가자료';
const files = fs.readdirSync(dir).filter(f => f.endsWith('.xlsx'));

function cellVal(v) {
  if (v == null) return '';
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (typeof v === 'object' && v.richText) return v.richText.map(t => t.text).join('');
  if (typeof v === 'object' && v.formula != null) return v.result != null ? String(v.result) : String(v.formula);
  return String(v).trim();
}

for (const f of files) {
  const fp = path.join(dir, f);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(fp);
  console.log('\n===', f, '===');
  console.log('sheets:', wb.worksheets.map(w => w.name).join(' | '));
  const ws = wb.worksheets[0];
  console.log('rows:', ws.rowCount, 'cols:', ws.columnCount);
  for (let r = 1; r <= Math.min(25, ws.rowCount); r++) {
    const row = [];
    for (let c = 1; c <= Math.min(12, ws.columnCount); c++) {
      const v = cellVal(ws.getRow(r).getCell(c).value);
      if (v) row.push(`${c}:${v.slice(0, 40)}`);
    }
    if (row.length) console.log(`R${r}`, row.join(' | '));
  }
}
