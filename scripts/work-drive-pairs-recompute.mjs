// scripts/work-drive-pairs-recompute.mjs — 업무 드라이브 기존 파일로 인보이스↔결과엑셀 짝 일괄 재계산 1회.
// 실행(서버 /var/www/nenova-erp): node scripts/work-drive-pairs-recompute.mjs   → data/drive/pairs.json 갱신, 요약 출력
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const XLSX = require('xlsx');
const { recomputePairs } = await import('../lib/workDrivePairs.js');
const doc = recomputePairs({ xlsxLib: XLSX });
console.log(JSON.stringify({ generatedAt: doc.generatedAt, invoices: doc.invoices, workbooks: doc.workbooks, counts: doc.counts }, null, 1));
for (const p of doc.pairs.slice(0, 30)) console.log(`${p.status}\t${p.score}\t${p.invoice.filename}\t→ ${p.workbook.filename}${p.sheet ? '#' + p.sheet.trim() : ''}`);
