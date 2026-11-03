// 하나은행 기업뱅킹(HANA) 거래내역 수집 → bank.Txn 적재. 조회만(이체·설정변경·약관동의 클릭 금지). 자동 로그인·캡차·보안키패드 우회 없음.
// 사장님이 전용 프로필(_profile)에서 직접 로그인(ID+인증서/OTP)해 둔 세션을 재사용한다. 로그인 페이지로 튕기면 사람 로그인을 기다린다.
// 사용: node scripts/bank-quick/collect.mjs <alias> --account <전체계좌번호> --from YYYY-MM-DD --to YYYY-MM-DD [--dry-run] [--wait-min 10] [--table-json file]
//   --account : 드롭다운에서 같은 텍스트 항목을 클릭해 선택한다(번호는 저장·로그 안 함, 마스킹만 로그).
//   --dry-run : DB 적재 없이 날짜세팅→조회→조회기간 텍스트 변경 확인→전체엑셀다운로드→파싱 행수까지만.
//   --table-json : 브라우저 없이 {headers,rows} 파일을 파싱·적재(오프라인 검증용)
// 실측(2026-11-03, hanaMainframe 프레임): form[name=wcdep700r16iForm], input[name=sInqStrDt|sInqEndDt]='YYYY-MM-DD', 라디오 sRqstNcnt=100,
//   폼 컨테이너 안 button.btn.action-level1 '조회'(GNB 의 '조회' 메뉴와 혼동 금지), 완료 판정='조회기간 : A ~ B' 텍스트 변경,
//   그리드 div#wcdep700r16iGridDiv(셀 12개), 다음=a.grid_btn.layer, 전체엑셀다운로드=button.btn.contents-level2, 세션 '연장' 링크.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv, parseArgs } from '../ecount-ledger/_env.mjs';
import { isDate, parseTxnTable, maskAccountNo, monthChunks } from '../../lib/bankQuick/core.js';
import { parseBankXlsx } from '../../lib/bankQuick/xlsx.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROFILE = path.join(__dirname, '_profile');
const DL_DIR = path.join(PROFILE, '_dl'); // gitignored
const log = (...a) => console.error(`[${new Date().toLocaleString('ko-KR')}]`, ...a); // 계좌번호 원문은 절대 로그에 넘기지 않는다
const HANA_URL = 'https://biz.kebhana.com/';
const FRAME_NAME = 'hanaMainframe';
const FORM = 'form[name="wcdep700r16iForm"]';
const GRID_HEAD = ['', 'No', '', '거래일시', '적요', '의뢰인/수취인', '통화', '입금', '출금', '잔액', '구분', '거래점'];

