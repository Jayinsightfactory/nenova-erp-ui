#!/usr/bin/env node
// scripts/build-profit-report-excel-baseline.mjs
//
// __tests__/fixtures/profit-report-22-27.json (원본 "매출원가 양식 - NN차_재고수정.xlsx" 6개 파일에서
// read-only 추출한 증거 fixture) → lib/profitReportExcelBaseline.js 를 생성한다.
//
// 왜 생성하나: lib/ 런타임 코드가 __tests__/ 를 import 하면 안 되고, 그렇다고 엑셀 기준값을 손으로
// 옮겨 적으면 fixture 와 조용히 어긋난다. 그래서 fixture 를 단일 진실 소스로 두고 lib 모듈을 기계
// 생성하며, __tests__/profitReportExcelBaseline.test.js 가 "생성물이 fixture 와 같은지"를 고정한다.
//
// 실행: node scripts/build-profit-report-excel-baseline.mjs
// 이 스크립트는 DB에 접속하지 않고 저장소 파일만 읽고 쓴다.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');
const FIXTURE = path.join(repoRoot, '__tests__', 'fixtures', 'profit-report-22-27.json');
const OUT = path.join(repoRoot, 'lib', 'profitReportExcelBaseline.js');

const COLS = ['C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U'];

const fixture = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));

/** 셀 값 정규화 — 엑셀 빈칸(수기 미기입)은 0 이 아니라 null 로 보존한다.
 * 0 과 빈칸의 구분이 이 대조의 핵심이다(빈칸 = 담당자가 안 적음, 0 = 적었는데 0). */
const cellValue = (cells, col) => {
  const cell = cells?.[col];
  if (!cell) return null;
  const v = cell.value;
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const weeks = {};
for (const major of Object.keys(fixture.weeks).sort()) {
  const wk = fixture.weeks[major];
  const categories = {};
  for (const cat of wk.categories) {
    const row = {};
    for (const col of COLS) row[col] = cellValue(cat.cells, col);
    categories[cat.category] = row;
  }
  const totals = {};
  for (const col of COLS) totals[col] = cellValue(wk.totals?.cells, col);

  weeks[major] = {
    major,
    sourceFile: wk.sourceFile,
    categories,
    totals,
    // 원본 엑셀 자체의 알려진 결함/수동 예외 — 웹 결함이 아니라 "엑셀 쪽 원인"으로 분류하기 위한 목록.
    manualExceptions: (wk.manualExceptions || []).map((x) => ({
      category: x.category,
      column: x.field,
      amount: x.diff ?? null,
      description: x.description,
    })),
    knownDefects: (wk.expectedAnomalies || [])
      .filter((a) => a.isOriginalDefect)
      .map((a) => ({
        id: a.id,
        column: a.id === 'ex-sales-j78-missing-classification' ? 'O' : null,
        amount: a.missingAmount ?? null,
        description: a.description,
      })),
  };
}

// 카테고리 이월 체인(F(n) → E(n+1)) 불일치 — 엑셀이 자기 파일끼리 어긋난 지점.
const carryoverBreaks = [];
for (const [pair, chain] of Object.entries(fixture.carryoverChain || {})) {
  for (const row of chain.perCategory || []) {
    if (row.match && Math.abs(row.diff || 0) <= 0.005) continue;
    const [fromMajor, toMajor] = pair.split('->');
    carryoverBreaks.push({
      fromMajor,
      toMajor,
      category: row.category,
      prevWeekF: row.endStockPrevWeek_F,
      nextWeekE: row.beginStockNextWeek_E,
      diff: row.diff,
    });
  }
}

const banner = `// lib/profitReportExcelBaseline.js — 자동 생성 파일. 직접 수정하지 말 것.
//
// 생성: node scripts/build-profit-report-excel-baseline.mjs
// 원천: __tests__/fixtures/profit-report-22-27.json
//        (원본 "매출원가 양식 - NN차_재고수정.xlsx" 22~27차 6개 파일에서 read-only 추출)
//
// 2026년 22~27차 원본 엑셀의 카테고리별/합계 값 + 원본 자체의 알려진 결함·수동 예외를 담는다.
// lib/profitReportExcelParity.js 가 웹 계산값과 이 기준값을 대조해 항목별 오차율과 원인을 만든다.
// 이 파일은 **대조용 참고값**이며 보고서 계산에 자동으로 들어가지 않는다.
//
// 빈칸(엑셀에서 담당자가 수기로 적지 않은 칸)은 0 이 아니라 null 이다 — 0 과 구분해야
// "엑셀이 안 적은 것"과 "엑셀이 0으로 적은 것"을 다른 원인으로 판정할 수 있다.
`;

const body = `${banner}
export const EXCEL_BASELINE_COLUMNS = ${JSON.stringify(COLS)};

export const EXCEL_BASELINE_ORDER_YEAR = '2026';

export const EXCEL_BASELINE_WEEKS = ${JSON.stringify(weeks, null, 2)};

/** 원본 엑셀이 자기 파일끼리 어긋난 재고 이월 지점(F(n) ≠ E(n+1)) — 웹 결함이 아니다. */
export const EXCEL_CARRYOVER_BREAKS = ${JSON.stringify(carryoverBreaks, null, 2)};

/** 대조 기준값이 있는 차수인지 — 2026년 22~27차만 원본 엑셀이 존재한다. */
export function hasExcelBaseline(orderYear, major) {
  if (String(orderYear) !== EXCEL_BASELINE_ORDER_YEAR) return false;
  return Object.prototype.hasOwnProperty.call(EXCEL_BASELINE_WEEKS, String(major).padStart(2, '0'));
}

export function getExcelBaseline(orderYear, major) {
  if (!hasExcelBaseline(orderYear, major)) return null;
  return EXCEL_BASELINE_WEEKS[String(major).padStart(2, '0')];
}
`;

fs.writeFileSync(OUT, body, 'utf8');
process.stdout.write(`wrote ${path.relative(repoRoot, OUT)} (${Object.keys(weeks).length} weeks, ${carryoverBreaks.length} carryover breaks)\n`);
