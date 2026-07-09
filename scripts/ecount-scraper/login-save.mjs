// ECOUNT 로그인 세션 저장 — 사람이 직접 로그인 후 storageState.json 생성.
// 비밀번호를 코드에 넣지 않는다: 브라우저가 뜨면 사용자가 회사코드+ID+비번 입력.
import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATE = path.join(__dirname, 'storageState.json');

(async () => {
  const browser = await chromium.launch({ headless: false });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto('https://login.ecount.com/');
  console.log('브라우저에서 직접 로그인하세요. 로그인 완료 후 이 창(터미널)에서 Enter 를 누르면 세션이 저장됩니다.');
  await new Promise(resolve => process.stdin.once('data', resolve));
  await ctx.storageState({ path: STATE });
  console.log('저장 완료:', STATE);
  await browser.close();
  process.exit(0);
})();
