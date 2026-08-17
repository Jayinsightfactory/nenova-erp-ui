const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

async function main() {
  const {
    orderPasteMixedBatchTargets,
    pasteBatchActionType,
  } = await import('../lib/pasteMixedBatch.js');

  const mixed = [
    { prodKey: 101, action: '추가', inputName: '추가 A' },
    { prodKey: 201, action: '취소', inputName: '취소 A' },
    { prodKey: 102, action: '추가', inputName: '추가 B' },
    { prodKey: 202, action: '취소', inputName: '취소 B' },
  ];
  const ordered = orderPasteMixedBatchTargets(mixed);

  assert.deepEqual(
    ordered.map((item) => item.inputName),
    ['취소 A', '취소 B', '추가 A', '추가 B'],
    '혼합 붙여넣기는 CANCEL 전체를 입력순서대로 처리한 뒤 ADD 전체를 입력순서대로 처리해야 한다.',
  );
  assert.deepEqual(
    ordered.map(pasteBatchActionType),
    ['CANCEL', 'CANCEL', 'ADD', 'ADD'],
    '실제 실행 배열은 CANCEL 단계와 ADD 단계가 섞이면 안 된다.',
  );
  assert.deepEqual(orderPasteMixedBatchTargets([]), [], '빈 일괄 요청은 그대로 비어 있어야 한다.');

  const crossYearFixture = [
    { orderYear: '2025', orderWeek: '33-02', prodKey: 201, action: '취소' },
    { orderYear: '2026', orderWeek: '33-02', prodKey: 201, action: '취소' },
    { orderYear: '2026', orderWeek: '33-02', prodKey: 101, action: '추가' },
  ];
  const selectedYearTargets = orderPasteMixedBatchTargets(
    crossYearFixture.filter((item) => item.orderYear === '2026'),
  );
  assert.deepEqual(
    selectedYearTargets.map((item) => `${item.orderYear}:${pasteBatchActionType(item)}`),
    ['2026:CANCEL', '2026:ADD'],
    '동일 차수 교차연도 fixture는 선택 연도 안에서만 CANCEL→ADD 순서를 적용해야 한다.',
  );

  const pasteSource = fs.readFileSync(path.join(__dirname, '..', 'pages/orders/paste.js'), 'utf8');
  assert.match(
    pasteSource,
    /const targets = orderPasteMixedBatchTargets\(eligibleTargets\);[\s\S]*for \(const t of targets\)/,
    '페이지의 실제 API 실행 배열에 CANCEL→ADD 순서 함수를 적용해야 한다.',
  );
  assert.match(
    pasteSource,
    /type: 'CANCEL'[\s\S]*− 취소[\s\S]*type: 'ADD'[\s\S]*\+ 추가/,
    'DB 저장 내역의 단건 조정은 왼쪽 취소, 오른쪽 추가 순서로 표시해야 한다.',
  );

  console.log('paste mixed batch tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
