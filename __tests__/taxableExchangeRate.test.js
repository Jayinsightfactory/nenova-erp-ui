// 과세환율(R) 결정 규칙 회귀 테스트 — 2026-08-12 사용자 확정 업무규칙.
// 실행: node __tests__/taxableExchangeRate.test.js
//
//  * R은 AUD 포함 전 통화가 그 통관 신고 주차의 관세청 과세환율이다(상업/환전 환율 아님).
//  * 과거 주차에 현재 CurrencyMaster 환율을 자동 적용하지 않는다.
//  * 전차수 값도 자동 상속하지 않고 "참고값(carry)"으로만 제안한다.
//  * 구매/포워딩 금액이 있는데 원천이 없으면 needsInput 으로 표시해 입력칸을 연다.
//  * KCS OpenAPI 키가 없으면 공식 조회를 시도하지 않고 원천 누락으로 남긴다(키를 코드에 넣지 않는다).
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
  const {
    resolveTaxableRate, TAXABLE_RATE_SOURCES, hasKcsApiCredentials,
    KCS_API_KEY_ENV, KCS_API_URL_ENV,
  } = await import('../lib/taxableExchangeRate.js');

  console.log('=== 우선순위: 직접입력 > 입고 통관 스냅샷 > 그 주차 저장 공식값 > 없음 ===');
  const savedRate = { rate: 1538.3, rateSource: 'manual', sourceRefFrom: '2026-07-01', sourceRefTo: '2026-07-07' };
  check('① 담당자 직접 입력이 최우선',
    resolveTaxableRate({ currency: 'USD', snapshotRate: 1500, savedRate, manualRate: 1234.5, hasPurchase: true }).rate === 1234.5);
  check('② 당주 FreightCost 과세환율 스냅샷',
    resolveTaxableRate({ currency: 'USD', snapshotRate: 1500, savedRate, hasPurchase: true }).source
      === TAXABLE_RATE_SOURCES.FREIGHT_SNAPSHOT);
  const official = resolveTaxableRate({ currency: 'USD', snapshotRate: null, savedRate, hasPurchase: true });
  check('③ 그 주차에 저장/캐시된 공식 과세환율', official.rate === 1538.3
    && official.source === TAXABLE_RATE_SOURCES.OFFICIAL_SAVED);
  check('공식값의 고시 적용기간도 함께 전달',
    official.sourceRefFrom === '2026-07-01' && official.sourceRefTo === '2026-07-07');

  console.log('\n=== 과거 주차에 CurrencyMaster/전차수 값을 자동 적용하지 않는다 ===');
  const missing = resolveTaxableRate({
    currency: 'AUD', snapshotRate: null, savedRate: null, previousRate: 1079.48, hasPurchase: true,
  });
  check('전차수 값이 있어도 rate로 자동 상속하지 않음', missing.rate === null);
  check('원천 없음(missing)으로 표시', missing.source === TAXABLE_RATE_SOURCES.MISSING);
  check('전차수 값은 참고값(carry)으로만 제안', missing.carry === 1079.48);
  check('구매가 있으면 입력 대상(needsInput=true)', missing.needsInput === true);
  const noPurchase = resolveTaxableRate({
    currency: 'AUD', snapshotRate: null, savedRate: null, previousRate: 1079.48, hasPurchase: false,
  });
  check('구매/포워딩이 없으면 입력을 요구하지 않음', noPurchase.needsInput === false && noPurchase.carry === 1079.48);
  check('통화가 없는 행(공제/미분류)은 계산 대상 아님',
    resolveTaxableRate({ currency: null, hasPurchase: true }).needsInput === false);

  console.log('\n=== AUD도 다른 통화와 동일하게 과세환율이다 (H 호주 입력 시작 28차와는 별개) ===');
  const audSaved = resolveTaxableRate({
    currency: 'AUD', snapshotRate: null, savedRate: { rate: 1068.23, rateSource: 'manual' }, hasPurchase: true,
  });
  check('27차 AUD 과세환율 1068.23이 정상 원천으로 인정',
    audSaved.rate === 1068.23 && audSaved.source === TAXABLE_RATE_SOURCES.OFFICIAL_SAVED);
  const migration = fs.readFileSync(
    path.join(__dirname, '..', 'docs', 'migrations', '2026-08-12_web_taxable_exchange_rate.sql'), 'utf8');
  check('22~27차 AUD seed는 실제 구매가 있던 23·24·27차만',
    /N'23', N'AUD', N'', 1079\.48/.test(migration)
    && /N'24', N'AUD', N'', 1083\.36/.test(migration)
    && /N'27', N'AUD', N'', 1068\.23/.test(migration)
    && !/N'22', N'AUD'/.test(migration) && !/N'25', N'AUD'/.test(migration) && !/N'26', N'AUD'/.test(migration));
  check('같은 주차의 USD가 카테고리별로 다를 수 있다(콜롬비아 1538.30 vs 태국 1548.52)',
    /N'27', N'USD', N'콜롬비아 수국', 1538\.3/.test(migration) && /N'27', N'USD', N'태국', 1548\.52/.test(migration));

  console.log('\n=== KCS OpenAPI 자격정보 ===');
  check('키와 URL이 모두 있어야 공식 조회 가능',
    hasKcsApiCredentials({ [KCS_API_KEY_ENV]: 'k', [KCS_API_URL_ENV]: 'u' }) === true
    && hasKcsApiCredentials({ [KCS_API_KEY_ENV]: 'k' }) === false
    && hasKcsApiCredentials({}) === false);
  const libSource = fs.readFileSync(path.join(__dirname, '..', 'lib', 'taxableExchangeRate.js'), 'utf8');
  // 주석에 기관명(UNIPASS)을 적는 것은 허용. 실제 엔드포인트 URL이나 키 문자열 리터럴만 금지한다.
  check('코드에 실제 키/URL 값이 하드코딩돼 있지 않음(이름 상수만)',
    /KCS_EXCHANGE_RATE_API_KEY'/.test(libSource)
    && !/https?:\/\//.test(libSource)
    && !/(serviceKey|crkyCn|apiKey)\s*[=:]\s*['"][^'"]+['"]/i.test(libSource));
  const envExample = fs.readFileSync(path.join(__dirname, '..', '.env.local.example'), 'utf8');
  check('.env.local.example에 이름만 선언(값 비어 있음)',
    /KCS_EXCHANGE_RATE_API_KEY=\s*$/m.test(envExample) && /KCS_EXCHANGE_RATE_API_URL=\s*$/m.test(envExample));

  console.log('\n=== 저장 키/이력 스키마 ===');
  check('키가 OrderYear+MajorWeek+Currency(+Category)',
    /CREATE UNIQUE INDEX UX_WebTaxableExchangeRate\s*\n?\s*ON WebTaxableExchangeRate\(OrderYear, MajorWeek, Currency, Category\)/.test(migration));
  check('source·고시기간·저장자·시각 컬럼 보유',
    /RateSource NVARCHAR/.test(migration) && /SourceRefFrom/.test(migration)
    && /SourceRefTo/.test(migration) && /SavedBy/.test(migration) && /SavedAt/.test(migration));
  check('변경 이력 테이블 보유', /CREATE TABLE WebTaxableExchangeRateHistory/.test(migration));
  check('마이그레이션이 ERP 공용 원장을 건드리지 않음',
    !/(OrderMaster|OrderDetail|ShipmentMaster|ShipmentDetail|ProductStock|Estimate|StockHistory|CurrencyMaster)\b/.test(
      migration.replace(/^--.*$/gm, '')));
  check('이미 저장된 행은 seed가 덮어쓰지 않음', /WHERE NOT EXISTS/.test(migration));

  console.log('\n=== 보고서 API 배선 ===');
  const apiSource = fs.readFileSync(path.join(__dirname, '..', 'pages', 'api', 'sales', 'profit-report.js'), 'utf8');
  check('보고서 API가 그 주차 저장 과세환율을 로드', /loadTaxableRates\(major, orderYear\)/.test(apiSource));
  check('보고서 API가 resolveTaxableRate 공용 함수를 사용', /resolveTaxableRate\(\{/.test(apiSource));
  check('카테고리 지정값 → 통화 기본값 순으로 조회',
    /savedRates\.byCategory\[key\] \|\| \(curCode \? savedRates\.byCurrency\[curCode\] : null\)/.test(apiSource));
  check('CurrencyMaster 자동 fallback 코드가 남아 있지 않음',
    !/currency_master_fallback/.test(apiSource) && !/rateByCode/.test(apiSource));
  check('공식 조회 가능 여부를 화면에 전달', /taxableRateApiConfigured: hasKcsApiCredentials\(\)/.test(apiSource));

  console.log(`\n총 ${failed ? '실패' : '성공'} — 실패 ${failed}건`);
  process.exit(failed ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
