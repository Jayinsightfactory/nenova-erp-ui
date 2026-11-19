// __tests__/gabrielProfitAgi.test.js — 가브리엘 수입·원가·이익 최적화 AGI 엔진 · 뷰 A/B/C SSR · Anti-AI Slop 가드 검증.
// 실행: node __tests__/gabrielProfitAgi.test.js (MSSQL·네트워크 불필요)
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
const engine = compile('lib/gabrielProfitAgi.js', (id, baseReq) => {
  if (id === './importOneStopPipeline.js') return pipelineMod;
  if (id === './boxMetricTable.js') return boxMod;
  return baseReq(id);
});

const stubCss = new Proxy({}, { get: (_, prop) => String(prop) });
const stubUseWeekInput = compile('lib/useWeekInput.js');
const stubNavHistory = compile('lib/menuNavigationHistory.js');
const stubGuide = () => null;
const stubLink = ({ href, children, ...rest }) => React.createElement('a', { href: String(href || ''), ...rest }, children);

const Workbench = compile('components/import-tools/GabrielProfitAgiWorkbench.js', (id, baseReq) => {
  if (id === 'next/link') return { __esModule: true, default: stubLink };
  if (id === '../WorkflowGuide') return { __esModule: true, default: stubGuide };
  if (id === '../../lib/useWeekInput') return stubUseWeekInput;
  if (id === '../../lib/menuNavigationHistory') return stubNavHistory;
  if (id === '../../lib/gabrielProfitAgi') return engine;
  if (id.endsWith('.module.css')) return { __esModule: true, default: stubCss };
  return baseReq(id);
}).default;

// 1) 기본 5대 레버 & 4단계 추론 검증
const baseAudit = engine.runGabrielAgiAudit({ orderYear: '2026', orderWeek: '46-01', country: 'ALL' });
assert.equal(baseAudit.dataMode, 'benchmark-fixture');
assert.equal(baseAudit.levers.length, 5, '5대 이익 레버가 모두 산출되어야 함');
assert.ok(baseAudit.summary.totalPotentialProfitKRW > 0, '차수 이익 개선액은 양수');
assert.equal(baseAudit.summary.annualizedProfitKRW, baseAudit.summary.totalPotentialProfitKRW * 52, '52주 연간 환산 일치');
assert.deepEqual(
  baseAudit.agiTrace.map((t) => t.stage),
  ['Observe', 'Diagnose', 'Counterfactual Simulate', 'Propose'],
  '4단계 AGI 추론 파이프라인 순서 보존',
);
assert.equal(baseAudit.fxLadder.length, 7, '환율 스트레스 래더 7구간');

// 2) 단조성 검증 (반사실 파라미터 변화)
// 2-a) 박스 채움률 개선: 0% < 10% < 20%
const fill0 = engine.runGabrielAgiAudit({ simParams: { boxFillGainPct: 0 } }).levers[0].profitGainKRW;
const fill10 = engine.runGabrielAgiAudit({ simParams: { boxFillGainPct: 10 } }).levers[0].profitGainKRW;
const fill20 = engine.runGabrielAgiAudit({ simParams: { boxFillGainPct: 20 } }).levers[0].profitGainKRW;
assert.equal(fill0, 0);
assert.ok(fill0 < fill10 && fill10 < fill20, `박스 채움률 단조 증가: ${fill0} < ${fill10} < ${fill20}`);

// 2-b) 농장 리밸런싱: 0% < 25% < 50%
const reb0 = engine.runGabrielAgiAudit({ simParams: { rebalancePct: 0 } }).levers[1].profitGainKRW;
const reb25 = engine.runGabrielAgiAudit({ simParams: { rebalancePct: 25 } }).levers[1].profitGainKRW;
const reb50 = engine.runGabrielAgiAudit({ simParams: { rebalancePct: 50 } }).levers[1].profitGainKRW;
assert.equal(reb0, 0);
assert.ok(reb0 < reb25 && reb25 < reb50, `농장 리밸런싱 단조 증가: ${reb0} < ${reb25} < ${reb50}`);

// 2-c) 환율 상승(-50 -> 0 -> +80): 무대응 원가 상승 & 무대응 마진 하락
const fxLow = engine.runGabrielAgiAudit({ simParams: { fxDeltaKRW: -50 } });
const fxZero = engine.runGabrielAgiAudit({ simParams: { fxDeltaKRW: 0 } });
const fxHigh = engine.runGabrielAgiAudit({ simParams: { fxDeltaKRW: 80 } });
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

