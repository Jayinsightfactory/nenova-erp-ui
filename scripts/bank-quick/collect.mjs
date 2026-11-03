// 은행 빠른조회 수집 → bank.Txn 적재. ⛔ 조회만(이체·설정변경·약관동의 클릭 금지), 캡차·보안키패드 우회 코드 없음.
// 사용: node scripts/bank-quick/collect.mjs <alias> --from YYYY-MM-DD --to YYYY-MM-DD [--dry-run] [--table-json file]
//   --table-json : 브라우저 없이 {headers:[],rows:[[]]} 파일을 파싱·적재(오프라인 검증용)
// 은행 입력 단계(setFields)는 probe-nh 결과(보안키패드·생년월일 입력 방식) 반영 전까지 미구현이다.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv, parseArgs } from '../ecount-ledger/_env.mjs';
import { isDate, parseTxnTable, maskAccountNo } from '../../lib/bankQuick/core.js';
import { getCredential } from '../../lib/bankQuick/credentials.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROFILE = path.join(__dirname, '_profile');
const log = (...a) => console.error(`[${new Date().toLocaleString('ko-KR')}]`, ...a); // 자격증명 값은 절대 인자로 넘기지 않는다

// 같은 계좌 5분 1회 권장 → 마지막 조회 시각 파일로 간격 가드
const LAST = path.join(PROFILE, 'last-run.json');
function guardInterval(alias) {
  let j = {}; try { j = JSON.parse(fs.readFileSync(LAST, 'utf8')); } catch { /* 첫 실행 */ }
  const wait = 5 * 60 * 1000 - (Date.now() - (j[alias] || 0));
  if (wait > 0) throw new Error(`같은 계좌는 5분 간격 권장: ${Math.ceil(wait / 1000)}초 뒤 재시도`);
}
function markRun(alias) {
  fs.mkdirSync(PROFILE, { recursive: true });
  let j = {}; try { j = JSON.parse(fs.readFileSync(LAST, 'utf8')); } catch { /* 없음 */ }
  j[alias] = Date.now();
  fs.writeFileSync(LAST, JSON.stringify(j), 'utf8');
}

// TODO(probe 결과 반영 후 구현): 계좌번호(InqGjaNbr)·비밀번호(보안키패드 TransKey)·생년월일 입력.
// 키패드가 자동 입력을 막으면 '불가'로 보고하고 우회하지 않는다.
async function setFields(/* page, cred, from, to */) {
  throw new Error('setFields 미구현: probe-nh 결과 검토 후 구현(보안키패드 우회 금지)');
}

// 결과 표 → {headers, rows}. 결과 화면 구조는 setFields 구현 시점에 실측해 맞춘다.
async function readResultTable(page) {
  return page.evaluate(() => {
    const t = [...document.querySelectorAll('table')].find((x) => /거래일/.test(x.innerText) && /잔액/.test(x.innerText));
    if (!t) return { headers: [], rows: [] };
    const trs = [...t.querySelectorAll('tr')].map((tr) => [...tr.children].map((c) => c.innerText.trim()));
    return { headers: trs[0] || [], rows: trs.slice(1).filter((r) => r.length > 1) };
  });
}

async function fetchFromBank(alias, from, to) {
  const cred = getCredential(alias);
  log(`조회 시작 alias=${alias} bank=${cred.bank} acct=${maskAccountNo(cred.accountNo)} ${from}~${to}`);
  const { chromium } = await import('playwright');
  const ctx = await chromium.launchPersistentContext(PROFILE, { headless: false, channel: 'chrome', viewport: { width: 1400, height: 900 } });
  try {
    const page = ctx.pages()[0] || await ctx.newPage();
    await page.goto('https://banking.nonghyup.com/servlet/IPMSP0011I.view', { waitUntil: 'domcontentloaded' });
    await setFields(page, cred, from, to);
    return await readResultTable(page);
  } finally { await ctx.close(); }
}

async function main() {
  const { pos, opt } = parseArgs(process.argv.slice(2));
  const alias = pos[0];
  if (!alias) throw new Error('사용: collect.mjs <alias> --from YYYY-MM-DD --to YYYY-MM-DD [--dry-run]');
  if (!isDate(opt.from) || !isDate(opt.to) || opt.from > opt.to) throw new Error('--from/--to 는 YYYY-MM-DD 이고 from<=to 여야 합니다');
  let table;
  if (opt['table-json']) table = JSON.parse(fs.readFileSync(opt['table-json'], 'utf8'));
  else { guardInterval(alias); table = await fetchFromBank(alias, opt.from, opt.to); markRun(alias); }
  const { txns, skipped } = parseTxnTable(table.headers, table.rows);
  log(`파싱 ${txns.length}건, 건너뜀 ${skipped.length}건`);
  if (opt['dry-run']) { console.log(JSON.stringify({ dryRun: true, parsed: txns.length, skipped: skipped.length })); return; }
  loadEnv();
  const { getAccountByAlias } = await import('../../lib/bankQuick/loader.js');
  const { loadTxns } = await import('../../lib/bankQuick/loader.js');
  const acct = await getAccountByAlias(alias);
  if (!acct) throw new Error(`bank.Account 에 별칭 없음: ${alias} (먼저 계정 행 등록 필요)`);
  const r = await loadTxns({ accountKey: acct.AccountKey, txns, from: opt.from, to: opt.to });
  console.log(JSON.stringify(r));
}

main().then(() => process.exit(0)).catch((e) => { console.error(String(e.message || e)); process.exit(1); });
