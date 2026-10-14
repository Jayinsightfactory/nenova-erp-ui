// __tests__/workDrivePairs.test.js — 인보이스 PDF ↔ 결과 엑셀 짝 판정 규칙 픽스처(실측 파일명). 실행: node __tests__/workDrivePairs.test.js
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wdp-test-'));
const cwd = process.cwd();
const src = fs.readFileSync(path.join(cwd, 'lib', 'workDrivePairs.js'), 'utf8')
  .replace(/^import fs from 'fs';/m, "const fs = require('fs');")
  .replace(/^import path from 'path';/m, "const path = require('path');")
  .replace(/^export (const|function) /gm, '$1 ')
  + '\nmodule.exports = { normCycle, isInvoiceFile, isResultWorkbook, scorePair, computePairs, readDriveFiles, recomputePairs, readPairs, onFileIngested };';
fs.writeFileSync(path.join(tmp, 'wdp.cjs'), src);
const p = require(path.join(tmp, 'wdp.cjs'));

// 판별
assert.ok(p.isInvoiceFile({ filename: '07-1차 네덜란드 홀랙스 수입서류 (인보이스).pdf' }));
assert.ok(p.isInvoiceFile({ filename: '10-1차 네덜란드 EZ 수입서류 (INVOICE).pdf' }));
assert.ok(p.isInvoiceFile({ filename: 'scan.pdf', pdfText: 'FACTURA No 123' }), 'PDF 텍스트 factura');
assert.ok(!p.isInvoiceFile({ filename: '09-1차 호주 프리미엄그린 수입서류 (원산지).pdf' }), '원산지 증명은 인보이스 아님');
assert.ok(!p.isInvoiceFile({ filename: '09-1차 호주 프리미엄그린 수입서류 (패킹리스트).pdf' }));
assert.ok(!p.isInvoiceFile({ filename: 'invoice.xlsx' }), 'PDF 만');
assert.ok(p.isResultWorkbook({ filename: 'Holex 2026 원가자료.xlsx' }));
assert.ok(p.isResultWorkbook({ filename: '38-2 NL 도착원가.xlsx' }));
assert.ok(p.isResultWorkbook({ filename: '(Holex) 2026년도 38-02주차 입고 상세 목록_2026-09-18.xlsx' }));
assert.ok(!p.isResultWorkbook({ filename: '2026년 라움 발주서.xlsx' }));
assert.strictEqual(p.normCycle('09-1 '), '9-1');
assert.strictEqual(p.normCycle('08-1(예시)'), '8-1');
assert.strictEqual(p.normCycle('3802_콜롬비아'), '38-2');

const T = (h) => new Date(Date.UTC(2026, 9, 1, 0) + h * 3600e3).toISOString();
const inv = { id: 'i1', filename: '38-2차 네덜란드 홀렉스 수입서류 (인보이스).pdf', cycle: '38-2', uploaderName: '김원빈', uploadedAt: T(0) };
// 확정: 같은 사람·3시간 뒤·차수·농장 일치
const wbA = { id: 'w1', filename: '(Holex) 2026년도 38-02주차 입고 상세 목록.xlsx', cycle: '38-2', uploaderName: '김원빈', uploadedAt: T(3) };
let s = p.scorePair(inv, wbA);
assert.ok(s.score >= 70, JSON.stringify(s));
assert.ok(s.reasons.some((r) => r.includes('차수 일치')) && s.reasons.some((r) => r.includes('holex')));
// 시트 차수: 파일명 차수 없는 누적 원가자료
const wbB = { id: 'w2', filename: 'Holex 2026 원가자료.xlsx', uploaderName: '김원빈', uploadedAt: T(5), sheetNames: ['37-1', '38-2 ', '39-1'] };
s = p.scorePair(inv, wbB);
assert.ok(s.score >= 70 && s.sheet.trim() === '38-2', JSON.stringify(s));
// 차수 다르면 탈락
const wbC = { id: 'w3', filename: '37-1 NL 원가자료.xlsx', cycle: '37-1', uploaderName: '김원빈', uploadedAt: T(2) };
assert.ok(p.scorePair(inv, wbC).score < 40);
// 다른 사람·멀리 떨어짐·농장만 → 후보 이하
const wbD = { id: 'w4', filename: '38-2 홀렉스 원가자료.xlsx', cycle: '38-2', uploaderName: '강명훈', uploadedAt: T(200) };
s = p.scorePair(inv, wbD);
assert.ok(s.score >= 40 && s.score < 70, JSON.stringify(s));
// 총액 일치/불일치
assert.ok(p.scorePair({ ...inv, totalAmount: 1000 }, { ...wbD, totalAmount: 1004 }).score > s.score);
assert.ok(p.scorePair({ ...inv, totalAmount: 1000 }, { ...wbD, totalAmount: 1500 }).score < s.score);

// computePairs: 1:N, 삭제·유출스냅샷 제외, 정렬
const out = p.computePairs([inv, wbA, wbB, wbC, wbD, { ...wbA, id: 'w5', deleted: true }, { ...wbA, id: 'w6', egressSnapshot: true }, { id: 'x', filename: '메모.txt' }]);
assert.strictEqual(out.invoices, 1);
assert.strictEqual(out.pairs.filter((x) => x.status === 'confirmed').length, 2, '1:N 확정 2');
assert.strictEqual(out.pairs.filter((x) => x.status === 'candidate').length, 1);
assert.ok(!out.pairs.some((x) => /w3|w5|w6/.test(x.workbook.id)));
assert.ok(out.pairs[0].score >= out.pairs[out.pairs.length - 1].score);

// IO: index.jsonl 마지막 행 기준 + pairs.json 저장, 원본 색인 불변
process.chdir(tmp);
fs.mkdirSync(path.join(tmp, 'data', 'drive'), { recursive: true });
const idx = path.join(tmp, 'data', 'drive', 'index.jsonl');
fs.writeFileSync(idx, [inv, wbA, { ...wbA, deleted: true }, { type: 'download', fileId: 'i1' }].map((r) => JSON.stringify(r)).join('\n') + '\n');
const before = fs.readFileSync(idx, 'utf8');
assert.strictEqual(p.onFileIngested({ id: 'm', filename: '메모.txt' }), null, '무관 파일은 재계산 안 함');
const doc = p.recomputePairs();
assert.deepStrictEqual(doc.counts, { confirmed: 0, candidate: 0 }, '마지막 행이 삭제면 제외');
assert.strictEqual(p.readPairs().generatedAt, doc.generatedAt);
assert.strictEqual(fs.readFileSync(idx, 'utf8'), before);
process.chdir(cwd);
console.log('workDrivePairs: all pass');
