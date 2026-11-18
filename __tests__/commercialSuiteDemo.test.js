// __tests__/commercialSuiteDemo.test.js — NOWLINK · MOYI 업종별 상용 솔루션 시연 스튜디오 계약·금지어·비노출·계산·SSR 테스트
// 실행: node __tests__/commercialSuiteDemo.test.js (MSSQL·네트워크 불필요)
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

const demoLibSrc = read('lib/commercialSuiteDemo.js');
const demoPageSrc = read('pages/demo/commercial-suite.js');

// 1) 금지어 엄수 ('감시', '추적', '모니터링' 절대 금지)
for (const [label, src] of [
  ['lib/commercialSuiteDemo.js', demoLibSrc],
  ['pages/demo/commercial-suite.js', demoPageSrc],
]) {
  assert.doesNotMatch(src, /감시|추적|모니터링/, `${label}: 금지어(감시/추적/모니터링) 포함 금지`);
}

// 2) 사내 실명·실거래·민감정보 0% 노출 검증
const SENSITIVE_RE =
  /김원배|김원빈|김지니|아드리아나|설연주|손지윤|네노바|신라호텔|초이문|라움|아이엠\(미우\)|BALVERDE|134-86-94367|02-575-8003|630-008129-149|01[016789]-?\d{3,4}-?\d{4}/;
for (const [label, src] of [
  ['lib/commercialSuiteDemo.js', demoLibSrc],
  ['pages/demo/commercial-suite.js', demoPageSrc],
]) {
  assert.doesNotMatch(src, SENSITIVE_RE, `${label}: 사내 실명/실거래처/계좌/연락처 비노출 필수`);
}

// 3) 4대 업종 프리셋 및 순수 계산기 검증
const demoLib = compile('lib/commercialSuiteDemo.js');
const {
  INDUSTRY_PRESETS,
  PRICING_PLANS,
  DEVICE_HUB_ADDON,
  getIndustryPreset,
  buildMappingJson,
  calculateThreeUnitTotals,
  calculateLandedCost,
  calculateCommercialRoi,
} = demoLib;

assert.equal(INDUSTRY_PRESETS.length, 4, '4대 업종 프리셋이 모두 있어야 합니다.');
const expectedIndustries = [
  ['flower', '화훼 직수입 · 도매', '국가·농장', ['박스', '단', '송이'], '주간 차수'],
  ['fresh', '신선 식자재 · 청과 유통', '원산지·산지출하자', ['박스', '소분팩', '낱개EA'], '일일 경매차수'],
  ['wine', '수입 와인 · 식음료 도매', '와이너리·BL번호', ['케이스', '병', '용량ml'], '통관 로트'],
  ['apparel', '의류 · 공산품 B2B 유통', '제조공장·시즌코드', ['카톤', '묶음', '피스'], '프리오더 차수'],
];

for (const [id, label, sourceLabel, units, bucketLabel] of expectedIndustries) {
  const preset = getIndustryPreset(id);
  assert.equal(preset.id, id);
  assert.equal(preset.label, label);
  assert.equal(preset.sourceLabel, sourceLabel);
  assert.deepEqual(preset.units, units);
  assert.equal(preset.bucketLabel, bucketLabel);
  assert.equal(preset.catalogItems.length, 3);

  const mapping = buildMappingJson(preset);
  assert.equal(mapping.terminology.sourceLabel, sourceLabel);
  assert.deepEqual(Object.values(mapping.terminology.unitHierarchy), units);
  assert.equal(mapping.terminology.timeBucketLabel, bucketLabel);
  assert.equal(mapping.captureChannels.outboundBlock, true);
  assert.equal(mapping.approvalGate.enforceSeparationOfDuties, true);

  const unitTotals = calculateThreeUnitTotals(preset.catalogItems[0], 10);
  assert.equal(unitTotals.largeQty, 10);
  assert.equal(unitTotals.midQty, 10 * preset.catalogItems[0].ratioMidPerLarge);
  assert.equal(unitTotals.smallQty, unitTotals.midQty * preset.catalogItems[0].ratioSmallPerMid);

  const baseCost = calculateLandedCost(preset);
  const higherFxCost = calculateLandedCost(preset, { supplyAdjustPct: 10, logisticsAdjustPct: 10 });
  assert.ok(higherFxCost.totalLandedKrw > baseCost.totalLandedKrw);
  assert.ok(higherFxCost.suggestedSupplyMid > higherFxCost.unitCostMid);
}

// 요금제 ROI 검증 (Watch / Build / Team + Device Hub Add-on)
assert.deepEqual(
  PRICING_PLANS.map((p) => p.id),
  ['watch', 'build', 'team']
);
assert.equal(DEVICE_HUB_ADDON.id, 'device-hub');

const watchNoDevice = calculateCommercialRoi({ staffCount: 10, deviceCount: 2, planId: 'watch', includeDeviceHub: false });
const teamWithDevice = calculateCommercialRoi({ staffCount: 10, deviceCount: 2, planId: 'team', includeDeviceHub: true });
assert.equal(watchNoDevice.monthlyDeviceKrw, 0);
assert.equal(teamWithDevice.monthlyDeviceKrw, 2 * DEVICE_HUB_ADDON.monthlyPerDeviceKrw);
assert.ok(teamWithDevice.weeklyHoursSaved > watchNoDevice.weeklyHoursSaved);
assert.ok(teamWithDevice.roiMultiple > 1);

