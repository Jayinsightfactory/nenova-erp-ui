// __tests__/solutionSuiteSimulator.test.js — 통합 솔루션 시뮬레이터 계약·보안 게이트·모션/실데이터/렌더 단위 테스트.
// 실행: node __tests__/solutionSuiteSimulator.test.js (MSSQL·네트워크 불필요)
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
  if (customRequire) mod.require = customRequire;
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

// 1) 스테이징된 에셋 파일 존재 확인
for (const asset of [
  'public/images/solution-sim/moyi-suite-hero-blueprint.jpg',
  'public/images/solution-sim/phone-harness-device-hub.jpg',
  'public/images/solution-sim/moyi-approval-erp-sync.jpg',
  'data/moyi-full-suite-blueprint.html',
]) {
  const full = path.join(root, asset);
  assert.ok(fs.existsSync(full), `필수 에셋 누락: ${asset}`);
  assert.ok(fs.statSync(full).size > 1024, `에셋 파일 크기 비정상: ${asset}`);
}

// 2) pages/api/my-work/feature.js 보안 게이트 및 suite-blueprint-html 서빙 검증
const featApiSrc = read('pages/api/my-work/feature.js');
assert.ok(!/lib\/db|\b(SELECT|INSERT|UPDATE|DELETE)\s/i.test(featApiSrc), 'feature.js 에 SQL/DB 접근 금지');
assert.ok(
  featApiSrc.indexOf('isOrbitReportViewer(user)') < featApiSrc.indexOf("name === 'suite-blueprint-html'") &&
    featApiSrc.indexOf("name === 'suite-blueprint-html'") < featApiSrc.indexOf('FEATURE_NAMES.includes(name)'),
  'suite-blueprint-html 분기는 권한/GET 검사 이후, FEATURE_NAMES 검사 이전에 위치해야 함'
);

let mockUser = null;
const featHandler = compile('pages/api/my-work/feature.js', (id) => {
  if (id === '../../../lib/auth') return { verifyReqUser: async () => mockUser };
  if (id === '../../../lib/orbitReportAccess') return compile('lib/orbitReportAccess.js');
  if (id === '../../../lib/workFeatureData') return compile('lib/workFeatureData.js');
  return Module.createRequire(path.join(root, 'pages/api/my-work/feature.js'))(id);
}).default;

const makeRes = () => {
  const res = {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(k, v) { res.headers[k.toLowerCase()] = v; },
    status(code) { res.statusCode = code; return res; },
    json(payload) { res.body = payload; return res; },
    send(payload) { res.body = payload; return res; },
  };
  return res;
};

async function runApiTests() {
  // 비로그인 / 일반직원 차단(404 은닉)
  mockUser = null;
  let r = makeRes();
  await featHandler({ method: 'GET', query: { name: 'suite-blueprint-html' } }, r);
  assert.equal(r.statusCode, 404);

  mockUser = { userId: 'sales01', authority: 6 };
  r = makeRes();
  await featHandler({ method: 'GET', query: { name: 'suite-blueprint-html' } }, r);
  assert.equal(r.statusCode, 404);

  // 관리자 POST 차단(405)
  mockUser = { userId: 'nenovaSS3', authority: 1 };
  r = makeRes();
  await featHandler({ method: 'POST', query: { name: 'suite-blueprint-html' } }, r);
  assert.equal(r.statusCode, 405);

  // 관리자 GET ?name=suite-blueprint-html → 200 text/html
  r = makeRes();
  await featHandler({ method: 'GET', query: { name: 'suite-blueprint-html' } }, r);
  assert.equal(r.statusCode, 200);
  assert.equal(r.headers['content-type'], 'text/html; charset=utf-8');
  assert.equal(r.headers['x-frame-options'], 'SAMEORIGIN');
  assert.match(String(r.body), /<!DOCTYPE html>/i);
  assert.match(String(r.body), /MOYI/);

  // 미등록 name → 400
  r = makeRes();
  await featHandler({ method: 'GET', query: { name: 'invalid-name' } }, r);
  assert.equal(r.statusCode, 400);
}

// 3) pages/my-work.js 관리자 경계 & 탭 연결 검증
const myWorkSrc = read('pages/my-work.js');
const tabsIdx = myWorkSrc.indexOf('const TABS = mineOnly ?');
assert.ok(tabsIdx > 0, 'pages/my-work.js TABS 정의 필요');
const mineTabsBlock = myWorkSrc.slice(tabsIdx, myWorkSrc.indexOf(': [', tabsIdx));
assert.doesNotMatch(mineTabsBlock, /suite-sim/, 'mineOnly 탭 목록에는 suite-sim 노출 금지');
assert.match(myWorkSrc, /\{ id: 'suite-sim', label: '통합 솔루션 시뮬레이션' \}/);
assert.match(myWorkSrc, /tab === 'suite-sim' && !mineOnly && <SolutionSuiteSimulator/);

// 4) ArchFlowChart.js 바로가기 버튼 계약
const archSrc = read('components/pm/ArchFlowChart.js');
assert.match(archSrc, /!mineOnly && onSelectTab &&[\s\S]*?<Button[\s\S]*?onSelectTab\('suite-sim'\)[\s\S]*?통합 모션 시뮬레이션 열기 ↗/);