// 2-d) 권장 판가 방어율 (0% < 100%)
const def0 = engine.runGabrielAgiAudit({ simParams: { fxDeltaKRW: 60, marginDefenseRatio: 0 } }).levers[2].profitGainKRW;
const def100 = engine.runGabrielAgiAudit({ simParams: { fxDeltaKRW: 60, marginDefenseRatio: 100 } }).levers[2].profitGainKRW;
assert.equal(def0, 0);
assert.ok(def100 > def0, '마진 방어율 적용 시 방어 이익 증가');

// 2-e) 크레딧 회수 토글
const crOff = engine.runGabrielAgiAudit({ simParams: { creditRecoveryEnabled: false } }).levers[3].profitGainKRW;
const crOn = engine.runGabrielAgiAudit({ simParams: { creditRecoveryEnabled: true } }).levers[3].profitGainKRW;
assert.equal(crOff, 0);
assert.ok(crOn > 0, '크레딧 회수 활성화 시 회수액 반영');

// 3) 국가 필터 및 실데이터 하이브리드 오버레이 검증
const coOnly = engine.runGabrielAgiAudit({ country: 'CO' });
assert.ok(coOnly.skus.length > 0 && coOnly.skus.every((s) => s.countryCode === 'CO'), 'CO 필터 정확성');
const liveMerged = engine.runGabrielAgiAudit({
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
const briefing = engine.buildGabrielExecutiveBriefing(baseAudit);
assert.ok(briefing.includes('2026년 46-01차') && briefing.includes('읽기 전용 분석 결과'), '브리핑 필수 문구');

// 5) 뷰 A · B · C SSR 렌더링 검증
for (const viewMode of ['A', 'B', 'C']) {
  const html = renderToStaticMarkup(React.createElement(Workbench, {
    userId: 'nenovaSS3',
    userName: '사장님',
    initialViewMode: viewMode,
    showGuide: true,
    embedded: viewMode === 'C',
  }));
  assert.ok(html.includes(`data-view="${viewMode}"`), `뷰 ${viewMode} data-view 속성`);
  assert.ok(html.includes('가브리엘 수입·원가·이익 최적화 AGI 워크벤치'), `뷰 ${viewMode} 제목`);
  assert.ok(html.includes('gabriel-copy-briefing'), `뷰 ${viewMode} 브리핑 복사 버튼`);
}
const htmlB = renderToStaticMarkup(React.createElement(Workbench, { initialViewMode: 'B', showGuide: false }));
assert.ok(htmlB.includes('2×2 매트릭스'), '뷰 B 2x2 매트릭스');
const htmlC = renderToStaticMarkup(React.createElement(Workbench, { initialViewMode: 'C', showGuide: false }));
assert.ok(htmlC.includes('환율 스트레스 민감도 래더'), '뷰 C 환율 래더');

// 6) Anti-AI Slop · 금지어 · 단일 Shell · 원장 무쓰기 정적 가드
const targetFiles = [
  'lib/gabrielProfitAgi.js',
  'components/import-tools/GabrielProfitAgiWorkbench.js',
  'styles/GabrielProfitAgi.module.css',
  'pages/import/gabriel-agi.js',
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
const cssSrc = read('styles/GabrielProfitAgi.module.css');
assert.ok(cssSrc.includes('tabular-nums'), 'CSS에 tabular-nums 고정폭 정렬 필수');
assert.ok(!/linear-gradient|radial-gradient/i.test(cssSrc), 'Anti-AI Slop: 그라디언트 금지');

const pageSrc = read('pages/import/gabriel-agi.js');
assert.ok(!/import\s+Layout|<Layout/.test(pageSrc), '단일 shell 원칙: pages/import/gabriel-agi.js 는 Layout import 금지');

// 7) my-work.js 관리자 탭 격리 보존 확인
const myWorkSrc = read('pages/my-work.js');
const tabsStart = myWorkSrc.indexOf('const TABS = mineOnly ?');
const mineOnlyPart = myWorkSrc.slice(tabsStart, myWorkSrc.indexOf(': [', tabsStart));
assert.ok(!mineOnlyPart.includes('gabriel-agi'), 'mineOnly 탭 목록에 gabriel-agi 비노출');
assert.ok(myWorkSrc.includes("{ id: 'gabriel-agi', label: '가브리엘 원가·이익 AGI' }"), '관리자 탭 목록에 gabriel-agi 존재');
assert.ok(myWorkSrc.includes("tab === 'gabriel-agi' && !mineOnly"), 'gabriel-agi 렌더는 !mineOnly 조건');

// 8) G2 담당 파일 무수정 확인 (git diff 확인)
console.log('PASS gabrielProfitAgi: 5 levers, monotonicity, hybrid live overlay, View A/B/C SSR, Anti-AI Slop & banned-words clean');
