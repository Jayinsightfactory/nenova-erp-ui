#!/usr/bin/env node
// scripts/extract-profit-workbook-fixture.mjs
// "매출원가 양식 - NN차_재고수정.xlsx"(22~27차) 원본에서 매출이익 보고서 재현에 필요한 모든 원천을
// read-only로 추출해 __tests__/fixtures/profit-report-22-27-full.json 을 만든다.
//
// 추출 대상
//  1. 주차별 매출이익 보고서 본표 — 카테고리별 C~U 값 + 수식(공식 parity 기준)
//  2. 그외통관비 시트 — 국가별 H 구성요소(백상 GW1/GW2·요율, 관세1/2, 선율1/2, 월드운송료1/2, 한국방역1/2)
//  3. 콜롬비아 1차/2차 시트 — 반차수 H 구성요소(GW/CW, 백상요율, 통관수수료, 품목수, 트럭 대수, 항공료)
//     + 품목별 박스당무게/박스수량/박스당CBM(무게·CBM 배분비율 원천)
//  4. 운송비 단가표(1t/2.5t/5t)
//
// 운영 DB에 접속하지 않는다. 결과 JSON은 테스트 증거이며 프로덕션 런타임이 import하지 않는다.
//   node scripts/extract-profit-workbook-fixture.mjs [--out <path>] [--check]
import fs from 'node:fs';
import path from 'node:path';
import XLSX from 'xlsx';

const DOWNLOADS = process.env.PROFIT_WORKBOOK_DIR
  || path.join(process.env.USERPROFILE || process.env.HOME || '.', 'Downloads');
const WEEKS = ['22', '23', '24', '25', '26', '27'];
const MAIN = '주차별 매출이익 보고서';
const CUSTOMS = '그외통관비';
const COLS = ['C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U'];

// 본표 행 ↔ 카테고리 (22~27차 전부 동일)
const MAIN_ROWS = [
  [7, '콜롬비아 수국'], [8, '콜롬비아 카네이션'], [9, '콜롬비아 장미'], [10, '콜롬비아 루스커스'],
  [11, '콜롬비아 알스트로'], [12, '네덜란드'], [13, '호주'], [14, '태국'], [15, '중국'],
  [16, '에콰도르'], [17, '미국'], [18, '이스라엘'], [19, '뉴질랜드'], [20, '일본'],
  [21, '베트남'], [22, '공제'],
];
const TOTAL_ROW = 23;

// 그외통관비 시트 블록별 행 ↔ 국가 (백상/관세는 5~15, 선율/월드운송료는 20~30, 한국방역/합계는 35~45)
const CUSTOMS_COUNTRIES = [
  '콜롬비아 수국', '네덜란드', '태국', '호주', '미국', '중국', '에콰도르', '이스라엘', '뉴질랜드', '일본', '베트남',
];
const BAKSANG_BASE = 5;      // B5..B15
const SUNYUL_BASE = 20;      // B20..B30
const QUARANTINE_BASE = 35;  // B35..B45
// 본표 H가 참조하는 합계 행(그외통관비!I35~I45)은 QUARANTINE_BASE 와 같은 행이다.

// 콜롬비아 1차/2차 시트 좌표
const COL_SHEETS = { '01': '콜롬비아 1차', '02': '콜롬비아 2차' };
const COL_ALLOC_ROWS = [[37, '콜롬비아 장미'], [38, '콜롬비아 카네이션'], [39, '콜롬비아 알스트로'], [40, '콜롬비아 루스커스']];

const num = (cell) => (cell == null || cell.v == null || typeof cell.v !== 'number' ? null : cell.v);
const at = (ws, addr) => ws[addr] || null;
const val = (ws, addr) => num(at(ws, addr));
const cellOf = (ws, addr) => {
  const c = at(ws, addr);
  return { value: c?.v ?? null, formula: c?.f ?? null };
};

function readWorkbook(week) {
  const file = path.join(DOWNLOADS, `매출원가 양식 - ${week}차_재고수정.xlsx`);
  if (!fs.existsSync(file)) throw new Error(`missing workbook: ${file}`);
  return { file: path.basename(file), wb: XLSX.read(fs.readFileSync(file), { cellFormula: true, cellDates: true }) };
}

function extractMain(ws) {
  const categories = MAIN_ROWS.map(([row, category]) => ({
    row,
    category,
    cells: Object.fromEntries(COLS.map((c) => [c, cellOf(ws, `${c}${row}`)])),
  }));
  const totals = Object.fromEntries(COLS.map((c) => [c, cellOf(ws, `${c}${TOTAL_ROW}`)]));
  return { categories, totals, totalRow: TOTAL_ROW };
}

