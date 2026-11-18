// scripts/record-commercial-suite-guide.cjs — 상용 솔루션 업종별 시연 스튜디오 사용 가이드 녹화
// 실제 로컬 화면 + 100% 가상 시연 데이터. 전산 DB·운영 서버에 연결하지 않습니다.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const jwt = require('jsonwebtoken');
const puppeteer = require('puppeteer-core');
const { createWorkflowGuideRecorder } = require('./lib/workflow-guide-recorder.cjs');

const dry = process.argv.includes('--dry-run');
const ID = 'commercial-suite';
const CONFIG = 'config/workflow-guides.json';
const ENTRY = {
  id: ID,
  title: 'NOWLINK · MOYI 업종별 상용 솔루션 시연 스튜디오',
  entryPaths: ['/demo/commercial-suite'],
  sourceFiles: ['pages/demo/commercial-suite.js', 'lib/commercialSuiteDemo.js'],
  requiredScenarios: ['industry', 'units', 'approve', 'roi'],
  guides: [
    {
      id: 'staff',
      role: '시연담당',
      title: '업종 실시간 치환부터 3단위 환산·MOYI 승인·ROI 산정',
      status: 'draft',
      src: `/guides/${ID}/staff.mp4`,
      captions: `/guides/${ID}/staff.ko.vtt`,
      proof: `/guides/${ID}/staff.proof.json`,
      chapters: [],
    },
  ],
};

