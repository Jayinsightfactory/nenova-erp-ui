// scripts/extract-profit-report-workbooks.mjs
// 원본 "매출원가 양식 - NN차_재고수정.xlsx"(2026년 22~27차, 사용자 Downloads 폴더)를 **읽기 전용**으로
// 분석해 아래 3개 산출물을 생성한다. 운영 DB에는 전혀 접근하지 않는다.
//
//   1) lib/profitReportHistoricalCustoms.js         — 프로덕션 historical snapshot(구성요소 단위)
//   2) __tests__/fixtures/profit-report-22-27-customs.json — 회귀테스트 증거(원본 셀 값·수식 그대로)
//   3) docs/migrations/2026-08-12_web_profit_report_historical_seed.sql — 웹 전용 테이블 구조화 seed
//
// 실행: node scripts/extract-profit-report-workbooks.mjs [--out-dir .]
// 원본 파일이 없는 환경(CI 등)에서는 실행하지 않는다 — 산출물 3개는 저장소에 커밋되어 있다.
//
// 확인된 원본 수식(전 6개 파일 동일):
//   그외통관비!I(35+i) = F(5+i) + L(5+i) + F(20+i) + L(20+i) + F(35+i)
//     · 백상  E=(GW1+GW2)×$C$3,  F=E                (부가세 분리 없음)
//     · 관세  K=관세1+관세2,      L=K                (부가세 분리 없음)
//     · 선율  E=선율1+선율2,      F=E/1.1           (단, 베트남 행만 F=E — 공급가 리터럴)
//     · 월드운송료 K=월드1+월드2, L=K/1.1
//     · 한국방역  E=방역1+방역2,  F=E/1.1           (22~27차 전 차수 0)
//   콜롬비아 N차!C17 = SUBTOTAL(9,C10:C16)
//     = GW×백상요율 + 통관수수료(33,000) + 품목수×10,000 + 실제 트럭비 + 관세료 + 소독비용 + 검역비용
//   백상 요율: 국가 시트($C$3)는 22~27차 모두 460. 콜롬비아 시트(C10 수식 리터럴)는 22차만 370, 23~27차 460.
import XLSX from 'xlsx';
import fs from 'node:fs';
import path from 'node:path';

const MAJORS = ['22', '23', '24', '25', '26', '27'];
const SOURCE_DIR = process.env.PROFIT_WORKBOOK_DIR || 'C:/Users/USER/Downloads';
const ROOT = process.cwd();

const COUNTRY_ROWS = ['콜롬비아 수국', '네덜란드', '태국', '호주', '미국', '중국', '에콰도르', '이스라엘', '뉴질랜드', '일본', '베트남'];
const COLOMBIA_ALLOC = ['콜롬비아 장미', '콜롬비아 카네이션', '콜롬비아 알스트로', '콜롬비아 루스커스'];
const MAIN_CATEGORIES = [
  '콜롬비아 수국', '콜롬비아 카네이션', '콜롬비아 장미', '콜롬비아 루스커스', '콜롬비아 알스트로',
  '네덜란드', '호주', '태국', '중국', '에콰도르', '미국', '이스라엘', '뉴질랜드', '일본', '베트남', '공제',
];
const MAIN_COLS = ['C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U'];

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const cellV = (ws, addr) => (ws[addr] ? ws[addr].v : null);
const cellF = (ws, addr) => (ws[addr] && ws[addr].f ? ws[addr].f : null);
const numOrNull = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function readWorkbook(major) {
  const file = path.join(SOURCE_DIR, `매출원가 양식 - ${major}차_재고수정.xlsx`);
  if (!fs.existsSync(file)) throw new Error(`원본 워크북 없음(읽기 전용 필요): ${file}`);
  return { file, wb: XLSX.readFile(file, { cellFormula: true }) };
}

