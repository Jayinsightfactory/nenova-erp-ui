// 운송기준원가 UPrice 단위 정규화 — 2026-09-30 사고 회귀 테스트
// 실행: node __tests__/freightGoodsUnit.test.js
// WarehouseDetail.UPrice 는 송이/단/박스 단가가 섞여 있다. 상품원가는 TPrice÷수량으로 역산해야 한다.
const assert = require('assert');

async function main() {
  const { computeFreightCost, resolveRowGoodsPriceUSD } = await import('../lib/freightCalc.js');
  const near = (a, b, tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol, `${a} != ${b}`);

  // 1) 송이 단가 장미 — ROSE Candlelight 50cm 29-02 실측 형태: UPrice 0.5, TPrice 50, 10단 100송이, 표시단위 '단'
  let g = resolveRowGoodsPriceUSD({ fobUSD: 0.5, totalPriceUSD: 50, displayUnit: '단', displayQty: 10, stemQty: 100, bunchQty: 10, boxQty: 1, stemsPerBunch: 10 });
  near(g.perDisplay, 5); near(g.perStem, 0.5); assert.strictEqual(g.upriceUnit, '송이'); assert.strictEqual(g.basis, 'tprice-display');
  // 박스수 0 인 두번째 라인(0.65×200=130, 20단)
  g = resolveRowGoodsPriceUSD({ fobUSD: 0.65, totalPriceUSD: 130, displayUnit: '단', displayQty: 20, stemQty: 200, bunchQty: 20, boxQty: 0, stemsPerBunch: 10 });
  near(g.perDisplay, 6.5); near(g.perStem, 0.65);

  // 2) 박스 표시 + 송이 단가 — Hydrangea Blue 31-01: UPrice 0.63, TPrice 132.3, 7박스 210송이
  g = resolveRowGoodsPriceUSD({ fobUSD: 0.63, totalPriceUSD: 132.3, displayUnit: '박스', displayQty: 7, stemQty: 210, bunchQty: 210, boxQty: 7, stemsPerBunch: 1, stemsPerBox: 30 });
  near(g.perDisplay, 18.9); near(g.perStem, 0.63);

  // 3) 박스 단가 — UPrice 가 박스당(40 USD × 3박스 = 120), 표시 박스
  g = resolveRowGoodsPriceUSD({ fobUSD: 40, totalPriceUSD: 120, displayUnit: '박스', displayQty: 3, stemQty: 600, bunchQty: 30, boxQty: 3, stemsPerBunch: 20, stemsPerBox: 200 });
  near(g.perDisplay, 40); near(g.perStem, 0.2); assert.strictEqual(g.upriceUnit, '박스');

  // 4) 단 단가 — 네덜란드형: UPrice 1.2/단 × 50단 = 60, 단당 5송이
  g = resolveRowGoodsPriceUSD({ fobUSD: 1.2, totalPriceUSD: 60, displayUnit: '단', displayQty: 50, stemQty: 250, bunchQty: 50, boxQty: 1, stemsPerBunch: 5 });
  near(g.perDisplay, 1.2); near(g.perStem, 0.24); assert.strictEqual(g.upriceUnit, '단');

  // 5) 표시수량 0 → 송이당 × 표시단위 송이수
  g = resolveRowGoodsPriceUSD({ fobUSD: 0.25, totalPriceUSD: 300, displayUnit: '박스', displayQty: 0, stemQty: 1200, bunchQty: 60, boxQty: 0, stemsPerBunch: 20, stemsPerBox: 300 });
  near(g.perStem, 0.25); near(g.perDisplay, 75); assert.strictEqual(g.basis, 'tprice-stem');

  // 6) TPrice 없음 / 수기 FOB → 기존 UPrice 동작 유지
  g = resolveRowGoodsPriceUSD({ fobUSD: 0.5, totalPriceUSD: 0, displayUnit: '단', displayQty: 10, stemQty: 100 });
  near(g.perDisplay, 0.5); near(g.perStem, 0.5); assert.strictEqual(g.basis, 'uprice');
  g = resolveRowGoodsPriceUSD({ fobUSD: 7, totalPriceUSD: 50, displayUnit: '단', displayQty: 10, stemQty: 100, fobOverridden: true });
  near(g.perDisplay, 7); assert.strictEqual(g.basis, 'uprice-override');

  // 7) computeFreightCost 통합 — 송이단가 장미 도착원가/단 ≥ 상품원가/단 (1,543원 환율)
  const exRate = 1543.52;
  const res = computeFreightCost({
    master: { warehouseKey: 1, gw: 100, cw: 100, rateUSD: 2, docFeeUSD: 0, exchangeRate: exRate, invoiceUSD: 180, itemCount: 1 },
    basis: 'GW',
    customs: { bakSangRate: 0, handlingFee: 0, quarantinePerItem: 0, domesticFreight: 0, deductFee: 0, extraFee: 0 },
    details: [
      { prodKey: 1198, prodName: 'ROSE / Candlelight 50cm', flowerName: 'ROSE', counName: '콜롬비아', outUnit: '단', boxQty: 1, rawBoxQty: 1, bunchQty: 10, steamQty: 100, fobUSD: 0.5, totalPriceUSD: 50, stemsPerBunch: 10 },
      { prodKey: 1198, prodName: 'ROSE / Candlelight 50cm', flowerName: 'ROSE', counName: '콜롬비아', outUnit: '단', boxQty: 0, rawBoxQty: 0, bunchQty: 20, steamQty: 200, fobUSD: 0.65, totalPriceUSD: 130, stemsPerBunch: 10 },
    ],
    productMeta: {},
    flowerMeta: { ROSE: { boxWeight: 20, boxCBM: 0.1, stemsPerBox: 100, defaultTariff: 0 } },
  });
  const [r1, r2] = res.rows;
  near(r1.displayFobUSD, 5); near(r2.displayFobUSD, 6.5);
  near(r1.goodsPerStemUSD, 0.5);
  assert.ok(r1.displayArrivalKRW >= 5 * exRate, `arrival/단 ${r1.displayArrivalKRW} < goods ${5 * exRate}`);
  // CNF 의 상품원가 부분 = TPrice÷단수 (운임 부분과 분리)
  near(r1.displayCnfUSD - r1.displayFreightUSD, 5); near(r2.displayCnfUSD - r2.displayFreightUSD, 6.5);
  // 송이 CNF 의 상품원가 부분 = TPrice÷송이 (과거: 표시단위에도 송이단가 0.5 를 그대로 사용)
  near(r1.cnfUSD - r1.freightPerStemUSD, 0.5);
  // 운임 200 USD 전액이 행 수량만큼 배분 — Σ(display CNF × 수량) = invoice + freight
  near(r1.displayCnfUSD * 10 + r2.displayCnfUSD * 20, 180 + 200, 1e-6);

  console.log('freightGoodsUnit: all passed');
}
main().catch((e) => { console.error(e); process.exit(1); });
