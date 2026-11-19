// __tests__/archFlowChart.test.js — /my-work '아키텍처 흐름도' 탭, /pm 아키텍처 토글, 데스크톱 셸 업데이트/PM 버튼 계약 검사.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { transformSync } = require('next/dist/build/swc');

const root = process.cwd();
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

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

const comp = read('components/pm/ArchFlowChart.js');
assert.match(comp, /export default function ArchFlowChart/);
for (const loopId of ['detail', 'heal', 'pipeline', 'roundtrip']) {
  assert.match(comp, new RegExp(`id:\\s*'${loopId}'`), `ArchFlowChart must include loop ${loopId}`);
}
assert.match(comp, /인보이스.*입고.*도착원가/, '연속 파이프라인 압축 사례 포함');
assert.match(comp, /분배.*주문등록/, '왕복 우회동작(A→B→A) 흡수 설계 사례 포함');
for (const tbl of ['OrderMaster', 'OrderDetail', 'ShipmentMaster', 'ShipmentDetail', 'WarehouseMaster', 'ViewShipment', 'WebProfitReport', 'assertWebSchemaContract', 'data/runtime', 'work-feature-workflows.json', 'adoption-ledger.json']) {
  assert.ok(comp.includes(tbl), `ArchFlowChart must include schema reference: ${tbl}`);
}
for (const hermesToken of ['arch-hermes-section', 'NousResearch/hermes-agent', 'hermes-manager.js', 'Session Rescue', 'Trajectory Compressor', 'Procedural Skill']) {
  assert.ok(comp.includes(hermesToken), `ArchFlowChart must include Hermes orchestration reference: ${hermesToken}`);
}
assert.ok(comp.includes('arch-solution-blueprints'), 'ArchFlowChart must include arch-solution-blueprints section');
assert.ok(comp.includes('SOLUTION_BLUEPRINTS'), 'ArchFlowChart must define SOLUTION_BLUEPRINTS');
for (const bpId of ['master', 'order_ship', 'import_cost', 'stock_profit']) {
  assert.match(comp, new RegExp(`id:\\s*'${bpId}'`), `ArchFlowChart must include blueprint ${bpId}`);
}
for (const itemExample of ['콜롬비아 장미 프리덤', '네덜란드 수국', '유오디아 블랙잭', '솔루션']) {
  assert.ok(comp.includes(itemExample), `ArchFlowChart must include solution blueprint token: ${itemExample}`);
}
assert.ok(comp.includes('arch-device-suite-section'), 'ArchFlowChart must include arch-device-suite-section');
assert.ok(comp.includes('DEVICE_SUITE_SESSIONS'), 'ArchFlowChart must define DEVICE_SUITE_SESSIONS');
for (const suiteToken of ['Phone Harness', 'Device Hub', 'Nenova Kakao', 'WebDeviceNode', 'WebDeviceLease', 'WebDeviceWorkQueue']) {
  assert.ok(comp.includes(suiteToken), `ArchFlowChart must include device suite token: ${suiteToken}`);
}
for (const sessId of ['s1_phone_hub', 's2_kakao_bridge', 's3_desktop_hub', 's4_web_solution']) {
  assert.match(comp, new RegExp(`id:\\s*'${sessId}'`), `ArchFlowChart must include device suite session ${sessId}`);
}
for (const rustToken of ['arch-rust-hotpaths', 'hermes-core.exe', 'nenova-device-sidecar.exe', 'Rust']) {
  assert.ok(comp.includes(rustToken), `ArchFlowChart must include Rust hotpath token: ${rustToken}`);
}
assert.ok(comp.includes("onSelectTab('suite-sim')") && comp.includes('통합 모션 시뮬레이션 열기 ↗'), 'ArchFlowChart must link to suite-sim');
assert.ok(comp.includes('arch-vision-feasibility'), 'ArchFlowChart must include arch-vision-feasibility section');
assert.ok(comp.includes('VISION_MASTER_STAGES') && comp.includes('FEASIBILITY_ITEMS'), 'ArchFlowChart must define vision stages and feasibility matrix');
for (const phaseId of ['p0', 'p1', 'p2', 'p3']) {
  assert.match(comp, new RegExp(`id:\\s*'${phaseId}'`), `ArchFlowChart must include vision phase ${phaseId}`);
}
for (const vfToken of [
  '즉시 자동 가능',
  '조건부 가능',
  '불가능 · 절대 금지',
  '오늘 해결 전환',
  '은행 이체 자동실행',
  '이카운트 쓰기',
  '캡차 우회',
  '개인방 수집',
  'Windows 단독 iOS 미러링',
  'WAITING_HUMAN',
  'Dual-Path',
]) {
  assert.ok(comp.includes(vfToken), `ArchFlowChart must include feasibility token: ${vfToken}`);
}
assert.doesNotMatch(comp, /감시|추적|모니터링/, '작업자 노출 문구에 감시·추적·모니터링 금지');
assert.doesNotMatch(comp, /절감시간/, '합성어 절감시간 금지');
assert.doesNotMatch(comp, /<button[\s>]/, 'PM UI 키트 규칙: raw <button> 금지');
assert.doesNotMatch(comp, /#[0-9a-fA-F]{3,8}\b/, 'PM 색 가드: #hex 하드코딩 금지');
assert.doesNotMatch(comp, /rgb\(\s*14\s*,\s*16\s*,\s*22\s*\)/, 'Anti-AI Slop: 구형 다크 배경 rgb(14,16,22) 금지');
assert.doesNotMatch(comp, /linear-gradient|radial-gradient/i, 'Anti-AI Slop: 그라디언트 장식 금지');
assert.doesNotMatch(comp, /[\u{1F300}-\u{1FAFF}]/u, 'Anti-AI Slop: 장식용 이모지 금지');
assert.ok(comp.includes('tabular-nums'), 'ArchFlowChart tabular-nums 고정폭 정렬 필수');
assert.ok(comp.includes('prefers-reduced-motion'), 'ArchFlowChart prefers-reduced-motion 준수 필수');
assert.ok(comp.includes('rgb(248, 250, 252)'), 'ArchFlowChart 에디토리얼 라이트 배경 토큰 필수');
assert.doesNotMatch(comp, /ui-monospace|\bmonospace\b/, 'ArchFlowChart: 한글 굴림체 폴백을 유발하는 monospace 선언 금지');
assert.ok(comp.includes('Pretendard') && comp.includes('Malgun Gothic'), 'ArchFlowChart: Windows 한글 고딕 폰트 스택 필수');
const uiKitSrc = read('components/pm/ui.js');
assert.doesNotMatch(uiKitSrc, /ui-monospace|\bmonospace\b/, 'components/pm/ui.js: 한글 굴림체 폴백을 유발하는 monospace 선언 금지');
assert.ok(uiKitSrc.includes('Pretendard') && uiKitSrc.includes('Malgun Gothic'), 'components/pm/ui.js: Windows 한글 고딕 폰트 스택 필수');
assert.ok(fs.existsSync(path.join(root, 'docs', 'SOLUTION_VISION_AND_FEASIBILITY.md')), 'docs/SOLUTION_VISION_AND_FEASIBILITY.md 정본 문서 필수');

// SSR 렌더링 및 버튼 PM UI 키트 준수 검증
const ArchFlowChartComp = compile('components/pm/ArchFlowChart.js', (id, baseReq) => {
  if (id === './ui') return compile('components/pm/ui.js');
  return baseReq(id);
}).default;
const archSsrHtml = renderToStaticMarkup(React.createElement(ArchFlowChartComp, { onSelectTab: () => {}, mineOnly: false }));
for (const tid of [
  'data-testid="arch-flow-chart"',
  'data-testid="arch-hermes-section"',
  'data-testid="arch-solution-blueprints"',
  'data-testid="arch-device-suite-section"',
  'data-testid="arch-rust-hotpaths"',
  'data-testid="arch-vision-feasibility"',
]) {
  assert.ok(archSsrHtml.includes(tid), `ArchFlowChart SSR 누락: ${tid}`);
}
for (const m of archSsrHtml.matchAll(/<button\b([^>]*)>/g)) {
  assert.match(m[1], /\bpmk\b/, `ArchFlowChart SSR 모든 버튼은 pmk 키트여야 함: ${m[0]}`);
}
assert.doesNotMatch(archSsrHtml, /감시|추적|모니터링|절감시간/);
assert.ok(archSsrHtml.includes('통합 모션 시뮬레이션 열기 ↗'));

const myWork = read('pages/my-work.js');
assert.match(myWork, /\{ id: 'arch', label: '아키텍처 흐름도' \}/);
assert.match(myWork, /\{ id: 'suite-sim', label: '통합 솔루션 시뮬레이션' \}/);
assert.match(myWork, /tab === 'arch' && <ArchFlowChart/);
assert.match(myWork, /tab === 'suite-sim' && !mineOnly && <SolutionSuiteSimulator/);
assert.match(myWork, /router\.query\?\.tab/);

const shell = read('desktop/shell/shell.js');
assert.match(shell, /needUpdate = \['available', 'downloaded'\]\.includes\(update\.phase\)/);
assert.match(shell, /#d82f36/);
assert.match(shell, /pmOpenButton\.textContent = '오류관제 열기'/);
assert.match(shell, /pmArchButton\.id = 'pmArchButton'/);
assert.match(shell, /pmArchButton\.textContent = '흐름도'/);
assert.match(shell, /url: '\/my-work\?tab=arch'/);
assert.match(shell, /pmSimButton\.id = 'pmSimButton'/);
assert.match(shell, /pmSimButton\.textContent = '시뮬레이션'/);
assert.match(shell, /url: '\/my-work\?tab=suite-sim'/);
assert.match(shell, /pmRadarButton\.id = 'pmRadarButton'/);
assert.match(shell, /pmRadarButton\.textContent = '도입레이더'/);
assert.match(shell, /url: '\/my-work\?tab=radar'/);

const layout = read('components/Layout.js');
assert.match(layout, /href: '\/my-work\?tab=arch'/);
assert.match(layout, /href: '\/my-work\?tab=suite-sim'/);
assert.match(layout, /href: '\/my-work\?tab=radar'/);
assert.match(layout, /href: '\/my-work\?tab=proposals'/);

console.log('archFlowChart contract tests passed');
