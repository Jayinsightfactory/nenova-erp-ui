// 원본 "매출원가 양식 - N차_재고수정.xlsx"에서 원천시트 데이터 영역만 비운 템플릿(data/profit-workbook-template.xlsx)을 만든다.
// 수식 열(판매현황 I, 불량차감/그 외 매출액 J, 구매현황 N)은 첫 데이터행 수식만 남기고, 수기 시트(재고잔량·그외통관비·포워딩·
// 콜롬비아·품목리스트)와 본표는 그대로 둔다. 사용: node scripts/build-profit-workbook-template.mjs <원본.xlsx>
import path from 'node:path';
import fs from 'node:fs';
import { SOURCE_SHEET_LAYOUT, clearSourceArea, loadTemplate } from '../lib/profitWorkbookExcel.js';

const src = process.argv[2];
if (!src) throw new Error('원본 xlsx 경로가 필요합니다.');
const wb = await loadTemplate(fs.readFileSync(src));
for (const layout of Object.values(SOURCE_SHEET_LAYOUT)) {
  const ws = wb.getWorksheet(layout.name);
  const f = clearSourceArea(ws, layout, { keepFirstFormula: true });
  console.log(`${layout.name}: 데이터 영역 비움, 수식열 ${layout.formulaCol}${layout.firstRow} ${f ? '유지' : '없음'}`);
}
const out = path.join(process.cwd(), 'data', 'profit-workbook-template.xlsx');
await wb.xlsx.writeFile(out);
console.log('written', out, fs.statSync(out).size);
