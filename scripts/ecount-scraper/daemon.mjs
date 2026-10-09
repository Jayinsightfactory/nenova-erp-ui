// ECOUNT 상주 수집 데몬 — 브라우저를 안 닫고 켜둔 채 주기적으로 4종 수집.
// 세션이 브라우저 인스턴스에 묶여 있어, 창을 유지하면 세션이 안 죽는다(=무인 반복 가능).
// 사람은 최초 1회(또는 만료 시)만 열린 창에서 직접 로그인. ⛔ 자동 로그인 안 함(읽기 전용).
//
// 사용: node daemon.mjs
// 환경변수: INTERVAL_MIN(기본 30) · NENOVA_URL · NENOVA_TOKEN(권장: nenovaweb 토큰=MOYI_API_TOKEN 값) · NENOVA_COOKIE(대안: 로그인쿠키) · HEADLESS=1(창 숨김; 최초 로그인 후에만 권장)
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
  let lastClick = 0;
  for (;;) {
    await page.waitForTimeout(3000);
    if (!isLoginPage(page) && /logincc\.ecount\.com/i.test(page.url())) {
      console.log(`✅ [${now()}] 로그인 감지됨. (URL: ${page.url().slice(0, 120)})`);
      await page.waitForTimeout(5000);
      // 진단: 로그인 직후 열린 모든 창(팝업 포함) URL과 화면을 남긴다
      try { const ps = page.context().pages(); console.log(`   (열린 창 ${ps.length}개: ${ps.map(p => p.url().slice(0, 100)).join(' | ')})`); for (let k = 0; k < ps.length; k++) await ps[k].screenshot({ path: `_downloads/page-${k}.png` }).catch(() => {}); } catch {}
      return;
    }
    // 2026-10-08 사장님 지시: 세션이 풀리면 로그인 버튼을 눌러 재개. 브라우저가 회사코드·ID·비밀번호를 이미 채워 둔 경우에만 누르고,
    //   스크레이퍼는 어떤 값도 입력하지 않는다(비어 있으면 사람이 로그인할 때까지 대기). 5분에 1회만 시도.
    if (Date.now() - lastClick > 5 * 60 * 1000) {
      try {
        const ok = await page.evaluate(() => ["com_code", "id", "passwd"].every(i => { const e = document.getElementById(i); return e && e.value && e.value.length > 0; }));
        if (ok) {
          lastClick = Date.now();
          console.log(`🔑 [${now()}] 저장된 로그인 정보가 채워져 있어 로그인 버튼을 누릅니다.`);
          await page.click("#save", { timeout: 3000 }).catch(() => {});
          await page.waitForTimeout(6000);
          await page.screenshot({ path: "_downloads/after-login.png" }).catch(() => {});
        }
      } catch {}
    }
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
      if (/has been closed|browser.*closed|Target closed/i.test(e.message)) throw e;
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
        try { console.log(`   (만료 시점 URL: ${page.url()})`); await page.screenshot({ path: '_downloads/expired.png' }); } catch {}
        await waitForLogin(page); base = await ensureBooted(page); continue;
      }
      console.error('사이클 오류:', e.message);
      if (/has been closed|browser.*closed|Target closed/i.test(e.message)) { console.error('브라우저가 닫혀 데몬을 종료합니다(런처가 재기동).'); process.exit(2); }
    }
    await new Promise(r => setTimeout(r, INTERVAL));
  }
})();
