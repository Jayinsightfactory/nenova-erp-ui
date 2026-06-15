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
    findMappingKorNameByProdKey,
    resolveCatalogProductNames,
  } = await import('../lib/catalogNameResolve.js');

  const mappings = {
    '콜롬비아 수국 다크핑크': {
      prodKey: 100,
      displayName: '수국 다크핑크',
      prodName: 'HYDRANGEA DARK PINK',
    },
  };

  assert('mapping lookup', findMappingKorNameByProdKey(100, mappings) === '콜롬비아 수국 다크핑크');

  const prod = {
    ProdKey: 100,
    ProdName: 'HYDRANGEA DARK PINK',
    DisplayName: '',
    mappingKorName: '콜롬비아 수국 다크핑크',
  };
  const names = resolveCatalogProductNames(prod, prod.mappingKorName);
  assert('kor from mapping', names.korName.includes('수국'));
  assert('eng from prod', names.engName.length > 0);
  assert('kor source mapping', names.korSource === 'mapping');
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
