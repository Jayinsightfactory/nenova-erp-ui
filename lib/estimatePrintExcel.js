// 견적서/거래명세표 — 인쇄 양식과 동일한 Excel (xlsx-js-style)

import XLSX from 'xlsx-js-style';
import {
  formatPrintProductName,
  getEstimateOriginCountry,
  getEstimateSpecLabel,
  getPrintFormatDocTitle,
  isStatementPrintFormat,
} from './estimatePrintFormats';
import { buildPrintExcelHeaderAoa } from './estimatePrintHeader';
import {
  estimateTypeLabel,
  prepareEstimatePrintRows,
} from './estimatePrintPrepare';

const BORDER = {
  top: { style: 'thin', color: { rgb: 'BBBBBB' } },
  bottom: { style: 'thin', color: { rgb: 'BBBBBB' } },
  left: { style: 'thin', color: { rgb: 'BBBBBB' } },
  right: { style: 'thin', color: { rgb: 'BBBBBB' } },
};

const STYLES = {
  title: {
    font: { bold: true, name: '맑은 고딕', sz: 16, underline: true },
    alignment: { horizontal: 'center', vertical: 'center' },
  },
  metaLabel: {
    font: { bold: true, name: '맑은 고딕', sz: 9 },
    alignment: { horizontal: 'left', vertical: 'center' },
    fill: { fgColor: { rgb: 'F8F8F8' } },
    border: BORDER,
  },
  meta: {
    font: { name: '맑은 고딕', sz: 9 },
    alignment: { horizontal: 'left', vertical: 'center', wrapText: true },
    border: BORDER,
  },
  greet: {
    font: { name: '맑은 고딕', sz: 9 },
    alignment: { horizontal: 'left', vertical: 'center' },
  },
  amountBar: {
    font: { bold: true, name: '맑은 고딕', sz: 9 },
    alignment: { horizontal: 'left', vertical: 'center' },
    fill: { fgColor: { rgb: 'F5F5F5' } },
    border: BORDER,
  },
  header: {
    font: { bold: true, name: '맑은 고딕', sz: 9 },
    fill: { fgColor: { rgb: 'E8E8E8' } },
    alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
    border: BORDER,
  },
  text: {
    font: { name: '맑은 고딕', sz: 9 },
    alignment: { horizontal: 'left', vertical: 'center', wrapText: true },
    border: BORDER,
  },
  textCenter: {
    font: { name: '맑은 고딕', sz: 9 },
    alignment: { horizontal: 'center', vertical: 'center' },
    border: BORDER,
  },
  number: {
    font: { name: '맑은 고딕', sz: 9 },
    alignment: { horizontal: 'right', vertical: 'center' },
    border: BORDER,
    numFmt: '#,##0',
  },
  foot: {
    font: { bold: true, name: '맑은 고딕', sz: 9 },
    fill: { fgColor: { rgb: 'F5F5F5' } },
    alignment: { horizontal: 'right', vertical: 'center' },
    border: BORDER,
    numFmt: '#,##0',
  },
  footTotal: {
    font: { bold: true, name: '맑은 고딕', sz: 10 },
    fill: { fgColor: { rgb: 'DCE8F5' } },
    alignment: { horizontal: 'right', vertical: 'center' },
    border: BORDER,
    numFmt: '#,##0',
  },
};

function addr(row, col) {
  return XLSX.utils.encode_cell({ r: row, c: col });
}

function setCell(ws, row, col, value, style) {
  const ref = addr(row, col);
  const isNum = typeof value === 'number' && Number.isFinite(value);
  ws[ref] = { t: isNum ? 'n' : 's', v: isNum ? value : String(value ?? ''), s: style };
}

function styleInfoBlock(ws, startRow, endRow, colCount) {
  const split = Math.max(4, Math.floor(colCount / 2));
  for (let r = startRow; r <= endRow; r += 1) {
    setCell(ws, r, 0, ws[addr(r, 0)]?.v ?? '', STYLES.metaLabel);
    setCell(ws, r, 1, ws[addr(r, 1)]?.v ?? '', STYLES.meta);
    if (split < colCount) {
      setCell(ws, r, split, ws[addr(r, split)]?.v ?? '', STYLES.metaLabel);
      setCell(ws, r, split + 1, ws[addr(r, split + 1)]?.v ?? '', STYLES.meta);
    }
  }
}

