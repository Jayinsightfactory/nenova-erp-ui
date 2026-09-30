const assert = require('assert');
const fs = require('fs');
const path = require('path');

// 기말재고 F 품목단가 선입선출(FIFO) — 2026-09-30 사장님 규칙.
async function main() {
  const calc = await import('../lib/profitReportCalc.js');
  const report = await import('../lib/profitReport.js');
  const fifo = calc.computeFifoStockUnitPrice;

  // 1) 기말수량 ≤ 이번 차수 매입 → 전부 이번 차수 단가
  let r = fifo({ endQty: 8, unit: '단', layers: [
    { offset: 0, qty: 10, price: 1000, unit: '단' },
    { offset: 1, qty: 50, price: 500, unit: '단' },
  ] });
  assert.equal(r.status, 'FIFO');
  assert.equal(r.price, 1000);
  assert.equal(r.value, 8000);
  assert.equal(r.allocations.length, 1);

  // 2) 초과분은 전차수 → 전전차수 → 전전전차수 순서로 레이어 소진
  r = fifo({ endQty: 35, unit: '송이', layers: [
    { offset: 3, qty: 100, price: 400 },
    { offset: 0, qty: 10, price: 1000 },
    { offset: 2, qty: 10, price: 600 },
    { offset: 1, qty: 10, price: 800 },
  ] });
  assert.equal(r.value, 10 * 1000 + 10 * 800 + 10 * 600 + 5 * 400);
  assert.deepEqual(r.allocations.map((a) => a.offset), [0, 1, 2, 3]);
  assert.ok(Math.abs(r.price - r.value / 35) < 1e-9);

  // 3) 이번 차수 매입 없음 → 전차수 단가, 전차수도 없으면 전전차수, 전전전차수
  r = fifo({ endQty: 5, layers: [{ offset: 1, qty: 20, price: 700 }] });
  assert.equal(r.price, 700);
  r = fifo({ endQty: 5, layers: [{ offset: 2, qty: 20, price: 650 }, { offset: 0, qty: 0, price: 999 }] });
  assert.equal(r.price, 650);
  r = fifo({ endQty: 5, layers: [{ offset: 3, qty: 1, price: 300 }] });
  assert.equal(r.price, 300, '레이어 수량을 넘는 잔량은 가장 오래된 단가로 평가');
  assert.ok(r.allocations.some((a) => a.overflow));

  // 4) 룩백 4차수(0..3) 밖 레이어는 무시 → 매입 없음 사유
  r = fifo({ endQty: 5, layers: [{ offset: 4, qty: 20, price: 700 }] });
  assert.equal(r.status, 'NO_PURCHASE');
  assert.equal(r.reason, '단가 근거 없음(4차수 내 매입 없음)');
  assert.equal(calc.FIFO_NO_PURCHASE_REASON, r.reason);
  assert.equal(fifo({ endQty: 3, layers: [] }).status, 'NO_PURCHASE');

  // 5) 단위 불일치 레이어는 단가를 쓰지 않는다(수량은 순서에 남고 인접 이전 단가로 평가)
  r = fifo({ endQty: 15, unit: '단', layers: [
    { offset: 0, qty: 10, price: 9999, unit: '박스' },
    { offset: 1, qty: 10, price: 500, unit: 'BUNCH' },
  ] });
  assert.equal(r.status, 'FIFO');
  assert.equal(r.value, 15 * 500, '박스 단가 9999는 단 품목에 쓰이면 안 된다');
  assert.equal(r.allocations[0].priceFromOffset, 1);
  r = fifo({ endQty: 5, unit: '송이', layers: [{ offset: 0, qty: 10, price: 9999, unit: '박스' }] });
  assert.equal(r.status, 'NO_PRICED_PURCHASE', '매입은 있으나 단위가 맞는 단가가 없으면 FIFO 불가');

  // 6) 단가 없는 최신 레이어 → 인접 이전 단가, 이전이 없으면 인접 최신 단가
  r = fifo({ endQty: 20, layers: [
    { offset: 0, qty: 10, price: 1200 },
    { offset: 1, qty: 10, price: null },
  ] });
  assert.equal(r.value, 10 * 1200 + 10 * 1200);

  // 7) 음수·0 재고
  r = fifo({ endQty: -4, layers: [{ offset: 0, qty: 10, price: 250 }] });
  assert.equal(r.value, -1000);
  r = fifo({ endQty: 0, layers: [{ offset: 0, qty: 10, price: 250 }] });
  assert.equal(r.value, 0);

  // 8) 레이어 차수 계산(1차수 이전은 전년도 52차로)
  assert.deepEqual(report.fifoLayerWeeks('2026', '18').map((w) => `${w.orderYear}-${w.major}`),
    ['2026-18', '2026-17', '2026-16', '2026-15']);
  assert.deepEqual(report.fifoLayerWeeks('2026', '02').map((w) => `${w.orderYear}-${w.major}`),
    ['2026-02', '2026-01', '2025-52', '2025-51']);

  // 9) 근거 객체 — 출처와 레이어 기록
  const ev = report.resolveFifoStockEvidence({
    layers: [{ offset: 0, week: '2026-18', qty: 2, price: 100, sourceRefs: ['a'] }, { offset: 1, week: '2026-17', qty: 5, price: 50, sourceRefs: ['b'] }],
    qty: 4, unit: '단', orderYear: '2026', week: '18-02', prodKey: 7,
  });
  assert.equal(ev.status, 'FIFO');
  assert.equal(ev.evidence.source, 'VERIFIED_FIFO_PURCHASE');
  assert.equal(ev.evidence.price, (2 * 100 + 2 * 50) / 4);
  assert.ok(ev.evidence.sourceRefs[0].startsWith('fifo:2026:18-02:prod-7:'));
  assert.ok(ev.evidence.sourceRefs.includes('a') && ev.evidence.sourceRefs.includes('b'));
  assert.equal(report.resolveFifoStockEvidence({ layers: [], qty: 4, unit: '단' }).reason, calc.FIFO_NO_PURCHASE_REASON);

  // 10) 상태·원천 표기 계약
  assert.ok(calc.VERIFIED_STOCK_PRICE_EVIDENCE_STATUSES.includes('VERIFIED_FIFO_PURCHASE'));
  assert.equal(calc.endingStockSourceKind({ snapshotConfirmed: true, endQty: 3, evidenceValue: 10, priceEvidenceStatus: 'VERIFIED_FIFO_PURCHASE' }), 'verified_fifo_purchase');

  // 11) 배선 계약: 원본수식 6키 경로 불변, 스냅샷·단가표 모두 FIFO 사용, 근거 없음 행은 입력 필요 유지
  const reportSrc = fs.readFileSync(path.join(__dirname, '../lib/profitReport.js'), 'utf8');
  const apiSrc = fs.readFileSync(path.join(__dirname, '../pages/api/sales/profit-report.js'), 'utf8');
  const snapshotBlock = reportSrc.slice(reportSrc.indexOf('export async function stockSnapshotByCategory'));
  assert.match(snapshotBlock, /fifoPurchaseLayersByProduct\(orderYear, major,/);
  assert.match(snapshotBlock, /directPrice != null \? directPrice : fifo \? fifo\.price/);
  assert.match(snapshotBlock, /needsInputItems\.push/);
  const rowsBlock = reportSrc.slice(reportSrc.indexOf('export async function stockPriceRows'), reportSrc.indexOf('export async function autoStockUnitPrices'));
  assert.match(rowsBlock, /beginFifo\?\.evidence \|\| selectStockPriceEvidence/);
  assert.match(rowsBlock, /row\.RequiresInput = Boolean\(beginNoEvidence \|\| endNoEvidence\)/);
  assert.match(apiSrc, /const resolvedEnd = categoryAverageEnd\s*\?/, 'F 1순위 원본수식 경로는 그대로');
  assert.deepEqual([...calc.CATEGORY_AVERAGE_INVENTORY_KEYS], ['콜롬비아 수국', '콜롬비아 카네이션', '콜롬비아 장미', '콜롬비아 루스커스', '콜롬비아 알스트로', '베트남']);

  console.log('profitReportFifoStockPrice: ok');
}

main().catch((error) => { console.error(error); process.exit(1); });
