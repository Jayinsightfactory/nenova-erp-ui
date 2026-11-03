// 하나은행 빠른조회서비스(로그인·보안모듈 검사 없음) 거래내역 수집 → bank.Txn(Source='quick').
// 사용: node scripts/bank-quick/collect-quick.mjs <alias> --from YYYY-MM-DD --to YYYY-MM-DD [--dry-run] [--probe] [--resume]
// 자격: .env.local 의 HANA_QUICK_ACCT_<alias> · HANA_QUICK_PW_<alias> · HANA_BIZ_NO5 (값은 로그에 남기지 않음, 길이만).
// 키패드(transkey)가 입력을 막으면 KEYPAD_BLOCKED 로 중단한다(우회·캡차 처리 없음). 조회만, 이체·설정변경 없음.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv, parseArgs } from '../ecount-ledger/_env.mjs';
import * as core from '../../lib/bankQuick/core.js';
import { QUICK_URL, quickEnvKeys, readQuickCreds, splitByLimit, toYmd, parseResultHtml } from '../../lib/bankQuick/quick.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROFILE = path.join(__dirname, '_profile_quick');
const PROBE_DIR = path.join(__dirname, '_probe');
const log = (...a) => console.error(`[${new Date().toLocaleString('ko-KR')}]`, ...a);
const today = () => new Date().toISOString().slice(0, 10);

async function launch() {
  const { chromium } = await import('playwright');
  const exts = typeof core.findBankExtensions === 'function' ? core.findBankExtensions() : [];
  const extArgs = typeof core.bankExtensionArgs === 'function' ? core.bankExtensionArgs(exts) : [];
  return chromium.launchPersistentContext(PROFILE, {
    headless: false, channel: 'chrome', viewport: { width: 1400, height: 900 },
    ignoreDefaultArgs: ['--enable-automation', '--disable-extensions'],
    args: [...extArgs, '--no-first-run', '--no-default-browser-check'],
  });
}

async function probe(page) {
  fs.mkdirSync(PROBE_DIR, { recursive: true });
  const info = await page.evaluate(() => {
    const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    const d = (e) => ({ tag: e.tagName, id: e.id || null, name: e.getAttribute('name'), type: e.getAttribute('type'), cls: (e.className && e.className.toString().slice(0, 80)) || null, maxlength: e.getAttribute('maxlength'), readonly: e.readOnly || null, visible: vis(e), text: (e.innerText || e.value || '').toString().slice(0, 30) });
    const inputs = [...document.querySelectorAll('input,select,textarea')].map(d);
    const buttons = [...document.querySelectorAll('button,a.btn,input[type=button],input[type=submit],a[onclick]')].filter(vis).map(d).slice(0, 60);
    const keypad = [...document.querySelectorAll('[id*="transkey" i],[class*="transkey" i],[id*="nxkey" i],[class*="nxkey" i],[id*="keypad" i],[class*="keypad" i],[id*="mouse" i],[name*="mouse" i]')].map(d).slice(0, 60);
    const scripts = [...document.scripts].map((s) => s.src).filter((s) => /transkey|nxkey|touchen|raon|keypad/i.test(s)).map((s) => s.replace(/\?.*$/, ''));
    const checks = [...document.querySelectorAll('input[type=checkbox],input[type=radio]')].map((e) => ({ ...d(e), label: (e.labels && e.labels[0] && e.labels[0].innerText.trim().slice(0, 30)) || null }));
    return { url: location.href.replace(/\?.*$/, ''), title: document.title, frames: window.frames.length, inputs, buttons, keypad, scripts, checks };
  });
  info.frameUrls = page.frames().map((f) => f.url().replace(/\?.*$/, ''));
  fs.writeFileSync(path.join(PROBE_DIR, 'quick.json'), JSON.stringify(info, null, 2), 'utf8');
  await page.screenshot({ path: path.join(PROBE_DIR, 'quick.png'), fullPage: true });
  console.log(JSON.stringify({ probe: true, inputs: info.inputs.length, buttons: info.buttons.length, keypadNodes: info.keypad.length, scripts: info.scripts }));
}

