// lib/profitReportExcelParity.js — 주차별 매출이익 보고서: 웹 계산값 ↔ 원본 엑셀(2026 22~27차) 항목별 대조.
//
// 목적: "엑셀과 몇 % 다른가"가 아니라 **"그 차이가 무엇 때문인가"**를 항목별로 판정한다.
// 순수 계산 모듈이다 — DB·네트워크·파일 접근이 없고, 보고서 계산에 되먹임하지 않는다.
// 화면(pages/sales/profit-report.js)이 이미 가진 rowsWithCalc/totals 를 그대로 넘겨 쓴다.
//
// ## 판정 구조
//
// 1. **원천열(primary)** N·L·O·E·F·H·Q·R·S — 각자 독립 원천이 있다. 차이는 그 원천을 봐야 한다.
// 2. **파생열(derived)** C·P·T·G·I·J·K·M·D·U — 원천열의 산술 결과다. 차이는 정의상 상위 열 차이의
//    합이며 별도 원인이 있을 수 없다. 예: J=C−I 이므로 C가 +5%, I가 −3% 틀리면 J는 산술적으로
//    100% 넘게 틀린다 — **J·K에 5% 기준을 따로 적용하는 것은 성립하지 않는다.**
// 3. **엑셀 쪽 알려진 원인** — 원본 엑셀 자체의 수기 예외·결함(lib/profitReportExcelBaseline.js)은
//    웹 결함이 아니므로 "설명된 차이"로 분리하고, 5% 판정은 **미설명 차이**에만 적용한다.
//
// 분해는 **한 단계(one-level)** 만 한다. C←N/L/O 처럼 덧셈으로 정확히 나뉘는 관계만 금액을 배분하고,
// P=Q×R 처럼 곱셈이거나 합계행에서 범위(공제 포함/제외)가 달라지는 관계는 "상위 열"만 가리키고
// 금액 배분은 하지 않는다. 근거 없는 정밀도를 만들지 않기 위해서다.
import {
  getExcelBaseline,
  hasExcelBaseline,
  EXCEL_CARRYOVER_BREAKS,
  EXCEL_BASELINE_COLUMNS,
} from './profitReportExcelBaseline.js';

const n = (v) => (v == null || v === '' || Number.isNaN(Number(v)) ? null : Number(v));
const n0 = (v) => n(v) ?? 0;

/** 열 성격 — 반올림 잡음 컷(절대 하한)이 열마다 다르다. */
const COLUMN_KIND = {
  C: 'money', E: 'money', F: 'money', G: 'money', H: 'money', I: 'money', J: 'money',
  L: 'money', N: 'money', O: 'money', P: 'money', T: 'money',
  Q: 'foreign', S: 'foreign',
  R: 'rate',
  D: 'ratio', K: 'ratio', M: 'ratio', U: 'ratio',
};

/** 웹은 원화를 원 단위로 반올림하고 엑셀은 소수점을 유지하므로 행마다 최대 0.5원이 어긋난다.
 * 이 하한 이하의 차이는 반올림 잡음으로 보고 오차율을 계산하지 않는다. */
const ABS_FLOOR = { money: 10, foreign: 0.01, rate: 0.005, ratio: 0.00005 };
const ABS_FLOOR_TOTALS = { money: 100, foreign: 0.1, rate: 0.005, ratio: 0.00005 };

export const PRIMARY_COLUMNS = ['N', 'L', 'O', 'E', 'F', 'H', 'Q', 'R', 'S'];
export const DERIVED_COLUMNS = ['C', 'P', 'T', 'G', 'I', 'J', 'K', 'M', 'D', 'U'];

/** 기본 허용오차 5% — 사용자 업무 기준("모든 항목 5% 이내"). 미설명 차이에만 적용한다. */
export const DEFAULT_TOLERANCE_PCT = 0.05;

export const CAUSE_LABEL = {
  excel_carryover_break: '엑셀 수기 이월 불일치',
  excel_known_defect: '엑셀 원본 결함',
  excel_blank_cell: '엑셀 칸 미기입',
};

