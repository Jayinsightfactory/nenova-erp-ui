// 여신한도 순수 로직 + 계약/소스 정적 검사(DB 없음).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { creditStatus, creditPct, latestLimitByCust, validateLimitInput, signboardOf } from '../lib/mgmt/creditLimit.js';
import { MGMT_TABLES } from '../lib/mgmt/schemaMeta.js';

assert.equal(creditStatus(null, 500), 'none');
assert.equal(creditStatus(1000, 500), 'ok');
assert.equal(creditStatus(1000, 799), 'ok');
assert.equal(creditStatus(1000, 800), 'warn');
assert.equal(creditStatus(1000, 1000), 'warn');
assert.equal(creditStatus(1000, 1001), 'over');
assert.equal(creditStatus(0, 0), 'ok');
assert.equal(creditStatus(0, 1), 'over');
assert.equal(creditPct(1000, 850), 85);
assert.equal(creditPct(null, 850), null);
assert.equal(creditPct(0, 850), null);

const latest = latestLimitByCust([
  { HistoryKey: 1, CustKey: 7, LimitKRW: 100, CreatedAt: '2026-01-01T00:00:00Z' },
  { HistoryKey: 3, CustKey: 7, LimitKRW: 300, CreatedAt: '2026-03-01T00:00:00Z' },
  { HistoryKey: 2, CustKey: 7, LimitKRW: 200, CreatedAt: '2026-02-01T00:00:00Z' },
  { HistoryKey: 4, CustKey: 8, LimitKRW: 50, CreatedAt: '2026-02-01T00:00:00Z' },
]);
assert.equal(latest.get(7).LimitKRW, 300);
assert.equal(latest.get(8).LimitKRW, 50);

assert.equal(validateLimitInput({ custKey: 1, limitKRW: 1000, reason: '증액' }).limitKRW, 1000);
assert.ok(validateLimitInput({ custKey: 1, limitKRW: 1000, reason: '' }).error);
assert.ok(validateLimitInput({ custKey: 'x', limitKRW: 1000, reason: 'a' }).error);
assert.ok(validateLimitInput({ custKey: 1, limitKRW: -1, reason: 'a' }).error);
assert.ok(validateLimitInput({ custKey: 1, limitKRW: '', reason: 'a' }).error);

assert.equal(signboardOf('꽃나라/본점/메모', '(주)꽃나라'), '꽃나라');
assert.equal(signboardOf('', '(주)꽃나라'), '(주)꽃나라');

// 정적 검사: 이력 테이블 존재, 저장소는 UPDATE/DELETE 없이 INSERT 만, ar.js 미수정 원천 복제
assert.ok(MGMT_TABLES.includes('CreditLimitHistory'));
const store = fs.readFileSync(new URL('../lib/mgmt/creditLimitStore.js', import.meta.url), 'utf8');
assert.ok(!/\b(UPDATE|DELETE)\b/.test(store.replace(/\/\/.*$/gm, '')), '여신한도 이력은 추가 전용');
const rec = fs.readFileSync(new URL('../lib/mgmt/receivables.js', import.meta.url), 'utf8');
assert.ok(rec.includes('assertMgmtSqlReadOnlyOutsideSchema') && /isFix, 0\) = 1/.test(rec) && rec.includes("LedgerType = N'입금'"));

console.log('mgmt credit limit tests passed');