// 5) SolutionSuiteSimulator.js 소스 계약 & 금지어 & SSR 렌더링 검증
const simSrc = read('components/work/SolutionSuiteSimulator.js');
assert.doesNotMatch(simSrc, /감시|추적|모니터링/, '작업자·관리자 UI 문구에 감시·추적·모니터링 금지');
assert.ok(simSrc.includes('prefers-reduced-motion'), 'prefers-reduced-motion 존중 필수');
for (const apiPath of [
  '/api/my-work/feature?name=workflows',
  '/api/my-work/feature?name=simulations',
  '/api/work/orbit-thumbs?user=',
  'records=1',
  '/api/work/orbit-thumbs?img=',
]) {
  assert.ok(simSrc.includes(apiPath), `실데이터 API 연결 누락: ${apiPath}`);
}
assert.ok(simSrc.includes('steps') && simSrc.includes('.box'), 'records steps[].box 바운딩박스 지원 필요');

// 기본 SSR 렌더링
const SimulatorComp = compile('components/work/SolutionSuiteSimulator.js').default;
const ssrHtml = renderToStaticMarkup(React.createElement(SimulatorComp, { orbit: 'https://orbit.example', orbitQs: '' }));
assert.match(ssrHtml, /data-testid="solution-suite-simulator"/);
assert.match(ssrHtml, /viewBox="0 0 980 340"/);
assert.match(ssrHtml, /수작업 18\.5분 ➔ 자동화\+MOYI 승인 14초 · 98\.7% 단축/);
for (const token of [
  '01 Phone Harness · 카톡 수집',
  '02 Device Hub · 30fps Lease',
  '03 Rust 사이드카 · hermes-core',
  '04 Hermes AI · 3단위 환산',
  '05 MOYI 앱 · 승인 게이트',
  '06 네노바웹 · MSSQL 원장',
  'dedup_key',
  'ProdKey=1042',
  'OutQuantity=100',
  'ApprovedBy',
  'BEGIN TRAN UPDLOCK',
  '/images/solution-sim/moyi-suite-hero-blueprint.jpg',
  '/images/solution-sim/phone-harness-device-hub.jpg',
  '/images/solution-sim/moyi-approval-erp-sync.jpg',
  '/api/my-work/feature?name=suite-blueprint-html',
]) {
  assert.ok(ssrHtml.includes(token), `SSR HTML에 핵심 요소 누락: ${token}`);
}

// Step 5 (MOYI 승인 카드) + Archify 탭 + Orbit records steps[].box 바운딩박스 상태 렌더링 검증
const overrideByInit = (overrides) => {
  const MockComp = compile('components/work/SolutionSuiteSimulator.js', (id) => {
    if (id === 'react') {
      return {
        ...React,
        useState(init) {
          if (overrides.records && init && typeof init === 'object' && 'records' in init) {
            return [{ loading: false, records: overrides.records, error: '' }, () => {}];
          }
          if (overrides.items && init && typeof init === 'object' && 'items' in init) {
            return [{ loading: false, items: overrides.items, error: '', mode: 'live' }, () => {}];
          }
          if (Object.hasOwn(overrides, String(init))) return [overrides[String(init)], () => {}];
          return [init, () => {}];
        },
        useEffect() {},
        useMemo: (fn) => fn(),
        useRef: (v) => ({ current: v }),
      };
    }
    return Module.createRequire(path.join(root, 'components/work/SolutionSuiteSimulator.js'))(id);
  }).default;
  return renderToStaticMarkup(React.createElement(MockComp, {}));
};

const step5ArchifyHtml = overrideByInit({
  '0': 4,
  blueprints: 'archify',
  items: [{ id: 'ev-101', timestamp: '2026-11-18T06:00:00Z', app: 'nenova', screen: '신규주문등록' }],
  records: [{ id: 'rec-101', timestamp: '2026-11-18T06:00:00Z', app: 'nenova', screen: '주문입력', steps: [{ box: [120, 240, 520, 440], label: '프리덤 100단', order: 1 }] }],
});
assert.match(step5ArchifyHtml, /\[✓ MOYI 승인 실행\]/, 'Step 5 에서 인터랙티브 MOYI 승인 버튼 렌더링');
assert.match(step5ArchifyHtml, /<iframe[^>]+title="통합 솔루션 인터랙티브 설계도"[^>]+src="\/api\/my-work\/feature\?name=suite-blueprint-html"/, 'Archify 탭 iframe 렌더링');
assert.match(step5ArchifyHtml, /\/api\/work\/orbit-thumbs\?img=rec-101/, '실작업 기록 캡처 이미지 렌더링');
assert.match(step5ArchifyHtml, /left:12%;top:24%;width:40%;height:20%/, 'steps[].box 천분율 좌표 -> % 바운딩박스 변환 렌더링');
assert.match(step5ArchifyHtml, /프리덤 100단/, '바운딩박스 라벨 렌더링');

// 6) 데스크톱 셸(shell.js) · 데스크톱 메뉴(Layout.js) 연결 계약
const shellSrc = read('desktop/shell/shell.js');
assert.match(shellSrc, /pmSimButton\.id = 'pmSimButton'/);
assert.match(shellSrc, /url: '\/my-work\?tab=suite-sim'/);
assert.match(shellSrc, /pmRadarButton\.id = 'pmRadarButton'/);
assert.match(shellSrc, /url: '\/my-work\?tab=radar'/);
const layoutSrc = read('components/Layout.js');
assert.match(layoutSrc, /href: '\/my-work\?tab=suite-sim'[\s\S]*userIds:\s*\['nenovaSS3'\]/);

runApiTests()
  .then(() => {
    console.log('solutionSuiteSimulator contract & SSR tests passed');
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
