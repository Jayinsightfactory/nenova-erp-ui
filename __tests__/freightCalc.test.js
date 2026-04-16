// 16-1A Colombia 원가자료 엑셀과 ±0.01 이내로 일치 검증
// 실행: node __tests__/freightCalc.test.js

const fs = require('fs');
const path = require('path');

// CommonJS 환경에서 ES module import (Node 플래그 없이 동작하도록 dynamic)
async function main() {
  const { computeFreightCost } = await import('../lib/freightCalc.js');
  const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixture_16-1A.json'), 'utf-8'));

  const result = computeFreightCost({
    master: fixture.master,
    basis: fixture.basis,
    customs: fixture.customs,
    details: fixture.details,
    productMeta: fixture.productMeta,
    flowerMeta: fixture.flowerMeta,
  });

  let fail = 0, pass = 0;
  const TOL = 0.01;

  const cmp = (label, got, expected) => {
    if (expected == null) return;
    if (got == null) { console.log(`  ✗ ${label}: got null, expected ${expected}`); fail++; return; }
    const diff = Math.abs(Number(got) - Number(expected));
    if (diff < TOL) { pass++; }
    else { console.log(`  ✗ ${label}: got ${got}, expected ${expected} (diff=${diff})`); fail++; }
  };

  // 헤더 검증
  console.log('=== Header checks ===');
  cmp('freightTotalUSD', result.header.freightTotalUSD, 2871.6);
  cmp('customsTotalKRW', result.header.customsTotalKRW, 553120);

  // 카테고리 검증 (CARNATION)
  console.log('\n=== Category CARNATION checks ===');
  const cat = result.categories.find(c => c.flowerName === 'CARNATION');
  cmp('weightRatio', cat.weightRatio, 0.8988326848249028);
  cmp('freightUSD', cat.freightUSD, 2581.0879377431907);
  cmp('freightPerStemUSD', cat.freightPerStemUSD, 0.10242412451361868);
  cmp('customsKRW', cat.customsKRW, 497162.33463035023);
  cmp('customsPerStemKRW', cat.customsPerStemKRW, 19.728664072632945);

  // 행 검증
  console.log('\n=== Per-row checks ===');
  for (let i = 0; i < result.rows.length; i++) {
    const r = result.rows[i];
    const exp = fixture.expected[i];
    cmp(`[${i}] ${r.prodName} G`, r.freightPerStemUSD, exp.G);
    cmp(`[${i}] ${r.prodName} H`, r.cnfUSD, exp.H);
    cmp(`[${i}] ${r.prodName} J`, r.cnfKRW, exp.J);
    cmp(`[${i}] ${r.prodName} L`, r.customsPerStem, exp.L);
    cmp(`[${i}] ${r.prodName} M`, r.arrivalPerStem, exp.M);
    cmp(`[${i}] ${r.prodName} O`, r.arrivalPerBunch, exp.O);
    cmp(`[${i}] ${r.prodName} P`, r.salePriceExVAT, exp.P);
    cmp(`[${i}] ${r.prodName} S`, r.profitPerBunch, exp.S);
    cmp(`[${i}] ${r.prodName} T`, r.profitRate, exp.T);
    cmp(`[${i}] ${r.prodName} U`, r.totalSaleKRW, exp.U);
    cmp(`[${i}] ${r.prodName} V`, r.totalProfitKRW, exp.V);
  }

  console.log(`\n=== Results: ${pass} passed, ${fail} failed ===`);
  if (result.warnings.length) {
    console.log('\nWarnings:');
    for (const w of result.warnings) console.log(`  [${w.level}] ${w.msg}`);
  }
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
