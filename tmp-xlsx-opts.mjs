import XLSX from 'xlsx';
import fs from 'fs';

const buf = fs.readFileSync('tmp-34-2-hydrangea.xlsx');
for (const opts of [
  { cellFormula: true },
  { cellFormula: true, sheetStubs: true },
  { cellFormula: true, sheetStubs: true, dense: false },
  { raw: false, cellFormula: true, sheetStubs: true },
]) {
  const wb = XLSX.read(buf, { type: 'buffer', cellDates: false, ...opts });
  const ws = wb.Sheets['34-2'];
  const m15 = ws.M15;
  const c10 = ws.C10;
  const c11 = ws.C11;
  const g15 = ws.G15;
  console.log(JSON.stringify(opts), {
    M15: m15,
    C10: c10,
    C11: c11,
    G15: g15,
    hasM: !!m15,
    keys15: Object.keys(ws).filter((k) => /15$/.test(k)).slice(0, 20),
  });
}
