// __tests__/importCostAgi.test.js — 전사 10대 원가·이익 레버(L1~L10) · 데이터 계보 · 부서 매트릭스 · 뷰 A/B/C/ALL SSR · Anti-AI Slop 가드 검증.
// 실행: node __tests__/importCostAgi.test.js (MSSQL·네트워크 불필요)
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

const pipelineMod = compile('lib/importOneStopPipeline.js', (id, baseReq) => {
  if (id === './orderWeekDate.js') return compile('lib/orderWeekDate.js');
  return baseReq(id);
});
const boxMod = compile('lib/boxMetricTable.js');
const engine = compile('lib/importCostAgi.js', (id, baseReq) => {
  if (id === './importOneStopPipeline.js') return pipelineMod;
  if (id === './boxMetricTable.js') return boxMod;
  return baseReq(id);
});

const stubCss = new Proxy({}, { get: (_, prop) => String(prop) });
const stubUseWeekInput = compile('lib/useWeekInput.js');
const stubNavHistory = compile('lib/menuNavigationHistory.js');
const stubGuide = () => null;
const stubLink = ({ href, children, ...rest }) => React.createElement('a', { href: String(href || ''), ...rest }, children);

const Workbench = compile('components/import-tools/ImportCostAgiWorkbench.js', (id, baseReq) => {
  if (id === 'next/link') return { __esModule: true, default: stubLink };
  if (id === '../WorkflowGuide') return { __esModule: true, default: stubGuide };
  if (id === '../../lib/useWeekInput') return stubUseWeekInput;
  if (id === '../../lib/menuNavigationHistory') return stubNavHistory;
  if (id === '../../lib/importCostAgi') return engine;
  if (id.endsWith('.module.css')) return { __esModule: true, default: stubCss };
  return baseReq(id);
}).default;

// 1) 전사 10대 레버(L1~L10) · 구조 데이터(상황/SVG도해/4원천/4부서/연속구현) · 4단계 추론 검증
const baseAudit = engine.runCostAgiAudit({ orderYear: '2026', orderWeek: '46-01', country: 'ALL' });
assert.equal(baseAudit.dataMode, 'benchmark-fixture');
assert.equal(baseAudit.levers.length, 10, '전사 10대 이익 레버(L1~L10)가 모두 산출되어야 함');
assert.deepEqual(
  baseAudit.levers.map((l) => l.code),
  ['L1', 'L2', 'L3', 'L4', 'L5', 'L6', 'L7', 'L8', 'L9', 'L10'],
  '레버 코드 L1~L10 순서 보존',
);

const REQUIRED_DEPTS = ['수입부', '영업부', '출고·창고팀', '경영지원·정산부'];
const VALID_STAGES = new Set(['LIVE', 'BUILDING', 'SPEC_READY']);
for (const lv of baseAudit.levers) {
  assert.ok(lv.story?.analogySummary && lv.story?.beforeScene && lv.story?.afterScene, `${lv.code}: 상황(story) 필드 필수`);
  assert.equal(lv.visualDiagram?.nodes?.length, 5, `${lv.code}: SVG 도해 5단계 노드 필수`);
  assert.ok(lv.visualDiagram?.waterfall && Number.isFinite(lv.visualDiagram.waterfall.recoveryPct), `${lv.code}: 워터폴 수치 필수`);
  assert.ok(lv.dataBasis?.emailSource && lv.dataBasis?.staffSource && lv.dataBasis?.counterpartySource && lv.dataBasis?.criterionRule, `${lv.code}: 4원천 데이터 계보(dataBasis) 필수`);
  const depts = (lv.departmentTasks || []).map((t) => t.dept);
  for (const d of REQUIRED_DEPTS) {
    assert.ok(depts.includes(d), `${lv.code}: 부서별 업무 매트릭스에 "${d}" 포함 필수`);
  }
  for (const task of lv.departmentTasks) {
    assert.ok(task.role && task.action && task.timing && task.screenLabel && task.href.startsWith('/'), `${lv.code} ${task.dept}: 유효한 역할·조치·화면 링크 필요`);
  }
  assert.ok(lv.continuousBuildModule?.moduleId && VALID_STAGES.has(lv.continuousBuildModule?.stage), `${lv.code}: 연속구현 모듈 및 유효 단계 필수`);
  assert.ok(lv.continuousBuildModule?.implementationBrief?.length > 20, `${lv.code}: 구현 작업지시서 문구 필요`);
}

