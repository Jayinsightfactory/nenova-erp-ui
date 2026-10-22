import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildCreateRawSql, buildAddColumnSql, loadStaticDdlBatches } from '../lib/ecountLedger/schema.js';
import { buildSalesDaily, buildArBalance, buildCustomerMaster, buildProductMaster, pick } from '../lib/ecountLedger/views.js';
import { normalizeHeaders } from '../lib/ecountLedger/core.js';

const WRITE_ON_OTHER = /\b(INSERT\s+INTO|UPDATE|DELETE\s+FROM|MERGE\s+INTO|TRUNCATE\s+TABLE|ALTER\s+TABLE|DROP\s+TABLE|CREATE\s+TABLE)\s+(?!\[?ecount\]?\s*\.)(\[?dbo\]?\s*\.\s*)?\[?(?!#)\w/i;
const POST_2016 = /\b(STRING_AGG|STRING_SPLIT\s*\(.*\)\s+WITHIN|TRIM\s*\(|CONCAT_WS|TRANSLATE\s*\(|GENERATE_SERIES|APPROX_COUNT_DISTINCT|OPENJSON\s*\(.*AS\s+JSON)/i;

const migration = fs.readFileSync('docs/migrations/2026-10-22_ecount_schema.sql', 'utf8');
const names = normalizeHeaders(['일자', '거래처명', '합계', '비고]x']);
const dyn = [buildCreateRawSql('E040207', names), buildAddColumnSql('E040207', '새 열')];
const views = [
  buildSalesDaily(['일자', '거래처명', '합계']),
  buildArBalance(['거래처명', '잔액'], true),
  buildArBalance(['거래처명', '잔액'], false),
  buildCustomerMaster(['거래처코드', '거래처명']),
  buildProductMaster(['품목코드', '품목명']),
];
views.forEach((v) => assert.ok(v, '뷰 SQL 생성'));

// 1) 마이그레이션·동적 DDL 은 ecount 스키마에만 쓴다(dbo / ecount_work / web_mgmt 쓰기 없음)
for (const text of [migration, ...dyn]) {
  const stripped = text.replace(/--.*$/gm, '');
  assert.ok(!WRITE_ON_OTHER.test(stripped), `ecount 외 쓰기 의심: ${stripped.match(WRITE_ON_OTHER)?.[0]}`);
  assert.ok(!POST_2016.test(stripped), '2017+ 문법 금지');
}
for (const v of views) {
  assert.ok(/^CREATE OR ALTER VIEW ecount\.cmp_/.test(v), '뷰는 ecount 스키마 CREATE OR ALTER');
  assert.ok(!/\b(INSERT|UPDATE|DELETE|MERGE|TRUNCATE|DROP|ALTER\s+TABLE)\b/i.test(v.replace(/^CREATE OR ALTER VIEW/, '')), '뷰에 쓰기 동사 없음');
  assert.ok(!/ecount_work|web_mgmt/.test(v), '뷰는 ecount_work/web_mgmt 를 읽지 않는다');
  assert.ok(!POST_2016.test(v));
  // ShipmentDetail 에는 isDeleted 가 없다(마스터로만 필터)
  assert.ok(!/\bsd\.isDeleted\b/i.test(v));
}
{ const code = migration.replace(/--.*$/gm, ""); assert.ok(!/ecount_work|web_mgmt/.test(code)); }

// 2) 정적 배치 구성
const batches = loadStaticDdlBatches();
assert.ok(batches.length >= 5);
assert.ok(batches.every((b) => !/^GO$/im.test(b)));
for (const id of ['E040207', 'E040214', 'E040309', 'E010205', 'E040217', 'E040310', 'E040305', 'E010101', 'E040103', 'E010847', 'E010845', 'E010846', 'E010206']) {
  assert.ok(migration.includes(`N'${id}'`), `Dataset 시드 ${id}`);
}
assert.ok(/WHERE FileSha256 IS NOT NULL/.test(migration), 'FileSha256 필터 UNIQUE');

// 3) 동적 DDL 식별자 화이트리스트
assert.match(dyn[0], /\[ecount\]\.\[Raw_E040207\]/);
assert.match(dyn[0], /\[비고_x\]/);
assert.match(dyn[1], /ADD \[새 열\] NVARCHAR\(400\)/);
assert.throws(() => buildCreateRawSql('E04; DROP TABLE x', names), /PrgId/);
assert.throws(() => buildAddColumnSql('E040207', 'a\u0000b'), /식별자/);
assert.equal(pick(['일자'], ['없음']), 'CAST(NULL AS NVARCHAR(400))');
assert.match(pick(['합계', 'total'], ['합계', 'total']), /COALESCE/);

console.log('ecount ledger schema tests passed');