// 비밀번호: (a) 실제 키 입력 → (b) 열린 가상키패드의 숫자 버튼 클릭 → 불가 시 KEYPAD_BLOCKED
async function fillPassword(page, pw) {
  const el = page.locator('#acctPw');
  const filled = async () => (await el.evaluate((e) => (e.value || '').length).catch(() => 0));
  await el.click({ timeout: 8000 }).catch(() => {});
  await page.keyboard.type(pw, { delay: 120 }).catch(() => {});
  if ((await filled()) >= pw.length) return 'typed';
  await el.click({ timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(800);
  for (const ch of pw) {
    const btn = page.locator(`[class*="transkey" i] :is(img[alt="${ch}"],img[title="${ch}"],[aria-label="${ch}"],[data-value="${ch}"],[data-key="${ch}"])`).filter({ visible: true }).first();
    if (!(await btn.count())) throw new Error('KEYPAD_BLOCKED: 키패드 숫자 버튼을 식별하지 못함');
    await btn.click({ timeout: 4000 });
  }
  if ((await filled()) < pw.length) throw new Error('KEYPAD_BLOCKED: 키패드 클릭 후에도 비밀번호 칸이 비어 있음');
  return 'keypad';
}

async function setMonth(page, creds, f, t) {
  await page.goto(QUICK_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#acctNo', { timeout: 20000 });
  await page.fill('#acctNo', creds.acct);
  await page.fill('#bkfgResRegNo', creds.biz).catch(async () => { await page.locator('#bkfgResRegNo').click(); await page.keyboard.type(creds.biz, { delay: 100 }); });
  await page.fill('#inqStrDt', toYmd(f));
  await page.fill('#inqEndDt', toYmd(t));
  await page.selectOption('select#listSize', { label: '60건' }).catch(() => page.selectOption('select#listSize', '60'));
  await page.selectOption('select#rcvWdrwDvCd', { label: '전체' }).catch(() => {});
  const how = await fillPassword(page, creds.pw);
  log(`비밀번호 입력 방식=${how} (길이 ${creds.pw.length})`);
  await page.locator('#searchBtn').click({ timeout: 8000 });
  await page.waitForTimeout(2500);
}

async function readAllPages(page) {
  const all = { headers: [], rows: [] };
  let lastSig = null;
  for (let p = 0; p < 100; p += 1) {
    const cur = parseResultHtml(await page.content());
    if (!all.headers.length) all.headers = cur.headers;
    const sig = JSON.stringify(cur.rows[0] || []);
    if (p > 0 && sig === lastSig) break; // 다음 클릭이 먹지 않음 = 마지막 페이지
    lastSig = sig;
    all.rows.push(...cur.rows);
    const next = page.getByText(/^\s*(다음|next)\s*$/i).filter({ visible: true }).first();
    if (!(await next.count())) break;
    await next.click({ timeout: 4000 }).catch(() => {});
    await page.waitForTimeout(1500);
  }
  return all;
}

async function main() {
  const { pos, opt } = parseArgs(process.argv.slice(2));
  const alias = pos[0];
  if (!alias) throw new Error('사용: collect-quick.mjs <alias> --from YYYY-MM-DD --to YYYY-MM-DD [--dry-run] [--probe] [--resume]');
  if (opt.probe) {
    const ctx = await launch();
    try {
      const page = ctx.pages()[0] || await ctx.newPage();
      await page.goto(QUICK_URL, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(4000);
      await probe(page);
    } finally { await ctx.close(); }
    return;
  }
  if (!core.isDate(opt.from) || !core.isDate(opt.to) || opt.from > opt.to) throw new Error('--from/--to 는 YYYY-MM-DD 이고 from<=to 여야 합니다');
  loadEnv();
  const creds = readQuickCreds(process.env, alias);
  log(`자격 확인: ${quickEnvKeys(alias).acct} 길이 ${creds.acct.length}, 비번 길이 ${creds.pw.length}, 사업자 길이 ${creds.biz.length}; 계좌 ${core.maskAccountNo(creds.acct)}`);
  const { ok, skipped, earliest } = splitByLimit(core.monthChunks(opt.from, opt.to), today());
  for (const [s, e] of skipped) log(`경고: ${s}~${e} 는 24개월 조회 한도(${earliest}) 밖 → 건너뜀`);
  let loader = null; let acct = null; let done = new Set();
  if (!opt['dry-run']) {
    loader = await import('../../lib/bankQuick/loader.js');
    acct = await loader.getAccountByAlias(alias);
    if (!acct) throw new Error(`bank.Account 에 별칭 없음: ${alias}`);
    if (opt.resume) {
      const { query, sql } = await import('../../lib/db.js');
      const r = await query("SELECT PeriodFrom, PeriodTo FROM bank.LoadBatch WHERE AccountKey=@a AND Source='quick'", { a: { type: sql.Int, value: acct.AccountKey } });
      done = new Set(r.recordset.map((x) => `${new Date(x.PeriodFrom).toISOString().slice(0, 10)}~${new Date(x.PeriodTo).toISOString().slice(0, 10)}`));
    }
  }
  const ctx = await launch();
  const summary = [];
  try {
    const page = ctx.pages()[0] || await ctx.newPage();
    for (const [f, t] of ok) {
      if (done.has(`${f}~${t}`)) { log(`${f}~${t} resume 건너뜀`); continue; }
      await setMonth(page, creds, f, t);
      const tbl = await readAllPages(page);
      const { txns, skipped: sk } = core.parseTxnTable(tbl.headers, tbl.rows);
      log(`${f}~${t}: 원행 ${tbl.rows.length}, 파싱 ${txns.length}, 건너뜀 ${sk.length}, 헤더 ${tbl.headers.join('/')}`);
      if (loader) summary.push({ f, t, ...(await loader.loadTxns({ accountKey: acct.AccountKey, txns, from: f, to: t, source: 'quick' })) });
      else summary.push({ f, t, rows: tbl.rows.length, parsed: txns.length });
    }
  } finally { await ctx.close(); }
  console.log(JSON.stringify({ dryRun: !!opt['dry-run'], months: summary }));
}

main().then(() => process.exit(0)).catch((e) => { console.error(String(e.message || e)); process.exit(1); });
