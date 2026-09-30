// lib/profitWorkbookExcel.js — 매출원가 양식 전체 워크북 다운로드. data/profit-workbook-template.xlsx(원본 양식에서
// 원천시트 데이터 영역만 비운 것)을 읽어 판매현황·불량차감·그 외 매출액·구매현황의 데이터 영역만 채운다.
// 수식 열·서식·시트 순서·수기 시트(재고잔량·그외통관비·포워딩·콜롬비아·품목리스트)는 그대로 둔다(lib/profitReportExcel.js 방식의
// "템플릿 + 값만 채움"). 전체 워크북(수식 수천 개·품목리스트 3천행)은 xlsx-js-style 왕복 시 9.7MB로 부풀어 ExcelJS를 쓴다(356KB).
import ExcelJS from 'exceljs';
import path from 'path';
import { effectiveData } from './profitWorkbookRules.js';

export const TEMPLATE_PATH = path.join(process.cwd(), 'data', 'profit-workbook-template.xlsx');
export const MAIN_SHEET = '주차별 매출이익 보고서';

// 시트별 데이터 영역(엑셀 원본 열 구성 그대로). formulaCol은 템플릿 첫 데이터행 수식을 행마다 복제한다.
export const SOURCE_SHEET_LAYOUT = {
  sales: { name: '판매현황', firstRow: 4, dataCols: ['A', 'B', 'C', 'D', 'E', 'F', 'G'], formulaCol: 'I' },
  defect: { name: '불량차감', firstRow: 3, dataCols: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I'], formulaCol: 'J' },
  other: { name: '그 외 매출액', firstRow: 3, dataCols: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I'], formulaCol: 'J' },
  purchase: { name: '구매현황', firstRow: 3, dataCols: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M'], formulaCol: 'N' },
};

const n = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
function valuesFor(sheet, d, i) {
  if (sheet === 'sales') return [d.custName, d.prodName, n(d.qty), n(d.unitPrice), n(d.supply), n(d.vat), n(d.total)];
  if (sheet === 'defect' || sheet === 'other') {
    return [`${d.date || ''} -${i + 1}`, d.custName, d.typeName, n(d.qty), n(d.unitCost), n(d.supply), n(d.vat), n(d.total), d.prodName];
  }
  // 구매현황: H 공급가액·I 환율·J 합계·M 결제일은 수기(환율 미확정) — 빈칸
  return [`${d.date || ''} -${i + 1}`, d.farmName, d.prodName, n(d.qty), n(d.boxQty) || null, n(d.unitPrice) || null, n(d.usd), null, null, null, d.week, d.invoiceNo, null];
}

/** 템플릿 수식의 상대참조 행번호(templateRow)를 targetRow로 옮긴다. $고정 참조·다른 행번호는 그대로. */
export function shiftFormulaRow(formula, templateRow, targetRow) {
  return String(formula).replace(/(^|[^$A-Za-z0-9_])([A-Z]{1,3})(\d+)(?![\d(])/g, (m, pre, col, row) => (
    Number(row) === templateRow ? `${pre}${col}${targetRow}` : m));
}

const plainFormula = (cell) => {
  const v = cell?.value;
  if (v && typeof v === 'object' && (v.formula || v.sharedFormula)) return cell.formula || v.formula || null;
  return null;
};

export async function loadTemplate(templateBuffer) {
  const wb = new ExcelJS.Workbook();
  if (templateBuffer) await wb.xlsx.load(templateBuffer); else await wb.xlsx.readFile(TEMPLATE_PATH);
  return wb;
}

/** 원천시트 데이터 영역(값 열 + 수식 열)을 비운다 — 템플릿 생성과 채우기 전 정리에 공용. */
export function clearSourceArea(ws, layout, { keepFirstFormula = true } = {}) {
  const last = Math.max(ws.rowCount, layout.firstRow);
  const tplFormula = plainFormula(ws.getCell(`${layout.formulaCol}${layout.firstRow}`));
  for (let r = layout.firstRow; r <= last; r += 1) {
    for (const c of layout.dataCols) ws.getCell(`${c}${r}`).value = null;
    const f = ws.getCell(`${layout.formulaCol}${r}`);
    f.value = null;
  }
  if (keepFirstFormula && tplFormula) ws.getCell(`${layout.formulaCol}${layout.firstRow}`).value = { formula: tplFormula };
  return tplFormula;
}

export async function buildProfitWorkbookXlsx({ major, rows, templateBuffer }) {
  const wb = await loadTemplate(templateBuffer);
  const main = wb.getWorksheet(MAIN_SHEET);
  if (main) main.getCell('B1').value = `${MAIN_SHEET}-${Number(major)}차`;
  for (const [sheet, layout] of Object.entries(SOURCE_SHEET_LAYOUT)) {
    const ws = wb.getWorksheet(layout.name);
    if (!ws) throw new Error(`템플릿에 시트 없음: ${layout.name}`);
    const tplFormula = clearSourceArea(ws, layout, { keepFirstFormula: false });
    const styles = [...layout.dataCols, layout.formulaCol].map((c) => ws.getCell(`${c}${layout.firstRow}`).style);
    const data = rows.filter((r) => r.sheet === sheet).map(effectiveData);
    data.forEach((d, i) => {
      const r = layout.firstRow + i;
      valuesFor(sheet, d, i).forEach((v, ci) => {
        const cell = ws.getCell(`${layout.dataCols[ci]}${r}`);
        if (r > layout.firstRow && styles[ci]) cell.style = styles[ci];
        cell.value = v == null || v === '' ? null : v;
      });
      if (tplFormula) {
        const cell = ws.getCell(`${layout.formulaCol}${r}`);
        if (r > layout.firstRow && styles.at(-1)) cell.style = styles.at(-1);
        cell.value = { formula: shiftFormulaRow(tplFormula, layout.firstRow, r) };
      }
    });
  }
  // 열 때 전체 재계산(원천시트를 참조하는 본표 SUMIF·분류식 캐시값이 템플릿 값으로 남지 않도록)
  wb.calcProperties = { ...(wb.calcProperties || {}), fullCalcOnLoad: true };
  return Buffer.from(await wb.xlsx.writeBuffer());
}
