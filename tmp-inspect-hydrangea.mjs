import XLSX from 'xlsx';
import { parseArrivalCostWorkbook } from './lib/arrivalCostExcel.js';
import JSZip from 'jszip';
import fs from 'fs';

const buf = fs.readFileSync('tmp-34-2-hydrangea.xlsx');
const zip = await JSZip.loadAsync(buf);
const rels = await zip.file('xl/_rels/workbook.xml.rels').async('string');
console.log('rels', rels);
const sheetFiles = Object.keys(zip.files).filter((n) => n.startsWith('xl/worksheets/'));
console.log('sheet files', sheetFiles);

const wb = XLSX.readFile('tmp-34-2-hydrangea.xlsx');
const lastName = '34-2';
const target = sheetFiles[wb.SheetNames.indexOf(lastName)];
console.log('34-2 file', target, 'index', wb.SheetNames.indexOf(lastName));
const xml = await zip.file(target).async('string');
const formulaCount = (xml.match(/<f[ >]/g) || []).length;
const shared = (xml.match(/t="shared"/g) || []).length;
const arrayF = (xml.match(/t="array"/g) || []).length;
console.log({ xmlLen: xml.length, formulaCount, shared, arrayF });
const m15 = xml.match(/r="M15"[^>]*>[\s\S]{0,200}/);
const o15 = xml.match(/r="O15"[^>]*>[\s\S]{0,200}/);
const e15 = xml.match(/r="E15"[^>]*>[\s\S]{0,200}/);
console.log('M15', m15 && m15[0]);
console.log('O15', o15 && o15[0]);
console.log('E15', e15 && e15[0]);

const parsed = parseArrivalCostWorkbook('tmp-34-2-hydrangea.xlsx', { fileName: '34-2 수국 원가자료.xlsx' });
const row = parsed.rows.find((r) => r.sheetName === '34-2' && /White/.test(r.productNameRaw) && /Antioquia/i.test(r.farmNameRaw));
console.log('web row', {
  qty: row.quantity,
  fob: row.fobUSD,
  stem: row.sourceArrivalCostPerStemKRW,
  unit: row.sourceArrivalCostPerUnitKRW,
  shown: row.sourceArrivalCostKRW,
  freight: row.freightPerUnitUSD,
  other: row.otherPerUnitKRW,
  fx: row.exchangeRate,
});

const old = parseArrivalCostWorkbook('tmp-29-1-hydrangea.xlsx', { fileName: '29-1 수국 원가자료.xlsx' });
const oldRow = old.rows.find((r) => r.sheetName === '29-1' && /White/.test(r.productNameRaw) && /Antioquia/i.test(r.farmNameRaw));
const ws = XLSX.readFile('tmp-29-1-hydrangea.xlsx').Sheets['29-1'];
console.log('29-1 excel M15/O15', ws.M15, ws.O15);
console.log('29-1 web', {
  stem: oldRow.sourceArrivalCostPerStemKRW,
  unit: oldRow.sourceArrivalCostPerUnitKRW,
  shown: oldRow.sourceArrivalCostKRW,
});