function extractWeek(major) {
  const { file, wb } = readWorkbook(major);
  const cw = wb.Sheets['그외통관비'];
  const countryBakSangRate = num(cellV(cw, 'C3'));

  const countries = {};
  COUNTRY_ROWS.forEach((name, i) => {
    const rBak = 5 + i;   // 백상(B..F) + 관세(H..L)
    const rSun = 20 + i;  // 선율(B..F) + 월드운송료(H..L)
    const rTot = 35 + i;  // 한국방역(B..F) + 합계(H..I)
    if (cellV(cw, `B${rBak}`) !== name || cellV(cw, `B${rSun}`) !== name || cellV(cw, `B${rTot}`) !== name) {
      throw new Error(`${major}차 그외통관비 시트 행 배치가 예상과 다릅니다 (${name})`);
    }
    countries[name] = {
      GW1: num(cellV(cw, `C${rBak}`)),
      GW2: num(cellV(cw, `D${rBak}`)),
      Customs1: num(cellV(cw, `I${rBak}`)),
      Customs2: num(cellV(cw, `J${rBak}`)),
      SunYul1: num(cellV(cw, `C${rSun}`)),
      SunYul2: num(cellV(cw, `D${rSun}`)),
      WorldFreight1: num(cellV(cw, `I${rSun}`)),
      WorldFreight2: num(cellV(cw, `J${rSun}`)),
      Quarantine1: num(cellV(cw, `C${rTot}`)),
      Quarantine2: num(cellV(cw, `D${rTot}`)),
      BakSangRateApplied: countryBakSangRate,
      H: num(cellV(cw, `I${rTot}`)),
      HFormula: cellF(cw, `I${rTot}`),
      sunYulSupplyFormula: cellF(cw, `F${rSun}`),
    };
  });

  const truckUnitPrices = {
    Truck1t: num(cellV(cw, 'O20')),
    Truck2_5t: num(cellV(cw, 'O21')),
    Truck5t: num(cellV(cw, 'O22')),
  };

  const colombia = {};
  for (const half of ['1', '2']) {
    const cs = wb.Sheets[`콜롬비아 ${half}차`];
    const orderWeek = `${major}-0${half}`;
    const bakFormula = cellF(cs, 'C10') || '';
    const rateMatch = bakFormula.match(/\*\s*(\d+(?:\.\d+)?)/);
    if (!rateMatch) throw new Error(`${orderWeek} 콜롬비아 백상 요율 수식 해석 실패: ${bakFormula}`);
    colombia[orderWeek] = {
      GW: num(cellV(cs, 'E10')),
      CW: num(cellV(cs, 'L29')),
      GWCheck: num(cellV(cs, 'L30')),
      HandlingFee: num(cellV(cs, 'C11')),
      ItemCount: num(cellV(cs, 'E12')),
      Truck1t: num(cellV(cs, 'I5')),
      Truck2_5t: num(cellV(cs, 'I6')),
      Truck5t: num(cellV(cs, 'I7')),
      TruckCost: num(cellV(cs, 'C13')),
      CustomsFee: num(cellV(cs, 'C14')),
      DisinfectFee: num(cellV(cs, 'C15')),
      QuarantineDeductFee: num(cellV(cs, 'C16')),
      BakSangRateApplied: Number(rateMatch[1]),
      QuarantinePerItemRate: num(cellV(cs, 'E12')) > 0 ? num(cellV(cs, 'C12')) / num(cellV(cs, 'E12')) : 0,
      total: num(cellV(cs, 'C17')),
      boxQty: {
        '콜롬비아 장미': num(cellV(cs, 'L37')),
        '콜롬비아 카네이션': num(cellV(cs, 'L38')),
        '콜롬비아 알스트로': num(cellV(cs, 'L39')),
        '콜롬비아 루스커스': num(cellV(cs, 'L40')),
      },
      boxWeight: {
        '콜롬비아 장미': num(cellV(cs, 'K37')),
        '콜롬비아 카네이션': num(cellV(cs, 'K38')),
        '콜롬비아 알스트로': num(cellV(cs, 'K39')),
        '콜롬비아 루스커스': num(cellV(cs, 'K40')),
      },
      boxCbm: {
        '콜롬비아 장미': num(cellV(cs, 'P37')),
        '콜롬비아 카네이션': num(cellV(cs, 'P38')),
        '콜롬비아 알스트로': num(cellV(cs, 'P39')),
        '콜롬비아 루스커스': num(cellV(cs, 'P40')),
      },
      allocationH: {
        '콜롬비아 장미': num(cellV(cs, 'H21')),
        '콜롬비아 카네이션': num(cellV(cs, 'H22')),
        '콜롬비아 알스트로': num(cellV(cs, 'H23')),
        '콜롬비아 루스커스': num(cellV(cs, 'H24')),
      },
    };
  }

  const ms = wb.Sheets['주차별 매출이익 보고서'];
  const rows = {};
  MAIN_CATEGORIES.forEach((name, i) => {
    const r = 7 + i;
    if (cellV(ms, `B${r}`) !== name) throw new Error(`${major}차 본표 ${r}행이 ${name}이 아닙니다`);
    const cells = {};
    for (const col of MAIN_COLS) {
      cells[col] = { value: cellV(ms, `${col}${r}`), formula: cellF(ms, `${col}${r}`) };
    }
    rows[name] = { row: r, cells };
  });
  const totals = {};
  for (const col of MAIN_COLS) totals[col] = { value: cellV(ms, `${col}23`), formula: cellF(ms, `${col}23`) };

  return {
    major,
    sourceFile: path.basename(file),
    countryBakSangRate,
    truckUnitPrices,
    countries,
    colombia,
    main: { rows, totals },
  };
}

