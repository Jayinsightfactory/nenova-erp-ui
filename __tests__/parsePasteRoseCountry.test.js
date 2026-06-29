// 장미 국가 기본값 — 콜롬비아, 중국은 명시 시에만
// 실행: node __tests__/parsePasteRoseCountry.test.js

async function main() {
  const {
    wantsChinaRoseInput,
    wantsColombiaRoseInput,
    filterRoseCandidatesByCountry,
    isChinaRoseProduct,
    isColombiaRoseProduct,
  } = await import('../lib/parsePasteRoseCountry.js');

  let pass = 0;
  let fail = 0;
  const assert = (label, cond) => {
    if (cond) pass++;
    else { fail++; console.log(`  ✗ ${label}`); }
  };

  const colProud = { prod: { ProdKey: 1, ProdName: 'ROSE / Proud 50cm', CounName: '콜롬비아' }, score: 90 };
  const cnProud = { prod: { ProdKey: 2, ProdName: 'ROSE CHINA / Proud', CounName: '중국' }, score: 88 };

  console.log('=== wantsChinaRoseInput ===');
  assert('중국', wantsChinaRoseInput('중국 프라우드'));
  assert('中', wantsChinaRoseInput('中 프라우드'));
  assert('중 단독', wantsChinaRoseInput('프라우드 중 2단'));
  assert('china', wantsChinaRoseInput('china proud'));
  assert('프라우드만 → false', !wantsChinaRoseInput('프라우드 2단'));
  assert('콜롬비아만 → false', !wantsChinaRoseInput('콜롬비아 프라우드'));

  console.log('\n=== filterRoseCandidatesByCountry — 기본 콜롬비아 ===');
  const def = filterRoseCandidatesByCountry('프라우드', [cnProud, colProud]);
  assert('기본 콜롬비아', def.candidates[0].prod.ProdKey === 1);
  assert('note', def.countryNote === 'colombia-default');

  console.log('\n=== filterRoseCandidatesByCountry — 중국 명시 ===');
  const cn = filterRoseCandidatesByCountry('중국 프라우드', [cnProud, colProud]);
  assert('중국 선택', cn.candidates[0].prod.ProdKey === 2);

  console.log('\n=== isChinaRoseProduct / isColombiaRoseProduct ===');
  assert('중국', isChinaRoseProduct(cnProud.prod));
  assert('콜롬비아', isColombiaRoseProduct(colProud.prod));

  console.log(`\n=== RESULT: ${pass} pass, ${fail} fail ===`);
  if (fail) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
