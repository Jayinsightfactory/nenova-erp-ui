// 매출이익 보고서 엑셀 생성 — 원본 "매출원가 양식.xlsx" 첫 시트를 템플릿으로 사용해
// 셀 구성·병합·열너비·행높이·서식을 100% 유지하고 값만 채운다 (서버 전용, xlsx-js-style).
import XLSX from 'xlsx-js-style';
import fs from 'fs';
import path from 'path';
import { EXTRA_CATEGORY, profitReportCategoriesForWeek } from './profitReportCountryResolver.js';
import { computeProfitRow, computeProfitTotals, calcRevenueRatio, calcPurchaseRatio } from './profitReportCalc.js';

const SHEET = '주차별 매출이익 보고서';
const FMT = {
  money: '#,##0',
  moneyWon: '_-"₩"* #,##0_-;\\-"₩"* #,##0_-;_-"₩"* "-"_-;_-@_-',
  acct: '_-* #,##0_-;\\-* #,##0_-;_-* "-"_-;_-@_-',
  pct2: '0.00%',
  pct0: '0%',
  usd: '_-[$$-409]* #,##0.00_ ;_-[$$-409]* \\-#,##0.00\\ ;_-[$$-409]* "-"??_ ;_-@_ ',
  rate: '_-* #,##0.00_-;\\-* #,##0.00_-;_-* "-"_-;_-@_-',
};
// 원본 파일에서 읽어낸 열별 숫자서식 그대로
const COLFMT = {
  C: FMT.money, D: FMT.pct2, E: FMT.acct, F: FMT.acct, G: FMT.money, H: FMT.money,
  I: FMT.money, J: FMT.money, K: FMT.pct2, L: FMT.money, M: FMT.pct2, N: FMT.money,
  O: FMT.money, P: FMT.money, Q: FMT.usd, R: FMT.rate, S: FMT.usd, T: FMT.money, U: FMT.pct0,
};
const WON_COLS = ['C', 'E', 'F', 'G', 'H', 'I', 'J', 'L', 'N', 'O', 'P', 'T']; // 합계행은 ₩ 표기
const COL_LABEL = {
  C: '매출액', D: '매출비율', E: '기초상품재고액', F: '기말상품재고액', G: '매입액(상품+포워딩)',
  H: '그외통관비', I: '매출원가', J: '매출이익', K: '이익률', L: '불량금액', M: '불량율',
  N: '순수매출액', O: '그 외 매출액', P: '상품 금액(구매)', Q: '구매금액(외화)', R: '환율',
  S: '포워딩(USD)', T: '포워딩 원화환산', U: '상품구매비율',
};

// 화면 보고서와 같은 파랑 계열을 사용한다. 원본 회계 시트는 템플릿 서식을
// 그대로 보존하고, 사용자가 화면에서 선택한 열을 받는 보조 시트에만 적용한다.
const DISPLAY_COLORS = {
  navy: '17365D',
  blue: '1F4E78',
  stripe: 'F4F8FC',
  total: 'DDEBF7',
  border: 'A6B7C8',
  text: '1F2937',
  white: 'FFFFFF',
};
const thinBorder = {
  top: { style: 'thin', color: { rgb: DISPLAY_COLORS.border } },
  bottom: { style: 'thin', color: { rgb: DISPLAY_COLORS.border } },
  left: { style: 'thin', color: { rgb: DISPLAY_COLORS.border } },
  right: { style: 'thin', color: { rgb: DISPLAY_COLORS.border } },
};