// ── 검산: 추출한 구성요소로 원본 H/TOTAL을 재현할 수 있어야 한다 ────────────────────────────────
function verify(week) {
  const problems = [];
  for (const [name, c] of Object.entries(week.countries)) {
    const sunYulDivisor = /\/\s*1\.1/.test(c.sunYulSupplyFormula || '') ? 1.1 : 1;
    const H = (c.GW1 + c.GW2) * c.BakSangRateApplied
      + c.Customs1 + c.Customs2
      + (c.SunYul1 + c.SunYul2) / sunYulDivisor
      + (c.WorldFreight1 + c.WorldFreight2) / 1.1
      + (c.Quarantine1 + c.Quarantine2) / 1.1;
    if (Math.abs(H - c.H) > 0.005) problems.push(`${week.major}차 ${name}: 재현 ${H} != 원본 ${c.H}`);
    if (name !== '베트남' && sunYulDivisor !== 1.1) problems.push(`${week.major}차 ${name}: 선율 공급가 수식이 예상과 다름`);
    if (name === '베트남' && sunYulDivisor !== 1) problems.push(`${week.major}차 베트남: 선율 예외(÷1.1 없음)가 아님`);
  }
  for (const [wk, c] of Object.entries(week.colombia)) {
    const truck = c.Truck1t * week.truckUnitPrices.Truck1t
      + c.Truck2_5t * week.truckUnitPrices.Truck2_5t
      + c.Truck5t * week.truckUnitPrices.Truck5t;
    if (Math.abs(truck - c.TruckCost) > 0.005) problems.push(`${wk}: 트럭비 재현 ${truck} != 원본 ${c.TruckCost}`);
    const total = c.GW * c.BakSangRateApplied + c.HandlingFee + c.ItemCount * 10000
      + truck + c.CustomsFee + c.DisinfectFee + c.QuarantineDeductFee;
    if (Math.abs(total - c.total) > 0.005) problems.push(`${wk}: TOTAL 재현 ${total} != 원본 ${c.total}`);
  }
  return problems;
}

// ── 산출물 1: 프로덕션 historical snapshot 모듈 ──────────────────────────────────────────────
const COUNTRY_STORE_FIELDS = [
  'GW1', 'GW2', 'Customs1', 'Customs2', 'SunYul1', 'SunYul2',
  'WorldFreight1', 'WorldFreight2', 'Quarantine1', 'Quarantine2', 'BakSangRateApplied',
];
const COLOMBIA_STORE_FIELDS = [
  'GW', 'CW', 'HandlingFee', 'ItemCount', 'Truck1t', 'Truck2_5t', 'Truck5t',
  'CustomsFee', 'DisinfectFee', 'QuarantineDeductFee', 'BakSangRateApplied',
];

function jsObject(entries, indent) {
  return `{ ${entries.map(([k, v]) => `${/^[A-Za-z_$][\w$]*$/.test(k) ? k : `'${k}'`}: ${v}`).join(', ')} }`;
}

