const assert = require('node:assert/strict');

async function main() {
  const { isFlowerFamilyMismatch, matchImportRow } = await import('../lib/orderImportMatch.js');

  const hydrangea = {
    ProdKey: 100,
    ProdName: 'Hydrangea White (화이트)',
    DisplayName: '수국 화이트',
    FlowerName: '수국',
    CountryFlower: '콜롬비아 수국',
    CounName: '콜롬비아',
    OutUnit: '박스',
  };
  const chinaOther = {
    ProdKey: 200,
    ProdName: '[MEL] CHINA / 리모늄 시네신스 화이트 500g',
    DisplayName: '시네신스 화이트',
    FlowerName: '기타',
    CountryFlower: '중국 기타',
    CounName: '중국',
    OutUnit: '박스',
  };

  assert.equal(isFlowerFamilyMismatch('수국 화이트', hydrangea), false);
  assert.equal(isFlowerFamilyMismatch('수국 화이트', chinaOther), true);
  assert.equal(isFlowerFamilyMismatch('화이트', chinaOther), false, '품종 문맥이 없으면 임의 화종을 강제하지 않는다');

  const matched = matchImportRow(
    { rowNo: 1, inputName: '수국 화이트', qty: 3, unit: '박스' },
    {
      allProducts: [chinaOther, hydrangea],
      productByKey: new Map([[100, hydrangea], [200, chinaOther]]),
      prodUnitMap: { 100: '박스', 200: '박스' },
      savedMappings: {
        '수국 화이트': { prodKey: 200, prodName: chinaOther.ProdName, flowerName: '기타', counName: '중국', auto: true },
      },
      unitCatalog: {},
    },
  );

  assert.equal(matched.prodKey, 100, '잘못 저장된 중국 기타 매핑을 거부하고 수국 화이트를 선택한다');
  assert.equal(matched.fromMapping, false, '화종 충돌 저장 매핑은 재사용하지 않는다');
  assert.equal(matched.flowerName, '수국');
  assert.ok(matched.suggestedProducts.every((item) => item.flowerName === '수국'));

  const { lookupSavedProductMapping } = await import('../lib/pasteLocalMapping.js');
  assert.equal(
    lookupSavedProductMapping('수국 화이트', { '수국 화이트': { prodKey: 200 } }, [chinaOther]).ok,
    false,
    '브라우저 재분석 캐시도 수국 문맥과 충돌하는 중국 기타 매핑을 거부한다',
  );

  console.log('paste hydrangea context tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
