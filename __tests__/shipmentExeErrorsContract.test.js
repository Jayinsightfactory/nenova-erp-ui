const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

async function main() {
  const root = path.join(__dirname, '..');
  const api = fs.readFileSync(path.join(root, 'pages/api/shipment/exe-errors.js'), 'utf8');
  const page = fs.readFileSync(path.join(root, 'pages/shipment/exe-errors.js'), 'utf8');
  const distribute = fs.readFileSync(path.join(root, 'pages/api/shipment/distribute.js'), 'utf8');
  const distributeSp = fs.readFileSync(path.join(root, 'pages/api/shipment/distribute-sp.js'), 'utf8');

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

  console.log('shipment exe error diagnostic contract tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
