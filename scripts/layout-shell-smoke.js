// 실브라우저 DOM 검사: 일반 화면 shell 1개, popup shell 1개/사이드바 0개.
const fs = require('node:fs');
const puppeteer = require('puppeteer-core');

const base = process.env.SMOKE_BASE_URL || 'https://nenovaweb.com';
const user = process.env.SMOKE_USER || 'nenovaSS3';
const password = process.env.SMOKE_PASS || '0000';
const candidates = [process.env.CHROME_PATH, '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'].filter(Boolean);
const executablePath = candidates.find((candidate) => fs.existsSync(candidate));
if (!executablePath) throw new Error('크롬 실행파일을 찾지 못했습니다. CHROME_PATH를 지정하세요.');

async function inspect(page, url, popup) {
  const messages = [];
  let expectedDriveUnavailable = false;
  const onConsole = (message) => {
    if (message.type() === 'error' || message.type() === 'warning') messages.push(`${message.type()}: ${message.text()}`);
  };
  const onResponse = (response) => {
    if (response.url().includes('/api/moyi/drive-admin') && response.status() === 503) expectedDriveUnavailable = true;
  };
  page.on('console', onConsole);
  page.on('response', onResponse);
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
  await page.waitForSelector('[data-ui-shell]', { timeout: 30000 });
  const result = await page.evaluate(() => ({
    shells: document.querySelectorAll('[data-ui-shell]').length,
    standardShells: document.querySelectorAll('[data-ui-shell="standard"]').length,
    popupShells: document.querySelectorAll('[data-ui-shell="popup"]').length,
    sidebars: document.querySelectorAll('[data-ui-sidebar]').length,
    topbars: document.querySelectorAll('[data-ui-topbar]').length,
    popupbars: document.querySelectorAll('[data-ui-popupbar]').length,
    titles: document.querySelectorAll('[data-ui-page-title]').length,
    heading: document.querySelector('[data-ui-page-title]')?.textContent || '',
    contentWidth: document.querySelector('.page-area')?.getBoundingClientRect().width || 0,
  }));
  page.off('console', onConsole);
  page.off('response', onResponse);
  if (result.shells !== 1 || result.titles !== 1) throw new Error(`${url}: shell/title count ${JSON.stringify(result)}`);
  if (!popup && (result.standardShells !== 1 || result.sidebars !== 1 || result.topbars !== 1 || result.popupbars !== 0)) throw new Error(`${url}: 일반 shell 규칙 위반 ${JSON.stringify(result)}`);
  if (popup && (result.popupShells !== 1 || result.sidebars !== 0 || result.topbars !== 0 || result.popupbars !== 1)) throw new Error(`${url}: popup shell 규칙 위반 ${JSON.stringify(result)}`);
  if (!result.heading.includes('MOYI Drive 관리')) throw new Error(`${url}: 화면 제목 누락`);
  if (!popup && result.contentWidth < 500) throw new Error(`${url}: 콘텐츠 폭이 비정상적으로 좁습니다 (${result.contentWidth}px)`);
  const unexpectedMessages = expectedDriveUnavailable
    ? messages.filter((message) => !message.includes('Failed to load resource: the server responded with a status of 503'))
    : messages;
  if (unexpectedMessages.length) throw new Error(`${url}: console error/warn\n${unexpectedMessages.join('\n')}`);
  console.log(`layout smoke OK: ${url} ${JSON.stringify(result)}`);
}

(async () => {
  const browser = await puppeteer.launch({ executablePath, args: ['--no-sandbox', '--disable-dev-shm-usage', '--headless=new'] });
  try {
    const page = await browser.newPage();
    const response = await page.goto(`${base}/login`, { waitUntil: 'networkidle2', timeout: 60000 });
    if (!response?.ok()) throw new Error(`login page status ${response?.status()}`);
    await page.evaluate(async ({ user, password }) => {
      const res = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: user, password }) });
      if (!res.ok) throw new Error(`login ${res.status}`);
      const body = await res.json();
      localStorage.setItem('nenovaUser', JSON.stringify(body.user));
    }, { user, password });
    await inspect(page, `${base}/integrations/moyi-drive`, false);
    await inspect(page, `${base}/integrations/moyi-drive?popup=1`, true);
  } finally {
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exit(1); });
