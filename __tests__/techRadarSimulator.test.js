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
const pmPlanTokensMod = compile('lib/pmRadarPlanTokens.js');
const simMod = compile('lib/techRadarSimEngine.js', (id, baseReq) => {
  if (id === './pmTechRadarSim') return pmSimMod;
  if (id === './pmRadarPlanTokens') return pmPlanTokensMod;
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

// 3-1) 가브리엘 수입·원가·이익 추론 AGI 시나리오 & 프리셋 6종 검증
assert.equal(simMod.SIM_PRESETS.length, 6, '핵심 시나리오 프리셋 6종');
const gabrielTarget = simMod.resolvePresetTarget('gabriel-import-profit-agi', adminItems);
assert.equal(gabrielTarget.scenarioId, 'gabriel-import-profit-agi');
const gabrielSim = simMod.simulateRadarItem(gabrielTarget.item, { scenarioId: gabrielTarget.scenarioId });
assert.equal(gabrielSim.scenarioId, 'gabriel-import-profit-agi');
assert.equal(gabrielSim.matchType, 'exact-scenario');
assert.deepEqual(gabrielSim.activeNodes, ['N1', 'N4', 'N5', 'N6']);
assert.equal(gabrielSim.primaryNode, 'N4');
assert.ok(gabrielSim.links.some((l) => l.href === '/import/gabriel-agi'), '가브리엘 AGI 페이지 링크 포함');
assert.ok(gabrielSim.links.some((l) => l.href === '/import/pipeline'), '수입 파이프라인 링크 포함');
assert.ok(gabrielSim.steps.some((s) => s.packetSummary.includes('AWB 중량구간') && s.packetSummary.includes('불량크레딧')));
assert.ok(gabrielSim.metrics.some((m) => m.beforeLabel.includes('38.0%') && m.afterLabel.includes('96.5%')));
assert.ok(gabrielSim.metrics.some((m) => m.beforeLabel.includes('18.0 h') && m.afterLabel.includes('0.4 h')));

// 3-2) 모든 시나리오에 상황/결과, 데이터 4원천(이메일/담당자/거래처/판정기준), 4대 부서 연결표 포함 검증
assert.equal(simMod.RADAR_DEPARTMENTS.length, 5, '전사 + 4대 부서 필터 정의');
assert.equal(simMod.BUILD_PIPELINE_STAGES.length, 4, '연속구현 4단계 상태 정의');
const expectedDepts = ['수입부', '영업부', '출고·창고팀', '경영지원·정산부'];
for (const sc of simMod.SIM_SCENARIOS) {
  assert.ok(sc.executiveBrief?.situation?.length > 10, `${sc.id}: executiveBrief.situation 필수`);
  assert.ok(sc.executiveBrief?.outcome?.length > 10, `${sc.id}: executiveBrief.outcome 필수`);
  assert.ok(sc.dataOrigins?.emailDoc?.length > 5, `${sc.id}: dataOrigins.emailDoc 필수`);
  assert.ok(sc.dataOrigins?.staffInput?.length > 5, `${sc.id}: dataOrigins.staffInput 필수`);
  assert.ok(sc.dataOrigins?.partnerData?.length > 5, `${sc.id}: dataOrigins.partnerData 필수`);
  assert.ok(sc.dataOrigins?.thresholdRule?.length > 5, `${sc.id}: dataOrigins.thresholdRule 필수`);
  assert.equal(sc.departmentMatrix?.length, 4, `${sc.id}: 4대 부서 연결표`);
  for (const dName of expectedDepts) {
    const row = sc.departmentMatrix.find((r) => r.deptName === dName);
    assert.ok(row && row.roleChange?.length > 5 && String(row.route || '').startsWith('/'), `${sc.id}: ${dName} 업무·경로 필수`);
  }
}
for (const simResult of [hermesSim, rustSim, echartsSim, dynamicSim, gabrielSim]) {
  assert.ok(simResult.executiveBrief?.situation && simResult.executiveBrief?.outcome);
  assert.ok(simResult.dataOrigins?.emailDoc && simResult.dataOrigins?.staffInput && simResult.dataOrigins?.partnerData && simResult.dataOrigins?.thresholdRule);
  assert.equal(simResult.departmentMatrix?.length, 4);
}

// 3-3) 연속 구현 파이프라인(CONTINUOUS_BUILD_PIPELINE & deriveNextBuildItems) 8종 이상 검증
assert.ok(simMod.CONTINUOUS_BUILD_PIPELINE.length >= 8, '고효율·고수익 연속 구현 모듈 후보 8종 이상');
const scenarioIds = new Set(simMod.SIM_SCENARIOS.map((s) => s.id));
for (const b of simMod.CONTINUOUS_BUILD_PIPELINE) {
  assert.ok(['LIVE', 'PILOT', 'READY', 'DISCOVERED'].includes(b.status), `${b.code}: 유효한 파이프라인 상태`);
  assert.ok(b.expectedImpact?.length > 10, `${b.code}: expectedImpact 필수`);
  assert.ok(b.dataBasisSummary?.includes('이메일') && b.dataBasisSummary?.includes('담당자') && b.dataBasisSummary?.includes('거래처'), `${b.code}: 이메일/담당자/거래처 기준 요약`);
  assert.ok(Array.isArray(b.departments) && b.departments.length >= 1, `${b.code}: departments 필수`);
  assert.ok(scenarioIds.has(b.linkedScenarioId), `${b.code}: linkedScenarioId(${b.linkedScenarioId}) 유효성`);
  assert.ok(b.agentBriefText?.includes(b.code) && b.agentBriefText?.includes(b.title), `${b.code}: agentBriefText 실행 지시서 문구`);
}
for (const reqTerm of ['295품목(13,815주문행)', '232건', 'Proforma', 'APTA E1', '146품목', 'D+3/D+5', '공헌이익', '49개 농장', '가브리엘 10대 레버']) {
  assert.ok(
    simMod.CONTINUOUS_BUILD_PIPELINE.some((b) => b.title.includes(reqTerm)),
    `필수 연속구현 과제 키워드 누락: ${reqTerm}`
  );
}
const importBuildItems = simMod.deriveNextBuildItems({ dept: '수입부' });
assert.ok(importBuildItems.length >= 6 && importBuildItems.every((b) => b.departments.includes('import')));
const readyBuildItems = simMod.deriveNextBuildItems({ stage: 'READY' });
assert.equal(readyBuildItems.length, 4, 'READY 즉시구현가능 4종 검증');
const aptaItems = simMod.deriveNextBuildItems({ query: 'APTA' });
assert.equal(aptaItems.length, 1);
const buildSummary = simMod.summarizeBuildPipeline();
assert.equal(
  buildSummary.byStage.LIVE + buildSummary.byStage.PILOT + buildSummary.byStage.READY + buildSummary.byStage.DISCOVERED,
  buildSummary.total
);

// buildItemId 연계 시뮬레이션 검증
const zeroUnitSim = simMod.simulateRadarItem(null, { buildItemId: 'build-zero-unit-295-skus' });
assert.equal(zeroUnitSim.linkedBuildItem?.code, 'BLD-05');
assert.ok(zeroUnitSim.dataOrigins.thresholdRule.includes('295품목'));
assert.ok(zeroUnitSim.executiveBrief.situation.includes('BLD-05'));

// 4) Anti-AI Slop · 금지어 · #hex · raw <button> 소스 가드
const HEX = /(^|[^&\w$])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b/;
const FORBIDDEN_WORDS = /감시|추적|모니터링|절감시간/;
const FORBIDDEN_EMOJIS = /[🚀✨💡🔥🎯🌐🛰️🧪✅🔁⏳📍📦🔍]/u;

for (const file of [
  'lib/pmRadarPlanTokens.js',
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
assert.ok(wbSrc.includes("window.addEventListener('keydown'"), '시안 C 키보드 단축키 이벤트 핸들러 등록');

// 5) SSR 렌더링 검증 (시안 A·B·C·ALL 4모드 + 관리자/전직원 격리 + SolutionSuiteSimulator 연동)
const WorkbenchComp = compile('components/pm/TechRadarWorkbench.js', (id, baseReq) => {
  if (id === './ui') return compile('components/pm/ui.js');
  if (id === '../../lib/pmTechRadarSim') return pmSimMod;
  if (id === '../../lib/pmRadarPlanTokens') return pmPlanTokensMod;
  return baseReq(id);
}).default;

const assertButtonsUsePmKit = (html, label) => {
  for (const m of html.matchAll(/<button\b([^>]*)>/g)) {
    assert.match(m[1], /\bpmk\b/, `${label}: 모든 렌더된 버튼은 pm ui 키트(pmk)여야 함: ${m[0]}`);
  }
};

const adminHtml = renderToStaticMarkup(
  React.createElement(WorkbenchComp, {
    ledger: SAMPLE_LEDGER,
    techRadar: SAMPLE_TECH_RADAR,
    isAdmin: true,
    mode: 'dark',
    standaloneUiStyles: true,
    onOpenSuiteSim: () => {},
    initialPlanMode: 'A',
  })
);
assert.match(adminHtml, /data-testid="tech-radar-workbench"/);
assert.match(adminHtml, /data-testid="radar-plan-switcher"/);
assert.match(adminHtml, /data-testid="radar-scenario-presets"/);
assert.match(adminHtml, /data-testid="radar-plan-view-A"/);
assert.match(adminHtml, /data-testid="radar-architecture-simulator"/);
assert.match(adminHtml, /viewBox="0 0 640 640"/);
assert.match(adminHtml, /결정 대기 실측/);
assert.match(adminHtml, /시뮬레이션 검수/);
assert.match(adminHtml, /통합 솔루션 시뮬레이터 열기/);
assert.match(adminHtml, /운영PC nenovakakao/);
assert.match(adminHtml, /core\/moyi_worker\.py/);
assert.match(adminHtml, /가브리엘 원가·이익 AGI/);
assert.doesNotMatch(adminHtml, FORBIDDEN_WORDS);
assertButtonsUsePmKit(adminHtml, 'Plan A Admin');

// 신규 회차 ▲ (<polygon) 렌더링 확인 (2개 이상 회차 데이터)
const multiRoundRadar = {
  generatedAt: '2026-11-19T00:00:00Z',
  rounds: [
    SAMPLE_TECH_RADAR.rounds[0],
    {
      id: '2026-11-15',
      items: [{ name: 'old-org/legacy-tool', stars: 100, language: 'Python', score: 6, action: '관찰', track: 'interest' }],
    },
  ],
};
const multiRoundHtml = renderToStaticMarkup(
  React.createElement(WorkbenchComp, {
    ledger: SAMPLE_LEDGER,
    techRadar: multiRoundRadar,
    isAdmin: true,
    initialPlanMode: 'A',
  })
);
assert.match(multiRoundHtml, /<polygon\s+points=/, '신규 회차 Blip은 ▲ 삼각형(<polygon>)으로 렌더링');

// 시안 B SSR 검증
const planBHtml = renderToStaticMarkup(
  React.createElement(WorkbenchComp, {
    ledger: SAMPLE_LEDGER,
    techRadar: SAMPLE_TECH_RADAR,
    isAdmin: true,
    initialPlanMode: 'B',
  })
);
assert.match(planBHtml, /data-testid="radar-plan-view-B"/);
assert.match(planBHtml, /data-testid="radar-architecture-simulator"/);
assert.match(planBHtml, /viewBox="0 0 640 420"/);
assert.match(planBHtml, /EVIDENCE &amp; SIMULATION INSPECTOR SHEET/);
assert.match(planBHtml, /전체 평가 기술/);
assert.match(planBHtml, /정식채택 · 파일럿/);
assert.match(planBHtml, /파일럿 실측 비율/);
assert.doesNotMatch(planBHtml, FORBIDDEN_WORDS);
assertButtonsUsePmKit(planBHtml, 'Plan B');

// 시안 C SSR 검증 (매트 카본 다크 + 단축키 + 4단계 파이프라인 + 벤치마크 표 + 전술 콘솔)
const planCHtml = renderToStaticMarkup(
  React.createElement(WorkbenchComp, {
    ledger: SAMPLE_LEDGER,
    techRadar: SAMPLE_TECH_RADAR,
    isAdmin: true,
    initialPlanMode: 'C',
  })
);
assert.match(planCHtml, /data-testid="radar-plan-view-C"/);
assert.match(planCHtml, /data-testid="radar-c-shortcuts"/);
assert.match(planCHtml, /data-testid="radar-architecture-simulator"/);
assert.match(planCHtml, /rgb\(17, 19, 21\)/, '시안 C 매트 카본 배경 토큰 주입');
assert.match(planCHtml, /4단계 도입 게이트 파이프라인/);
assert.match(planCHtml, /SCANNED/);
assert.match(planCHtml, /PILOT/);
assert.match(planCHtml, /CANARY/);
assert.match(planCHtml, /ADOPTED/);
assert.match(planCHtml, /Before \/ After 정량 벤치마크 대조 테이블/);
assert.match(planCHtml, /6대 실설계 노드 전술 패킷 트레이스 콘솔/);
assert.match(planCHtml, /도메인\(Q1~Q4\) 그룹별 마스터 엔지니어링 원장/);
assert.doesNotMatch(planCHtml, FORBIDDEN_WORDS);
assertButtonsUsePmKit(planCHtml, 'Plan C');

// A·B·C 3종 동시 비교(ALL) SSR 검증 (+ 상황·흐름 그림·4원천·부서표·연속구현 파이프라인)
const planAllHtml = renderToStaticMarkup(
  React.createElement(WorkbenchComp, {
    ledger: SAMPLE_LEDGER,
    techRadar: SAMPLE_TECH_RADAR,
    isAdmin: true,
    initialPlanMode: 'ALL',
  })
);
assert.match(planAllHtml, /data-testid="radar-plan-view-ALL"/);
assert.match(planAllHtml, /data-testid="radar-all-master-controls"/);
assert.match(planAllHtml, /data-testid="radar-department-filter"/);
assert.match(planAllHtml, /data-testid="radar-executive-story-board"/);
assert.match(planAllHtml, /data-testid="radar-flow-diagram"/);
assert.match(planAllHtml, /viewBox="0 0 960 216"/);
assert.match(planAllHtml, /data-testid="radar-data-origins-table"/);
assert.match(planAllHtml, /data-testid="radar-department-matrix-table"/);
assert.match(planAllHtml, /data-testid="radar-continuous-build-queue"/);
assert.match(planAllHtml, /data-testid="radar-build-queue-table"/);
assert.match(planAllHtml, /data-testid="radar-compare-panel-A"/);
assert.match(planAllHtml, /data-testid="radar-compare-panel-B"/);
assert.match(planAllHtml, /data-testid="radar-compare-panel-C"/);
assert.match(planAllHtml, /viewBox="0 0 640 640"/);
assert.match(planAllHtml, /viewBox="0 0 640 420"/);
assert.match(planAllHtml, /4단계 도입 게이트 파이프라인/);
assert.match(planAllHtml, /전체 시안 동시 재생/);
for (const token of [
  '전사 전체',
  '수입부',
  '영업부',
  '출고·창고',
  '경영지원·정산',
  '출고·창고팀',
  '경영지원·정산부',
  '이메일 · 외부 첨부서류',
  '사내 담당자 · 카톡 원문',
  '해외 농장 · 국내 거래처',
  '제로유닛 295품목(13,815주문행)',
  '미확정 불량차감(232건)',
  '중국 APTA E1 협정세율',
  'A·B·C 3종 동시 시뮬레이션으로 미리 재생',
  '이 기능 구현 지시서 복사',
  '실전가동',
  '파일럿검증',
  '즉시구현가능',
  '신규발굴',
]) {
  assert.ok(planAllHtml.includes(token), `Plan ALL SSR 필수 항목 누락: ${token}`);
}
assert.doesNotMatch(planAllHtml, FORBIDDEN_WORDS);
assertButtonsUsePmKit(planAllHtml, 'Plan ALL');

// 부서 관점 필터(수입부) SSR 하이라이트 검증
const deptImportHtml = renderToStaticMarkup(
  React.createElement(WorkbenchComp, {
    ledger: SAMPLE_LEDGER,
    techRadar: SAMPLE_TECH_RADAR,
    isAdmin: true,
    initialPlanMode: 'ALL',
    initialDepartment: 'import',
  })
);
assert.match(deptImportHtml, /관점: 수입부/);
assert.match(deptImportHtml, /부서: 수입부/);
assert.match(deptImportHtml, /is-dept-match/);
assert.doesNotMatch(deptImportHtml, FORBIDDEN_WORDS);
assertButtonsUsePmKit(deptImportHtml, 'Plan ALL Import Dept');

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
assert.match(staffHtml, /data-testid="radar-executive-story-board"/);
assert.match(staffHtml, /data-testid="radar-continuous-build-queue"/);
assert.match(staffHtml, /core\/moyi_inbound\.py/);
assert.doesNotMatch(staffHtml, /결정 대기 실측/);
assert.doesNotMatch(staffHtml, /유료 API 워커/);
assert.doesNotMatch(staffHtml, FORBIDDEN_WORDS);

const SimComp = compile('components/work/SolutionSuiteSimulator.js').default;
const suiteHtml = renderToStaticMarkup(React.createElement(SimComp, { orbit: 'https://orbit.example', orbitQs: '' }));
for (const token of ['moyi-worker', 'mindmap_sink', 'browser_session_bridge', 'com.nenovakakao.sales_session', 'core/self_update.py', '/my-work?tab=radar']) {
  assert.ok(suiteHtml.includes(token), `SolutionSuiteSimulator SSR 실설계 토큰 누락: ${token}`);
}

console.log('techRadarSimulator tests passed: 시안 A·B·C·ALL 4모드·부서관점·데이터4원천·SVG흐름·연속구현파이프라인·Anti-AI Slop·SSR 검증 완료');
