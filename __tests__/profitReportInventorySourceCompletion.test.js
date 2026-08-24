const fs = require('fs');
const path = require('path');

let failed = 0;
const check = (label, condition) => {
  if (condition) console.log(`  ✓ ${label}`);
  else { console.error(`  ✗ ${label}`); failed += 1; }
};

const root = path.join(__dirname, '..');
const report = fs.readFileSync(path.join(root, 'lib', 'profitReport.js'), 'utf8');
const api = fs.readFileSync(path.join(root, 'pages', 'api', 'sales', 'profit-report.js'), 'utf8');
const calc = fs.readFileSync(path.join(root, 'lib', 'profitReportCalc.js'), 'utf8');

console.log('=== 주차별 손익 재고 원천 자동완성 계약 ===');

const freightStart = report.indexOf('export async function freightArrivalPriceEvidenceByProduct');
const freightEnd = report.indexOf('// 입고 라인의 금액단위 수량', freightStart);
const freightBlock = report.slice(freightStart, freightEnd);
check('전산 도착원가는 요청한 같은 세부차수만 조회',
  /weekStart: String\(orderWeek\)/.test(freightBlock)
  && /weekEnd: String\(orderWeek\)/.test(freightBlock)
  && /orderYear: String\(orderYear\)/.test(freightBlock));
check('전산 도착원가 resolver는 읽기 전용',
  !/\b(?:INSERT|UPDATE|DELETE|MERGE|CREATE|ALTER|DROP)\b/i.test(freightBlock));
check('0원·단위 없는 전산 도착원가는 제외',
  /!\(price > 0\) \|\| !unit/.test(freightBlock));

const snapshotStart = report.indexOf('export async function stockSnapshotByCategory');
const snapshotEnd = report.indexOf('/** 카테고리별 구매 통화', snapshotStart);
const snapshotBlock = report.slice(snapshotStart, snapshotEnd);
check('재고 원천 우선순위 선택은 공용 순수 정책 함수(selectStockPriceEvidence)를 사용',
  /const exactFallback = selectStockPriceEvidence\(\{ arrival, freightArrival, catalogEvidence, carried \}\)/.test(snapshotBlock));
check('전산 도착원가는 품목 EstUnit과 정확히 같을 때만 채택',
  /freightCandidate\.unit === normalizeInventoryUnit\(row\.EstUnit\)/.test(snapshotBlock));
check('직접→확정 업로드→전산도착→workbook→이월 순서: freightArrival이 있으면 catalogEvidence보다 실제로 선택됨(값 실행 검증)',
  (() => {
    const { selectStockPriceEvidence } = require('../lib/profitReportCalc.js');
    const picked = selectStockPriceEvidence({
      freightArrival: { price: 90, source: 'VERIFIED_FREIGHT_ARRIVAL_CALC' },
      catalogEvidence: { price: 80, source: 'VERIFIED_WORKBOOK_CATALOG' },
      carried: { price: 70, source: 'VERIFIED_CARRIED_ACQUISITION' },
    });
    return picked?.source === 'VERIFIED_FREIGHT_ARRIVAL_CALC' && picked.price === 90;
  })());

check('현재 F에는 현재차수 과세환율, 기초 E에는 전차수 과세환율을 분리 전달',
  /stockSnapshotByCategory\(major, orderYear, \{ rateEvidenceByCurrency: endRateEvidenceByCurrency \}\)/.test(api)
  && /stockSnapshotByCategory\(prevMajor, prevOrderYear, \{ rateEvidenceByCurrency: beginRateEvidenceByCurrency \}\)/.test(api));
check('재고단가 편집 화면도 같은 기초·기말 환율 문맥을 사용',
  /stockPriceRows\(major, prevMajor, orderYear, prevOrderYear, \{[\s\S]*endRateEvidenceByCurrency,[\s\S]*beginRateEvidenceByCurrency/.test(api));
check('호주 과세환율은 수기→입고스냅샷→저장값→역사값→KCS 순수 resolver를 재사용',
  /buildInventoryRateEvidenceByCurrency/.test(api)
  && /resolveTaxableRate\(\{/.test(api)
  && /kcsRate: kcs\.byCategory/.test(api));
check('전산 계산 도착원가 상태를 E/F 계산 허용',
  /'VERIFIED_FREIGHT_ARRIVAL_CALC'/.test(calc)
  && /verified_freight_arrival_calc/.test(calc));
check('전산 도착원가는 arrivalCost만 쓰고 판매단가·Product.Cost·/1.1를 쓰지 않음',
  /const price = Number\(row\?\.arrivalCost \|\| 0\)/.test(freightBlock)
  && !/salePriceKRW|row\.Cost|\/ 1\.1|\/1\.1/.test(freightBlock));
check('샘플 평균은 품명에 샘플/SAMPLE이 있을 때만 재고원가로 집계',
  /else if \(sampleAverage && isSampleInventoryProduct\(row\)\)/.test(snapshotBlock));
check('누락 품목명·번호를 스냅샷에 남겨 검증 문구가 국가 합계만 보여주지 않음',
  /missingPriceItems/.test(snapshotBlock)
  && /missingPriceItems/.test(api));
check('기초·기말 환율 builder는 CurrencyMaster를 적용값이 아니라 resolveTaxableRate 참고 제안에만 전달',
  /currencyMasterRate: rateByCode\[currency\]/.test(api)
  && /previousWeekRate: null/.test(api));

const audit = fs.readFileSync(path.join(root, 'lib', 'profitReportAudit.js'), 'utf8');
check('E/F 검증 문구에 품목명 목록을 붙임',
  /formatMissingProducts\(row\.beginStock\?\.missingPriceItems\)/.test(audit)
  && /formatMissingProducts\(stock\.missingPriceItems\)/.test(audit));
check('콜롬비아 H/S 검증 문구에 누락 반차수를 붙임',
  /누락 반차수: \$\{missingColombiaGwWeeks\}/.test(audit)
  && /누락 반차수: \$\{missingColombiaAirWeeks\}/.test(audit));
check('전차수 항공료 누락은 실제 구매범위 목록을 보여줌',
  /missingExpectedScopes/.test(audit)
  && /\$\{item\.orderWeek\} \$\{item\.category\}/.test(audit));

console.log(`\n${failed ? `실패 ${failed}건` : '전체 통과'}`);
process.exit(failed ? 1 : 0);
