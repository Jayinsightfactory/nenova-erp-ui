const assert = require('assert');
const fs = require('fs');

const contract = JSON.parse(fs.readFileSync('docs/contracts/china-volume-board.json', 'utf8'));
const schema = fs.readFileSync('docs/DB_STRUCTURE.md', 'utf8');

const chinaTables = [
  'WebChinaVolumeBoard',
  'WebChinaVolumeProductMap',
];

for (const table of chinaTables) {
  assert(schema.includes(table), `${table}가 DB 구조 문서에 등록되어야 합니다.`);
}

const action = (name) => contract.actions.find(item => item.name === name);
for (const name of ['CHINA_VOLUME_BOARD_SAVE', 'CHINA_VOLUME_BOARD_DELETE', 'CHINA_VOLUME_BOARD_MATCH_SAVE']) {
  assert(action(name), `${name} 계약이 필요합니다.`);
  assert.deepStrictEqual(action(name).orderDetail, 'preserve');
  assert.deepStrictEqual(action(name).shipmentDetail, 'preserve');
  assert.deepStrictEqual(action(name).stock, 'preserve');
}
assert.deepStrictEqual(action('CHINA_VOLUME_BOARD_SAVE').writeAllowlist, chinaTables);
assert.deepStrictEqual(action('CHINA_VOLUME_BOARD_DELETE').writeAllowlist, ['WebChinaVolumeBoard']);
assert.deepStrictEqual(contract.criteriaLedger.persistence.businessScope, ['OrderYear', 'OrderWeek']);
assert.deepStrictEqual(contract.criteriaLedger.persistence.identity, ['BoardKey']);
assert(contract.criteriaLedger.persistence.rowVersion.includes('expectedRowVersion'));
assert(contract.criteriaLedger.persistence.staleRevision.includes('HTTP 409'));
assert(contract.criteriaLedger.persistence.deleteRetention.includes('soft-delete'));
assert(contract.criteriaLedger.mismatchReview.choices.includes('leave unresolved and save for later'));
assert(contract.criteriaLedger.excelLayout.sheet.includes('one worksheet'));
assert(contract.criteriaLedger.excelLayout.printOnlyPagination.includes('one worksheet') || contract.criteriaLedger.excelLayout.printOnlyPagination.includes('per-page sheets'));

// 실행형 BoardKey/RowVersion 정책 fixture: 같은 차수에 여러 작업본이 공존하고,
// stale token은 어떤 행도 변경하지 않고 409 재조회로 돌려보내야 한다.
function saveBoard(state, input) {
  const current = state[input.boardKey];
  if (current && input.expectedRowVersion !== current.rowVersion) {
    return { ok: false, status: 409, conflict: 'STALE_ROW_VERSION', state };
  }
  const next = { ...input, rowVersion: (current?.rowVersion || 0) + 1, isDeleted: false };
  return { ok: true, state: { ...state, [input.boardKey]: next } };
}

function softDeleteBoard(state, input) {
  const current = state[input.boardKey];
  if (!current || current.rowVersion !== input.expectedRowVersion || current.isDeleted) {
    return { ok: false, status: 409, conflict: 'STALE_ROW_VERSION', state };
  }
  return { ok: true, state: { ...state, [input.boardKey]: { ...current, rowVersion: current.rowVersion + 1, isDeleted: true } } };
}

let state = {};
let result = saveBoard(state, { boardKey: 'board-a', orderYear: 2026, orderWeek: '35-01', payload: 'v1', expectedRowVersion: undefined });
assert(result.ok);
state = result.state;
assert.strictEqual(state['board-a'].rowVersion, 1);
// 동일 차수의 별도 작업본은 독립 BoardKey로 공존한다.
result = saveBoard(state, { boardKey: 'board-b', orderYear: 2026, orderWeek: '35-01', payload: 'other', expectedRowVersion: undefined });
assert(result.ok);
state = result.state;
assert.strictEqual(state['board-b'].payload, 'other');
// board-a의 수정은 해당 BoardKey와 연도·차수 범위에만 적용된다.
result = saveBoard(state, { boardKey: 'board-a', orderYear: 2026, orderWeek: '35-01', payload: 'v2', expectedRowVersion: 1 });
assert(result.ok);
state = result.state;
assert.strictEqual(state['board-a'].rowVersion, 2);
assert.strictEqual(state['board-a'].payload, 'v2');
assert.strictEqual(state['board-b'].payload, 'other');
// 낡은 화면의 저장은 절대 최신 데이터를 덮지 않는다.
const beforeStale = JSON.stringify(state);
result = saveBoard(state, { boardKey: 'board-a', orderYear: 2026, orderWeek: '35-01', payload: 'stale', expectedRowVersion: 1 });
assert.strictEqual(result.ok, false);
assert.strictEqual(result.status, 409);
assert.strictEqual(result.conflict, 'STALE_ROW_VERSION');
assert.strictEqual(JSON.stringify(result.state), beforeStale);
// 삭제는 soft-delete이며 BoardKey 본문/업로드/매칭 이력이 남는 전제다.
result = softDeleteBoard(state, { boardKey: 'board-a', expectedRowVersion: 2 });
assert(result.ok);
assert.strictEqual(result.state['board-a'].isDeleted, true);
assert.strictEqual(result.state['board-a'].payload, 'v2');

// 불일치 검토 선택은 unresolved를 정상으로 위장하지 않는다.
function reviewStatus({ unmatchedRows = 0, mismatches = 0, choice = 'leave unresolved and save for later' }) {
  const unresolved = choice === 'leave unresolved and save for later';
  return (unmatchedRows > 0 || mismatches > 0 || unresolved) ? 'WARNING' : 'OK';
}
assert.strictEqual(reviewStatus({ unmatchedRows: 1, choice: 'apply matched packing quantity' }), 'WARNING');
assert.strictEqual(reviewStatus({ mismatches: 1, choice: 'keep current board quantity' }), 'WARNING');
assert.strictEqual(reviewStatus({ unmatchedRows: 0, mismatches: 0, choice: 'apply matched packing quantity' }), 'OK');
assert.strictEqual(reviewStatus({ unmatchedRows: 0, mismatches: 0 }), 'WARNING');

console.log('china volume board persistence contract passed');
