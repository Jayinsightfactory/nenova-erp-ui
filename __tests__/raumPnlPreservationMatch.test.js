import assert from 'node:assert/strict';
import { matchRaumPnlPreservationRows } from '../lib/raumPnlPreservationMatch.js';

const incoming = (overrides = {}) => ({ name: '시네신스 · 화이트', unit: '단', qty: 1, price: 1000, supply: 1000, consigned: false, remark: '신라 12행', ...overrides });
const existing = (overrides = {}) => ({ ItemName: '시네신스 · 화이트', Unit: '단', Qty: 1, SalePrice: 1000, SaleAmount: 1000, IsConsigned: 0, IsCustom: 0, Remark: '신라 12행', CostPrice: 500, CostSource: 'manual', ProdKey: 10, ...overrides });

const duplicate = matchRaumPnlPreservationRows([
  incoming({ sourceRemark: '신라 12행', qty: 1, supply: 1000 }),
  incoming({ sourceRemark: '신라 13행', qty: 2, supply: 2000 }),
], [
  existing({ Remark: '신라 13행', Qty: 2, SaleAmount: 2000, CostPrice: 700, ProdKey: 20 }),
  existing({ Remark: '신라 12행', Qty: 1, SaleAmount: 1000, CostPrice: 500, ProdKey: 10 }),
], 'shilla');
assert.deepEqual(duplicate.matches.map(row => row?.ProdKey), [10, 20], 'duplicate Shilla source rows retain source remark, qty/amount, and metadata one-to-one');
assert.deepEqual(duplicate.matches.map(row => row?.CostPrice), [500, 700]);
assert.equal(duplicate.collisions.length, 0);

const reordered = matchRaumPnlPreservationRows([
  incoming({ remark: '신라 13행', qty: 2, supply: 2000 }),
  incoming({ remark: '신라 12행', qty: 1, supply: 1000 }),
], [
  existing({ Remark: '신라 12행', Qty: 1, SaleAmount: 1000, CostPrice: 500, ProdKey: 10 }),
  existing({ Remark: '신라 13행', Qty: 2, SaleAmount: 2000, CostPrice: 700, ProdKey: 20 }),
], 'shilla');
assert.deepEqual(reordered.matches.map(row => row?.ProdKey), [20, 10], 'reordered source rows use source+content, not DB order');

const duplicateIncomingContent = matchRaumPnlPreservationRows([
  incoming({ remark: '신라 12행', qty: 2, supply: 2000 }),
  incoming({ remark: '신라 13행', qty: 2, supply: 2000 }),
], [
  existing({ Remark: '신라 12행', Qty: 1, SaleAmount: 1000, CostPrice: 500, ProdKey: 10 }),
  existing({ Remark: '신라 13행', Qty: 2, SaleAmount: 2000, CostPrice: 700, ProdKey: 20 }),
], 'shilla');
assert.deepEqual(duplicateIncomingContent.matches.map(row => row?.ProdKey), [10, 20], 'duplicate incoming content defers to a stable unique source set instead of consuming the other source row');

const duplicateIncomingContentReversed = matchRaumPnlPreservationRows([
  incoming({ remark: '신라 13행', qty: 2, supply: 2000 }),
  incoming({ remark: '신라 12행', qty: 2, supply: 2000 }),
], [
  existing({ Remark: '신라 12행', Qty: 1, SaleAmount: 1000, CostPrice: 500, ProdKey: 10 }),
  existing({ Remark: '신라 13행', Qty: 2, SaleAmount: 2000, CostPrice: 700, ProdKey: 20 }),
], 'shilla');
assert.deepEqual(duplicateIncomingContentReversed.matches.map(row => row?.ProdKey), [20, 10], 'the same stable-source result is independent of incoming array order');

const partialContentCrossing = matchRaumPnlPreservationRows([
  incoming({ remark: '신라 12행', qty: 2, supply: 2000 }),
  incoming({ remark: '신라 13행', qty: 3, supply: 3000 }),
  incoming({ remark: '신라 14행', qty: 3, supply: 3000 }),
], [
  existing({ Remark: '신라 12행', Qty: 1, SaleAmount: 1000, CostPrice: 500, ProdKey: 10 }),
  existing({ Remark: '신라 13행', Qty: 2, SaleAmount: 2000, CostPrice: 700, ProdKey: 20 }),
  existing({ Remark: '신라 14행', Qty: 3, SaleAmount: 3000, CostPrice: 900, ProdKey: 30 }),
], 'shilla');
assert.deepEqual(partialContentCrossing.matches.map(row => row?.ProdKey), [10, 20, 30], 'a partial content overlap must not cross one source before stable-source matching handles the whole group');

