// 배포 후 hydration 스모크 — 화면은 그려져도 React가 시동되지 않는 "조용한 장애" 감지
// (2026-07-10 Turbopack 사고: 전 페이지 버튼 무반응인데 API 스모크는 전부 통과했음)
// 사용: node scripts/hydration-smoke.js [url]   · CHROME_PATH 환경변수로 브라우저 지정 가능
// 판정: 첫 button/input/a 에 React fiber(__reactFiber$*) 부착 여부 — 미부착이면 exit 1
const fs = require('fs');
const puppeteer = require('puppeteer-core');

const url = process.argv[2] || 'https://nenovaweb.com/login';
const candidates = [
  process.env.CHROME_PATH,
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
].filter(Boolean);
const exe = candidates.find((p) => { try { return fs.existsSync(p); } catch { return false; } });
if (!exe) { console.error('❌ 크롬 실행파일을 못 찾음 — CHROME_PATH 지정 필요'); process.exit(2); }

(async () => {
  const browser = await puppeteer.launch({ executablePath: exe, args: ['--no-sandbox', '--disable-dev-shm-usage', '--headless=new'] });
  try {
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
    await new Promise((r) => setTimeout(r, 4000)); // hydration 여유 대기
    const res = await page.evaluate(() => {
      const el = document.querySelector('button, input, a');
      return {
        fiber: el ? Object.keys(el).some((k) => k.startsWith('__react')) : false,
        buildId: (window.__NEXT_DATA__ || {}).buildId || null,
        title: document.title,
      };
    });
    console.log('hydration check:', JSON.stringify(res));
    if (!res.fiber) {
      console.error('❌ hydration 실패 — 화면은 떠도 버튼이 죽은 상태 (Turbopack 사고 유형). 배포 중단 필요');
      process.exit(1);
    }
    console.log(`✅ hydration OK — ${res.buildId}`);
  } finally {
    await browser.close();
  }
})().catch((e) => { console.error('❌ hydration 스모크 오류:', e.message); process.exit(1); });
