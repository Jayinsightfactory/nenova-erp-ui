// Actual built Next.js /work/command-hub UI with loopback synthetic fixtures. Zero MSSQL or production writes.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const path = require('node:path');
const { spawn } = require('node:child_process');
const jwt = require('jsonwebtoken');
const puppeteer = require('puppeteer-core');
const { createWorkflowGuideRecorder } = require('./lib/workflow-guide-recorder.cjs');

const dry = process.argv.includes('--dry-run');
const playerSmoke = process.argv.includes('--player-smoke');

const PREVIEW_PATH =
  'C:\\Users\\USER\\.gemini\\antigravity\\brain\\f4448c29-951a-4c47-b77b-96cafa4fbb27\\ceo_command_hub_preview.png';

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function main() {
  const appPort = await freePort();
  const proxyPort = await freePort();
  const secret = crypto.randomBytes(32).toString('hex');
  const adminUser = {
    userId: 'nenovaSS3',
    userName: '사장님(연습)',
    authority: 1,
    deptName: '경영지원',
    accountActive: true,
  };
  const adminToken = jwt.sign(adminUser, secret, { expiresIn: '2h' });
  const staffToken = jwt.sign(
    { userId: 'guide-staff', userName: '연습직원', authority: 2, deptName: '영업부', accountActive: true },
    secret,
    { expiresIn: '2h' }
  );
  let activeToken = adminToken;
  const counts = { gets: 0, blockedWrites: 0 };

  const fixturePmOffice = {
    success: true,
    serverNow: '2026-11-19T08:35:00Z',
    ageSec: 18,
    unresolved: [
      { id: 'staff-decode-fresh', title: '김원빈 PC 화면 해독이 3시간 넘게 멈춤', since: '1일째', todo: '원격 재연결 확인 필요' },
      { id: 'radar-pilot-echarts', title: '기술 시험 끝남: echarts (9점)', since: '', todo: '쓸지 말지 결정' },
    ],
    data: {
      mode: 'live',
      generatedAt: '2026-11-19T08:34:42Z',
      agents: [
        { id: 'pm', status: 'working', activity: '도입 레이더 결재 안건과 오늘 배포 PR 검증 중', lastAt: '2026-11-19T08:34:40Z' },
      ],
      staff: [
        { name: '김원빈', dept: '수입부', status: 'working' },
        { name: '설연주', dept: '영업지원', status: 'working' },
        { name: '정재훈', dept: '영업부', status: 'idle' },
      ],
      tasks: [
        {
          key: 'staff-decode-fresh',
          state: 'escalated',
          days: 1,
          msg: '해독 3시간+ 멈춤: 김원빈(08:15)',
          decision: '원격 재연결 승인 대기',
          owner: 'PM 조사관',
        },
        {
          key: 'verify-profit-china',
          state: 'verifying',
          days: 0,
          msg: '중국 배/비행기 분해 조회 교차 검증 진행 중',
          owner: 'PM 검증',
        },
        {
          key: 'done-command-hub',
          state: 'done',
          days: 0,
          msg: '사장님 통합 지휘실 · 데스크톱 제1버튼 연결 검증',
          pr: '#1887',
          owner: 'PM',
        },
      ],
      playbooks: {
        total: 14,
        learned: 10,
        hits: 24,
        resolved: { auto: 8, investigated: 4, escalated: 2 },
        cards: [{ id: 'pb-decode', title: '화면 해독 재연결 복구', hits: 6, learnedAt: '2026-11-18T05:00:00Z' }],
      },
      pmDetail: {
        now: '오늘 반영된 중국 운송 분해와 불량차감 수량 분리 상태 확인 중',
        doneToday: [
          { at: '2026-11-19T08:10:00Z', text: '주차별 매출이익 중국 배/비행기 분해 PR #1885 검증 완료' },
        ],
        queueCount: 2,
        approvals: 2,
      },
      workLog: [{ at: '2026-11-19T08:20:00Z', name: '김원빈', dept: '수입부', stage: '입고', label: '인보이스 원본 대조' }],
    },
  };

  const fixtureStaffRequests = [
    {
      id: 'req-fixture-1',
      title: '불량차감 클레임 수량과 견적 수량을 따로 저장해 주세요',
      category: '개선',
      by: 'sales01',
      byName: '정재훈',
      status: 'deployed',
      pr: '#1880',
      route: '/sales/defect-deductions',
      answer: 'EstimateQuantity 분리 저장 반영 완료',
      updatedAt: '2026-11-19T06:15:00Z',
    },
    {
      id: 'req-fixture-2',
      title: '금요일 프로포마 가원가 방어 단가 알림 확인 요청',
      category: '승인',
      by: 'import01',
      byName: '김원빈',
      status: 'needs-human',
      body: '목표 마진 기준 23% 고정 여부 확인 필요',
      updatedAt: '2026-11-19T08:05:00Z',
    },
    {
      id: 'req-fixture-3',
      title: '네덜란드 물량표 열 폭 자동 조정 검토',
      category: '기능',
      by: 'support01',
      byName: '설연주',
      status: 'working',
      updatedAt: '2026-11-19T08:20:00Z',
    },
  ];

  const fixtureLedger = {
    updatedAt: '2026-11-19T01:00:00Z',
    radar: {
      adopt: ['NousResearch/hermes-agent'],
      trial: ['apache/echarts'],
      assess: ['headroomlabs-ai/headroom'],
      hold: [],
    },
    candidates: [
      { title: 'apache/echarts', fit: 5, fitScore: 9, action: '바로 시험', why: '2,289행 SSR SVG 15.9ms 시각화 검증 완료' },
      { title: 'headroomlabs-ai/headroom', fit: 4, fitScore: 8, action: '바로 시험', why: 'JSON 배열 토큰 90.9~96.9% 압축' },
    ],
  };

  const fixtureTechRadar = {
    generatedAt: '2026-11-19T00:00:00Z',
    rounds: [
      {
        id: '2026-11-19',
        items: [
          {
            name: 'apache/echarts',
            systems: ['네노바웹'],
            score: 9,
            action: '바로 시험',
            pilotResult: { verdict: '채택 추천', score: 9, summary: '15.9ms 실측 완료' },
          },
        ],
      },
    ],
  };

  const fixtureDeviceHub = {
    generatedAt: '2026-11-19T08:10:00Z',
    binarySizeKB: 402.5,
    devices: [
      { serial: 'R58M12345AB', ready: true, waitingHuman: false, leaseStatus: 'ACTIVE' },
      { serial: '192.168.0.55:5555', ready: true, waitingHuman: true, leaseStatus: 'WAITING_HUMAN' },
    ],
  };

  const nextArgs = [require.resolve('next/dist/bin/next'), 'start', '-H', '127.0.0.1', '-p', String(appPort)];
  const appProc = spawn(process.execPath, nextArgs, {
    env: { ...process.env, DB_SERVER: '', DB_USER: '', DB_PASSWORD: '', JWT_SECRET: secret },
    stdio: 'ignore',
    windowsHide: true,
  });

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://127.0.0.1:${proxyPort}`);
    const send = (payload, status = 200) => {
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(payload));
    };

    if (url.pathname.startsWith('/api/')) {
      if (req.method !== 'GET') {
        counts.blockedWrites += 1;
        return send({ success: false, error: 'Fixture blocks writes' }, 409);
      }
      counts.gets += 1;
      if (url.pathname === '/api/auth/me') return send({ success: true, user: adminUser });
      if (url.pathname === '/api/favorites') return send({ success: true, favorites: [] });
      if (url.pathname === '/api/pm/office') return send(fixturePmOffice);
      if (url.pathname === '/api/pm/staff-requests') return send({ success: true, isAdmin: true, requests: fixtureStaffRequests });
      if (url.pathname === '/api/my-work/feature') {
        const name = url.searchParams.get('name');
        if (name === 'adoption-ledger') return send({ success: true, name, data: fixtureLedger });
        if (name === 'tech-radar') return send({ success: true, name, data: fixtureTechRadar });
        if (name === 'device-hub-status') return send({ success: true, name, data: fixtureDeviceHub });
        if (name === 'self-tune-report') return send({ success: true, name, data: { summary: '이상 없음' } });
      }
      return send({ success: true, data: null, items: [], rows: [] });
    }

    const headers = { ...req.headers };
    delete headers['proxy-connection'];
    const upstream = http.request(
      {
        hostname: '127.0.0.1',
        port: appPort,
        path: req.url,
        method: req.method,
        headers: {
          ...headers,
          host: `127.0.0.1:${appPort}`,
          cookie: `nenovaToken=${activeToken}`,
          authorization: `Bearer ${activeToken}`,
        },
      },
      (upstreamRes) => {
        res.writeHead(upstreamRes.statusCode || 200, upstreamRes.headers);
        upstreamRes.pipe(res);
      }
    );
    upstream.on('error', (err) => {
      console.error('[guide-proxy upstream error]', req.method, req.url, err?.code || err?.message);
      if (!res.headersSent) {
        res.writeHead(503);
        res.end('Starting isolated app');
      }
    });
    req.pipe(upstream);
  });

  let browser;
  let rec;
  try {
    await new Promise((resolve) => server.listen(proxyPort, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${proxyPort}`;

    for (let i = 0; i < 60; i += 1) {
      try {
        activeToken = staffToken;
        const r1 = await fetch(`${base}/login`);
        const r2 = await fetch(`${base}/work/command-hub?popup=1`);
        if (r1.status === 200 && r2.status === 404) break;
      } catch {}
      if (i === 59) throw new Error('Timed out waiting for isolated Next server');
      await new Promise((r) => setTimeout(r, 1000));
    }

    browser = await puppeteer.launch({
      headless: true,
      executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
      args: ['--no-sandbox'],
    });
    const context = browser.defaultBrowserContext();
    await context.overridePermissions(base, ['clipboard-read', 'clipboard-write']);

    const page = await browser.newPage();
    await page.bringToFront();
    await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));

    await page.setRequestInterception(true);
    page.on('request', (request) => {
      const u = new URL(request.url());
      if (/^https?:$/.test(urlProtocol(u)) && u.hostname !== '127.0.0.1') return request.abort();
      return request.continue();
    });

    function urlProtocol(u) {
      return u.protocol;
    }

    // 1) 비권한 계정(staffToken) 접근 차단 확인 (404 은닉)
    activeToken = staffToken;
    const deniedRes = await page.goto(`${base}/work/command-hub?popup=1`, { waitUntil: 'networkidle0', timeout: 120000 });
    assert.equal(deniedRes.status(), 404, '비권한 계정은 404 은닉');

    // 2) 사장님 계정(adminToken) 정상 진입
    activeToken = adminToken;
    const guideAssets = [];
    page.on('response', (response) => {
      try {
        const u = new URL(response.url());
        if (u.pathname.startsWith('/guides/ceo-command-hub/')) {
          guideAssets.push({ path: u.pathname, status: response.status() });
        }
      } catch {}
    });

    const okRes = await page.goto(`${base}/work/command-hub?popup=1`, { waitUntil: 'networkidle0', timeout: 120000 });
    assert.equal(okRes.status(), 200);
    await page.waitForSelector('[data-testid="ceo-command-hub"]', { timeout: 30000 });
    await page.waitForSelector('[data-testid="hub-agent-roster"]', { timeout: 30000 });
    await page.waitForSelector('[data-testid="hub-page-directory"]', { timeout: 30000 });
    await page.waitForFunction(() => document.body.innerText.includes('PM 총괄 · 조사관 에이전트'), { timeout: 30000 });

    if (playerSmoke) {
      await page.evaluate(() => {
        const details = [...document.querySelectorAll('details')]
          .find((node) => node.querySelector('h3')?.textContent.includes('사장님 통합 지휘실'));
        if (!details) throw new Error('WorkflowGuide for ceo-command-hub not found');
        details.id = 'ceo-hub-guide-target';
      });
      const summary = await page.$('#ceo-hub-guide-target > summary');
      assert.ok(summary);
      await summary.focus();
      await page.keyboard.press('Enter');
      await page.waitForSelector('#ceo-hub-guide-target video');
      assert.equal(await page.$eval('#ceo-hub-guide-target video', (v) => v.paused), true);
      await page.$eval('#ceo-hub-guide-target video', (v) => {
        v.muted = true;
        return v.play();
      });
      await page.waitForFunction(() => document.querySelector('#ceo-hub-guide-target video')?.currentTime > 0.2, { timeout: 15000 });
      await page.$eval('#ceo-hub-guide-target video', (v) => {
        v.pause();
        if (v.textTracks?.[0]) v.textTracks[0].mode = 'showing';
      });
      const chapters = await page.$$('#ceo-hub-guide-target nav[aria-label="사장님 영상 목차"] button');
      assert.equal(chapters.length, 4);
      await chapters[1].focus();
      await page.keyboard.press('Enter');
      await page.waitForFunction(() => {
        const v = document.querySelector('#ceo-hub-guide-target video');
        return Boolean(v && !v.seeking && v.readyState >= 2 && v.currentTime > 4);
      }, { timeout: 15000 });
      assert.ok(await page.$('#ceo-hub-guide-target a[download][href="/guides/ceo-command-hub/staff.mp4"]'));
      assert.ok(await page.$('#ceo-hub-guide-target a[download][href="/guides/ceo-command-hub/staff.ko.vtt"]'));
      assert.equal(counts.blockedWrites, 0);
      assert.deepEqual(errors, []);
      assert.ok(guideAssets.some((a) => a.path.endsWith('.mp4')));
      assert.ok(guideAssets.some((a) => a.path.endsWith('.ko.vtt')));
      assert.ok(guideAssets.every((a) => [200, 206, 304].includes(a.status)));
      console.log(JSON.stringify({ passed: true, playerSmoke: true, guideAssets, ...counts }));
      return;
    }

    if (dry) {
      fs.mkdirSync(path.dirname(PREVIEW_PATH), { recursive: true });
      fs.mkdirSync('.verify', { recursive: true });
      await page.screenshot({ path: PREVIEW_PATH, fullPage: true });
      await page.screenshot({ path: '.verify/ceo-command-hub-1920-fold.png', fullPage: false });
      await page.$eval('#hub-pm-ledger', (el) => el.scrollIntoView({ block: 'start', behavior: 'instant' }));
      await page.screenshot({ path: '.verify/ceo-command-hub-ledger.png', fullPage: false });
      await page.$eval('#hub-directory', (el) => el.scrollIntoView({ block: 'start', behavior: 'instant' }));
      await page.screenshot({ path: '.verify/ceo-command-hub-directory.png', fullPage: false });
      await page.evaluate(() => document.querySelector('.page-area')?.scrollTo(0, 0));
      for (const width of [1920, 1280, 390]) {
        await page.setViewport({ width, height: 1080, deviceScaleFactor: 1 });
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 2);
        assert.equal(overflow, false, `${width}px 뷰포트 가로 넘침 발생`);
        if (width !== 1920) await page.screenshot({ path: `.verify/ceo-command-hub-${width}.png`, fullPage: false });
      }
      await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
    }

    if (!dry) {
      await page.addStyleTag({ content: 'body, [data-testid="ceo-command-hub"] { padding-bottom: 240px !important; }' });
      const registry = JSON.parse(fs.readFileSync('config/workflow-guides.json', 'utf8'));
      const wf = registry.workflows.find((w) => w.id === 'ceo-command-hub');
      assert.ok(wf, 'ceo-command-hub entry missing in config/workflow-guides.json');
      rec = await createWorkflowGuideRecorder(page, {
        workflowId: wf.id,
        guideId: 'staff',
        title: wf.title,
        sourceFiles: wf.sourceFiles,
        fixtureOnly: true,
      });
    }

    const stepFocus = async (scenario, text, selector, num) => {
      await page.$eval(selector, (el) => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
      if (rec) {
        rec.chapter(scenario, `${num}. ${text}`);
        await rec.caption(`${num}. ${text}`);
        await rec.pause(1300);
        await rec.focus(selector, num);
        await rec.pause(1000);
      }
    };

    const showResult = async (text) => {
      if (rec) {
        await rec.unfocus();
        await rec.caption(text);
        await rec.pause(1500);
      }
    };

    // 1단계: 아침 1분 점검 코스 & 실시간 맥박 스트립
    await stepFocus('pulse', '상단 맥박 스트립과 아침 1분 점검 코스에서 결재·에이전트·원가 경보를 확인합니다.', '[data-testid="checklist-step-approval"]', 1);
    await page.click('[data-testid="checklist-step-approval"]');
    if (rec) await rec.pause(700);
    await showResult('1. 결재 대기 건수, 6대 에이전트 현황, 연속 디벨롭 진척을 한 화면 상단에서 즉시 파악합니다.');

    // 2단계: PM 원장 탭 전환 및 검색
    await stepFocus('ledger', 'PM 업무 원장에서 전체·진행중·완료 탭을 전환하고 안건명·PR 번호로 검색합니다.', '[data-testid="ledger-tab-all"]', 2);
    await page.click('[data-testid="ledger-tab-all"]');
    await page.click('[data-testid="ledger-search-input"]');
    await page.type('[data-testid="ledger-search-input"]', '#1880');
    await page.waitForFunction(() => document.querySelector('[data-testid="hub-pm-ledger-table"]')?.innerText.includes('#1880'));
    if (rec) await rec.pause(700);
    await page.keyboard.down('Control');
    await page.keyboard.press('KeyA');
    await page.keyboard.up('Control');
    await page.keyboard.press('Backspace');
    await page.waitForFunction(() => (document.querySelector('[data-testid="ledger-search-input"]')?.value || '') === '');
    await showResult('2. 결재 대기, 진행중, 최근 완료 PR이 한 표로 모여 /pm에 따로 들어가지 않아도 됩니다.');

    // 3단계: 다음 연속 구현 대기 큐 & 지시서 복사
    await stepFocus('queue', '다음 연속 구현 대기 큐에서 READY 과제를 골라 구현 지시서를 복사합니다.', '[data-testid="build-stage-READY"]', 3);
    await page.click('[data-testid="build-stage-READY"]');
    await page.waitForSelector('[data-testid="copy-brief-BLD-05"]');
    await page.click('[data-testid="copy-brief-BLD-05"]');
    await page.waitForSelector('[data-testid="hub-copy-notice"]');
    if (rec) await rec.pause(800);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('[data-testid="hub-copy-notice"]'));
    await showResult('3. 구현 지시서가 복사되어 바로 하위 세션에 발주할 수 있습니다. 이어서 가브리엘 원가 경보도 봅니다.');

    // 4단계: 4대 목적별 전체 화면 한눈 지도
    await stepFocus('directory', '하단 4대 목적별 전체 화면 지도에서 오늘 필요한 업무 화면을 바로 엽니다.', '#directory-heading', 4);
    if (rec) await rec.pause(800);
    await showResult('4. 일일 관제·돈 버는 원가·기술 레이더·매뉴얼 시연 4대 목적으로 전체 화면을 쉽게 찾습니다.');

    if (rec) {
      const result = await rec.stop();
      const registryPath = 'config/workflow-guides.json';
      const registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
      const entry = registry.workflows.find((w) => w.id === 'ceo-command-hub');
      Object.assign(entry.guides[0], { status: 'ready', chapters: result.chapters });
      fs.writeFileSync(registryPath, `${JSON.stringify(registry, null, 2)}\n`, 'utf8');
    }

    assert.equal(counts.blockedWrites, 0);
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ passed: true, dry, ...counts }));
  } finally {
    await browser?.close();
    appProc.kill();
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((err) => {
  console.error(err.stack || err);
  process.exitCode = 1;
});