const stableSourceEdit = matchRaumPnlPreservationRows([
  incoming({ remark: '신라 12행', qty: 9, supply: 9000 }),
  incoming({ remark: '신라 13행', qty: 1, supply: 1000 }),
], [
  existing({ Remark: '신라 12행', Qty: 1, SaleAmount: 1000, CostPrice: 500, ProdKey: 10 }),
  existing({ Remark: '신라 13행', Qty: 1, SaleAmount: 1000, CostPrice: 700, ProdKey: 20 }),
], 'shilla');
assert.deepEqual(stableSourceEdit.matches.map(row => row?.ProdKey), [10, 20], 'same cardinality and same unique source set retain per-source metadata after one source row is edited');
assert.equal(stableSourceEdit.collisions.length, 0);

const insertedAndMoved = matchRaumPnlPreservationRows([
  incoming({ remark: '신라 12행', qty: 1, supply: 1000 }),
  incoming({ remark: '신라 13행', qty: 9, supply: 9000 }),
], [existing({ Remark: '신라 12행', Qty: 1, SaleAmount: 1000, CostPrice: 500, ProdKey: 10 })], 'shilla');
assert.deepEqual(insertedAndMoved.matches, [null, null], 'a newly inserted identical source row must not steal metadata from a moved/edited old row');
assert.deepEqual(insertedAndMoved.collisions.map(collision => collision.reason), ['source-cardinality-change', 'source-cardinality-change']);

const deletedAndEdited = matchRaumPnlPreservationRows([
  incoming({ remark: '신라 12행', qty: 2, supply: 2000 }),
], [
  existing({ Remark: '신라 12행', Qty: 1, SaleAmount: 1000, CostPrice: 500, ProdKey: 10 }),
  existing({ Remark: '신라 13행', Qty: 2, SaleAmount: 2000, CostPrice: 700, ProdKey: 20 }),
], 'shilla');
assert.deepEqual(deletedAndEdited.matches, [null], 'a decreased source group must not silently assign the matching deleted/moved row metadata');
assert.deepEqual(deletedAndEdited.collisions.map(collision => collision.reason), ['source-cardinality-change']);

const allNew = matchRaumPnlPreservationRows([
  incoming({ remark: '신라 12행' }), incoming({ remark: '신라 13행', qty: 2, supply: 2000 }),
], [], 'shilla');
assert.deepEqual(allNew.matches, [null, null], 'a first upload has no preserved row to consume');
assert.deepEqual(allNew.collisions, [], 'a first upload must not be blocked by source-cardinality policy');

const unobservableGrowth = matchRaumPnlPreservationRows([
  incoming({ remark: '신라 12행' }), incoming({ remark: '신라 13행', qty: 2, supply: 2000 }),
], [existing({ Remark: '신라 12행', CostPrice: 900, CostSource: 'shilla', ProdKey: null })], 'shilla');
assert.equal(unobservableGrowth.collisions.length, 0, 'an increased group without manual/legacy cost or ProdKey has no preservation choice to block');

const singleChanged = matchRaumPnlPreservationRows([incoming({ qty: 9, supply: 9000 })], [existing()], 'shilla');
assert.equal(singleChanged.matches[0]?.ProdKey, 10, 'a single existing row keeps the legacy exact-key qty/amount change behavior');
assert.equal(singleChanged.collisions.length, 0);

const equivalentDuplicateChanged = matchRaumPnlPreservationRows([incoming({ qty: 9, supply: 9000 })], [
  existing({ Remark: '신라 12행', CostPrice: 500, CostSource: 'shilla', ProdKey: 10 }),
  existing({ Remark: '신라 13행', CostPrice: 700, CostSource: 'shilla', ProdKey: 10 }),
], 'shilla');
assert.equal(equivalentDuplicateChanged.matches[0], null, 'a cardinality decrease with a preserved ProdKey must not choose between duplicate source rows');
assert.deepEqual(equivalentDuplicateChanged.collisions.map(collision => collision.reason), ['source-cardinality-change']);

const ambiguous = matchRaumPnlPreservationRows([incoming({ remark: '신라 99행', qty: 3, supply: 3000 })], [
  existing({ Remark: '신라 12행', Qty: 1, SaleAmount: 1000, CostPrice: 500, ProdKey: 10 }),
  existing({ Remark: '신라 13행', Qty: 2, SaleAmount: 2000, CostPrice: 700, ProdKey: 20 }),
], 'shilla');
assert.equal(ambiguous.matches[0], null);
assert.deepEqual(ambiguous.collisions.map(collision => collision.reason), ['source-cardinality-change']);

