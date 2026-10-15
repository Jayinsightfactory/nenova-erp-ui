import { createHash } from 'node:crypto';
import { MAPPING_MIGRATION_KEY, MAPPING_STORE_KEYS } from './mappingStoreKeys.js';

function sha256(value) { return createHash('sha256').update(value).digest('hex'); }

function parseWholeDocument(raw, label) {
  if (!Buffer.isBuffer(raw)) throw new Error(`${label} 원본 파일이 없습니다.`);
  let document;
  try { document = JSON.parse(raw.toString('utf8')); }
  catch (error) { throw new Error(`${label} JSON 파싱 실패: ${error.message}`); }
  if (!document || typeof document !== 'object' || Array.isArray(document)) {
    throw new Error(`${label} JSON 최상위는 객체여야 합니다.`);
  }
  return document;
}

export function prepareMappingMigration({ customer, product, customerProduct = null }) {
  const source = [
    [MAPPING_STORE_KEYS.customers, customer, true],
    [MAPPING_STORE_KEYS.products, product, true],
    // This optional scoped runtime file historically did not exist before any
    // customer-specific aliases were saved. Its exact empty logical document is {}.
    [MAPPING_STORE_KEYS.customerProducts, customerProduct ?? Buffer.from('{}'), false],
  ];
  const documents = source.map(([storeKey, raw, required]) => {
    if (required && !Buffer.isBuffer(raw)) throw new Error(`${storeKey} 원본 파일이 없습니다.`);
    const document = parseWholeDocument(raw, storeKey);
    const payload = JSON.stringify(document);
    return { storeKey, document, payload, count: Object.keys(document).length,
      byteHash: sha256(raw), semanticHash: sha256(payload),
      sourceMissing: !required && customerProduct === null };
  });
  return {
    documents,
    sourceHashes: Object.fromEntries(documents.map(doc => [doc.storeKey, doc.byteHash])),
    semanticHashes: Object.fromEntries(documents.map(doc => [doc.storeKey, doc.semanticHash])),
    counts: Object.fromEntries(documents.map(doc => [doc.storeKey, doc.count])),
  };
}

export function assertMigratedDocuments(snapshot, rows) {
  const received = new Map((rows || []).map(row => [row.StoreKey, row.Payload]));
  if (received.size !== snapshot.documents.length) throw new Error('이전된 매칭 문서 개수가 다릅니다.');
  for (const original of snapshot.documents) {
    const raw = received.get(original.storeKey);
    if (typeof raw !== 'string') throw new Error(`${original.storeKey} 이전 문서가 없습니다.`);
    const parsed = parseWholeDocument(Buffer.from(raw), original.storeKey);
    if (sha256(JSON.stringify(parsed)) !== original.semanticHash) {
      throw new Error(`${original.storeKey} 이전 문서 내용이 원본과 다릅니다.`);
    }
  }
  return true;
}

/** Execute only inside the caller's SQL transaction; DDL, three documents,
 * marker, and readback either all commit or all roll back. */
export async function applyMappingSnapshot({ tQuery, sql, snapshot, ddl }) {
  await tQuery(ddl);
  const marker = await tQuery(
    `SELECT MigrationKey FROM dbo.WebMappingMigration WITH (UPDLOCK, HOLDLOCK)
      WHERE MigrationKey=@migrationKey`,
    { migrationKey: { type: sql.NVarChar, value: MAPPING_MIGRATION_KEY } });
  if (marker.recordset.length) throw new Error('완료 표식이 있어 파일을 다시 가져올 수 없습니다.');
  const existing = await tQuery(`SELECT StoreKey FROM dbo.WebMappingStore WITH (UPDLOCK, HOLDLOCK)`);
  if (existing.recordset.length) throw new Error('부분 매칭 문서가 있어 자동으로 덮어쓸 수 없습니다.');
  for (const document of snapshot.documents) {
    await tQuery(
      `INSERT INTO dbo.WebMappingStore (StoreKey, Payload, Revision, UpdatedAt)
        VALUES (@storeKey, @payload, 1, SYSUTCDATETIME())`,
      { storeKey: { type: sql.NVarChar, value: document.storeKey },
        payload: { type: sql.NVarChar(sql.MAX), value: document.payload } });
  }
  await tQuery(
    `INSERT INTO dbo.WebMappingMigration
      (MigrationKey, SourceHashes, SourceCounts, SemanticHashes, AppliedAt)
      VALUES (@migrationKey, @sourceHashes, @sourceCounts, @semanticHashes, SYSUTCDATETIME())`,
    { migrationKey: { type: sql.NVarChar, value: MAPPING_MIGRATION_KEY },
      sourceHashes: { type: sql.NVarChar(sql.MAX), value: JSON.stringify(snapshot.sourceHashes) },
      sourceCounts: { type: sql.NVarChar, value: JSON.stringify(snapshot.counts) },
      semanticHashes: { type: sql.NVarChar(sql.MAX), value: JSON.stringify(snapshot.semanticHashes) } });
  const readback = await tQuery(`SELECT StoreKey, Payload FROM dbo.WebMappingStore`);
  assertMigratedDocuments(snapshot, readback.recordset);
  return { counts: snapshot.counts, sourceHashes: snapshot.sourceHashes,
    semanticHashes: snapshot.semanticHashes };
}
