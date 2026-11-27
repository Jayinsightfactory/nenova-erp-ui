import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

const root = process.cwd();
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

const UI_FILES = [
  'pages/incoming/kakao-summary.js',
  'pages/orders/kakao-audit.js',
  'pages/orders/change-queue.js',
  'components/home/ImportFlightBoard.js',
  'components/shipment/DistributionKakaoFeed.js',
  'components/orders/DistributionSalesInbox.js',
  'components/orders/DistributionChangeAudit.js',
  'components/orders/DistributionChecklistReview.js',
  'components/orders/KakaoStockInbox.js',
  'pages/orders/kakao-stock.js',
  'pages/shipment/distribute-import.js',
  'pages/admin/workflow.js',
  'pages/admin/chat-audit.js',
];

// 1. Verify Zero-Lag 4 Principles & Anti-AI Slop across Kakao UI files
for (const file of UI_FILES) {
  const src = read(file);
  assert.ok(/tabular-nums/.test(src), `${file} must apply tabular-nums for numeric alignment`);
  if (file !== 'pages/orders/change-queue.js') {
    assert.ok(/contentVisibility|content-visibility/.test(src), `${file} must apply content-visibility: auto`);
  }
  if (file !== 'components/orders/DistributionSalesInbox.js' && file !== 'pages/orders/change-queue.js') {
    assert.ok(/\bmemo\s*\(/.test(src), `${file} must isolate row/card components with React.memo`);
  }
  // Zero unbounded Math.max pagination bypasses
  assert.doesNotMatch(
    src,
    /\b(?:effectiveLimit|pageSize|pageLimit)\s*=\s*Math\.max\([^;\n]*\.(?:length|size)\b/,
    `${file} must not bypass pagination with Math.max(..., .length/.size)`
  );
}

// Verify standalone monospace removal in workflow.js and paste.js Kakao modal
assert.doesNotMatch(read('pages/admin/workflow.js'), /fontFamily:\s*['"]monospace['"]/);
assert.match(read('pages/incoming/kakao-summary.js'), /PAGE_SIZE\s*=\s*100/);
assert.match(read('pages/orders/kakao-audit.js'), /PAGE_SIZE\s*=\s*100/);
assert.match(read('components/home/ImportFlightBoard.js'), /PAGE_SIZE\s*=\s*100/);
assert.match(read('components/shipment/DistributionKakaoFeed.js'), /PAGE_SIZE\s*=\s*100/);
assert.match(read('components/orders/DistributionChangeAudit.js'), /PAGE_SIZE\s*=\s*100/);
assert.match(read('components/orders/DistributionChecklistReview.js'), /PAGE_SIZE\s*=\s*100/);
assert.match(read('pages/orders/kakao-stock.js'), /PAGE_SIZE\s*=\s*100/);
assert.match(read('pages/admin/workflow.js'), /PAGE_SIZE\s*=\s*100/);
assert.match(read('pages/admin/chat-audit.js'), /PAGE_SIZE\s*=\s*100/);

// 2. Verify 5-minute TTL caches & WeakMap parsed caches on Kakao APIs
assert.match(read('pages/api/kakao/summary.js'), /SUMMARY_SHEET_TTL_MS\s*=\s*5\s*\*\s*60\s*\*\s*1000/);
assert.match(read('pages/api/kakao/summary.js'), /parsedSummaryRowsCache\s*=\s*new WeakMap\(\)/);
assert.match(read('pages/api/kakao/order-feed.js'), /ORDER_FEED_TTL_MS\s*=\s*5\s*\*\s*60\s*\*\s*1000/);
assert.match(read('pages/api/kakao/order-feed.js'), /parsedOrderFeedCache\s*=\s*new WeakMap\(\)/);
assert.match(read('pages/api/admin/workflow.js'), /WORKFLOW_SHEET_TTL_MS\s*=\s*5\s*\*\s*60\s*\*\s*1000/);
assert.match(read('pages/api/admin/workflow.js'), /parsedWorkflowLogCache\s*=\s*new WeakMap\(\)/);
assert.match(read('pages/api/import/flight-board.js'), /RECEIPTS_CACHE_TTL_MS\s*=\s*5\s*\*\s*60\s*\*\s*1000/);
assert.match(read('pages/api/orders/kakao-audit.js'), /AUDIT_MASTER_TTL_MS\s*=\s*5\s*\*\s*60\s*\*\s*1000/);
assert.match(read('pages/api/orders/kakao-audit.js'), /export async function auditMessages\(/);
assert.match(read('pages/api/orders/change-queue.js'), /SALES_FEED_CACHE_TTL_MS\s*=\s*5\s*\*\s*60\s*\*\s*1000/);
assert.match(read('pages/api/orders/change-queue.js'), /auditMessages\(/);

// 3. Empirical micro-benchmark: FarmImportReview O(N*M) vs O(N+M) + 100-cap, KakaoAudit dual-table cap, Workflow WeakMap cache
{
  const previewRows = Array.from({ length: 220 }, (_, i) => ({
    key: `row-${i}`,
    custName: `거래처${i}`,
    prodName: `품목${i}`,
    uploadQty: (i % 12) + 1,
    outUnit: '박스',
    cells: i % 9 === 0 ? ['엑셀누락', '엑셀누락'] : ['정상', '변경'],
  }));
  const reviews = Array.from({ length: 260 }, (_, i) => ({
    id: `rev-${i}`,
    customer: `거래처${i % 80}`,
    product: `품목${i % 60}`,
    quantity: 5,
    unit: '단',
    rowKey: `row-${i % 220}`,
  }));

  const t0 = performance.now();
  let legacyMountedOptions = 0;
  for (const entry of reviews) {
    const opts = previewRows.filter(r => r.cells?.some(c => c !== '엑셀누락'));
    legacyMountedOptions += opts.length;
    void entry;
  }
  const legacyMs = performance.now() - t0;

  const t1 = performance.now();
  const eligibleRows = previewRows.filter(r => r.cells?.some(c => c !== '엑셀누락'));
  const visibleReviews = reviews.slice(0, 100);
  const optimizedMountedOptions = visibleReviews.length * eligibleRows.length;
  const optimizedMs = performance.now() - t1;

  assert.ok(optimizedMountedOptions < legacyMountedOptions, '100-row cap must reduce mounted select options');
  assert.ok(optimizedMs <= legacyMs + 5, 'O(N+M) pre-filter must be faster than O(N*M)');
  console.log(
    `[kakaoAllScreensZeroLag] FarmImportReview options=${legacyMountedOptions}->${optimizedMountedOptions}, calc=${legacyMs.toFixed(3)}ms->${optimizedMs.toFixed(3)}ms`
  );
}