// 4) SSR 렌더링 검증 (기본 화훼 + 업종 전환 + MOYI 승인 + mapping.json 패널)
function renderDemoWithOverrides(overrides = {}) {
  const PageComp = compile('pages/demo/commercial-suite.js', (id) => {
    if (id === 'next/head') {
      return function MockHead({ children }) {
        return React.createElement('div', { 'data-mock-head': 'true' }, children);
      };
    }
    if (id === '../../lib/commercialSuiteDemo') return demoLib;
    if (id === 'react') {
      return {
        ...React,
        useState(init) {
          if (overrides.industryId && init === 'flower') return [overrides.industryId, () => {}];
          if (overrides.moyiApproved !== undefined && init === false && overrides.matchApprove) {
            return [overrides.moyiApproved, () => {}];
          }
          if (overrides.jsonOpen !== undefined && init === false && overrides.matchJson) {
            return [overrides.jsonOpen, () => {}];
          }
          return [init, () => {}];
        },
        useMemo: (fn) => fn(),
      };
    }
    return Module.createRequire(path.join(root, 'pages/demo/commercial-suite.js'))(id);
  }).default;
  return renderToStaticMarkup(React.createElement(PageComp));
}

const defaultHtml = renderDemoWithOverrides();
assert.match(defaultHtml, /data-testid="commercial-suite-demo"/);
assert.match(defaultHtml, /NOWLINK · MOYI 업종별 상용 솔루션 시연 스튜디오/);
for (const sectionId of [
  'industry-switcher',
  'terminology-strip',
  'section-three-unit-master',
  'section-phone-moyi-simulator',
  'section-landed-cost',
  'section-roi-calculator',
]) {
  assert.ok(defaultHtml.includes(`data-testid="${sectionId}"`), `핵심 섹션 누락: ${sectionId}`);
}
for (const token of ['Watch', 'Build', 'Team', 'Device Hub Add-on', '박스', '단', '송이', '46-01차']) {
  assert.ok(defaultHtml.includes(token), `기본 화면 필수 토큰 누락: ${token}`);
}

for (const [id, sourceLabel, smallUnit, sampleBucket] of [
  ['fresh', '원산지·산지출하자', '낱개EA', '1118-새벽경매'],
  ['wine', '와이너리·BL번호', '용량ml', 'LOT-2611-W04'],
  ['apparel', '제조공장·시즌코드', '피스', '26FW-PO-03'],
]) {
  const html = renderDemoWithOverrides({ industryId: id });
  assert.ok(html.includes(sourceLabel), `${id}: 출처 라벨 ${sourceLabel} 누락`);
  assert.ok(html.includes(smallUnit), `${id}: 소단위 ${smallUnit} 누락`);
  assert.ok(html.includes(sampleBucket), `${id}: 버킷 ${sampleBucket} 누락`);
}

// 5) Layout.js 및 데스크톱 부트스트랩 연결 확인
const layoutSrc = read('components/Layout.js');
assert.match(
  layoutSrc,
  /href:\s*'\/demo\/commercial-suite'[\s\S]*labelKey:\s*'상용 솔루션 업종별 시연 스튜디오\(NOWLINK\)'[\s\S]*popup:\s*false[\s\S]*userIds:\s*\['nenovaSS3'\]/,
  'Layout.js에 /demo/commercial-suite (nenovaSS3 전용) 메뉴가 등록되어야 합니다.'
);

(async () => {
  const { buildDesktopBootstrap } = await import('../lib/desktopBootstrap.js');
  const marker = 'export const MENU_ITEMS = ';
  const start = layoutSrc.indexOf(marker);
  const end = layoutSrc.indexOf('\n];', start);
  const expression = layoutSrc.slice(start + marker.length, end + 2);
  const { WORKFLOW_OWNERS } = await import('../lib/workFlowOwners.js');
  const canonical = Function('WORKFLOW_OWNERS', `return (${expression});`)(WORKFLOW_OWNERS);

  const ownerMenu = buildDesktopBootstrap(canonical, { userId: 'nenovaSS3' }, 'v1');
  const staffMenu = buildDesktopBootstrap(canonical, { userId: 'sales01' }, 'v1');
  assert.ok(
    ownerMenu.menus.flatMap((g) => g.items).some((item) => item.href === '/demo/commercial-suite'),
    '데스크톱 부트스트랩(nenovaSS3)에 /demo/commercial-suite가 포함되어야 합니다.'
  );
  assert.ok(
    !staffMenu.menus.flatMap((g) => g.items).some((item) => item.href === '/demo/commercial-suite'),
    '일반 직원 부트스트랩에는 /demo/commercial-suite가 노출되지 않아야 합니다.'
  );
  console.log('commercialSuiteDemo contract, forbidden-terms, non-disclosure & SSR tests passed');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
