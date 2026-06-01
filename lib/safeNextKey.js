// lib/safeNextKey.js — MAX(Key)+1 안전 INSERT 헬퍼
// HOLDLOCK + UPDLOCK 으로 PK 충돌 방지

export async function safeNextKey(tQ, table, keyCol) {
  const r = await tQ(
    `SELECT ISNULL(MAX(${keyCol}),0)+1 AS nk FROM ${table} WITH (UPDLOCK, HOLDLOCK)`,
    {}
  );
  return r.recordset[0].nk;
}

export function isPkCollision(e) {
  return e?.number === 2627 || e?.number === 2601 || /PRIMARY KEY|duplicate key|UNIQUE/i.test(e?.message || '');
}

export async function tryInsertWithRetry(tQ, table, keyCol, buildInsert, maxRetry = 5) {
  let lastErr;
  for (let attempt = 0; attempt < maxRetry; attempt += 1) {
    const key = await safeNextKey(tQ, table, keyCol);
    try {
      await buildInsert(key);
      return key;
    } catch (e) {
      lastErr = e;
      if (isPkCollision(e)) continue;
      throw e;
    }
  }
  throw lastErr || new Error(`${table} INSERT 재시도 실패`);
}
