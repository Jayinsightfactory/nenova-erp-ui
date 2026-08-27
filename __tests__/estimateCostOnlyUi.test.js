// 견적서관리 단가 전용 저장 UI 계약 (2026-08-26 설계 후속)
// docs/work-reports/2026-08-26_estimate-cost-no-stock-design.md 참조.
// 이 테스트는 pages/estimate.js 화면 로직만 검사한다 — API/lib 구현은 다른 워커의
// __tests__/estimateCostOnly.test.js / __tests__/estimateCostSnapshot.test.js 범위다.
const assert = require('node:assert/strict');
const fs = require('node:fs');

async function main() {
  const page = fs.readFileSync('pages/estimate.js', 'utf8');

  const applyCostEditsSrc = page.slice(
    page.indexOf('async function applyCostEdits'),
    page.indexOf('async function applyAllEdits'),
  );
  assert.ok(applyCostEditsSrc.length > 0, 'applyCostEdits 함수 경계를 찾을 수 없다.');

  // 편집된 정확한 행 키만 수집 — 같은 SdetailKey의 다른(미편집) 출고일을 끌어들이지 않는다.
  assert.match(applyCostEditsSrc, /Object\.entries\(costEdits\)/, '단가 전용 저장은 편집된 costEdits 항목만 수집해야 한다.');
  assert.match(applyCostEditsSrc, /getItemEditKey\(row\)\s*===\s*key/, '단가 전용 저장은 편집된 정확한 행 키로만 대상을 찾아야 한다 (미편집 출고일 제외).');

  // 확정 플래그를 보존하는 금액 전용 저장 — unfix/fix 호출이 없어야 한다.
  assert.doesNotMatch(
    applyCostEditsSrc,
    /runEditWithFixCycle|postShipmentFix\(|action:\s*'unfix'|action:\s*'fix'/,
    '단가 전용 저장은 확정 플래그를 보존해야 하므로 unfix/fix 호출이 없어야 한다.',
  );
  assert.match(applyCostEditsSrc, /fetch\('\/api\/estimate\/update-cost'/, '단가 전용 저장은 update-cost API를 직접 호출해야 한다.');

  // 화면의 출고일별 단가(DateCost)와 상세 단가(Cost)가 다를 수 있음 — sdateKey 소속과
  // DateCost 스냅샷을 함께 서버로 보내 서버가 낙관적 동시성/소속을 검증하게 한다.
  // (향후 별도 스냅샷 helper가 도입되어도 이 값 자체는 계속 전달되어야 한다.)
  assert.match(
    applyCostEditsSrc,
    /requireCostSnapshot\(it\)/,
    '단가 저장 요청은 편집한 출고일(sdateKey) 소속을 서버가 검증하도록 함께 보내야 한다.',
  );
  assert.match(
    applyCostEditsSrc,
    /requireCostSnapshot\(it\)/,
    '단가 저장 요청은 출고일별 단가 스냅샷(DateCost)을 우선 대조값으로 사용해야 한다.',
  );

  // 새 버튼 "단가 + 업체 지정단가 함께 저장"은 mode=fixed 를 명시 인수로 전달한다
  // (React state 갱신 타이밍에 의존하지 않기 위함).
  assert.match(
    page,
    /onClick=\{\(\)\s*=>\s*applyCostEdits\('fixed'\)\}/,
    '업체 지정단가 함께 저장 버튼은 mode를 명시 인수로 전달해야 한다.',
  );
  assert.match(
    page,
    /onClick=\{\(\)\s*=>\s*applyCostEdits\(\)\}/,
    '단가 적용하기 버튼은 화면 select 상태(costMode)를 그대로 사용해야 한다.',
  );

  // 2026-08-26 방향별 수량 저장: 기존 수량과 단가는 확정 상태를 보존한다.
  // 신규 추가 품목만 범위 제한 확정 사이클에 들어간다.
  assert.match(
    page,
    /const atomicDateItems = qtyPending\.filter\(p => p\.isDateQuantity\)\.map\(p => p\.item\)/,
    '기존 출고일 수량은 확정 상태 보존 원자 저장 대상으로 구분해야 한다.',
  );
  assert.match(
    page,
    /const cycleItems = addCycleItems;/,
    '통합 저장의 확정 사이클은 신규 추가 품목만 포함해야 한다 (기존 수량·단가 제외).',
  );

  // 기존 네 등록 버튼 보존
  for (const label of ['＋ 불량/검역등록', '＋ 불량차감등록', '＋ 판매요청', '＋ 추가 품목등록']) {
    assert.ok(page.includes(label), `${label} 버튼을 보존해야 한다.`);
  }

  console.log('estimate cost-only UI contract tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
