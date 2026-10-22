// ecount 스키마 ensure. 정적 DDL 은 docs/migrations/2026-10-22_ecount_schema.sql, 동적 Raw 테이블 DDL 은 여기서 생성.
// 쓰기는 ecount 스키마에만. 식별자는 core.js 화이트리스트를 거친 것만 SQL 에 들어간다.
import fs from 'node:fs';
import path from 'node:path';
import { query, sql } from '../db.js';
import { qualifiedRaw, quoteIdent, rawTableName, assertPrgId, MAX_VALUE_LEN, ECOUNT_SCHEMA } from './core.js';

export const MIGRATION_FILE = 'docs/migrations/2026-10-22_ecount_schema.sql';

export function loadStaticDdlBatches() {
  const text = fs.readFileSync(path.join(process.cwd(), MIGRATION_FILE), 'utf8');
  return text.split(/^\s*GO\s*$/im).map((s) => s.trim()).filter(Boolean);
}

export function buildCreateRawSql(prgId, names) {
  const table = qualifiedRaw(prgId);
  const tname = rawTableName(prgId);
  const cols = names.map((n) => `${quoteIdent(n)} NVARCHAR(${MAX_VALUE_LEN}) NULL`).join(',\n    ');
  return `IF OBJECT_ID(N'${ECOUNT_SCHEMA}.${tname}', N'U') IS NULL
BEGIN
  CREATE TABLE ${table} (
    RowKey INT IDENTITY(1,1) NOT NULL CONSTRAINT [PK_${tname}] PRIMARY KEY,
    BatchKey INT NOT NULL,
    RowNo INT NOT NULL,
    RowHash CHAR(64) NOT NULL,
    IsSubtotal BIT NOT NULL CONSTRAINT [DF_${tname}_Sub] DEFAULT 0${cols ? ',\n    ' + cols : ''}
  );
  CREATE INDEX [IX_${tname}_Hash] ON ${table} (RowHash);
  CREATE INDEX [IX_${tname}_Batch] ON ${table} (BatchKey);
END`;
}

export function buildAddColumnSql(prgId, name) {
  const table = qualifiedRaw(prgId);
  return `ALTER TABLE ${table} ADD ${quoteIdent(name)} NVARCHAR(${MAX_VALUE_LEN}) NULL`;
}

let staticPromise = null;
export async function ensureEcountSchema() {
  if (staticPromise) return staticPromise;
  staticPromise = (async () => {
    for (const batch of loadStaticDdlBatches()) await query(batch);
  })().catch((err) => { staticPromise = null; throw err; });
  return staticPromise;
}

export async function getRawColumns(prgId) {
  const r = await query(
    `SELECT c.name FROM sys.columns c WHERE c.object_id = OBJECT_ID(@t) ORDER BY c.column_id`,
    { t: { type: sql.NVarChar, value: `${ECOUNT_SCHEMA}.${rawTableName(prgId)}` } },
  );
  return (r.recordset || []).map((x) => x.name);
}

// Raw 테이블 보장 + 새 헤더면 ALTER ADD. 반환: 현재 열 이름 배열
export async function ensureRawTable(prgId, names, run = query) {
  assertPrgId(prgId);
  await run(buildCreateRawSql(prgId, names));
  const have = new Set((await getRawColumns(prgId)).map((c) => c.toLowerCase()));
  const added = [];
  for (const n of names) {
    if (!have.has(n.toLowerCase())) {
      await run(buildAddColumnSql(prgId, n));
      have.add(n.toLowerCase());
      added.push(n);
    }
  }
  return { added };
}