const LAST = path.join(PROFILE, 'last-run.json');
function guardInterval(alias) { // 같은 계좌 5분 1회 권장
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

const mainFrame = (page) => page.frames().find((f) => f.name() === FRAME_NAME) || null;

// 사람이 로그인하고 조회 폼이 뜰 때까지 대기. 자동 로그인 없음.
async function waitForHumanSession(page, waitMin) {
  const deadline = Date.now() + waitMin * 60 * 1000;
  let warned = false;
  while (Date.now() < deadline) {
    const fr = mainFrame(page);
    if (fr && await fr.locator(FORM).count().catch(() => 0)) return fr;
    if (!warned) { log(`하나은행 기업뱅킹에서 직접 로그인하고 '거래내역 조회' 화면을 열어 주세요(최대 ${waitMin}분 대기)`); warned = true; }
    await page.waitForTimeout(3000);
  }
  throw new Error('로그인/조회 화면 대기 시간 초과(세션 만료 시 사람이 다시 로그인해야 함)');
}

// 세션 유지: 5분마다 '연장' 링크 클릭(프레임·메인 문서 모두 탐색)
function startKeepAlive(page) {
  const t = setInterval(async () => {
    for (const ctxt of [page, ...page.frames()]) {
      const l = ctxt.getByText('연장', { exact: true }).and(ctxt.locator(':visible')).first();
      if (await l.count().catch(() => 0)) { await l.click({ timeout: 3000 }).catch(() => {}); log('세션 연장 클릭'); return; }
    }
  }, 5 * 60 * 1000);
  return () => clearInterval(t);
}

// 계좌 드롭다운(input[name=acctNo])에서 같은 텍스트 항목을 클릭. 번호 원문은 로그에 남기지 않는다.
// 주의: 드롭다운 열기/항목 클릭 방식은 실화면 세부 미검증(계좌 선택 폼이 별도 GET 폼이라 선택 후 조회 폼이 다시 로드될 수 있음).
async function selectAccount(page, fr, account) {
  const input = fr.locator('input[name="acctNo"]').first();
  if (!(await input.count())) throw new Error('계좌 선택 입력(acctNo)을 찾지 못함');
  const current = await input.inputValue().catch(() => '');
  if (current && current.replace(/\D/g, '') === account.replace(/\D/g, '')) return fr;
  await input.click({ force: true });
  const item = fr.getByText(account, { exact: true }).and(fr.locator(':visible')).first();
  if (!(await item.count())) throw new Error(`드롭다운에서 계좌 ${maskAccountNo(account)} 항목을 찾지 못함`);
  await item.click({ timeout: 8000 });
  await page.waitForTimeout(2500);
  return mainFrame(page) || fr;
}

const periodText = (fr) => fr.evaluate(() => (document.body.innerText.match(/조회기간\s*:\s*\d{4}-\d{2}-\d{2}\s*~\s*\d{4}-\d{2}-\d{2}(\s*조회일시\s*:\s*[\d\-: ]{0,19})?/) || [''])[0].replace(/\s+/g, ' '));

// 날짜 세팅 → 폼 컨테이너 범위의 조회 버튼 → '조회기간' 텍스트가 요청 기간으로 바뀔 때까지 대기
async function search(fr, from, to) {
  await fr.evaluate(({ f, t }) => {
    const fire = (e) => { e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); };
    const s = document.querySelector('input[name="sInqStrDt"]'); s.value = f; fire(s);
    const e = document.querySelector('input[name="sInqEndDt"]'); e.value = t; fire(e);
    const r = document.querySelector('input[name="sRqstNcnt"][value="100"]'); if (r) { r.checked = true; r.click(); }
  }, { f: from, t: to });
  const before = await periodText(fr);
  // GNB 메가메뉴 방지: 폼을 포함하는 가장 가까운 컨테이너 범위 안에서만 '조회' 버튼을 찾는다
  const scoped = fr.locator(FORM).locator('xpath=ancestor::*[.//button[contains(@class,"action-level1")]][1]').locator('button.btn.action-level1').filter({ hasText: '조회' }).first();
  await scoped.click({ timeout: 10000 });
  const want = `${from} ~ ${to}`;
  for (let i = 0; i < 40; i += 1) {
    const now = await periodText(fr);
    if (now && now.includes(want) && now !== before) return now; // 조회일시까지 포함하므로 같은 기간 재조회도 변경 감지
    await fr.waitForTimeout(500);
  }
  throw new Error(`조회기간 텍스트가 ${want} 로 바뀌지 않음(조회 실패 또는 세션 만료)`);
}

// 1순위: 전체엑셀다운로드(download 이벤트) → xlsx 파싱(헤더 그대로)
async function downloadExcel(page, fr) {
  const btn = fr.locator('button.btn.contents-level2').filter({ hasText: /^\s*전체엑셀다운로드\s*$/ }).first();
  if (!(await btn.count())) return null;
  fs.mkdirSync(DL_DIR, { recursive: true });
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 30000 }), btn.click({ timeout: 8000 })]);
  const file = path.join(DL_DIR, `hana-${Date.now()}.xlsx`);
  await dl.saveAs(file);
  try { return parseBankXlsx(fs.readFileSync(file)); } finally { fs.unlinkSync(file); } // 계좌 데이터 잔류 방지
}

// 2순위(폴백): 그리드 DOM 페이지네이션(100건/페이지, 다음=a.grid_btn.layer)
async function readGridPages(fr) {
  const rows = [];
  for (let p = 0; p < 200; p += 1) {
    const page = await fr.evaluate(() => [...document.querySelectorAll('#wcdep700r16iGridDiv table tr')]
      .map((tr) => [...tr.querySelectorAll('td')].map((c) => c.innerText.trim())).filter((r) => r.length === 12 && /\d{4}-\d{2}-\d{2}/.test(r[3])));
    rows.push(...page);
    const next = fr.locator('a.grid_btn.layer').filter({ hasText: '다음' }).first();
    if (!(await next.count()) || (await next.getAttribute('class').catch(() => '') || '').includes('disabled')) break;
    const first = page[0]?.[3];
    await next.click({ timeout: 5000 }).catch(() => {});
    await fr.waitForTimeout(1500);
    const again = await fr.evaluate(() => (document.querySelector('#wcdep700r16iGridDiv table tr td:nth-child(4)') || {}).innerText);
    if (!again || again.trim() === first) break;
  }
  return { headers: GRID_HEAD, rows };
}

