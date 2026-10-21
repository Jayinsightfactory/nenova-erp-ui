// Browser-only, per-user recovery for an unfinished packing upload.  This is
// deliberately separate from the shared team mapping/CAS store.
'use strict';

const DB_NAME = 'nenova-packing-work-draft';
const STORE_NAME = 'latest-by-user';
const DB_VERSION = 1;
export const PACKING_WORK_DRAFT_SCHEMA_VERSION = 1;
// The current upload UI accepts up to 50 MiB for the largest (China XLSX)
// source. Keeping the recovery copy at the same bound prevents IndexedDB from
// becoming an alternate, unbounded upload path.
export const PACKING_WORK_DRAFT_MAX_FILE_BYTES = 50 * 1024 * 1024;
const COUNTRIES = new Set(['CO', 'NL', 'CN', 'EC', 'TH', 'AU', 'US', 'VN']);
const chainsByBackend = new WeakMap();

function fail(message) { throw new Error(`Invalid packing work draft: ${message}`); }
function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
function isBlob(value) { return typeof Blob !== 'undefined' && value instanceof Blob; }
function requiredUserId(userId) {
  const value = String(userId ?? '').trim();
  if (!value) throw new Error('Packing work draft requires an authenticated userId.');
  return value;
}
function draftKey(userId) { return `packing-work-draft:${userId}`; }
function copyString(value, name, { allowEmpty = false, max = 4096 } = {}) {
  if (typeof value !== 'string') fail(`${name} must be a string`);
  if (!allowEmpty && !value.trim()) fail(`${name} is required`);
  if (value.length > max) fail(`${name} is too long`);
  return value;
}

// Values in source/review state are data only. Do not carry derived files,
// product catalog snapshots, write credentials, or protocol tokens forward.
function excludedKey(key) {
  return /^(?:generated|generatedErp|excel|excels|catalog|erpMatches|erpProducts|baselineDigest|canCommit|eligibility|pendingOperation|operationId|preview)$/i.test(key)
    || /(?:^|_)(?:preflight|commit|token)(?:$|_)/i.test(key)
    || /^(?:preflight|commit|preview|access|refresh|auth).*token$/i.test(key);
}
function cleanData(value, path = 'value') {
  if (value === undefined) return undefined;
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail(`${path} contains a non-finite number`);
    return value;
  }
  if (Array.isArray(value)) return value.map((item, index) => {
    const cleaned = cleanData(item, `${path}[${index}]`);
    return cleaned === undefined ? null : cleaned;
  });
  if (!isPlainObject(value)) fail(`${path} must contain only plain structured data`);
  const copy = {};
  for (const [key, item] of Object.entries(value)) {
    if (excludedKey(key)) continue;
    const cleaned = cleanData(item, `${path}.${key}`);
    if (cleaned !== undefined) copy[key] = cleaned;
  }
  return copy;
}
function cleanLastExtraction(value) {
  if (value == null) return null;
  if (!isPlainObject(value)) fail('lastExtraction must be an object');
  const copy = {};
  for (const key of ['result', 'sourceInvoices', 'masterAwb', 'weekParsed', 'wasTruncated', 'legacyReviewRequired', 'sourceHash']) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) continue;
    const cleaned = cleanData(value[key], `lastExtraction.${key}`);
    if (cleaned !== undefined) copy[key] = cleaned;
  }
  if (copy.result !== undefined && !isPlainObject(copy.result)) fail('lastExtraction.result must be an object');
  if (copy.sourceInvoices !== undefined && !Array.isArray(copy.sourceInvoices)) fail('lastExtraction.sourceInvoices must be an array');
  if (copy.masterAwb !== undefined && typeof copy.masterAwb !== 'string') fail('lastExtraction.masterAwb must be a string');
  if (copy.weekParsed !== undefined && !isPlainObject(copy.weekParsed)) fail('lastExtraction.weekParsed must be an object');
  if (copy.wasTruncated !== undefined && typeof copy.wasTruncated !== 'boolean') fail('lastExtraction.wasTruncated must be a boolean');
  if (copy.legacyReviewRequired !== undefined && typeof copy.legacyReviewRequired !== 'boolean') fail('lastExtraction.legacyReviewRequired must be a boolean');
  if (copy.sourceHash !== undefined && !/^[a-f0-9]{64}$/i.test(copy.sourceHash)) fail('lastExtraction.sourceHash must be a SHA-256 hash');
  return copy;
}
function collectSourceHashes(value, hashes = []) {
  if (Array.isArray(value)) value.forEach(item => collectSourceHashes(item, hashes));
  else if (isPlainObject(value)) {
    for (const [key, item] of Object.entries(value)) {
      if ((key === 'pdfSourceHash' || key === 'sourceHash') && typeof item === 'string') hashes.push(item.toLowerCase());
      collectSourceHashes(item, hashes);
    }
  }
  return hashes;
}
function verifySourceHashes(lastExtraction) {
  if (!lastExtraction) return;
  const hashes = collectSourceHashes(lastExtraction);
  if (hashes.some(hash => !/^[a-f0-9]{64}$/.test(hash))) fail('source hash must be a SHA-256 hash');
  if (new Set(hashes).size > 1) fail('source hashes do not describe the same original file');
}

