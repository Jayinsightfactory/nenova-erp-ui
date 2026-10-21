import assert from 'node:assert/strict';
import { diffPriceSnapshots, priceKey } from '../lib/mgmt/priceDiff.js';
import { assertMgmtSqlReadOnlyOutsideSchema } from '../lib/mgmt/boundary.js';

const A = (c, p, v, k = 'customer') => ({ custKey: c, prodKey: p, priceKind: k, value: v });
const prev = [A(1, 10, 100), A(1, 11, 200), A(null, 10, 50, 'default'), A(2, 12, 300)];
const next = [A(1, 10, 100.00001), A(1, 11, 250), A(null, 10, 50, 'default'), A(3, 13, 400)];
const d = diffPriceSnapshots(prev, next);
const by = (t) => d.filter((x) => x.type === t);
assert.equal(by('changed').length, 1);
assert.deepEqual([by('changed')[0].before, by('changed')[0].after], [200, 250]);
assert.equal(by('new').length, 1);
assert.equal(by('new')[0].custKey, 3);
assert.equal(by('new')[0].before, null);
assert.equal(by('deleted').length, 1);
assert.equal(by('deleted')[0].custKey, 2);
assert.equal(by('deleted')[0].after, null);
// 동일값(4자리 반올림 이내)은 무기록
assert.equal(d.length, 3);
assert.deepEqual(diffPriceSnapshots(prev, prev), []);
assert.deepEqual(diffPriceSnapshots([], []), []);
// 거래처 단가와 기본 단가는 별개 키
assert.notEqual(priceKey(A(null, 10, 1, 'default')), priceKey(A(1, 10, 1)));
// 쓰기는 web_mgmt 만
assert.ok(assertMgmtSqlReadOnlyOutsideSchema('INSERT INTO web_mgmt.PriceSnapshot (SnapshotKey) VALUES (1)'));
assert.throws(() => assertMgmtSqlReadOnlyOutsideSchema('UPDATE Product SET Cost=1'), /ERP/);
console.log('mgmt price history tests passed');
