// __tests__/techRadarSimulator.test.js — 도입·기술 레이더 워크벤치 & nenovakakao 실설계 파이프라인 시뮬레이터 단위·SSR 검증.
// 실행: node __tests__/techRadarSimulator.test.js (MSSQL·네트워크 불필요)
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { transformSync } = require('next/dist/build/swc');

const root = process.cwd();
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

function compile(rel, customRequire) {
  const filename = path.join(root, rel);
  const mod = new Module(filename, module);
  mod.filename = filename;
  mod.paths = Module._nodeModulePaths(path.dirname(filename));
  const baseRequire = Module.createRequire(filename);
  mod.require = (id) => (customRequire ? customRequire(id, baseRequire) : baseRequire(id));
  const { code } = transformSync(fs.readFileSync(filename, 'utf8'), {
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

const pmSimMod = compile('lib/pmTechRadarSim.js');
const simMod = compile('lib/techRadarSimEngine.js', (id, baseReq) => {
  if (id === './pmTechRadarSim') return pmSimMod;
  return baseReq(id);
});

const SAMPLE_LEDGER = {
  baselineDate: '2026-10-07',
  updatedAt: '2026-11-18T12:00:00Z',
  radar: {
    adopt: ['Claude Code skills·hooks'],
    trial: ['self-tune 자기성장'],
    assess: ['OpenAI Codex 신기능'],
    hold: ['유료 API 워커'],
  },
  experiments: [
    { id: 'exp-005', name: 'Hermes Agent 오케스트레이션', metric: 'skillsSynced', ring: 'trial', status: 'trial' },
  ],
  candidates: [
    {
      title: 'NousResearch/hermes-agent',
      fit: 5,
      fitScore: 9,
      action: 'trial',
      verdict: '적용완료',
      why: '97/97 SKILL.md 합성(73ms), 91.1% 로그 압축',
    },
    {
      title: 'headroomlabs-ai/headroom',
      fit: 4,
      action: 'assess',
      why: 'JSON 배열 토큰 90.9~96.9% 압축',
    },
  ],
};

const SAMPLE_TECH_RADAR = {
  generatedAt: '2026-11-19T00:00:00Z',
  rounds: [
    {
      id: '2026-11-19',
      generatedAt: '2026-11-19T00:00:00Z',
      posted: 5,
      items: [
        {
          name: 'NousResearch/hermes-agent',
          url: 'https://github.com/NousResearch/hermes-agent',
          stars: 264281,
          language: 'Python',
          systems: ['AI 자동화', 'Orbit'],
          score: 9,
          action: '바로 시험',
          track: 'interest',
          summary: '에이전트 자가학습 및 세션 구조',
          pilotResult: { score: 9, verdict: 'pass', summary: '97/97 SKILL.md(73ms), 91.1% 압축' },
        },
        {
          name: 'xerj-org/xerj',
          url: 'https://github.com/xerj-org/xerj',
          stars: 19239,
          language: 'Rust',
          systems: ['Orbit', 'AI 자동화'],
          score: 6,
          action: '바로 시험',
          track: 'interest',
          summary: '단일 Rust 바이너리 로그·문서 검색',
          pilotResult: { score: 6, summary: '검색 1.1ms (grep 270ms 대비 250배)' },
        },
        {
          name: 'apache/echarts',
          url: 'https://github.com/apache/echarts',
          stars: 63000,
          language: 'TypeScript',
          systems: ['네노바웹'],
          score: 6,
          action: '바로 시험',
          track: 'interest',
          summary: 'SSR SVG 지원 차트 라이브러리',
          pilotResult: { score: 6, summary: '2,289행 합계 100% 일치(231,060), 15.9ms 렌더' },
        },
        {
          name: 'headroomlabs-ai/headroom',
          url: 'https://github.com/headroomlabs-ai/headroom',
          stars: 74533,
          language: 'Python',
          systems: ['AI 자동화', 'Orbit'],
          score: 6,
          action: '바로 시험',
          track: 'interest',
          summary: '도구 출력 및 JSON 컨텍스트 압축',
          pilotResult: { score: 6, summary: 'screen.analyzed 96.9% · 혼합 JSON 90.9% 절감' },
        },
        {
          name: 'custom-org/moyi-relay-probe',
          url: 'https://github.com/custom-org/moyi-relay-probe',
          stars: 410,
          language: 'TypeScript',
          systems: ['MOYI'],
          score: 7,
          action: '관찰',
          track: 'interest',
          summary: 'MOYI 메시지 큐 상태 점검 보조',
        },
      ],
    },
  ],
};

// 1) 정규화: 관리자 vs 전직원 격리
const adminItems = simMod.normalizeRadarCatalog({ ledger: SAMPLE_LEDGER, techRadar: SAMPLE_TECH_RADAR, adminMode: true });
const staffItems = simMod.normalizeRadarCatalog({ ledger: SAMPLE_LEDGER, techRadar: SAMPLE_TECH_RADAR, adminMode: false });
assert.ok(adminItems.some((x) => x.name === '유료 API 워커'), '관리자 뷰는 adoption-ledger 항목 포함');
assert.ok(!staffItems.some((x) => x.name === '유료 API 워커'), '전직원 뷰는 adoption-ledger 내부 항목 비노출');
assert.ok(!staffItems.some((x) => x.needsApproval), '전직원 뷰는 결정대기 플래그 비노출');
assert.ok(adminItems.some((x) => x.name === 'apache/echarts' && x.needsApproval), '관리자 뷰는 실측완료 미결재 항목 결정대기 표시');

// 2) 4분면 극좌표 & 2x2 매트릭스 결정론 및 범위 검증
const polarA = simMod.computePolarCoordinates(adminItems);
const polarB = simMod.computePolarCoordinates(adminItems);
assert.deepStrictEqual(polarA, polarB, '극좌표 배치는 렌더링 간 완전 결정론적이어야 함');
for (const pt of polarA) {
  assert.ok(Number.isFinite(pt.x) && Number.isFinite(pt.y), '극좌표 유한 숫자');
  const dist = Math.hypot(pt.x - 320, pt.y - 320);
  assert.ok(dist <= 265 && dist >= 10, `반경 범위 확인(${pt.name}: ${dist})`);
}

const matrix = simMod.computeMatrixCoordinates(adminItems);
for (const m of matrix) {
  assert.ok(m.readiness >= 0 && m.readiness <= 100, '준비도 0~100 범위');
  assert.ok(m.impact >= 0 && m.impact <= 100, '임팩트 0~100 범위');
  assert.ok(m.zoneLabel.length > 0);
}

// 3) 실설계 6대 노드 시뮬레이션 검증 (정확 매칭 + 임의 기술 매핑)
assert.equal(simMod.ARCH_SURFACE_NODES.length, 6, '실설계 6대 표면 노드');
const hermesSim = simMod.simulateRadarItem(adminItems.find((x) => x.name === 'NousResearch/hermes-agent'));
assert.equal(hermesSim.matchType, 'exact-scenario');
assert.ok(hermesSim.nodeDetails.some((n) => n.artifact.includes('moyi_inbound') || n.roleAfter.includes('mindmap_sink')));
assert.ok(hermesSim.metrics.some((m) => m.beforeLabel.includes('27.5') && m.afterLabel.includes('2.4')));
assert.equal(hermesSim.safetyChecks.length, 4);

const rustSim = simMod.simulateRadarItem(adminItems.find((x) => x.name === 'xerj-org/xerj'));
assert.equal(rustSim.matchType, 'exact-scenario');
assert.ok(rustSim.nodeDetails.some((n) => n.artifact.includes('nenova-device-sidecar.exe')));
assert.ok(rustSim.metrics.some((m) => m.afterLabel.includes('0.007 ms')));

const echartsSim = simMod.simulateRadarItem(adminItems.find((x) => x.name === 'apache/echarts'));
assert.equal(echartsSim.matchType, 'exact-scenario');
assert.ok(echartsSim.metrics.some((m) => m.afterLabel.includes('15.9 ms')));

const dynamicSim = simMod.simulateRadarItem(staffItems.find((x) => x.name === 'custom-org/moyi-relay-probe'));
assert.equal(dynamicSim.matchType, 'quadrant-mapped');
assert.equal(dynamicSim.nodeDetails.length, 6);
assert.ok(dynamicSim.steps.length >= 2);

// 4) Anti-AI Slop · 금지어 · #hex · raw <button> 소스 가드
const HEX = /(^|[^&\w$])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b/;
const FORBIDDEN_WORDS = /감시|추적|모니터링|절감시간/;
const FORBIDDEN_EMOJIS = /[🚀✨💡🔥🎯🌐🛰️🧪✅🔁⏳📍📦🔍]/u;

for (const file of [
  'lib/pmTechRadarSim.js',
  'lib/techRadarSimEngine.js',
  'components/pm/TechRadarWorkbench.js',
  'pages/pm/radar.js',
  'components/work/SolutionSuiteSimulator.js',
]) {
  const src = read(file);
  assert.doesNotMatch(src, FORBIDDEN_WORDS, `${file}: 금지어(감시/추적/모니터링/절감시간) 포함 금지`);
  if (file !== 'components/work/SolutionSuiteSimulator.js') {
    assert.doesNotMatch(src, FORBIDDEN_EMOJIS, `${file}: 장식용 이모지 포함 금지`);
    assert.doesNotMatch(src, /<button[\s>]/, `${file}: raw <button> 금지`);
    src.split(/\r?\n/).forEach((line, idx) => {
      assert.ok(!HEX.test(line), `${file}:${idx + 1}: #hex 하드코딩 금지 -> ${line.trim()}`);
    });
  }
}

const wbSrc = read('components/pm/TechRadarWorkbench.js');
assert.ok(wbSrc.includes('tabular-nums'), 'TechRadarWorkbench tabular-nums 적용');
assert.ok(wbSrc.includes('prefers-reduced-motion'), 'TechRadarWorkbench reduced-motion 준수');

// 5) SSR 렌더링 검증 (관리자 워크벤치 + 전직원 /pm/radar + SolutionSuiteSimulator 연동)
const WorkbenchComp = compile('components/pm/TechRadarWorkbench.js', (id, baseReq) => {
  if (id === './ui') return compile('components/pm/ui.js');
  if (id === '../../lib/pmTechRadarSim') return pmSimMod;
  return baseReq(id);
}).default;

const adminHtml = renderToStaticMarkup(
  React.createElement(WorkbenchComp, {
    ledger: SAMPLE_LEDGER,
    techRadar: SAMPLE_TECH_RADAR,
    isAdmin: true,
    mode: 'dark',
    standaloneUiStyles: true,
    onOpenSuiteSim: () => {},
  })
);
assert.match(adminHtml, /data-testid="tech-radar-workbench"/);
assert.match(adminHtml, /data-testid="radar-architecture-simulator"/);
assert.match(adminHtml, /viewBox="0 0 640 640"/);
assert.match(adminHtml, /결정 대기 실측/);
assert.match(adminHtml, /시뮬레이션 검수/);
assert.match(adminHtml, /통합 솔루션 시뮬레이터 열기/);
assert.match(adminHtml, /운영PC nenovakakao/);
assert.match(adminHtml, /core\/moyi_worker\.py/);
for (const m of adminHtml.matchAll(/<button\b([^>]*)>/g)) {
  assert.match(m[1], /\bpmk\b/, `모든 렌더된 버튼은 pm ui 키트(pmk)여야 함: ${m[0]}`);
}

const staffHtml = renderToStaticMarkup(
  React.createElement(WorkbenchComp, {
    ledger: SAMPLE_LEDGER,
    techRadar: SAMPLE_TECH_RADAR,
    isAdmin: false,
    mode: 'clear',
    standaloneUiStyles: false,
  })
);
assert.match(staffHtml, /data-testid="tech-radar-workbench"/);
assert.match(staffHtml, /core\/moyi_inbound\.py/);
assert.doesNotMatch(staffHtml, /결정 대기 실측/);
assert.doesNotMatch(staffHtml, /유료 API 워커/);
assert.doesNotMatch(staffHtml, FORBIDDEN_WORDS);

const SimComp = compile('components/work/SolutionSuiteSimulator.js').default;
const suiteHtml = renderToStaticMarkup(React.createElement(SimComp, { orbit: 'https://orbit.example', orbitQs: '' }));
for (const token of ['moyi-worker', 'mindmap_sink', 'browser_session_bridge', 'com.nenovakakao.sales_session', 'core/self_update.py', '/my-work?tab=radar']) {
  assert.ok(suiteHtml.includes(token), `SolutionSuiteSimulator SSR 실설계 토큰 누락: ${token}`);
}

console.log('techRadarSimulator tests passed: 극좌표/매트릭스 결정론·6노드 실설계 시뮬·Anti-AI Slop·SSR 검증 완료');
