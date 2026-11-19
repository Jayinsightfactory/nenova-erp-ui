// __tests__/adoptionRadar.test.js — /my-work '도입 레이더' 탭: 관리자(isOrbitReportViewer) 에게만 노출·읽기, 파일 전용(MSSQL 무관) + 에디토리얼 라이트 쉘 검증.
// 실행: node __tests__/adoptionRadar.test.js  (DB 불필요, 소스 문자열 + 접근 판별 함수 + SSR 검사)
const assert = require('assert');
const fs = require('fs');
const Module = require('module');
const path = require('path');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { transformSync } = require('next/dist/build/swc');

const cwd = process.cwd();
const read = (p) => fs.readFileSync(path.join(cwd, p), 'utf8');

function compile(rel, customRequire) {
  const filename = path.join(cwd, rel);
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

// 1) 관리자 판별: 기존 lib/orbitReportAccess 그대로 재사용(새 권한 체계 없음)
const accessSrc = read('lib/orbitReportAccess.js').replace(/^export (const|function) /gm, '$1 ') + '\nmodule.exports = { ORBIT_REPORT_USER_IDS, isOrbitReportViewer };';
const tmpMod = path.join(require('os').tmpdir(), 'orbitReportAccess-' + process.pid + '.cjs');
fs.writeFileSync(tmpMod, accessSrc);
const { isOrbitReportViewer } = require(tmpMod);
fs.unlinkSync(tmpMod);
assert.strictEqual(isOrbitReportViewer({ userId: 'nenovaSS3' }), true, '사장 계정은 관리자');
assert.strictEqual(isOrbitReportViewer({ userId: 'NENOVASS3' }), true, '대소문자 무시');
assert.strictEqual(isOrbitReportViewer({ userId: 'admin' }), false, "'admin' 은 /my-work 관리자 아님(화이트리스트만)");
assert.strictEqual(isOrbitReportViewer({ userId: 'nenova01' }), false);
assert.strictEqual(isOrbitReportViewer(null), false);

// 2) 페이지: 탭은 관리자 목록에만 있고(mineOnly 목록엔 없음), 렌더도 !mineOnly 조건
const page = read('pages/my-work.js');
const tabsStart = page.indexOf('const TABS = mineOnly ?');
assert.ok(tabsStart > 0, 'TABS 정의');
const mineOnlyList = page.slice(tabsStart, page.indexOf(': [', tabsStart));
assert.ok(!/radar/.test(mineOnlyList), 'mineOnly(관리자 아님) 탭 목록에 radar 없음');
assert.ok(/\{ id: 'radar', label: '도입 레이더' \}/.test(page), '관리자 탭 목록에 도입 레이더');
assert.ok(/tab === 'radar' && !mineOnly && <RadarTab \/>/.test(page), 'radar 렌더는 !mineOnly 조건');
assert.ok(/useFeature\('adoption-ledger'\)/.test(page), '데이터는 /api/my-work/feature?name=adoption-ledger 로');
// SSR: 관리자 아니면 mineOnly:true + tab:'mine' 고정(?tab=radar 로 들어와도 radar 안 뜸)
assert.ok(/if \(!isOrbitReportViewer\(user\)\) \{[\s\S]*?mineOnly: true[\s\S]*?tab: 'mine'/.test(page), '비관리자 SSR 은 mineOnly·tab=mine 고정');

// 3) API: 같은 게이트(404 은닉) + adoption-ledger 허용 + 캐시 5분
const api = read('pages/api/my-work/feature.js');
assert.ok(/if \(!isOrbitReportViewer\(user\)\) return res\.status\(404\)/.test(api), '/api/my-work/feature 비관리자 404');
assert.ok(/name === 'adoption-ledger' \? 'private, max-age=300'/.test(api), '도입 레이더 캐시 5분');
assert.ok(!/\b(SELECT|INSERT|UPDATE|DELETE)\s/i.test(api) && !/lib\/db/.test(api), 'DB 접근 없음');

// 4) 수신: 기존 feature-data-ingest(토큰) 재사용 — lib 가 adoption-ledger 를 안다
const lib = read('lib/workFeatureData.js');
assert.ok(/FEATURE_NAMES\s*=\s*Object\.freeze\(\[[^\]]*'adoption-ledger'/.test(lib), 'FEATURE_NAMES 에 adoption-ledger');
assert.ok(/name === 'adoption-ledger' \? 'adoption-ledger\.json'/.test(lib), '파일명 adoption-ledger.json');

// 5) 런타임 파일은 git 미추적
assert.ok(/^data\/runtime\/$/m.test(read('.gitignore')), '.gitignore data/runtime/');

// 6) 에디토리얼 라이트 쉘 · 도입레이더 정화 검증 (구형 다크 껍데기 제거 + mode="clear" + 아카이브 기본 접힘)
assert.ok(/<TechRadarWorkbench[\s\S]*mode="clear"[\s\S]*initialPlanMode="A"/.test(page), '도입레이더는 첫 화면에 mode="clear" initialPlanMode="A" 로 즉시 렌더');
assert.ok(!/<TechRadarWorkbench[\s\S]*mode="dark"/.test(page), '도입레이더는 기본 dark 강제 금지');
assert.ok(page.includes('원장 로우데이터 및 일별 자가조율 로그 열람'), '구형 원장/자가수정 로그는 접이식 아카이브로 수납');
assert.doesNotMatch(page, /#0e1016|#12151c|#171a21|#1f2430|#58a6ff/i, 'pages/my-work.js 구형 다크 쉘 잔재 제거 필수');
assert.doesNotMatch(page, /linear-gradient|radial-gradient/i, 'Anti-AI Slop: 그라디언트 장식 금지');
assert.doesNotMatch(page, /감시|추적|모니터링|절감시간/, '금지어 포함 금지');
assert.ok(page.includes('prefers-reduced-motion'), 'prefers-reduced-motion 준수 필수');
assert.ok(page.includes('tabular-nums'), 'tabular-nums 고정폭 숫자 정렬 필수');

// 7) SSR 검증: ?tab=radar 진입 시 TechRadarWorkbench(clear/A) 최상단 노출, 구형 SelfTuneReport/원장 기본 비노출
const pmUiMod = compile('components/pm/ui.js');
const pmSimMod = compile('lib/pmTechRadarSim.js');
const pmTokensMod = compile('lib/pmRadarPlanTokens.js');
const trwMod = compile('components/pm/TechRadarWorkbench.js', (id, baseReq) => {
  if (id === './ui') return pmUiMod;
  if (id === '../../lib/pmTechRadarSim') return pmSimMod;
  if (id === '../../lib/pmRadarPlanTokens') return pmTokensMod;
  return baseReq(id);
});
const archMod = compile('components/pm/ArchFlowChart.js', (id, baseReq) => {
  if (id === './ui') return pmUiMod;
  return baseReq(id);
});
const MyWorkPage = compile('pages/my-work.js', (id, baseReq) => {
  if (id === 'next/router') return { useRouter: () => ({ query: { tab: 'radar' }, isReady: true, push: () => {} }) };
  if (id === '../components/MenuBackButton') return () => React.createElement('button', { type: 'button', className: 'nv-back' }, '뒤로가기');
  if (id === '../components/pm/ArchFlowChart') return archMod;
  if (id === '../components/pm/TechRadarWorkbench') return trwMod;
  if (id === '../components/import-tools/GabrielProfitAgiWorkbench') return () => null;
  if (id === '../components/work/SolutionSuiteSimulator') return () => null;
  if (id === '../components/work/DeviceHubConsole') return () => null;
  if (id === '../lib/auth') return { verifyReqUser: async () => null };
  if (id === '../lib/orbitReportAccess') return compile('lib/orbitReportAccess.js');
  if (id === '../lib/workFlowOwners') return { workflowOwnerOf: () => null };
  if (id === '../lib/workFeatureData') return compile('lib/workFeatureData.js');
  return baseReq(id);
}).default;

const radarPageHtml = renderToStaticMarkup(React.createElement(MyWorkPage, { userId: 'nenovaSS3', orbit: 'https://orbit.example', tab: 'radar', mineOnly: false }));
assert.ok(radarPageHtml.includes('data-testid="tech-radar-workbench"'), 'radar 탭 첫 화면에 TechRadarWorkbench 렌더링');
assert.ok(radarPageHtml.includes('data-wb-mode="clear"'), 'radar 탭 clear 모드 전달 확인');
assert.ok(radarPageHtml.includes('data-plan-mode="A"'), 'radar 탭 기본 시안 A 렌더링');
assert.ok(radarPageHtml.includes('data-testid="radar-ledger-archive"'), '원장 아카이브 섹션 렌더링');
assert.ok(radarPageHtml.includes('aria-expanded="false"'), '원장 아카이브 기본 접힘 상태');
assert.ok(!radarPageHtml.includes('도입 장부 상세 원장'), '기본 화면에서 구형 원장 테이블 숨김');
assert.ok(!radarPageHtml.includes('자가수정 보고'), '기본 화면에서 구형 자가수정 보고 숨김');

const archPageHtml = renderToStaticMarkup(React.createElement(MyWorkPage, { userId: 'nenovaSS3', orbit: 'https://orbit.example', tab: 'arch', mineOnly: false }));
assert.ok(archPageHtml.includes('data-testid="arch-flow-chart"'), 'arch 탭 ArchFlowChart 렌더링');
assert.ok(!archPageHtml.includes('#0e1016'), '에디토리얼 라이트 쉘에 구형 다크 색 미포함');

console.log('adoptionRadar tests passed: 관리자 판별 재사용·탭 비노출·API 게이트·캐시·파일 전용·에디토리얼 라이트 쉘·SSR');