function styleDisplaySheet(ws, { cols, bodyCount, title, subtitle }) {
  const lastCol = XLSX.utils.encode_col(cols.length);
  const headerRow = 4;
  const firstBodyRow = headerRow + 1;
  const totalRow = firstBodyRow + bodyCount;

  ws.A1 = { t: 's', v: title, s: {
    font: { name: '맑은 고딕', sz: 16, bold: true, color: { rgb: DISPLAY_COLORS.white } },
    fill: { patternType: 'solid', fgColor: { rgb: DISPLAY_COLORS.navy } },
    alignment: { horizontal: 'left', vertical: 'center' },
  } };
  ws.A2 = { t: 's', v: subtitle, s: {
    font: { name: '맑은 고딕', sz: 9, color: { rgb: '475569' } },
    fill: { patternType: 'solid', fgColor: { rgb: 'EEF4FA' } },
    alignment: { horizontal: 'left', vertical: 'center' },
  } };
  ws['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: cols.length } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: cols.length } },
  ];

  for (let c = 0; c <= cols.length; c += 1) {
    const header = ws[XLSX.utils.encode_cell({ r: headerRow - 1, c })];
    if (header) header.s = {
      font: { name: '맑은 고딕', sz: 10, bold: true, color: { rgb: DISPLAY_COLORS.white } },
      fill: { patternType: 'solid', fgColor: { rgb: DISPLAY_COLORS.blue } },
      border: thinBorder,
      alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
    };

    for (let r = firstBodyRow; r <= totalRow; r += 1) {
      const addr = XLSX.utils.encode_cell({ r: r - 1, c });
      // 스타일만 있는 빈 셀(t:'z')은 일부 Excel writer가 생략한다. 빈 문자열 셀로
      // 유지해야 값이 없는 비율·환율 칸에도 테두리와 교차 행 색상이 끊기지 않는다.
      const cell = ws[addr] || (ws[addr] = { t: 's', v: '' });
      const isTotal = r === totalRow;
      cell.s = {
        font: {
          name: '맑은 고딕', sz: 9,
          bold: isTotal || c === 0,
          color: { rgb: DISPLAY_COLORS.text },
        },
        fill: {
          patternType: 'solid',
          fgColor: { rgb: isTotal ? DISPLAY_COLORS.total : (r % 2 ? DISPLAY_COLORS.stripe : DISPLAY_COLORS.white) },
        },
        border: isTotal
          ? { ...thinBorder, top: { style: 'medium', color: { rgb: DISPLAY_COLORS.blue } } }
          : thinBorder,
        alignment: {
          horizontal: c === 0 ? 'left' : 'right', vertical: 'center', wrapText: c === 0,
        },
      };
      if (c > 0) {
        const key = cols[c - 1];
        if (cell.t === 'n' && COLFMT[key]) cell.z = isTotal && WON_COLS.includes(key) ? FMT.moneyWon : COLFMT[key];
      }
    }
  }

  ws['!rows'] = [
    { hpt: 28 }, { hpt: 20 }, { hpt: 8 }, { hpt: 32 },
    ...Array.from({ length: bodyCount }, () => ({ hpt: 24 })),
    { hpt: 26 },
  ];
  ws['!cols'] = [
    { wch: 23 },
    ...cols.map(k => ({ wch: ['E', 'F', 'G', 'P', 'Q', 'S', 'T'].includes(k) ? 18 : 14 })),
  ];
  ws['!autofilter'] = { ref: `A${headerRow}:${lastCol}${totalRow}` };
  ws['!margins'] = { left: 0.25, right: 0.25, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 };
  ws['!ref'] = `A1:${lastCol}${totalRow}`;
}

function setCell(sheet, addr, val, z) {
  const cell = sheet[addr] || (sheet[addr] = {});
  delete cell.f; delete cell.w;
  if (z) cell.z = z;
  if (val == null || (typeof val === 'number' && Number.isNaN(val))) {
    cell.t = 'z'; delete cell.v;
  } else if (typeof val === 'string') {
    cell.t = 's'; cell.v = val;
  } else {
    cell.t = 'n'; cell.v = val;
  }
}

