// ECOUNT 단발 수집(테스트용) — 브라우저 열어 부팅→수집→닫음.
// ※ 단발 실행은 매번 세션 부팅이 필요해 로그인 튕길 수 있음. 무인 주기수집은 daemon.mjs 사용 권장.
// 사용: node run.mjs [sales ar ap cash]  (없으면 4종)
// 환경변수: NENOVA_URL · NENOVA_COOKIE · SHOW=1(창 보이기)
import { chromium } from 'playwright';
import fs from 'fs';
import { PROFILE, DEFS, installGuard, ensureBooted, collectOne, postIngest } from './scrape-core.mjs';

const NENOVA = process.env.NENOVA_URL || 'https://nenovaweb.com';
const COOKIE = process.env.NENOVA_COOKIE || '';

(async () => {
  if (!fs.existsSync(PROFILE)) { console.error('ecount-profile 없음 — login-save.mjs 먼저.'); process.exit(1); }
  const targets = process.argv.slice(2).filter(a => DEFS[a]);
  const list = targets.length ? targets : ['sales', 'ar', 'ap', 'cash'];
  const ctx = await chromium.launchPersistentContext(PROFILE, { headless: !process.env.SHOW, viewport: { width: 1600, height: 900 }, acceptDownloads: true });
  await installGuard(ctx);
  const page = ctx.pages()[0] || await ctx.newPage();
  if (!(await ensureBooted(page))) { console.error('ECOUNT 로그인 만료 — login-save.mjs 재실행하거나 daemon.mjs 사용.'); await ctx.close(); process.exit(1); }
  for (const ds of list) {
    try {
      const data = await collectOne(page, ds);
      if (!data.rows.length) { console.log(`[${ds}] 0행 — 엑셀 파싱실패. SHOW=1 점검.`); continue; }
      const r = await postIngest(NENOVA, COOKIE, ds, data);
      console.log(`[${ds}] rows=${data.rows.length} 합계=${data.screenTotal ?? '?'} → ${r.success ? `${r.status} ${r.score}점 #${r.snapshotKey}` : '전송실패:' + r.error}`);
    } catch (e) { console.error(`[${ds}] 오류:`, e.message === 'LOGIN_EXPIRED' ? '로그인 만료(daemon.mjs 권장)' : e.message); }
  }
  await ctx.close(); process.exit(0);
})();
