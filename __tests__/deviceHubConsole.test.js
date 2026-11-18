// __tests__/deviceHubConsole.test.js — 디바이스 허브 관제(Phase 1) 계약·보안 게이트·킬스위치·SSR 단위 테스트.
// 실행: node __tests__/deviceHubConsole.test.js (MSSQL·네트워크 불필요)
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const os = require('node:os');
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

// 1) workFeatureData.js에 device-hub-status 및 2MB 상한 등록 확인
const wfd = compile('lib/workFeatureData.js');
assert.ok(wfd.FEATURE_NAMES.includes('device-hub-status'), 'FEATURE_NAMES에 device-hub-status 필수');
assert.equal(wfd.FEATURE_NAME_MAX['device-hub-status'], 2 * 1024 * 1024, 'device-hub-status 상한은 2MB');

// 2) pages/api/my-work/feature.js 게이트 및 device-hub-status 서빙 검증
const featApiSrc = read('pages/api/my-work/feature.js');
assert.ok(!/lib\/db|\b(SELECT|INSERT|UPDATE|DELETE)\s/i.test(featApiSrc), 'feature.js에 SQL/DB 접근 금지');

let mockUser = null;
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dhc-api-'));
const origCwd = process.cwd();

async function runApiTests() {
  const prevCwd = process.cwd();
  process.chdir(tmpDir);
  try {
    const wfdLocal = compile('lib/workFeatureData.js');
    const featHandler = compile('pages/api/my-work/feature.js', (id) => {
      if (id === '../../../lib/auth') return { verifyReqUser: async () => mockUser };
      if (id === '../../../lib/orbitReportAccess') return compile('lib/orbitReportAccess.js');
      if (id === '../../../lib/workFeatureData') return wfdLocal;
      return Module.createRequire(path.join(root, 'pages/api/my-work/feature.js'))(id);
    }).default;

    const makeRes = () => ({
      statusCode: 200,
      headers: {},
      body: null,
      setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
      status(code) { this.statusCode = code; return this; },
      json(payload) { this.body = payload; return this; },
      send(payload) { this.body = payload; return this; },
    });

    // 비로그인 / 일반직원 차단(404 은닉)
    mockUser = null;
    let res = makeRes();
    await featHandler({ method: 'GET', query: { name: 'device-hub-status' } }, res);
    assert.equal(res.statusCode, 404);

    mockUser = { userId: 'sales01', authority: 6 };
    res = makeRes();
    await featHandler({ method: 'GET', query: { name: 'device-hub-status' } }, res);
    assert.equal(res.statusCode, 404);

    // 관리자 GET (미업로드 상태 → data: null)
    mockUser = { userId: 'nenovaSS3', authority: 1 };
    res = makeRes();
    await featHandler({ method: 'GET', query: { name: 'device-hub-status' } }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.name, 'device-hub-status');
    assert.equal(res.body.data, null);

    // runtime 저장 후 관리자 GET → 실시간 스냅샷 반환
    const sampleSnap = {
      generatedAt: '2026-11-18T09:15:00Z',
      host: 'OWNER-PC',
      sidecarVersion: '0.1.0',
      binarySizeKB: 402.5,
      adbAvailable: true,
      readOnlyEnforced: true,
      canaryMode: true,
      devices: [{ serial: 'R58M12345AB', state: 'device', model: 'SM G973N', transport: 'USB', readOnlyLocked: true, leaseOwner: 'hermes-suip-reader' }],
      leases: [],
      queueSummary: { totalDevices: 1, onlineDevices: 1, activeLeases: 1, waitingHuman: 0 },
    };
    const saved = wfdLocal.saveFeatureFile('device-hub-status', Buffer.from(JSON.stringify(sampleSnap)));
    assert.equal(saved.ok, true);

    res = makeRes();
    await featHandler({ method: 'GET', query: { name: 'device-hub-status' } }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.data.host, 'OWNER-PC');
    assert.equal(res.body.data.devices[0].serial, 'R58M12345AB');
  } finally {
    process.chdir(prevCwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

// 3) pages/my-work.js 관리자 경계 & 탭 연결 검증
const myWorkSrc = read('pages/my-work.js');
const tabsIdx = myWorkSrc.indexOf('const TABS = mineOnly ?');
assert.ok(tabsIdx > 0, 'pages/my-work.js TABS 정의 필요');
const mineTabsBlock = myWorkSrc.slice(tabsIdx, myWorkSrc.indexOf(': [', tabsIdx));
assert.doesNotMatch(mineTabsBlock, /devices/, 'mineOnly 탭 목록에는 devices 노출 금지');
assert.match(myWorkSrc, /\{ id: 'devices', label: '디바이스 허브 관제' \}/);
assert.match(myWorkSrc, /tab === 'devices' && !mineOnly && <DeviceHubConsole/);

// 4) components/Layout.js 데스크톱앱 메뉴 연결 검증
const layoutSrc = read('components/Layout.js');
assert.match(
  layoutSrc,
  /\{\s*href:\s*'\/my-work\?tab=devices',\s*labelKey:\s*'디바이스 허브 관제\(Phone Harness\)',\s*popup:\s*true,\s*userIds:\s*\['nenovaSS3'\]\s*\}/
);

// 5) DeviceHubConsole.js 소스 계약·금지어·킬스위치·SSR 렌더링 검증
const consoleSrc = read('components/work/DeviceHubConsole.js');
assert.doesNotMatch(consoleSrc, /감시|추적|모니터링/, 'UI·주석에 금지어(감시·추적·모니터링) 사용 금지');
assert.ok(consoleSrc.includes('prefers-reduced-motion'), 'prefers-reduced-motion 준수 필수');
assert.ok(consoleSrc.includes('/api/my-work/feature?name=device-hub-status'), '실시간 API 연결 필수');

const mod = compile('components/work/DeviceHubConsole.js');
const DeviceHubConsole = mod.default;
const { evaluateKillSwitch } = mod;

// 킬스위치 판정 단위 테스트
for (const danger of ['송금 50만원', '이체 확인', '결제 승인', '출금 요청', '메시지 전송', '보내기 클릭', '대화 삭제', 'Google Pay', 'Wire Transfer']) {
  const verdict = evaluateKillSwitch(danger);
  assert.equal(verdict.allowed, false, `위험 문구 차단 필요: ${danger}`);
  assert.equal(verdict.blocked, true);
  assert.ok(verdict.matchedKeywords.length > 0);
}
for (const safe of ['adb devices -l 목록 점검', '위챗 단톡방 화면 캡처 읽기', '주문 내역 확인']) {
  const verdict = evaluateKillSwitch(safe);
  assert.equal(verdict.allowed, true, `안전 문구 허용 필요: ${safe}`);
}

// SSR: 미업로드 상태(온보딩 + 체크리스트 + 미리보기)
const onboardingHtml = renderToStaticMarkup(React.createElement(DeviceHubConsole, { initialData: null }));
assert.match(onboardingHtml, /data-testid="device-hub-console"/);
assert.match(onboardingHtml, /nenova-device-sidecar\.exe/);
assert.match(onboardingHtml, /READ-ONLY 잠금/);
assert.match(onboardingHtml, /WAITING_HUMAN 10초 원격 개입/);
assert.match(onboardingHtml, /시뮬레이션 미리보기/);
assert.match(onboardingHtml, /USB 연결/);
assert.match(onboardingHtml, /Wi-Fi 연결/);
assert.doesNotMatch(onboardingHtml, /감시|추적|모니터링/);

// SSR: 실시간 단말 데이터 표시(Lease 점유 주체 + WAITING_HUMAN + Read-Only)
const liveHtml = renderToStaticMarkup(
  React.createElement(DeviceHubConsole, {
    initialData: {
      generatedAt: '2026-11-18T09:15:00Z',
      host: 'NENOVA-OWNER-PC',
      sidecarVersion: '0.1.0',
      binarySizeKB: 402.5,
      adbAvailable: true,
      readOnlyEnforced: true,
      canaryMode: true,
      devices: [
        {
          serial: 'R58M12345AB',
          state: 'device',
          ready: true,
          model: 'Galaxy S10 (SM-G973N)',
          deviceCode: 'dev-canary-01',
          transport: 'USB',
          readOnlyLocked: true,
          leaseOwner: 'hermes-suip-reader',
          leaseStatus: 'ACTIVE',
          killSwitchArmed: true,
          waitingHuman: true,
          waitingReason: '보안키패드 감지 — 10초 내 원격 해제 대기',
        },
      ],
      leases: [],
      queueSummary: { totalDevices: 1, onlineDevices: 1, usbDevices: 1, wifiDevices: 0, activeLeases: 1, waitingHuman: 1 },
    },
  })
);
assert.match(liveHtml, /실시간 스냅샷 연동/);
assert.match(liveHtml, /NENOVA-OWNER-PC/);
assert.match(liveHtml, /hermes-suip-reader/);
assert.match(liveHtml, /보안키패드 감지 — 10초 내 원격 해제 대기/);
assert.doesNotMatch(liveHtml, /감시|추적|모니터링/);

runApiTests()
  .then(() => {
    assert.equal(process.cwd(), origCwd);
    console.log('deviceHubConsole tests passed: featureData, API gate, Layout, my-work, kill-switch, SSR');
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
