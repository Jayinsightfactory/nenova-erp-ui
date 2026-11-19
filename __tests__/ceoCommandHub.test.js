// __tests__/ceoCommandHub.test.js — 사장님 전용 통합 지휘실(/work/command-hub) 도메인·권한·SSR·Anti-AI Slop·데스크톱 연결 검증.
// 실행: node __tests__/ceoCommandHub.test.js (MSSQL·네트워크 불필요)
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { transformSync } = require('next/dist/build/swc');

const root = process.cwd();
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

function compile(rel, customRequire, sourceTransform) {
  const filename = path.join(root, rel);
  const mod = new Module(filename, module);
  mod.filename = filename;
  mod.paths = Module._nodeModulePaths(path.dirname(filename));
  const baseRequire = Module.createRequire(filename);
  mod.require = (id) => (customRequire ? customRequire(id, baseRequire) : baseRequire(id));
  const raw = fs.readFileSync(filename, 'utf8');
  const src = sourceTransform ? sourceTransform(raw) : raw;
  const { code } = transformSync(src, {
    filename,
    jsc: {
      parser: { syntax: 'ecmascript', jsx: true },
      target: 'es2022',
      transform: { react: { runtime: 'automatic' } },
    },
    module: { type: 'commonjs' },
  });
  mod._compile(code, filename);
  return mod.exports;
}

const pmTechRadarMod = compile('lib/pmTechRadarSim.js');
const pipelineMod = compile('lib/importOneStopPipeline.js', (id, baseReq) => {
  if (id === './orderWeekDate.js') return compile('lib/orderWeekDate.js');
  return baseReq(id);
});
const boxMod = compile('lib/boxMetricTable.js');
const gabrielMod = compile('lib/gabrielProfitAgi.js', (id, baseReq) => {
  if (id === './importOneStopPipeline.js') return pipelineMod;
  if (id === './boxMetricTable.js') return boxMod;
  return baseReq(id);
});
const pmUnresolvedMod = compile('lib/pmUnresolved.js');
const pmPlaybooksMod = compile('lib/pmPlaybooks.js');

const hubLib = compile('lib/ceoCommandHub.js', (id, baseReq) => {
  if (id === './pmTechRadarSim') return pmTechRadarMod;
  if (id === './gabrielProfitAgi') return gabrielMod;
  if (id === './pmUnresolved') return pmUnresolvedMod;
  if (id === './pmPlaybooks') return pmPlaybooksMod;
  return baseReq(id);
});

const stubCss = new Proxy({}, { get: (_, prop) => String(prop) });
const stubLink = ({ href, children, ...rest }) => React.createElement('a', { href: String(href || ''), ...rest }, children);
const stubGuide = ({ workflowId }) => React.createElement('div', { 'data-guide-stub': workflowId });

const CeoCommandHub = compile('components/work/CeoCommandHub.js', (id, baseReq) => {
  if (id === 'next/link') return { __esModule: true, default: stubLink };
  if (id === '../WorkflowGuide') return { __esModule: true, default: stubGuide };
  if (id === '../../lib/ceoCommandHub') return hubLib;
  if (id.endsWith('.module.css')) return { __esModule: true, default: stubCss };
  return baseReq(id);
}).default;

const SAMPLE_PM_OFFICE = {
  success: true,
  serverNow: '2026-11-19T08:30:00Z',
  ageSec: 25,
  data: {
    mode: 'live',
    generatedAt: '2026-11-19T08:29:35Z',
    agents: [
      { id: 'pm', status: 'working', activity: '도입 레이더 결재 안건 정리 중', lastAt: '2026-11-19T08:29:30Z' },
    ],
    staff: [
      { name: '김원빈', dept: '수입부', status: 'working' },
      { name: '설연주', dept: '영업지원', status: 'idle' },
    ],
    tasks: [
      {
        key: 'staff-decode-fresh',
        state: 'escalated',
        days: 1,
        msg: '해독 4시간+ 멈춤: 김원빈(08:10)',
        decision: '원격 재기동 여부 확인 필요',
        owner: 'PM 조사관',
      },
      {
        key: 'verify-profit-china',
        state: 'verifying',
        days: 0,
        msg: '중국 배/비행기 분해 조회 교차 검증 중',
        owner: 'PM 검증',
      },
      {
        key: 'done-gabriel-l10',
        state: 'done',
        days: 0,
        msg: '가브리엘 10대 레버 시뮬레이터 검증 완료',
        pr: '#1871',
        owner: 'PM',
      },
    ],
    playbooks: {
      total: 12,
      learned: 9,
      hits: 21,
      resolved: { auto: 6, investigated: 4, escalated: 2 },
      cards: [{ id: 'pb-1', title: '화면 해독 재연결', hits: 5, learnedAt: '2026-11-18T05:00:00Z' }],
    },
    pmDetail: {
      now: '오늘 배포된 중국 운송 분해 및 불량수량 분리 상태 점검 중',
      doneToday: [{ at: '2026-11-19T07:50:00Z', text: '주차별 매출이익 중국 운송 분해 PR #1885 검증' }],
      queueCount: 2,
      approvals: 1,
    },
    workLog: [{ at: '2026-11-19T08:10:00Z', name: '김원빈', dept: '수입부', stage: '입고', label: '인보이스 대조' }],
  },
};