/** 파생열의 **바로 위 단계** 열. exact=true 면 그 열들의 차이 합이 이 열의 차이와 정확히 같다. */
export const DERIVED_PARENTS = {
  C: { parents: ['N', 'L', 'O'], exact: true, formula: 'C = N + L + O' },
  G: { parents: ['P', 'T'], exact: true, formula: 'G = P + T' },
  I: { parents: ['E', 'G', 'H', 'F'], exact: true, formula: 'I = E + G + H − F', signs: { E: 1, G: 1, H: 1, F: -1 } },
  J: { parents: ['C', 'I'], exact: true, formula: 'J = C − I', signs: { C: 1, I: -1 } },
  P: { parents: ['Q', 'R'], exact: false, formula: 'P = Q × R' },
  T: { parents: ['S', 'R'], exact: false, formula: 'T = S × R' },
  K: { parents: ['J', 'C'], exact: false, formula: 'K = J ÷ C' },
  M: { parents: ['L', 'C'], exact: false, formula: 'M = −L ÷ C' },
  D: { parents: ['C'], exact: false, formula: 'D = C ÷ 전체 C' },
  U: { parents: ['P'], exact: false, formula: 'U = P ÷ 전체 P' },
};

/** 이스라엘·뉴질랜드·일본 행은 원본 엑셀에서 I가 F를 빼지 않고 J가 F를 더한다. */
const NO_ENDING_PARENTS = {
  I: { parents: ['E', 'G', 'H'], exact: true, formula: 'I = E + G + H (F 미차감)', signs: { E: 1, G: 1, H: 1 } },
  J: { parents: ['C', 'I', 'F'], exact: true, formula: 'J = C − I + F', signs: { C: 1, I: -1, F: 1 } },
  K: { parents: ['J', 'C', 'F'], exact: false, formula: 'K = J ÷ (C + F)' },
};

function parentsFor(col, noEnding) {
  if (noEnding && NO_ENDING_PARENTS[col]) return NO_ENDING_PARENTS[col];
  return DERIVED_PARENTS[col] || null;
}

/** 파생열 차이를 바로 위 단계 열의 차이로 분해 — exact 관계일 때만 금액을 배분한다. */
function attributeDerived(col, web, excel, noEnding) {
  const spec = parentsFor(col, noEnding);
  if (!spec) return null;
  const parts = spec.parents.map((p) => ({
    source: p,
    amount: spec.exact ? (spec.signs?.[p] ?? 1) * (n0(web[p]) - n0(excel[p])) : null,
  }));
  if (spec.exact) parts.sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
  return { formula: spec.formula, exact: spec.exact, parts };
}

/** exact 관계에서 "상위 열 차이의 합"이 실제 차이와 어긋나는 잔차 — 0 이 아니면 웹이나 엑셀이
 * 자기 공식을 지키지 않는다는 뜻이라 그 자체가 조사 대상이다. */
function attributionResidual(col, web, excel, noEnding) {
  const spec = parentsFor(col, noEnding);
  if (!spec || !spec.exact) return null;
  if (n(web[col]) == null && n(excel[col]) == null) return null;
  const expected = spec.parents.reduce(
    (s, p) => s + (spec.signs?.[p] ?? 1) * (n0(web[p]) - n0(excel[p])), 0
  );
  return (n0(web[col]) - n0(excel[col])) - expected;
}

/** 알려진 원인은 차이를 **최대 얼마까지 설명하는지**의 상한이지, 무조건 빼는 상계액이 아니다.
 * 실제 차이가 0이면 설명할 것도 없고, 실제 차이가 예상보다 작으면 그만큼만 설명된다.
 * (이 구분이 없으면 웹이 엑셀과 완전히 같아졌을 때 오히려 "미설명 차이"가 생긴다.) */
function applyExplained(diff, explainedCap) {
  const cap = n0(explainedCap);
  if (cap === 0 || diff === 0) return 0;
  if (Math.sign(cap) !== Math.sign(diff)) return 0;   // 방향이 반대면 이 원인으로는 설명되지 않는다
  return Math.sign(diff) * Math.min(Math.abs(cap), Math.abs(diff));
}

