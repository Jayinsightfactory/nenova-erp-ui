const test = require('node:test');
const assert = require('node:assert/strict');
let api;
async function packingWorkDraft() {
  return api ||= import('../lib/packingWorkDraft.js');
}

function memoryIndexedDB({ holdFirstPut = false } = {}) {
  const records = new Map();
  let quota = false;
  let releasePut;
  let firstPut = true;
  const database = {
    objectStoreNames: { contains: () => true },
    close() {},
    transaction() {
      const tx = { error: null, objectStore() { return {
        get(key) { const request = {}; queueMicrotask(() => { request.result = records.get(key); request.onsuccess?.(); queueMicrotask(() => tx.oncomplete?.()); }); return request; },
        put(record) {
          const request = {};
          const finish = () => queueMicrotask(() => {
            if (quota) { tx.error = new Error('QuotaExceededError'); request.error = tx.error; request.onerror?.(); tx.onerror?.(); return; }
            records.set(record.key, structuredClone(record)); tx.oncomplete?.();
          });
          if (holdFirstPut && firstPut) { firstPut = false; releasePut = finish; } else finish();
          return request;
        },
        delete(key) { const request = {}; queueMicrotask(() => { records.delete(key); tx.oncomplete?.(); }); return request; },
      }; }, abort() { tx.onabort?.(); } };
      return tx;
    },
  };
  return { records, setQuota(value) { quota = value; }, releasePut() { releasePut?.(); }, open() { const request = { result: database }; queueMicrotask(() => request.onsuccess?.()); return request; } };
}
function file(bytes = 'packing bytes') {
  const blob = new Blob([bytes], { type: 'application/pdf' });
  Object.defineProperties(blob, { name: { value: '41-02 roses.pdf' }, lastModified: { value: 1760000000000 } });
  return blob;
}
const hash = 'a'.repeat(64);

test('receipt and cost recovery remain isolated for the same authenticated owner', async () => {
  const { createPackingWorkDraftStore } = await packingWorkDraft();
  const indexedDB = memoryIndexedDB();
  const receipt = createPackingWorkDraftStore('alice', { indexedDB });
  const cost = createPackingWorkDraftStore('alice', { indexedDB, workspace: 'cost' });
  await receipt.save(snapshot({ country: 'CO' }));
  await cost.save(snapshot({ country: 'AU' }));
  assert.equal((await receipt.load()).country, 'CO');
  assert.equal((await cost.load()).country, 'AU');
  await cost.clear();
  assert.equal((await receipt.load()).country, 'CO');
  assert.equal(await cost.load(), null);
});
test('selected year survives restore; legacy work never invents the current year', async()=>{
 const {normalizePackingWorkSnapshot}=await packingWorkDraft();
 for(const dateYear of ['2025','2026']) assert.equal(normalizePackingWorkSnapshot(snapshot({dateYear})).dateYear,dateYear);
 assert.equal(normalizePackingWorkSnapshot(snapshot()).dateYear,'');
 assert.throws(()=>normalizePackingWorkSnapshot(snapshot({dateYear:'26'})),/dateYear/);
});
function snapshot(overrides = {}) {
  return {
    file: file(), country: 'CO',
    lastExtraction: { sourceHash: hash, result: { invoices: [{ invoice: 'INV-1', pdfSourceHash: hash, products: [{ description: 'ROSE', pcs: 12 }] }] }, sourceInvoices: [{ invoice: 'INV-1', pdfSourceHash: hash }], masterAwb: '123', weekParsed: { week: '41', num: '02' }, wasTruncated: false, legacyReviewRequired: false },
    reviewRows: [{ id: 'row-1', confirmed: false }], reviewConfirmed: false,
    legacyReviewData: { country: 'CO', invoices: [] }, legacyPackingReviewRequired: false,
    extractionSource: 'local PDF reader', mappingDraft: { 'CO|ROSE': { prodKey: 42 } },
    ...overrides,
  };
}

test('per-user latest snapshot restores original file, review, source, and local mapping draft', async () => {
  const { createPackingWorkDraftStore } = await packingWorkDraft();
  const indexedDB = memoryIndexedDB();
  const alice = createPackingWorkDraftStore('alice', { indexedDB });
  const bob = createPackingWorkDraftStore('bob', { indexedDB });
  const saved = await alice.save(snapshot());
  const loaded = await alice.load();
  assert.equal(saved.schemaVersion, 1);
  assert.equal(loaded.country, 'CO');
  assert.equal(loaded.file.name, undefined, 'loaded Blob remains portable; metadata is explicit');
  assert.equal(loaded.fileName, '41-02 roses.pdf');
  assert.equal(loaded.fileType, 'application/pdf');
  assert.equal(loaded.lastModified, 1760000000000);
  assert.equal(loaded.fileBytes, loaded.file.size);
  assert.ok(loaded.file instanceof Blob);
  assert.deepEqual(loaded.reviewRows, snapshot().reviewRows);
  assert.deepEqual(loaded.lastExtraction, snapshot().lastExtraction);
  assert.deepEqual(loaded.mappingDraft, snapshot().mappingDraft);
  assert.equal(await bob.load(), null);
});

