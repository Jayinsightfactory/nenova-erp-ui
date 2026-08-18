// 주차별 매출이익 보고서 '항목별 데이터 기준 보기' 회귀 검증
// 실행: node __tests__/profitReportSourceGuide.test.js
//
// 목적 3가지
//  1) 설명이 화면 항목명과 어긋나지 않게 고정 (페이지 COLUMN_DEFS / 엑셀 COL_LABEL / 설명 사전 3중 일치)
//  2) 설명 문구가 실제 계산 코드와 어긋나지 않게 고정 (÷1.1, 분모 범위, 차수 경계, 29차 환율 상속, 확정 필터)
//  3) 설명 UI가 계산·저장·접근성 동작을 깨지 않게 고정 (기본 접힘, aria, 가로 스크롤, 수기값 우선 로직 보존)
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const readSource = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

let failed = 0;
const check = (label, condition, detail = '') => {
  if (condition) console.log(`  ✓ ${label}`);
  else {
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
    failed += 1;
  }
};

function parsePageColumnDefs(source) {
  const block = source.match(/const COLUMN_DEFS = \[([\s\S]*?)\n\];/);
  if (!block) return [];
  const out = [];
  const re = /\{\s*key:\s*'([^']+)',\s*label:\s*'([^']+)'/g;
  let m;
  while ((m = re.exec(block[1])) !== null) out.push({ key: m[1], label: m[2] });
  return out;
}

function parseExcelColLabels(source) {
  const block = source.match(/const COL_LABEL = \{([\s\S]*?)\n\};/);
  if (!block) return {};
  const out = {};
  const re = /(\w+):\s*'([^']*)'/g;
  let m;
  while ((m = re.exec(block[1])) !== null) out[m[1]] = m[2];
  return out;
}