const priceChanged = matchRaumPnlPreservationRows([incoming({ price: 1200, qty: 1, supply: 1200 })], [existing()], 'shilla');
assert.equal(priceChanged.matches[0]?.ProdKey, 10, 'unique name+unit+consigned fallback preserves metadata after price change');
assert.equal(priceChanged.fallbackCount, 1);

const exactThenFallback = matchRaumPnlPreservationRows([
  incoming({ remark: '신라 12행', price: 1000, qty: 1, supply: 1000 }),
  incoming({ remark: '신라 13행', price: 3000, qty: 2, supply: 6000 }),
], [
  existing({ Remark: '신라 12행', SalePrice: 1000, Qty: 1, SaleAmount: 1000, CostPrice: 500, ProdKey: 10 }),
  existing({ Remark: '신라 13행', SalePrice: 2000, Qty: 2, SaleAmount: 4000, CostPrice: 700, ProdKey: 20 }),
], 'shilla');
assert.deepEqual(exactThenFallback.matches.map(row => row?.ProdKey), [10, 20], 'fallback cardinality ignores an exact-stage row already consumed from the same identity');
assert.equal(exactThenFallback.fallbackCount, 1);
assert.equal(exactThenFallback.collisions.length, 0);

const noReuse = matchRaumPnlPreservationRows([incoming(), incoming({ remark: '신라 13행' })], [existing()], 'shilla');
assert.equal(noReuse.matches.filter(Boolean).length, 0, 'an increased source group does not reuse or assign the same old row');
assert.equal(noReuse.collisions.length, 2);

const unitSeparated = matchRaumPnlPreservationRows([incoming({ unit: '박스' })], [existing()], 'shilla');
assert.equal(unitSeparated.matches[0], null, 'Shilla unit differences remain separate');
const raumLegacy = matchRaumPnlPreservationRows([incoming({ unit: '박스' })], [existing()], 'raum');
assert.equal(raumLegacy.matches[0]?.ProdKey, 10, 'Raum exact key deliberately retains its legacy no-unit behavior');

const customExcluded = matchRaumPnlPreservationRows([incoming()], [existing({ IsCustom: 1, ProdKey: 999 })], 'shilla');
assert.equal(customExcluded.matches[0], null, 'ordinary import rows cannot consume custom DB rows');

const identicalMetadata = matchRaumPnlPreservationRows([incoming({ remark: 'new 1행' }), incoming({ remark: 'new 2행' })], [
  existing({ Remark: 'old 1행', CostPrice: 500, ProdKey: 10 }), existing({ Remark: 'old 2행', CostPrice: 500, ProdKey: 10 }),
], 'shilla');
assert.equal(identicalMetadata.matches.filter(Boolean).length, 2, 'identical preserved metadata may map deterministically one-to-one');

const movedWithPriceChanges = matchRaumPnlPreservationRows([
  incoming({ remark: '신라 12행', qty: 2, price: 1200, supply: 2400 }),
  incoming({ remark: '신라 13행', qty: 1, price: 1200, supply: 1200 }),
], [
  existing({ Remark: '신라 12행', Qty: 1, SalePrice: 1000, SaleAmount: 1000, CostPrice: 500, ProdKey: 10 }),
  existing({ Remark: '신라 13행', Qty: 2, SalePrice: 1000, SaleAmount: 2000, CostPrice: 700, ProdKey: 20 }),
], 'shilla');
assert.deepEqual(movedWithPriceChanges.matches, [null, null], 'fallback must not use stable source labels alone after moved rows also changed price');
assert.deepEqual(movedWithPriceChanges.collisions.map(collision => collision.reason), ['fallback-preservation-metadata-differ', 'fallback-preservation-metadata-differ']);

const originalIncoming = [incoming()]; const originalExisting = [existing()];
const incomingBefore = JSON.stringify(originalIncoming); const existingBefore = JSON.stringify(originalExisting);
matchRaumPnlPreservationRows(originalIncoming, originalExisting, 'shilla');
assert.equal(JSON.stringify(originalIncoming), incomingBefore, 'incoming input is not mutated');
assert.equal(JSON.stringify(originalExisting), existingBefore, 'existing input is not mutated');

console.log('Raum P&L preservation match tests passed');
