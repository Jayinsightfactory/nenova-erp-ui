// 2026-08-11 결함수정 6: 카테고리 안에 매입단위(박스)와 재고단위(단/송이)가 섞이면
// F열 1순위 공식(category 평균단가 = 매입총액÷매입총수량×기말수량)이 서로 다른 물리단위를
// 그대로 합산·나눗셈하는 것이라 무효다. 27차 호주가 실측 사례다 — fixture 실측값
// (__tests__/fixtures/profit-report-22-27.json weeks.27 호주행) F=7,843,425.3635, R=1068.23는
// 품목별 최근 매입 외화단가×품목별 기말수량 합계(recentCost, 이미 품목별로 집계됨)에 AUD
// 환율만 곱한 값과 정확히 일치해야 한다. lib/profitReportCalc.js computeAutoEndingStock의
// unitMismatch 플래그가 이 fallback을 강제하는지, 다른(단위 일관) 카테고리는 기존 1순위
// 공식이 그대로 유지되는지(회귀 없음) 검증한다.
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

async function main() {
  const { computeAutoEndingStock } = await import('../lib/profitReportCalc.js');
  const fixture = JSON.parse(
    fs.readFileSync(path.join(__dirname, 'fixtures', 'profit-report-22-27.json'), 'utf8')
  );
  const week27 = fixture.weeks['27'];
  const aus = week27.categories.find((c) => c.category === '호주');
  const F = aus.cells.F.value;   // 7,843,425.3635
  const R = aus.cells.R.value;   // 1068.23
  const Q = aus.cells.Q.value;   // 16,667.5 (외화 구매금액)
  const H = aus.cells.H.value;   // 608,410 (그외통관비)

  console.log('=== 27차 호주 실측값 로딩 ===');
  check('fixture에서 호주 F/R/Q/H 값을 읽음', F > 0 && R > 0 && Q > 0 && H >= 0,
    `F=${F} R=${R} Q=${Q} H=${H}`);

  console.log('\n=== unitMismatch=true — 1순위(category 평균단가) 대신 2순위(recentCost) 사용 ===');
  // recentCost는 "품목별 최근 외화단가 × 품목별 기말수량"을 이미 SQL에서 합산해 온 값이다.
  // F = recentCost × R 이 성립하도록 역산해, 그 recentCost를 그대로 넣었을 때 실측 F가
  // 정확히 재현되는지 확인한다(품목별 fallback 공식 자체의 정확성 검증).
  const recentCost = F / R;
  const mismatchResult = computeAutoEndingStock(
    {
      // 1순위 조건(purchQty>0, landedWon>0)을 일부러 참으로 만들어도 unitMismatch=true면
      // 무시되고 2순위로 가야 한다 — 카테고리 평균단가 공식은 단위가 섞이면 애초에 계산해서는 안 된다.
      purchQty: 999,
      endQty: 500,
      recentCost,
      tableF: 111111,
      unitMismatch: true,
    },
    { Q, S: 0, H, R }
  );
  check('unitMismatch=true면 1순위(purchQty 비율) 조건이 참이어도 건너뜀',
    Math.abs(mismatchResult - F) < 0.01,
    `계산=${mismatchResult} 기대=${F}`);

  console.log('\n=== unitMismatch=false(또는 미지정) — 기존 1순위 공식 회귀 없음 ===');
  const normalStock = { purchQty: 100, endQty: 40, recentCost: 999, tableF: 555 };
  const expectedTier1 = ((Q * R + 0 * R + H) / 100) * 40;
  const normalResult = computeAutoEndingStock(normalStock, { Q, S: 0, H, R });
  check('unitMismatch 없는 카테고리는 기존 1순위(매입총액÷매입총수량×기말수량) 공식 그대로',
    Math.abs(normalResult - expectedTier1) < 0.01,
    `계산=${normalResult} 기대=${expectedTier1}`);
  const normalResultExplicitFalse = computeAutoEndingStock({ ...normalStock, unitMismatch: false }, { Q, S: 0, H, R });
  check('unitMismatch:false를 명시해도 동일(회귀 없음)',
    Math.abs(normalResultExplicitFalse - expectedTier1) < 0.01);

  console.log('\n=== purchQty=0(매입 없는 차수)이면 unitMismatch 여부와 무관하게 2순위로 자연히 넘어감(기존 동작) ===');
  const noPurchase = computeAutoEndingStock(
    { purchQty: 0, endQty: 40, recentCost, unitMismatch: false },
    { Q: 0, S: 0, H: 0, R }
  );
  check('매입이 없으면 unitMismatch:false여도 recentCost×R 사용', Math.abs(noPurchase - recentCost * R) < 0.01);

  console.log('\n=== lib/profitReport.js 소스 — categoryUnitMismatch 배선 확인 ===');
  const reportSource = fs.readFileSync(path.join(__dirname, '..', 'lib', 'profitReport.js'), 'utf8');
  check('categoryUnitMismatch 함수가 export됨', /export async function categoryUnitMismatch/.test(reportSource));
  check('stockSnapshotByCategory가 categoryUnitMismatch를 호출', /categoryUnitMismatch\(major, orderYear, snapshot\.stockKey\)/.test(reportSource));
  check('반환값에 unitMismatch 맵이 포함됨', /unitMismatch:\s*unitRows/.test(reportSource));
  check('EstUnit 기준 매입/재고 단위 합집합 distinct count로 판정', /COUNT\(DISTINCT EstUnit\) AS UnitCount/.test(reportSource));

  const apiSource = fs.readFileSync(path.join(__dirname, '..', 'pages', 'api', 'sales', 'profit-report.js'), 'utf8');
  check('API가 이번 차수 stock.unitMismatch를 stockEnd에서 전달', /unitMismatch: Boolean\(stockEnd\.unitMismatch\?\.\[key\]\)/.test(apiSource));
  check('API가 전차수(E 자동계산) stock.unitMismatch도 stockBegin에서 전달', /unitMismatch: Boolean\(stockBegin\.unitMismatch\?\.\[key\]\)/.test(apiSource));

  console.log('\n=== lib/profitReportCalc.js — computeAutoEndingStock이 unitMismatch를 실제로 분기 조건에 사용 ===');
  const calcSource = fs.readFileSync(path.join(__dirname, '..', 'lib', 'profitReportCalc.js'), 'utf8');
  check('1순위 조건이 !stock.unitMismatch를 포함', /if \(!stock\.unitMismatch && purchQty > 0 && landedWon > 0\)/.test(calcSource));

  console.log(`\n총 ${failed ? '실패' : '성공'} — 실패 ${failed}건`);
  process.exit(failed ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
