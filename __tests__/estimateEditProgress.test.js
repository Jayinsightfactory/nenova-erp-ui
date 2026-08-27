// Run: node __tests__/estimateEditProgress.test.js

import assert from 'node:assert/strict';
import {
  appendEstimateEditProgress,
  createEstimateEditProgress,
  describeDateQuantitySaveResult,
  filterEstimateEditServerLogs,
  formatEstimateEditElapsed,
  formatEstimateEditNotice,
  finishEstimateEditProgress,
  mergeEstimateEditServerLogs,
  nextEstimateEditPollDelay,
  recordEstimateEditPollFailure,
  setEstimateEditProgressWeeks,
} from '../lib/estimateEditProgress.js';

function log(CreateDtm, Step, Detail, IsError = 0) {
  return { CreateDtm, Step, Detail, IsError };
}

function main() {
  let pass = 0;
  const test = (label, work) => {
    try {
      work();
      pass += 1;
      console.log(`  ✓ ${label}`);
    } catch (error) {
      console.error(`  ✗ ${label}\n    ${error.stack || error.message}`);
      process.exitCode = 1;
    }
  };

  console.log('=== estimate edit progress ===');
  test('keeps client errors and server logs when polling fails', () => {
    const startedAt = new Date('2026-08-26T16:05:25+09:00').getTime();
    let state = createEstimateEditProgress({ operationId: 'save-1', orderYear: '2026', weeks: ['34-02'], userId: 'nenovaSS3', startedAt });
    assert.equal(state.userId, 'nenovaSS3');
    state = appendEstimateEditProgress(state, 'save-1', { status: 'error', label: '34-02 중국기타 확정해제 실패', at: startedAt + 60000 });
    state = mergeEstimateEditServerLogs(state, 'save-1', [log('2026-08-26 16:05:27', 'unfix_sp_start', '2026/34-02 중국기타 prod=4')]);
    state = recordEstimateEditPollFailure(state, 'save-1', new Error('로그 조회 503'), startedAt + 62000);
    assert.equal(state.stages.at(-1).status, 'error');
    assert.equal(state.serverLogs.length, 1);
    assert.match(state.pollError, /503/);
    assert.equal(state.pollFailures, 1);
  });

  test('reports elapsed time from operation start and freezes only when finished', () => {
    const state = createEstimateEditProgress({ operationId: 'save-2', orderYear: '2026', weeks: ['34-02'], startedAt: 1000 });
    assert.equal(formatEstimateEditElapsed(state, 66123), '01:05');
    state.completedAt = 126000;
    assert.equal(formatEstimateEditElapsed(state, 999999), '02:05');
  });

  test('shows a settled no-cycle notice instead of leaving the busy message', () => {
    const running = createEstimateEditProgress({ operationId: 'save-notice', orderYear: '2026', weeks: ['34-02'] });
    assert.equal(formatEstimateEditNotice(running), '확정 상태를 유지해 저장 중입니다.');
    const done = finishEstimateEditProgress(running, 'save-notice', { ok: true });
    assert.equal(formatEstimateEditNotice(done), '확정 상태를 유지해 저장했습니다.');
    const failed = finishEstimateEditProgress(running, 'save-notice', { ok: false });
    assert.equal(formatEstimateEditNotice(failed), '저장 결과를 확인하세요.');
  });

  test('describes the real directional quantity-save response without stringifying validation objects', () => {
    assert.deepEqual(
      describeDateQuantitySaveResult({ direction: 'mixed', stockMode: 'fixed-direct', stockValidation: { availability: [{ prodKey: 1 }], postNative: [] } }),
      ['수량 증가·감소 함께 반영', '변경 품목 재고 반영', '증가분 재고 검증 통과'],
    );
    assert.deepEqual(
      describeDateQuantitySaveResult({ direction: 'noop', stockMode: 'unfixed-no-stock', stockValidation: { availability: [], postNative: [] } }),
      ['수량 변경 없음', '미확정 분배만 반영', '수량 증가 없음 · 부족재고 검사 생략'],
    );
  });

  test('ignores late poll responses from an earlier operation', () => {
    const state = createEstimateEditProgress({ operationId: 'save-current', orderYear: '2026', weeks: ['34-02'], startedAt: 0 });
    const next = mergeEstimateEditServerLogs(state, 'save-old', [log('2026-08-26 16:05:27', 'unfix_start', '2026/34-02 uid=nenovaSS3')]);
    assert.equal(next, state);
    assert.equal(next.serverLogs.length, 0);
  });

  test('ignores late server responses after this operation has finished', () => {
    const startedAt = new Date('2026-08-26T16:05:25+09:00').getTime();
    let state = createEstimateEditProgress({ operationId: 'save-finished', orderYear: '2026', weeks: ['34-02'], startedAt });
    state = { ...state, running: false, completedAt: startedAt + 1000 };
    const next = mergeEstimateEditServerLogs(state, 'save-finished', [log('2026-08-26 16:05:26', 'unfix_start', '2026/34-02 uid=nenovaSS3')]);
    assert.equal(next, state);
  });

  test('expands the server-log scope when the verified retry adds a week', () => {
    const state = createEstimateEditProgress({ operationId: 'save-retry', orderYear: '2026', weeks: ['34-02'] });
    const expanded = setEstimateEditProgressWeeks(state, 'save-retry', ['34-01', '34-02']);
    assert.deepEqual(expanded.weeks, ['34-01', '34-02']);
    assert.equal(setEstimateEditProgressWeeks(expanded, 'save-old', ['35-01']), expanded);
  });

  test('accepts only scoped, recent shipment-fix records and rejects near misses', () => {
    const startedAt = new Date('2026-08-26T16:05:25+09:00').getTime();
    const logs = [
      log('2026-08-26 16:05:26', 'unfix_start', '2026/34-02 uid=nenovaSS3 filter=ALL'),
      log('2026-08-26 16:05:27', 'unfix_sp_start', '2026/34-02 중국기타 prod=4'),
      log('2026-08-26 16:05:27', 'unfix_sp_start', '2025/34-02 중국기타 prod=4'),
      log('2026-08-26 16:05:27', 'unfix_sp_start', '2026/34-01 중국기타 prod=4'),
      log('2026-08-26 16:05:10', 'unfix_sp_start', '2026/34-02 이전 작업 prod=4'),
      log('2026-08-26 16:05:27', 'unfix_start', '2026/34-02 uid=other-user filter=ALL'),
      log('2026-08-26 16:05:27', 'unfix_sp_start', '2026/34-02 no-uid same-week reference'),
      log('not-a-timestamp', 'unfix_sp_start', '2026/34-02 unparsable timestamp'),
      log('2026-08-26 16:06:28', 'unfix_sp_start', '2026/34-02 after operation'),
      log('2026-08-26 16:05:27', 'other_step', '2026/34-02 ignored'),
    ];
    const scoped = filterEstimateEditServerLogs(logs, { orderYear: '2026', weeks: ['34-02'], startedAt, completedAt: new Date('2026-08-26T16:06:27+09:00').getTime(), userId: 'nenovaSS3' });
    assert.deepEqual(scoped.map((entry) => entry.Detail), [
      '2026/34-02 uid=nenovaSS3 filter=ALL',
      '2026/34-02 중국기타 prod=4',
      '2026/34-02 no-uid same-week reference',
    ]);
    assert.deepEqual(scoped.map((entry) => entry.correlation), ['user-match', 'week-reference', 'week-reference']);
  });

  test('backs off polling after failures instead of retrying rapidly', () => {
    assert.equal(nextEstimateEditPollDelay(0), 3000);
    assert.equal(nextEstimateEditPollDelay(1), 6000);
    assert.equal(nextEstimateEditPollDelay(2), 12000);
    assert.equal(nextEstimateEditPollDelay(10), 12000);
  });

  console.log(`=== ${pass}/9 passed ===`);
}

main();