/**
 * 인쇄 HTML 과 동일 데이터·열 구조의 스타일 시트 1장 생성
 */
export function buildEstimatePrintWorksheet({
  custName,
  week,
  printDate,
  serialNo,
  printFormat,
  rows,
  showBoxQty = true,
  showDistribDesc = false,
  showDeductionOutDay = false,
  bigoLabel = '',
}) {
  const prepared = prepareEstimatePrintRows(rows, { printFormat, showDistribDesc, showDeductionOutDay });
  const { rows: printRows, totals, statementFormat, descLabel } = prepared;
  const title = getPrintFormatDocTitle(printFormat);
  const colCount = statementFormat ? 10 : (showBoxQty ? 9 : 8);

  const {
    aoa: headerAoa,
    merges: headerMerges,
    dataStartOffset,
  } = buildPrintExcelHeaderAoa({
    title,
    custName,
    serialNo: serialNo || (week ? `${week}차` : ''),
    printDate,
    bigoLabel,
    totalAmt: totals.total,
    statementFormat,
    colCount,
  });

  const aoa = [...headerAoa];
  const merges = [...headerMerges];

  const headerRow = aoa.length;
  if (statementFormat) {
    aoa.push(['번호', '품목', '원산지', '단위', '규격', '수량', '단가', '금액', '세액', '비고']);
  } else {
    const headers = ['순번', '품목명[규격]', '수량', '단위'];
    if (showBoxQty) headers.push('박스');
    headers.push('단가', '공급가액', '부가세', '적요');
    aoa.push(headers);
  }

  const dataStart = aoa.length;
  printRows.forEach((r, i) => {
    const prodLabel = `${estimateTypeLabel(r.EstimateType)}${formatPrintProductName(r, printFormat)}`;
    if (statementFormat) {
      aoa.push([
        i + 1,
        prodLabel,
        getEstimateOriginCountry(r),
        r.Unit || '',
        getEstimateSpecLabel(r),
        Number(r.Quantity) || 0,
        Number(r.Cost) || 0,
        Number(r.Amount) || 0,
        Number(r.Vat) || 0,
        descLabel(r),
      ]);
      return;
    }
    const line = [i + 1, prodLabel, Number(r.Quantity) || 0, r.Unit || ''];
    if (showBoxQty) line.push(Number(r.BoxQty) || 0);
    line.push(Number(r.Cost) || 0, Number(r.Amount) || 0, Number(r.Vat) || 0, descLabel(r));
    aoa.push(line);
  });

  const footRow = aoa.length;
  if (statementFormat) {
    aoa.push(['', '', '', '', '', '', '합계', totals.supply, totals.vat, totals.total]);
  } else {
    const foot = ['', '공급가액 합계', '', ''];
    if (showBoxQty) foot.push('');
    foot.push('', totals.supply, totals.vat, totals.total);
    aoa.push(foot);
  }

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!merges'] = merges;
  ws['!cols'] = statementFormat
    ? [{ wch: 5 }, { wch: 28 }, { wch: 10 }, { wch: 6 }, { wch: 8 }, { wch: 8 }, { wch: 10 }, { wch: 12 }, { wch: 10 }, { wch: 16 }]
    : [{ wch: 5 }, { wch: 32 }, { wch: 8 }, { wch: 6 }, ...(showBoxQty ? [{ wch: 8 }] : []), { wch: 10 }, { wch: 12 }, { wch: 10 }, { wch: 16 }];
  ws['!freeze'] = { xSplit: 0, ySplit: dataStart };

  setCell(ws, 0, 0, title, STYLES.title);
  styleInfoBlock(ws, 2, 8, colCount);
  const greet1Row = 9;
  const greet2Row = 10;
  const amountRow = 11;
  applyGreetStyle(ws, greet1Row, colCount);
  applyGreetStyle(ws, greet2Row, colCount);
  applyRowStyle(ws, amountRow, colCount, STYLES.amountBar);

  for (let c = 0; c < colCount; c += 1) {
    setCell(ws, headerRow, c, aoa[headerRow][c], STYLES.header);
  }

  printRows.forEach((r, idx) => {
    const row = dataStart + idx;
    const prodLabel = `${estimateTypeLabel(r.EstimateType)}${formatPrintProductName(r, printFormat)}`;
    if (statementFormat) {
      setCell(ws, row, 0, idx + 1, STYLES.textCenter);
      setCell(ws, row, 1, prodLabel, STYLES.text);
      setCell(ws, row, 2, getEstimateOriginCountry(r), STYLES.textCenter);
      setCell(ws, row, 3, r.Unit || '', STYLES.textCenter);
      setCell(ws, row, 4, getEstimateSpecLabel(r), STYLES.textCenter);
      setCell(ws, row, 5, Number(r.Quantity) || 0, STYLES.number);
      setCell(ws, row, 6, Number(r.Cost) || 0, STYLES.number);
      setCell(ws, row, 7, Number(r.Amount) || 0, STYLES.number);
      setCell(ws, row, 8, Number(r.Vat) || 0, STYLES.number);
      setCell(ws, row, 9, descLabel(r), STYLES.text);
      return;
    }
    let col = 0;
    setCell(ws, row, col++, idx + 1, STYLES.textCenter);
    setCell(ws, row, col++, prodLabel, STYLES.text);
    setCell(ws, row, col++, Number(r.Quantity) || 0, STYLES.number);
    setCell(ws, row, col++, r.Unit || '', STYLES.textCenter);
    if (showBoxQty) setCell(ws, row, col++, Number(r.BoxQty) || 0, STYLES.number);
    setCell(ws, row, col++, Number(r.Cost) || 0, STYLES.number);
    setCell(ws, row, col++, Number(r.Amount) || 0, STYLES.number);
    setCell(ws, row, col++, Number(r.Vat) || 0, STYLES.number);
    setCell(ws, row, col++, descLabel(r), STYLES.text);
  });

  if (statementFormat) {
    for (let c = 0; c < 6; c += 1) setCell(ws, footRow, c, aoa[footRow][c], STYLES.foot);
    setCell(ws, footRow, 6, '합계', STYLES.foot);
    setCell(ws, footRow, 7, totals.supply, STYLES.foot);
    setCell(ws, footRow, 8, totals.vat, STYLES.foot);
    setCell(ws, footRow, 9, totals.total, STYLES.footTotal);
  } else {
    const supplyCol = showBoxQty ? 6 : 5;
    setCell(ws, footRow, 1, '공급가액 합계', STYLES.foot);
    setCell(ws, footRow, supplyCol, totals.supply, STYLES.foot);
    setCell(ws, footRow, supplyCol + 1, totals.vat, STYLES.foot);
    setCell(ws, footRow, supplyCol + 2, totals.total, STYLES.footTotal);
  }

  return ws;
}

function applyGreetStyle(ws, row, colCount) {
  for (let c = 0; c < colCount; c += 1) {
    const ref = addr(row, c);
    if (!ws[ref]) ws[ref] = { t: 's', v: '' };
    ws[ref].s = STYLES.greet;
  }
}

function applyRowStyle(ws, row, colCount, style) {
  for (let c = 0; c < colCount; c += 1) {
    const ref = addr(row, c);
    if (!ws[ref]) ws[ref] = { t: 's', v: '' };
    ws[ref].s = style;
  }
}

export function buildEstimatePrintWorkbook(sheets) {
  const wb = XLSX.utils.book_new();
  (sheets || []).forEach(({ name, worksheet }) => {
    if (worksheet) XLSX.utils.book_append_sheet(wb, worksheet, name);
  });
  return wb;
}

export function downloadEstimatePrintWorkbook(wb, fileName) {
  const safe = String(fileName || '견적서.xlsx').replace(/[\\/?*[\]:]/g, '_');
  XLSX.writeFile(wb, safe.endsWith('.xlsx') ? safe : `${safe}.xlsx`);
}
