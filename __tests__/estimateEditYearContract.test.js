const assert = require('node:assert/strict');
const fs = require('node:fs');

const readIfExists = (file) => {
  try { return fs.readFileSync(file, 'utf8'); } catch { return ''; }
};

async function main() {
  const page = fs.readFileSync('pages/estimate.js', 'utf8');
  const cycleClient = fs.readFileSync('lib/fixCycleClient.js', 'utf8');
  const costApi = fs.readFileSync('pages/api/estimate/update-cost.js', 'utf8');
  // 2026-08-26 단가 전용 저장 분리 설계
  // (docs/work-reports/2026-08-26_estimate-cost-no-stock-design.md): 연도/거래처 잠금 조회와
  // WeekProdCost 저장 SQL이 update-cost.js에서 lib/estimateCostOnly.js로 이동할 수 있으므로
  // 두 소스를 합쳐서 확인한다 — 정확한 변수명이 아니라 실제 동작을 검증한다.
  const costHelper = readIfExists('lib/estimateCostOnly.js');
  const costApiCombined = `${costApi}\n${costHelper}`;
  const statementApi = fs.readFileSync('pages/api/estimate/order-statement-rows.js', 'utf8');
  const weekCostSchema = fs.readFileSync('lib/weekProdCostSchema.js', 'utf8');
  const i18n = fs.readFileSync('lib/i18n.js', 'utf8');
  const raum = fs.readFileSync('pages/raum/pnl.js', 'utf8');

  const estimateCycles = [...page.matchAll(/runEditWithFixCycle\(\{[\s\S]{0,180}?orderYear:\s*yearStr/g)];
  assert.equal(
    estimateCycles.length,
    1,
    '신규 추가품목의 범위 제한 확정 사이클만 선택 연도를 전달해야 한다. ' +
    '기존 출고일 수량·품목정보·단가 저장은 확정 플래그를 보존하므로 확정 사이클을 호출하지 않는다.',
  );

  const applyQtySrc = page.slice(page.indexOf('const applyQtyEdits = async () =>'), page.indexOf('async function applyCostEdits'));
  assert.match(applyQtySrc, /let results = await savePendingQuantities\(pending\)/, '기존 출고일 수량은 확정 여부와 무관하게 원자 저장 요청으로 처리해야 한다.');
  assert.doesNotMatch(applyQtySrc, /runEditWithFixCycle\(/, '기존 수량 저장이 실패해도 확정취소로 우회하면 안 된다.');
  const saveDateSrc = page.slice(page.indexOf('const saveDateQuantityBatch = async'), page.indexOf('const runEditWithFixCycle = async'));
  assert.match(saveDateSrc, /orderYear: yearStr,[\s\S]*?custKey:[\s\S]*?editGuard: estimateEditGuard\(\)/, '확정 상태 유지 수량 저장에도 화면 연도·거래처·동시 수정 검사가 필요하다.');
  const applyCostEditsSrc = page.slice(
    page.indexOf('async function applyCostEdits'),
    page.indexOf('async function applyAllEdits'),
  );
  assert.ok(applyCostEditsSrc.length > 0, 'applyCostEdits/applyAllEdits 경계를 찾을 수 없다.');
  assert.match(
    applyCostEditsSrc,
    /saveEstimateCostBatch\(/,
    '단가 전용 저장은 확정 여부와 무관하게 복구 가능한 단일 저장 요청으로 처리해야 한다.',
  );
  const saveEstimateCostBatchSrc = page.slice(page.indexOf('const saveEstimateCostBatch'), page.indexOf('const getProdKeysForEditedItems'));
  assert.match(saveEstimateCostBatchSrc, /url:\s*'\/api\/estimate\/update-cost'/, '복구 가능한 단가 저장 helper는 update-cost API를 사용해야 한다.');
  assert.doesNotMatch(
    applyCostEditsSrc,
    /runEditWithFixCycle/,
    '단가 전용 저장(applyCostEdits)은 확정 플래그를 보존해야 하므로 확정해제→재확정 사이클을 호출하면 안 된다.',
  );
  assert.match(page, /const cycleItems = addCycleItems;/, '통합 저장의 확정 사이클은 신규 추가품목만 대상으로 해야 한다.');
  assert.match(page, /cycleWeeks\.length > 0[\s\S]*?runCombinedFixCycle\(cycleWeeks\)[\s\S]*?: await runCombinedUpdate\(\)/, '신규 추가품목이 없는 통합 저장은 확정 사이클을 실행하지 않아야 한다.');
  const editorSrc = page.slice(page.indexOf('const saveItemEditor = async () =>'), page.indexOf('// ── 엑셀 다운 → 인쇄 옵션'));
  assert.doesNotMatch(editorSrc, /runEditWithFixCycle\(/, '기존 품목정보 저장은 확정 상태를 보존해야 한다.');
  assert.match(editorSrc, /fetch\('\/api\/estimate\/update-date-quantity'[\s\S]*?orderYear: yearStr,[\s\S]*?custKey: capturedRefresh\.ship\.custKey/, '품목정보 수량 저장도 선택 연도·거래처를 전달해야 한다.');

  assert.doesNotMatch(cycleClient, /runEditWithFixCycle\(\{[^}]*orderYear\s*=\s*''/, '공용 확정 사이클은 연도 누락 기본값을 허용하면 안 된다.');
  assert.match(cycleClient, /resolveFixStatusOrderYear\(orderYear, \.\.\.targetWeeks\)/, '저장 전에 선택 연도를 검증해야 한다.');
  assert.doesNotMatch(cycleClient, /force:\s*true/, '자동 편집 확정 사이클은 뒤 차수 경고를 강제 우회하면 안 된다.');
  assert.doesNotMatch(page.slice(page.indexOf('const runShipmentFixAction'), page.indexOf('// 수정된 단가 개수')), /force:\s*true/, '견적서 자동 편집 사이클은 force=true를 보내면 안 된다.');

  assert.match(page, /const body = \{[\s\S]{0,250}?mode: effectiveMode,[\s\S]{0,80}?orderYear: yearStr/, '단가 전용 저장 payload에 선택 연도가 필요하다.');
  assert.match(page, /items: rebasedCosts\.items\.map[\s\S]{0,220}?mode: costMode,[\s\S]{0,80}?orderYear: yearStr/, '수량+단가 통합 저장 payload에 선택 연도가 필요하다.');
  assert.match(page, /items: editorCostItems,[\s\S]{0,100}?mode: 'once',[\s\S]{0,80}?orderYear: yearStr/, '품목정보 단가 저장 payload에 선택 연도가 필요하다.');
  const captureStart = page.indexOf('const captureEstimateRefresh = () =>');
  const captureEnd = page.indexOf('const isCapturedEstimateScopeCurrent', captureStart);
  const captureContract = page.slice(captureStart, captureEnd).replace(/\s+/g, ' ');
  const itemEditorStart = page.indexOf('const saveItemEditor = async () =>');
  const itemEditorEnd = page.indexOf('// ── 엑셀 다운 → 인쇄 옵션', itemEditorStart);
  const itemEditorContract = page.slice(itemEditorStart, itemEditorEnd).replace(/\s+/g, ' ');
  assert.ok(
    captureContract.includes('groupId: selectedId, custKey: selectedShip.CustKey,')
      && captureContract.includes('scope: buildSelectionScope({ selectedId: ship.groupId, selectedCustKey: ship.custKey }),')
      && itemEditorContract.includes("mode: 'once', orderYear: yearStr, custKey: capturedRefresh.ship.custKey,"),
    'pages/estimate.js:1541-1553의 captureEstimateRefresh가 선택 업체/선택 범위를 캡처하고, '
      + 'pages/estimate.js:2954-2971 품목정보 단가 payload가 그 capturedRefresh.ship.custKey를 사용해야 한다.',
  );
  assert.match(raum, /postJson\('\/api\/estimate\/update-cost'[\s\S]{0,300}?orderYear/, '라움의 공용 단가 저장 호출도 연도를 전달해야 한다.');
  assert.match(raum, /postJson\('\/api\/estimate\/update-cost'[\s\S]{0,350}?custKey/, '라움의 공용 단가 저장 호출도 거래처를 전달해야 한다.');

  assert.match(costApiCombined, /SELECT ShipmentKey, OrderYear, CustKey, OrderWeek/, '단가 저장 경로는 ShipmentMaster 실제 연도/차수/거래처를 잠금 조회해야 한다.');
  assert.match(costApiCombined, /String\(row\.OrderYear \|\| ''\) !== requestedYear/, '단가 저장 경로는 화면 연도와 실제 출고 연도를 대조해야 한다.');
  assert.match(costApiCombined, /if \(!custKey \|\| !Number\.isInteger\(Number\(custKey\)\)/, '단가 저장 경로는 모든 모드에서 선택 거래처를 필수로 받아야 한다.');
  assert.match(costApiCombined, /if \(Number\(row\.CustKey\) !== Number\(custKey\)\)/, '단가 저장 경로는 요청 거래처와 실제 출고 거래처를 대조해야 한다.');
  assert.match(costApiCombined, /ESTIMATE_SCOPE_MISMATCH/, '연도/거래처 불일치는 409 범위 오류로 중단해야 한다.');
  assert.match(costApiCombined, /t\.OrderYear=s\.OrderYear AND t\.OrderWeek=s\.OrderWeek/, 'WeekProdCost 저장은 연도+차수로 분리해야 한다.');
  assert.match(weekCostSchema, /OrderYear, OrderWeek, CustKey, ProdKey/, 'WeekProdCost 고유키는 교차연도 충돌을 막아야 한다.');
  assert.match(statementApi, /WHERE vo\.OrderYear = @yr/, '거래명세표 주문 조회도 선택 연도로 한정해야 한다.');
  assert.match(statementApi, /wpc\.OrderYear = @yr/, '거래명세표 차수단가 조회도 선택 연도로 한정해야 한다.');

  const { findFixStatusWeek } = await import('../lib/fixStatusYearScope.js');
  const sameWeekAcrossYears = [
    { OrderYear: '2025', OrderWeek: '32-02', status: 'FIXED' },
    { OrderYear: '2026', OrderWeek: '32-02', status: 'UNFIXED' },
  ];
  assert.equal(findFixStatusWeek(sameWeekAcrossYears, { orderYear: '2025', orderWeek: '32-02' }).status, 'FIXED');
  assert.equal(findFixStatusWeek(sameWeekAcrossYears, { orderYear: '2026', orderWeek: '32-02' }).status, 'UNFIXED');

  assert.match(i18n, /useState\('bi'\)/, 'SSR과 첫 브라우저 렌더의 언어 초기값은 같아야 한다.');
  assert.match(i18n, /useEffect\(\(\) => \{\s*setLangState\(getLang\(\)\)/, '저장 언어는 hydration 이후 반영해야 한다.');

  for (const label of ['＋ 불량/검역등록', '＋ 불량차감등록', '＋ 판매요청', '＋ 추가 품목등록']) {
    assert.ok(page.includes(label), `${label} 버튼을 보존해야 한다.`);
  }

  console.log('estimate edit selected-year/cross-year/hydration contract tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
