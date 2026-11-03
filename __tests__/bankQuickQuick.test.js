import assert from 'node:assert/strict';
import { quickEnvKeys, readQuickCreds, earliestAllowed, splitByLimit, toYmd, parseResultHtml } from '../lib/bankQuick/quick.js';
import { monthChunks, parseTxnTable } from '../lib/bankQuick/core.js';

assert.deepEqual(quickEnvKeys('54104'), { acct: 'HANA_QUICK_ACCT_54104', pw: 'HANA_QUICK_PW_54104', biz: 'HANA_BIZ_NO5' });
assert.equal(quickEnvKeys('a-b').acct, 'HANA_QUICK_ACCT_a_b');

const env = { HANA_QUICK_ACCT_1: '12345678901234', HANA_QUICK_PW_1: '1234', HANA_BIZ_NO5: '12345' };
assert.deepEqual(readQuickCreds(env, '1'), { acct: '12345678901234', pw: '1234', biz: '12345' });
try { readQuickCreds({ ...env, HANA_QUICK_PW_1: '99999' }, '1'); assert.fail('x'); } catch (e) { assert.ok(!e.message.includes('99999')); assert.match(e.message, /HANA_QUICK_PW_1/); }
try { readQuickCreds({ ...env, HANA_QUICK_ACCT_1: '123' }, '1'); assert.fail('x'); } catch (e) { assert.ok(!e.message.includes('=123')); }

assert.equal(earliestAllowed('2026-11-03'), '2024-11-03');
assert.equal(earliestAllowed('2026-01-15'), '2024-01-15');
const ch = monthChunks('2024-09-10', '2024-12-31');
const r = splitByLimit(ch, '2026-11-03');
assert.deepEqual(r.skipped.map((c) => c[0]), ['2024-09-10', '2024-10-01']);
assert.deepEqual(r.ok[0], ['2024-11-03', '2024-11-30']);
assert.equal(r.ok.length, 2);
assert.equal(toYmd('2026-11-03'), '20261103');

const html = `<table><tr><td>x</td></tr></table>
<table><thead><tr><th>거래일시</th><th>적요</th><th>입금</th><th>출금</th><th>잔액</th><th>거래점</th></tr></thead>
<tbody><tr><td>2026.11.02 10:11:12</td><td>타행이체</td><td>1,000,000</td><td>0</td><td>5,000,000</td><td>본점</td></tr>
<tr><td>2026.11.03</td><td>&nbsp;</td><td>0</td><td>20,000</td><td>4,980,000</td><td>본점</td></tr></tbody></table>`;
const p = parseResultHtml(html);
assert.equal(p.headers.length, 6);
assert.equal(p.rows.length, 2);
const t = parseTxnTable(p.headers, p.rows);
assert.equal(t.txns.length, 2);
assert.equal(t.txns[0].type, 'deposit');
assert.equal(t.txns[1].type, 'withdrawal');
console.log('bankQuickQuick OK');
