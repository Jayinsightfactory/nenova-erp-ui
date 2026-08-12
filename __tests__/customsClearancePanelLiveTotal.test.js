// 그외통관비 입력화면(CustomsClearancePanel) — 수기 편집 중 "합계"가 저장 전까지 stale하던 결함 검증.
// 2026-08-12 결함수정: 화면 입력칸을 고쳐도 합계·저장 버튼 옆 합계가 마지막 조회 시점 값에 멈춰
// 있어, 저장 전까지 "화면에 보이는 값"과 "저장하면 실제로 반영될 값"이 달랐다. 수정은 그외통관비/
// 콜롬비아 배분 순수 계산식(DB 의존 없음)을 lib/customsForwardingCalc.js로 분리해 클라이언트
// 컴포넌트가 서버(lib/customsForwarding.js)와 정확히 같은 함수로 즉시 재계산하게 한 것이다.
// 이 테스트는 (1) 그 분리 모듈이 실제로 DB 의존이 전혀 없는지(브라우저 번들 안전), (2) 서버 쪽
// re-export가 별도 구현이 아니라 진짜 재노출(참조 동일)인지, (3) 화면 컴포넌트가 실제로 이 순수
// 모듈을 import해 합계를 다시 계산하는 코드를 쓰는지를 정적/실행 양쪽으로 검증한다.
// 실행: node __tests__/customsClearancePanelLiveTotal.test.js
const fs = require('fs');
const path = require('path');

let failed = 0;
const check = (label, condition, detail = '') => {
  if (condition) console.log(`  ✓ ${label}`);
  else {
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
    failed += 1;
  }
};

function readLib(name) {
  return fs.readFileSync(path.join(__dirname, '..', 'lib', name), 'utf8');
}