function buildModule(weeks) {
  const countryLines = weeks.map((w) => {
    const rows = COUNTRY_ROWS.map((cat) => {
      const c = w.countries[cat];
      const body = jsObject(COUNTRY_STORE_FIELDS.map((f) => [f, String(c[f])]));
      return `    '${cat}': ${body},`;
    }).join('\n');
    return `  '${w.major}': {\n${rows}\n  },`;
  }).join('\n');

  const colombiaLines = weeks.flatMap((w) => Object.entries(w.colombia).map(([wk, c]) => {
    const body = jsObject(COLOMBIA_STORE_FIELDS.map((f) => [f, String(c[f])]));
    const boxQty = jsObject(COLOMBIA_ALLOC.map((cat) => [cat, String(c.boxQty[cat])]));
    return `  '${wk}': { row: ${body}, boxQty: ${boxQty} },`;
  })).join('\n');

  const rateLines = weeks.map((w) => {
    const perCat = MAIN_CATEGORIES
      .map((cat) => [cat, numOrNull(w.main.rows[cat].cells.R.value)])
      .filter(([, v]) => v != null && v > 0)
      .map(([cat, v]) => `'${cat}': ${v}`);
    return `  '${w.major}': { ${perCat.join(', ')} },`;
  }).join('\n');

  return `// lib/profitReportHistoricalCustoms.js — 2026년 22~27차 매출원가 양식(원본 xlsx)의 **구성요소 단위**
// historical snapshot. DB 의존 없는 순수 데이터 모듈이며 자동 생성물이다.
//
//   생성기: scripts/extract-profit-report-workbooks.mjs (원본 6개 파일 read-only)
//   증거  : __tests__/fixtures/profit-report-22-27-customs.json (같은 실행에서 함께 생성)
//   seed  : docs/migrations/2026-08-12_web_profit_report_historical_seed.sql (같은 값의 웹 전용 테이블 seed)
//
// ## 왜 "최종 H 합계"가 아니라 구성요소인가
// 이전 구현(lib/profitReportAuditedBaseline.js)은 검증된 **최종 H 합계**만 런타임 폴백으로 넣어,
// 백상 GW·관세·선율·월드운송료·한국방역이라는 실제 원천이 운영 DB에 없다는 사실을 화면에서 숨겼다.
// 원본 워크북에는 그 구성요소가 전부 셀 값으로 존재하므로, 이 모듈은 **원천 그대로**를 담고
// 총액은 프로덕션 공식(computeCountryCustomsTotal/computeColombiaCustomsTotal)으로 재계산한다.
// 따라서 폴백이 적용된 행도 "무엇이 얼마여서 H가 얼마인지"가 화면에 그대로 드러난다.
//
// ## 적용 규칙
// - 연도가 정확히 HISTORICAL_CUSTOMS_YEAR와 같고 표에 있는 대차수일 때만 적용된다(2025년 동일 차수 비오염).
// - 운영 DB(WebCustomsWeekly/WebColombiaWeekly)에 저장행이 있으면 그 행이 항상 우선한다(행 단위).
// - source 태그는 HISTORICAL_CUSTOMS_SOURCE로 노출되어 화면이 "자동/저장값"이 아니라
//   "원본 엑셀 historical snapshot"임을 그대로 표시한다.
// - 백상 창고료 요율은 행마다 BakSangRateApplied로 박혀 있다. 국가 시트는 22~27차 모두 460원/kg이고,
//   콜롬비아 4품목 반차수 시트만 22차 370원/kg·23~27차 460원/kg이다(원본 수식 리터럴 그대로).

export const HISTORICAL_CUSTOMS_YEAR = '2026';
export const HISTORICAL_CUSTOMS_SOURCE = 'excel_historical_snapshot';

// 국가별(콜롬비아 수국 포함) 그외통관비 구성요소 — WebCustomsWeekly 컬럼과 같은 이름/의미.
const COUNTRY_ROWS_BY_MAJOR = {
${countryLines}
};

// 콜롬비아 4품목 반차수 구성요소 — WebColombiaWeekly 컬럼과 같은 이름/의미 + 원본 배분 박스수량.
// Truck1t/Truck2_5t/Truck5t는 자동 추천값이 아니라 그 주에 **실제로 사용한 차량 대수**다.
const COLOMBIA_ROWS_BY_WEEK = {
${colombiaLines}
};

// 본표 R(과세환율) — 통관 신고 시점 관세청 과세환율. 같은 통화라도 신고 주차가 다르면 값이 다르다
// (예: 27차 USD가 콜롬비아 1538.30 / 태국·에콰도르 1548.52). 그래서 통화가 아니라 카테고리 단위로 남긴다.
const TAXABLE_RATES_BY_MAJOR = {
${rateLines}
};

const inYear = (orderYear) => String(orderYear) === HISTORICAL_CUSTOMS_YEAR;

/** 국가 1건의 historical 구성요소 행(WebCustomsWeekly 모양). 대상 밖이면 null.
 * WorldFreight{1,2}Manual=1을 붙여 반환한다 — 원본 월드운송료는 그 주에 실제로 청구된 금액이므로
 * 자동 트럭 추천(deriveWorldFreight)이 이 값을 다시 계산해 덮어쓰면 안 된다. */
export function getHistoricalCountryCustomsRow(orderYear, major, category) {
  if (!inYear(orderYear)) return null;
  const row = COUNTRY_ROWS_BY_MAJOR[String(major)]?.[category];
  return row ? { ...row, WorldFreight1Manual: 1, WorldFreight2Manual: 1 } : null;
}

/** 콜롬비아 반차수 1건의 historical 구성요소 행 + 배분 박스수량. 대상 밖이면 null. */
export function getHistoricalColombiaWeekly(orderYear, orderWeek) {
  if (!inYear(orderYear)) return null;
  const entry = COLOMBIA_ROWS_BY_WEEK[String(orderWeek)];
  return entry ? { row: { ...entry.row }, boxQty: { ...entry.boxQty } } : null;
}

/** 카테고리별 historical 과세환율(R). 대상 밖이거나 그 주 구매가 없어 원본이 공란이면 null. */
export function getHistoricalTaxableRate(orderYear, major, category) {
  if (!inYear(orderYear)) return null;
  const rate = TAXABLE_RATES_BY_MAJOR[String(major)]?.[category];
  return rate == null ? null : rate;
}

/** historical snapshot이 있는 대차수 목록(테스트/진단/시드용). */
export function historicalCustomsMajors() {
  return Object.keys(COUNTRY_ROWS_BY_MAJOR);
}

/** historical snapshot이 있는 콜롬비아 반차수 목록(테스트/진단/시드용). */
export function historicalColombiaWeeks() {
  return Object.keys(COLOMBIA_ROWS_BY_WEEK);
}

/** 진단/시드 전용 — 전체 표를 그대로 반환한다(호출부가 변형해도 원본이 바뀌지 않도록 복사본). */
export function historicalCustomsTables() {
  return {
    year: HISTORICAL_CUSTOMS_YEAR,
    countries: JSON.parse(JSON.stringify(COUNTRY_ROWS_BY_MAJOR)),
    colombia: JSON.parse(JSON.stringify(COLOMBIA_ROWS_BY_WEEK)),
    taxableRates: JSON.parse(JSON.stringify(TAXABLE_RATES_BY_MAJOR)),
  };
}
`;
}