async function main() {
  fs.mkdirSync('.verify/commercial-suite-shots', { recursive: true });
  const registry = JSON.parse(fs.readFileSync(CONFIG, 'utf8'));
  if (!registry.workflows.some((w) => w.id === ID)) {
    registry.workflows.push(ENTRY);
    fs.writeFileSync(CONFIG, JSON.stringify(registry, null, 2) + '\n');
  }

  const listener = net.createServer();
  await new Promise((resolve) => listener.listen(0, '127.0.0.1', resolve));
  const port = listener.address().port;
  await new Promise((resolve) => listener.close(resolve));

  const base = `http://localhost:${port}`;
  const secret = crypto.randomUUID();
  const log = fs.openSync('.verify/commercial-suite-guide-server.log', 'w');
  const server = spawn(
    process.execPath,
    [require.resolve('next/dist/bin/next'), 'dev', '--webpack', '-p', String(port)],
    {
      env: {
        ...process.env,
        DB_SERVER: '',
        JWT_SECRET: secret,
        ANTHROPIC_API_KEY: '',
        PROFIT_REPORT_WEEKLY_SCHEDULER_DISABLED: '1',
      },
      stdio: ['ignore', log, log],
      windowsHide: true,
    }
  );
  fs.closeSync(log);

  let browser;
  try {
    for (let n = 0; n < 120; n++) {
      try {
        if ((await fetch(base + '/login')).status === 200) break;
      } catch {}
      if (n === 119) throw new Error('Local server startup failed');
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    browser = await puppeteer.launch({
      headless: true,
      executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
      args: ['--no-sandbox'],
    });
    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
    page.setDefaultTimeout(30000);

    const pageErrors = [];
    page.on('pageerror', (err) => pageErrors.push(String(err)));

    const user = { userId: 'nenovaSS3', userName: '시연담당자', authority: 1, deptName: '경영', accountActive: true };
    await page.setCookie({ name: 'nenovaToken', value: jwt.sign(user, secret, { expiresIn: '1h' }), url: base });

    await page.setRequestInterception(true);
    page.on('request', async (request) => {
      const url = new URL(request.url());
      if (url.protocol === 'blob:' || url.protocol === 'data:') return request.continue();
      if (url.origin !== base) return request.abort();
      if (!url.pathname.startsWith('/api/')) return request.continue();
      if (url.pathname === '/api/auth/me') {
        return request.respond({
          status: 200,
          contentType: 'application/json; charset=utf-8',
          body: JSON.stringify({ success: true, user }),
        });
      }
      return request.respond({
        status: 200,
        contentType: 'application/json; charset=utf-8',
        body: JSON.stringify({ success: true, items: [], rows: [], favorites: [] }),
      });
    });

    await page.goto(base + '/demo/commercial-suite', { waitUntil: 'networkidle0', timeout: 180000 });
    await page.addStyleTag({ content: 'nextjs-portal{display:none!important}' });
    await page.waitForSelector('[data-industry="fresh"]', { visible: true });

    const rec = dry
      ? {
          chapter() {},
          caption: async () => {},
          focus: async () => {},
          unfocus: async () => {},
          pause: (ms) => new Promise((resolve) => setTimeout(resolve, Math.min(ms, 200))),
          stop: async () => ({ chapters: [] }),
        }
      : await createWorkflowGuideRecorder(page, {
          workflowId: ID,
          guideId: 'staff',
          title: ENTRY.title,
          sourceFiles: ENTRY.sourceFiles,
          fixtureOnly: true,
        });

    let shot = 0;
    const snap = async (name) => {
      if (dry) await page.screenshot({ path: `.verify/commercial-suite-shots/${String(++shot).padStart(2, '0')}-${name}.png` });
    };
    const center = (selector) => page.$eval(selector, (node) => node.scrollIntoView({ block: 'center', inline: 'nearest' }));
    const point = async (selector) => {
      const box = await (await page.$(selector)).boundingBox();
      return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    };
    const clickAt = async (selector) => {
      const at = await point(selector);
      await page.mouse.move(at.x, at.y, { steps: 10 });
      await rec.pause(400);
      await page.mouse.down();
      await page.mouse.up();
    };

    async function step(number, scenario, label, actionCaption, resultCaption, selector, action) {
      await page.waitForSelector(selector, { visible: true });
      await center(selector);
      await rec.pause(300);
      const title = `${number}. ${label}`;
      rec.chapter(scenario, title);
      await rec.caption(`${title} · ${actionCaption}`);
      await rec.pause(2400);
      await rec.focus(selector, number);
      await action();
      await rec.pause(2200);
      await rec.unfocus();
      await rec.caption(`${number}. ${resultCaption}`);
      await rec.pause(2000);
      await snap(scenario);
    }

    await snap('initial-flower');

    await step(
      1,
      'industry',
      '업종 실시간 전환',
      '상단 업종 스위치에서 [신선 식자재 · 청과 유통] 버튼을 눌러 전체 화면을 치환합니다.',
      '출처(원산지·산지출하자), 3단위(박스·소분팩·낱개EA), 일일 경매차수 용어가 즉시 바뀐 것을 확인합니다.',
      '[data-industry="fresh"]',
      async () => {
        await clickAt('[data-industry="fresh"]');
        await page.waitForSelector('[data-industry="fresh"][aria-pressed="true"]');
      }
    );

    await step(
      2,
      'units',
      '3단위 발주 수량 조정',
      '발주 수량 입력칸에 20박스를 입력하면 소분팩·낱개EA와 거래처 분배량이 즉시 환산됩니다.',
      '20박스 → 200소분팩 → 1,600낱개EA 환산 및 가상 거래처 배분 합계를 확인합니다.',
      '[data-testid="unit-large-input"]',
      async () => {
        await page.click('[data-testid="unit-large-input"]');
        await page.keyboard.down('Control');
        await page.keyboard.press('a');
        await page.keyboard.up('Control');
        await page.keyboard.press('Backspace');
        await page.keyboard.type('20', { delay: dry ? 0 : 60 });
        await page.waitForFunction(() => document.body.innerText.includes('200소분팩'));
      }
    );

    await step(
      3,
      'approve',
      'MOYI 원터치 승인 실행',
      'Phone Harness 수집 내역을 확인하고 [MOYI 원터치 승인 실행] 버튼을 눌러 원장 반영을 완료합니다.',
      'APPLIED 상태와 원장 반영 영수증 번호(RCPT-FR-1118-304)가 발행된 결과를 확인합니다.',
      '[data-act="moyi-approve"]',
      async () => {
        await clickAt('[data-act="moyi-approve"]');
        await page.waitForSelector('[data-testid="moyi-receipt-box"]', { visible: true });
      }
    );

    await step(
      4,
      'roi',
      '월 요금제 및 ROI 확인',
      '고객사 환경에 맞춰 [Build] 플랜을 선택해 주간 시간 단축과 월 예상 순효익을 비교합니다.',
      '주간 시간 단축과 Watch/Build/Team + Device Hub Add-on 월 요금제 ROI 결과를 확인합니다.',
      '[data-plan="build"]',
      async () => {
        await clickAt('[data-plan="build"]');
        await page.waitForFunction(() => document.body.innerText.includes('선택 플랜 월 요금 (Build)'));
      }
    );

    assert.equal(pageErrors.length, 0, `페이지 오류 발생: ${pageErrors.join('; ')}`);

    if (!dry) {
      const result = await rec.stop();
      const updated = JSON.parse(fs.readFileSync(CONFIG, 'utf8'));
      const wf = updated.workflows.find((w) => w.id === ID);
      wf.guides[0].status = 'ready';
      wf.guides[0].chapters = result.chapters;
      fs.writeFileSync(CONFIG, JSON.stringify(updated, null, 2) + '\n');
      console.log(`Recorded commercial-suite guide: ${result.mp4} (${result.duration.toFixed(1)}s)`);
    } else {
      console.log('Dry-run completed with 4 steps and 0 page errors.');
    }
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (server && !server.killed) {
      try {
        process.kill(server.pid);
      } catch {}
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