export function normalizePackingWorkSnapshot(snapshot) {
  if (!isPlainObject(snapshot)) fail('snapshot must be an object');
  const country = copyString(snapshot.country, 'country', { max: 2 }).toUpperCase();
  if (!COUNTRIES.has(country)) fail('country is unsupported');
  if (!isBlob(snapshot.file)) fail('file must be a Blob or File');
  const file = snapshot.file;
  if (!Number.isFinite(file.size) || file.size < 0 || file.size > PACKING_WORK_DRAFT_MAX_FILE_BYTES) fail(`file must not exceed ${PACKING_WORK_DRAFT_MAX_FILE_BYTES} bytes`);
  const fileName = copyString(snapshot.fileName ?? file.name, 'fileName', { max: 512 });
  const fileType = copyString(snapshot.fileType ?? file.type ?? '', 'fileType', { allowEmpty: true, max: 255 });
  const rawLastModified = snapshot.lastModified ?? file.lastModified;
  if (!Number.isSafeInteger(rawLastModified) || rawLastModified < 0) fail('lastModified must be a non-negative integer');
  if (snapshot.fileBytes !== undefined && snapshot.fileBytes !== file.size) fail('fileBytes does not match the Blob size');
  const lastExtraction = cleanLastExtraction(snapshot.lastExtraction);
  verifySourceHashes(lastExtraction);
  const reviewRows = snapshot.reviewRows == null ? null : cleanData(snapshot.reviewRows, 'reviewRows');
  if (reviewRows !== null && !Array.isArray(reviewRows)) fail('reviewRows must be an array or null');
  const legacyReviewData = snapshot.legacyReviewData == null ? null : cleanData(snapshot.legacyReviewData, 'legacyReviewData');
  if (legacyReviewData !== null && !isPlainObject(legacyReviewData)) fail('legacyReviewData must be an object or null');
  const mappingDraft = snapshot.mappingDraft == null ? null : cleanData(snapshot.mappingDraft, 'mappingDraft');
  if (mappingDraft !== null && !isPlainObject(mappingDraft) && !Array.isArray(mappingDraft)) fail('mappingDraft must be structured data or null');
  if (typeof snapshot.reviewConfirmed !== 'boolean') fail('reviewConfirmed must be a boolean');
  if (typeof snapshot.legacyPackingReviewRequired !== 'boolean') fail('legacyPackingReviewRequired must be a boolean');
  const extractionSource = copyString(snapshot.extractionSource ?? '', 'extractionSource', { allowEmpty: true, max: 1000 });
  return {
    schemaVersion: PACKING_WORK_DRAFT_SCHEMA_VERSION,
    file,
    fileName,
    fileType,
    lastModified: rawLastModified,
    fileBytes: file.size,
    country,
    lastExtraction,
    reviewRows,
    reviewConfirmed: snapshot.reviewConfirmed,
    legacyReviewData,
    legacyPackingReviewRequired: snapshot.legacyPackingReviewRequired,
    extractionSource,
    mappingDraft,
  };
}

const normalizeSnapshot = normalizePackingWorkSnapshot;