assert.equal(baseAudit.continuousBuildQueue.length, 10, '연속구현 큐 10개 모듈 생성');
assert.ok(baseAudit.summary.totalPotentialProfitKRW > 0, '차수 이익 개선액은 양수');
assert.equal(baseAudit.summary.annualizedProfitKRW, baseAudit.summary.totalPotentialProfitKRW * 52, '52주 연간 환산 일치');
assert.deepEqual(
  baseAudit.agiTrace.map((t) => t.stage),
  ['Observe', 'Diagnose', 'Counterfactual Simulate', 'Propose'],
  '4단계 AGI 추론 파이프라인 순서 보존',
);
assert.equal(baseAudit.fxLadder.length, 7, '환율 스트레스 래더 7구간');

// 2) 단조성 검증 (반사실 파라미터 변화: L1~L10 전 구간)
// 2-a) L1 박스 채움률 개선: 0% < 10% < 20%
const fill0 = engine.runCostAgiAudit({ simParams: { boxFillGainPct: 0 } }).levers[0].profitGainKRW;
const fill10 = engine.runCostAgiAudit({ simParams: { boxFillGainPct: 10 } }).levers[0].profitGainKRW;
const fill20 = engine.runCostAgiAudit({ simParams: { boxFillGainPct: 20 } }).levers[0].profitGainKRW;
assert.equal(fill0, 0);
assert.ok(fill0 < fill10 && fill10 < fill20, `L1 박스 채움률 단조 증가: ${fill0} < ${fill10} < ${fill20}`);

// 2-b) L2 농장 리밸런싱: 0% < 25% < 50%
const reb0 = engine.runCostAgiAudit({ simParams: { rebalancePct: 0 } }).levers[1].profitGainKRW;
const reb25 = engine.runCostAgiAudit({ simParams: { rebalancePct: 25 } }).levers[1].profitGainKRW;
const reb50 = engine.runCostAgiAudit({ simParams: { rebalancePct: 50 } }).levers[1].profitGainKRW;
assert.equal(reb0, 0);
assert.ok(reb0 < reb25 && reb25 < reb50, `L2 농장 리밸런싱 단조 증가: ${reb0} < ${reb25} < ${reb50}`);

// 2-c) 환율 상승(-50 -> 0 -> +80): 무대응 원가 상승 & 무대응 마진 하락
const fxLow = engine.runCostAgiAudit({ simParams: { fxDeltaKRW: -50 } });
const fxZero = engine.runCostAgiAudit({ simParams: { fxDeltaKRW: 0 } });
const fxHigh = engine.runCostAgiAudit({ simParams: { fxDeltaKRW: 80 } });
assert.ok(
  fxLow.summary.totalShockedUnhedgedCostKRW < fxZero.summary.totalShockedUnhedgedCostKRW
  && fxZero.summary.totalShockedUnhedgedCostKRW < fxHigh.summary.totalShockedUnhedgedCostKRW,
  '환율 상승 시 무대응 도착원가 단조 증가',
);
assert.ok(
  fxLow.summary.unhedgedMarginPct > fxZero.summary.unhedgedMarginPct
  && fxZero.summary.unhedgedMarginPct > fxHigh.summary.unhedgedMarginPct,
  '환율 상승 시 무대응 마진 단조 하락',
);

// 2-d) L3 권장 판가 방어율 (0% < 100%)
const def0 = engine.runCostAgiAudit({ simParams: { fxDeltaKRW: 60, marginDefenseRatio: 0 } }).levers[2].profitGainKRW;
const def100 = engine.runCostAgiAudit({ simParams: { fxDeltaKRW: 60, marginDefenseRatio: 100 } }).levers[2].profitGainKRW;
assert.equal(def0, 0);
assert.ok(def100 > def0, 'L3 마진 방어율 적용 시 방어 이익 증가');

// 2-e) L4 크레딧 회수 토글
const crOff = engine.runCostAgiAudit({ simParams: { creditRecoveryEnabled: false } }).levers[3].profitGainKRW;
const crOn = engine.runCostAgiAudit({ simParams: { creditRecoveryEnabled: true } }).levers[3].profitGainKRW;
assert.equal(crOff, 0);
assert.ok(crOn > 0, 'L4 크레딧 회수 활성화 시 회수액 반영');

