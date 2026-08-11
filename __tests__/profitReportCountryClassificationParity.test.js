// 국가/카테고리 분류 규칙의 SQL(profitReport.js CASE_CATEGORY) ↔ 공용 모듈(lib/countryClassification.js)
// ↔ 웹 전용 파서(lib/profitReportClassification.js) 3중 일치 회귀 검증.
// 2026-08-11 결함수정 2: CASE_CATEGORY(SQL)는 업무 규칙이 검증된 동작이라 재작성하지 않는다.
// 이 테스트는 그 SQL이 만들어내는 "카테고리 키 이름" 집합이 공용 모듈/JS 파서와 항상 같은지만 정적으로 대조한다.
// 실행: node __tests__/profitReportCountryClassificationParity.test.js
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

const sameSet = (a, b) => {
  const sa = new Set(a); const sb = new Set(b);
  if (sa.size !== sb.size) return false;
  for (const x of sa) if (!sb.has(x)) return false;
  return true;
};

async function main() {
  const {
    PROFIT_REPORT_CATEGORY_KEYS,
    COUNTRY_TOKEN_MAP,
    COUNTRY_CURRENCY_MAP,
    baseCountry,
    countryToCurrency,
  } = await import('../lib/countryClassification.js');
  const { CATEGORIES, EXTRA_CATEGORY, classifyCategory } = await import('../lib/profitReportClassification.js');
  const freightCalc = await import('../lib/freightCalc.js');

  const reportSource = fs.readFileSync(path.join(__dirname, '..', 'lib', 'profitReport.js'), 'utf8');
  const forwardingSource = fs.readFileSync(path.join(__dirname, '..', 'lib', 'customsForwarding.js'), 'utf8');

  console.log('=== CASE_CATEGORY(SQL) 카테고리 키 ↔ 공용 모듈 PROFIT_REPORT_CATEGORY_KEYS 일치 ===');
  const caseBlock = reportSource.match(/const CASE_CATEGORY = `([\s\S]*?)`;/);
  check('CASE_CATEGORY 블록 파싱', Boolean(caseBlock));
  const literalRe = /THEN\s+N'([^']+)'/g;
  const sqlKeys = new Set();
  let m;
  while ((m = literalRe.exec(caseBlock[1])) !== null) sqlKeys.add(m[1]);
  const elseMatch = caseBlock[1].match(/ELSE\s+N'([^']+)'/);
  if (elseMatch) sqlKeys.add(elseMatch[1]);
  check('SQL 리터럴 카테고리 키 집합 = 공용 모듈 PROFIT_REPORT_CATEGORY_KEYS',
    sameSet([...sqlKeys], PROFIT_REPORT_CATEGORY_KEYS),
    `SQL=${[...sqlKeys].sort().join(',')} / 공용=${[...PROFIT_REPORT_CATEGORY_KEYS].sort().join(',')}`);

  console.log('\n=== CASE_CATEGORY(SQL) ↔ profitReportClassification.js(JS) 카테고리 키 집합 일치 ===');
  const jsKeys = [...CATEGORIES.filter((c) => !c.manualOnly).map((c) => c.key), EXTRA_CATEGORY];
  check('SQL 키 집합 = JS CATEGORIES(공제 제외) + 기타(미분류)',
    sameSet([...sqlKeys], jsKeys),
    `SQL=${[...sqlKeys].sort().join(',')} / JS=${jsKeys.sort().join(',')}`);

  console.log('\n=== customsForwarding.js baseCountry가 공용 모듈을 재사용 ===');
  check('customsForwarding.js가 lib/countryClassification.js의 baseCountry를 import',
    /import\s*\{[^}]*baseCountry[^}]*\}\s*from\s*'\.\/countryClassification\.js'/.test(forwardingSource));
  check('customsForwarding.js 내부에 국가 매칭 로직이 중복 정의되어 있지 않음(if/includes 국가 나열 없음)',
    !/token\.includes\('호주'\)\s*\|\|\s*token\.includes\('australia'\)/.test(forwardingSource));

  console.log('\n=== baseCountry 한/영 별칭 매칭 (customsForwarding.js가 실제 쓰는 규칙) ===');
  const aliasCases = [
    ['Australia', '호주'], ['AUS', '호주'], ['호주', '호주'],
    ['Netherlands', '네덜란드'], ['네덜란드', '네덜란드'],
    ['Thailand', '태국'], ['태국', '태국'],
    ['China', '중국'], ['중국', '중국'],
    ['Ecuador', '에콰도르'], ['에콰도르', '에콰도르'],
    ['USA', '미국'], ['United States', '미국'], ['미국', '미국'],
    ['Israel', '이스라엘'], ['이스라엘', '이스라엘'],
    ['New Zealand', '뉴질랜드'], ['뉴질랜드', '뉴질랜드'],
    ['Japan', '일본'], ['일본', '일본'],
    ['Vietnam', '베트남'], ['베트남', '베트남'],
    ['Colombia', '콜롬비아'], ['콜롬비아', '콜롬비아'],
  ];
  for (const [input, expected] of aliasCases) {
    check(`baseCountry('${input}') = '${expected}'`, baseCountry(input) === expected, `실제=${baseCountry(input)}`);
  }
  check('baseCountry(국내/한국) = null(해외 아님)', baseCountry('국내') === null && baseCountry('한국') === null);
  check('baseCountry(빈값) = null', baseCountry('') === null && baseCountry(null) === null);
  check('COUNTRY_TOKEN_MAP에 모든 PROFIT_REPORT_CATEGORY_KEYS 단일국가가 매핑 대상으로 존재',
    ['네덜란드', '호주', '태국', '중국', '에콰도르', '미국', '이스라엘', '뉴질랜드', '일본', '베트남']
      .every((k) => COUNTRY_TOKEN_MAP.some((e) => e.key === k)));

  console.log('\n=== 결함1: 호주 통화 = AUD (freightCalc.js / lib/countryClassification.js) ===');
  check('freightCalc.countryToCurrency(호주) = AUD (이전 버그: USD)', freightCalc.countryToCurrency('호주') === 'AUD');
  check('countryClassification.countryToCurrency(호주) = AUD', countryToCurrency('호주') === 'AUD');
  check('영문 별칭도 AUD로 정규화: Australia', freightCalc.countryToCurrency('Australia') === 'AUD');
  check('영문 별칭도 AUD로 정규화: AUS', freightCalc.countryToCurrency('AUS') === 'AUD');
  check('COUNTRY_CURRENCY_MAP.호주 = AUD', COUNTRY_CURRENCY_MAP['호주'] === 'AUD');
  check('freightCalc.js가 공용 모듈의 countryToCurrency를 재사용(중복 매핑표 없음)',
    !/COUNTRY_TO_CURRENCY = \{/.test(fs.readFileSync(path.join(__dirname, '..', 'lib', 'freightCalc.js'), 'utf8')));
  // 나머지 통화는 기존 그대로(회귀 없음)
  check('네덜란드 = EUR', freightCalc.countryToCurrency('네덜란드') === 'EUR');
  check('중국 = CNY', freightCalc.countryToCurrency('중국') === 'CNY');
  check('일본 = JPY', freightCalc.countryToCurrency('일본') === 'JPY');
  check('콜롬비아 = USD', freightCalc.countryToCurrency('콜롬비아') === 'USD');

  console.log('\n=== classifyCategory(JS) 회귀 — 기존 동작 그대로 유지 ===');
  check('콜롬비아+장미 → 콜롬비아 장미', classifyCategory('콜롬비아', '장미', 'ROSE') === '콜롬비아 장미');
  check('호주 CounName → 호주', classifyCategory('호주', '', 'ANY') === '호주');
  check('미분류 → 기타(미분류)', classifyCategory('화성', '', 'ANY') === EXTRA_CATEGORY);

  console.log(`\n총 ${failed ? '실패' : '성공'} — 실패 ${failed}건`);
  process.exit(failed ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
