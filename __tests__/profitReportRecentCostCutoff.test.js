// 과거 recentCost cutoff가 E/F 계산 경로와 공개 helper에 남지 않았는지 검증한다.
// 비공식 카테고리의 품목단가 fallback은 정확한 차수의 VERIFIED 증거만 사용한다.
// 원본 workbook 수식 카테고리의 (G+H)/매입수량*재고수량은 API 계산층에서 별도로 적용한다.
const fs = require('fs');
const path = require('path');

let failed = 0;
const check = (label, condition) => {
  if (condition) console.log(`  ✓ ${label}`);
  else {
    console.error(`  ✗ ${label}`);
    failed += 1;
  }
};

async function main() {
  const root = path.resolve(__dirname, '..');
  const reportSource = fs.readFileSync(path.join(root, 'lib', 'profitReport.js'), 'utf8');
  const stockBlock = reportSource.slice(
    reportSource.indexOf('export async function stockSnapshotByCategory'),
    reportSource.indexOf('/** 카테고리별 구매 통화'),
  );

  check('과거 recentCost helper 제거', !/export function recentCostCutoffSql|export function splitOrderWeek/.test(reportSource));
  check('stockSnapshotByCategory 함수 블록 파싱', stockBlock.length > 100);
  check('최근 입고/Product.Cost fallback 없음', !/OUTER APPLY|WarehouseDetail|Product\.Cost|recentCostCutoffSql/.test(stockBlock));
  check('품목단가 fallback은 정확한 차수의 VERIFIED 단가 증거만 조인',
    /LEFT JOIN WebStockPriceEvidence/.test(stockBlock)
    && /spe\.OrderYear=smk\.OrderYear AND spe\.OrderWeek=smk\.OrderWeek/.test(stockBlock)
    && /spe\.EvidenceStatus=N'VERIFIED'/.test(stockBlock));
  check('EXE ProductStock 수량을 사용하고 StockMaster.isFix로 필터하지 않음',
    /FROM ProductStock ps/.test(stockBlock) && !/smk\.isFix/.test(stockBlock));

  const apiSource = fs.readFileSync(path.join(root, 'pages', 'api', 'sales', 'profit-report.js'), 'utf8');
  check('01차 전년 52차 재고 호출 유지',
    /currentMajor <= 1 \? String\(Number\(orderYear\) - 1\)/.test(apiSource)
    && /currentMajor <= 1 \? '52'/.test(apiSource)
    && /stockSnapshotByCategory\(prevMajor, prevOrderYear\)/.test(apiSource));

  console.log(`\n총 ${failed ? '실패' : '성공'} — 실패 ${failed}건`);
  process.exit(failed ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