// 2-f) L6 외화 송금 분할 방어 (0% < 50% < 100%)
const l6Zero = engine.runCostAgiAudit({ simParams: { fxSplitSchedulePct: 0 } }).levers[5].profitGainKRW;
const l6Mid = engine.runCostAgiAudit({ simParams: { fxSplitSchedulePct: 50 } }).levers[5].profitGainKRW;
const l6Full = engine.runCostAgiAudit({ simParams: { fxSplitSchedulePct: 100 } }).levers[5].profitGainKRW;
assert.equal(l6Zero, 0);
assert.ok(l6Zero < l6Mid && l6Mid < l6Full, `L6 송금분할 단조 증가: ${l6Zero} < ${l6Mid} < ${l6Full}`);

// 2-g) L7 체화재고 조기 소진 (0% < 50% < 100%)
const l7Zero = engine.runCostAgiAudit({ simParams: { agedStockClearRatio: 0 } }).levers[6].profitGainKRW;
const l7Mid = engine.runCostAgiAudit({ simParams: { agedStockClearRatio: 50 } }).levers[6].profitGainKRW;
const l7Full = engine.runCostAgiAudit({ simParams: { agedStockClearRatio: 100 } }).levers[6].profitGainKRW;
assert.equal(l7Zero, 0);
assert.ok(l7Zero < l7Mid && l7Mid < l7Full, `L7 체화재고 단조 증가: ${l7Zero} < ${l7Mid} < ${l7Full}`);

// 2-h) L8 거래처 실질 공헌이익 배분 (0% < 50% < 100%)
const l8Zero = engine.runCostAgiAudit({ simParams: { customerAllocRatio: 0 } }).levers[7].profitGainKRW;
const l8Mid = engine.runCostAgiAudit({ simParams: { customerAllocRatio: 50 } }).levers[7].profitGainKRW;
const l8Full = engine.runCostAgiAudit({ simParams: { customerAllocRatio: 100 } }).levers[7].profitGainKRW;
assert.equal(l8Zero, 0);
assert.ok(l8Zero < l8Mid && l8Mid < l8Full, `L8 공헌이익 배분 단조 증가: ${l8Zero} < ${l8Mid} < ${l8Full}`);

// 2-i) L9 카톡 추가취소 컷오프 & L10 통관·보세·용차 대사 토글
const l9Off = engine.runCostAgiAudit({ simParams: { cutoffGuardEnabled: false } }).levers[8].profitGainKRW;
const l9On = engine.runCostAgiAudit({ simParams: { cutoffGuardEnabled: true } }).levers[8].profitGainKRW;
assert.equal(l9Off, 0);
assert.ok(l9On > 0, 'L9 카톡 추가취소 컷오프 방어 활성화');

const l10Off = engine.runCostAgiAudit({ simParams: { customsRateAuditEnabled: false } }).levers[9].profitGainKRW;
const l10On = engine.runCostAgiAudit({ simParams: { customsRateAuditEnabled: true } }).levers[9].profitGainKRW;
assert.equal(l10Off, 0);
assert.ok(l10On > 0, 'L10 통관·보세·용차 대사 활성화');

// 2-j) Zero 비교 프리셋(전 레버 비활성 시 총 개선액 = 0)
const zeroAll = engine.runCostAgiAudit({
  simParams: {
    fxDeltaKRW: 0,
    rebalancePct: 0,
    boxFillGainPct: 0,
    marginDefenseRatio: 0,
    targetMarginPct: 18,
    creditRecoveryEnabled: false,
    fxSplitSchedulePct: 0,
    agedStockClearRatio: 0,
    customerAllocRatio: 0,
    cutoffGuardEnabled: false,
    customsRateAuditEnabled: false,
  },
});
assert.equal(zeroAll.summary.totalPotentialProfitKRW, 0, '미적용(0%) 비교 시 10대 레버 합산 개선액 = 0');

