// 골든 fixture 생성: 샘플 워크북(원천시트) + ERP DB 현재 원천행(lib/profitWorkbook.loadLiveRows, SELECT만) → __tests__/fixtures/profit-workbook-golden.json
// 사용: NENOVA_ENV_FILE=<.env.local> node scripts/golden/build-profit-workbook-fixture.mjs
// 값 출력 없음(자격증명 비노출). 결과 비교는 __tests__/profitWorkbookGolden.test.js 가 오프라인으로 수행한다.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import XLSX from 'xlsx';

const envFile = process.env.NENOVA_ENV_FILE || path.join(process.cwd(), '.env.local');
for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z_0-9]+)\s*=\s*(.*)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
}
const { loadLiveRows } = await import('../../lib/profitWorkbook.js');
const { getPool } = await import('../../lib/db.js');

const home = os.homedir();
const SAMPLES = {
  22: path.join(home, 'Downloads', '매출원가 양식 - 22차_재고수정.xlsx'),
  25: path.join(home, 'Downloads', '매출원가 양식 - 25차_재고수정.xlsx'),
  27: path.join(home, 'Downloads', '매출원가 양식 - 27차_재고수정.xlsx'),
  28: path.join(home, 'Documents', '카카오톡 받은 파일', '매출원가 양식 - 28차_재고수정.xlsx'),
};
const pick = (r, cols) => cols.map((c) => r[c] ?? null);
const out = { generatedAt: new Date().toISOString(), orderYear: '2026', weeks: {} };
for (const [wk, file] of Object.entries(SAMPLES)) {
  const wb = XLSX.readFile(file);
  const aoa = (s, skip) => XLSX.utils.sheet_to_json(wb.Sheets[s], { header: 1, defval: null }).slice(skip);
  const excel = {
    sales: aoa('판매현황', 3).filter((r) => r[0] && r[1]).map((r) => pick(r, [0, 1, 2, 3, 4, 5])),
    defect: aoa('불량차감', 2).filter((r) => r[1]).map((r) => pick(r, [0, 1, 2, 3, 4, 5, 6, 7, 8])),
    other: aoa('그 외 매출액', 2).filter((r) => r[1]).map((r) => pick(r, [0, 1, 2, 3, 4, 5, 6, 7, 8])),
    purchase: aoa('구매현황', 2).filter((r) => r[1]).map((r) => pick(r, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13])),
  };
  const rows = await loadLiveRows(String(wk).padStart(2, '0'), '2026');
  out.weeks[wk] = { excel, rows: rows.map((r) => ({ sheet: r.sheet, rowKey: r.rowKey, data: r.data })) };
  console.log(`${wk}차: excel sales ${excel.sales.length}, db rows ${rows.length}`);
}
const dest = path.join(process.cwd(), '__tests__', 'fixtures', 'profit-workbook-golden.json');
fs.writeFileSync(dest, JSON.stringify(out));
console.log('written', dest, fs.statSync(dest).size);
(await getPool()).close();
