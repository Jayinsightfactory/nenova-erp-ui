const test = require('node:test');
const assert = require('node:assert/strict');
const { issueRows, shortIssue, linkedFlights, nextAction } = require('../shell/flight-board');

test('flight cards attach exact year identities and prioritize urgent work without mutating source', () => {
  const flights = [{key:'2025-A',status:'in_flight'}, {key:'2026-A',status:'arrived'}, {key:'done',status:'registered'}, {viewId:'hashed',status:'before_departure'}];
  const rows = [{key:'2026-A',level:'red',text:'서류 전달 미확인'}, {key:'done',level:'red',text:'과거 공지'}, {viewId:'hashed',level:'amber',text:'시각 확인'}];
  const before = JSON.stringify({flights,rows});
  const out = linkedFlights(flights,rows);
  assert.deepEqual(out.map(f=>f.key || f.viewId), ['2026-A','hashed','2025-A','done']);
  assert.deepEqual(out.map(f=>f.boardNumber), [2,4,1,3]);
  assert.equal(out[2].flightIssues.length,0);
  assert.equal(out[0].flightIssues[0].text,'서류 전달 미확인');
  assert.equal(JSON.stringify({flights,rows}),before);
  assert.equal(nextAction(rows[0]),'서류 전달 여부 확인');
  assert.match(nextAction(rows[2]),/운항일/);
});

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
