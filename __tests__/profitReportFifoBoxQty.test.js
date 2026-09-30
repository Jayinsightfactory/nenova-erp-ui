const assert = require('assert');

// FIFO 레이어: EstQuantity=0 + 박스 입고(SALAL TIPS 1718) → 박스×환산으로 EstUnit 수량·단가.
async function main() {
  const r = await import('../lib/profitReport.js');
  const q = r.warehouseQtyInEstUnit;
  // SALAL: 박스 70, EstQuantity 0, 단 25/박스, SteamQuantity 43750 → 1750 단 (송이 43750 아님)
  assert.deepStrictEqual(q({ estQuantity: 0, boxQuantity: 70, outQuantity: 70, steamQuantity: 43750, estUnit: '단', bunchOf1Box: 25, steamOf1Box: 625 }), { qty: 1750, rule: 'box-to-est-unit' });
  assert.strictEqual(q({ estQuantity: null, boxQuantity: 4, estUnit: '송이', steamOf1Box: 300 }).qty, 1200);
  assert.strictEqual(q({ estQuantity: 0, boxQuantity: 5, estUnit: '박스' }).qty, 5);
  assert.strictEqual(q({ estQuantity: 0, boxQuantity: 0, outQuantity: 3, estUnit: '단', bunchOf1Box: 10 }).qty, 30);
  // EstQuantity 있으면 그대로
  assert.deepStrictEqual(q({ estQuantity: 1400, boxQuantity: 7, estUnit: '단', bunchOf1Box: 25 }), { qty: 1400, rule: 'est-quantity' });
  // 환산계수 없음(에콰도르 샘플 박스) → 기존 fallback 유지
  assert.deepStrictEqual(q({ estQuantity: 0, boxQuantity: 1, estUnit: '단', bunchOf1Box: 0 }), { qty: 1, rule: 'legacy-box' });
  assert.deepStrictEqual(q({ estQuantity: 0, boxQuantity: 1, bunchQuantity: 12, estUnit: '송이', steamOf1Box: null }), { qty: 12, rule: 'legacy-bunch' });

  const c = r.convertEvidencePriceToEstUnit;
  const p = c({ price: 111740.93, fromUnit: '박스', estUnit: '단', bunchOf1Box: 25 });
  assert.ok(Math.abs(p.price - 4469.6372) < 0.001); assert.strictEqual(p.rule, 'box-to-bunch');
  assert.strictEqual(c({ price: 6000, fromUnit: '박스', estUnit: '송이', steamOf1Box: 600 }).price, 10);
  assert.strictEqual(c({ price: 500, fromUnit: '단', estUnit: '단' }).price, 500);
  assert.strictEqual(c({ price: 6000, fromUnit: '박스', estUnit: '단', bunchOf1Box: 0 }), null);
  assert.strictEqual(c({ price: 0, fromUnit: '박스', estUnit: '박스' }), null);
  assert.strictEqual(c({ price: 100, fromUnit: '송이', estUnit: '박스' }), null);
  console.log('profitReportFifoBoxQty tests passed');
}
main().catch((e) => { console.error(e); process.exit(1); });
