const assert = require('node:assert/strict');

async function main() {
  const { loadManifests, validateManifest } = await import('../scripts/check-erp-contract-manifest.mjs');
  const manifests = loadManifests();
  assert.ok(manifests.length > 0, '기능 계약 manifest가 하나 이상 있어야 합니다.');
  assert.ok(manifests.some(({ manifest }) => manifest.id === 'week-pivot-distribution'), '차수피벗 계약이 등록되어야 합니다.');
  assert.ok(manifests.some(({ manifest }) => manifest.id === 'order-list-year-scope'), '주문조회 연도 범위 계약이 등록되어야 합니다.');
  assert.ok(manifests.some(({ manifest }) => manifest.id === 'weekly-profit-report'), '주차별 매출이익보고서 계약이 등록되어야 합니다.');
  assert.ok(manifests.some(({ manifest }) => manifest.id === 'freight-cost'), '운송기준원가 계약이 등록되어야 합니다.');
  assert.ok(manifests.some(({ manifest }) => manifest.id === 'raum-pnl-settlement'), '라움 손익계산서 계약이 등록되어야 합니다.');
  assert.ok(manifests.some(({ manifest }) => manifest.id === 'import-pivot'), '수입부 Pivot 계약이 등록되어야 합니다.');
  assert.ok(manifests.some(({ manifest }) => manifest.id === 'arrival-cost'), '도착원가 계약이 등록되어야 합니다.');
  assert.ok(manifests.some(({ manifest }) => manifest.id === 'pivot-stats'), '피벗 통계 계약이 등록되어야 합니다.');
  assert.ok(manifests.some(({ manifest }) => manifest.id === 'estimate-print'), '견적서 출력 계약이 등록되어야 합니다.');
  assert.ok(manifests.some(({ manifest }) => manifest.id === 'my-customer-order-entry'), '내 업체 주문등록 계약이 등록되어야 합니다.');
  const myOrderContract = manifests.find(({ manifest }) => manifest.id === 'my-customer-order-entry').manifest;
  assert.equal(myOrderContract.actions.find(a => a.name === 'REPLACE_ACTIVE_CUSTOMER_ORDER_QUANTITY').orderDetail, 'replace-nonnegative');
  const invalidEffect = structuredClone(myOrderContract);
  invalidEffect.actions[0].orderDetail = 'anything';
  assert.throws(() => validateManifest(invalidEffect, 'invalid-fixture.json'), /orderDetail/);
  assert.ok(manifests.some(({ manifest }) => manifest.id === 'sales-registration-history'), '판매등록 히스토리 계약이 등록되어야 합니다.');
  assert.ok(manifests.some(({ manifest }) => manifest.id === 'hotel-miu-intake'), '호텔+미우 주문입력 계약이 등록되어야 합니다.');
  assert.ok(manifests.some(({ manifest }) => manifest.id === 'shipment-fix-remain-check'), '출고확정 SP 잔량검사 계약이 등록되어야 합니다.');
  assert.ok(manifests.some(({ manifest }) => manifest.id === 'shipment-fix-cancel-gate'), '출고확정취소 다음차수 가드·재고게이트 계약이 등록되어야 합니다.');
  console.log('ERP contract manifest tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
