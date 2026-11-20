import assert from 'node:assert/strict';
import {
  farmCandidateScope, farmCandidateSql, groupFarmCandidates, farmCandidateLabel, loadDefectFarmCandidates,
} from '../lib/defectFarmCandidates.js';

// 범위: 같은 대차수 + 직전 대차수(같은 연도 안에서만)
assert.deepEqual(farmCandidateScope(2026, 46), { year: 2026, week: 46, prevWeek: 45 });
assert.deepEqual(farmCandidateScope('2026', '1'), { year: 2026, week: 1, prevWeek: 0 });
for (const bad of [undefined, 0, 54, '46-01', 1.5]) assert.throws(() => farmCandidateScope(2026, bad));
assert.throws(() => farmCandidateScope(0, 46));

// 조회문은 읽기만 한다. 입고 상세에는 삭제 칸이 없으므로 마스터로만 거른다.
const statement = farmCandidateSql();
assert.match(statement, /^SELECT/);
assert.doesNotMatch(statement, /\b(INSERT|UPDATE|DELETE|MERGE|EXEC|ALTER|CREATE|DROP)\b/i);
assert.doesNotMatch(statement, /wd\.isDeleted/i);
assert.match(statement, /ISNULL\(wm\.isDeleted, 0\) = 0/);
assert.match(statement, /d\.IsDeleted = 0/);

// 묶기: 같은 차수 농장이 먼저, 그다음 입고 건수, 표기(대소문자·공백) 차이는 한 농장
const grouped = groupFarmCandidates([
  { DeductionKey: 10, FarmName: 'Cloudland', SameWeek: 0, ReceiptCount: 5, LastOrderWeek: '45-02' },
  { DeductionKey: 10, FarmName: 'HUBFRESH', SameWeek: 1, ReceiptCount: 1, LastOrderWeek: '46-01' },
  { DeductionKey: 10, FarmName: 'CLOUDLAND ', SameWeek: 0, ReceiptCount: 2, LastOrderWeek: '45-03' },
  { DeductionKey: 11, FarmName: 'Colibri', SameWeek: 1, ReceiptCount: 1, LastOrderWeek: '46-01' },
  { DeductionKey: 12, FarmName: '', SameWeek: 1, ReceiptCount: 1 },
  { DeductionKey: 0, FarmName: 'X', SameWeek: 1, ReceiptCount: 1 },
]);
assert.deepEqual(Object.keys(grouped), ['10', '11']);
assert.equal(grouped[10].total, 2);
assert.deepEqual(grouped[10].farms.map((farm) => farm.farmName), ['HUBFRESH', 'Cloudland']);
assert.equal(grouped[10].farms[1].receiptCount, 7);
assert.equal(grouped[10].farms[1].lastOrderWeek, '45-03');
assert.equal(farmCandidateLabel(grouped[11]), '입고 농장 후보 1곳: Colibri');
assert.equal(farmCandidateLabel(grouped[10]), '입고 농장 후보 2곳: HUBFRESH, Cloudland(직전 차수)');
assert.equal(farmCandidateLabel(undefined), '');
assert.equal(farmCandidateLabel({ total: 0, farms: [], more: 0 }), '');

// 5곳 이상이면 4곳만 보이고 나머지는 "외 N곳"
const many = groupFarmCandidates(['A', 'B', 'C', 'D', 'E', 'F'].map((name, i) => (
  { DeductionKey: 20, FarmName: name, SameWeek: 1, ReceiptCount: 10 - i, LastOrderWeek: '46-01' })));
assert.equal(many[20].total, 6);
assert.equal(many[20].farms.length, 4);
assert.equal(many[20].more, 2);
assert.equal(farmCandidateLabel(many[20]), '입고 농장 후보 6곳: A, B, C, D 외 2곳');
for (const total of [9, 16]) {
  const rows = Array.from({ length: total }, (_, index) => ({
    DeductionKey: 20, SameWeek: 1, ReceiptCount: 1, FarmName: `Farm ${index}`,
  }));
  const entry = groupFarmCandidates(rows)[20];
  assert.equal(entry.total, total);
  assert.equal(new Set([...entry.farms, ...entry.remainingFarms].map(({ farmName }) => farmName)).size, total);
}

// 불러오기: 조회 한 번, 매개값은 연도·차수·직전 차수
const calls = [];
const data = await loadDefectFarmCandidates({
  year: 2026, week: 46, sql: { Int: 'int' },
  query: async (text, params) => {
    assert.match(text, /^SELECT/);
    calls.push(params);
    return { recordset: [{ DeductionKey: 7, FarmName: 'Teucali', SameWeek: 1, ReceiptCount: 2, LastOrderWeek: '46-01' }] };
  },
});
assert.equal(calls.length, 1);
await assert.rejects(() => loadDefectFarmCandidates({ year: 2026, week: 46 }));
assert.equal(calls[0].year.value, 2026);
assert.equal(calls[0].week.value, 46);
assert.equal(calls[0].prevWeek.value, 45);
assert.deepEqual(data.candidates[7].farms.map((farm) => farm.farmName), ['Teucali']);

console.log('PASS: defect farm candidates (read-only scope, grouping, label)');