// 화면에서 컬럼을 숨긴 상태로 다운받으면, 원본 시트는 그대로 두고 두번째 시트에
// "활성화(표시) 컬럼만" 다시 뽑아 보여준다 — 회계용 원본 양식 호환은 유지하면서 화면 그대로도 받게.
function buildFilteredSheet(wb, { major, rows, visibleCols, confirmedTotals }) {
  const cols = visibleCols.filter(k => COL_LABEL[k]);
  if (!cols.length) return;

  const bodyRows = profitReportCategoriesForWeek(major).map(def => {
    const r = rows.find(x => x.category === def.key)
      || { category: def.key, variant: def.variant || 'normal', auto: { N: 0, L: 0, O: 0, Q: 0, S: 0 }, manual: {} };
    // 확정 스냅샷 행은 저장된 calc를 그대로 쓴다(재계산 금지 — 이후 계산식이 바뀌어도 과거 확정본은 불변).
    return { ...r, calc: r.confirmed && r.calc ? r.calc : computeProfitRow(r) };
  });
  const totals = confirmedTotals || computeProfitTotals(bodyRows);

  const aoa = [
    [`주차별 매출이익 보고서-${Number(major)}차`],
    ['웹 화면에서 선택한 열만 표시한 보기용 시트입니다. 원본 회계 양식은 첫 번째 시트에 보존됩니다.'],
    [],
    ['품명', ...cols.map(k => COL_LABEL[k])],
  ];
  bodyRows.forEach(row => {
    const c = row.calc;
    // 확정 스냅샷 행은 저장된 D/U를 그대로 쓴다(재계산 금지 — 2026-08-11 결함수정).
    const D = row.confirmed ? c.D : calcRevenueRatio(c, totals);
    const U = row.confirmed ? c.U : calcPurchaseRatio(c, totals);
    const valFor = { ...c, D, U };
    aoa.push([row.category, ...cols.map(k => (valFor[k] == null ? null : valFor[k]))]);
  });
  const totVals = {
    C: totals.C, D: totals.D, E: totals.E, F: totals.F, G: totals.G, H: totals.H, I: totals.I,
    J: totals.J, K: totals.K, L: totals.L, M: totals.M, N: totals.N, O: totals.O,
    P: totals.P, Q: totals.Q || null, R: null, S: totals.S || null, T: totals.T, U: totals.U,
  };
  aoa.push(['합계', ...cols.map(k => (totVals[k] == null ? null : totVals[k]))]);

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  cols.forEach((k, ci) => {
    const colLetter = XLSX.utils.encode_col(ci + 1); // +1: 0번 컬럼은 품명
    for (let r = 4; r < aoa.length; r++) {
      const addr = `${colLetter}${r + 1}`;
      if (ws[addr] && ws[addr].t === 'n' && COLFMT[k]) ws[addr].z = COLFMT[k];
    }
  });
  styleDisplaySheet(ws, {
    cols,
    bodyCount: bodyRows.length,
    title: `주차별 매출이익 보고서-${Number(major)}차`,
    subtitle: '웹 화면에서 선택한 열 · 첫 번째 시트에 기존 엑셀 양식 보존',
  });
  XLSX.utils.book_append_sheet(wb, ws, '화면표시(선택컬럼)');
}