async function fetchFromHana(account, from, to, waitMin) {
  const { chromium } = await import('playwright');
  // 번들 Chromium 에서는 은행 보안 모듈이 창을 닫을 수 있어 기본 channel=chrome(BANKQ_CHANNEL 로 변경 가능)
  const ctx = await chromium.launchPersistentContext(PROFILE, { headless: false, channel: process.env.BANKQ_CHANNEL || 'chrome', viewport: { width: 1400, height: 900 }, acceptDownloads: true });
  const stop = () => {};
  let stopKeep = stop;
  try {
    const page = ctx.pages()[0] || await ctx.newPage();
    await page.goto(HANA_URL, { waitUntil: 'domcontentloaded' });
    let fr = await waitForHumanSession(page, waitMin);
    stopKeep = startKeepAlive(page);
    log(`계좌 ${maskAccountNo(account)} 선택`);
    fr = await selectAccount(page, fr, account);
    const all = { headers: [], rows: [] };
    for (const [f, t] of monthChunks(from, to)) { // 월 단위 루프
      if (!mainFrame(page) || !(await mainFrame(page).locator(FORM).count().catch(() => 0))) fr = await waitForHumanSession(page, waitMin); // 튕김 → 사람 로그인 대기
      else fr = mainFrame(page);
      const shown = await search(fr, f, t);
      log(`조회 확인: ${shown}`);
      let tbl = null;
      try { tbl = await downloadExcel(page, fr); } catch (e) { log(`엑셀 다운로드 실패, DOM 폴백: ${String(e.message).slice(0, 80)}`); }
      if (!tbl || !tbl.headers.length) tbl = await readGridPages(fr);
      log(`${f}~${t}: ${tbl.rows.length}행`);
      if (!all.headers.length) all.headers = tbl.headers;
      if (tbl.headers.join('|') === all.headers.join('|')) all.rows.push(...tbl.rows);
      else { const p = parseTxnTable(tbl.headers, tbl.rows); log(`헤더 상이 구간 ${p.txns.length}건 별도 처리 필요`); }
    }
    return all;
  } finally { stopKeep(); await ctx.close(); }
}

async function main() {
  const { pos, opt } = parseArgs(process.argv.slice(2));
  const alias = pos[0];
  if (!alias) throw new Error('사용: collect.mjs <alias> --account <번호> --from YYYY-MM-DD --to YYYY-MM-DD [--dry-run]');
  if (!isDate(opt.from) || !isDate(opt.to) || opt.from > opt.to) throw new Error('--from/--to 는 YYYY-MM-DD 이고 from<=to 여야 합니다');
  let table;
  if (opt['table-json']) table = JSON.parse(fs.readFileSync(opt['table-json'], 'utf8'));
  else {
    if (typeof opt.account !== 'string') throw new Error('--account <전체 계좌번호> 필요');
    guardInterval(alias);
    table = await fetchFromHana(opt.account, opt.from, opt.to, Number(opt['wait-min']) || 10);
    markRun(alias);
  }
  const { txns, skipped } = parseTxnTable(table.headers, table.rows);
  log(`파싱 ${txns.length}건, 건너뜀 ${skipped.length}건 (원행 ${table.rows.length})`);
  if (opt['dry-run']) { console.log(JSON.stringify({ dryRun: true, rows: table.rows.length, parsed: txns.length, skipped: skipped.length })); return; }
  loadEnv();
  const { getAccountByAlias, loadTxns } = await import('../../lib/bankQuick/loader.js');
  const acct = await getAccountByAlias(alias);
  if (!acct) throw new Error(`bank.Account 에 별칭 없음: ${alias} (먼저 계정 행 등록 필요)`);
  console.log(JSON.stringify(await loadTxns({ accountKey: acct.AccountKey, txns, from: opt.from, to: opt.to })));
}

main().then(() => process.exit(0)).catch((e) => { console.error(String(e.message || e)); process.exit(1); });
