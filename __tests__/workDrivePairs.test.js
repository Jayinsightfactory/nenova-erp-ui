// __tests__/workDrivePairs.test.js — 인보이스 PDF ↔ 결과 엑셀 짝 판정 픽스처. 실행: node --test __tests__/workDrivePairs.test.js
const test = require('node:test');
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wdp-test-'));
const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'workDrivePairs.js'), 'utf8')
  .replace(/^import fs from 'fs';/m, "const fs = require('fs');")
  .replace(/^import path from 'path';/m, "const path = require('path');")
  .replace(/^export (const|function) /gm, '$1 ')
  + '\nmodule.exports = { cyclesOf, farmsOf, isInvoiceFile, isResultWorkbook, scorePair, computePairs, recomputePairs, readPairs, onDriveFileIngested, CONFIRM_SCORE };';
fs.writeFileSync(path.join(tmp, 'p.cjs'), src);
const P = require(path.join(tmp, 'p.cjs'));

const row = (id, filename, at, extra = {}) => ({ id, filename, uploaderName: '김원빈', uploadedAt: at, ...extra });

test('차수 표기 정규화', () => {
  assert.deepStrictEqual(P.cyclesOf('42-01 홀렉스 인보이스.pdf'), ['42-1']);
  assert.deepStrictEqual(P.cyclesOf('4202_원가자료.xlsx'), ['42-2']);
  assert.deepStrictEqual(P.cyclesOf('42차 도착원가.xlsx'), ['42']);
});

test('인보이스·결과 엑셀 판별', () => {
  assert.ok(P.isInvoiceFile(row('a', '07-1차 네덜란드 홀랙스 수입서류 (인보이스).pdf')));
  assert.ok(P.isInvoiceFile(row('a', 'FACTURA 123.pdf')));
  assert.ok(P.isInvoiceFile(row('a', 'AYURA 17-1.pdf'), { text: 'COMMERCIAL INVOICE No 55' }));
  assert.ok(!P.isInvoiceFile(row('a', '09-1차 호주 수입서류 (원산지).pdf')));
  assert.ok(!P.isInvoiceFile(row('a', '인보이스.xlsx')));
  assert.ok(P.isResultWorkbook(row('b', '42-1 NL 원가자료.xlsx')));
  assert.ok(P.isResultWorkbook(row('b', 'Packing 42-1.xlsx')));
  assert.ok(!P.isResultWorkbook(row('b', '주문취합.xlsx')));
});

test('같은 업로더·2시간 후·차수·농장 일치 → 확정', () => {
  const inv = row('i1', '42-01 네덜란드 홀렉스 수입서류 (인보이스).pdf', '2026-10-12T01:00:00Z');
  const xl = row('x1', 'Holex 42-1 원가자료.xlsx', '2026-10-12T03:00:00Z');
  const s = P.scorePair(inv, xl);
  assert.ok(s.score >= P.CONFIRM_SCORE, JSON.stringify(s));
  assert.ok(s.reasons.some((r) => r.startsWith('차수 일치')) && s.reasons.some((r) => r.startsWith('농장 일치')));
});

test('차수 다르면 짝 아님, 총액 일치는 가점', () => {
  const inv = row('i1', '42-1 홀렉스 인보이스.pdf', '2026-10-12T01:00:00Z');
  assert.strictEqual(P.computePairs([inv, row('x9', '40-2 홀렉스 원가자료.xlsx', '2026-10-12T02:00:00Z', { uploaderName: '아드리아나' })]).pairs.length, 0);
  const a = P.scorePair(inv, row('x2', '42-1 원가자료.xlsx', '2026-10-13T20:00:00Z'));
  const b = P.scorePair(inv, row('x2', '42-1 원가자료.xlsx', '2026-10-13T20:00:00Z'), { totals: [12345.6] }, { totals: [12345.6] });
  assert.ok(b.score > a.score && b.reasons.some((r) => r.startsWith('총액 일치')));
});

test('1:N — 인보이스 하나에 원가자료+Packing, 확정/후보 요약', () => {
  const rows = [
    row('i1', '42-1 홀렉스 인보이스.pdf', '2026-10-12T01:00:00Z'),
    row('x1', 'Holex 42-1 원가자료.xlsx', '2026-10-12T02:00:00Z'),
    row('x2', 'Packing 42-1 홀렉스.xlsx', '2026-10-12T04:00:00Z'),
    row('i2', 'factura 43-1.pdf', '2026-10-19T01:00:00Z', { uploaderName: '아드리아나' }),
    row('x3', '43차 도착원가.xlsx', '2026-10-19T20:00:00Z', { uploaderName: '아드리아나' }),
    row('x4', 'old 원가자료.xlsx', '2026-10-01T01:00:00Z', { deleted: true }),
  ];
  const out = P.computePairs(rows);
  const p1 = out.pairs.find((p) => p.invoiceId === 'i1');
  assert.deepStrictEqual(p1.matches.map((m) => m.excelId).sort(), ['x1', 'x2']);
  assert.strictEqual(p1.status, 'confirmed');
  const p2 = out.pairs.find((p) => p.invoiceId === 'i2');
  assert.strictEqual(p2.status, 'candidate');
  assert.strictEqual(out.summary.confirmed, 1);
  assert.strictEqual(out.summary.candidate, 1);
});

test('파일 저장 — pairs.json 생성, 신규 업로드 훅은 PDF/엑셀만', () => {
  const cwd = process.cwd();
  process.chdir(tmp);
  try {
    fs.mkdirSync('data/drive', { recursive: true });
    fs.writeFileSync('data/drive/index.jsonl', [row('i1', '42-1 홀렉스 인보이스.pdf', '2026-10-12T01:00:00Z'), row('x1', 'Holex 42-1 원가자료.xlsx', '2026-10-12T02:00:00Z'), { type: 'download', id: 'dl-1' }].map((r) => JSON.stringify(r)).join('\n') + '\n');
    assert.strictEqual(P.onDriveFileIngested('memo.txt'), null);
    assert.strictEqual(P.onDriveFileIngested('Holex 42-1 원가자료.xlsx').confirmed, 1);
    assert.strictEqual(P.readPairs().pairs[0].matches[0].excelId, 'x1');
  } finally { process.chdir(cwd); }
});
