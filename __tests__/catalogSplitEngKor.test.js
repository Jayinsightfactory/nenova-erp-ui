// node __tests__/catalogSplitEngKor.test.js
const assert = (label, cond) => {
  if (!cond) {
    console.error(`  FAIL ${label}`);
    process.exitCode = 1;
  } else {
    console.log(`  PASS ${label}`);
  }
};

const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

async function main() {
  const {
    compactProductKorHint,
    compactProductTitle,
    deriveCatalogNames,
    repairCatalogLineNames,
    splitEngKor,
  } = await import('../lib/catalogUtils.js');

  assert(
    'bracket prefix + slash',
    eq(splitEngKor('[ 오경] ROSE CHINA / 프라우드'), { eng: 'ROSE CHINA', kor: '프라우드' }),
  );
  assert(
    'compact title strips paren kor',
    eq(compactProductTitle({ ProdName: 'ROSE CHINA (프라우드)' }), 'ROSE CHINA'),
  );
  assert(
    'compact kor hint from paren',
    eq(compactProductKorHint({ ProdName: 'ROSE CHINA (프라우드)' }), '프라우드'),
  );
  assert(
    'compact title from slash display',
    eq(compactProductTitle({ DisplayName: '[ 오경] ROSE CHINA / 프라우드' }), 'ROSE CHINA'),
  );
  assert(
    'mixed eng+kor',
    eq(splitEngKor('ROSE RED 장미'), { eng: 'ROSE RED', kor: '장미' }),
  );
  assert(
    'derive from DisplayName',
    eq(
      deriveCatalogNames({
        DisplayName: '[ 오경] ROSE CHINA / 프라우드',
        ProdName: 'ROSE CHINA',
      }),
      { engName: 'ROSE CHINA', korName: '프라우드' },
    ),
  );
  assert(
    'repair broken eng',
    eq(
      repairCatalogLineNames({
        engName: '[',
        korName: '오경] ROSE CHINA / 프라우드',
        prodName: '[ 오경] ROSE CHINA / 프라우드',
      }),
      { engName: 'ROSE CHINA', korName: '프라우드' },
    ),
  );
}

main();
