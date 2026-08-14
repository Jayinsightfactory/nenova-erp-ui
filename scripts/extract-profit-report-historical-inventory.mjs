// 2026년 22~28차 원본 매출원가 workbook의 기말상품재고액(F) 셀을
// 과거 보고서 보조 증거로 구조화한다. 원본 xlsx는 읽기만 하며 수정하지 않는다.
//
// 실행: node scripts/extract-profit-report-historical-inventory.mjs
// 입력: .verify/inputs/profit-report-weeks-22-28/week-NN.xlsx
// 출력: lib/profitReportHistoricalInventory.js
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import XLSX from 'xlsx';

const ROOT = process.cwd();
const INPUT = path.join(ROOT, '.verify', 'inputs', 'profit-report-weeks-22-28');
const OUTPUT = path.join(ROOT, 'lib', 'profitReportHistoricalInventory.js');
const WEEKS = [22, 23, 24, 25, 26, 27, 28];

const hashFile = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const js = (value) => JSON.stringify(value, null, 2);

const evidence = {};
for (const major of WEEKS) {
  const file = path.join(INPUT, `week-${major}.xlsx`);
  if (!fs.existsSync(file)) throw new Error(`원본 workbook 없음: ${file}`);
  const workbook = XLSX.readFile(file, { cellFormula: true });
  const sheet = workbook.Sheets['주차별 매출이익 보고서'];
  if (!sheet) throw new Error(`${major}차: 주차별 매출이익 보고서 시트 없음`);
  const fileHash = hashFile(file);
  const categories = {};
  for (let row = 7; row <= 22; row += 1) {
    const category = String(sheet[`B${row}`]?.v || '').trim();
    const cell = sheet[`F${row}`];
    if (!category || cell?.v == null || !Number.isFinite(Number(cell.v))) continue;
    categories[category] = {
      value: Number(cell.v),
      sourceRef: `workbook-sha256:${fileHash}#주차별 매출이익 보고서!F${row}`,
      sourceFile: `week-${major}.xlsx`,
      sourceSheet: '주차별 매출이익 보고서',
      sourceCell: `F${row}`,
      formula: cell.f || null,
    };
  }
  evidence[String(major).padStart(2, '0')] = { fileHash, categories };
}

const output = `// 자동 생성 파일 — scripts/extract-profit-report-historical-inventory.mjs\n`
  + `// 2026년 22~28차 원본 workbook의 기말상품재고액(F) 보조 증거.\n`
  + `// 다른 연도·차수로 전파하지 않으며, 현재 DB 공식이나 품목별 VERIFIED 단가가 없을 때만 사용한다.\n\n`
  + `const HISTORICAL_INVENTORY = ${js(evidence)};\n\n`
  + `export const HISTORICAL_INVENTORY_YEAR = '2026';\n\n`
  + `export function getHistoricalClosingInventoryEvidence(orderYear, major, category) {\n`
  + `  if (String(orderYear) !== HISTORICAL_INVENTORY_YEAR) return null;\n`
  + `  const week = String(Number(major)).padStart(2, '0');\n`
  + `  const item = HISTORICAL_INVENTORY[week]?.categories?.[category];\n`
  + `  return item ? { ...item, orderYear: HISTORICAL_INVENTORY_YEAR, major: week, status: 'VERIFIED_HISTORICAL_WORKBOOK' } : null;\n`
  + `}\n\n`
  + `export function historicalInventoryMajors() { return Object.keys(HISTORICAL_INVENTORY); }\n`;

fs.writeFileSync(OUTPUT, output, 'utf8');
console.log(`생성 완료: ${path.relative(ROOT, OUTPUT)}`);
