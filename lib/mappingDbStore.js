import { query, withTransaction, sql } from './db.js';
import { MAPPING_MIGRATION_KEY, MAPPING_STORE_KEYS } from './mappingStoreKeys.js';

export { MAPPING_MIGRATION_KEY, MAPPING_STORE_KEYS };
const VALID_KEYS = new Set(Object.values(MAPPING_STORE_KEYS));

function checkedKey(storeKey) {
  if (!VALID_KEYS.has(storeKey)) throw new Error('알 수 없는 매칭 저장소입니다.');
  return storeKey;
}

function parseDocument(payload, storeKey) {
  let document;
  try { document = JSON.parse(payload); } catch { throw new Error(`${storeKey} 매칭 문서 JSON이 손상되었습니다.`); }
  if (!document || typeof document !== 'object' || Array.isArray(document)) {
    throw new Error(`${storeKey} 매칭 문서 형식이 올바르지 않습니다.`);
  }
  return document;
}

async function assertMigrationReady(q, types) {
  const result = await q(
    `SELECT MigrationKey FROM dbo.WebMappingMigration WHERE MigrationKey=@migrationKey`,
    { migrationKey: { type: types.NVarChar, value: MAPPING_MIGRATION_KEY } },
  );
  if (result.recordset?.length !== 1) throw new Error('공유 매칭 DB 이전이 완료되지 않았습니다.');
}

export function createMappingDbStore({ query: readQuery, withTransaction: transaction, sql: types }) {
  async function readMappingDocument(storeKey) {
    const key = checkedKey(storeKey);
    await assertMigrationReady(readQuery, types);
    const found = await readQuery(
      `SELECT Payload FROM dbo.WebMappingStore WHERE StoreKey=@storeKey`,
      { storeKey: { type: types.NVarChar, value: key } },
    );
    if (found.recordset?.length !== 1) throw new Error(`${key} 공유 매칭 문서가 없습니다.`);
    return parseDocument(found.recordset[0].Payload, key);
  }

  /** Mutator sees the latest full JSON document under a transaction lock. */
  async function mutateMappingDocument(storeKey, mutator) {
    const key = checkedKey(storeKey);
    if (typeof mutator !== 'function') throw new Error('매칭 변경 함수가 필요합니다.');
    return transaction(async tQuery => {
      await assertMigrationReady(tQuery, types);
      const found = await tQuery(
        `SELECT Payload, Revision FROM dbo.WebMappingStore WITH (UPDLOCK, HOLDLOCK)
          WHERE StoreKey=@storeKey`,
        { storeKey: { type: types.NVarChar, value: key } },
      );
      if (found.recordset?.length !== 1) throw new Error(`${key} 공유 매칭 문서가 없습니다.`);
      const current = parseDocument(found.recordset[0].Payload, key);
      const change = await mutator(current);
      if (!change || typeof change !== 'object' || !Object.hasOwn(change, 'result')) {
        throw new Error('매칭 변경 결과 형식이 올바르지 않습니다.');
      }
      if (change.changed === false) return change.result;
      if (!change.document || typeof change.document !== 'object' || Array.isArray(change.document)) {
        throw new Error('변경된 매칭 문서 형식이 올바르지 않습니다.');
      }
      const update = await tQuery(
        `UPDATE dbo.WebMappingStore
            SET Payload=@payload, Revision=Revision+1, UpdatedAt=SYSUTCDATETIME()
          WHERE StoreKey=@storeKey AND Revision=@revision`,
        {
          payload: { type: types.NVarChar(types.MAX), value: JSON.stringify(change.document) },
          storeKey: { type: types.NVarChar, value: key },
          revision: { type: types.Int, value: Number(found.recordset[0].Revision) },
        },
      );
      if (update.rowsAffected?.[0] !== 1) throw new Error('매칭 문서 수정 버전 충돌입니다.');
      return change.result;
    }, { retries: 0 });
  }
  return { readMappingDocument, mutateMappingDocument };
}

export const { readMappingDocument, mutateMappingDocument } = createMappingDbStore({ query, withTransaction, sql });