const SAMPLE_STAFF_REQUESTS = [
  {
    id: 'req001',
    title: '불량차감 견적 수량 따로 저장하게 해주세요',
    category: '개선',
    by: 'sales01',
    byName: '정재훈',
    status: 'deployed',
    pr: '#1880',
    route: '/sales/defect-deductions',
    answer: '클레임 수량과 견적 수량 분리 적용 완료',
    updatedAt: '2026-11-19T06:00:00Z',
  },
  {
    id: 'req002',
    title: '신규 거래처 여신한도 예외 승인 요청',
    category: '승인',
    by: 'sales02',
    byName: '박성수',
    status: 'needs-human',
    body: '사장님 확인 후 한도 조정 필요',
    updatedAt: '2026-11-19T08:00:00Z',
  },
  {
    id: 'req003',
    title: '네덜란드 물량표 열 폭 자동 조정 검토',
    category: '기능',
    by: 'sales03',
    byName: '설연주',
    status: 'working',
    updatedAt: '2026-11-19T08:15:00Z',
  },
];

const SAMPLE_LEDGER = {
  updatedAt: '2026-11-19T01:00:00Z',
  radar: { adopt: ['NousResearch/hermes-agent'], trial: ['apache/echarts'], assess: ['headroomlabs-ai/headroom'], hold: [] },
  candidates: [
    {
      title: 'apache/echarts',
      fit: 5,
      fitScore: 9,
      action: '바로 시험',
      why: '2,289행 SSR SVG 15.9ms 시각화 검증 완료',
    },
    {
      title: 'headroomlabs-ai/headroom',
      fit: 4,
      fitScore: 8,
      action: '바로 시험',
      why: 'JSON 배열 토큰 90.9~96.9% 압축 파일럿',
    },
  ],
};