// 월별 시트 — loadAnnualMonthlyReportData 결과(months)를 2번째 시트로 붙인다.
// 주차 원장을 재계산하지 않고 월 귀속 합계만 표시한다 (E/F는 월 합산하지 않음 — profitReportMonthly 정책).
const MONTHLY_COLS = ['C', 'G', 'H', 'I', 'J', 'K', 'L', 'N', 'O', 'P', 'Q', 'S', 'T'];
function buildMonthlySheet(wb, monthly) {
  const months = Array.isArray(monthly?.months) ? monthly.months : [];
  if (!months.length) return;
  const boundaryMajors = new Set((monthly.boundaryWeeks || []).map(w => String(w.major)));
  const header = ['월', '귀속차수', ...MONTHLY_COLS.map(k => COL_LABEL[k])];
  const aoa = [[`월별 매출이익 (${monthly.year}년)`], header];
  const yearTotals = Object.fromEntries(MONTHLY_COLS.map(k => [k, 0]));
  let yearMarginDenominator = 0;
  months.forEach(month => {
    const majors = (month.includedWeeks || []).map(w => `${Number(w.major)}${boundaryMajors.has(String(w.major)) ? '*' : ''}차`);
    const hasData = month.status !== 'no_data';
    if (hasData) {
      MONTHLY_COLS.forEach(k => { if (k !== 'K') yearTotals[k] += Number(month.totals?.[k] || 0); });
      yearMarginDenominator += Number(month.marginDenominator || 0);
    }
    aoa.push([
      `${month.month}월`,
      majors.join(',') || '-',
      ...MONTHLY_COLS.map(k => (hasData ? (month.totals?.[k] == null ? null : month.totals[k]) : null)),
    ]);
  });
  yearTotals.K = yearMarginDenominator !== 0 ? yearTotals.J / yearMarginDenominator : null;
  aoa.push(['합계', '', ...MONTHLY_COLS.map(k => (yearTotals[k] == null ? null : yearTotals[k]))]);
  aoa.push([]);
  aoa.push(['※ *표시 차수는 목~수 기간이 두 달에 걸친 월경계 차수 — 종료일이 속한 달에 전체 귀속.']);
  aoa.push(['※ 기초/기말 상품재고액(E/F)은 주차 원장 전용이라 월별로 합산하지 않는다.']);
  if ((monthly.missingWeeks || []).length) {
    aoa.push([`※ 기간 미확인/조회 실패 차수: ${monthly.missingWeeks.map(w => `${Number(w.major)}차`).join(', ')} — 월별 합계 미포함.`]);
  }
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  MONTHLY_COLS.forEach((k, ci) => {
    const colLetter = XLSX.utils.encode_col(ci + 2); // 0=월, 1=귀속차수
    for (let r = 2; r < aoa.length; r++) {
      const addr = `${colLetter}${r + 1}`;
      if (ws[addr] && ws[addr].t === 'n' && COLFMT[k]) ws[addr].z = COLFMT[k];
    }
  });
  ws['!cols'] = [{ wch: 6 }, { wch: 18 }, ...MONTHLY_COLS.map(() => ({ wch: 14 }))];
  XLSX.utils.book_append_sheet(wb, ws, '월별');
}

