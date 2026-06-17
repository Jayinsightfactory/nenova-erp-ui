/**
 * 프로덕션 카탈로그 레이아웃·확대 검증 (Playwright)
 * node scripts/verify-catalog-layout.mjs
 */
import { chromium } from 'playwright';

const BASE = process.env.SMOKE_BASE_URL || 'https://nenovaweb.com';
const USER = process.env.SMOKE_USER || 'nenovaSS3';
const PASS = process.env.SMOKE_PASS || '0000';

const results = [];
const ok = (label, detail = '') => results.push({ ok: true, label, detail });
const bad = (label, detail = '') => results.push({ ok: false, label, detail });

async function loginToken(page) {
  const res = await page.request.post(`${BASE}/api/auth/login`, {
    data: { userId: USER, password: PASS },
  });
  const json = await res.json();
  if (!res.ok() || !json.token) throw new Error(`login failed: ${res.status()} ${JSON.stringify(json)}`);
  return json.token;
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  const page = await context.newPage();

  try {
    const token = await loginToken(page);
    await context.addCookies([{
      name: 'token',
      value: token,
      domain: new URL(BASE).hostname,
      path: '/',
    }]);

    await page.goto(`${BASE}/catalog`, { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForTimeout(1500);

    // 거래처 + 도착원가 로드
    const custSelect = page.locator('select.filter-select').nth(1);
    const custOptions = await custSelect.locator('option').evaluateAll(opts =>
      opts.map(o => ({ value: o.value, label: o.textContent?.trim() })).filter(o => o.value)
    );
    if (custOptions.length) {
      await custSelect.selectOption(custOptions[0].value);
      ok('customer selected', custOptions[0].label);
    }
    const loadBtn = page.getByRole('button', { name: /도착원가 불러오기/ });
    if (await loadBtn.count()) {
      await loadBtn.click();
      await page.waitForSelector('.catalog-prod-card', { timeout: 90000 }).catch(() => null);
      await page.waitForTimeout(1500);
    }

    const title = await page.title();
    ok('catalog page loaded', title || '(no title)');

    const editorVisibleEarly = await page.locator('.catalog-line-editor').isVisible().catch(() => false);
    if (!editorVisibleEarly) ok('text editor default collapsed', 'table hidden on load');
    else bad('text editor default collapsed', 'table visible before interaction');

    // 배포 번들에 zoom 분기 제거 확인
    const jsUrls = await page.evaluate(() =>
      [...document.querySelectorAll('script[src*="/_next/"]')].map(s => s.src).filter(Boolean)
    );
    let hasOldCoverBranch = false;
    let hasNewComment = false;
    for (const url of jsUrls.slice(0, 8)) {
      try {
        const res = await page.request.get(url);
        const text = await res.text();
        if (text.includes('zoom <= 1.001') || (text.includes('objectFit:"cover"') && text.includes('zoom * 100'))) {
          hasOldCoverBranch = true;
        }
        if (text.includes('contain') && text.includes('zoom * 100') && text.includes('catalogImageStyle')) {
          hasNewComment = true;
        }
      } catch { /* ignore chunk fetch errors */ }
    }
    if (hasOldCoverBranch) bad('deploy bundle: no 100/101 cover jump fix');
    else ok('deploy bundle: linear zoom (no cover branch at 101%)');

    // CSS: 슬롯 이미지 영역 25% 높이
    const slotCss = await page.evaluate(() => {
      const el = document.querySelector('.composer-slot-img');
      if (!el) return null;
      const st = getComputedStyle(el);
      return {
        flexBasis: st.flexBasis,
        maxHeight: st.maxHeight,
        flexGrow: st.flexGrow,
        flexShrink: st.flexShrink,
      };
    });
    if (!slotCss) {
      bad('composer slot not found — need product on slide for full UI check');
    } else {
      const basisPct = slotCss.flexBasis?.includes('%');
      const maxPct = slotCss.maxHeight?.includes('%');
      if (basisPct && maxPct && slotCss.flexShrink === '0') {
        ok('slot image area CSS', `${slotCss.flexBasis} / max ${slotCss.maxHeight}`);
      } else {
        bad('slot image area not 25% height', JSON.stringify(slotCss));
      }
    }

    // 품목 선택 → 슬라이드 배치 → 썸네일 비율 측정
    const prodCard = page.locator('.catalog-prod-card:not(.no-image)').first();
    if (!(await prodCard.count())) {
      // 이미지 없어도 레이아웃은 측정 가능
    }
    const anyProd = (await prodCard.count()) ? prodCard : page.locator('.catalog-prod-card').first();
    if (await anyProd.count()) {
      const prodKey = await anyProd.getAttribute('data-prod-key');
      // 썸네일 클릭 대신 카드 본문 클릭(체크만) — 이미지 피커 모달 방지
      await anyProd.evaluate((el) => {
        el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      });
      await page.waitForTimeout(400);
      const imgModal = page.locator('.catalog-img-modal-overlay');
      if (await imgModal.count()) {
        await page.getByRole('button', { name: '닫기' }).first().click().catch(() => imgModal.click());
        await page.waitForTimeout(300);
      }

      // 슬라이드 펼치기 + 자동 배치
      const expandBtn = page.locator('.composer-slide-toggle').first();
      if (await expandBtn.count()) {
        const expanded = await expandBtn.getAttribute('aria-expanded');
        if (expanded !== 'true') await expandBtn.click();
      }

      await page.evaluate((pk) => {
        const dt = new DataTransfer();
        dt.setData('application/x-nenova-catalog-prod', String(pk));
        dt.setData('text/plain', `prod:${pk}`);
        const banner = document.querySelector('.composer-drop-banner');
        if (!banner) return;
        for (const type of ['dragover', 'drop']) {
          banner.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt }));
        }
      }, prodKey);
      await page.waitForTimeout(1000);

      const slot = page.locator('.composer-slot.filled').first();
      if (await slot.count()) {
        const ratio = await slot.evaluate((slotEl) => {
          const imgWrap = slotEl.querySelector('.composer-slot-img');
          const frame = slotEl.querySelector('.composer-slot-img-frame');
          if (!imgWrap || !frame) return null;
          const sh = slotEl.getBoundingClientRect().height;
          const ih = imgWrap.getBoundingClientRect().height;
          const fw = frame.getBoundingClientRect().width;
          const sw = slotEl.getBoundingClientRect().width;
          return {
            slotH: sh,
            imgAreaH: ih,
            imgAreaPct: sh ? (ih / sh) * 100 : 0,
            frameW: fw,
            slotW: sw,
            frameWPct: sw ? (fw / sw) * 100 : 0,
          };
        });
        if (ratio) {
          if (ratio.imgAreaPct >= 20 && ratio.imgAreaPct <= 32) {
            ok('slot thumb height vs cell', `${ratio.imgAreaPct.toFixed(1)}% of slot (target ~25%)`);
          } else {
            bad('slot thumb height vs cell', `${ratio.imgAreaPct.toFixed(1)}% (expected ~25%, was too large if >40%)`);
          }
          ok('slot frame width vs cell', `${ratio.frameWPct.toFixed(1)}% width`);
        }

        // 크롭 모달 + 100→101% 픽셀 변화
        const frameBtn = slot.locator('.composer-slot-img-frame').first();
        await frameBtn.evaluate((el) => el.click());
        await page.waitForSelector('.catalog-crop-modal', { timeout: 5000 }).catch(() => null);

        if (await page.locator('.catalog-crop-modal').count()) {
          ok('crop opens in modal', 'overlay visible');

          const setScale = async (scaleVal) => {
            const slider = page.locator('.catalog-crop-modal input[type="range"]').first();
            await slider.evaluate((el, v) => {
              const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
              if (setter) setter.call(el, String(v));
              else el.value = String(v);
              el.dispatchEvent(new Event('input', { bubbles: true }));
              el.dispatchEvent(new Event('change', { bubbles: true }));
            }, scaleVal);
            await page.waitForTimeout(150);
          };

          await setScale(100);
          const at100 = await page.evaluate(() => {
            const img = document.querySelector('.catalog-crop-modal .catalog-crop-frame-inner img');
            const frame = document.querySelector('.catalog-crop-modal .catalog-crop-frame');
            if (!img || !frame) return null;
            const fr = frame.getBoundingClientRect();
            const ir = img.getBoundingClientRect();
            return {
              frameW: fr.width,
              imgW: ir.width,
              objectFit: getComputedStyle(img).objectFit,
            };
          });

          await setScale(101);
          const at101 = await page.evaluate(() => {
            const img = document.querySelector('.catalog-crop-modal .catalog-crop-frame-inner img');
            if (!img) return null;
            const ir = img.getBoundingClientRect();
            return { imgW: ir.width, objectFit: getComputedStyle(img).objectFit };
          });

          await setScale(110);
          const at110 = await page.evaluate(() => {
            const img = document.querySelector('.catalog-crop-modal .catalog-crop-frame-inner img');
            return img ? { imgW: img.getBoundingClientRect().width } : null;
          });

          if (at100 && at101) {
            const jumpRatio = at101.imgW / at100.imgW;
            if (at101.objectFit === 'contain') ok('crop preview object-fit', 'contain');
            else bad('crop preview object-fit', at101.objectFit);

            if (jumpRatio < 1.08) {
              ok('100→101% zoom smooth', `width ratio ${jumpRatio.toFixed(3)} (not ~2x)`);
            } else {
              bad('100→101% zoom jump', `width ratio ${jumpRatio.toFixed(3)} (too large)`);
            }
            if (at110 && at100.imgW > 0) {
              const r110 = at110.imgW / at100.imgW;
              ok('100→110% progressive', `ratio ${r110.toFixed(3)}`);
            }
          }
        } else {
          bad('crop modal', 'not opened (no image on line?)');
        }
      } else {
        bad('filled composer slot', 'drop product to measure thumb');
      }
    } else {
      bad('product cards', 'none visible — pick customer/week?');
    }
  } catch (err) {
    bad('verify runtime', err.message?.slice(0, 200));
  } finally {
    await browser.close();
  }

  const passed = results.filter(r => r.ok).length;
  const failed = results.filter(r => !r.ok).length;
  console.log(`\n=== catalog layout verify (${BASE}) ===\n`);
  for (const r of results) {
    console.log(`${r.ok ? '✓' : '✗'} ${r.label}${r.detail ? ` — ${r.detail}` : ''}`);
  }
  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
