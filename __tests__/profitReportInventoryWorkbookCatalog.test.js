const fs = require('fs');
const path = require('path');

let failed = 0;
const check = (label, condition, detail = '') => {
  if (condition) console.log(`  ✓ ${label}`);
  else {
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
    failed += 1;
  }
};

async function main() {
  const {
    inventoryWorkbookCatalogMetadata,
    inventoryWorkbookPriceEvidenceByProduct,
    normalizeInventoryUnit,
  } = await import('../lib/profitReportInventoryWorkbookCatalog.js');
  const { computeAutoEndingStock, endingStockSourceKind } = await import('../lib/profitReportCalc.js');

  console.log('=== 28차 재고잔량 품목단가 catalog ===');
  const before = inventoryWorkbookPriceEvidenceByProduct('2026', '27-02');
  const current = inventoryWorkbookPriceEvidenceByProduct('2026', '28-02');
  const future = inventoryWorkbookPriceEvidenceByProduct('2026', '29-01');
  const otherYear = inventoryWorkbookPriceEvidenceByProduct('2025', '28-02');
  check('미래 시점 자료가 27차 이전으로 역전파되지 않음', Object.keys(before).length === 0);
  check('2025 동일 차수로 교차연도 오염되지 않음', Object.keys(otherYear).length === 0);
  check('28차 재고잔량 단가는 29차 이후에 자동 전파되지 않음', Object.keys(future).length === 0);

  check('호주 Banker Bush는 28차 P43×O37 취득원가',
    Math.abs(current['251'].price - 14.5 * 1068.23) < 1e-9,
    String(current['251']?.price));
  check('호주 근거는 VAT 차감 없는 FOREIGN_TAXABLE', current['251'].basis === 'FOREIGN_TAXABLE');
  check('중국 시네신스는 VAT 포함 10,000원을 /1.1한 공급가 단가',
    Math.abs(current['2158'].price - 10000 / 1.1) < 1e-9);
  check('태국 Jinda Sweet XL은 정확한 ProdKey 609만 연결',
    Math.abs(current['609'].price - 11000 / 1.1) < 1e-9);
  check('엑셀 셀·SHA 근거가 sourceRef에 남음',
    current['609'].sourceRefs[0].includes('재고잔량!N139')
    && current['609'].sourceRefs[0].includes('D777E874'));
  check('근거 적용 범위가 정확히 2026년 28차로 표시됨',
    current['609'].effectiveScope === '2026-28 only');

  check('단위 정규화 박스/단/송이',
    normalizeInventoryUnit('BOX') === '박스'
    && normalizeInventoryUnit('BUNCH') === '단'
    && normalizeInventoryUnit('EA') === '송이');

  const metadata = inventoryWorkbookCatalogMetadata();
  check('22~28차 전체 7개 workbook·78개 시트 검산 메타데이터',
    metadata.validation?.auditedWorkbookCount === 7
    && metadata.validation?.auditedSheetCount === 78
    && metadata.validation?.auditedFormulaCellCount === 12865);
  check('품목단가 1,366행·정규화 품목 108개·안정 품목 105개를 검산',
    metadata.validation?.inventoryPriceRowCount === 1366
    && metadata.validation?.normalizedInventoryItemKeyCount === 108
    && metadata.validation?.stableInventoryItemKeyCount === 105);
  check('원본 workbook 7개의 SHA256을 모두 보존',
    metadata.validation?.workbooks?.length === 7
    && metadata.validation.workbooks.every(row => /^[0-9A-F]{64}$/.test(row.sha256)));
  check('카네이션 110,000원 10배 이상값은 자동 catalog에서 격리',
    metadata.quarantined.some(row => row.sourceCell === 'N30' && row.value === 110000)
    && !current['447']);

  const stock = {
    endQty: 80,
    snapshotConfirmed: true,
    priceEvidenceStatus: 'VERIFIED_WORKBOOK_CATALOG',
    evidenceValue: current['251'].price * 80,
  };
  check('catalog 증거를 E/F 계산에 허용', computeAutoEndingStock(stock) === stock.evidenceValue);
  check('화면 원천 태그를 별도로 표시', endingStockSourceKind(stock) === 'verified_workbook_inventory_catalog');

  console.log('\n=== 운영 배선/우선순위/읽기전용 ===');
  const reportSource = fs.readFileSync(path.join(__dirname, '..', 'lib', 'profitReport.js'), 'utf8');
  const snapshotBlock = reportSource.slice(
    reportSource.indexOf('export async function stockSnapshotByCategory'),
    reportSource.indexOf('/** 카테고리별 구매 통화'),
  );
  check('직접 VERIFIED 단가가 최우선', /const price = directPrice == null \? fallback\?\.price \?\? null : directPrice/.test(snapshotBlock));
  check('사용자 확정 도착원가가 catalog보다 우선', /const fallback = arrival \|\| catalogEvidence/.test(snapshotBlock));
  check('catalog는 정확한 ProdKey와 EstUnit 일치일 때만 사용',
    /workbookCatalog\[String\(row\.ProdKey\)\]/.test(snapshotBlock)
    && /catalogCandidate\.unit === normalizeInventoryUnit\(row\.EstUnit\)/.test(snapshotBlock));
  check('catalog 경로에 ERP/Web 쓰기 또는 DDL 없음',
    !/INSERT|UPDATE|DELETE|MERGE|CREATE\s+TABLE|ALTER\s+TABLE/i.test(
      fs.readFileSync(path.join(__dirname, '..', 'lib', 'profitReportInventoryWorkbookCatalog.js'), 'utf8'),
    ));

  console.log(`\n총 ${failed ? '실패' : '성공'} — 실패 ${failed}건`);
  process.exit(failed ? 1 : 0);
}

main().catch((error) => { console.error(error); process.exit(1); });