// 3) 국가 필터 및 실데이터 하이브리드 오버레이 검증
const coOnly = engine.runCostAgiAudit({ country: 'CO' });
assert.ok(coOnly.skus.length > 0 && coOnly.skus.every((s) => s.countryCode === 'CO'), 'CO 필터 정확성');
const liveMerged = engine.runCostAgiAudit({
  orderYear: '2026',
  orderWeek: '46-01',
  country: 'ALL',
  apiData: {
    exchange: { currencies: [{ currencyCode: 'USD', exchangeRate: 1410 }, { currencyCode: 'EUR', exchangeRate: 1525 }] },
    arrivalCosts: [
      {
        arrivalLineKey: 7001,
        prodKey: 9001,
        displayName: '실전산 콜롬비아 수국 화이트',
        countryName: '콜롬비아',
        farmName: 'Turflor',
        unit: '송이',
        quantity: 800,
        selectedArrivalCostKRW: 3420,
        fobUSD: 1.45,
        freightPerUnitUSD: 0.72,
      },
    ],
    awbcalc: [
      { awb: '176-11112222', box: 20, gw: 270, cw: 280, rate: 5.15, farms: [{ farm: 'Turflor', box: 20 }] },
    ],
    lista: [
      { key: 801, farm: 'Turflor', variedad: 'hydrangea white', cantidad: 120, unidad: 'tallos', confirmed: true, credited: false },
    ],
  },
});
assert.equal(liveMerged.dataMode, 'live-plus-model');
assert.equal(liveMerged.fx.USD, 1410);
assert.equal(liveMerged.dataCounts.liveSkuCount, 1);
assert.equal(liveMerged.dataCounts.liveAwbCount, 1);
assert.equal(liveMerged.dataCounts.liveClaimCount, 1);

// 4) 브리핑 생성기 검증
const briefing = engine.buildCostAgiExecutiveBriefing(baseAudit);
assert.ok(briefing.includes('2026년 46-01차') && briefing.includes('읽기 전용 분석 결과') && briefing.includes('10대 원가·이익 레버'), '브리핑 필수 문구');

// 5) 뷰 A · B · C · ALL SSR 렌더링 검증
for (const viewMode of ['A', 'B', 'C', 'ALL']) {
  const html = renderToStaticMarkup(React.createElement(Workbench, {
    userId: 'nenovaSS3',
    userName: '사장님',
    initialViewMode: viewMode,
    showGuide: true,
    embedded: viewMode === 'C',
  }));
  assert.ok(html.includes(`data-view="${viewMode}"`), `뷰 ${viewMode} data-view 속성`);
  assert.ok(html.includes('수입 원가·이익 AGI 워크벤치'), `뷰 ${viewMode} 제목`);
  assert.ok(html.includes('cost-agi-purpose-callout'), `뷰 ${viewMode} 최상단 핵심 목적 Callout`);
  assert.ok(html.includes('cost-agi-lever-purpose-callout'), `뷰 ${viewMode} 레버별 핵심 목적 Callout`);
  assert.ok(html.includes('핵심 목적 · PURPOSE'), `뷰 ${viewMode} PURPOSE 문구`);
  assert.ok(html.includes('cost-agi-copy-briefing'), `뷰 ${viewMode} 브리핑 복사 버튼`);
  assert.ok(html.includes('cost-agi-lever-story-diagram'), `뷰 ${viewMode} 스토리·그림·계보 패널`);
  assert.ok(html.includes('cost-agi-lever-svg-diagram'), `뷰 ${viewMode} 실시간 트레이스 SVG 도면`);
  assert.ok(html.includes('cost-agi-trace-auto-toggle'), `뷰 ${viewMode} AUTO 1x 재생 토글`);
  assert.ok(html.includes('cost-agi-trace-stage-detail'), `뷰 ${viewMode} 선택 단계 상세 패널`);
  for (const stepNo of ['01', '02', '03', '04', '05', '06']) {
    assert.ok(html.includes(`cost-agi-trace-node-${stepNo}`), `뷰 ${viewMode} 트레이스 ${stepNo}단계 카드`);
  }
  assert.ok(html.includes('data-stage-state="done"'), `뷰 ${viewMode} 완료 상태 카드`);
  assert.ok(html.includes('data-stage-state="running"'), `뷰 ${viewMode} 실행 중 상태 카드`);
  assert.ok(html.includes('data-stage-state="pending"'), `뷰 ${viewMode} 대기 상태 카드`);
  assert.ok(html.includes('직교 연계 버스'), `뷰 ${viewMode} 독립 레인 직교 연계 버스`);
  assert.ok(html.includes('cost-agi-lever-data-basis'), `뷰 ${viewMode} 4원천 출처 표`);
  assert.ok(html.includes('cost-agi-lever-dept-table'), `뷰 ${viewMode} 부서별 업무 표`);
}
const htmlB = renderToStaticMarkup(React.createElement(Workbench, { initialViewMode: 'B', showGuide: false }));
assert.ok(htmlB.includes('2×2 매트릭스'), '뷰 B 2x2 매트릭스');
const htmlC = renderToStaticMarkup(React.createElement(Workbench, { initialViewMode: 'C', showGuide: false }));
assert.ok(htmlC.includes('환율 스트레스 민감도 래더'), '뷰 C 환율 래더');
const htmlAll = renderToStaticMarkup(React.createElement(Workbench, { initialViewMode: 'ALL', showGuide: false }));
assert.ok(htmlAll.includes('cost-agi-all-mode'), '뷰 ALL 동시모드 컨테이너');
assert.ok(htmlAll.includes('cost-agi-all-panel-A'), '뷰 ALL 패널 A');
assert.ok(htmlAll.includes('cost-agi-all-panel-B'), '뷰 ALL 패널 B');
assert.ok(htmlAll.includes('cost-agi-all-panel-C'), '뷰 ALL 패널 C');
assert.ok(htmlAll.includes('cost-agi-continuous-build-queue'), '뷰 ALL 연속구현 파이프라인 큐');
assert.ok(htmlAll.includes('구현 작업지시서 복사'), '뷰 ALL 작업지시서 복사 버튼');

