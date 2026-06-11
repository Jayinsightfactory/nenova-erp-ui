// 출고분배 ADD/CANCEL 단위 환산 순수함수 검증
// (adjust.js ShipmentDetail 경로 — delta(userUnit) → OutUnit 환산 후 누적)
// 실행: node __tests__/adjustUnit.test.js

const assert = (label, cond) => {
  if (!cond) {
    console.error(`  ✗ ${label}`);
    process.exitCode = 1;
  } else {
    console.log(`  ✓ ${label}`);
  }
};
const near = (a, b) => Math.abs(Number(a) - Number(b)) < 0.0001;

async function main() {
  const { computeShipmentAdjustUnits } = await import('../lib/adjustUnits.js');

  // 장미: OutUnit=박스, 박스당 10단·100송이
  const roseBox = { outUnit: '박스', bunchOf1Box: 10, steamOf1Box: 100 };

  console.log('=== 장미(B1B=10) 단 입력 ADD — 10단 → +1박스 (10배 버그 차단) ===');
  {
    const r = computeShipmentAdjustUnits({ curOut: 0, delta: 10, type: 'ADD', unit: '단', ...roseBox });
    assert('deltaOut 10단 → 1박스', near(r.deltaOut, 1));
    assert('OutQuantity = 1 (not 10)', near(r.qtyAfter, 1));
    assert('BoxQuantity = 1', near(r.units.box, 1));
    assert('BunchQuantity = 10 (1×10)', near(r.units.bunch, 10));
    assert('SteamQuantity = 100 (1×100)', near(r.units.steam, 100));
    assert('EstQuantity = 10 (단 금액기준)', near(r.estQty, 10));
  }

  console.log('\n=== 박스 입력은 그대로(무해 no-op) ===');
  {
    const r = computeShipmentAdjustUnits({ curOut: 0, delta: 5, type: 'ADD', unit: '박스', ...roseBox });
    assert('5박스 ADD → 5', near(r.qtyAfter, 5));
    assert('box 5 / bunch 50', near(r.units.box, 5) && near(r.units.bunch, 50));
    assert('EstQuantity 50', near(r.estQty, 50));
  }

  console.log('\n=== unit 미지정 → OutUnit(박스) 폴백 ===');
  {
    const r = computeShipmentAdjustUnits({ curOut: 0, delta: 3, type: 'ADD', ...roseBox });
    assert('unit 없으면 박스 가정 → 3', near(r.qtyAfter, 3));
  }

  console.log('\n=== 기존값 누적 (curOut 박스 + 단 ADD) ===');
  {
    const r = computeShipmentAdjustUnits({ curOut: 2, delta: 10, type: 'ADD', unit: '단', ...roseBox });
    assert('2박스 + 10단(1박스) = 3박스', near(r.qtyAfter, 3));
    assert('bunch 30', near(r.units.bunch, 30));
  }

  console.log('\n=== 카네이션(B1B=15) 단 ADD — 45단 → 3박스 ===');
  {
    const carnation = { outUnit: '박스', bunchOf1Box: 15, steamOf1Box: 0 };
    const r = computeShipmentAdjustUnits({ curOut: 0, delta: 45, type: 'ADD', unit: '단', ...carnation });
    assert('45단 → 3박스', near(r.qtyAfter, 3));
    assert('bunch 45 (3×15)', near(r.units.bunch, 45));
    assert('EstQuantity 45', near(r.estQty, 45));
  }

  console.log('\n=== CANCEL — curOut 5박스에서 10단(1박스) 취소 → 4박스 ===');
  {
    const r = computeShipmentAdjustUnits({ curOut: 5, delta: 10, type: 'CANCEL', unit: '단', ...roseBox });
    assert('5 - 1 = 4', near(r.qtyAfter, 4));
    assert('bunch 40', near(r.units.bunch, 40));
  }

  console.log('\n=== CANCEL 초과 → 음수 (핸들러가 차단) ===');
  {
    const r = computeShipmentAdjustUnits({ curOut: 1, delta: 30, type: 'CANCEL', unit: '단', ...roseBox });
    assert('1 - 3 = -2 (음수 반환)', r.qtyAfter < 0 && near(r.qtyAfter, -2));
  }

  console.log('\n=== 송이 입력 ADD — 200송이 → 2박스 (S1B=100) ===');
  {
    const r = computeShipmentAdjustUnits({ curOut: 0, delta: 200, type: 'ADD', unit: '송이', ...roseBox });
    assert('200송이 → 2박스', near(r.qtyAfter, 2));
    assert('steam 200 / bunch 20', near(r.units.steam, 200) && near(r.units.bunch, 20));
  }

  if (!process.exitCode) console.log('\n=== RESULT: all passed ===');
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
