const test = require('node:test');
const assert = require('node:assert/strict');
const { issueRows, shortIssue, linkedFlights, nextAction, compactIssue, placeMarkers } = require('../shell/flight-board');

test('nearby flight labels stay separately clickable without moving their projected anchors', () => {
  const points = [{x:320,y:90,id:'2026-K4254'}, {x:328,y:88,id:'2026-AC063'}, {x:320,y:90,id:'2025-K4254'}, {x:719,y:271,id:'edge'}];
  const result = placeMarkers(points);
  assert.deepEqual(result.map(p=>[p.id,p.anchorX,p.anchorY]),points.map(p=>[p.id,p.x,p.y]));
  for(let i=0;i<result.length;i++)for(let j=i+1;j<result.length;j++)assert.ok(Math.abs(result[i].x-result[j].x)>=160||Math.abs(result[i].y-result[j].y)>=22);
  assert.ok(result.every(p=>p.x>=12&&p.x<=570&&p.y>=12&&p.y<=260));
  assert.deepEqual(placeMarkers(points),result);
});

test('flight cards attach exact year identities and prioritize urgent work without mutating source', () => {
  const flights = [{key:'2025-A',status:'in_flight'}, {key:'2026-A',status:'arrived'}, {key:'done',status:'registered'}, {viewId:'hashed',status:'before_departure'}];
  const rows = [{key:'2026-A',level:'red',text:'서류 전달 미확인'}, {key:'done',level:'red',text:'미해결 적하 구분'}, {viewId:'hashed',level:'amber',text:'시각 확인'}];
  const before = JSON.stringify({flights,rows});
  const out = linkedFlights(flights,rows);
  assert.deepEqual(out.map(f=>f.key || f.viewId), ['2026-A','done','hashed','2025-A']);
  assert.deepEqual(out.map(f=>f.boardNumber), [2,3,4,1]);
  assert.equal(out[3].flightIssues.length,0);
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

test('compact actions retain issue-specific instructions and unknown issue facts', () => {
  assert.equal(compactIssue({text:'검역증·인보이스 수량 대조 필요 (11/17 18:03)'}), '인보이스·검역증 수량과 정정본 확인');
  assert.equal(compactIssue({text:'편명 아직 없음'}), '편명 아직 없음');
});

test('the current-flight map excludes arrivals and registered arrivals with open issues', () => {
  const { onFlightMap, afterArrival } = require('../shell/flight-board');
  const rows = ['before_departure', 'in_flight', 'awaiting_awb', 'arrived', 'registered', 'unknown'].map(status => ({ status, flightIssues: [{ level: 'red' }]}));
  assert.deepEqual(rows.filter(onFlightMap).map(f => f.status), ['before_departure', 'in_flight']);
  assert.deepEqual(rows.filter(afterArrival).map(f => f.status), ['arrived', 'registered']);
});

test('customs title qualifies uncertain release without confusing it with clearance', () => {
  const { customsTitle } = require('../shell/flight-board');
  assert.equal(customsTitle({ declaration: 'pending', release: 'waiting' }), '수입신고 수리 중 · 미반출');
  assert.equal(customsTitle({ declaration: 'cleared', release: 'unknown' }), '수입신고 수리 완료 · 반출 미확인');
  assert.equal(customsTitle(null), '');
});
