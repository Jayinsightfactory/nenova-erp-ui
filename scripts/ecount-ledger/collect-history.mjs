// 이카운트 과거 전 기간 월 단위 엑셀 수집 → ecount 스키마 적재. ⛔ 이카운트는 조회·검색·엑셀 다운로드만(installGuard 적용, 자동 로그인 없음).
// 사용: node scripts/ecount-ledger/collect-history.mjs <prgId|all> [--from YYYY-MM] [--to YYYY-MM] [--dry-run] [--resume] [--probe]
//   --probe : 검색패널 input/select 를 덤프만 하고 아무것도 누르지 않는다.  --dry-run : 다운로드·파싱까지만, DB 적재 안 함.
//   --from 없으면 --to(기본 이번 달)부터 2019-01 까지 거슬러 올라가되 연속 6개월 빈 결과면 중단.
// 시작 시 상주 데몬(daemon.mjs)과 런처(ecount-daemon-start.js)가 떠 있으면 런처→데몬 순으로 종료(같은 프로필 충돌 방지), 끝나면 런처를 detached 로 재기동.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { loadEnv, parseArgs } from './_env.mjs';
import {
  DEFAULT_START_MONTH, isMonth, isMaster, monthRange, monthBounds, formatForInput, descendingMonths,
  shouldStopBackfill, historyFileName, failShotName, loadedKey, isAlreadyLoaded, isDuplicateSha, prevMonth,
} from '../../lib/ecountLedger/history.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HIST = path.join(__dirname, '_history');
const LAUNCHER = 'C:\\Users\\USER\\nenova-work-features\\ecount-daemon-start.js';
const stamp = () => new Date().toLocaleString('ko-KR');
const log = (...a) => console.error(`[${stamp()}]`, ...a);

// ───────── 데몬 종료/재시작 ─────────
function listNodeProcs() {
  const ps = "Get-CimInstance Win32_Process -Filter \"name='node.exe'\" | Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress";
  const r = spawnSync('powershell', ['-NoProfile', '-Command', ps], { encoding: 'utf8' });
  let j = []; try { j = JSON.parse(r.stdout || '[]'); } catch {}
  return (Array.isArray(j) ? j : [j]).filter((p) => p && p.CommandLine);
}
function stopDaemon() {
  const procs = listNodeProcs().filter((p) => p.ProcessId !== process.pid);
  const launcher = procs.filter((p) => /ecount-daemon-start\.js/i.test(p.CommandLine));
  const daemon = procs.filter((p) => /daemon\.mjs/i.test(p.CommandLine) && !/ecount-daemon-start/i.test(p.CommandLine));
  for (const p of launcher) { log(`데몬 런처 종료 pid=${p.ProcessId}`); spawnSync('taskkill', ['/PID', String(p.ProcessId), '/F']); }
  for (const p of daemon) { log(`데몬 종료 pid=${p.ProcessId} (브라우저 자식 포함)`); spawnSync('taskkill', ['/PID', String(p.ProcessId), '/F', '/T']); }
  // 데몬의 Chromium(ecount-profile 사용)이 살아 있으면 프로필 잠금으로 새 컨텍스트가 깨진다 → 남은 브라우저까지 종료하고 완전히 사라질 때까지 대기(최대 30초)
  const chromeQ = "Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'chrome.exe' -and $_.CommandLine -match 'ecount-profile' } | Select-Object -ExpandProperty ProcessId";
  const listChrome = () => (spawnSync('powershell', ['-NoProfile', '-Command', chromeQ], { encoding: 'utf8' }).stdout || '').split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
  let rest = listChrome();
  if (rest.length) { log(`데몬 브라우저 종료 ${rest.length}개(ecount-profile)`); for (const pid of rest) spawnSync('taskkill', ['/PID', pid, '/F']); }
  for (let i = 0; i < 15 && (rest = listChrome()).length; i++) spawnSync('powershell', ['-NoProfile', '-Command', 'Start-Sleep -Seconds 2']);
  if (rest.length) log(`⚠ ecount-profile 브라우저 ${rest.length}개가 아직 남아 있음`);
  if (launcher.length || daemon.length) spawnSync('powershell', ['-NoProfile', '-Command', 'Start-Sleep -Seconds 3']);
  return { wasRunning: !!(launcher.length || daemon.length), launcher: launcher.length, daemon: daemon.length };
}
function restartDaemon(state) {
  if (!state.wasRunning && process.env.ECOUNT_HISTORY_NO_RESTART) { log('데몬이 원래 꺼져 있었음 — 재시작 생략(ECOUNT_HISTORY_NO_RESTART)'); return; }
  if (!state.wasRunning) log('데몬이 원래 꺼져 있었음 — 상주 수집이 끊기지 않도록 런처를 띄운다');
  const child = spawn(process.execPath, [LAUNCHER], { detached: true, stdio: 'ignore', windowsHide: true });
  child.unref();
  log(`데몬 런처 재시작(detached) pid=${child.pid}`);
}

// ───────── 화면 조작(읽기 전용) ─────────
const FRAMES = (page) => [page, ...page.frames()];