function openDatabase(indexedDB) {
  if (!indexedDB || typeof indexedDB.open !== 'function') return Promise.reject(new Error('IndexedDB unavailable.'));
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME, { keyPath: 'key' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('IndexedDB open failed.'));
    request.onblocked = () => reject(new Error('IndexedDB upgrade blocked.'));
  });
}
function runTransaction(db, mode, work) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const settle = (callback, value) => { if (!settled) { settled = true; callback(value); } };
    let result;
    let tx;
    try { tx = db.transaction(STORE_NAME, mode); } catch (error) { reject(error); return; }
    tx.oncomplete = () => settle(resolve, result);
    tx.onerror = () => settle(reject, tx.error || new Error('IndexedDB transaction failed.'));
    tx.onabort = () => settle(reject, tx.error || new Error('IndexedDB transaction aborted.'));
    try {
      const store = tx.objectStore(STORE_NAME);
      work(store, value => { result = value; }, error => settle(reject, error));
    } catch (error) {
      try { tx.abort(); } catch { /* transaction error remains the useful error */ }
      settle(reject, error);
    }
  });
}
function backendChains(indexedDB) {
  const backend = indexedDB || globalThis.indexedDB;
  if (!backend || (typeof backend !== 'object' && typeof backend !== 'function')) return new Map();
  let chains = chainsByBackend.get(backend);
  if (!chains) { chains = new Map(); chainsByBackend.set(backend, chains); }
  return chains;
}
function enqueue(indexedDB, key, work) {
  const chains = backendChains(indexedDB);
  const prior = chains.get(key) || Promise.resolve();
  const next = prior.catch(() => undefined).then(work);
  chains.set(key, next);
  next.finally(() => { if (chains.get(key) === next) chains.delete(key); }).catch(() => undefined);
  return next;
}
function validStoredRecord(record, key, userId) {
  if (!isPlainObject(record) || record.key !== key || record.userId !== userId || record.schemaVersion !== PACKING_WORK_DRAFT_SCHEMA_VERSION) return false;
  try { normalizeSnapshot(record.snapshot); return true; } catch { return false; }
}

export function createPackingWorkDraftStore(userId, { indexedDB = globalThis.indexedDB } = {}) {
  const normalizedUserId = requiredUserId(userId);
  const key = draftKey(normalizedUserId);
  const withDatabase = async operation => {
    const db = await openDatabase(indexedDB);
    try { return await operation(db); } finally { db.close?.(); }
  };
  const save = snapshot => enqueue(indexedDB, key, async () => {
    const normalized = normalizeSnapshot(snapshot);
    // Structured clone here fails before replacing a previous recovery point.
    let cloned;
    try { cloned = structuredClone(normalized); } catch (error) { throw new Error(`Packing work draft cannot be cloned: ${error.message}`); }
    await withDatabase(db => runTransaction(db, 'readwrite', (store, done, failTransaction) => {
      const request = store.put({ key, userId: normalizedUserId, schemaVersion: PACKING_WORK_DRAFT_SCHEMA_VERSION, snapshot: cloned });
      request.onerror = () => failTransaction(request.error || new Error('IndexedDB draft save failed.'));
      done();
    }));
    return structuredClone(normalized);
  });
  const load = () => enqueue(indexedDB, key, async () => withDatabase(async db => {
    const record = await runTransaction(db, 'readonly', (store, done, failTransaction) => {
      const request = store.get(key);
      request.onsuccess = () => done(request.result || null);
      request.onerror = () => failTransaction(request.error || new Error('IndexedDB draft load failed.'));
    });
    if (record === null) return null;
    if (!validStoredRecord(record, key, normalizedUserId)) throw new Error('Invalid packing work draft record.');
    return structuredClone(normalizeSnapshot(record.snapshot));
  }));
  const clear = () => enqueue(indexedDB, key, async () => withDatabase(db => runTransaction(db, 'readwrite', (store, done, failTransaction) => {
    const request = store.delete(key);
    request.onerror = () => failTransaction(request.error || new Error('IndexedDB draft clear failed.'));
    done();
  })));
  return Object.freeze({ load, save, clear });
}
