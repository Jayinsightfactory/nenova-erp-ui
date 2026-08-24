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
  const { computeAutoEndingStock, endingStockSourceKind, selectStockPriceEvidence } = await import('../lib/profitReportCalc.js');

  console.log('=== 재고단가 근거 우선순위 정책 함수(selectStockPriceEvidence) ===');
  const arrivalEv = { price: 100, source: 'VERIFIED_ARRIVAL_COST' };
  const freightEv = { price: 90, source: 'VERIFIED_FREIGHT_ARRIVAL_CALC' };
  const catalogEv = { price: 80, source: 'VERIFIED_WORKBOOK_CATALOG' };
  const carriedEv = { price: 70, source: 'VERIFIED_CARRIED_ACQUISITION' };
  check('같은 세부차수 전산 도착원가가 과거 catalog보다 우선(결함 수정 핵심 케이스)',
    selectStockPriceEvidence({ freightArrival: freightEv, catalogEvidence: catalogEv })?.source === 'VERIFIED_FREIGHT_ARRIVAL_CALC');
  check('사용자 확정 도착원가가 전산 도착원가·catalog·이월보다 항상 우선',
    selectStockPriceEvidence({ arrival: arrivalEv, freightArrival: freightEv, catalogEvidence: catalogEv, carried: carriedEv })?.source === 'VERIFIED_ARRIVAL_COST');
  check('catalog는 전산 도착원가가 없을 때만 채택',
    selectStockPriceEvidence({ catalogEvidence: catalogEv, carried: carriedEv })?.source === 'VERIFIED_WORKBOOK_CATALOG');
  check('이월근거는 다른 근거가 전혀 없을 때만 채택',
    selectStockPriceEvidence({ carried: carriedEv })?.source === 'VERIFIED_CARRIED_ACQUISITION');
  check('근거가 전혀 없으면 null', selectStockPriceEvidence({}) === null);

  console.log('=== 28차 재고잔량 품목단가 catalog ===');
  const before = inventoryWorkbookPriceEvidenceByProduct('2026', '27-02');
  const current = inventoryWorkbookPriceEvidenceByProduct('2026', '28-02');
  const future = inventoryWorkbookPriceEvidenceByProduct('2026', '33-02', {
    rateEvidenceByCurrency: { AUD: { rate: 1123.45, source: 'test:2026:33:AUD' } },
  });
  const futureWithoutAud = inventoryWorkbookPriceEvidenceByProduct('2026', '33-02');
  const otherYear = inventoryWorkbookPriceEvidenceByProduct('2025', '28-02');
  check('미래 시점 자료가 27차 이전으로 역전파되지 않음', Object.keys(before).length === 0);
  check('2025 동일 차수로 교차연도 오염되지 않음', Object.keys(otherYear).length === 0);
  check('산식으로 취득원가가 입증된 호주 template만 2026년 후속 차수의 exact ProdKey에 재사용',
    Math.abs(future['251'].price - 14.5 * 1123.45) < 1e-9
    && !future['609']);
  check('호주 후속 차수는 대상 차수 AUD 과세환율을 사용',
    Math.abs(future['251'].price - 14.5 * 1123.45) < 1e-9
    && future['251'].targetTaxableRate === 1123.45);
  check('대상 차수 AUD 과세환율이 없으면 후속 차수 후보가 전부 비어 있음(비호주 N열 항목은 상시 격리)',
    !futureWithoutAud['251'] && !futureWithoutAud['609'] && Object.keys(futureWithoutAud).length === 0);
  check('후속 차수 sourceRef에 대상 환율 근거가 남음',
    future['251'].sourceRefs[0].includes('target-taxable-rate:1123.45:test:2026:33:AUD'));

  check('호주 Banker Bush는 28차 P43×O37 취득원가',
    Math.abs(current['251'].price - 14.5 * 1068.23) < 1e-9,
    String(current['251']?.price));
  check('호주 근거는 VAT 차감 없는 FOREIGN_TAXABLE', current['251'].basis === 'FOREIGN_TAXABLE');
  check('엑셀 셀·SHA 근거가 sourceRef에 남음(호주)',
    current['251'].sourceRefs[0].includes('재고잔량!P43')
    && current['251'].sourceRefs[0].includes('D777E874'));
  check('근거 적용 범위가 2026년 28차 이후로 명시됨',
    current['251'].effectiveScope === '2026-28 and later in 2026');
  check('중국 안개꽃 N열 판매단가는 취득원가 산식이 없어 재고평가 후보에서 제외',
    ['2220', '2460', '2461', '2464', '2748', '2919'].every((key) => !current[key]));
  check('중국 시네신스 화이트 N열 판매단가도 재고평가 후보에서 제외',
    !current['2158'] && !current['2754']);
  check('시네신스 옐로우 2159처럼 엑셀 번호 없이 색이 다른 품목은 catalog에 넣지 않음',
    !current['2159']);
  check('태국 Jinda Sweet XL(609)의 N열 판매단가는 취득원가 산식이 없어 재고평가 후보에서 제외',
    !current['609']);
  check('네덜란드 N열 판매단가(2783/2817/2707)도 재고평가 후보에서 제외',
    !current['2783'] && !current['2817'] && !current['2707']);
  check('eligibleForInventoryValuation:false 항목은 어느 차수에서도 후보로 반환되지 않음',
    !before['609'] && !otherYear['609'] && !current['609'] && !future['609']);

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
  check('산식으로 취득원가가 입증된 호주 14개만 eligible, N열 판매단가 33개는 ineligible로 격리',
    metadata.eligibleEntryCount === 14 && metadata.ineligibleEntryCount === 33
    && metadata.eligibleEntryCount + metadata.ineligibleEntryCount === metadata.entryCount);

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
  check('직접 VERIFIED 단가가 최우선', /const exactPrice = directPrice == null \? exactFallback\?\.price \?\? null : directPrice/.test(snapshotBlock));
  check('재고단가 근거 선택은 공용 순수 정책 함수(selectStockPriceEvidence)를 사용',
    /const exactFallback = selectStockPriceEvidence\(\{ arrival, freightArrival, catalogEvidence, carried \}\)/.test(snapshotBlock));
  check('전산 도착원가는 Product.EstUnit 일치 때만 사용',
    /freightCandidate\.unit === normalizeInventoryUnit\(row\.EstUnit\)/.test(snapshotBlock));
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
