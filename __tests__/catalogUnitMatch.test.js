// node __tests__/catalogUnitMatch.test.js
const assert = (label, cond) => {
  if (!cond) {
    console.error(`  FAIL ${label}`);
    process.exitCode = 1;
  } else {
    console.log(`  PASS ${label}`);
  }
};
const near = (a, b, tol = 1) => Math.abs(Number(a) - Number(b)) < tol;

async function main() {
  const { resolveCatalogArrivalDisplay } = await import('../lib/catalogUnitMatch.js');

  const hydrangea889 = {
    OutUnit: '박스',
    EstUnit: '송이',
    SteamOf1Box: 30,
    Cost: 2550,
  };

  console.log('\n=== 수국: 박스 도착원가 → 송이 (arrivalPerStem) ===');
  {
    const r = resolveCatalogArrivalDisplay(hydrangea889, {
      arrivalCost: 36919,
      displayUnit: '박스',
      arrivalPerStem: 1230,
      arrivalPerBunch: null,
    });
    assert('uses arrivalPerStem', r.arrivalUnit === '송이' && near(r.arrivalCost, 1230));
    assert('matchedBy stem field', r.matchedBy === 'arrivalPerStem');
  }

  console.log('\n=== 수국: perStem 없을 때 박스→송이 환산 ===');
  {
    const r = resolveCatalogArrivalDisplay(hydrangea889, {
      arrivalCost: 36900,
      displayUnit: '박스',
      arrivalPerStem: 0,
    });
    assert('converted ~1230/송이', near(r.arrivalCost, 1230, 5));
    assert('unit 송이', r.arrivalUnit === '송이');
  }

  console.log('\n=== 장미: 단 단위 일치 ===');
  {
    const r = resolveCatalogArrivalDisplay(
      { OutUnit: '단', EstUnit: '단', SteamOf1Bunch: 25 },
      { arrivalCost: 25000, displayUnit: '단', arrivalPerBunch: 25000, arrivalPerStem: 1000 },
    );
    assert('uses perBunch', near(r.arrivalCost, 25000));
  }

  if (!process.exitCode) console.log('\n=== RESULT: all passed ===');
}

main().catch(console.error);
