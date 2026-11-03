import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadStaticDdlBatches } from '../lib/bankQuick/schema.js';

const migration = fs.readFileSync('docs/migrations/2026-11-03_bank_schema.sql', 'utf8');
const stripped = migration.replace(/--.*$/gm, '');
const WRITE_ON_OTHER = /\b(INSERT\s+INTO|UPDATE|DELETE\s+FROM|MERGE\s+INTO|TRUNCATE\s+TABLE|ALTER\s+TABLE|DROP\s+TABLE|CREATE\s+TABLE|CREATE\s+INDEX\s+\S+\s+ON)\s+(?!\[?bank\]?\s*\.)\[?(?!#)\w/i;
const POST_2016 = /\b(STRING_AGG|TRIM\s*\(|CONCAT_WS|TRANSLATE\s*\(|GENERATE_SERIES|CREATE\s+OR\s+ALTER)/i;

assert.ok(!WRITE_ON_OTHER.test(stripped), `bank 외 쓰기 의심: ${stripped.match(WRITE_ON_OTHER)?.[0]}`);
assert.ok(!POST_2016.test(stripped), '2017+ 문법 금지');
assert.ok(!/\b(dbo|ecount|ecount_work|web_mgmt)\./i.test(stripped), 'dbo/ecount 참조 없음');

for (const t of ['bank.Account', 'bank.LoadBatch', 'bank.Txn']) {
  assert.ok(new RegExp(`OBJECT_ID\\(N'${t.replace('.', '\\.')}'`).test(stripped), `${t} 멱등 가드`);
}
assert.ok(/UNIQUE \(AccountKey, RowHash\)/.test(stripped), 'UNIQUE(AccountKey,RowHash)');
for (const col of ['TxnDate', 'TxnTime', 'Type', 'Amount', 'Balance', 'Description', 'DisplayName', 'Counterparty', 'Branch', 'Memo', 'RawJson', 'RowHash']) {
  assert.ok(new RegExp(`\\b${col}\\b`).test(stripped), `Txn.${col}`);
}
assert.ok(/AccountNoMasked/.test(stripped) && !/AccountNo\s+NVARCHAR/i.test(stripped), '계좌번호 원문 컬럼 없음');
assert.ok(/IN \(N'deposit', N'withdrawal'\)/.test(stripped));
assert.ok(loadStaticDdlBatches().length >= 4, 'GO 배치 분리');

// 코드에 자격증명 값 출력/저장 경로가 없는지(정적 검사)
for (const f of ['lib/bankQuick/credentials.js', 'lib/bankQuick/loader.js', 'scripts/bank-quick/collect.mjs']) {
  const src = fs.readFileSync(f, 'utf8');
  assert.ok(!/console\.\w+\([^)]*(password|accountNo|bizNo)/i.test(src), `${f}: 자격증명 값 로그 금지`);
}
assert.ok(/ProtectedData/.test(fs.readFileSync('scripts/bank-quick/register-account.ps1', 'utf8')));

console.log('bankQuick schema tests passed');
