// node __tests__/catalogNameResolve.test.js
const assert = (label, cond) => {
  if (!cond) {
    console.error(`  FAIL ${label}`);
    process.exitCode = 1;
  } else {
    console.log(`  PASS ${label}`);
  }
};

async function main() {
  const {
    findCatalogMatchByProdKey,
    findMappingKorNameByProdKey,
    resolveCatalogProductNames,
  } = await import('../lib/catalogNameResolve.js');

  const mappings = {
    '콜롬비아 수국 다크핑크': {
      prodKey: 100,
      displayName: '수국 다크핑크',
      prodName: 'HYDRANGEA DARK PINK',
    },
    '콜롬비아 장미 queens crown': {
      prodKey: 200,
      displayName: '퀸즈 크라운',
      engName: 'Queens crown',
      source: 'catalog',
    },
  };

  assert('mapping lookup', findMappingKorNameByProdKey(100, mappings) === '수국 다크핑크');

  const prod = {
    ProdKey: 100,
    ProdName: 'HYDRANGEA DARK PINK',
    DisplayName: '',
    mappingKorName: '콜롬비아 수국 다크핑크',
  };
  const names = resolveCatalogProductNames(prod, prod.mappingKorName, mappings);
  assert('kor from mapping', names.korName.includes('수국'));
  assert('eng from prod', names.engName.length > 0);

  const saved = findCatalogMatchByProdKey(200, mappings);
  assert('catalog match lookup', saved?.korName === '퀸즈 크라운');
  const names2 = resolveCatalogProductNames({ ProdKey: 200, ProdName: 'ROSE X' }, null, mappings);
  assert('catalog saved names', names2.korName === '퀸즈 크라운' && names2.korSource === 'catalog');
  assert('catalog saved eng', names2.engName === 'Queens crown');
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
