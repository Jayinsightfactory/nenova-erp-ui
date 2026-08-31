const assert = require('node:assert/strict');

async function main() {
  const {
    buildShipmentFixErrorView,
    describeShipmentFixLog,
    formatShipmentFixErrorMessage,
    getShipmentFixStatusPresentation,
  } = await import('../lib/shipmentFixUserMessage.js');

  const partial = buildShipmentFixErrorView({
    code: 'PARTIAL_CATEGORY_FIX_BLOCKED',
    remainingCategories: ['콜롬비아알스트로', '콜롬비아카네이션'],
  }, '35-02');
  assert.match(partial.title, /35-02.*빠져/);
  assert.match(partial.summary, /알스트로.*카네이션/);
  assert.match(partial.action, /전체/);
  assert.equal(partial.changed, false, '사전 차단은 원장 미변경으로 설명해야 한다.');

  const currentLog = describeShipmentFixLog({
    Step: 'partial_category_fix_block',
    Detail: '2026/35-02 remaining=콜롬비아알스트로,콜롬비아카네이션',
  });
  assert.match(currentLog.title, /35-02/);
  assert.match(currentLog.summary, /작업 시작 전에 중단/);
  assert.equal(currentLog.changed, false);

  const partialStatus = getShipmentFixStatusPresentation({
    status: 'PARTIAL', shipmentStatus: 'PARTIAL', detailCount: 243,
    fixedDetailCount: 94, unfixedDetailCount: 149,
    unfixedCategories: '콜롬비아알스트로, 콜롬비아카네이션',
  });
  assert.equal(partialStatus.text, '일부만 확정');
  assert.match(partialStatus.summary, /149건/);
  assert.match(partialStatus.summary, /알스트로/);

  const fixedPending = getShipmentFixStatusPresentation({
    status: 'FIXED_PENDING_STOCK', shipmentStatus: 'FIXED', detailCount: 856,
    fixedDetailCount: 856, unfixedDetailCount: 0, exeAligned: false,
    parityWarnings: ['Product.Stock 음수 2품목 — exe 실시간 재고'],
  });
  assert.equal(fixedPending.text, '출고확정·점검필요');
  assert.doesNotMatch(fixedPending.text, /출고없음/);
  assert.match(fixedPending.summary, /모두 확정/);
  assert.doesNotMatch(fixedPending.summary, /Product\.Stock/);

  const noShipment = getShipmentFixStatusPresentation({ detailCount: 0 });
  assert.equal(noShipment.text, '출고없음');

  const stockFailed = buildShipmentFixErrorView({ code: 'STOCK_CALC_FAILED' }, '35-01', '확정취소');
  assert.equal(stockFailed.changed, true);
  assert.match(stockFailed.action, /새로 조회/);
  assert.doesNotMatch(stockFailed.action, /같은 차수를 다시 취소/);

  const autoStockFailed = buildShipmentFixErrorView({ code: 'AUTO_STOCK_CALC_FAILED' }, '35-02', '확정');
  assert.equal(autoStockFailed.changed, false);
  assert.match(autoStockFailed.summary, /모두 되돌려졌고/);
  assert.match(autoStockFailed.summary, /확정상태도 바뀌지/);

  const later = formatShipmentFixErrorMessage({
    code: 'LATER_FIXED_EXISTS',
    nextWeek: { orderYear: '2026', orderWeek: '35-02' },
    products: [{ prodName: 'CARNATION Moon Light' }],
  }, '35-01', '확정취소');
  assert.match(later, /뒤 차수[\s\S]*35-02/);
  assert.match(later, /Moon Light/);

  const timedOut = buildShipmentFixErrorView({ error: 'The operation was aborted by timeout' }, '35-02');
  assert.match(timedOut.title, /끝났는지.*확인하지 못/);
  assert.equal(timedOut.changed, null);

  console.log('shipment fix user message tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
