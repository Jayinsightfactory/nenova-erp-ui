// scripts/barobill-smoke.mjs — 바로빌 테스트/운영 서버 연결 스모크 (읽기 전용)
// 사용: BAROBILL_ENV=test BAROBILL_CERTKEY=... BAROBILL_CORPNUM=... node scripts/barobill-smoke.mjs [--from 2026-10-01 --to 2026-10-21]
// 출력: 각 단계 OK/FAIL 와 요약 숫자만(계좌·카드번호는 마스킹). 쓰기 API 는 호출하지 않는다.
import { createBarobillClient, BarobillError } from '../lib/barobillApi.js';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const today = new Date();
const from = opt('--from', `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-01`);
const to = opt('--to', today.toISOString().slice(0, 10));

const client = createBarobillClient();
const cfg = client.config;
console.log(`[barobill-smoke] env=${cfg.mode} host=${cfg.host} corpNum=${cfg.corpNum} configured=${cfg.configured}${cfg.missing.length ? ' missing=' + cfg.missing.join(',') : ''}`);
if (!cfg.configured) process.exit(2);

const rows = [];
async function step(name, fn) {
  try {
    const v = await fn();
    rows.push([name, 'OK', typeof v === 'string' ? v : JSON.stringify(v).slice(0, 160)]);
    return v;
  } catch (e) {
    rows.push([name, 'FAIL', e instanceof BarobillError ? `${e.code ?? ''} ${e.message}` : e.message]);
    return undefined;
  }
}

await step('Ping', () => client.ping());
const cert = await step('CheckCERTIsValid(1=유효)', () => client.checkCert());
await step('CheckCorpIsMember(1=회원사)', () => client.checkCorpIsMember());
await step('GetBalanceCostAmountEx(선불잔액)', () => client.balance());
await step('GetCorpState(자사)', () => client.corpState(cfg.corpNum));
const accounts = await step('GetBankAccountEx2(등록 계좌)', () => client.bankAccounts());
const cards = await step('GetCardEx2(등록 카드)', () => client.cards());
await step(`GetPeriodTaxInvoiceSalesListEx(${from}~${to})`, async () => { const r = await client.taxSalesList({ from, to }); return { total: r.total, first: r.rows[0] || null }; });
if (Array.isArray(accounts) && accounts.length) {
  // 마스킹된 번호로는 조회 불가 → 원본 번호는 내부에서만 쓴다
  const raw = await client.call('BANKACCOUNT', 'GetBankAccountEx2', { CorpNum: cfg.corpNum, AvailOnly: 1 });
  const first = (Array.isArray(raw) ? raw : [raw])[0]?.BankAccountNum;
  if (first) await step(`GetPeriodBankAccountLogEx2(첫 계좌 ${from}~${to})`, async () => { const r = await client.bankLog({ accountNo: first, from, to }); return { total: r.total, first: r.rows[0] || null }; });
}
if (Array.isArray(cards) && cards.length) {
  const raw = await client.call('CARD', 'GetCardEx2', { CorpNum: cfg.corpNum, AvailOnly: 1 });
  const first = (Array.isArray(raw) ? raw : [raw])[0]?.CardNum;
  if (first) await step(`GetPeriodCardLogEx3(첫 카드 ${from}~${to})`, async () => { const r = await client.cardLog({ cardNo: first, from, to }); return { total: r.total, first: r.rows[0] || null }; });
}

for (const [n, s, d] of rows) console.log(`${s.padEnd(4)} ${n} → ${d}`);
process.exit(rows.some(([, s]) => s === 'FAIL') ? 1 : 0);
