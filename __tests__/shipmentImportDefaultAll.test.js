const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(process.cwd(), 'pages/shipment/distribute-import.js'), 'utf8');

function assert(label, condition) {
  if (!condition) {
    console.error(`  FAIL ${label}`);
    process.exitCode = 1;
    return;
  }
  console.log(`  PASS ${label}`);
}

console.log('\n=== 출고분배 엑셀 검증 기본 표시 계약 ===');
assert('검증 결과가 있으면 전체 업체·수량을 기본 표시', source.includes("setFilter(rowCount > 0 ? 'all' : 'apply')"));
assert('적용대상 존재 여부로 기본 필터를 숨기지 않음', !source.includes("const nextFilter = applyCount > 0 ? 'apply'"));
assert('검증 완료 안내에 전체 표시 상태 명시', source.includes('(전체 업체·수량 표시)'));

if (!process.exitCode) console.log('\n=== RESULT: all passed ===');
