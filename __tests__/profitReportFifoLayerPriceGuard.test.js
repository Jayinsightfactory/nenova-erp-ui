const assert = require('assert');

// FIFO 레이어 단가 하한 검증 — 2026 30~32차 호주(AUD) 사고 재현.
// CurrencyMaster에 AUD 없음 + FreightCost 스냅샷 없음 → 도착원가 계산의 환율 0 → 상품원가(FOB×환율) 누락,
// 통관 배분(Banker Bush 74원/단)만 레이어 단가로 쓰여 재고가 1/200로 평가됐다.
async function main() {
  const r = await import('../lib/profitReport.js');
  const g = r.guardFifoLayerPrice;
  const near = (a, b) => Math.abs(a - b) < 1e-6;

  // 1) AUD 레이어: 환율 0 근거(goodsCostMissing) → 매입단가 14.5 AUD × 과세환율 1056.39 + 통관배분
  const aud = g({ evidencePrice: 74.44, goodsCostMissing: true, purchaseForeignPerUnit: 3262.5 / 225, taxableRate: 1056.39, hShare: 271.43 });
  assert.strictEqual(aud.flag, 'goods-cost-missing');
  assert.ok(near(aud.purchasePrice, 14.5 * 1056.39));
  assert.ok(near(aud.price, 14.5 * 1056.39 + 271.43));
  assert.strictEqual(aud.original, 74.44);

  // 환율 원천이 전혀 없으면 누락 근거는 버린다(null → 레이어 무단가, 다른 레이어 단가/사유로 남음)
  const noFx = g({ evidencePrice: 74.44, goodsCostMissing: true, purchaseForeignPerUnit: 14.5, taxableRate: null });
  assert.strictEqual(noFx.price, null);
  assert.strictEqual(noFx.flag, 'goods-cost-missing');

  // 2) 하한 가드: 정상 근거처럼 보여도 매입×환율×0.5 미만이면 대체 + 플래그
  const low = g({ evidencePrice: 97, purchaseForeignPerUnit: 14.5, taxableRate: 1018.82, hShare: 0 });
  assert.strictEqual(low.flag, 'below-purchase-floor');
  assert.ok(near(low.price, 14.5 * 1018.82));
  // 경계: 정확히 50%는 통과(미만만 차단)
  const edge = g({ evidencePrice: 0.5 * 10 * 1000, purchaseForeignPerUnit: 10, taxableRate: 1000 });
  assert.strictEqual(edge.flag, null);
  assert.strictEqual(edge.price, 5000);
  // 정상 도착원가(매입 + 운임·통관)는 그대로
  const ok = g({ evidencePrice: 16500, purchaseForeignPerUnit: 14.5, taxableRate: 1018.82, hShare: 300 });
  assert.deepStrictEqual([ok.flag, ok.price], [null, 16500]);
  // 매입액/환율이 없으면 가드 불가 → 근거 그대로
  assert.strictEqual(g({ evidencePrice: 97, purchaseForeignPerUnit: 0, taxableRate: 1000 }).price, 97);
  assert.strictEqual(g({ evidencePrice: 97, purchaseForeignPerUnit: 14.5, taxableRate: 0 }).price, 97);
  // 근거 없음
  assert.strictEqual(g({ evidencePrice: 0, purchaseForeignPerUnit: 14.5, taxableRate: 1000 }).price, null);
  assert.strictEqual(r.FIFO_LAYER_PRICE_FLOOR_RATIO, 0.5);

  // 3) 가드 단가가 FIFO 평가에 그대로 흘러가는지 — 29차 225단(가드 대체) + 27차 450단
  const layers = [
    { offset: 1, week: '2026-29', unit: '단', qty: 225, price: aud.price },
    { offset: 3, week: '2026-27', unit: '단', qty: 450, price: 15789.04 },
  ];
  const res = r.resolveFifoStockEvidence({ layers, qty: 173, unit: '단', orderYear: '2026', week: '30-02', prodKey: 251 });
  assert.strictEqual(res.status, 'FIFO');
  assert.ok(near(res.evidence.price, aud.price), 'FIFO 단가 = 최근 레이어(가드 대체) 단가');
  assert.ok(res.evidence.price > 14.5 * 1056.39 * 0.5);

  // 4) 원천 표시: 환율 0 도착원가는 aggregateArrivalCosts에서 goodsCostMissing으로 전달된다
  const { aggregateArrivalCosts } = await import('../lib/pivotArrivalCalc.js');
  const agg = aggregateArrivalCosts([
    { prodKey: 251, inQty: 225, displayArrivalKRW: 74.44, arrivalPerStem: 14.9, arrivalPerBunch: 74.44, displayUnit: '단', source: 'live', goodsCostMissing: true, invoiceCurrency: 'AUD' },
    { prodKey: 9, inQty: 10, displayArrivalKRW: 1000, displayUnit: '단', source: 'live' },
  ]);
  assert.strictEqual(agg[251].goodsCostMissing, true);
  assert.strictEqual(agg[251].invoiceCurrency, 'AUD');
  assert.strictEqual(agg[9].goodsCostMissing, undefined, '정상 행은 필드 없음(기존 형태 유지)');
  console.log('profitReportFifoLayerPriceGuard tests passed');
}
main().catch((e) => { console.error(e); process.exit(1); });
