const assert = require('node:assert/strict');
const test = require('node:test');

let packingPreparationBlockReason;
test.before(async () => {
  ({ packingPreparationBlockReason } = await import('../lib/packingReceiptPreparation.js'));
});

const base = {
  sharedReady: true,
  saving: false,
  processing: false,
  latestShared: false,
  matchingComplete: false,
  remainingMatches: 9,
  allocationCount: 2,
};

test('allocation review can open before unrelated fuzzy matches are resolved', () => {
  assert.equal(packingPreparationBlockReason({ ...base, allowAllocationReview: true }), '');
});

test('receipt preparation remains blocked until all product matches are resolved', () => {
  assert.match(packingPreparationBlockReason(base), /9건 남았습니다/);
});

test('allocation review does not bypass shared-state or save guards', () => {
  assert.match(packingPreparationBlockReason({ ...base, allowAllocationReview: true, sharedReady: false }), /팀 공용 매칭/);
  assert.match(packingPreparationBlockReason({ ...base, allowAllocationReview: true, saving: true }), /저장/);
  assert.match(packingPreparationBlockReason({ ...base, allowAllocationReview: true, processing: true }), /분석/);
  assert.match(packingPreparationBlockReason({ ...base, allowAllocationReview: true, latestShared: true }), /다른 작업자/);
});
