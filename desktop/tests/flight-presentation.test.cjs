const test = require('node:test');
const assert = require('node:assert/strict');
const { issueRows, shortIssue } = require('../shell/flight-board');

test('same issue merges within a flight, preserves year/flight identity and urgent level', () => {
  const rows = issueRows([
    { key: '2025-47-A', text: '서류  확인', level: 'amber' },
    { key: '2025-47-A', text: ' 서류 확인 ', level: 'red' },
    { key: '2026-47-A', text: '서류 확인', level: 'amber' },
    { key: '2026-47-B', text: '서류 확인', level: 'amber' },
    { key: '2026-47-A', text: '' },
  ]);
  assert.equal(rows.length, 3);
  assert.equal(rows[0].level, 'red');
  assert.deepEqual(rows.map(row => row.key), ['2025-47-A', '2026-47-A', '2026-47-B']);
});

test('short wording preserves times and uncertain evidence', () => {
  assert.equal(shortIssue('공항 예정 시각이 공지와 다름: 14:20 → 16:30'), '도착 시각 불일치: 14:20 → 16:30');
  assert.equal(shortIssue('서류 전달 표시 없음'), '서류 전달 미확인');
  assert.equal(shortIssue('검역 신청 마감(11/18 09:00 예상)이 지남'), '검역 신청 마감(11/18 09:00 예상)이 지남');
});