function judge(col, { web, excel, explainedAmount, isTotals, tolerancePct }) {
  const kind = COLUMN_KIND[col] || 'money';
  const floor = (isTotals ? ABS_FLOOR_TOTALS : ABS_FLOOR)[kind];
  if (web == null && excel == null) return null;
  const diff = n0(web) - n0(excel);
  const unexplained = diff - n0(explainedAmount);
  const base = Math.abs(n0(excel));
  const pctDiff = base > floor ? diff / base : null;
  const unexplainedPct = base > floor ? unexplained / base : null;
  const hasExplained = Math.abs(n0(explainedAmount)) > floor;

  let verdict;
  if (Math.abs(unexplained) <= floor) verdict = hasExplained ? 'explained' : 'match';
  else if (unexplainedPct != null && Math.abs(unexplainedPct) <= tolerancePct) verdict = hasExplained ? 'explained' : 'match';
  else verdict = 'investigate';

  return { diff, pctDiff, explainedAmount: n0(explainedAmount), unexplained, unexplainedPct, verdict, absFloor: floor, kind };
}

/** 엑셀 쪽 알려진 원인을 (카테고리, 열) / (합계, 열) 단위로 모은다. */
function collectExcelCauses(baseline, major) {
  const byCell = new Map();
  const totalsByCol = new Map();
  const add = (map, key, entry) => {
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(entry);
  };
  const won = (v) => Math.round(n0(v)).toLocaleString('ko-KR');

  const chainCells = new Set();
  for (const brk of EXCEL_CARRYOVER_BREAKS) {
    if (String(brk.toMajor) !== String(major)) continue;
    chainCells.add(`${brk.category}|E`);
    // 웹은 전차수 기말(F)을 그대로 이월하므로 웹−엑셀 예상치 = prevWeekF − nextWeekE = brk.diff.
    const entry = {
      cause: 'excel_carryover_break',
      amount: n0(brk.diff),
      note: `원본 엑셀 ${brk.fromMajor}차 기말재고 ${won(brk.prevWeekF)}원이 ${brk.toMajor}차 기초재고에는 ${won(brk.nextWeekE)}원으로 적혀 있어, 엑셀이 자기 파일끼리 ${won(Math.abs(brk.diff))}원 어긋납니다. 웹은 전차수 기말을 그대로 이월합니다.`,
    };
    add(byCell, `${brk.category}|E`, entry);
    add(totalsByCol, 'E', entry);
  }
  for (const ex of baseline.manualExceptions || []) {
    if (!ex.column || ex.amount == null) continue;
    if (chainCells.has(`${ex.category}|${ex.column}`)) continue;   // 위 이월 불일치와 중복 방지
    const entry = { cause: 'excel_carryover_break', amount: -n0(ex.amount), note: ex.description };
    add(byCell, `${ex.category}|${ex.column}`, entry);
    add(totalsByCol, ex.column, entry);
  }
  for (const def of baseline.knownDefects || []) {
    if (!def.column || def.amount == null) continue;
    // 엑셀이 자기 시트에서 분류하지 못해 본표에 못 실은 금액 — 웹에는 있고 엑셀에는 없다.
    add(totalsByCol, def.column, { cause: 'excel_known_defect', amount: n0(def.amount), note: def.description });
  }
  return { byCell, totalsByCol };
}

const sumExplained = (entries) => (entries || []).reduce((s, e) => s + n0(e.amount), 0);

/**
 * 웹 계산값 ↔ 원본 엑셀 항목별 대조.
 *
 * @param {object} p
 * @param {string|number} p.orderYear
 * @param {string|number} p.major                대차수('27')
 * @param {Array<{category:string, variant?:string, calc:object}>} p.rowsWithCalc  화면이 쓰는 행 + computeProfitRow 결과
 * @param {object} p.totals                      computeProfitTotals 결과
 * @param {number} [p.tolerancePct]              미설명 차이 허용오차(기본 5%)
 */
