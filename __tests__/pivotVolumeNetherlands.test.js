const assert = require('assert');
const fs = require('fs');
const path = require('path');

async function main() {
  const {
    buildPivotVolumeIdentityColumns,
    isNetherlandsVolume,
    pivotVolumeFlowerLabel,
  } = await import('../lib/pivotVolumeNetherlands.js');

  const dutch = buildPivotVolumeIdentityColumns({ country: '네덜란드', sheetName: '네덜란드' });
  assert.deepStrictEqual(dutch.map((column) => column.type), ['flower', 'product', 'color']);
  assert.strictEqual(pivotVolumeFlowerLabel({ flower: ' 튤립 ' }), '튤립');
  assert.strictEqual(isNetherlandsVolume({ country: ' 네덜란드 ' }), true);

  const china = buildPivotVolumeIdentityColumns({ country: '중국', sheetName: '중국' });
  assert.deepStrictEqual(china.map((column) => column.type), ['product']);
  assert.strictEqual(isNetherlandsVolume({ country: '중국' }), false);

  const source = fs.readFileSync(path.join(process.cwd(), 'pages/api/stats/pivot-volume-excel.js'), 'utf8');
  assert.ok(source.includes("aoa[2][idx] = '꽃'"), '네덜란드 꽃 열 헤더가 있어야 한다.');
  assert.ok(source.includes('`${customerName}\\n${cl}`'), '네덜란드 업체명은 윗줄, CL 코드는 아랫줄이어야 한다.');
  assert.ok(source.includes('const DUTCH_CUSTOMER_COL_WCH = 10'), '네덜란드 업체 열은 한 값으로 통일하고 이름은 셀 폭에 따라 자연스럽게 줄바꿈해야 한다.');
  assert.ok(source.includes("col.type === 'customer' ? isNetherlandsVolume(meta) ? DUTCH_CUSTOMER_COL_WCH"), '거래처별 이름 길이에 따라 열 폭이 달라지면 안 된다.');
  assert.ok(source.includes('horizontal: \'center\', vertical: \'center\''), '요일·수량·가격 셀은 가운데 기준을 사용해야 한다.');
  assert.ok(source.includes('pivotCustomerQuantity(row, col.customer)'), '업체명 중복을 피하고 CustKey별 수량을 엑셀에 출력해야 한다.');
  assert.ok(source.includes('line.push(pivotVolumeFlowerLabel(row))'), '꽃 열은 피벗 Product.FlowerName 값을 사용해야 한다.');
  assert.ok(source.includes('xSplit: isNetherlandsVolume(meta) ? 3 : 1'), '네덜란드 식별 3열을 고정해야 한다.');
  assert.ok(source.includes('shortVolumeFlowerLabel') && source.includes('replace(/-/g, \'\')'), '물량표 제목은 차수-품종 축약 표기를 사용해야 한다.');
  assert.ok(source.includes("colPlan.push({ type: 'farm-total', label: '입고' })"), '농장 우측 끝에 입고 합계 열을 추가해야 한다.');
  assert.ok(source.includes("col.type === 'summary' && col.label === '재고') line.push('')"), '재고 열은 공란이어야 한다.');
  assert.ok(source.includes('F1F3F5') && source.includes('border: BORDER'), '품목 행 교차색과 모든 셀 테두리를 적용해야 한다.');
  assert.ok(source.includes("[{ hpt: 32 }, { hpt: 20 }, { hpt: 44 }]"), '두 줄 제목이 잘리지 않도록 제목 행 높이를 확보해야 한다.');

  console.log('pivot Netherlands flower column tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
