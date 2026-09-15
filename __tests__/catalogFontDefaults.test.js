import assert from 'node:assert/strict';
import { DEFAULT_CATALOG_FONT_SIZES, normalizeCatalogFields, buildCatalogCellLines } from '../lib/catalogLineText.js';

assert.deepEqual(normalizeCatalogFields().fontSizes, {
  eng: 14, kor: 14, price: 12, extra1: 10, extra2: 10, extra3: 10,
});
for (const input of [null, undefined, {}, { catalogFields: null }]) {
  assert.deepEqual(normalizeCatalogFields(input).fontSizes, DEFAULT_CATALOG_FONT_SIZES);
}
const custom = {
  showExtra1: true, showExtra2: true, showExtra3: true,
  fontSizes: { eng: 18, kor: 24, price: 16, extra1: 11, extra2: 13, extra3: 15 },
  layout: { imagePadding: 0 },
};
assert.deepEqual(normalizeCatalogFields({ catalogFields: custom }), normalizeCatalogFields(custom));
assert.deepEqual(normalizeCatalogFields(custom).layout, custom.layout);
assert.equal(normalizeCatalogFields({ showNames: false }).showEng, false);
assert.equal(normalizeCatalogFields({ showNames: false, catalogFields: custom }).showKor, false);
assert.equal(normalizeCatalogFields({ catalogFields: { showEng: false, showKor: true } }).showKor, true);
assert.equal(normalizeCatalogFields({ catalogFields: { showEng: false } }).showEng, false);

assert.deepEqual(normalizeCatalogFields({ fontSizes: {
  eng: 0, kor: -20, price: 900, extra1: '19.5', extra2: Infinity, extra3: 'bad',
} }).fontSizes, { eng: 6, kor: 6, price: 48, extra1: 19.5, extra2: 10, extra3: 10 });
for (const invalid of [null, undefined, '', ' ', false, {}, [], NaN, -Infinity]) {
  assert.equal(normalizeCatalogFields({ fontSizes: { kor: invalid } }).fontSizes.kor, 14);
}
const rows = buildCatalogCellLines({
  engName: 'Rose', korName: '장미', salePrice: 2000, outUnit: '단',
  extra1: '배송 안내', extra2: 0, extra3: '기타 3',
}, { catalogFields: custom });
assert.deepEqual(rows.map(({ kind, fontSize }) => [kind, fontSize]), [
  ['eng', 18], ['kor', 24], ['price', 16], ['extra1', 11], ['extra2', 13], ['extra3', 15],
]);
assert.equal(rows.find(row => row.kind === 'extra2').text, '0');
assert.deepEqual(buildCatalogCellLines({ engName: 'Rose', korName: '장미', salePrice: 2000 }, {
  showNames: false, showPrice: false,
}), []);
const normalized = normalizeCatalogFields(custom);
normalized.fontSizes.eng = 47;
assert.equal(custom.fontSizes.eng, 18, 'normalization must not mutate draft settings');
assert.equal(DEFAULT_CATALOG_FONT_SIZES.eng, 14);
console.log('catalog font defaults tests passed');
