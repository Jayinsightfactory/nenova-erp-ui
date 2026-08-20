// 콜롬비아 4품목(장미/카네이션/알스트로/루스커스) 분류 — 영문 FlowerName/ProdName 인식 회귀 검증.
// 2026-08-12 결함수정: lib/customsForwarding.js의 CASE_COLOMBIA_ALLOC(SQL, colombiaBoxQtyByCategory
// 전용)이 FlowerName 한글만 매칭해 English ROSE/CARNATION/ALSTROEMERIA/RUSCUS 품목이 그외통관비
// 무게배분(박스당무게×박스수량 비율)에서 누락됐다. lib/colombiaFlowerClassification.js(JS 단일
// 진실 소스)와 customsForwarding.js의 SQL CASE_COLOMBIA_ALLOC 양쪽을 대조한다.
// 실행: node __tests__/colombiaFlowerClassification.test.js
const fs = require('fs');
const path = require('path');

let failed = 0;
const check = (label, condition, detail = '') => {
  if (condition) console.log(`  ✓ ${label}`);
  else {
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
    failed += 1;
  }
};

async function main() {
  const { classifyColombiaAllocCategory, COLOMBIA_ALLOC_TOKEN_MAP, COLOMBIA_ALLOC_CATEGORY_KEYS,
    colombiaAllocCategories, isColombiaSharedApolloShipment, isColombiaSharedApolloContext, COLOMBIA_HYDRANGEA_CATEGORY,
    COLOMBIA_ALLOC_POOL_DEFAULT, COLOMBIA_ALLOC_POOL_WITH_HYDRANGEA, isColombiaHydrangeaPool, applyColombiaHydrangeaBoxes } =
    await import('../lib/colombiaFlowerClassification.js');
  const { isNonStockableItem } = await import('../lib/profitReportClassification.js');
  const forwardingSource = fs.readFileSync(path.join(__dirname, '..', 'lib', 'customsForwarding.js'), 'utf8');

  console.log('=== 영문 FlowerName/ProdName 인식 (요청사항 6번 — 특히 English ROSE) ===');
  check("English ROSE FlowerName → 콜롬비아 장미", classifyColombiaAllocCategory('ROSE', 'ROSE FREEDOM') === '콜롬비아 장미');
  check("소문자 rose도 인식", classifyColombiaAllocCategory('rose', 'rose freedom') === '콜롬비아 장미');
  check("FlowerName은 비었지만 ProdName에만 영문 품종이 있는 경우도 인식(ROSE)",
    classifyColombiaAllocCategory('', 'ROSE FREEDOM') === '콜롬비아 장미');
  check("English CARNATION → 콜롬비아 카네이션", classifyColombiaAllocCategory('CARNATION', 'STANDARD CARNATION') === '콜롬비아 카네이션');
  check("English ALSTROEMERIA → 콜롬비아 알스트로", classifyColombiaAllocCategory('ALSTROEMERIA', 'ALSTROEMERIA VIRGINIA') === '콜롬비아 알스트로');
  check("English RUSCUS → 콜롬비아 루스커스", classifyColombiaAllocCategory('RUSCUS', 'ISRAELI RUSCUS') === '콜롬비아 루스커스');
  check("한글 장미도 계속 인식(회귀 없음)", classifyColombiaAllocCategory('장미', 'ROSE') === '콜롬비아 장미');
  check("한글 카네이션도 계속 인식(회귀 없음)", classifyColombiaAllocCategory('카네이션', '') === '콜롬비아 카네이션');
  check("한글 알스트로도 계속 인식(회귀 없음)", classifyColombiaAllocCategory('알스트로', '') === '콜롬비아 알스트로');
  check("한글 루스커스도 계속 인식(회귀 없음)", classifyColombiaAllocCategory('루스커스', '') === '콜롬비아 루스커스');
  check("매칭 실패 → null", classifyColombiaAllocCategory('HYDRANGEA', '수국') === null);
  check("빈 값 → null", classifyColombiaAllocCategory('', '') === null);

  console.log('\n=== 배분 풀은 화면 선택. SQL 4키는 유지 ===');
  check('SQL 배분 키는 4개 고정', COLOMBIA_ALLOC_CATEGORY_KEYS.length === 4 && !COLOMBIA_ALLOC_CATEGORY_KEYS.includes(COLOMBIA_HYDRANGEA_CATEGORY));
  check('기본 라벨은 콜카장알루', COLOMBIA_ALLOC_POOL_DEFAULT === '콜카장알루');
  check('추가 선택은 콜카장알루수국', COLOMBIA_ALLOC_POOL_WITH_HYDRANGEA === '콜카장알루수국');
  check('NULL/0은 콜카장알루', isColombiaHydrangeaPool(null) === false && isColombiaHydrangeaPool(0) === false);
  check('1과 콜카장알루수국만 수국 포함', isColombiaHydrangeaPool(1) === true && isColombiaHydrangeaPool('콜카장알루수국') === true);
  check('수국 미포함 기본 풀은 4품목', colombiaAllocCategories().length === 4);
  check('수국 포함 풀은 수국+4품목', JSON.stringify(colombiaAllocCategories({ includeHydrangea: true }))
    === JSON.stringify([COLOMBIA_HYDRANGEA_CATEGORY, ...COLOMBIA_ALLOC_CATEGORY_KEYS]));
  check('기본 apply는 수국 박스를 빼다', applyColombiaHydrangeaBoxes({ '콜롬비아 장미': 2, '콜롬비아 수국': 9 }, 9, false)['콜롬비아 수국'] == null);
  check('콜카장알루수국 apply만 수국 박스를 넣는다', applyColombiaHydrangeaBoxes({ '콜롬비아 장미': 2 }, 9, true)['콜롬비아 수국'] === 9);
  check('APOLLO+수국+장미 → 공유 배송', isColombiaSharedApolloShipment({
    farmName: 'FREIGHTWISE', invoiceNo: 'APOLLO 콜카장', flowerNames: ['수국', '장미'],
  }) === true);
  check('APOLLO+수국만 → 공유 아님', isColombiaSharedApolloShipment({
    farmName: 'FREIGHTWISE', invoiceNo: '콜수국', flowerNames: ['Hydrangea'],
  }) === false);
  check('농장 인보이스에 수국+장미여도 APOLLO가 아니면 공유 아님', isColombiaSharedApolloShipment({
    farmName: 'Flores De Funza', invoiceNo: 'INV-1', flowerNames: ['수국', '장미'],
  }) === false);
  check('카테고리 집합에 수국+카네이션이면 공유 문맥', isColombiaSharedApolloContext(['콜롬비아 수국', '콜롬비아 카네이션']) === true);
  check('수국만 있으면 공유 문맥 아님', isColombiaSharedApolloContext(['콜롬비아 수국']) === false);

  console.log('\n=== 운송료/SERVICE FEE/GW·CW placeholder 행은 항상 제외(무게배분 대상 아님) ===');
  check("장미 운송료 placeholder는 제외", classifyColombiaAllocCategory('', '장미 운송료') === null);
  check("영문 ROSE라도 운송료 줄이면 제외", classifyColombiaAllocCategory('ROSE', '장미 운송료') === null);
  check("SERVICE FEE는 제외", classifyColombiaAllocCategory('ROSE', 'SERVICE FEE') === null);
  check("현지상차운임은 제외", classifyColombiaAllocCategory('ROSE', '현지상차운임') === null);
  check("Gross weight 줄은 제외", classifyColombiaAllocCategory('ROSE', 'Gross weight') === null);
  check("Chargeable weight 줄은 제외", classifyColombiaAllocCategory('CARNATION', 'Chargeable weight') === null);
  check('isNonStockableItem과 판정 기준 공유(중복 정의 없음)',
    isNonStockableItem('SERVICE FEE') === true && isNonStockableItem('ROSE FREEDOM') === false);

  console.log('\n=== 카테고리 키 4개 고정(엑셀 콜롬비아1차/2차 시트 순서: 장미/카네이션/알스트로/루스커스) ===');
  check('COLOMBIA_ALLOC_CATEGORY_KEYS 4개',
    JSON.stringify(COLOMBIA_ALLOC_CATEGORY_KEYS) === JSON.stringify(['콜롬비아 장미', '콜롬비아 카네이션', '콜롬비아 알스트로', '콜롬비아 루스커스']));
  check('토큰맵이 4개 카테고리 모두 커버', COLOMBIA_ALLOC_TOKEN_MAP.length === 4);
  for (const cat of COLOMBIA_ALLOC_CATEGORY_KEYS) {
    check(`${cat} 토큰맵에 한글+영문 토큰 모두 존재`,
      COLOMBIA_ALLOC_TOKEN_MAP.some((e) => e.key === cat && e.tokens.some((t) => /[가-힣]/.test(t)) && e.tokens.some((t) => /^[a-z]+$/.test(t))));
  }

  console.log('\n=== SQL(CASE_COLOMBIA_ALLOC) ↔ JS(classifyColombiaAllocCategory) 언어쌍 일치 ===');
  const caseBlock = forwardingSource.match(/const CASE_COLOMBIA_ALLOC = `([\s\S]*?)`;/);
  check('CASE_COLOMBIA_ALLOC 블록 파싱', Boolean(caseBlock));
  check('SQL이 FlowerName·ProdName 양쪽에서 영문 Rose를 매칭', /FlowerName.*LIKE N'%Rose%'/.test(caseBlock[1]) && /ProdName.*LIKE N'%Rose%'/.test(caseBlock[1]));
  check('SQL이 영문 Carnation을 매칭', /LIKE N'%Carnation%'/.test(caseBlock[1]));
  check('SQL이 영문 Alstro를 매칭', /LIKE N'%Alstro%'/.test(caseBlock[1]));
  check('SQL이 영문 Ruscus를 매칭', /LIKE N'%Ruscus%'/.test(caseBlock[1]));
  check('SQL이 한글 장미/카네이션/알스트로/루스커스도 계속 매칭(회귀 없음)',
    /%장미%/.test(caseBlock[1]) && /%카네이션%/.test(caseBlock[1]) && /%알스트로%/.test(caseBlock[1]) && /%루스커스%/.test(caseBlock[1]));
  const sqlKeys = new Set();
  const literalRe = /THEN\s+N'([^']+)'/g;
  let m;
  while ((m = literalRe.exec(caseBlock[1])) !== null) sqlKeys.add(m[1]);
  check('SQL 리터럴 카테고리 키 집합 = COLOMBIA_ALLOC_CATEGORY_KEYS',
    sqlKeys.size === COLOMBIA_ALLOC_CATEGORY_KEYS.length && COLOMBIA_ALLOC_CATEGORY_KEYS.every((k) => sqlKeys.has(k)),
    `SQL=${[...sqlKeys].sort().join(',')}`);

  console.log('\n=== 무게배분 SQL이 운송료/SERVICE FEE/GW·CW 행을 명시적으로 제외 ===');
  const excludeBlock = forwardingSource.match(/const COLOMBIA_ALLOC_EXCLUDE_SQL = `([\s\S]*?)`;/);
  check('COLOMBIA_ALLOC_EXCLUDE_SQL 블록 파싱', Boolean(excludeBlock));
  check('운송료/SERVICE FEE/현지상차운임 제외', /운송료/.test(excludeBlock[1]) && /SERVICE FEE/.test(excludeBlock[1]) && /현지상차운임/.test(excludeBlock[1]));
  check('GROSS WEIGHT/CHARGEABLE WEIGHT 제외', /GROSS WEIGHT/.test(excludeBlock[1]) && /CHARGEABLE WEIGHT/.test(excludeBlock[1]));
  check('colombiaBoxQtyByCategory가 이 제외조건을 실제로 사용',
    /colombiaBoxQtyByCategory[\s\S]{0,600}COLOMBIA_ALLOC_EXCLUDE_SQL/.test(forwardingSource));
  // customsForwarding.js는 COLOMBIA_ALLOC_CATEGORIES를 독립 리터럴로 다시 선언하지 않고
  // lib/customsForwardingCalc.js(→ colombiaFlowerClassification.js)에서 import/re-export한다
  // (2026-08-12: 그외통관비 입력화면 클라이언트 미리보기가 같은 상수를 재사용하도록 순수 계산 모듈로
  // 이동하면서 리터럴 중복도 함께 제거했다). 값 자체를 실제로 import해 대조한다(드리프트 원천 차단).
  check('customsForwarding.js가 COLOMBIA_ALLOC_CATEGORIES를 customsForwardingCalc.js에서 재노출(리터럴 재선언 없음)',
    /export\s*\{[^}]*\bCOLOMBIA_ALLOC_CATEGORIES\b[^}]*\}\s*from\s*'\.\/customsForwardingCalc\.js'/.test(forwardingSource)
    && !/export const COLOMBIA_ALLOC_CATEGORIES = \[/.test(forwardingSource));
  const { COLOMBIA_ALLOC_CATEGORIES } = await import('../lib/customsForwarding.js');
  check('customsForwarding.js COLOMBIA_ALLOC_CATEGORIES = colombiaFlowerClassification.js COLOMBIA_ALLOC_CATEGORY_KEYS(값·순서 일치, 드리프트 방지)',
    JSON.stringify(COLOMBIA_ALLOC_CATEGORIES) === JSON.stringify(COLOMBIA_ALLOC_CATEGORY_KEYS),
    `customsForwarding=${COLOMBIA_ALLOC_CATEGORIES.join(',')} / colombiaFlowerClassification=${COLOMBIA_ALLOC_CATEGORY_KEYS.join(',')}`);

  console.log(`\n총 ${failed ? '실패' : '성공'} — 실패 ${failed}건`);
  process.exit(failed ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