test('unknown, generated, catalog, operation, and token fields are excluded from the persisted record', async () => {
  const { createPackingWorkDraftStore } = await packingWorkDraft();
  const indexedDB = memoryIndexedDB();
  const store = createPackingWorkDraftStore('alice', { indexedDB });
  await store.save(snapshot({ generatedExcel: new Blob(['xlsx']), generatedErp: { products: [] }, erpMatches: [{ ProdKey: 9 }], preflightToken: 'nope', unrelated: 'ignore', lastExtraction: { ...snapshot().lastExtraction, generated: { buf: 'skip' }, catalog: { items: [] }, commitToken: 'skip', baselineDigest: 'skip', canCommit: true, eligibility: 'skip', pendingOperation: 'skip', operationId: 'skip', preview: { rows: [] }, excels: [] } }));
  const loaded = await store.load();
  assert.equal(loaded.generatedExcel, undefined);
  assert.equal(loaded.erpMatches, undefined);
  assert.equal(loaded.preflightToken, undefined);
  assert.equal(loaded.unrelated, undefined);
  assert.equal(loaded.lastExtraction.generated, undefined);
  assert.equal(loaded.lastExtraction.catalog, undefined);
  assert.equal(loaded.lastExtraction.commitToken, undefined);
  for (const key of ['baselineDigest', 'canCommit', 'eligibility', 'pendingOperation', 'operationId', 'preview', 'excels']) assert.equal(loaded.lastExtraction[key], undefined);
});

test('invalid scope, shape, inconsistent source hash, and IndexedDB failures surface to callers', async () => {
  const { createPackingWorkDraftStore, PACKING_WORK_DRAFT_MAX_FILE_BYTES } = await packingWorkDraft();
  assert.throws(() => createPackingWorkDraftStore('', { indexedDB: memoryIndexedDB() }), /userId/);
  const indexedDB = memoryIndexedDB();
  const store = createPackingWorkDraftStore('alice', { indexedDB });
  await assert.rejects(store.save(snapshot({ country: 'KR' })), /country/);
  await assert.rejects(store.save(snapshot({ file: new Blob(['x']) })), /fileName/);
  await assert.rejects(store.save(snapshot({ lastExtraction: { ...snapshot().lastExtraction, sourceHash: 'b'.repeat(64) } })), /source hashes/);
  await store.save(snapshot());
  indexedDB.setQuota(true);
  await assert.rejects(store.save(snapshot({ extractionSource: 'retry' })), /QuotaExceededError/);
  assert.equal((await store.load()).extractionSource, 'local PDF reader', 'a failed write does not erase the recovery point');
  assert.ok(PACKING_WORK_DRAFT_MAX_FILE_BYTES >= 50 * 1024 * 1024);
});

test('serial queue makes clear win over an older in-flight save', async () => {
  const { createPackingWorkDraftStore } = await packingWorkDraft();
  const indexedDB = memoryIndexedDB({ holdFirstPut: true });
  const store = createPackingWorkDraftStore('alice', { indexedDB });
  const saving = store.save(snapshot());
  const clearing = store.clear();
  await new Promise(resolve => setImmediate(resolve));
  indexedDB.releasePut();
  await saving;
  await clearing;
  assert.equal(await store.load(), null);
});

test('JSON-style undefined values are omitted in objects and become null in arrays', async () => {
  const { createPackingWorkDraftStore } = await packingWorkDraft();
  const store = createPackingWorkDraftStore('alice', { indexedDB: memoryIndexedDB() });
  await store.save(snapshot({ reviewRows: [{ note: undefined, choices: [undefined, 'kept'] }] }));
  assert.deepEqual((await store.load()).reviewRows, [{ choices: [null, 'kept'] }]);
});

test('load rejects a corrupt or unsupported stored record instead of silently using it', async () => {
  const { createPackingWorkDraftStore } = await packingWorkDraft();
  const indexedDB = memoryIndexedDB();
  const store = createPackingWorkDraftStore('alice', { indexedDB });
  indexedDB.records.set('packing-work-draft:alice', { key: 'packing-work-draft:alice', userId: 'alice', schemaVersion: 99, snapshot: snapshot() });
  await assert.rejects(store.load(), /Invalid packing work draft record/);
});