// 6) Anti-AI Slop · 금지어 · 단일 Shell · 원장 무쓰기 정적 가드
const targetFiles = [
  'lib/importCostAgi.js',
  'components/import-tools/ImportCostAgiWorkbench.js',
  'styles/ImportCostAgi.module.css',
  'pages/import/cost-agi.js',
];
const BANNED = ['감시', '추적', '모니터링', '근태', '성실', '야근', '피로', '게으', '절감시간', '초격차', '심리스', '차세대 혁신', '스마트한 경험'];
const EMOJI_RE = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;

for (const file of targetFiles) {
  const src = read(file);
  for (const word of BANNED) {
    assert.ok(!src.includes(word), `${file}: 금지어 "${word}" 포함 금지`);
  }
  assert.ok(!EMOJI_RE.test(src), `${file}: 장식 이모지 금지`);
}
const cssSrc = read('styles/ImportCostAgi.module.css');
assert.ok(cssSrc.includes('tabular-nums'), 'CSS에 tabular-nums 고정폭 정렬 필수');
assert.ok(cssSrc.includes('Malgun Gothic') && cssSrc.includes('Pretendard'), 'CSS에 Pretendard/Malgun Gothic 한글 고딕 스택 필수 (굴림체 폴백 금지)');
assert.ok(!/\bmonospace\b/i.test(cssSrc), 'CSS에 단독 monospace 폴백 금지 (Windows 굴림체 방지)');
assert.ok(cssSrc.includes('stroke-dashoffset') && cssSrc.includes('prefers-reduced-motion'), 'CSS에 실시간 점선 모션(stroke-dashoffset) 및 prefers-reduced-motion 준수 필수');
assert.ok(!/linear-gradient|radial-gradient/i.test(cssSrc), 'Anti-AI Slop: 그라디언트 금지');

const pageSrc = read('pages/import/cost-agi.js');
assert.ok(!/import\s+Layout|<Layout/.test(pageSrc), '단일 shell 원칙: pages/import/cost-agi.js 는 Layout import 금지');
assert.ok(pageSrc.includes("'ALL'"), 'pages/import/cost-agi.js 에서 ?view=ALL 지원');

// 7) my-work.js 관리자 탭 격리 보존 확인
const myWorkSrc = read('pages/my-work.js');
const tabsStart = myWorkSrc.indexOf('const TABS = mineOnly ?');
const mineOnlyPart = myWorkSrc.slice(tabsStart, myWorkSrc.indexOf(': [', tabsStart));
assert.ok(!mineOnlyPart.includes('cost-agi'), 'mineOnly 탭 목록에 cost-agi 비노출');
assert.ok(myWorkSrc.includes("{ id: 'cost-agi', label: '수입 원가·이익 AGI' }"), '관리자 탭 목록에 cost-agi 존재');
assert.ok(myWorkSrc.includes("tab === 'cost-agi' && !mineOnly"), 'cost-agi 렌더는 !mineOnly 조건');

console.log('PASS importCostAgi: 10 levers (L1~L10), 4-source lineage, 4-dept matrix, View A/B/C/ALL SSR, monotonicity, Anti-AI Slop clean');
