// lib/safeNextKey.js — MAX(Key)+1 안전 INSERT 헬퍼
// HOLDLOCK + UPDLOCK 으로 PK 충돌 방지

export async function safeNextKey(tQ, table, keyCol) {
  const r = await tQ(
    `SELECT ISNULL(MAX(${keyCol}),0)+1 AS nk FROM ${table} WITH (UPDLOCK, HOLDLOCK)`,
    {}
  );
  return r.recordset[0].nk;
}
