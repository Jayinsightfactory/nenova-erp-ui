import assert from 'node:assert/strict';
import { createMappingDbStore, MAPPING_STORE_KEYS } from '../lib/mappingDbStore.js';
import { prepareMappingMigration, assertMigratedDocuments } from '../lib/mappingMigration.js';
import { findMappingFuzzy, detectFallbackProdKey } from '../lib/pasteMappingMatch.js';
import { findCustomerMapping } from '../lib/pasteCustomerMappingMatch.js';

function fixture(initial = { a: { prodKey: 1, manual: true, unknown: 'keep' } }) {
  let marker = true;
  let payload = JSON.stringify(initial);
  let revision = 1;
  let writes = 0;
  let gate = Promise.resolve();
  const q = async (statement, params = {}) => {
    if (statement.includes('WebMappingMigration')) return { recordset: marker ? [{ MigrationKey: 'order-mappings-v1' }] : [] };
    if (statement.includes('SELECT Payload, Revision')) return { recordset: payload == null ? [] : [{ Payload: payload, Revision: revision }] };
    if (statement.includes('SELECT Payload')) return { recordset: payload == null ? [] : [{ Payload: payload }] };
    if (statement.includes('UPDATE dbo.WebMappingStore')) {
      assert.equal(params.revision.value, revision);
      payload = params.payload.value;
      revision += 1; writes += 1;
      return { rowsAffected: [1] };
    }
    throw new Error(`unexpected SQL ${statement}`);
  };
  const transaction = async fn => {
    let release;
    const next = new Promise(resolve => { release = resolve; });
    const prior = gate; gate = next;
    await prior;
    try { return await fn(q); } finally { release(); }
  };
  const store = createMappingDbStore({ query: q, withTransaction: transaction,
    sql: { Int: 'int', NVarChar: () => 'nvarchar', MAX: 'max' } });
  return { ...store, state: () => ({ marker, payload, revision, writes }),
    setMarker: value => { marker = value; }, setPayload: value => { payload = value; } };
}

const f = fixture();
const read = await f.readMappingDocument(MAPPING_STORE_KEYS.products);
read.a.prodKey = 999;
assert.equal((await f.readMappingDocument(MAPPING_STORE_KEYS.products)).a.prodKey, 1);
const save = (key, value) => f.mutateMappingDocument(MAPPING_STORE_KEYS.products, async document => {
  await new Promise(resolve => setTimeout(resolve, key === 'b' ? 8 : 0));
  return { document: { ...document, [key]: value }, result: { saved: true, key } };
});
await Promise.all([save('b', { prodKey: 2 }), save('c', { prodKey: 3 })]);
assert.deepEqual(Object.keys(await f.readMappingDocument(MAPPING_STORE_KEYS.products)), ['a', 'b', 'c']);
assert.equal(f.state().revision, 3);
const beforeNoop = f.state().writes;
const skipped = await f.mutateMappingDocument(MAPPING_STORE_KEYS.products, document =>
  ({ changed: false, result: { saved: false, reason: 'manual-mapping-protected' } }));
assert.equal(skipped.reason, 'manual-mapping-protected');
assert.equal(f.state().writes, beforeNoop);
f.setMarker(false);
await assert.rejects(f.readMappingDocument(MAPPING_STORE_KEYS.products), /이전이 완료되지/);
await assert.rejects(f.mutateMappingDocument(MAPPING_STORE_KEYS.products, () => ({})), /이전이 완료되지/);
f.setMarker(true); f.setPayload(null);
await assert.rejects(f.readMappingDocument(MAPPING_STORE_KEYS.products), /문서가 없습니다/);
f.setPayload('not-json');
await assert.rejects(f.readMappingDocument(MAPPING_STORE_KEYS.products), /JSON이 손상/);

const customerRaw = Buffer.from(JSON.stringify({ 매일: { custKey: 538, custName: '원본', custom: { x: 1 } } }));
const productRaw = Buffer.from(JSON.stringify({ 장미: { prodKey: 2429, manual: true, unknown: ['keep'] } }));
const scopedRaw = Buffer.from(JSON.stringify({ 538: { history: [{ before: { manual: true }, after: null }],
  mappings: { 장미: { prodKey: 2429, unit: '단' } }, other: 7 } }));
const snapshot = prepareMappingMigration({ customer: customerRaw, product: productRaw, customerProduct: scopedRaw });
assert.deepEqual(snapshot.counts, { customer: 1, product: 1, 'customer-product': 1 });
assert.deepEqual(snapshot.documents[2].document['538'].history, [{ before: { manual: true }, after: null }]);
assertMigratedDocuments(snapshot, snapshot.documents.map(d => ({ StoreKey: d.storeKey, Payload: d.payload })));
assert.throws(() => assertMigratedDocuments(snapshot, snapshot.documents.map(d => ({ StoreKey: d.storeKey,
  Payload: d.storeKey === 'product' ? '{}' : d.payload }))), /내용이 원본과 다릅니다/);
assert.throws(() => prepareMappingMigration({ customer: null, product: productRaw }), /customer 원본 파일이 없습니다/);
assert.throws(() => prepareMappingMigration({ customer: Buffer.from('{broken'), product: productRaw }), /JSON 파싱 실패/);
assert.equal(prepareMappingMigration({ customer: customerRaw, product: productRaw }).documents[2].sourceMissing, true);
assert.throws(() => findMappingFuzzy('', Promise.resolve({})), /snapshot/);
assert.throws(() => findCustomerMapping('', Promise.resolve({})), /snapshot/);
assert.throws(() => detectFallbackProdKey(1, null, Promise.resolve({})), /snapshot/);
console.log('mapping DB store tests passed');
