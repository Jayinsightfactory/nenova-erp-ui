const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const puppeteer = require('puppeteer-core');

// Real browser computed-style fixture, with no server or business API traffic.
const root = path.resolve(__dirname, '..');
const css = ['globals.css', 'unified-ui.css', 'desktop-workspace.css']
  .map(file => fs.readFileSync(path.join(root, 'styles', file), 'utf8')).join('\n') + '\n' +
  fs.readFileSync(path.join(root, 'styles/DesktopOrderWorkspace.module.css'), 'utf8').replace(/:global\(([^)]+)\)/g, '$1');
const fixture = `<style>${css}</style>
<div class="layout" data-ui-shell="standard">
 <aside data-ui-sidebar class="sidebar">메뉴</aside>
 <main class="main-content"><header data-ui-topbar class="topbar">제목</header>
 <div class="page-area" data-ui-page-content><h1 data-desktop-chrome>업무 제목</h1><div class="filter-bar">
 <button id="action" class="btn btn-primary">조회</button>
 <input id="input" class="filter-input" aria-label="업체 검색">
 <select id="select" class="filter-select" aria-label="연도"><option>2026</option></select>
 <button id="plain">별도 디자인 버튼</button>
 <table class="tbl"><tbody><tr><td><button id="cell" class="btn btn-sm">수정</button>
 <input id="cell-input" class="filter-input" aria-label="셀 수량"></td></tr></tbody></table>
 <div role="grid"><button id="grid" class="btn btn-sm">가상표</button></div>
 </div><button id="outside" class="btn btn-sm">별도 작은 버튼</button>
 <section id="order-page" class="page importPage" style="padding:28px;max-width:400px;margin:auto">
 <div class="toolbar"><button id="order-action" class="btn btn-sm" style="height:24px">조회</button>
 <table><tbody><tr><td><button id="order-cell" class="btn btn-sm">셀 수정</button></td></tr></tbody></table></div>
 <div role="grid"><button id="order-grid" class="btn btn-sm">가상표 수정</button></div></section>
 <section id="audit-page" class="page" style="padding:20px;max-width:1500px;margin:auto"><textarea id="audit-text" style="width:100%;height:220px;box-sizing:border-box"></textarea><div style="overflow-x:auto"><table id="audit-table" style="min-width:900px"><tbody><tr><td>품목</td></tr></tbody></table></div></section>
 </div></main>
</div>`;

async function measure(page) {
  return page.evaluate(() => {
    const style = selector => {
      const element = document.querySelector(selector);
      const css = getComputedStyle(element);
      return { height: css.height, minHeight: css.minHeight, font: css.fontSize,
        padding: css.padding, gap: css.gap, display: css.display,
        background: css.backgroundColor, outline: css.outlineStyle };
    };
    return Object.fromEntries(['#action', '#input', '#select', '#plain', '#cell', '#cell-input',
      '#grid', '#outside', '#order-page', '#order-action', '#order-cell', '#order-grid', '#audit-page', '#audit-text', '#audit-table', '.page-area', '.filter-bar', '[data-ui-sidebar]', '[data-desktop-chrome]']
      .map(selector => [selector, style(selector)]));
  });
}

(async () => {
  const browser = await puppeteer.launch({
    executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: true,
  });
  try {
    for (const width of [1920, 800]) {
      const page = await browser.newPage();
      await page.setViewport({ width, height: 1080, deviceScaleFactor: 1 });
      await page.setContent(fixture);
      const web = await measure(page);
      assert.equal(web['#action'].height, '24px');
      assert.equal(web['#input'].height, '22px');
      await page.emulateMediaType('print');
      const webPrint = await measure(page);
      await page.evaluate(() => document.documentElement.dataset.nenovaDesktop = 'true');
      assert.deepEqual(await measure(page), webPrint, 'PC marker must not change print styles');
      await page.emulateMediaType('screen');
      const pc = await measure(page);
      for (const id of ['#action', '#input', '#select']) {
        assert.equal(pc[id].height, '30px');
        assert.equal(pc[id].font, '13px');
      }
      for (const id of ['#plain', '#cell', '#cell-input', '#grid', '#outside', '#order-cell', '#order-grid']) {
        assert.deepEqual(pc[id], web[id], `${id} geometry/appearance preserved`);
      }
      assert.equal(pc['#action'].background, web['#action'].background, 'primary action color preserved');
      assert.equal(pc['.page-area'].padding, '6px 8px');
      assert.equal(pc['.filter-bar'].gap, '6px');
      assert.equal(pc['#order-action'].height, '30px');
      assert.equal(pc['#order-page'].padding, '12px 12px 120px');
      assert.equal(pc['#audit-page'].padding, '12px');
      assert.equal(pc['#audit-text'].height, '220px');
      assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('#audit-table')).minWidth), '900px');
      assert.equal(pc['[data-ui-sidebar]'].display, 'none');
      assert.equal(pc['[data-desktop-chrome]'].display, 'none');
      await page.evaluate(() => document.documentElement.dataset.nenovaDesktopTools = 'open');
      assert.equal((await measure(page))['[data-desktop-chrome]'].display, web['[data-desktop-chrome]'].display);
      await page.evaluate(() => delete document.documentElement.dataset.nenovaDesktopTools);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await page.keyboard.press('Tab');
      assert.equal(await page.evaluate(() => document.activeElement.id), 'action');
      assert.equal((await measure(page))['#action'].outline, 'solid');
      await page.keyboard.press('Tab');
      assert.equal(await page.evaluate(() => document.activeElement.id), 'input');
      await page.keyboard.down('Shift');
      await page.keyboard.press('Tab');
      await page.keyboard.up('Shift');
      assert.equal(await page.evaluate(() => document.activeElement.id), 'action');
      console.log(JSON.stringify({ viewport: `${width}x1080`, zoom: '100%',
        passed: ['web baseline', 'PC toolbar', 'table/grid exclusions', 'print parity', 'focus order/outline', 'no horizontal overflow'] }));
      await page.close();
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
