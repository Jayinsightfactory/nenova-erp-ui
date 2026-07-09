// ECOUNT 로그인 세션 저장 — 사람이 직접 로그인 후 storageState.json 생성.
// 비밀번호를 코드에 넣지 않는다: 브라우저가 뜨면 사용자가 회사코드+ID+비번 입력.
import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATE = path.join(__dirname, 'storageState.json');

// 로그인 창에서도 조회 외 쓰기요청은 차단(읽기 전용 원칙). 로그인 자체(Login POST)는 허용.
const WRITE_URL_RE = /(save|insert|update|delete|remove|regist|create|modify|\/ins|\/upd|\/del)/i;

(async () => {
  const browser = await chromium.launch({ headless: false });
  const ctx = await browser.newContext();
  await ctx.route('**/*', route => {
    const url = route.request().url();
    if (/ecount\.com/i.test(url) && WRITE_URL_RE.test(url) && !/login/i.test(url)) {
      console.error(`🛑 쓰기성 요청 차단: ${url.slice(0, 120)}`);
      return route.abort();
    }
    return route.continue();
  });
  const page = await ctx.newPage();
  await page.goto('https://login.ecount.com/');
  console.log('브라우저에서 직접 로그인하세요. 로그인 완료 후 이 창(터미널)에서 Enter 를 누르면 세션이 저장됩니다.');
  await new Promise(resolve => process.stdin.once('data', resolve));
  await ctx.storageState({ path: STATE });
  console.log('저장 완료:', STATE);
  await browser.close();
  process.exit(0);
})();
