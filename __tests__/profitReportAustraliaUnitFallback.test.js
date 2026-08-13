// 호주를 포함한 모든 카테고리의 E/F는 확정 ProductStock와 정확한 차수의 VERIFIED 단가 증거만 사용한다.
// 과거의 Product.Cost/recentCost/landed-cost/Australia 단위 fallback이 되살아나지 않는지 검증한다.
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

  console.log('=== VERIFIED 재고단가 증거만 E/F 자동값으로 채택 ===');
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

  const missingEvidence = { ...verified, priceEvidenceStatus: 'INPUT_REQUIRED', evidenceValue: null };
  check('단가 증거가 없으면 모든 레거시 fallback 값이 있어도 null', computeAutoEndingStock(missingEvidence) == null);
  check('단가 증거 누락 원천 태그', endingStockSourceKind(missingEvidence) === 'missing_price_evidence');

  const missingSnapshot = { ...verified, snapshotConfirmed: false };
  check('확정 ProductStock가 아니면 VERIFIED 단가가 있어도 null', computeAutoEndingStock(missingSnapshot) == null);
  check('스냅샷 누락 원천 태그', endingStockSourceKind(missingSnapshot) === 'missing_stock_snapshot');

  check('확정 스냅샷의 재고수량 0은 단가 증거 없이도 0',
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
  check('확정 StockMaster와 ProductStock를 사용',
    /ISNULL\(smk\.isFix,0\)=1/.test(stockBlock) && /FROM ProductStock ps/.test(stockBlock));
  check('단가 증거는 동일 OrderYear+OrderWeek+ProdKey에 VERIFIED로 조인',
    /spe\.ProdKey=p\.ProdKey/.test(stockBlock)
    && /spe\.OrderYear=smk\.OrderYear AND spe\.OrderWeek=smk\.OrderWeek/.test(stockBlock)
    && /spe\.EvidenceStatus=N'VERIFIED'/.test(stockBlock));
  check('재고평가 SQL에 recentCost/Product.Cost/landed fallback 없음',
    !/OUTER APPLY|Product\.Cost|recentCostCutoffSql|WarehouseDetail/.test(stockBlock));
  check('API가 E/F 모두 evidenceValue와 priceEvidenceStatus를 전달',
    /evidenceValue: stockEnd\.values/.test(apiSource)
    && /priceEvidenceStatus: stockEnd\.priceEvidenceStatus/.test(apiSource)
    && /evidenceValue: stockBegin\.values/.test(apiSource)
    && /priceEvidenceStatus: stockBegin\.priceEvidenceStatus/.test(apiSource));
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