export function buildExcelParity({ orderYear, major, rowsWithCalc = [], totals = {}, tolerancePct = DEFAULT_TOLERANCE_PCT } = {}) {
  const majorKey = String(major ?? '').padStart(2, '0');
  if (!hasExcelBaseline(orderYear, majorKey)) {
    return {
      available: false,
      orderYear: String(orderYear), major: majorKey,
      reason: `${orderYear}년 ${majorKey}차는 대조할 원본 엑셀이 없습니다. 원본은 2026년 22~27차 6개 파일뿐입니다.`,
    };
  }
  const baseline = getExcelBaseline(orderYear, majorKey);
  const { byCell, totalsByCol } = collectExcelCauses(baseline, majorKey);

  const buildCells = ({ web, excel, isTotals, noEnding, causesFor }) => {
    const cells = [];
    for (const col of EXCEL_BASELINE_COLUMNS) {
      const webV = n(web[col]);
      const excelV = n(excel[col]);
      const floor = (isTotals ? ABS_FLOOR_TOTALS : ABS_FLOOR)[COLUMN_KIND[col] || 'money'];
      const causes = [...(causesFor(col) || [])];

      // 엑셀 칸 자체가 비어 있는데(수기 미기입) 웹에는 값이 있으면 차이 전액이 "엑셀 미기입"이다.
      if (excelV == null && webV != null && Math.abs(webV) > floor) {
        causes.push({
          cause: 'excel_blank_cell',
          amount: webV,
          note: '원본 엑셀의 이 칸은 비어 있습니다(담당자 수기 미기입). 웹은 재고·원천에서 계산한 값을 표시합니다. 웹 값이 맞는지는 별도로 확인해야 합니다.',
        });
      }

      // 원인은 목록에 항상 남기되, 실제 차이를 얼마나 설명했는지(applied)를 따로 표시한다.
      // 방향이 반대이거나 차이가 이미 사라진 원인은 applied=0 이 되어 판정에 영향을 주지 않는다.
      const rawDiff = n0(webV) - n0(excelV);
      let remaining = rawDiff;
      const appliedCauses = causes.map((c) => {
        const applied = applyExplained(remaining, c.amount);
        remaining -= applied;
        return { ...c, applied };
      });

      const derived = DERIVED_COLUMNS.includes(col);
      const verdictInfo = judge(col, { web: webV, excel: excelV, explainedAmount: rawDiff - remaining, isTotals, tolerancePct });
      if (!verdictInfo) continue;

      cells.push({
        col,
        derived,
        web: webV,
        excel: excelV,
        causes: appliedCauses,
        attribution: derived ? attributeDerived(col, web, excel, noEnding) : null,
        // 합계행은 공제 포함/제외 범위가 열마다 달라(원본 엑셀 그대로) 행 단위 산술이 성립하지 않으므로
        // 잔차를 계산하지 않는다 — 없는 정밀도를 만들지 않기 위해서다.
        attributionResidual: derived && !isTotals ? attributionResidual(col, web, excel, noEnding) : null,
        ...verdictInfo,
      });
    }
    return cells;
  };

  const totalsCells = buildCells({
    web: totals || {},
    excel: baseline.totals || {},
    isTotals: true,
    noEnding: false,
    causesFor: (col) => totalsByCol.get(col),
  });

  const categories = [];
  for (const row of rowsWithCalc) {
    const excelRow = baseline.categories?.[row.category];
    if (!excelRow) continue;   // 기타(미분류) 등 원본 본표에 없는 웹 전용 행
    const noEnding = (row.variant || 'normal') === 'noEnding';
    categories.push({
      category: row.category,
      variant: row.variant || 'normal',
      cells: buildCells({
        web: row.calc || {},
        excel: excelRow,
        isTotals: false,
        noEnding,
        causesFor: (col) => byCell.get(`${row.category}|${col}`),
      }),
    });
  }

  const counts = { match: 0, explained: 0, investigate: 0 };
  for (const c of totalsCells) counts[c.verdict] = (counts[c.verdict] || 0) + 1;

  // "지금 봐야 할 것" — 원천열을 먼저, 그 다음 파생열. 파생열은 원천열을 고치면 따라 맞는다.
  const investigate = totalsCells
    .filter((c) => c.verdict === 'investigate')
    .sort((a, b) => (Number(a.derived) - Number(b.derived)) || (Math.abs(b.unexplained) - Math.abs(a.unexplained)));

  return {
    available: true,
    orderYear: String(orderYear),
    major: majorKey,
    sourceFile: baseline.sourceFile,
    tolerancePct,
    totals: totalsCells,
    categories,
    investigate,
    counts,
    primaryColumns: PRIMARY_COLUMNS,
    derivedColumns: DERIVED_COLUMNS,
  };
}