async function main() {
  const guide = await import('../lib/profitReportSourceGuide.js');
  const { COLUMN_GUIDE, GUIDE_SECTIONS, ALL_GUIDE_ROWS, ENTRY_KINDS, GUIDE_SUMMARY } = guide;
  const { VAT_FACTOR, computeCountryCustomsTotal } = await import('../lib/customsForwarding.js');
  const { computeProfitRow, computeProfitTotals, TOTALS_EXCLUDED_CATEGORIES } = await import('../lib/profitReportCalc.js');

  const pageSource = readSource('pages/sales/profit-report.js');
  const excelSource = readSource('lib/profitReportExcel.js');
  const apiSource = readSource('pages/api/sales/profit-report.js');
  const reportSource = readSource('lib/profitReport.js');
  const calcSource = readSource('lib/profitReportCalc.js');
  const guideSource = readSource('lib/profitReportSourceGuide.js');
  const componentSource = readSource('components/ProfitReportSourceGuide.js');

  console.log('=== 화면 항목명과 설명 사전 1:1 일치 ===');
  const pageCols = parsePageColumnDefs(pageSource);
  check('페이지 COLUMN_DEFS 파싱', pageCols.length > 0);
  check('설명 사전 항목 수 = 화면 컬럼 수', COLUMN_GUIDE.length === pageCols.length,
    `${COLUMN_GUIDE.length} != ${pageCols.length}`);
  pageCols.forEach((col, i) => {
    const row = COLUMN_GUIDE[i];
    check(`[${col.key}] 순서·이름 일치 (${col.label})`,
      row && row.key === col.key && row.label === col.label,
      `사전=${row ? `${row.key}/${row.label}` : '없음'}`);
  });

  const excelLabels = parseExcelColLabels(excelSource);
  check('엑셀 COL_LABEL 파싱', Object.keys(excelLabels).length > 0);
  for (const [key, label] of Object.entries(excelLabels)) {
    const row = COLUMN_GUIDE.find((x) => x.key === key);
    check(`엑셀 라벨과 설명 사전 일치 [${key}]`, row && row.label === label,
      `엑셀=${label} / 사전=${row ? row.label : '없음'}`);
  }

  console.log('\n=== 설명 사전 구조 ===');
  const keys = ALL_GUIDE_ROWS.map((r) => r.key);
  check('키 중복 없음', new Set(keys).size === keys.length);
  check('섹션 4개(항목/줄·값/입력화면/경계)', GUIDE_SECTIONS.length === 4);
  check('요약 문구에 자동/직접입력 구분 명시',
    /자동/.test(GUIDE_SUMMARY) && /직접입력/.test(GUIDE_SUMMARY) && /사람이 넣은 값/.test(GUIDE_SUMMARY));
  for (const row of ALL_GUIDE_ROWS) {
    const ok = row.label && row.source && row.formula && row.note && row.fields && ENTRY_KINDS[row.kind];
    check(`필수 항목 채움 [${row.key}]`, Boolean(ok), JSON.stringify(row).slice(0, 120));
  }
  check('설명 모듈은 DB/서버 모듈을 import 하지 않음(클라이언트 안전)',
    !/from '\.\/db|require\('.*db/.test(guideSource));

  console.log('\n=== 필수 금액·비율 항목 누락 없음 ===');
  const mustHave = ['C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U'];
  for (const key of mustHave) {
    check(`설명 존재 [${key}]`, COLUMN_GUIDE.some((x) => x.key === key));
  }
  const byKey = Object.fromEntries(ALL_GUIDE_ROWS.map((r) => [r.key, r]));
  for (const key of ['row-extra', 'row-deduct', 'row-total', 'row-stockweeks', 'row-note',
    'in-weight', 'in-customs-split', 'in-world', 'in-colombia', 'in-stockprice',
    'bd-begin-end', 'bd-rate-source', 'bd-country-start', 'bd-monthly']) {
    check(`부가 설명 존재 [${key}]`, Boolean(byKey[key]));
  }

  console.log('\n=== 설명 문구 ↔ 실제 계산 코드 대조 ===');
  // 매출액 C = N + L + O
  const row = computeProfitRow({
    category: '태국', variant: 'normal',
    auto: { N: 1000, L: -100, O: 50, Q: 10, S: 2, H: 30, R: 1500, E: 0, F: 0 },
    manual: {}, stock: {},
  });
  check('C = N + L + O 실계산 일치', row.C === 950 && /순수매출액 \+ 불량금액 \+ 그 외 매출액/.test(byKey.C.formula));
  check('P = Q × R 실계산 일치', row.P === 15000 && /구매금액\(외화\) × 환율/.test(byKey.P.formula));
  check('T = S × R 실계산 일치', row.T === 3000 && /포워딩\(USD\) × 환율/.test(byKey.T.formula));
  check('G = P + T 실계산 일치', row.G === 18000 && /상품 금액\(구매\) \+ 포워딩 원화환산/.test(byKey.G.formula));
  check('I = E + G + H − F 실계산 일치', row.I === 18030 && /기초상품재고액 \+ 매입액 \+ 그외통관비 − 기말상품재고액/.test(byKey.I.formula));

  // 이스라엘·뉴질랜드·일본 예외
  const noEnd = computeProfitRow({
    category: '일본', variant: 'noEnding',
    auto: { N: 1000, L: 0, O: 0, Q: 0, S: 0, H: 100, R: 1500, E: 200, F: 300 },
    manual: {}, stock: {},
  });
  check('noEnding 3개국은 기말재고를 빼지 않음(코드)', noEnd.I === 300);
  check('noEnding 예외를 매출원가 설명이 명시', /이스라엘·뉴질랜드·일본/.test(byKey.I.note));
  check('noEnding 예외를 매출이익·이익률 설명이 명시',
    /이스라엘·뉴질랜드·일본/.test(byKey.J.note) && /이스라엘·뉴질랜드·일본/.test(byKey.K.note));

  // 매출비율(D)의 분모는 공제 포함, 상품구매비율(U)의 분모는 공제 제외
  const totals = computeProfitTotals([
    { category: '태국', calc: { C: 100, P: 100, E: 0, F: 0, J: 10, G: 0, H: 0, I: 0, L: 0, N: 0, O: 0, Q: 0, S: 0, T: 0 } },
    { category: '공제', calc: { C: 50, P: 50, E: 0, F: 0, J: 5, G: 0, H: 0, I: 0, L: 0, N: 0, O: 0, Q: 0, S: 0, T: 0 } },
  ]);
  check('합계 C는 공제 포함(코드)', totals.C === 150);
  check('합계 P는 공제 제외(코드)', totals.P === 100);
  // 2026-08-12: 원본 엑셀 본표(7~22행)에는 "기타(미분류)" 행 자체가 없다. 화면 합계와 엑셀 합계가
  // 같아야 하므로 어느 합계에도 넣지 않는다.
  const totalsWithExtra = computeProfitTotals([
    { category: '태국', calc: { C: 100, P: 100, E: 10, F: 20, J: 10, G: 0, H: 0, I: 0, L: 0, N: 0, O: 0, Q: 0, S: 0, T: 0 } },
    { category: '공제', calc: { C: 50, P: 50, E: 0, F: 0, J: 5, G: 0, H: 0, I: 0, L: 0, N: 0, O: 0, Q: 0, S: 0, T: 0 } },
    { category: '기타(미분류)', calc: { C: 999, P: 999, E: 999, F: 999, J: 999, G: 999, H: 999, I: 999, L: 999, N: 999, O: 999, Q: 999, S: 999, T: 999 } },
  ]);
  check('기타(미분류)는 모든 합계에서 제외(코드)',
    totalsWithExtra.C === 150 && totalsWithExtra.P === 100 && totalsWithExtra.E === 10
    && totalsWithExtra.F === 20 && totalsWithExtra.J === 15 && totalsWithExtra.I === 0,
    JSON.stringify(totalsWithExtra));
  check('미분류 제외 목록이 상수로 고정', TOTALS_EXCLUDED_CATEGORIES.includes('기타(미분류)'));
  check('매출비율 설명이 "공제 포함 · 미분류 제외" 분모를 명시',
    /공제/.test(byKey.D.formula) && /포함/.test(byKey.D.formula) && /기타\(미분류\)/.test(byKey.D.formula));
  check('상품구매비율 설명이 "공제 제외" 분모를 명시', /공제/.test(byKey.U.note) && /빠집니다|제외/.test(byKey.U.note));
  check('매출비율 0 분모 처리 명시', /0이면 빈칸/.test(byKey.D.note));
  check('이익률·불량율·상품구매비율 0 분모 처리 명시',
    /0이면 빈칸/.test(byKey.K.note) && /0이면 빈칸/.test(byKey.M.note) && /0이면 빈칸/.test(byKey.U.note));
  // 2026-08-11 결함수정 5: D/U 계산은 pages/sales/profit-report.js · lib/profitReportExcel.js 양쪽에서
  // 중복 인라인 계산이던 것을 lib/profitReportCalc.js의 calcRevenueRatio/calcPurchaseRatio 로 공용화했다.
  // 화면/엑셀 소스가 그 공용 함수를 import해서 쓰는지, 그리고 함수 자체가 "0이면 null" 규칙을
  // 실제로 지키는지 둘 다 확인한다(인라인 리터럴 문자열이 아니라 동작으로 검증).
  const { calcRevenueRatio, calcPurchaseRatio } = await import('../lib/profitReportCalc.js');
  check('화면이 공용 calcRevenueRatio/calcPurchaseRatio를 import', /calcRevenueRatio/.test(pageSource) && /calcPurchaseRatio/.test(pageSource));
  check('엑셀 생성이 공용 calcRevenueRatio/calcPurchaseRatio를 import', /calcRevenueRatio/.test(excelSource) && /calcPurchaseRatio/.test(excelSource));
  check('화면 합계 U는 고정 100%가 아니라 computeProfitTotals의 U를 사용',
    !/readonlyValue\(cd\.key,\s*(?:wTotals|totals|w\.totals),\s*\{\s*D:\s*1,\s*U:\s*1\s*\}\)/.test(pageSource)
    && /U:\s*(?:wTotals|totals|w\.totals)\.U\s*\?\?\s*1/.test(pageSource));
  check('화면/엑셀에 D/U 인라인 재계산이 남아있지 않음',
    !/totals\.C !== 0 \? c\.C \/ totals\.C : null/.test(pageSource)
    && !/totals\.P !== 0 \? c\.P \/ totals\.P : null/.test(pageSource)
    && !/totals\.C !== 0 \? c\.C \/ totals\.C : null/.test(excelSource)
    && !/totals\.P !== 0 \? c\.P \/ totals\.P : null/.test(excelSource));
  check('D/U 분모 처리 함수가 0이면 null을 반환(코드)',
    calcRevenueRatio({ C: 10 }, { C: 0 }) === null
    && calcPurchaseRatio({ P: 10 }, { P: 0 }) === null
    && calcRevenueRatio({ C: 30 }, { C: 150 }) === 0.2
    && calcPurchaseRatio({ P: 25 }, { P: 100 }) === 0.25);

  // 그외통관비 부가세 규칙
  check('VAT_FACTOR = 1.1', VAT_FACTOR === 1.1);
  const customsRow = { GW1: 100, Customs1: 1000, SunYul1: 1100, WorldFreight1: 1100, Quarantine1: 1100 };
  const rates = { BakSangRate: 460 };
  const thai = computeCountryCustomsTotal(customsRow, rates, '태국');
  const viet = computeCountryCustomsTotal(customsRow, rates, '베트남');
  check('일반 국가는 선율 ÷1.1 (코드)', Math.abs(thai - (46000 + 1000 + 1000 + 1000 + 1000)) < 0.01, String(thai));
  check('베트남 선율만 ÷1.1 예외 (코드)', Math.abs(viet - thai - 100) < 0.01, `${viet} vs ${thai}`);
  check('통관비 설명이 ÷1.1 대상과 베트남 예외를 명시',
    /선율 ÷ 1\.1/.test(byKey.H.formula) && /월드운송료 ÷ 1\.1/.test(byKey.H.formula)
    && /백상창고료·관세는 원래 공급가라 나누지 않고/.test(byKey.H.note) && /베트남 선율만 예외/.test(byKey.H.note));
  check('통관비 설명이 관세·선율 분할합계와 콜롬비아 무게배분을 명시',
    /박스당 무게 × 박스수/.test(byKey.H.formula) && /1·2·3칸에 나눠/.test(byKey['in-customs-split'].formula));
  check('통관비 원천 설명이 AWB·선율청구서·1·2차 합산을 명시',
    /AWB\/입고관리/.test(byKey.H.source) && /선율 청구서 관세 부분/.test(byKey.H.source)
    && /검역수수료\+통관수수료 공급가액/.test(byKey.H.source) && /1·2차 합산 무게/.test(byKey.H.source));
  check('포워딩 원천 설명이 국가별 원본 출처를 명시',
    /네덜란드·중국은 입고관리 운송료/.test(byKey.S.source)
    && /콜롬비아 수국은 FreightWise/.test(byKey.S.source)
    && /FreightWise Ecuador/.test(byKey.S.source) && /태국은 Excel/.test(byKey.S.source));
  check('콜롬비아 배분 설명이 박스수·GW\/CW·CBM 원천을 명시',
    /WarehouseDetail\.BoxQuantity/.test(byKey['in-colombia'].source)
    && /GW=CW/.test(byKey['in-colombia'].note) && /CBM/.test(byKey['in-colombia'].note));
  check('재고평가 공식과 보조 단가 근거를 함께 명시',
    /\(G\+H\)÷매입수량×재고수량/.test(byKey['in-stockprice'].formula)
    && /EXE ProductStock 환산수량×VERIFIED 시점 단가/.test(byKey['in-stockprice'].formula));
  // 월드운송료 추천 = 용량 분해(3t = 2.5t + 1t), 저장된 실제값 우선
  const { deriveTruckPlan } = await import('../lib/colombiaTruck.js');
  const plan3t = deriveTruckPlan(3000);
  check('3,000kg 추천 = 2.5t 1대 + 1t 1대 (코드)',
    plan3t.Truck5t === 0 && plan3t.Truck2_5t === 1 && plan3t.Truck1t === 1, JSON.stringify(plan3t));
  const plan6t = deriveTruckPlan(6000);
  check('6,000kg 추천 = 5t 1대 + 1t 1대 (코드)',
    plan6t.Truck5t === 1 && plan6t.Truck2_5t === 0 && plan6t.Truck1t === 1, JSON.stringify(plan6t));
  check('월드운송료 설명이 용량 분해와 실제값 우선을 명시',
    /2\.5t 1대\s*\+\s*1t 1대/.test(byKey['in-world'].formula)
    && /실제로 쓴 차량·비용이 있으면 그 값이 항상 우선/.test(byKey['in-world'].source));

  // 기말재고 F 자동공식
  check('기말재고 설명이 원본 평균원가 공식과 검증된 보조 단가를 명시',
    /\(매입액\+그외통관비\) ÷ 매입수량 × 마지막 재고수량/.test(byKey.F.formula)
    && /검증된 품목별 시점단가/.test(byKey.F.formula)
    && /같은 연도·차수의 확정 분배/.test(byKey.F.note)
    && /가장 많은 업체가 사용한 단가/.test(byKey.F.note)
    && /평균값을 만들지 않으며/.test(byKey.F.note)
    && /사용자가 확인·저장하기 전에는 계산에 적용하지/.test(byKey.F.note));
  check('기말재고 코드가 검증되지 않은 최근원가·평균 도착원가 폴백을 금지',
    /hasVerifiedStockPriceEvidence/.test(calcSource)
    && /VERIFIED_ARRIVAL_COST/.test(calcSource)
    && !/landedWon \/ purchQty/.test(calcSource) && !/recentCost\) \* n0\(R\)/.test(calcSource));
  const { computeAutoEndingStock, endingStockSourceKind } = await import('../lib/profitReportCalc.js');
  check('VERIFIED 시점 단가가 있으면 F는 증거 평가액을 그대로 사용',
    computeAutoEndingStock({ endQty: 100, snapshotConfirmed: true, priceEvidenceStatus: 'VERIFIED', evidenceValue: 1234 }) === 1234
    && endingStockSourceKind({ endQty: 100, snapshotConfirmed: true, priceEvidenceStatus: 'VERIFIED', evidenceValue: 1234 }) === 'verified_product_stock_price');
  check('사용자가 확정한 동일 차수·품목·단위 도착원가도 F 증거로 사용',
    computeAutoEndingStock({ endQty: 100, snapshotConfirmed: true, priceEvidenceStatus: 'VERIFIED_ARRIVAL_COST', evidenceValue: 1200 }) === 1200
    && endingStockSourceKind({ endQty: 100, snapshotConfirmed: true, priceEvidenceStatus: 'VERIFIED_ARRIVAL_COST', evidenceValue: 1200 }) === 'verified_arrival_cost');
  check('단가 근거가 없으면 INPUT_REQUIRED이고 폴백하지 않음',
    computeAutoEndingStock({ endQty: 100, snapshotConfirmed: true, priceEvidenceStatus: 'INPUT_REQUIRED', recentCost: 9 }) == null
    && endingStockSourceKind({ endQty: 100, snapshotConfirmed: true, priceEvidenceStatus: 'INPUT_REQUIRED' }) === 'missing_price_evidence'
    && endingStockSourceKind({ endQty: 100, snapshotConfirmed: false, priceEvidenceStatus: 'VERIFIED', evidenceValue: 1234 }) === 'missing_stock_snapshot');

  // 차수 경계
  check('전차수 산출 코드 = currentMajor - 1, 01차만 전년 52차',
    /currentMajor <= 1 \? String\(Number\(orderYear\) - 1\) : String\(orderYear\)/.test(apiSource)
    && /currentMajor <= 1 \? '52' : String\(currentMajor - 1\)/.test(apiSource));
  check('경계 설명이 27차→26차·01차→전년 52차를 명시',
    /27차 기초재고는 26차의 마지막 세부차수 재고/.test(byKey['bd-begin-end'].formula)
    && /01차일 때만 전년도 52차/.test(byKey['bd-begin-end'].formula));
  check('기말재고도 해당 차수 마지막 세부차수임을 명시',
    /기말재고는 27차의 마지막 세부차수 재고/.test(byKey['bd-begin-end'].formula));
  check('StockMaster.isFix를 재고 마감 조건으로 쓰지 않음을 명시',
    /isFix를 재고 마감 조건으로 쓰지/.test(byKey['bd-begin-end'].note)
    && !/isFix=1/.test(byKey.F.source));
  check('마지막 세부차수 선택 코드가 유지됨(ProductStock 존재 + suffix DESC)',
    /EXISTS \(SELECT 1 FROM ProductStock ps WHERE ps\.StockKey=sm\.StockKey\)/.test(reportSource));

  // 과세환율(R) — "정확히 그 차수" 원천만 자동 적용, CurrencyMaster/전차수는 제안일 뿐
  const { resolveTaxableRate, RATE_SOURCE } = await import('../lib/taxableExchangeRate.js');
  check('전차수 R 자동상속 코드가 제거됨',
    !/currentMajor >= 29 && prevMan\.R != null/.test(apiSource)
    && !/previous_report_taxable_rate/.test(apiSource));
  check('CurrencyMaster 현재환율을 R 자동값으로 쓰지 않음',
    !/currency_master_fallback/.test(apiSource) && /resolveTaxableRate/.test(apiSource));
  check('R 우선순위 코드: 당주 통관 스냅샷 > 저장/캐시 > 원본 엑셀',
    resolveTaxableRate({ snapshotRate: 1500, savedByCategory: { rate: 1400 }, historicalRate: 1300 }).source === RATE_SOURCE.FREIGHT_COST_SNAPSHOT
    && resolveTaxableRate({ savedByCategory: { rate: 1400, source: RATE_SOURCE.SAVED_OFFICIAL_WEEK }, historicalRate: 1300 }).rate === 1400
    && resolveTaxableRate({ historicalRate: 1300 }).source === RATE_SOURCE.EXCEL_HISTORICAL);
  check('통화마스터/전차수 값은 자동 적용하지 않고 제안으로만 반환',
    resolveTaxableRate({ currencyMasterRate: 1350, previousWeekRate: 1360 }).rate === null
    && resolveTaxableRate({ currencyMasterRate: 1350, previousWeekRate: 1360 }).source === RATE_SOURCE.MISSING
    && resolveTaxableRate({ currencyMasterRate: 1350, previousWeekRate: 1360 }).suggestions.length === 2);
  check('설명이 "그 차수 값만 자동 적용"을 명시',
    /자동으로 물려받지 않습니다/.test(byKey['bd-rate-source'].note)
    && /통화마스터/.test(byKey['bd-rate-source'].note)
    && /정확히 그 차수/.test(byKey.R.source));
  check('R 설명이 같은 통화·다른 주차 차이를 예시로 명시', /1,548\.52/.test(byKey.R.note));
  check('H 시작차수와 R 원천 검증이 분리됨을 명시',
    /그외통관비\(H\)/.test(byKey['bd-country-start'].formula) && /과세환율\(R\)/.test(byKey['bd-country-start'].formula)
    && /1,068\.23/.test(byKey['bd-country-start'].note));

  // 확정 출고 필터
  check('순수매출 SQL이 ShipmentMaster.isFix=1 확정 필터를 유지', /ISNULL\(sm\.isFix,0\)=1/.test(reportSource));
  check('순수매출 설명이 확정 출고만 집계함을 명시',
    /확정/.test(byKey.N.source) && /확정 전\(미확정\) 출고는 들어오지 않습니다/.test(byKey.N.note));
  check('구매금액 설명이 운송료/SERVICE FEE 제외를 명시', /SERVICE FEE/.test(byKey.Q.formula));
  check('중량행 제외 설명이 매출·매입 양쪽에 존재',
    /Chargeable\/Gross weight/.test(byKey.N.formula) && /제외/.test(byKey['in-weight'].note));

  // 미분류 / 월별
  check('기타(미분류) 설명이 원인과 해결방향을 안내',
    /나라\/꽃 종류를 고쳐야/.test(byKey['row-extra'].note));
  check('기타(미분류)가 본표 합계에서 빠짐을 설명이 명시',
    /합계.*들어가지 않습니다/.test(byKey['row-extra'].formula)
    && /기타\(미분류\)/.test(byKey['row-total'].formula));
  check('월별 귀속 규칙이 PeriodDay 종료일 기준임을 명시',
    /끝나는 날이 속한 달/.test(byKey['bd-monthly'].formula) && /PeriodDay/.test(byKey['bd-monthly'].fields));

  console.log('\n=== 자동값 vs 사용자 입력 구분 보존 ===');
  check('직접입력 성격 배지가 5종 정의됨', Object.keys(ENTRY_KINDS).length === 5);
  check('H는 자동원천+외부 청구입력 혼합으로 표기', byKey.H.kind === 'autoManual');
  check('공제 줄은 직접입력으로 표기', byKey['row-deduct'].kind === 'manual');
  check('E/F는 자동, R/S/H·콜롬비아배분·재고단가근거는 자동+증거입력으로 표기',
    ['E', 'F'].every((k) => byKey[k].kind === 'auto')
    && ['R', 'S', 'H', 'in-colombia', 'in-stockprice'].every((k) => byKey[k].kind === 'autoManual'));
  check('N/L/O/Q는 자동으로 표기', ['N', 'L', 'O', 'Q'].every((k) => byKey[k].kind === 'auto'));
  check('C/D/G/I/J/K/M/P/T/U는 계산으로 표기',
    ['C', 'D', 'G', 'I', 'J', 'K', 'M', 'P', 'T', 'U'].every((k) => byKey[k].kind === 'calc'));
  check('환율 원천이 없을 때 입력칸이 뜨는 기존 동작 유지', /function needsRateInput\(row\)/.test(pageSource)
    && /needsRateInput\(row\)\)\) && cd\.editable/.test(pageSource));
  check('수기 저장값이 자동값보다 우선하는 로직 유지', /const mv = row\.manual\[col\];/.test(pageSource + calcSource));
  check('환율 설명이 입력값을 자동값으로 포장하지 않음', /넣은 값은 자동값이 아니라 저장된 입력값/.test(byKey.R.note));

  console.log('\n=== 설명 UI 자체 계약 (접기/접근성/반응형) ===');
  check('페이지가 설명 컴포넌트를 렌더', /<ProfitReportSourceGuide \/>/.test(pageSource));
  check('페이지가 Layout을 직접 감싸지 않음(_app 전역 래핑 유지)', !/from '\.\.\/\.\.\/components\/Layout'/.test(pageSource));
  check('기본 접힘 (useState(false))', /useState\(false\)/.test(componentSource));
  check('접힘 상태를 localStorage에 저장하지 않음 → 새로고침 후 접힘', !/localStorage/.test(componentSource));
  check('button 요소 + type="button"', /<button\s+type="button"/.test(componentSource));
  check('aria-expanded / aria-controls 연결', /aria-expanded=\{open\}/.test(componentSource)
    && /aria-controls=\{PANEL_ID\}/.test(componentSource) && /id=\{PANEL_ID\}/.test(componentSource));
  check('접힘 시 hidden 속성으로 보조기기에서도 숨김', /hidden=\{!open\}/.test(componentSource));
  check('가로 스크롤 컨테이너로 좁은 화면 보호', /overflowX: 'auto'/.test(componentSource)
    && /maxWidth: '100%'/.test(componentSource));
  check('셀 줄바꿈 허용(wordBreak)으로 가로 폭 터짐 방지', /wordBreak: 'break-word'/.test(componentSource));
  check('표에 caption + scope 지정', /<caption/.test(componentSource) && /scope="row"/.test(componentSource)
    && /scope="col"/.test(componentSource));
  check('필드·테이블명은 작은 글씨/툴팁 보조정보로만 배치',
    /fontSize: 9\.5/.test(componentSource) && /title=\{row\.fields\}/.test(componentSource));

  console.log('\n=== 조회 전용 보장 ===');
  check('설명 모듈·컴포넌트에 fetch/POST 없음',
    !/fetch\(/.test(guideSource + componentSource) && !/method: 'POST'/.test(guideSource + componentSource));
  check('저장 대상은 증거가 있는 H/R/S뿐이며 E/F 최종값은 제외',
    /for \(const col of \['H', 'R', 'S'\]\)/.test(pageSource)
    && !/for \(const col of \[[^\]]*'E'[^\]]*'F'/.test(pageSource));

  console.log(`\n총 ${failed ? '실패' : '성공'} — 실패 ${failed}건`);
  process.exit(failed ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
