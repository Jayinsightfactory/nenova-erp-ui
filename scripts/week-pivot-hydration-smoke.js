// 차수피벗 전용 실제 브라우저 mount smoke.
// 원장/API 쓰기 없이 인증/조회 응답을 브라우저에서 가로채 SSR hydration과 mount effect만 검증한다.
const fs = require('fs');
const puppeteer = require('puppeteer-core');

const url = process.argv[2] || 'https://nenovaweb.com/shipment/week-pivot?popup=1';
const candidates = [
  process.env.CHROME_PATH,
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium-browser',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
].filter(Boolean);
const executablePath = candidates.find((path) => { try { return fs.existsSync(path); } catch { return false; } });
if (!executablePath) process.exit(2);

(async () => {
  const browser = await puppeteer.launch({ executablePath, args: ['--no-sandbox', '--disable-dev-shm-usage', '--headless=new'] });
  try {
    const page = await browser.newPage();
    const problems = [];
    page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
    page.on('console', (message) => {
      if ((message.type() === 'error' || message.type() === 'warn') && !/Failed to load resource/.test(message.text())) {
        problems.push(`${message.type()}: ${message.text()}`);
      }
    });
    await page.evaluateOnNewDocument(() => {
      localStorage.setItem('nenovaUser', JSON.stringify({ userId: 'hydration-smoke', userName: 'hydration-smoke' }));
      localStorage.setItem('wp_col_w', JSON.stringify({ 'g:cust': 57 }));
    });
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      if (new URL(request.url()).pathname.startsWith('/api/')) {
        request.respond({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true, user: { userId: 'hydration-smoke', userName: 'hydration-smoke' }, data: [], rows: [], customers: [], products: [], favorites: [] }),
        });
      } else request.continue();
    });
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const result = await page.evaluate(() => ({
      title: document.title,
      weekValues: [...document.querySelectorAll('input')].map((input) => input.value).filter((value) => /^\d{4}-\d{2}-\d{2}$/.test(value)),
      hasReact: [...document.querySelectorAll('button,input,a')].some((element) => Object.keys(element).some((key) => key.startsWith('__react'))),
    }));
    if (/Application error|client-side exception/i.test(result.title)) problems.push(`title: ${result.title}`);
    if (!result.hasReact) problems.push('React fiber missing');
    if (result.weekValues.length === 0) problems.push('mount 후 YYYY-NN-NN 차수 미표시');
    console.log(JSON.stringify({ ...result, problems }));
    if (problems.length > 0) process.exit(1);
  } finally {
    await browser.close();
  }
})().catch((error) => { console.error(error.message); process.exit(1); });