// ── 산출물 2: 회귀테스트 fixture ────────────────────────────────────────────────────────────
function buildFixture(weeks) {
  return {
    $schema: 'profit-report-22-27-customs-fixture-v1',
    generatedBy: 'scripts/extract-profit-report-workbooks.mjs (원본 Downloads xlsx read-only)',
    sourceNote: '"매출원가 양식 - NN차_재고수정.xlsx" 22~27차 6개 파일. "(1)" 복사본은 사용하지 않았다.',
    formulas: {
      countryH: '그외통관비!I(35+i) = 백상F + 관세L + 선율F + 월드운송료L + 한국방역F',
      countryHExpanded: '(GW1+GW2)×백상요율 + 관세1+관세2 + (선율1+선율2)/1.1 + (월드1+월드2)/1.1 + (방역1+방역2)/1.1',
      countryHVietnamException: '베트남 행만 선율 공급가가 리터럴이라 ÷1.1을 하지 않는다',
      colombiaTotal: '콜롬비아 N차!C17 = GW×백상요율 + 통관수수료 + 품목수×검역대행단가 + 실제 트럭비 + 관세료 + 소독비용 + 검역비용',
      colombiaAllocation: '콜롬비아 N차!H2x = C17 × (박스당무게×박스수량 비율) — GW/CW 무관 항상 무게비율',
      mainTotalsRanges: {
        includesDeduction: ['C', 'D', 'E', 'F', 'J'],
        excludesDeduction: ['G', 'H', 'I', 'L', 'N', 'O', 'P', 'Q', 'S', 'T'],
        note: 'U 합계만 SUM(U7:U20)으로 베트남(21행)까지 제외한다. K 합계는 행과 달리 항상 J/(C+F).',
      },
    },
    weeks: Object.fromEntries(weeks.map((w) => [w.major, w])),
  };
}

