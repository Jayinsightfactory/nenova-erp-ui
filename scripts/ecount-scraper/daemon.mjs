// ECOUNT read-only daemon: weekday 08/11/14 scheduled reports, on-demand customer reads.
// 세션이 브라우저 인스턴스에 묶여 있어, 창을 유지하면 세션이 안 죽는다(=무인 반복 가능).
// 최초/만료 시 사용자가 직접 로그인. 저장된 자격증명 조회·입력·로그인 버튼 클릭·자동 재시도 금지.
//
// 사용: node daemon.mjs
// 환경변수: NENOVA_URL · NENOVA_TOKEN(권장: nenovaweb 토큰=MOYI_API_TOKEN 값) · NENOVA_COOKIE(대안: 로그인쿠키) · HEADLESS=1(창 숨김; 최초 로그인 후에만 권장)
import { chromium } from 'playwright';
import fs from 'fs';
import recovery from '../../lib/ecountCollectorRecovery.cjs';
import changes from '../../lib/ecountReadReuse.cjs';
const sourceRead=changes.serialReads();
const LEGACY_STATE=new URL('./.legacy-schedule.json',import.meta.url);
import { startCustomerLedgerSchedule } from './customer-ledger.mjs';
import { PROFILE, DEFS, installGuard, ensureBooted, collectOne, postIngest } from './scrape-core.mjs';

const POLL_MS = 15000;
const NENOVA = process.env.NENOVA_URL || 'https://nenovaweb.com';
const COOKIE = process.env.NENOVA_COOKIE || '';
const now = () => new Date().toLocaleString('ko-KR');

async function waitForLogin(page) {
  await page.goto('https://login.ecount.com/',{waitUntil:'domcontentloaded',timeout:30000}).catch(()=>{});
  console.log(`[${now()}] ECOUNT 수동 로그인이 필요합니다. 자동 로그인이나 비밀번호 재시도는 하지 않습니다.`);
  for(;;){
    await page.waitForTimeout(3000);
    if(recovery.isSourceErpUrl(page.url())){
      console.log(`[${now()}] 사용자 로그인 완료를 감지했습니다.`);
      await page.waitForTimeout(5000);
      return;
    }
  }
}

async function cycle(page, getBase, recoverSession) {
  for (const ds of Object.keys(DEFS)) {
    try {
      const data = await recovery.withSessionRecovery(()=>sourceRead(()=>collectOne(page, getBase(), ds)), recoverSession);
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
  console.log('[ecount] browser starting');
  const ctx = await chromium.launchPersistentContext(PROFILE, { timeout:180000,headless, viewport: { width: 1600, height: 900 }, acceptDownloads: true, args: ['--start-maximized'] });
  console.log('[ecount] browser ready');
  await installGuard(ctx);
  const page = ctx.pages()[0] || await ctx.newPage();

  console.log('[ecount] checking session');
  let base = await ensureBooted(page);
  const recoverSession = recovery.singleFlight(async()=>{
    await waitForLogin(page);
    const next=await ensureBooted(page);
    if(!next)throw new Error('LOGIN_EXPIRED');
    base=next;
  });
  if (!base) await recoverSession();
  // All source operations share a queue; idle ticks make no ECOUNT request.
  startCustomerLedgerSchedule(ctx, () => base, NENOVA, {recoverSession,sourceRead,onUnavailable:()=>{console.log('[ledger723] source context unavailable; restarting collector');process.exit(2);}});
  console.log(`\n🟢 [${now()}] ECOUNT 상주 수집 데몬 시작 — 평일 08/11/14시 정기 조회. (창을 닫지 마세요)`);

  let lastLegacyAttempt=null;try{lastLegacyAttempt=JSON.parse(fs.readFileSync(LEGACY_STATE,'utf8')).lastAttempt;}catch{}
  const legacyTick=changes.scheduledReadCycle({lastAttempt:lastLegacyAttempt,save:slot=>{const tmp=new URL(LEGACY_STATE.href+'.tmp');fs.writeFileSync(tmp,JSON.stringify({lastAttempt:slot}));fs.renameSync(tmp,LEGACY_STATE);}});
  for (;;) {
    try { await legacyTick(async()=>{console.log(`\n───── [${now()}] 예약 보고서 수집 ─────`);await cycle(page, () => base, recoverSession);}); }
    catch (e) {
      if (e.message === 'LOGIN_EXPIRED') {
        console.log(`\n⚠ [${now()}] 세션 만료 감지 — 재로그인 대기.`);
        await recoverSession(); continue;
      }
      console.error('사이클 오류:', e.message);
      if (/has been closed|browser.*closed|Target closed/i.test(e.message)) { console.error('브라우저가 닫혀 데몬을 종료합니다(런처가 재기동).'); process.exit(2); }
    }
    await new Promise(r => setTimeout(r, POLL_MS));
  }
})();
