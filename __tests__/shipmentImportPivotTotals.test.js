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

console.log('\n=== 업로드 분배 피벗 전체/필터 합계 계약 ===');
assert('전체 행 피벗 모델을 필터 모델과 별도로 계산', source.includes('const fullPivotModel = useMemo(() => buildPivotModel(rows), [rows]);'));
assert('피벗에 전체 모델 전달', source.includes('fullModel={fullPivotModel}'));
assert('업체 헤더는 전체 엑셀 수량을 표시', source.includes('전체 엑셀 {fmt(fullCustomer.uploadQty)}'));
assert('필터 합계가 다르면 현재 표시 수량을 구분', source.includes('현재 표시 ${fmt(c.uploadQty)}'));

if (!process.exitCode) console.log('\n=== RESULT: all passed ===');
