// 매출이익 보고서 엑셀 생성 — 원본 "매출원가 양식.xlsx" 첫 시트를 템플릿으로 사용해
// 셀 구성·병합·열너비·행높이·서식을 100% 유지하고 값만 채운다 (서버 전용, xlsx-js-style).
import XLSX from 'xlsx-js-style';
import fs from 'fs';
import path from 'path';
import { CATEGORIES, EXTRA_CATEGORY } from './profitReport';
import { computeProfitRow, computeProfitTotals } from './profitReportCalc';

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
function buildFilteredSheet(wb, { rows, visibleCols }) {
  const cols = visibleCols.filter(k => COL_LABEL[k]);
  if (!cols.length) return;

  const bodyRows = CATEGORIES.map(def => {
    const r = rows.find(x => x.category === def.key)
      || { category: def.key, variant: def.variant || 'normal', auto: { N: 0, L: 0, O: 0, Q: 0, S: 0 }, manual: {} };
    return { ...r, calc: computeProfitRow(r) };
  });
  const totals = computeProfitTotals(bodyRows);

  const aoa = [['품명', ...cols.map(k => COL_LABEL[k])]];
  bodyRows.forEach(row => {
    const c = row.calc;
    const D = totals.C !== 0 ? c.C / totals.C : null;
    const U = totals.P !== 0 ? c.P / totals.P : null;
    const valFor = { ...c, D, U };
    aoa.push([row.category, ...cols.map(k => (valFor[k] == null ? null : valFor[k]))]);
  });
  const totVals = {
    C: totals.C, D: 1, E: totals.E, F: totals.F, G: totals.G, H: totals.H, I: totals.I,
    J: totals.J, K: totals.K, L: totals.L, M: totals.M, N: totals.N, O: totals.O,
    P: totals.P, Q: totals.Q || null, R: null, S: totals.S || null, T: totals.T, U: 1,
  };
  aoa.push(['합계', ...cols.map(k => (totVals[k] == null ? null : totVals[k]))]);

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  cols.forEach((k, ci) => {
    const colLetter = XLSX.utils.encode_col(ci + 1); // +1: 0번 컬럼은 품명
    for (let r = 1; r < aoa.length; r++) {
      const addr = `${colLetter}${r + 1}`;
      if (ws[addr] && ws[addr].t === 'n' && COLFMT[k]) ws[addr].z = COLFMT[k];
    }
  });
  ws['!cols'] = [{ wch: 16 }, ...cols.map(() => ({ wch: 14 }))];
  XLSX.utils.book_append_sheet(wb, ws, '화면표시(선택컬럼)');
}

export function buildProfitReportXlsx({ major, rows, note, audit, visibleCols }) {
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

  // 본문 16행 (템플릿 8~23행 = CATEGORIES 순서와 동일) — 기타(미분류)는 템플릿에 행이 없어 합계 제외+비고 경고
  const bodyRows = CATEGORIES.map(def => {
    const r = rows.find(x => x.category === def.key)
      || { category: def.key, variant: def.variant || 'normal', auto: { N: 0, L: 0, O: 0, Q: 0, S: 0 }, manual: {} };
    return { ...r, calc: computeProfitRow(r) };
  });
  const totals = computeProfitTotals(bodyRows);
  const extra = rows.find(x => x.category === EXTRA_CATEGORY);
  const extraCalc = extra ? computeProfitRow(extra) : null;

  bodyRows.forEach((row, i) => {
    const xr = 8 + i;
    const c = row.calc;
    const D = totals.C !== 0 ? c.C / totals.C : null;
    const U = totals.P !== 0 ? c.P / totals.P : null;
    const vals = {
      C: c.C, D, E: c.E, F: c.F, G: c.G, H: c.H, I: c.I, J: c.J, K: c.K,
      L: c.L, M: c.M, N: c.N, O: c.O, P: c.P, Q: c.Q || null, R: c.R, S: c.S, T: c.T, U,
    };
    for (const [col, v] of Object.entries(vals)) setCell(sheet, `${col}${xr}`, v, COLFMT[col]);
  });

  // 합계행(24) — 원본과 동일하게 ₩ 서식
  const totVals = {
    C: totals.C, D: 1, E: totals.E, F: totals.F, G: totals.G, H: totals.H, I: totals.I,
    J: totals.J, K: totals.K, L: totals.L, M: totals.M, N: totals.N, O: totals.O,
    P: totals.P, Q: totals.Q || null, R: null, S: totals.S || null, T: totals.T, U: 1,
  };
  for (const [col, v] of Object.entries(totVals)) {
    setCell(sheet, `${col}24`, v, WON_COLS.includes(col) ? FMT.moneyWon : COLFMT[col]);
  }

  // 비고 (B28 병합영역) — 기타(미분류) 경고 자동 첨부
  let noteText = String(note || '');
  if (extraCalc && Math.abs(extraCalc.C) > 0.5) {
    noteText += `${noteText ? '\n' : ''}※ 기타(미분류) 매출 ${Math.round(extraCalc.C).toLocaleString()}원 — 품목 분류 확인 필요 (본 표 합계 미포함)`;
  }
  if (audit?.issues?.length) {
    const auditLines = audit.issues.slice(0, 8).map((issue) =>
      `- ${issue.category} [${(issue.columns || []).join('/')}] ${issue.message}`);
    noteText += `${noteText ? '\n' : ''}※ 자동검증: 오류 ${audit.errorCount || 0}건 · 확인 ${audit.warningCount || 0}건\n${auditLines.join('\n')}`;
    if (audit.issues.length > auditLines.length) noteText += `\n- 외 ${audit.issues.length - auditLines.length}건은 웹 보고서에서 확인`;
  }
  setCell(sheet, 'B28', noteText || null);

  if (Array.isArray(visibleCols) && visibleCols.length) buildFilteredSheet(wb, { rows, visibleCols });

  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx', cellStyles: true });
}
