// 은행 거래내역 수집 → bank.Txn 적재. 조회만(이체·설정변경·약관동의 클릭 금지). 자동 로그인·캡차·보안키패드 우회 코드 없음.
// 1차 대상 HANA(하나은행 기업뱅킹 biz.kebhana.com): 사장님이 전용 프로필(_profile)에서 직접 로그인(ID+인증서/OTP)해 둔 세션을 재사용한다.
//   세션이 없거나 만료되면 사람이 로그인하고 '거래내역 조회' 화면까지 열 때까지 대기(자동 로그인 시도 안 함).
// 사용: node scripts/bank-quick/collect.mjs <alias> --from YYYY-MM-DD --to YYYY-MM-DD [--dry-run] [--table-json file] [--wait-min 10]
//   --table-json : 브라우저 없이 {headers:[],rows:[[]]} 파일을 파싱·적재(오프라인 검증용)
// 실측 구조(코디네이터 제공): 프레임 hanaMainframe 안 POST /inquiry/rebuild/account/wcdep700r16i_11.do,
//   폼 acctNo·sInqStrDt·sInqEndDt(YYYYMMDD)·sRcvWdrwDvCd·sRqstNcnt(15/30/50/100)·trscPtclSrchDvCd·srchStrnCtt, 결과=IBSheet 그리드.
// 주의: 아래 화면 조작(조회 버튼·IBSheet 읽기)은 로그인 후 실화면 미검증 — 첫 실행은 --dry-run 으로 확인할 것.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv, parseArgs } from '../ecount-ledger/_env.mjs';
import { isDate, parseTxnTable } from '../../lib/bankQuick/core.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROFILE = path.join(__dirname, '_profile');
const log = (...a) => console.error(`[${new Date().toLocaleString('ko-KR')}]`, ...a); // 계좌번호·인증 값은 절대 로그에 넘기지 않는다
const HANA_URL = 'https://biz.kebhana.com/';
const FRAME_NAME = 'hanaMainframe';
const INQUIRY_PATH = '/inquiry/rebuild/account/wcdep700r16i_11.do';

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

const ymd = (d) => d.replace(/-/g, '');
const inquiryFrame = (page) => page.frames().find((f) => f.name() === FRAME_NAME) || null;

// 사람이 로그인하고 거래내역 조회 폼(acctNo)이 뜰 때까지 대기. 자동 로그인 없음.
async function waitForHumanSession(page, waitMin) {
  const deadline = Date.now() + waitMin * 60 * 1000;
  let warned = false;
  while (Date.now() < deadline) {
    const fr = inquiryFrame(page);
    if (fr && await fr.locator('[name="acctNo"]').count().catch(() => 0)) return fr;
    if (!warned) { log(`하나은행 기업뱅킹에서 직접 로그인하고 '거래내역 조회' 화면을 열어 주세요(최대 ${waitMin}분 대기)`); warned = true; }
    await page.waitForTimeout(3000);
  }
  throw new Error('로그인/조회 화면 대기 시간 초과(세션 만료 시 사람이 다시 로그인해야 함)');
}

// 기간·건수만 채운다(계좌는 사람이 화면에서 선택해 둔 값 그대로 사용 → 코드가 계좌번호를 다루지 않음)
async function setFields(fr, from, to) {
  await fr.evaluate(({ f, t }) => {
    const set = (n, v) => { const e = document.querySelector(`[name="${n}"]`); if (e) { e.value = v; e.dispatchEvent(new Event('change', { bubbles: true })); } };
    set('sInqStrDt', f); set('sInqEndDt', t); set('sRqstNcnt', '100');
  }, { f: ymd(from), t: ymd(to) });
}

// 조회 버튼을 눌러 결과 IBSheet 를 읽는다. IBSheet 객체는 window 에서 GetCellValue·LastRow 보유 객체로 탐색.
async function searchAndReadGrid(fr) {
  await fr.getByText('조회', { exact: true }).and(fr.locator(':visible')).first().click({ timeout: 10000 });
  await fr.waitForTimeout(4000);
  return fr.evaluate(() => {
    const sh = Object.values(window).find((v) => v && typeof v === 'object' && typeof v.GetCellValue === 'function' && typeof v.LastRow === 'function');
    if (!sh) return { headers: [], rows: [] };
    const hr = typeof sh.HeaderRows === 'function' ? sh.HeaderRows() : 1;
    const cols = sh.LastCol() + 1;
    const headers = []; for (let c = 0; c < cols; c++) headers.push(String(sh.GetCellValue(0, c) ?? ''));
    const rows = []; for (let r = hr; r <= sh.LastRow(); r++) { const row = []; for (let c = 0; c < cols; c++) row.push(String(sh.GetCellValue(r, c) ?? '')); rows.push(row); }
    return { headers, rows };
  });
}

async function fetchFromHana(from, to, waitMin) {
  const { chromium } = await import('playwright');
  const ctx = await chromium.launchPersistentContext(PROFILE, { headless: false, channel: 'chrome', viewport: { width: 1400, height: 900 } });
  try {
    const page = ctx.pages()[0] || await ctx.newPage();
    await page.goto(HANA_URL, { waitUntil: 'domcontentloaded' });
    const fr = await waitForHumanSession(page, waitMin);
    log(`조회 ${from}~${to} (${INQUIRY_PATH})`);
    await setFields(fr, from, to);
    return await searchAndReadGrid(fr);
  } finally { await ctx.close(); }
}

async function main() {
  const { pos, opt } = parseArgs(process.argv.slice(2));
  const alias = pos[0];
  if (!alias) throw new Error('사용: collect.mjs <alias> --from YYYY-MM-DD --to YYYY-MM-DD [--dry-run]');
  if (!isDate(opt.from) || !isDate(opt.to) || opt.from > opt.to) throw new Error('--from/--to 는 YYYY-MM-DD 이고 from<=to 여야 합니다');
  let table;
  if (opt['table-json']) table = JSON.parse(fs.readFileSync(opt['table-json'], 'utf8'));
  else { guardInterval(alias); table = await fetchFromHana(opt.from, opt.to, Number(opt['wait-min']) || 10); markRun(alias); }
  const { txns, skipped } = parseTxnTable(table.headers, table.rows);
  log(`파싱 ${txns.length}건, 건너뜀 ${skipped.length}건`);
  if (opt['dry-run']) { console.log(JSON.stringify({ dryRun: true, parsed: txns.length, skipped: skipped.length })); return; }
  loadEnv();
  const { getAccountByAlias, loadTxns } = await import('../../lib/bankQuick/loader.js');
  const acct = await getAccountByAlias(alias);
  if (!acct) throw new Error(`bank.Account 에 별칭 없음: ${alias} (먼저 계정 행 등록 필요)`);
  console.log(JSON.stringify(await loadTxns({ accountKey: acct.AccountKey, txns, from: opt.from, to: opt.to })));
}

main().then(() => process.exit(0)).catch((e) => { console.error(String(e.message || e)); process.exit(1); });
