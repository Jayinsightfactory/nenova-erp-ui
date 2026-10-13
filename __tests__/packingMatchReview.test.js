const test = require('node:test');
const assert = require('node:assert/strict');
let review;
test.before(async () => { review = (await import('../lib/packingMatchReview.js')).packingMatchReview; });
const db = [{ ProdKey: 7, ProdName: 'Rose 60', country: 'CN', selectable: true }];
const exact = { sourceName: 'Rose 60', matchedName: 'Rose 60' };
const fuzzy = { sourceName: 'Rose60', matchingDescription: 'Rose60', matchedName: 'Rose 60', score: 100 };
const manual = { ...fuzzy, viaAlias: true, erpMatch: { type: 'MANUAL', confirmed: true, prodKey: 7, sourceDescription: 'Rose60', matchedName: 'Rose 60' } };
test('only unique exact DB identity or validated manual evidence completes matching', () => {
  assert.equal(review(exact, db, 'CN').status, 'EXACT');
  assert.equal(review(fuzzy, db, 'CN').status, 'REVIEW');
  assert.equal(review({ ...fuzzy, viaAlias: true }, db, 'CN').status, 'REVIEW');
  assert.equal(review(manual, db, 'CN').status, 'MANUAL');
});
test('missing, duplicate, disabled and foreign-country products stay pending', () => {
  for (const products of [[], [...db, { ...db[0], ProdKey: 8 }], [{ ...db[0], selectable: false }], [{ ...db[0], country: 'NL' }]]) {
    assert.equal(review(exact, products, 'CN').status, 'UNMATCHED');
  }
  assert.equal(review({ ...exact, unmatched: true }, db, 'CN').needsReview, true);
});
test('manual evidence cannot confirm another source, name, or product key', () => {
  for (const patch of [{ prodKey: 8 }, { sourceDescription: 'Other' }, { matchedName: 'Other' }, { confirmed: false }]) {
    assert.equal(review({ ...manual, erpMatch: { ...manual.erpMatch, ...patch } }, db, 'CN').status, 'REVIEW');
  }
});
test('review policy never mutates quantities, dates or source evidence', () => {
  const product = { ...manual, qty: 40, lineAmount: 700, OrderYear: 2026, OrderWeek: '41-02' };
  const before = JSON.stringify({ product, db });
  review(product, db, 'CN');
  assert.equal(JSON.stringify({ product, db }), before);
});
