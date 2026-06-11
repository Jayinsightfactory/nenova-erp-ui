// computeBunchAsBoxRepair 순수함수 검증 (단→박스 10배 보정 비율 계산)
// 실행: node __tests__/unitMismatchRepair.test.js

const assert = (label, cond) => {
  if (!cond) {
    console.error(`  ✗ ${label}`);
    process.exitCode = 1;
  } else {
    console.log(`  ✓ ${label}`);
  }
};

async function main() {
  const { computeBunchAsBoxRepair, detectStoredBunchAsBox } = await import('../lib/unitMismatchAudit.js');

  // BunchOf1Box=10 박스 품목, 100송이/박스
  const roseBox = { OutUnit: '박스', EstUnit: '박스', BunchOf1Box: 10, SteamOf1Box: 100 };

  console.log('=== 보정 대상: 주문 5박스인데 출고 50(=5×10) 저장 ===');
  {
    // 단(50)이 박스로 잘못 저장 → 내부 환산은 일관(Bunch=500=50×10)
    const row = {
      OutQuantity: 50,
      BoxQuantity: 50,
      BunchQuantity: 500,
      orderQty: 5, // 주문 baseline 5박스
    };
    const fix = computeBunchAsBoxRepair(row, roseBox);
    assert('보정 대상으로 탐지', !!fix && fix.isMismatch === true);
    assert('ratio ≈ BunchOf1Box(10)', Math.abs(fix.ratio - 10) < 0.001);
    assert('보정 OutQuantity 50 → 5', fix.to.outQty === 5);
    assert('보정 BoxQuantity 5', fix.to.boxQty === 5);
    assert('보정 BunchQuantity 50 (=5×10)', fix.to.bunchQty === 50);
    assert('보정 SteamQuantity 500 (=5×100)', fix.to.steamQty === 500);
    assert('from.outQty 원본 50 보존', fix.from.outQty === 50);
  }

  console.log('\n=== 보정 대상: B1B=15 카네이션, 주문 3박스 vs 출고 45 ===');
  {
    const carnation = { OutUnit: '박스', EstUnit: '박스', BunchOf1Box: 15, SteamOf1Box: 0 };
    const row = { OutQuantity: 45, BoxQuantity: 45, BunchQuantity: 675, orderQty: 3 };
    const fix = computeBunchAsBoxRepair(row, carnation);
    assert('보정 대상 탐지', !!fix);
    assert('ratio ≈ 15', Math.abs(fix.ratio - 15) < 0.001);
    assert('보정 OutQuantity 45 → 3', fix.to.outQty === 3);
    assert('보정 BunchQuantity 45 (=3×15)', fix.to.bunchQty === 45);
  }

  console.log('\n=== 비보정: 정상 박스 행(주문=출고) ===');
  {
    const row = { OutQuantity: 5, BoxQuantity: 5, BunchQuantity: 50, orderQty: 5 };
    assert('정상 행은 탐지 안 됨', detectStoredBunchAsBox(row, roseBox) === null);
    assert('정상 행은 보정 null', computeBunchAsBoxRepair(row, roseBox) === null);
  }

  console.log('\n=== 비보정: 주문 baseline 없으면 보정 안 함 (오탐 방지) ===');
  {
    // orderQty 없음 → 50이 정당한 50박스 주문일 수 있어 보정 금지
    const row = { OutQuantity: 50, BoxQuantity: 50, BunchQuantity: 500 };
    assert('주문 baseline 없으면 null', computeBunchAsBoxRepair(row, roseBox) === null);
  }

  console.log('\n=== 비보정: OutUnit=단 품목(박스 환산 대상 아님) ===');
  {
    const bunchProd = { OutUnit: '단', BunchOf1Box: 10 };
    const row = { OutQuantity: 50, BunchQuantity: 50, orderQty: 5 };
    assert('단 품목은 null', computeBunchAsBoxRepair(row, bunchProd) === null);
  }

  console.log('\n=== 비보정: BunchQuantity 가 OutQty×B1B 와 불일치 (이미 깨진 행) ===');
  {
    // BunchQuantity 가 환산 불일치면 detectStoredBunchAsBox 가 패턴 아님으로 판단 → 안전하게 null
    const row = { OutQuantity: 50, BoxQuantity: 50, BunchQuantity: 123, orderQty: 5 };
    assert('환산 불일치 행은 null', computeBunchAsBoxRepair(row, roseBox) === null);
  }

  if (!process.exitCode) console.log('\n=== RESULT: all passed ===');
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
