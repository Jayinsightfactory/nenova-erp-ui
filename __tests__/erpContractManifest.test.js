const assert = require('node:assert/strict');

async function main() {
  const { loadManifests } = await import('../scripts/check-erp-contract-manifest.mjs');
  const manifests = loadManifests();
  assert.ok(manifests.length > 0, '기능 계약 manifest가 하나 이상 있어야 합니다.');
  assert.ok(manifests.some(({ manifest }) => manifest.id === 'week-pivot-distribution'), '차수피벗 계약이 등록되어야 합니다.');
  assert.ok(manifests.some(({ manifest }) => manifest.id === 'weekly-profit-report'), '주차별 매출이익보고서 계약이 등록되어야 합니다.');
  console.log('ERP contract manifest tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