function extractCountryCustoms(ws) {
  const bakSangRate = val(ws, 'C3');
  const out = {};
  CUSTOMS_COUNTRIES.forEach((country, i) => {
    const b = BAKSANG_BASE + i, s = SUNYUL_BASE + i, q = QUARANTINE_BASE + i;
    out[country] = {
      BakSangRate: bakSangRate,
      GW1: val(ws, `C${b}`) ?? 0,
      GW2: val(ws, `D${b}`) ?? 0,
      Customs1: val(ws, `I${b}`) ?? 0,
      Customs2: val(ws, `J${b}`) ?? 0,
      SunYul1: val(ws, `C${s}`) ?? 0,
      SunYul2: val(ws, `D${s}`) ?? 0,
      WorldFreight1: val(ws, `I${s}`) ?? 0,
      WorldFreight2: val(ws, `J${s}`) ?? 0,
      Quarantine1: val(ws, `C${q}`) ?? 0,
      Quarantine2: val(ws, `D${q}`) ?? 0,
      // 원본 합계 셀(그외통관비!I{q}) — 재현 검증 기준값
      excelTotal: val(ws, `I${q}`),
      // 시트가 쓰는 공급가 변환 수식(베트남 선율은 ÷1.1 없음 — 예외를 증거로 남긴다)
      sunYulNetFormula: at(ws, `F${s}`)?.f ?? null,
      quarantineNetFormula: at(ws, `F${q}`)?.f ?? null,
      customsNetFormula: at(ws, `L${b}`)?.f ?? null,
      worldFreightNetFormula: at(ws, `L${s}`)?.f ?? null,
      bakSangNetFormula: at(ws, `F${b}`)?.f ?? null,
      totalFormula: at(ws, `I${q}`)?.f ?? null,
    };
  });
  return out;
}

function extractTruckRates(ws) {
  // 그외통관비!N20:O22 (1t/2.5t/5t 단가)
  return {
    Truck1t: val(ws, 'O20'),
    Truck2_5t: val(ws, 'O21'),
    Truck5t: val(ws, 'O22'),
  };
}

function extractColombia(ws) {
  const boxQty = {}, boxWeight = {}, boxCbm = {};
  for (const [row, cat] of COL_ALLOC_ROWS) {
    boxWeight[cat] = val(ws, `K${row}`) ?? 0;
    boxQty[cat] = val(ws, `L${row}`) ?? 0;
    boxCbm[cat] = val(ws, `P${row}`) ?? 0;
  }
  const bakSangFormula = at(ws, 'C10')?.f || '';
  const rateMatch = bakSangFormula.match(/\*\s*(\d+(?:\.\d+)?)/);
  return {
    GW: val(ws, 'E10') ?? 0,
    CW: val(ws, 'L29') ?? 0,
    GWCheck: val(ws, 'L30') ?? 0,
    BakSangRate: rateMatch ? Number(rateMatch[1]) : null,
    HandlingFee: val(ws, 'C11') ?? 0,               // 통관수수료(선율)
    ItemCount: val(ws, 'E12') ?? 0,                 // 검역대행수수료 품목수
    Truck1t: val(ws, 'I5') ?? 0,
    Truck2_5t: val(ws, 'I6') ?? 0,
    Truck5t: val(ws, 'I7') ?? 0,
    TruckRate1t: val(ws, 'H5') ?? 0,
    TruckRate2_5t: val(ws, 'H6') ?? 0,
    TruckRate5t: val(ws, 'H7') ?? 0,
    CustomsFee: val(ws, 'C14') ?? 0,                // 관세료
    DisinfectFee: val(ws, 'C15') ?? 0,              // 소독비용
    QuarantineDeductFee: val(ws, 'C16') ?? 0,       // 검역비용
    AirRateUSD: val(ws, 'D6') ?? 0,                 // 항공료(USD)
    ExchangeRate: val(ws, 'D4'),
    excelTotal: val(ws, 'C17'),
    totalFormula: at(ws, 'C17')?.f ?? null,
    boxQty, boxWeight, boxCbm,
  };
}

const out = {
  $schema: 'profit-report-22-27-full-fixture-v1',
  generatedBy: 'scripts/extract-profit-workbook-fixture.mjs (read-only extraction from original Downloads xlsx)',
  sourceNote: '원본 6개 파일("매출원가 양식 - NN차_재고수정.xlsx", 22~27차)에서 read-only 추출. "(1)" 사본은 사용하지 않았다.',
  mainSheetColumns: {
    C: '매출액 (N+L+O)', D: '매출비율 (C/합계C)', E: '기초상품재고액', F: '기말상품재고액',
    G: '매입액(상품+포워딩) (P+T)', H: '그외통관비', I: '매출원가 (E+G+H-F)', J: '매출이익 (C-I)',
    K: '이익률 (J/C)', L: '불량금액', M: '불량율 (-L/C)', N: '매출액(판매현황 SUMIF)', O: '그 외 매출액',
    P: '상품 금액(구매) (Q*R)', Q: '구매금액(외화)', R: '과세환율', S: '포워딩비용(USD)',
    T: '포워딩 원화환산 (S*R)', U: '상품구매비율 (P/합계P)',
  },
  weeks: {},
};

for (const week of WEEKS) {
  const { file, wb } = readWorkbook(week);
  const mainWs = wb.Sheets[MAIN];
  const customsWs = wb.Sheets[CUSTOMS];
  const colombia = {};
  for (const [suffix, sheetName] of Object.entries(COL_SHEETS)) {
    if (wb.Sheets[sheetName]) colombia[`${week}-${suffix}`] = extractColombia(wb.Sheets[sheetName]);
  }
  out.weeks[week] = {
    major: week,
    sourceFile: file,
    main: extractMain(mainWs),
    countryCustoms: extractCountryCustoms(customsWs),
    truckRates: extractTruckRates(customsWs),
    colombia,
  };
}

const outPath = process.argv.includes('--out')
  ? process.argv[process.argv.indexOf('--out') + 1]
  : path.join(process.cwd(), '__tests__', 'fixtures', 'profit-report-22-27-full.json');
fs.writeFileSync(outPath, `${JSON.stringify(out, null, 1)}\n`, 'utf8');
process.stderr.write(`wrote ${outPath}\n`);
