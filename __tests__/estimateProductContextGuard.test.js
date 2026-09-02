const assert = require('node:assert/strict');
const fs = require('node:fs');

async function main() {
  const { shouldApplyEstimateProductContext } = await import('../lib/estimateProductContextGuard.js');

  assert.equal(shouldApplyEstimateProductContext({
    requestId: 3, currentRequestId: 3, requestedProdKey: 456, currentProdKey: '456',
  }), true, '현재 품목의 최신 자동단가 응답은 적용해야 한다.');
  assert.equal(shouldApplyEstimateProductContext({
    requestId: 2, currentRequestId: 3, requestedProdKey: 456, currentProdKey: 456,
  }), false, '이전 요청의 늦은 응답은 새 품목 선택을 덮으면 안 된다.');
  assert.equal(shouldApplyEstimateProductContext({
    requestId: 3, currentRequestId: 3, requestedProdKey: 447, currentProdKey: 456,
  }), false, '다른 품목의 자동단가 응답은 현재 품목에 적용하면 안 된다.');

  const page = fs.readFileSync('pages/estimate.js', 'utf8');
  assert.match(page, /setDefectForm\(\(form\) => \(\{ \.\.\.form, prodKey: String\(key\), cost: '' \}\)\);/, '품목 선택은 단가 조회 전에 즉시 표시해야 한다.');
  assert.doesNotMatch(page, /readOnly=\{defectContextLoading \|\| Number\(defectContext\?\.cost \|\| 0\) > 0\}/, '자동단가가 있어도 사용자가 직접 수정할 수 있어야 한다.');
  assert.match(page, /readOnly=\{defectContextLoading\}/, '자동단가 조회 중에만 입력 충돌을 막아야 한다.');
  console.log('estimate product context guard tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
