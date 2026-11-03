// 농협 인터넷뱅킹 '빠른조회' 입력 화면 구조 probe. 값 입력·조회 클릭 금지(읽기만). 산출물: _probe/nh.json, nh.png (git 제외)
// 근거 URL(웹 검색 결과로 확인된 농협 공개 진입점): https://banking.nonghyup.com/nhbank.html (개인 인터넷뱅킹 메인, 로그인 전 '빠른조회' 메뉴 링크)
//   보조 후보: https://banking.nonghyup.com/servlet/IPCNPA000I.view , https://banking.nonghyup.com/servlet/IPAIP0011R.view (검색 노출 URL, 용도 미확정)
// 사용: node scripts/bank-quick/probe-nh.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROFILE = path.join(__dirname, '_profile');
const OUT = path.join(__dirname, '_probe');
fs.mkdirSync(OUT, { recursive: true });
const START = 'https://banking.nonghyup.com/nhbank.html';

const { chromium } = await import('playwright');
const ctx = await chromium.launchPersistentContext(PROFILE, { headless: false, channel: process.env.BANKQ_CHANNEL || undefined, viewport: { width: 1400, height: 900 } });
const page = ctx.pages()[0] || await ctx.newPage();
const result = { startedAt: new Date().toISOString(), start: START, steps: [] };

async function dumpFrame(fr) {
  return fr.evaluate(() => {
    const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    const lab = (e) => (e.getAttribute('title') || e.getAttribute('placeholder') || e.getAttribute('aria-label') || (e.id && document.querySelector(`label[for="${e.id}"]`)?.innerText) || '').trim().slice(0, 60);
    const inputs = [...document.querySelectorAll('input,select,textarea,button,a[onclick]')].filter(vis).map((e) => ({
      tag: e.tagName.toLowerCase(), type: e.type || null, id: e.id || null, name: e.name || null, label: lab(e),
      text: (e.innerText || e.value || '').trim().slice(0, 40), maxlength: e.maxLength > 0 ? e.maxLength : null, readonly: e.readOnly || false,
    }));
    const body = document.body ? document.body.innerText : '';
    const notes = body.split(/\n+/).filter((l) => /(조회기간|조회가능|서비스 이용|요구불|외화|개월|이내|보안|키패드|가상|사업자|법인|개인사업|제한|최근|등록|생년월일)/.test(l)).map((l) => l.trim().slice(0, 160)).slice(0, 40);
    const keypad = /키패드|가상키|보안키|nProtect|TouchEn|키보드보안|transkey|vkpad/i.test(document.documentElement.outerHTML);
    return { url: location.href, title: document.title, inputs, notes, keypadMarkup: keypad };
  });
}

try {
  await page.goto(START, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForTimeout(4000);
  result.steps.push({ step: 'main', url: page.url(), title: await page.title() });
  // 메뉴 링크 '빠른조회'로 이동(이동만, 입력·제출 없음)
  const link = page.getByText('빠른조회').and(page.locator(':visible')).first();
  if (await link.count()) {
    await link.click({ timeout: 8000 }).catch((e) => result.steps.push({ step: 'click-error', msg: String(e.message).slice(0, 120) }));
    await page.waitForTimeout(5000);
  } else {
    result.steps.push({ step: 'no-quick-link-on-main' });
  }
  const target = ctx.pages().at(-1) || page;
  result.pageCount = ctx.pages().length;
  const frames = [];
  for (const fr of target.frames()) {
    try { frames.push(await dumpFrame(fr)); } catch { /* 접근 불가 프레임 */ }
  }
  result.frames = frames;
  result.finalUrl = target.url();
  await target.screenshot({ path: path.join(OUT, 'nh.png'), fullPage: true });
} catch (e) {
  result.error = String(e.message).slice(0, 200);
  await page.screenshot({ path: path.join(OUT, 'nh.png') }).catch(() => {});
} finally {
  fs.writeFileSync(path.join(OUT, 'nh.json'), JSON.stringify(result, null, 2), 'utf8');
  await ctx.close();
}
console.log(JSON.stringify({ finalUrl: result.finalUrl, frames: (result.frames || []).length, error: result.error || null }));
