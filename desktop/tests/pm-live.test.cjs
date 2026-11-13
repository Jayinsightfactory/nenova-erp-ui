'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { pmLiveStatus } = require('../pm-live.cjs');

test('fresh PM working heartbeat is explicitly live', () => {
  const result = pmLiveStatus({ ageSec: 12, receivedAt: '2026-11-11T01:00:00Z', data: {
    generatedAt: '2026-11-11T00:59:50Z', agents: [{ id: 'pm', status: 'working', activity: '오류 확인' }],
  } });
  assert.equal(result.ok, true); assert.equal(result.state, 'live'); assert.equal(result.activity, '오류 확인');
});

test('fresh idle PM heartbeat is connected but not reported as working', () => {
  const result = pmLiveStatus({ ageSec: 30, data: { agents: [{ id: 'pm', status: 'idle' }] } });
  assert.equal(result.ok, true); assert.equal(result.state, 'active');
});

test('stale heartbeat is never reported as live', () => {
  const result = pmLiveStatus({ ageSec: 181, receivedAt: '2026-11-11T00:00:00Z', data: {
    agents: [{ id: 'pm', status: 'working' }],
  } });
  assert.equal(result.ok, false); assert.equal(result.state, 'stale');
});

test('missing PM agent or missing freshness evidence fails closed', () => {
  assert.equal(pmLiveStatus({ ageSec: 5, data: { agents: [] } }).state, 'offline');
  assert.equal(pmLiveStatus({ data: { agents: [{ id: 'pm', status: 'working' }] } }).state, 'offline');
});

test('activity text is bounded and unrelated payload fields are not returned', () => {
  const result = pmLiveStatus({ ageSec: 1, token: 'secret', data: { agents: [{ id: 'pm', status: 'working', activity: 'x'.repeat(500) }] } });
  assert.equal(result.activity.length, 240); assert.equal('token' in result, false);
});

test('unresolved issue titles are passed through as titles only', () => {
  const result = pmLiveStatus({ ageSec: 5, unresolved: [{ id: 'a', title: '  아드리아나 PC 화면 해독이 3시간 넘게 멈춤 ', todo: '사장님 확인 필요' }, { title: 'x'.repeat(200) }, { title: 7 }, null],
    data: { agents: [{ id: 'pm', status: 'working', activity: '조사 중: staff-decode-fresh' }] } });
  assert.deepEqual(result.issues.map(item => item.length), [25, 80]);
  assert.equal(result.issues[0], '아드리아나 PC 화면 해독이 3시간 넘게 멈춤');
});

test('no unresolved list from an older server is reported as unknown, not as healthy', () => {
  assert.equal(pmLiveStatus({ ageSec: 5, data: { agents: [{ id: 'pm', status: 'idle' }] } }).issues, null);
  assert.deepEqual(pmLiveStatus({ ageSec: 5, unresolved: [], data: { agents: [{ id: 'pm', status: 'idle' }] } }).issues, []);
});