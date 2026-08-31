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
  assert.ok(source.includes('line.push(pivotVolumeFlowerLabel(row))'), '꽃 열은 피벗 Product.FlowerName 값을 사용해야 한다.');
  assert.ok(source.includes('xSplit: isNetherlandsVolume(meta) ? 3 : 1'), '네덜란드 식별 3열을 고정해야 한다.');
  assert.ok(source.includes("\\n품종("), '모든 물량표 제목은 차수와 품종을 두 줄로 표시해야 한다.');
  assert.ok(source.includes("[{ hpt: 32 }, { hpt: 20 }, { hpt: 44 }]"), '두 줄 제목이 잘리지 않도록 제목 행 높이를 확보해야 한다.');

  console.log('pivot Netherlands flower column tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
