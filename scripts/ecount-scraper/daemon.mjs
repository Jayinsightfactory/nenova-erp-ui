// ECOUNT 상주 수집 데몬 — 브라우저를 안 닫고 켜둔 채 주기적으로 4종 수집.
// 세션이 브라우저 인스턴스에 묶여 있어, 창을 유지하면 세션이 안 죽는다(=무인 반복 가능).
// 사람은 최초 1회(또는 만료 시)만 열린 창에서 직접 로그인. ⛔ 자동 로그인 안 함(읽기 전용).
//
// 사용: node daemon.mjs
// 환경변수: INTERVAL_MIN(기본 30) · NENOVA_URL · NENOVA_COOKIE(nenovaweb 인증쿠키) · HEADLESS=1(창 숨김; 최초 로그인 후에만 권장)
import { chromium } from 'playwright';
import fs from 'fs';
import { PROFILE, DEFS, ERP_ROOT, installGuard, ensureBooted, collectOne, postIngest, isLoginPage } from './scrape-core.mjs';

const INTERVAL = Math.max(5, Number(process.env.INTERVAL_MIN) || 30) * 60 * 1000;
const NENOVA = process.env.NENOVA_URL || 'https://nenovaweb.com';
const COOKIE = process.env.NENOVA_COOKIE || '';
const now = () => new Date().toLocaleString('ko-KR');

async function waitForLogin(page) {
  await page.goto('https://login.ecount.com/').catch(() => {});
  console.log(`\n⚠ [${now()}] ECOUNT 로그인이 필요합니다. 열린 창에서 직접 로그인하세요(등록 팝업까지).`);
  console.log('   로그인되면 자동으로 감지해 수집을 시작/재개합니다. (창은 절대 닫지 마세요)\n');
  for (;;) {
    await page.waitForTimeout(3000);
    if (!isLoginPage(page) && /logincc\.ecount\.com/i.test(page.url())) { console.log(`✅ [${now()}] 로그인 감지됨.`); return; }
  }
}

async function cycle(page, base) {
  for (const ds of Object.keys(DEFS)) {
    try {
      const data = await collectOne(page, base, ds);
      if (!data.rows.length) { console.log(`  [${ds}] 0행(파싱실패)`); continue; }
      const r = await postIngest(NENOVA, COOKIE, ds, data);
      console.log(`  [${ds}] rows=${data.rows.length} 합계=${data.screenTotal ?? '?'} → ${r.success ? `${r.status} ${r.score}점 #${r.snapshotKey}` : '전송실패:' + r.error}`);
    } catch (e) {
      if (e.message === 'LOGIN_EXPIRED') throw e; // 상위에서 재로그인 처리
      console.error(`  [${ds}] 오류:`, e.message);
    }
  }
}

(async () => {
  const headless = !!process.env.HEADLESS && fs.existsSync(PROFILE);
  const ctx = await chromium.launchPersistentContext(PROFILE, { headless, viewport: { width: 1600, height: 900 }, acceptDownloads: true, args: ['--start-maximized'] });
  await installGuard(ctx);
  const page = ctx.pages()[0] || await ctx.newPage();

  let base = await ensureBooted(page);
  if (!base) { await waitForLogin(page); base = await ensureBooted(page); }
  console.log(`\n🟢 [${now()}] ECOUNT 상주 수집 데몬 시작 — ${INTERVAL / 60000}분 주기. (창을 닫지 마세요)`);

  for (;;) {
    console.log(`\n───── [${now()}] 수집 사이클 ─────`);
    try { await cycle(page, base); }
    catch (e) {
      if (e.message === 'LOGIN_EXPIRED') {
        console.log(`\n⚠ [${now()}] 세션 만료 감지 — 재로그인 대기.`);
        await waitForLogin(page); base = await ensureBooted(page); continue;
      }
      console.error('사이클 오류:', e.message);
    }
    await new Promise(r => setTimeout(r, INTERVAL));
  }
})();