export function buildProfitReportXlsx({ major, rows, note, audit, visibleCols, confirmedTotals, monthly, displaySheetFirst = false }) {
  const tplPath = path.join(process.cwd(), 'data', 'profit-report-template.xlsx');
  const wb = XLSX.read(fs.readFileSync(tplPath), { cellStyles: true, cellNF: true });
  const sheet = wb.Sheets[SHEET];
  // 방어: 삭제된 시트를 참조하는 명명된 범위가 남아있으면 Excel 이 "복구" 다이얼로그를 띄운다
  if (wb.Workbook) {
    wb.Workbook.Names = [];
    if (Array.isArray(wb.Workbook.Sheets)) wb.Workbook.Sheets = wb.Workbook.Sheets.filter(s => s?.name === SHEET);
  }

  // 제목 + 작성일(C5)을 생성 시점으로
  setCell(sheet, 'B1', `주차별 매출이익 보고서-${Number(major)}차`);
  const today = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
  setCell(sheet, 'C5', today);

  // 본문 16행 — 22~27차 마지막 행은 공제, 28차부터는 국내다.
  const bodyRows = profitReportCategoriesForWeek(major).map(def => {
    const r = rows.find(x => x.category === def.key)
      || { category: def.key, variant: def.variant || 'normal', auto: { N: 0, L: 0, O: 0, Q: 0, S: 0 }, manual: {} };
    // 확정 스냅샷 행은 저장된 calc를 그대로 쓴다(재계산 금지 — 이후 계산식이 바뀌어도 과거 확정본은 불변).
    return { ...r, calc: r.confirmed && r.calc ? r.calc : computeProfitRow(r) };
  });
  const totals = confirmedTotals || computeProfitTotals(bodyRows);

  bodyRows.forEach((row, i) => {
    const xr = 8 + i;
    setCell(sheet, `B${xr}`, row.category);
    const c = row.calc;
    // 확정 스냅샷 행은 저장된 D/U를 그대로 쓴다(재계산 금지 — 2026-08-11 결함수정).
    const D = row.confirmed ? c.D : calcRevenueRatio(c, totals);
    const U = row.confirmed ? c.U : calcPurchaseRatio(c, totals);
    const vals = {
      C: c.C, D, E: c.E, F: c.F, G: c.G, H: c.H, I: c.I, J: c.J, K: c.K,
      L: c.L, M: c.M, N: c.N, O: c.O, P: c.P, Q: c.Q || null, R: c.R, S: c.S, T: c.T, U,
    };
    for (const [col, v] of Object.entries(vals)) setCell(sheet, `${col}${xr}`, v, COLFMT[col]);
  });

  // 합계행(24) — 원본과 동일하게 ₩ 서식
  const totVals = {
    C: totals.C, D: totals.D, E: totals.E, F: totals.F, G: totals.G, H: totals.H, I: totals.I,
    J: totals.J, K: totals.K, L: totals.L, M: totals.M, N: totals.N, O: totals.O,
    P: totals.P, Q: totals.Q || null, R: null, S: totals.S || null, T: totals.T, U: totals.U,
  };
  for (const [col, v] of Object.entries(totVals)) {
    setCell(sheet, `${col}24`, v, WON_COLS.includes(col) ? FMT.moneyWon : COLFMT[col]);
  }

  // 비고 (B28 병합영역) — 자동 미분류 내역은 웹 검증 화면에서만 표시한다.
  let noteText = String(note || '');
  const exportAuditIssues = (audit?.issues || []).filter(issue => issue?.category !== EXTRA_CATEGORY);
  if (exportAuditIssues.length) {
    const auditLines = exportAuditIssues.slice(0, 8).map((issue) =>
      `- ${issue.category} [${(issue.columns || []).join('/')}] ${issue.message}`);
    const exportErrorCount = exportAuditIssues.filter(issue => issue?.severity === 'error').length;
    const exportWarningCount = exportAuditIssues.filter(issue => issue?.severity === 'warning').length;
    noteText += `${noteText ? '\n' : ''}※ 자동검증: 오류 ${exportErrorCount}건 · 확인 ${exportWarningCount}건\n${auditLines.join('\n')}`;
    if (exportAuditIssues.length > auditLines.length) noteText += `\n- 외 ${exportAuditIssues.length - auditLines.length}건은 웹 보고서에서 확인`;
  }
  setCell(sheet, 'B28', noteText || null);

  if (monthly) buildMonthlySheet(wb, monthly); // 2번째 시트 — MOYI 드라이브 배포본에서 월별 보기
  if (Array.isArray(visibleCols) && visibleCols.length) {
    buildFilteredSheet(wb, { major, rows, visibleCols, confirmedTotals });
    // 사용자 다운로드는 디자인된 화면표시 시트를 처음 보이게 한다. 원본 회계 양식은
    // 두번째 시트에 그대로 남겨 기존 셀 구조가 필요한 후속 작업과의 호환성을 유지한다.
    if (displaySheetFirst) {
      wb.SheetNames = ['화면표시(선택컬럼)', ...wb.SheetNames.filter(name => name !== '화면표시(선택컬럼)')];
      if (wb.Workbook?.Sheets) {
        const sheetMeta = new Map(wb.Workbook.Sheets.map(meta => [meta.name, meta]));
        wb.Workbook.Sheets = wb.SheetNames.map(name => sheetMeta.get(name) || { name, Hidden: 0 });
      }
    }
  }

  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx', cellStyles: true });
}
