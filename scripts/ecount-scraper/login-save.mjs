// ECOUNT 로그인 — 전용 크롬 프로필(persistent)에 로그인 상태를 남긴다.
// storageState(쿠키만) 방식은 ECOUNT 세션 복원이 안 돼(로그인 튕김) → 프로필 통째 재사용.
// 사람이 직접 로그인(비번 코드에 안 넣음). 세션 만료 시 이 스크립트 재실행.
import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROFILE = path.join(__dirname, 'ecount-profile');   // 로그인 상태가 남는 크롬 프로필 폴더
const WRITE_RE = /(save|insert|update|delete|remove|regist|create|modify|\/ins|\/upd|\/del)/i;

(async () => {
  const ctx = await chromium.launchPersistentContext(PROFILE, {
    headless: false,
    viewport: { width: 1500, height: 900 },
    args: ['--start-maximized'],
  });
  // 로그인 창에서도 쓰기성 요청 차단(로그인 자체는 허용)
  await ctx.route('**/*', route => {
    const u = route.request().url();
    let host = '', pathq = '';
    try { const url = new URL(u); host = url.hostname; pathq = url.pathname + url.search; } catch {}
    if (/(^|\.)ecount\.com$/i.test(host) && WRITE_RE.test(pathq) && !/login/i.test(pathq)) { console.error('🛑 쓰기성 요청 차단:', u.slice(0, 100)); return route.abort(); }
    return route.continue();
  });
  const page = ctx.pages()[0] || await ctx.newPage();
  await page.goto('https://login.ecount.com/');
  console.log('\n브라우저에서 직접 로그인하세요(회사코드+ID+비번).');
  console.log('로그인 후 메인 화면이 뜨면, 이 터미널에서 Enter 를 누르세요. 세션이 프로필에 저장됩니다.\n');
  await new Promise(r => process.stdin.once('data', r));
  // 앱 화면까지 실제로 들어갔는지 확인
  const url = page.url();
  console.log('현재 URL:', url);
  if (/login\.ecount\.com/i.test(url)) console.log('⚠ 아직 로그인 페이지입니다. 로그인 완료 후 다시 실행하세요.');
  else console.log('✅ 로그인 세션이 프로필에 저장됐습니다:', PROFILE);
  await ctx.close();
  process.exit(0);
})();
