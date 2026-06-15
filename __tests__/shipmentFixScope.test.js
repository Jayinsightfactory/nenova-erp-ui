// evaluateImportRowFixBlock 단위 테스트
// node __tests__/shipmentFixScope.test.js

const assert = (label, cond) => {
  if (!cond) {
    console.error(`  FAIL ${label}`);
    process.exitCode = 1;
  } else {
    console.log(`  PASS ${label}`);
  }
};

async function main() {
  const { evaluateImportRowFixBlock } = await import('../lib/shipmentFixScopeCore.js');

  const catFixed = new Map([
    ['네덜란드', { status: 'FULLY_FIXED', fixedLines: 10, unfixedLines: 0 }],
    ['콜롬비아카네이션', { status: 'UNFIXED', fixedLines: 0, unfixedLines: 3 }],
  ]);
  const lineFixed = new Map([
    ['1|100', { lineFixed: true, masterFixed: true }],
  ]);

  console.log('\n=== 품종 전체 확정 → 차단 ===');
  {
    const r = evaluateImportRowFixBlock({
      orderWeek: '24-02',
      countryFlower: '네덜란드',
      prodName: 'Rose Red',
      custKey: 5,
      prodKey: 200,
      categoryFixStates: catFixed,
      lineFixStates: lineFixed,
    });
    assert('blocked', r.fixBlocked === true);
    assert('reason mentions 품종', (r.fixBlockReason || '').includes('품종'));
  }

  console.log('\n=== 미확정 품종 → 허용 ===');
  {
    const r = evaluateImportRowFixBlock({
      orderWeek: '24-02',
      countryFlower: '콜롬비아카네이션',
      prodName: 'Carnation',
      custKey: 9,
      prodKey: 300,
      categoryFixStates: catFixed,
      lineFixStates: lineFixed,
    });
    assert('not blocked', r.fixBlocked === false);
  }

  console.log('\n=== 확정된 출고라인 → 차단 ===');
  {
    const r = evaluateImportRowFixBlock({
      orderWeek: '24-02',
      countryFlower: '콜롬비아카네이션',
      prodName: 'Carnation',
      custKey: 1,
      prodKey: 100,
      categoryFixStates: catFixed,
      lineFixStates: lineFixed,
    });
    assert('line blocked', r.fixBlocked === true);
  }

  if (!process.exitCode) console.log('\n=== RESULT: all passed ===');
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
