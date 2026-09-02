const assert = require('node:assert/strict');
const fs = require('node:fs');

async function main() {
  const {
    normalizeShipmentAdjustmentBatch,
    isShipmentAdjustmentBatchPreflight,
    runShipmentAdjustmentBatchTransaction,
  } = await import('../lib/shipmentAdjustmentBatch.js');

  assert.equal(isShipmentAdjustmentBatchPreflight(undefined), false, '미지정은 기존 실제 저장이다.');
  assert.equal(isShipmentAdjustmentBatchPreflight(false), false, '명시 false는 실제 저장이다.');
  assert.equal(isShipmentAdjustmentBatchPreflight(0), false, '명시 0을 사전검증으로 오판하지 않는다.');
  assert.equal(isShipmentAdjustmentBatchPreflight('true'), false, '문자열 truthy 값은 허용하지 않는다.');
  assert.equal(isShipmentAdjustmentBatchPreflight(true), true, 'boolean true만 rollback 전용 사전검증이다.');

  const batch = normalizeShipmentAdjustmentBatch({
    year: '2026',
    week: '33-02',
    entries: [
      { custKey: 10, prodKey: 101, type: 'ADD', qty: 2, unit: '단', force: true },
      { custKey: 20, prodKey: 201, type: 'CANCEL', qty: 1, unit: '박스', mode: 'PIVOT_DISTRIBUTION' },
      { custKey: 30, prodKey: 202, type: 'CANCEL', qty: 3, unit: '단' },
    ],
  });
  assert.deepEqual(
    batch.entries.map((entry) => entry.body.type),
    ['CANCEL', 'CANCEL', 'ADD'],
    '일괄 실행은 입력순서와 무관하게 CANCEL 전체 후 ADD 전체여야 한다.',
  );
  assert.equal(batch.entries[0].body.mode, 'AUTO_CANCEL', 'CANCEL은 서버 AUTO_CANCEL 정책으로 고정한다.');
  assert.equal(batch.entries[2].body.mode, undefined, 'ADD는 기존 결합 추가 정책을 사용한다.');
  assert.ok(batch.entries.every((entry) => entry.body.force === false), '전체 일괄은 force=true를 허용하지 않는다.');
  assert.ok(batch.entries.every((entry) => entry.body.year === '2026' && entry.body.week === '33-02'));

  assert.throws(
    () => normalizeShipmentAdjustmentBatch({
      year: '2026',
      week: '33-02',
      entries: [{ year: '2025', week: '33-02', custKey: 20, prodKey: 201, type: 'CANCEL', qty: 1 }],
    }),
    /일괄 범위 2026-33-02와 다릅니다/,
    '전년도 동일 차수 항목은 선택연도 일괄 트랜잭션에 섞지 않는다.',
  );

  // 실행형 원자성 fixture: CANCEL 두 건이 staged 상태에서 성공한 뒤 ADD가 실패한다.
  // fake withTransaction은 callback이 완주한 경우에만 staged를 committed로 옮긴다.
  const committed = [];
  const withTransactionFn = async (callback) => {
    const staged = [];
    const result = await callback(staged);
    committed.push(...staged);
    return result;
  };
  const executeEntryFn = async (staged, { body }) => {
    staged.push(`${body.year}|${body.week}|${body.custKey}|${body.prodKey}|${body.type}`);
    if (body.type === 'ADD') throw new Error('synthetic ADD failure');
    return { type: body.type, custKey: body.custKey, prodKey: body.prodKey };
  };

  let rolledBackError;
  try {
    await runShipmentAdjustmentBatchTransaction({
      batch,
      user: { userId: 'tester' },
      capabilities: {},
      withTransactionFn,
      executeEntryFn,
    });
  } catch (error) {
    rolledBackError = error;
  }
  assert.match(rolledBackError?.message || '', /synthetic ADD failure/);
  assert.deepEqual(committed, [], '후반 ADD 실패 시 앞선 CANCEL staged 변경도 commit되면 안 된다.');
  assert.equal(rolledBackError.failedEntry.type, 'ADD');
  assert.equal(rolledBackError.failedEntry.executionIndex, 2);

  const successCommitted = [];
  const successResults = await runShipmentAdjustmentBatchTransaction({
    batch,
    user: { userId: 'tester' },
    capabilities: {},
    withTransactionFn: async (callback) => {
      const staged = [];
      const result = await callback(staged);
      successCommitted.push(...staged);
      return result;
    },
    executeEntryFn: async (staged, { body }) => {
      staged.push(body.type);
      return { verified: true, type: body.type, custKey: body.custKey, prodKey: body.prodKey };
    },
  });
  assert.deepEqual(successCommitted, ['CANCEL', 'CANCEL', 'ADD']);
  assert.deepEqual(successResults.map((row) => row.inputIndex), [1, 2, 0], '응답은 원 입력 index를 보존한다.');

  const adjustSource = fs.readFileSync('pages/api/shipment/adjust.js', 'utf8');
  const batchApiSource = fs.readFileSync('pages/api/shipment/adjust-batch.js', 'utf8');
  assert.match(adjustSource, /export async function executeShipmentAdjustmentInTransaction\(tQ,/);
  assert.match(
    adjustSource,
    /withTransaction\(\(tQ\) => executeShipmentAdjustmentInTransaction\(tQ,/,
    '기존 단건 POST도 추출한 트랜잭션 코어를 재사용해야 한다.',
  );
  assert.match(batchApiSource, /runShipmentAdjustmentBatchTransaction\(\{/);
  assert.match(batchApiSource, /withTransactionFn:[\s\S]*?: withTransaction,/);
  assert.match(batchApiSource, /preflightOnly/);
  assert.match(batchApiSource, /rollbackOnly: true/);
  assert.match(batchApiSource, /committedCount: preflightOnly \? 0 : results\.length/);
  assert.match(batchApiSource, /executeEntryFn: executeShipmentAdjustmentInTransaction/);
  assert.doesNotMatch(batchApiSource, /fetch\(|\/api\/shipment\/adjust['"]/);
  assert.match(batchApiSource, /rolledBack: true,[\s\S]*committedCount: 0/);
  assert.match(batchApiSource, /verified: true,[\s\S]*verifiedCount: results\.length/);

  const dbSource = fs.readFileSync('lib/db.js', 'utf8');
  assert.match(dbSource, /const rollbackOnly = options\.rollbackOnly === true/);
  assert.match(dbSource, /if \(rollbackOnly\) await transaction\.rollback\(\)/);

  const pasteSource = fs.readFileSync('pages/orders/paste.js', 'utf8');
  assert.match(pasteSource, /preflightOnly: true/);
  assert.match(pasteSource, /const preflightResponse = await fetch\('\/api\/shipment\/adjust-batch'/);
  assert.match(pasteSource, /const response = await fetch\('\/api\/shipment\/adjust-batch'/);

  console.log('shipment adjust batch atomic transaction tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