async function main() {
  const calcSource = readLib('customsForwardingCalc.js');
  const forwardingSource = readLib('customsForwarding.js');
  const panelSource = fs.readFileSync(path.join(__dirname, '..', 'components', 'CustomsClearancePanel.js'), 'utf8');

  console.log('=== lib/customsForwardingCalc.js는 DB 의존이 전혀 없다(클라이언트 번들 안전) ===');
  check("customsForwardingCalc.js가 './db.js'를 import하지 않음", !/from\s+'\.\/db\.js'/.test(calcSource));
  check("customsForwardingCalc.js가 'mssql'을 import/require하지 않음(설명 주석의 언급은 무관)",
    !/(?:from|require)\(?\s*'mssql'/.test(calcSource) && !/import\s+.*\bmssql\b/.test(calcSource));
  const calcImports = [...calcSource.matchAll(/from\s+'\.\/([\w.-]+)'/g)].map((m) => m[1]);
  check('customsForwardingCalc.js의 import 대상 파싱', calcImports.length > 0, calcImports.join(','));
  for (const importedFile of calcImports) {
    const importedSource = readLib(importedFile);
    check(`customsForwardingCalc.js가 import하는 ${importedFile}도 './db.js'를 import하지 않음(전이 의존 차단)`,
      !/from\s+'\.\/db\.js'/.test(importedSource));
  }

  console.log('\n=== lib/customsForwarding.js는 이 순수 계산식을 재구현하지 않고 그대로 재노출한다 ===');
  const {
    computeCountryCustomsTotal: calcCountry, computeColombiaCustomsTotal: calcColombia,
    computeColombiaAllocation: calcAlloc, effectiveRatesForWeek: calcRates,
    COLOMBIA_ALLOC_CATEGORIES: calcCategories,
  } = await import('../lib/customsForwardingCalc.js');
  const {
    computeCountryCustomsTotal: fwdCountry, computeColombiaCustomsTotal: fwdColombia,
    computeColombiaAllocation: fwdAlloc, effectiveRatesForWeek: fwdRates,
    COLOMBIA_ALLOC_CATEGORIES: fwdCategories,
  } = await import('../lib/customsForwarding.js');
  check('computeCountryCustomsTotal 참조 동일(재구현 아님)', calcCountry === fwdCountry);
  check('computeColombiaCustomsTotal 참조 동일(재구현 아님)', calcColombia === fwdColombia);
  check('computeColombiaAllocation 참조 동일(재구현 아님)', calcAlloc === fwdAlloc);
  check('effectiveRatesForWeek 참조 동일(재구현 아님)', calcRates === fwdRates);
  check('COLOMBIA_ALLOC_CATEGORIES 참조 동일(재구현 아님)', calcCategories === fwdCategories);
  check('customsForwarding.js 소스에 독립 재구현이 남아있지 않음(export function computeCountryCustomsTotal 정의 없음)',
    !/export function computeCountryCustomsTotal/.test(forwardingSource));

  console.log('\n=== components/CustomsClearancePanel.js가 순수 계산식을 직접 import해 미리보기 합계를 재계산 ===');
  check("패널이 lib/customsForwardingCalc(DB 없음)에서 import — lib/customsForwarding(DB 있음)이 아님",
    /from\s+'\.\.\/lib\/customsForwardingCalc'/.test(panelSource)
    && !/from\s+'\.\.\/lib\/customsForwarding'/.test(panelSource));
  check('패널이 computeCountryCustomsTotal/computeColombiaCustomsTotal/computeColombiaAllocation/effectiveRatesForWeek를 import',
    /computeCountryCustomsTotal/.test(panelSource) && /computeColombiaCustomsTotal/.test(panelSource)
    && /computeColombiaAllocation/.test(panelSource) && /effectiveRatesForWeek/.test(panelSource));
  check('countryTotal()이 수기 편집 여부에 따라 즉시 재계산(hasEdit 분기)',
    /const countryTotal = \(row\) => \{/.test(panelSource) && /hasEdit/.test(panelSource));
  check('화면 "합계" 셀이 정적 row.total이 아니라 countryTotal(row)을 렌더',
    /\{fmt\(countryTotal\(row\)\)\}/.test(panelSource) && !/\{fmt\(row\.total\)\}/.test(panelSource));
  check('콜롬비아 배분 미리보기가 정적 c.allocationH가 아니라 colombiaAllocationH(c)를 렌더',
    /colombiaAllocationH\(c\)\['콜롬비아 장미'\]/.test(panelSource) && !/c\.allocationH\['콜롬비아 장미'\]/.test(panelSource));
  check('맨 위 합계(totalAll)도 countryTotal/colombiaAllocationH로 재계산(수기 편집 반영)',
    /const totalSum = |const totalAll = useMemo/.test(panelSource)
    && /data\.countries\.reduce\(\(s, r\) => s \+ n0\(countryTotal\(r\)\)/.test(panelSource));
  check('carry(전차수 참고값)는 여전히 countryValue/colValue에서 제외되어 미리보기 합계에도 자동 반영되지 않음(회귀 없음)',
    !/row\.carry\?\.\[field\] != null\) return/.test(panelSource) && !/c\.carry\?\.\[field\] != null\) return/.test(panelSource));

  console.log('\n=== 시나리오: 관세 입력칸을 편집하면 미리보기 합계가 그 자리에서 서버 공식대로 즉시 바뀐다 ===');
  const rates = { BakSangRate: 460, Truck1t: 99000, Truck2_5t: 187000, Truck5t: 275000, QuarantinePerItemRate: 10000 };
  const savedRow = { GW1: 100, GW2: 0, Customs1_1: 1000, Customs1_2: 0, Customs1_3: 0 };
  const beforeEditTotal = calcCountry(savedRow, rates, '태국');
  const editedRow = { ...savedRow, Customs1_1: 9000 }; // 사용자가 1,000 → 9,000으로 수정
  const afterEditTotal = calcCountry(editedRow, rates, '태국');
  check('편집 전 합계는 저장된 관세(1,000) 기준', Math.abs(beforeEditTotal - (100 * 460 + 1000)) < 0.01, String(beforeEditTotal));
  check('편집 후(저장 전) 합계는 새 입력값(9,000)을 즉시 반영해 서버가 저장 시 계산할 값과 같다',
    Math.abs(afterEditTotal - (100 * 460 + 9000)) < 0.01, String(afterEditTotal));
  check('편집 전후 합계가 실제로 달라짐(stale이면 이 값이 그대로였을 것)', beforeEditTotal !== afterEditTotal);

  console.log(`\n총 ${failed ? '실패' : '성공'} — 실패 ${failed}건`);
  process.exit(failed ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