function probeHashCache() {
  try { const j = JSON.parse(fs.readFileSync(path.join(HIST, '_probe', 'all.json'), 'utf8')); return Object.fromEntries(Object.entries(j).filter(([, v]) => v && v.hash).map(([k, v]) => [k, v.hash])); } catch { return {}; }
}
// 화면 제목(별 아이콘 옆)이 메뉴명과 같은지로 진입 성공을 판정한다(해시만 바뀌고 홈에 머무는 경우 방지)
async function onProgram(page, def) {
  if (!page.url().includes(`prgId=${def.prgId}`)) return false;
  if (!def.menuName) return true;
  // 왼쪽 메뉴 목록에도 메뉴명이 있으므로 body 전체가 아니라 '현재 프로그램 제목'(별 아이콘 옆 제목 요소)만 본다
  const want = def.menuName.replace(/\s+/g, '');
  for (const f of FRAMES(page)) {
    try {
      const ok = await f.evaluate((w) => {
        const vis = (e) => { const b = e.getBoundingClientRect(); return b.width > 0 && b.height > 0; };
        // 실측(probe E040217): 프로그램 제목 = div.wrapper-title span.page-name, 좌측 메뉴 활성 = li.active > a, document.title 도 프로그램명
        const norm = (t) => (t || '').replace(/\s+/g, '').replace(/^[★☆⭐]+/, '');
        if (norm(document.title).startsWith(w)) return true;
        const cands = [...document.querySelectorAll('.wrapper-title .page-name, span.page-name, li.active > a')].filter(vis);
        return cands.some((e) => norm(e.textContent) === w);
      }, want);
      if (ok) return true;
    } catch {}
  }
  return false;
}
async function navigate(page, base, def) {
  if (!def.hash) { const c = probeHashCache(); if (c[def.prgId]) def.hash = c[def.prgId]; }
  if (def.hash) {
    await page.goto(base + def.hash, { waitUntil: 'networkidle' }).catch(() => {});
    await page.waitForTimeout(2800);
    if (await onProgram(page, def)) return;
  }
  // 해시를 모르는 화면: 상단 '메뉴검색' 자동완성으로 진입(조회 전용 이동, 아무것도 저장하지 않음)
  if (!def.menuName) throw new Error(`메뉴 해시·이름 없음: ${def.prgId}`);
  // 남아 있는 알림 모달(존재하지 않는 메뉴명 등) 닫기
  for (const f of FRAMES(page)) { try { const ok = f.locator('.modal button:has-text("확인"), [role="dialog"] button:has-text("확인")'); if (await ok.count() && await ok.first().isVisible({ timeout: 300 })) await ok.first().click({ timeout: 1000 }); } catch {} }
  await page.keyboard.press('Escape').catch(() => {});
  // 메뉴 유형 추정 해시(E01=회계 I MENUTREE_000001, E04=재고 I MENUTREE_000004)로 먼저 시도
  const mt = def.prgId.startsWith('E01') ? 'MENUTREE_000001' : 'MENUTREE_000004';
  const guess = `#menuType=${mt}&prgId=${def.prgId}&depth=3`;
  await page.goto(base + guess, { waitUntil: 'networkidle' }).catch(() => {});
  await page.waitForTimeout(2800);
  if ((await onProgram(page, def)) && !(await page.locator('.modal:visible, [role="dialog"]:visible').count().catch(() => 0))) { def.hash = '#' + page.url().split('#')[1]; return; }
  for (const f of FRAMES(page)) { try { const ok = f.locator('.modal button:has-text("확인"), [role="dialog"] button:has-text("확인")'); if (await ok.count() && await ok.first().isVisible({ timeout: 300 })) await ok.first().click({ timeout: 1000 }); } catch {} }
  const box = page.locator('#inputFavMSearch').first();
  await box.click({ timeout: 5000 }); await box.fill(''); await box.type(def.menuName, { delay: 40 });
  await page.waitForTimeout(1800);
  let clicked = false;
  for (const f of FRAMES(page)) {
    const items = f.locator('ul.ui-autocomplete li, .ui-autocomplete .ui-menu-item, [role="listbox"] li').filter({ hasText: def.menuName });
    const n = await items.count().catch(() => 0);
    for (let k = 0; k < n && !clicked; k++) { // 같은 이름 메뉴(재고/회계)가 여럿이면 순서대로 눌러 prgId 가 맞는 것을 찾는다
      try {
        await items.nth(k).click({ timeout: 2000 }); await page.waitForTimeout(3000);
        if (await onProgram(page, def)) { clicked = true; break; }
        await box.click({ timeout: 3000 }); await box.fill(''); await box.type(def.menuName, { delay: 40 }); await page.waitForTimeout(1800);
      } catch {}
    }
    if (clicked) break;
  }
  if (!clicked) { await box.press('Enter'); await page.waitForTimeout(3000); }
  if (!(await onProgram(page, def))) throw new Error(`메뉴검색 진입 실패: ${def.menuName} → ${page.url().slice(-80)}`);
  def.hash = '#' + page.url().split('#')[1];
}