const SAMPLE_TECH_RADAR = {
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

const SAMPLE_DEVICE_HUB = {
  generatedAt: '2026-11-19T08:00:00Z',
  binarySizeKB: 402.5,
  devices: [
    { serial: 'R58M12345AB', ready: true, waitingHuman: false, leaseStatus: 'ACTIVE' },
    { serial: '192.168.0.55:5555', ready: true, waitingHuman: true, leaseStatus: 'WAITING_HUMAN' },
  ],
};

// 1) 6대 에이전트 현황 집계 검증
const liveModel = hubLib.buildCommandHubModel({
  pmOffice: SAMPLE_PM_OFFICE,
  staffRequests: SAMPLE_STAFF_REQUESTS,
  adoptionLedger: SAMPLE_LEDGER,
  techRadar: SAMPLE_TECH_RADAR,
  deviceHub: SAMPLE_DEVICE_HUB,
});

assert.equal(liveModel.agents.length, 6, '6대 에이전트 현황 카드 모두 반환');
assert.deepEqual(
  liveModel.agents.map((a) => a.id),
  ['pm-hermes', 'nenovakakao-worker', 'gabriel-agi', 'tech-radar-pilot', 'orbit-manuals', 'device-rust-sidecar']
);
assert.equal(liveModel.agents[0].statusCode, 'live');
assert.match(liveModel.agents[0].headlineMetric, /열린 과제 2건/);
assert.match(liveModel.agents[1].headlineMetric, /5초.*300초/);
assert.match(liveModel.agents[2].headlineMetric, /기대 이익/);
assert.equal(liveModel.agents[3].statusCode, 'attention', '결재 대기 기술 존재 시 attention 상태');
assert.equal(liveModel.agents[5].statusCode, 'attention', 'WAITING_HUMAN 단말 존재 시 attention 표시');

const staleAgents = hubLib.buildAgentRosterStatus({
  pmOffice: { ...SAMPLE_PM_OFFICE, ageSec: 999 },
});
assert.equal(staleAgents[0].statusCode, 'stale', '300초 초과 시 PM 하트비트 지연 판정');

// 2) PM 원장 필터링 & 검색 검증
assert.ok(liveModel.ledger.length >= 6, 'PM 원장에 tasks + staffRequests + radar 통합');
const approvalRows = hubLib.filterPmActionLedger(liveModel.ledger, 'approval');
const activeRows = hubLib.filterPmActionLedger(liveModel.ledger, 'active');
const doneRows = hubLib.filterPmActionLedger(liveModel.ledger, 'done');
assert.ok(approvalRows.some((r) => r.sourceType === 'pm-task' && /해독/.test(r.title)), '미해결 PM 과제 결재 대기 분류');
assert.ok(approvalRows.some((r) => r.sourceType === 'staff-request' && r.statusCode === 'needs-human'), 'needs-human 요청 결재 대기 분류');
assert.ok(approvalRows.some((r) => r.sourceType === 'tech-radar' && /echarts/.test(r.title)), '레이더 채택 결재 안건 통합');
assert.ok(activeRows.some((r) => r.statusCode === 'verifying'), '검증중 과제 active 분류');
assert.ok(doneRows.some((r) => r.prNumber === '#1880'), '배포된 직원 요청 done 분류');
assert.equal(hubLib.filterPmActionLedger(liveModel.ledger, 'all', '#1880').length, 1, 'PR 번호 검색 동작');

// 3) 연속 디벨롭 펄스 검증
assert.ok(liveModel.pulse.timeline.length >= 7, '오늘 PM 완료 + 최근 PR 타임라인 병합');
assert.equal(liveModel.pulse.timeline[0].source, 'live-pm', '오늘 PM 완료가 타임라인 최상단');
assert.equal(liveModel.pulse.metrics.buildPipelineCounts.total, 11, '11개 연속 구현 파이프라인 집계');
assert.ok(liveModel.pulse.metrics.buildPipelineCounts.LIVE >= 1);
assert.ok(liveModel.pulse.metrics.buildPipelineCounts.READY >= 1);
assert.ok(liveModel.pulse.metrics.weeklyProfitPotentialKRW > 0, '가브리엘 주간 기대 이익 양수');
assert.equal(liveModel.pulse.gabrielTopAlerts.length, 3, '가브리엘 상위 3대 경보');

// 4) 4대 목적별 디렉터리 경로 실존 검증
assert.equal(hubLib.CEO_PAGE_DIRECTORY.length, 4, '4대 목적별 동선 지도');
for (const group of hubLib.CEO_PAGE_DIRECTORY) {
  assert.ok(group.items.length >= 4, `${group.title} 최소 4개 화면`);
  for (const item of group.items) {
    const cleanRoute = item.href.split('?')[0];
    const exists =
      cleanRoute === '/work/command-hub' ||
      fs.existsSync(path.join(root, 'pages', `${cleanRoute.slice(1)}.js`)) ||
      fs.existsSync(path.join(root, 'pages', cleanRoute.slice(1), 'index.js'));
    assert.ok(exists, `CEO_PAGE_DIRECTORY 존재하지 않는 경로: ${item.href}`);
  }
}

// 5) SSR 렌더링 + 한글 고딕 + 금지어/이모지 0건 검증
const ssrHtml = renderToStaticMarkup(
  React.createElement(CeoCommandHub, {
    userId: 'nenovaSS3',
    initialSyncedAt: '2026-11-19T08:30:00Z',
    initialPmOffice: SAMPLE_PM_OFFICE,
    initialStaffRequests: SAMPLE_STAFF_REQUESTS,
    initialAdoptionLedger: SAMPLE_LEDGER,
    initialTechRadar: SAMPLE_TECH_RADAR,
    initialDeviceHub: SAMPLE_DEVICE_HUB,
  })
);

for (const marker of [
  'data-testid="ceo-command-hub"',
  'data-testid="hub-kpi-strip"',
  'data-testid="hub-agent-roster"',
  'data-testid="hub-pm-ledger-table"',
  'data-testid="hub-dev-timeline"',
  'data-testid="hub-build-queue-list"',
  'data-testid="hub-gabriel-alert-list"',
  'data-testid="hub-page-directory"',
  'data-guide-stub="ceo-command-hub"',
]) {
  assert.ok(ssrHtml.includes(marker), `SSR HTML 누락: ${marker}`);
}

const forbiddenRe = /감시|추적|모니터링|절감시간/;
const emojiRe = /[\u{1F300}-\u{1FAFF}]|🚀|✨|💡|🔥|🎯/u;
assert.doesNotMatch(ssrHtml, forbiddenRe, 'SSR HTML 내 금지어 0건');
assert.doesNotMatch(ssrHtml, emojiRe, 'SSR HTML 내 장식 이모지 0건');

for (const rel of [
  'lib/ceoCommandHub.js',
  'components/work/CeoCommandHub.js',
  'pages/work/command-hub.js',
  'styles/CeoCommandHub.module.css',
]) {
  const src = read(rel);
  assert.doesNotMatch(src, forbiddenRe, `${rel} 내 금지어 0건`);
  assert.doesNotMatch(src, emojiRe, `${rel} 내 장식 이모지 0건`);
}

// CSS 폰트 스택, tabular-nums, Anti-AI Slop 규격 검증
const css = read('styles/CeoCommandHub.module.css');
assert.match(css, /'Pretendard Variable'.*'Malgun Gothic',\s*'맑은 고딕'/);
assert.doesNotMatch(css, /\b(?:ui-)?monospace\b/i, '단독 monospace 폴백 금지');
assert.match(css, /font-variant-numeric:\s*tabular-nums/);
assert.doesNotMatch(css, /linear-gradient|radial-gradient/i, '그라디언트 금지');

// 6) 비권한 계정 차단 및 단일 shell 규칙 검증
async function verifyAuthGateAndDesktop() {
  let mockUser = null;
  const pageSrc = read('pages/work/command-hub.js');
  assert.doesNotMatch(pageSrc, /import\s+Layout|<Layout/, '단일 shell 원칙: pages/work/command-hub.js 는 Layout import 금지');

  const pageMod = compile(
    'pages/work/command-hub.js',
    (id, baseReq) => {
      if (id === 'next/head') return { __esModule: true, default: ({ children }) => React.createElement(React.Fragment, null, children) };
      if (id === '../../components/work/CeoCommandHub') return { __esModule: true, default: CeoCommandHub };
      if (id === '../../lib/auth') return { verifyReqUser: async () => mockUser };
      if (id === '../../lib/orbitReportAccess') return compile('lib/orbitReportAccess.js');
      if (id === '../../lib/workFeatureData') return compile('lib/workFeatureData.js');
      if (id === '../../lib/pmStaffRequests') {
        const labels = compile('lib/pmStaffReqLabels.js');
        return compile('lib/pmStaffRequests.js', (subId, subBase) => (subId === './pmStaffReqLabels' ? labels : subBase(subId)));
      }
      return baseReq(id);
    },
    (src) => src.replaceAll('getServerSideProps', 'routeProps')
  );

  mockUser = null;
  assert.deepEqual(await pageMod.routeProps({ req: {}, res: {} }), { notFound: true }, '비로그인 404 차단');
  mockUser = { userId: 'sales01', authority: 2 };
  assert.deepEqual(await pageMod.routeProps({ req: {}, res: {} }), { notFound: true }, '일반 직원 404 차단');
  mockUser = { userId: 'nenovaSS3', authority: 1 };
  const adminRes = await pageMod.routeProps({ req: {}, res: {} });
  assert.equal(adminRes.props.userId, 'nenovaSS3', '관리자(nenovaSS3) 정상 진입');
  const pageRender = renderToStaticMarkup(React.createElement(pageMod.default, adminRes.props));
  assert.ok(pageRender.includes('data-testid="ceo-command-hub"'), '페이지 SSR 정상 렌더');

  // 데스크톱 셸 제1버튼 & Layout 메뉴 연결 확인
  const shellSrc = read('desktop/shell/shell.js');
  assert.match(shellSrc, /pmHubButton\.id = 'pmHubButton'/);
  assert.match(shellSrc, /pmHubButton\.textContent = '통합지휘실'/);
  assert.match(shellSrc, /url: '\/work\/command-hub'/);
  assert.match(
    shellSrc,
    /pmActions\.append\(pmHubButton,\s*pmOpenButton,\s*pmArchButton,\s*pmSimButton,\s*pmRadarButton\)/,
    '제1버튼 #pmHubButton 맨 앞 배치 및 기존 4버튼 보존'
  );
  const layoutSrc = read('components/Layout.js');
  assert.match(layoutSrc, /href: '\/work\/command-hub'[\s\S]*userIds:\s*\['nenovaSS3'\]/);
}

verifyAuthGateAndDesktop()
  .then(() => {
    console.log('ceoCommandHub unit, SSR, gate, font & desktop link tests passed');
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
