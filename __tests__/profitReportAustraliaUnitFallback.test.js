// 원본 workbook의 평균원가 공식 대상이 아닌 호주 등은 EXE ProductStock와
// 정확한 차수의 VERIFIED 품목 단가(또는 정확한 역사 workbook F 증거)만 사용한다.
// Product.Cost/recentCost/검증되지 않은 landed-cost fallback이 되살아나지 않는지 검증한다.
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
  const { computeAutoEndingStock, computeProfitRow, endingStockSourceKind } = await import('../lib/profitReportCalc.js');

  console.log('=== 비공식 카테고리는 검증된 재고평가 증거만 E/F 자동값으로 채택 ===');
  const verified = {
    endQty: 500,
    snapshotConfirmed: true,
    priceEvidenceStatus: 'VERIFIED',
    evidenceValue: 456789,
    tableF: 999999,
    recentCost: 888888,
    landedWon: 777777,
    unitMismatch: true,
  };
  check('정확한 VERIFIED evidenceValue를 그대로 사용', computeAutoEndingStock(verified) === 456789);
  check('원천 태그가 verified_product_stock_price', endingStockSourceKind(verified) === 'verified_product_stock_price');

  const verifiedArrival = { ...verified, priceEvidenceStatus: 'VERIFIED_ARRIVAL_COST', evidenceValue: 445500 };
  check('동일 차수·품목·단위의 사용자 확정 도착원가를 사용', computeAutoEndingStock(verifiedArrival) === 445500);
  check('도착원가 증거 원천 태그', endingStockSourceKind(verifiedArrival) === 'verified_arrival_cost');

  const verifiedMixed = { ...verified, priceEvidenceStatus: 'VERIFIED_MIXED', evidenceValue: 440000 };
  check('직접 단가와 확정 도착원가 혼합 증거를 사용', computeAutoEndingStock(verifiedMixed) === 440000);
  check('혼합 증거 원천 태그', endingStockSourceKind(verifiedMixed) === 'verified_mixed_price_evidence');

  const verifiedHistorical = { ...verified, priceEvidenceStatus: 'VERIFIED_HISTORICAL_WORKBOOK', evidenceValue: 430000 };
  check('정확한 2026년 22~28차 원본 F 셀 증거를 사용', computeAutoEndingStock(verifiedHistorical) === 430000);
  check('원본 workbook 증거 원천 태그', endingStockSourceKind(verifiedHistorical) === 'verified_historical_workbook');

  const verifiedCatalog = { ...verified, priceEvidenceStatus: 'VERIFIED_WORKBOOK_CATALOG', evidenceValue: 425000 };
  check('정확한 ProdKey의 재고잔량 품목단가 catalog를 사용', computeAutoEndingStock(verifiedCatalog) === 425000);
  check('재고잔량 catalog 원천 태그', endingStockSourceKind(verifiedCatalog) === 'verified_workbook_inventory_catalog');

  const missingEvidence = { ...verified, priceEvidenceStatus: 'INPUT_REQUIRED', evidenceValue: null };
  check('단가 증거가 없으면 모든 레거시 fallback 값이 있어도 null', computeAutoEndingStock(missingEvidence) == null);
  check('단가 증거 누락 원천 태그', endingStockSourceKind(missingEvidence) === 'missing_price_evidence');

  const missingSnapshot = { ...verified, snapshotConfirmed: false };
  check('ProductStock 스냅샷이 없으면 VERIFIED 단가가 있어도 null', computeAutoEndingStock(missingSnapshot) == null);
  check('스냅샷 누락 원천 태그', endingStockSourceKind(missingSnapshot) === 'missing_stock_snapshot');

  check('ProductStock 스냅샷의 재고수량 0은 단가 증거 없이도 0',
    computeAutoEndingStock({ endQty: 0, snapshotConfirmed: true, priceEvidenceStatus: 'INPUT_REQUIRED' }) === 0);

  console.log('\n=== E/F 최종값 직접입력 차단 ===');
  const row = {
    category: '호주', variant: null,
    auto: { N: 1000, L: 0, O: 0, Q: 0, R: 1000, S: 0, H: 0, E: 111 },
    manual: { E: 900000, F: 800000 },
    stock: verified,
  };
  const calc = computeProfitRow(row, { 호주: { E: 700000, F: 600000 } });
  check('수기/편집 E를 무시하고 서버 auto.E 사용', calc.E === 111);
  check('수기/편집 F를 무시하고 VERIFIED evidenceValue 사용', calc.F === 456789);

  console.log('\n=== SQL/API/감사 배선 ===');
  const reportSource = fs.readFileSync(path.join(__dirname, '..', 'lib', 'profitReport.js'), 'utf8');
  const apiSource = fs.readFileSync(path.join(__dirname, '..', 'pages', 'api', 'sales', 'profit-report.js'), 'utf8');
  const auditSource = fs.readFileSync(path.join(__dirname, '..', 'lib', 'profitReportAudit.js'), 'utf8');
  const stockBlock = reportSource.slice(
    reportSource.indexOf('export async function stockSnapshotByCategory'),
    reportSource.indexOf('/** 카테고리별 구매 통화'),
  );
  check('EXE와 같이 ProductStock를 사용하고 StockMaster.isFix로 필터하지 않음',
    !/smk\.isFix/.test(stockBlock) && /FROM ProductStock ps/.test(stockBlock));
  check('직접 단가 증거는 동일 OrderYear+OrderWeek+ProdKey에 VERIFIED로 조인',
    /spe\.ProdKey=p\.ProdKey/.test(stockBlock)
    && /spe\.OrderYear=smk\.OrderYear AND spe\.OrderWeek=smk\.OrderWeek/.test(stockBlock)
    && /spe\.EvidenceStatus=N'VERIFIED'/.test(stockBlock));
  check('도착원가 증거도 동일 연도·차수·품목·단위와 사용자 확정을 요구',
    /arrivalPriceEvidenceByProduct\(orderYear, week\)/.test(stockBlock)
    && /VERIFIED_ARRIVAL_COST/.test(stockBlock));
  check('재고평가 SQL에 recentCost/Product.Cost/landed fallback 없음',
    !/OUTER APPLY|Product\.Cost|recentCostCutoffSql|WarehouseDetail/.test(stockBlock));
  check('API가 E/F의 최종 선택 증거와 상태를 전달',
    /evidenceValue: resolvedEnd\?\.value/.test(apiSource)
    && /priceEvidenceStatus: resolvedEnd\?\.status/.test(apiSource)
    && /evidenceValue: resolvedBegin\?\.value/.test(apiSource)
    && /priceEvidenceStatus: resolvedBegin\?\.status/.test(apiSource));
  check('API가 E/F의 선택된 원천을 화면에 전달',
    /priceEvidenceSources: resolvedEnd\?\.sources/.test(apiSource)
    && /priceEvidenceSources: resolvedBegin\?\.sources/.test(apiSource));
  check('단위 혼재·환산 누락 시 카테고리 평균원가를 적용하지 않음',
    /conversionMissing: endConversionMissing/.test(apiSource)
    && /unitMismatch: endUnitMismatch/.test(apiSource)
    && /prevConversionMissing: previousConversionMissing/.test(apiSource)
    && /prevUnitMismatch: previousUnitMismatch/.test(apiSource));
  check('직전 차수 단위 혼재 상태를 행 계산 범위에 안전하게 전달',
    /prevUnitMismatch: previousUnitMismatch/.test(apiSource)
    && /unitMismatch: previous\.unitMismatch === true/.test(apiSource));
  check('단위 환산 누락 품목번호와 단위를 감사 영역에 전달',
    /conversionIssues: stockEnd\.conversionIssues/.test(apiSource)
    && auditSource.includes('STOCK_END_UNIT_CONVERSION_MISSING')
    && auditSource.includes('STOCK_BEGIN_UNIT_CONVERSION_MISSING'));
  check('감사가 E/F 단가 증거 누락을 별도 오류로 차단',
    auditSource.includes('STOCK_BEGIN_PRICE_EVIDENCE_MISSING')
    && auditSource.includes('STOCK_END_PRICE_EVIDENCE_MISSING'));
  check('감사 문구가 최종값 직접입력 대신 단가 근거 등록을 요구',
    /E 최종값을 직접 입력하지 말고/.test(auditSource)
    && /F 최종값을 직접 입력하지 말고/.test(auditSource));

  console.log(`\n총 ${failed ? '실패' : '성공'} — 실패 ${failed}건`);
  process.exit(failed ? 1 : 0);
}

main().catch((error) => { console.error(error); process.exit(1); });