// 검색패널의 input/select 덤프(눌러보지 않음)
async function dumpInputs(page) {
  const out = [];
  for (const f of FRAMES(page)) {
    let rows = [];
    try {
      rows = await f.evaluate(() => [...document.querySelectorAll('input, select, textarea')].map((e) => {
        const r = e.getBoundingClientRect();
        const visible = r.width > 0 && r.height > 0;
        return { tag: e.tagName.toLowerCase(), type: e.type || '', id: e.id || '', name: e.name || '', aria: e.getAttribute('aria-label') || '', ph: e.placeholder || '', title: e.title || '', cls: String(e.className || '').slice(0, 60), value: (e.value || '').slice(0, 40), ro: !!e.readOnly, visible, x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width) };
      }));
    } catch {}
    for (const r of rows) if (r.visible) out.push({ frame: f === page.mainFrame() ? 'main' : f.url().slice(0, 60), ...r });
  }
  return out;
}

// 기간 입력란 설정. 화면 형식을 모르는 상태에서도 동작하도록 현재 value 패턴(yy/mm/dd, yyyy/mm/dd, yy/mm)에 맞춘다.
// 구현은 probe 결과를 반영해 아래 setPeriod 에서 확정.
// probe(2026-10-22, E040207) 실측 구조: [data-item-key$="_search"] 안 .wrapper-datepicker 2개(시작/종료).
//   연·월 = button[data-id=year|month] (.selectbox-label 표시, 클릭 시 레이어 목록) + 숨은 .select-direct-input, 일 = input#day.
//   값을 바꾼 뒤 라벨·일 값을 읽어 목표와 같은지 확인하고, 다르면 throw(스크린샷은 호출측).
async function openSearchPanel(page) {
  // 결과 화면에서는 검색 패널이 DOM 에 남아 있어도 숨겨져 있으므로 '보이는' 기준으로 판정한다
  // 숨은 템플릿이 먼저 잡히면 first().isVisible 이 false 가 되므로 :visible 로 센다
  const has = async () => { for (const f of FRAMES(page)) { try { if (await f.locator('.wrapper-datepicker button.btn-selectbox:visible').count()) return f; } catch {} } return null; };
  let f = await has(); if (f) return f;
  await page.keyboard.press('F3').catch(() => {}); await page.waitForTimeout(1500);
  f = await has(); if (f) return f;
  for (const fr of FRAMES(page)) { try { const b = fr.locator('button:has-text("Search(F3)"), button:has-text("검색(F3)")').first(); if (await b.count() && await b.isVisible({ timeout: 500 })) { await b.click({ timeout: 2000 }); break; } } catch {} }
  await page.waitForTimeout(1500);
  f = await has(); if (f) return f;
  for (const fr of FRAMES(page)) { try { await fr.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'F3', bubbles: true }))); } catch {} }
  await page.waitForTimeout(1500);
  return has();
}
async function pickSelectbox(page, btn, which, value2) {
  const cur = (await btn.locator('.selectbox-label').innerText().catch(() => '')).trim();
  if (cur === value2 || cur === `20${value2}`) return;
  await btn.click({ timeout: 3000 });
  await page.waitForTimeout(500);
  const cands = which === 'year' ? [value2, `20${value2}`] : [value2, String(Number(value2))];
  let done = false;
  for (const fr of FRAMES(page)) {
    for (const c of cands) {
      const opt = fr.locator(`.layer-box li, .layer-box a, .layer-box button, [class*="layer"] li, [class*="layer"] a, [class*="layer"] button, [role="option"]`).filter({ hasText: new RegExp(`^\s*${c}\s*$`) });
      try { if (await opt.count()) { await opt.first().click({ timeout: 2000 }); done = true; break; } } catch {}
    }
    if (done) break;
  }
  if (!done) { await page.keyboard.type(value2, { delay: 60 }); await page.keyboard.press('Enter').catch(() => {}); }
  await page.waitForTimeout(400);
  const after = (await btn.locator('.selectbox-label').innerText().catch(() => '')).trim();
  if (after !== value2 && after !== `20${value2}`) throw new Error(`${which} 설정 실패: 목표 ${value2}, 현재 ${after}`);
}
// 화면마다 datepicker 구조가 다르다: 판매현황은 중첩 wrapper 2개(시작/종료), 채권·현황류는 wrapper 1개 안에 연/월/일 세트가 1~2개.
// → 보이는 datepicker 영역에서 year/month 버튼과 #day 입력의 '순서'로 세트를 판정한다. 세트 2개면 월초~월말, 1개면 월말(기준일 스냅샷).
const setPeriod = async (page, ym) => {
  const [Y, M] = ym.split('-'); const y2 = Y.slice(2); const last = String(new Date(Number(Y), Number(M), 0).getDate()).padStart(2, '0');
  const frame = await openSearchPanel(page);
  if (!frame) {
    const diag = [];
    for (const f of FRAMES(page)) {
      try {
        const c = await f.evaluate(() => { const vis = (e) => { const b = e.getBoundingClientRect(); return b.width > 0 && b.height > 0; }; const all = [...document.querySelectorAll('.wrapper-datepicker')]; const yb = [...document.querySelectorAll('button[data-id="year"]')]; return { dp: all.length, dpVis: all.filter(vis).length, yr: yb.length, yrVis: yb.filter(vis).length, url: location.href.slice(0, 60) }; });
        let pw = -1; try { pw = await f.locator('.wrapper-datepicker button[data-id="year"]:visible').count(); } catch (e) { pw = 'ERR ' + e.message.slice(0, 80); }
        diag.push({ ...c, pwVisibleCount: pw });
      } catch (e) { diag.push({ err: e.message.slice(0, 80) }); }
    }
    throw new Error('검색 패널(기준일자) 못 찾음 diag=' + JSON.stringify(diag));
  }
  // 두 가지 위젯 모두 흡수: (A) 판매현황형 button[data-id=year|month] + input#day, (B) 채권/현황형 button[data-role=date.selectbox] + input.form-control[data-index]
  //   → 보이는 datepicker 안의 selectbox 버튼을 문서 순서로 (연,월) 쌍으로, 일 입력은 숨은 직접입력칸을 뺀 텍스트 input 순서로 짝짓는다.
  const btns = frame.locator('.wrapper-datepicker button.btn-selectbox:visible');
  const days = frame.locator('.wrapper-datepicker input.form-control:not(.select-direct-input):not(.hidden):visible');
  const n = Math.min(Math.floor(await btns.count() / 2), await days.count());
  if (n < 1) throw new Error(`기준일자 입력란 없음(selectbox ${await btns.count()}, day ${await days.count()})`);
  const sets = n >= 2 ? [['01', 0], [last, 1]] : [[last, 0]];
  for (const [dd, k] of sets) {
    await pickSelectbox(page, btns.nth(2 * k), 'year', y2); await pickSelectbox(page, btns.nth(2 * k + 1), 'month', M);
    await days.nth(k).fill(dd); await days.nth(k).press('Tab');
  }
  await page.waitForTimeout(400);
  const got = []; for (const [, k] of sets) got.push(await days.nth(k).inputValue());
  const want = sets.map(([dd]) => dd);
  if (got.join() !== want.join()) throw new Error(`일 설정 실패: ${got.join('~')} (목표 ${want.join('~')})`);
  log(`기간 설정 ${n >= 2 ? `${y2}/${M}/01 ~ ` : '기준일 '}${y2}/${M}/${last}`);
};

