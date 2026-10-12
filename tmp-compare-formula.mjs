import XLSX from 'xlsx';
import { parseArrivalCostWorkbook, hydrateSheetFormulas, evalSheetCell } from './lib/arrivalCostExcel.js';

const wb = XLSX.readFile('tmp-34-2-hydrangea.xlsx', { cellFormula: true, sheetStubs: true, cellDates: false });
hydrateSheetFormulas(wb.Sheets['34-2']);
console.log('excel M15', wb.Sheets['34-2'].M15);
console.log('excel O15', wb.Sheets['34-2'].O15);
console.log('excel C10', wb.Sheets['34-2'].C10);
console.log('excel C11', wb.Sheets['34-2'].C11);
console.log('excel P10', wb.Sheets['34-2'].P10);
console.log('excel G15', wb.Sheets['34-2'].G15);
console.log('excel J15', wb.Sheets['34-2'].J15);
console.log('excel L15', wb.Sheets['34-2'].L15);

const parsed = parseArrivalCostWorkbook('tmp-34-2-hydrangea.xlsx', { fileName: '34-2 수국 원가자료.xlsx' });
const row = parsed.rows.find((r) => r.sheetName === '34-2' && /White/.test(r.productNameRaw) && /Antioquia/i.test(r.farmNameRaw));
console.log('web', {
  shown: row.sourceArrivalCostKRW,
  stem: row.sourceArrivalCostPerStemKRW,
  unit: row.sourceArrivalCostPerUnitKRW,
  match: Math.abs(row.sourceArrivalCostKRW - wb.Sheets['34-2'].M15.v) < 1e-6,
});

const old = parseArrivalCostWorkbook('tmp-29-1-hydrangea.xlsx', { fileName: '29-1 수국 원가자료.xlsx' });
const oldRow = old.rows.find((r) => r.sheetName === '29-1' && /White/.test(r.productNameRaw) && /Antioquia/i.test(r.farmNameRaw));
console.log('29-1 still cached', oldRow.sourceArrivalCostKRW);
