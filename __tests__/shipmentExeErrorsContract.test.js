const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

async function main() {
  const root = path.join(__dirname, '..');
  const api = fs.readFileSync(path.join(root, 'pages/api/shipment/exe-errors.js'), 'utf8');
  const page = fs.readFileSync(path.join(root, 'pages/shipment/exe-errors.js'), 'utf8');
  const distribute = fs.readFileSync(path.join(root, 'pages/api/shipment/distribute.js'), 'utf8');
  const distributeSp = fs.readFileSync(path.join(root, 'pages/api/shipment/distribute-sp.js'), 'utf8');
  const diagnose = fs.readFileSync(path.join(root, 'pages/api/shipment/distribute-diagnose.js'), 'utf8');
  const stockStatus = fs.readFileSync(path.join(root, 'pages/api/shipment/stock-status.js'), 'utf8');
  const stockAdjust = fs.readFileSync(path.join(root, 'pages/api/stock/adjust-batch.js'), 'utf8');
  const shipmentFix = fs.readFileSync(path.join(root, 'pages/api/shipment/fix.js'), 'utf8');
  const shipmentImportPrealign = fs.readFileSync(path.join(root, 'pages/api/shipment/distribute-import-prealign.js'), 'utf8');
  const shipmentIndex = fs.readFileSync(path.join(root, 'pages/api/shipment/index.js'), 'utf8');

  const sqlBlocks = api.match(/sql:\s*`[\s\S]*?`/g) || [];
  assert.equal(sqlBlocks.length, 10, '전산 오류 진단 검사 수가 임의로 줄거나 늘지 않았는지 확인');
  for (const [index, block] of sqlBlocks.entries()) {
    assert.match(block, /@orderYear/, `오류 검사 ${index + 1}번은 선택 연도로 격리해야 한다.`);
  }
  assert.match(api, /CAST\(om\.OrderYear AS NVARCHAR\(4\)\)=CAST\(sm\.OrderYear AS NVARCHAR\(4\)\)/, '고스트 검사는 주문과 분배의 연도까지 일치시켜야 한다.');
  assert.match(api, /const r = await query\(c\.sql, params\)/, '모든 진단 검사에 week·orderYear·expectedYw 파라미터를 전달해야 한다.');
  assert.match(api, /filter\(c => c\.scope !== 'cross-year-candidate'\)/, '교차연도 후보는 선택연도 오류 합계와 분리해야 한다.');
  assert.match(api, /crossYearIssues:/, '교차연도 후보 건수를 별도로 반환해야 한다.');
  assert.match(api, /operations: \[/, '오류 원인별 발생 가능 작업을 API 메타데이터로 제공해야 한다.');

  assert.match(page, /year=\$\{encodeURIComponent\(year\)\}/, '진단 화면은 선택 연도를 API에 전달해야 한다.');
  assert.match(page, /발생 가능 작업/, '진단 화면에 발생 가능 작업을 표시해야 한다.');
  assert.match(page, /교차연도 후보/, '진단 화면에서 교차연도 후보를 별도 구분해야 한다.');

  assert.match(
    distribute,
    /WHERE CustKey=@ck AND OrderYear=@yr AND OrderWeek=@week AND isDeleted=0/,
    '일반 출고분배의 ShipmentMaster 재사용은 연도를 포함해야 한다.'
  );
  assert.match(distribute, /yr:\s*\{ type: sql\.NVarChar, value: String\(orderYear\) \}/, '일반 출고분배 Master 조회에 활성 연도를 전달해야 한다.');

  assert.match(distributeSp, /WHERE om\.OrderYear=@yr AND om\.OrderWeek=@wk/, 'SP 품목그룹 조회도 연도와 차수를 함께 필터링해야 한다.');
  assert.match(distributeSp, /WHERE sm\.OrderYear=@yr AND sm\.OrderWeek=@wk/, 'SP 확정검사·사후검증도 연도와 차수를 함께 필터링해야 한다.');
  assert.match(distributeSp, /loadSummary\(tQ, orderYear, week/, 'SP 사후검증은 실행한 연도를 사용해야 한다.');

  assert.match(diagnose, /CAST\(sm\.OrderYear AS NVARCHAR\(4\)\)=@yr AND sm\.OrderWeek=@wk/, '진단·보정 API의 ShipmentMaster 변경은 선택 연도로 격리해야 한다.');
  assert.match(diagnose, /CAST\(OrderYear AS NVARCHAR\(4\)\)=@yr AND OrderWeek=@wk/, '확정 여부 검사도 차수 단독으로 조회하면 안 된다.');
  assert.match(diagnose, /yr:\s*\{ type: sql\.NVarChar, value: orderYear \}/, '진단·보정 트랜잭션에 선택 연도를 전달해야 한다.');
  assert.match(diagnose, /repairZeroOut/, '0수량 빈 분배는 선택 연도 범위의 안전한 보정 경로를 가져야 한다.');
  assert.match(diagnose, /ISNULL\(sm\.isFix,0\)<>1 AND ISNULL\(sd\.isFix,0\)<>1/, '0수량 정리는 확정된 ShipmentMaster/Detail을 보존해야 한다.');

  assert.match(stockStatus, /view === 'cleanupZero'/, '재고 진단의 0수량 정리 경로가 존재해야 한다.');
  assert.match(stockStatus, /sm\.OrderYear=@orderYear[\s\S]{0,160}ISNULL\(sd\.OutQuantity,0\)=0/, '0수량 정리는 선택 연도·차수 범위로 제한해야 한다.');
  assert.match(stockStatus, /DELETE sd[\s\S]{0,260}sm\.OrderYear=@orderYear[\s\S]{0,260}ISNULL\(sd\.OutQuantity,0\)=0/, 'ShipmentDetail 임의 삭제를 막고 빈 레코드만 제한적으로 정리해야 한다.');
  assert.match(stockStatus, /if \(view === 'cleanupZero'\)[\s\S]{0,240}req\.query\.confirm[\s\S]{0,240}repairZeroOut/, '기존 GET 정리 경로는 명시적 확인 없이는 실행되지 않아야 한다.');
  assert.match(stockStatus, /sm2\.OrderYear=@orderYear[\s\S]{0,120}sm2\.OrderWeek < @weekFrom/, '잔량 기초재고도 선택 연도에 격리해야 한다.');

  assert.match(stockAdjust, /async function isWeekFixed\(orderYear, orderWeek\)/, '재고 일괄수정의 확정 검사에 연도와 차수를 함께 전달해야 한다.');
  assert.match(stockAdjust, /OrderYear=@yr AND OrderWeek=@wk/, '재고 일괄수정의 확정 검사는 다른 연도의 동일 차수를 섞으면 안 된다.');
  assert.match(stockAdjust, /isWeekFixed\(orderYear, week\)/, '재고 일괄수정은 해석된 연도로 확정 상태를 검사해야 한다.');

  assert.match(shipmentFix, /OrderYear=@yr AND OrderWeek=@wk AND isFix=1/, '확정 여부 재검사는 연도와 차수를 함께 사용해야 한다.');
  assert.match(shipmentFix, /sm\.OrderYear = @yr AND sm\.OrderWeek = @wk/, '확정 사전검증의 출고 조회는 연도와 차수를 함께 사용해야 한다.');
  assert.match(shipmentImportPrealign, /assertProductsNotFixed\(orderYear, normalizedWeek, prodKeys\)/, '엑셀 분배 사전검증은 선택 연도를 전달해야 한다.');
  assert.match(shipmentImportPrealign, /sm\.OrderYear=@orderYear[\s\S]{0,80}sm\.OrderWeek=@week/, '엑셀 분배 사전검증·사후검증은 연도와 차수로 격리해야 한다.');
  assert.match(shipmentIndex, /vs\.OrderWeek = @week AND vs\.OrderYear = @orderYear/, '출고 목록 조회도 다른 연도의 동일 차수를 섞으면 안 된다.');

  console.log('shipment exe error diagnostic contract tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