// 결과 0행 화면 판정(엑셀 다운로드가 시작되지 않는 빈 조회)
async function looksEmpty(page) {
  for (const f of FRAMES(page)) {
    try { const t = await f.locator('body').innerText({ timeout: 1500 }); if (/조회된\s*데이터가\s*없|데이터가\s*없습니다|No\s*data/i.test(t)) return true; } catch {}
  }
  return false;
}

async function clickExcel(page) {
  for (const f of FRAMES(page)) {
    for (const loc of [f.getByRole?.('button', { name: /^Excel$/i }), f.locator?.('button:has-text("Excel")'), f.locator?.('a:has-text("Excel")'), f.locator?.('text=Excel')]) {
      try { if (loc && await loc.first().isVisible({ timeout: 700 })) { await loc.first().click({ timeout: 1500 }); return true; } } catch {}
    }
  }
  return false;
}

async function downloadMonth(page, base, def, ym, file, ctxInfo) {
  await navigate(page, base, def);
  if (/login\.ecount\.com/i.test(page.url())) throw new Error('LOGIN_EXPIRED');
  if (def.prgId === 'E010205') { // 입/출금계좌 조회: 기본 탭이 '미반영'(회계 미반영 행만) → '전체' 로 전환해야 그 달 전체 거래가 나온다
    for (const f of FRAMES(page)) { try { const b = f.locator('button:has-text("전체"), a:has-text("전체")').filter({ hasNotText: /거래처|내.외자/ }).first(); if (await b.count() && await b.isVisible({ timeout: 500 })) { await b.click({ timeout: 2000 }); await page.waitForTimeout(800); break; } } catch {} }
  }
  if (!isMaster(def.prgId)) await setPeriod(page, ym, ctxInfo);
  await page.keyboard.press('F8').catch(() => {});
  await page.waitForTimeout(3000);
  const dlP = page.waitForEvent('download', { timeout: 60000 }).catch(() => null);
  let clicked = false;
  for (let attempt = 0; attempt < 4 && !clicked; attempt++) { // scrape-core.collectOne 과 같은 재시도(그리드 지연·공지 팝업)
    if (attempt) await page.waitForTimeout(8000);
    clicked = await clickExcel(page);
  }
  if (!clicked) throw new Error('Excel 버튼 못 찾음');
  const dl = await dlP;
  if (!dl) throw new Error('Excel 다운로드 미시작');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  await dl.saveAs(file);
  if (!isMaster(def.prgId)) {
    // 안전장치: 엑셀 제목행의 기간("2026/09/01 ~ 2026/10/22")이 목표 월과 다르면 기간 설정이 먹지 않은 것 → 적재 금지
    try {
      const X = (await import('xlsx')).default;
      const wb = X.read(fs.readFileSync(file), { type: 'buffer' });
      const aoa = X.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: false, defval: '' });
      const head = aoa.slice(0, 5).map((r) => r.join(' ')).join(' ');
      const m = head.match(/(\d{4})\/(\d{2})\/(\d{2})\s*~\s*(\d{4})\/(\d{2})\/(\d{2})/);
      if (m) {
        const [Y, M] = ym.split('-'); const last = String(new Date(Number(Y), Number(M), 0).getDate()).padStart(2, '0');
        const got = `${m[1]}/${m[2]}/${m[3]}~${m[4]}/${m[5]}/${m[6]}`; const want = `${Y}/${M}/01~${Y}/${M}/${last}`;
        if (got !== want) throw new Error(`PERIOD_MISMATCH 엑셀 기간 ${got} ≠ 목표 ${want}`);
      }
    } catch (e) { if (/PERIOD_MISMATCH/.test(e.message)) throw e; }
  }
}