// ── 산출물 3: 웹 전용 테이블 구조화 seed(멱등, 기존 행이 있으면 건드리지 않음) ────────────────
function sqlNum(v) {
  return v == null ? 'NULL' : String(v);
}
function buildSeedSql(weeks) {
  const lines = [];
  lines.push('-- docs/migrations/2026-08-12_web_profit_report_historical_seed.sql');
  lines.push('-- 2026년 22~27차 매출원가 양식(원본 xlsx)의 그외통관비 구성요소·과세환율을 웹 전용 테이블에 seed 한다.');
  lines.push('-- 자동 생성물: scripts/extract-profit-report-workbooks.mjs');
  lines.push('--');
  lines.push('-- * 멱등이다 — 같은 OrderYear/차수/카테고리 행이 이미 있으면 아무것도 하지 않는다(운영자 입력 보존).');
  lines.push('-- * ERP 공용 원장(OrderMaster/OrderDetail/ShipmentMaster/ShipmentDetail/ShipmentDate/ShipmentFarm/');
  lines.push('--   Estimate/ProductStock/StockHistory)은 읽지도 쓰지도 않는다. 웹 전용 테이블만 대상이다.');
  lines.push('-- * SourceTag=N\'excel_historical_snapshot\' 으로 표시해 화면이 "운영자 저장값"과 구분해 보여준다.');
  lines.push('-- * 이 seed를 실행하지 않아도 lib/profitReportHistoricalCustoms.js 가 같은 값을 런타임 snapshot 으로');
  lines.push('--   제공한다. seed 는 "DB가 원천을 갖게 하는" 선택적 경로다.');
  lines.push('-- * 선행 실행 필요: 2026-08-12_web_taxable_exchange_rate.sql (WebTaxableExchangeRate 생성)');
  lines.push('');
  lines.push('SET XACT_ABORT ON;');
  lines.push('');
  lines.push("IF COL_LENGTH('dbo.WebCustomsWeekly','SourceTag') IS NULL");
  lines.push('  ALTER TABLE dbo.WebCustomsWeekly ADD SourceTag NVARCHAR(40) NULL;');
  lines.push('GO');
  lines.push("IF COL_LENGTH('dbo.WebColombiaWeekly','SourceTag') IS NULL");
  lines.push('  ALTER TABLE dbo.WebColombiaWeekly ADD SourceTag NVARCHAR(40) NULL;');
  lines.push('GO');
  lines.push('');
  lines.push('BEGIN TRAN;');
  lines.push('');
  for (const w of weeks) {
    lines.push(`-- ── 2026 ${w.major}차 국가별 그외통관비 구성요소 (백상요율 ${w.countryBakSangRate}원/kg)`);
    for (const cat of COUNTRY_ROWS) {
      const c = w.countries[cat];
      const cols = COUNTRY_STORE_FIELDS.join(', ');
      const vals = COUNTRY_STORE_FIELDS.map((f) => sqlNum(c[f])).join(', ');
      lines.push(`IF NOT EXISTS (SELECT 1 FROM dbo.WebCustomsWeekly WHERE OrderYear=N'2026' AND MajorWeek=N'${w.major}' AND Category=N'${cat}')`);
      lines.push(`  INSERT INTO dbo.WebCustomsWeekly (OrderYear, MajorWeek, Category, ${cols}, WorldFreight1Manual, WorldFreight2Manual, SourceTag, UpdatedBy)`);
      lines.push(`  VALUES (N'2026', N'${w.major}', N'${cat}', ${vals}, 1, 1, N'excel_historical_snapshot', N'excel-historical-seed');`);
    }
    lines.push('');
  }
  for (const w of weeks) {
    for (const [wk, c] of Object.entries(w.colombia)) {
      const cols = COLOMBIA_STORE_FIELDS.join(', ');
      const vals = COLOMBIA_STORE_FIELDS.map((f) => sqlNum(c[f])).join(', ');
      lines.push(`-- ── 2026 ${wk} 콜롬비아 4품목 반차수 구성요소 (백상요율 ${c.BakSangRateApplied}원/kg, 실제 트럭 1t×${c.Truck1t}/2.5t×${c.Truck2_5t}/5t×${c.Truck5t})`);
      lines.push(`IF NOT EXISTS (SELECT 1 FROM dbo.WebColombiaWeekly WHERE OrderYear=N'2026' AND OrderWeek=N'${wk}')`);
      lines.push(`  INSERT INTO dbo.WebColombiaWeekly (OrderYear, OrderWeek, ${cols}, SourceTag, UpdatedBy)`);
      lines.push(`  VALUES (N'2026', N'${wk}', ${vals}, N'excel_historical_snapshot', N'excel-historical-seed');`);
    }
  }
  lines.push('');
  lines.push('-- ── 2026 22~27차 과세환율(R) — 같은 통화라도 통관 신고 주차가 다르면 값이 다르므로 카테고리 단위로 저장한다.');
  for (const w of weeks) {
    for (const cat of MAIN_CATEGORIES) {
      const rate = numOrNull(w.main.rows[cat].cells.R.value);
      if (rate == null || rate <= 0) continue;
      lines.push(`IF NOT EXISTS (SELECT 1 FROM dbo.WebTaxableExchangeRate WHERE OrderYear=N'2026' AND MajorWeek=N'${w.major}' AND Category=N'${cat}')`);
      lines.push(`  INSERT INTO dbo.WebTaxableExchangeRate (OrderYear, MajorWeek, Currency, Category, Rate, RateSource, SourceNote, SavedBy)`);
      lines.push(`  VALUES (N'2026', N'${w.major}', N'', N'${cat}', ${rate}, N'excel_historical_snapshot', N'매출원가 양식 - ${w.major}차_재고수정.xlsx 본표 R열', N'excel-historical-seed');`);
    }
  }
  lines.push('');
  lines.push('COMMIT TRAN;');
  lines.push('GO');
  lines.push('');
  return lines.join('\n');
}

function main() {
  const weeks = MAJORS.map(extractWeek);
  const problems = weeks.flatMap(verify);
  if (problems.length) {
    console.error('원본 재현 검산 실패:');
    problems.forEach((p) => console.error(`  - ${p}`));
    process.exit(1);
  }
  console.log(`검산 통과 — 국가행 ${weeks.length * COUNTRY_ROWS.length}건, 콜롬비아 반차수 ${weeks.length * 2}건`);

  fs.writeFileSync(path.join(ROOT, 'lib', 'profitReportHistoricalCustoms.js'), buildModule(weeks), 'utf8');
  fs.writeFileSync(
    path.join(ROOT, '__tests__', 'fixtures', 'profit-report-22-27-customs.json'),
    `${JSON.stringify(buildFixture(weeks), null, 1)}\n`,
    'utf8',
  );
  fs.writeFileSync(
    path.join(ROOT, 'docs', 'migrations', '2026-08-12_web_profit_report_historical_seed.sql'),
    buildSeedSql(weeks),
    'utf8',
  );
  console.log('생성 완료: lib/profitReportHistoricalCustoms.js, __tests__/fixtures/profit-report-22-27-customs.json, docs/migrations/2026-08-12_web_profit_report_historical_seed.sql');
}

main();