// ───────── 메인 ─────────
async function main() {
  loadEnv();
  const { pos, opt } = parseArgs(process.argv.slice(2));
  const target = pos[0];
  if (!target) { console.error('사용: collect-history.mjs <prgId|all> [--from YYYY-MM] [--to YYYY-MM] [--dry-run] [--resume] [--probe]'); process.exit(2); }
  const thisMonth = new Date().toISOString().slice(0, 7);
  const to = opt.to || thisMonth;
  if (opt.from !== undefined && !isMonth(opt.from)) { console.error('--from 은 YYYY-MM'); process.exit(2); }
  if (!isMonth(to)) { console.error('--to 는 YYYY-MM'); process.exit(2); }

  const { chromium } = await import('playwright');
  const core = await import('../ecount-scraper/scrape-core.mjs');
  const { DEFS, installGuard, ensureBooted, isLoginPage } = core;
  // 프로필은 데몬이 쓰는 원본 폴더의 것을 공유해야 저장된 회사코드·ID 로 자동 로그인된다(worktree 의 새 프로필은 비어 있음).
  // 2026-10-22 사장님 결정: 데몬 프로필(ecount-scraper/ecount-profile)과 분리한 수집기 전용 프로필을 쓴다.
  //   같은 프로필을 공유하면 데몬 세션이 끊기고 로그인 창이 반복 노출됐다. 전용 프로필은 최초 1회만 사람이 로그인한다.
  //   이카운트는 계정당 동시 세션이 1개라 수집 중에는 데몬을 멈추고(프로필은 건드리지 않음) 끝나면 다시 띄운다.
  const OWN_PROFILE = 'C:/Users/USER/nenova-erp-ui/scripts/ecount-ledger/_profile';
  const PROFILE = process.env.ECOUNT_PROFILE || OWN_PROFILE;
  fs.mkdirSync(PROFILE, { recursive: true });
  log(`브라우저 프로필: ${PROFILE}`);
  const defByPrg = Object.fromEntries(Object.values(DEFS).map((d) => [d.prgId, d]));

  const state = stopDaemon();
  log(`데몬 상태: 종료 ${state.wasRunning ? `함(런처 ${state.launcher}, 데몬 ${state.daemon})` : '대상 없음'}`);
  let ctx;
  const cleanup = async () => { try { await ctx?.close(); } catch {} restartDaemon(state); };
  process.on('SIGINT', async () => { await cleanup(); process.exit(130); });
  try {
    ctx = await chromium.launchPersistentContext(PROFILE, { headless: false, viewport: { width: 1600, height: 900 }, acceptDownloads: true, args: ['--start-maximized'] });
    await installGuard(ctx);
    const page = ctx.pages()[0] || await ctx.newPage();
    let base = await ensureBooted(page);
    if (!base) { // 자동 로그인 금지: 사람이 열린 창에서 로그인할 때까지 대기(최대 15분)
      log('⚠ 로그인 필요 — 열린 수집기 창에서 회사코드·ID·비밀번호로 직접 로그인하세요(저장 체크 권장, 최대 30분 대기).');
      await page.goto('https://login.ecount.com/').catch(() => {});
      let lastClick = 0;
      for (let i = 0; i < 600 && !base; i++) { // 전용 프로필 최초 로그인: 최대 30분 대기
        await page.waitForTimeout(3000);
        if (!isLoginPage(page) && /logincc\.ecount\.com/i.test(page.url())) { await page.waitForTimeout(5000); base = await ensureBooted(page); continue; }
        // 데몬(daemon.mjs)과 동일: 브라우저가 회사코드·ID·비밀번호를 이미 채워 둔 경우에만 로그인 버튼을 누른다(값 입력은 하지 않음). 5분 1회.
        if (Date.now() - lastClick > 5 * 60 * 1000) {
          try {
            const st = await page.evaluate(() => ['com_code', 'id', 'passwd'].map((k) => { const e = document.getElementById(k); return e ? (e.value ? e.value.length : 0) : -1; }));
            if (i % 10 === 0) { log(`로그인 대기 ${i * 3}s url=${page.url().slice(0, 60)} 필드[회사,ID,PW]=${JSON.stringify(st)}`); await page.screenshot({ path: path.join(HIST, '_probe', 'login-wait.png') }).catch(() => {}); }
            const ok = st.every((n) => n > 0);
            if (ok) { lastClick = Date.now(); log('🔑 저장된 로그인 정보가 채워져 있어 로그인 버튼을 누릅니다.'); await page.click('#save', { timeout: 3000 }).catch(() => {}); await page.waitForTimeout(6000); }
          } catch {}
        }
      }
      if (!base) throw new Error('로그인 대기 시간 초과');
    }
    log('이카운트 세션 확인');

    if (opt.probe) {
      const { query: q0 } = await import('../../lib/db.js');
      const dsAll = (await q0(`SELECT PrgId, MenuName FROM ecount.Dataset WHERE IsActive = 1 ORDER BY PrgId`)).recordset;
      const want = opt.probe === true ? target : opt.probe;
      const list = want === 'all' ? dsAll.map((d) => d.PrgId) : [want];
      const nameOf = Object.fromEntries(dsAll.map((d) => [d.PrgId, d.MenuName]));
      const shotDir = path.join(HIST, '_probe'); fs.mkdirSync(shotDir, { recursive: true });
      const all = {};
      for (const prg of list) {
        const def = defByPrg[prg] ? { ...defByPrg[prg], menuName: nameOf[prg] } : { prgId: prg, hash: '', menuName: nameOf[prg] };
        try {
          let navErr = ''; try { await navigate(page, base, def); } catch (e) { navErr = e.message; } // probe 는 진입 판정 실패해도 화면을 덤프한다
          await openSearchPanel(page).catch(() => null);
          if (navErr) log(`  (진입 판정 실패지만 계속 덤프: ${navErr.slice(0, 80)})`);
          await page.waitForTimeout(800);
          const info = { hash: def.hash, url: page.url().slice(0, 160), docTitle: await page.title().catch(() => '') };
          for (const f of FRAMES(page)) { try { const tc = await f.evaluate((w) => { const vis = (e) => { const b = e.getBoundingClientRect(); return b.width > 0 && b.height > 0; }; return [...document.querySelectorAll('*')].filter((e) => e.children.length === 0 && vis(e) && (e.textContent || '').replace(/\s+/g, '') === w).map((e) => { const r = e.getBoundingClientRect(); let path = []; let x = e; for (let i = 0; i < 4 && x; i++) { path.push(x.tagName.toLowerCase() + (x.className ? '.' + String(x.className).trim().split(/\s+/).slice(0, 2).join('.') : '')); x = x.parentElement; } return { x: Math.round(r.x), y: Math.round(r.y), path: path.join(' < ') }; }); }, (nameOf[prg] || '').replace(/\s+/g, '')); if (tc.length) { info.titleCands = tc; break; } } catch {} }
          for (const f of FRAMES(page)) {
            try {
              const r = await f.evaluate(() => {
                const vis = (e) => { const b = e.getBoundingClientRect(); return b.width > 0 && b.height > 0; };
                const pickers = [...document.querySelectorAll('.wrapper-datepicker')].filter((e) => vis(e) && !e.querySelector('.wrapper-datepicker'));
                const rows = [...new Set(pickers.map((e) => { let r = e; for (let i = 0; i < 8 && r && r.tagName !== 'LI'; i++) r = r.parentElement; return r || e; }))];
                const btns = [...document.querySelectorAll('button, a.btn')].filter(vis).map((b) => (b.textContent || '').trim()).filter((t) => t && t.length < 20);
                return { pickers: pickers.length, dpHtml: pickers.map((e) => e.outerHTML.slice(0, 5000)), rows: rows.map((r) => ({ title: (r.querySelector('.title') || {}).textContent?.trim() || '', html: r.outerHTML.slice(0, 2500) })), buttons: [...new Set(btns)].slice(0, 60) };
              });
              if (r.pickers || r.buttons.length) { Object.assign(info, r); break; }
            } catch {}
          }
          if (!info.pickers) {
            for (const f of FRAMES(page)) { try { const b = f.locator('button:has-text("Search(F3)")').first(); if (await b.count() && await b.isVisible({ timeout: 500 })) { await b.click({ timeout: 2000 }); break; } } catch {} }
            await page.waitForTimeout(1500);
            const inputs = (await dumpInputs(page)).filter((r) => r.visible && (/\d{2,4}\/\d{2}/.test(String(r.value || '')) || /date|dt|일자|기간/i.test(`${r.id} ${r.name} ${r.cls} ${r.ph}`)));
            info.f3Inputs = inputs;
            for (const f of FRAMES(page)) { try { const h = await f.evaluate(() => { const el = [...document.querySelectorAll('input')].find((e) => /\d{2,4}\/\d{2}/.test(e.value || '')); if (!el) return ''; let r = el; for (let i = 0; i < 6 && r && !/^(LI|TR)$/.test(r.tagName); i++) r = r.parentElement; return (r || el).outerHTML.slice(0, 2500); }); if (h) { info.f3Html = h; break; } } catch {} }
          }
          all[prg] = info;
          await page.screenshot({ path: path.join(shotDir, `${prg}.png`) }).catch(() => {});
          log(`probe ${prg} ${nameOf[prg]}: pickers=${info.pickers ?? 0} rows=${(info.rows || []).map((x) => x.title).join('|')} excel=${(info.buttons || []).filter((b) => /excel|엑셀/i.test(b)).join('/')}`);
        } catch (e) { all[prg] = { error: e.message }; log(`probe ${prg} 실패: ${e.message}`); await page.screenshot({ path: path.join(shotDir, `${prg}-fail.png`) }).catch(() => {}); }
      }
      fs.writeFileSync(path.join(shotDir, 'all.json'), JSON.stringify(all, null, 1));
      log(`probe 저장: ${path.join(shotDir, 'all.json')}`);
      return;
    }
    if (false) {
      const prg = opt.probe === true ? target : opt.probe;
      const def = defByPrg[prg] || { prgId: prg, hash: `#menuType=MENUTREE_000004&prgId=${prg}&depth=4` };
      await navigate(page, base, def);
      // 검색 패널(F3) 열기: 이관 크롤러(scripts/ecount-dom-crawl.cjs)와 같은 방식 — F3 keydown, 없으면 aria-controls 버튼 클릭
      const panelOpen = async () => { for (const f of [page, ...page.frames()]) { try { if (await f.locator('#ecount-source-search').count()) return true; } catch {} } return false; };
      await page.keyboard.press('F3').catch(() => {}); await page.waitForTimeout(1200);
      if (!(await panelOpen())) { for (const f of [page, ...page.frames()]) { try { await f.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'F3', bubbles: true }))); } catch {} } await page.waitForTimeout(1200); }
      if (!(await panelOpen())) { for (const f of [page, ...page.frames()]) { try { const b = f.locator('[aria-controls="ecount-source-search"]'); if (await b.count()) { await b.first().click({ timeout: 1500 }); break; } } catch {} } await page.waitForTimeout(1500); }
      log(`검색 패널 열림: ${await panelOpen()}`);
      const rows = await dumpInputs(page);
      // 기준일자 행의 DOM 구조(연/월 드롭다운 위젯) 덤프 — 값 입력은 하지 않는다
      let dateRowHtml = '';
      for (const f of [page, ...page.frames()]) {
        try {
          const h = await f.evaluate(() => {
            const el = [...document.querySelectorAll('th, td, label, span, div')].find((e) => e.children.length === 0 && /^\s*기준일자\s*$/.test(e.textContent || ''));
            if (!el) return '';
            let row = el; for (let i = 0; i < 6 && row && !(row.querySelector && row.querySelector('#day')); i++) row = row.parentElement;
            return row ? row.outerHTML.slice(0, 6000) : el.parentElement.outerHTML.slice(0, 3000);
          });
          if (h) { dateRowHtml = h; break; }
        } catch {}
      }
      const shot = path.join(HIST, '_probe'); fs.mkdirSync(shot, { recursive: true });
      fs.writeFileSync(path.join(shot, `${prg}.date-row.html`), dateRowHtml);
      log(`기준일자 행 HTML ${dateRowHtml.length}자 저장`);
      fs.writeFileSync(path.join(shot, `${prg}.json`), JSON.stringify({ url: page.url().slice(0, 140), panelOpen: await panelOpen(), inputs: rows }, null, 1));
      const dateLike = rows.filter((r) => /\d{2}\/\d{2}/.test(String(r.value || '')) || /date|일자|기간|dt/i.test(`${r.id} ${r.name} ${r.aria} ${r.ph} ${r.title} ${r.cls}`));
      console.log(JSON.stringify({ url: page.url().slice(0, 140), total: rows.length, dateLike }, null, 1));
      await page.screenshot({ path: path.join(shot, `${prg}.png`) }).catch(() => {});
      return;
    }

    // ───── 수집 ─────
    const { query, getPool, sql } = await import('../../lib/db.js');
    const { parseEcountXlsx } = await import('../../lib/ecountLedger/xlsx.js');
    const { loadRows } = await import('../../lib/ecountLedger/loader.js');
    const ds = (await query(`SELECT PrgId, MenuName FROM ecount.Dataset WHERE IsActive = 1 ORDER BY PrgId`)).recordset;
    const menuOf = Object.fromEntries(ds.map((d) => [d.PrgId, d.MenuName]));
    const targets = target === 'all' ? ds.map((d) => d.PrgId) : [target];
    for (const t of targets) if (!menuOf[t]) throw new Error(`ecount.Dataset 에 없는 prgId: ${t}`);

    // 이미 적재된 history 배치(재실행 중복 방지): 월 키 + 파일 SHA
    const lb = (await query(`SELECT PrgId, PeriodFrom, FileSha256 FROM ecount.LoadBatch WHERE Source = N'history'`)).recordset;
    const loaded = new Set(lb.map((b) => loadedKey(b.PrgId, b.PeriodFrom ? b.PeriodFrom.toISOString().slice(0, 7) : 'master')));
    const shas = new Set(lb.map((b) => (b.FileSha256 || '').trim()).filter(Boolean));

    const summary = [];
    const failDir = path.join(HIST, '_fail'); fs.mkdirSync(failDir, { recursive: true });
    for (const prgId of targets) {
      const def = defByPrg[prgId] ? { ...defByPrg[prgId], menuName: menuOf[prgId] } : { prgId, hash: '', menuName: menuOf[prgId] };
      const master = isMaster(prgId);
      const months = master ? ['master'] : (opt.from ? monthRange(opt.from, to) : descendingMonths(to, DEFAULT_START_MONTH));
      const open = !opt.from && !master; // 거슬러 올라가기 모드: 빈 달 연속이면 중단
      let emptyStreak = 0;
      const agg = { prgId, months: 0, rows: 0, ins: 0, dup: 0, empty: 0, fail: 0, skipped: 0, total: 0 };
      for (const ym of months) {
        if (open && shouldStopBackfill(emptyStreak)) { log(`${prgId} 연속 ${emptyStreak}개월 빈 결과 — ${ym} 이전 중단`); break; }
        if (opt.resume && isAlreadyLoaded(prgId, ym, loaded)) { agg.skipped += 1; console.log(`${prgId} ${ym} (이미 적재 — resume 건너뜀)`); continue; }
        const file = path.join(HIST, prgId, master ? 'master.xlsx' : historyFileName(ym));
        try {
          let gotFile = true;
          try { await downloadMonth(page, base, def, ym, file, {}); }
          catch (e) {
            if (e.message === 'LOGIN_EXPIRED') throw e;
            if (/다운로드 미시작/.test(e.message) && await looksEmpty(page)) gotFile = false; else throw e;
          }
          let parsed = { headers: [], rows: [], screenTotal: null, sha256: null };
          if (gotFile) parsed = parseEcountXlsx(fs.readFileSync(file));
          const nRows = parsed.rows.length;
          const b = master ? { from: null, to: null } : monthBounds(ym);
          if (nRows === 0) {
            agg.empty += 1; emptyStreak += 1; agg.months += 1;
            if (!opt['dry-run'] && !loaded.has(loadedKey(prgId, ym))) {
              await loadRows({ prgId, headers: parsed.headers.length ? parsed.headers : [], rows: [], batchMeta: { menuName: menuOf[prgId], source: 'history', fileName: gotFile ? path.basename(file) : null, fileSha256: null, periodFrom: b.from, periodTo: b.to, screenTotal: 0, loadedBy: process.env.USERNAME || 'cli', note: 'empty month' } });
              loaded.add(loadedKey(prgId, ym));
            }
            console.log(`${prgId} ${ym} 행수 0 합계 0 삽입 0 중복 0 (빈 달 기록)`);
            continue;
          }
          emptyStreak = 0;
          if (isDuplicateSha(parsed.sha256, shas)) { agg.skipped += 1; console.log(`${prgId} ${ym} 행수 ${nRows} (같은 파일 SHA 이미 적재 — 건너뜀)`); continue; }
          if (opt['dry-run']) { agg.months += 1; agg.rows += nRows; console.log(`${prgId} ${ym} 행수 ${nRows} 합계 ${parsed.screenTotal ?? '?'} 삽입 - 중복 - (dry-run)`); continue; }
          const r = await loadRows({ prgId, headers: parsed.headers, rows: parsed.rows, batchMeta: { menuName: menuOf[prgId], source: 'history', fileName: path.basename(file), fileSha256: parsed.sha256, periodFrom: b.from, periodTo: b.to, screenTotal: parsed.screenTotal, loadedBy: process.env.USERNAME || 'cli' } });
          shas.add(parsed.sha256); loaded.add(loadedKey(prgId, ym));
          agg.months += 1; agg.rows += r.rowCnt; agg.ins += r.inserted; agg.dup += r.dedup; agg.total += parsed.screenTotal || 0;
          console.log(`${prgId} ${ym} 행수 ${r.rowCnt} 합계 ${parsed.screenTotal ?? '?'} 삽입 ${r.inserted} 중복 ${r.dedup} (배치 #${r.batchKey})`);
        } catch (e) {
          if (e.message === 'LOGIN_EXPIRED') throw e;
          agg.fail += 1;
          const shot = path.join(failDir, failShotName(prgId, ym));
          await page.screenshot({ path: shot }).catch(() => {});
          console.log(`${prgId} ${ym} 실패: ${e.message} (스크린샷 ${shot})`);
        }
      }
      summary.push(agg);
    }
    console.log('===== 요약 =====');
    console.log('prgId     월수  행수  삽입  중복  빈달  건너뜀  실패  화면합계');
    for (const a of summary) console.log(`${a.prgId}  ${a.months}  ${a.rows}  ${a.ins}  ${a.dup}  ${a.empty}  ${a.skipped}  ${a.fail}  ${a.total}`);
    try { (await getPool()).close(); } catch {}
    void sql;
  } finally {
    await cleanup();
  }
}
main().catch((e) => { console.error('실패:', e.message); process.exitCode = 1; });
