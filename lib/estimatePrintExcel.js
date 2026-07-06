// 견적서/거래명세표 — 인쇄 양식과 동일한 Excel (xlsx-js-style)

import XLSX from "xlsx-js-style";
import {
  getEstimateOriginCountry,
  getEstimateSpecLabel,
  getPrintFormatDocTitle,
  getStatementProductName,
  isStatementPrintFormat,
} from "./estimatePrintFormats";
import {
  estimateTypeLabel,
  prepareEstimatePrintRows,
} from "./estimatePrintPrepare";

const BORDER = {
  top: { style: "thin", color: { rgb: "BBBBBB" } },
  bottom: { style: "thin", color: { rgb: "BBBBBB" } },
  left: { style: "thin", color: { rgb: "BBBBBB" } },
  right: { style: "thin", color: { rgb: "BBBBBB" } },
};

const STYLES = {
  title: {
    font: { bold: true, name: "맑은 고딕", sz: 16, underline: true },
    alignment: { horizontal: "center", vertical: "center" },
  },
  meta: {
    font: { name: "맑은 고딕", sz: 9 },
    alignment: { horizontal: "left", vertical: "center" },
  },
  amountBar: {
    font: { bold: true, name: "맑은 고딕", sz: 9 },
    alignment: { horizontal: "left", vertical: "center" },
    fill: { fgColor: { rgb: "F5F5F5" } },
    border: BORDER,
  },
  header: {
    font: { bold: true, name: "맑은 고딕", sz: 9 },
    fill: { fgColor: { rgb: "E8E8E8" } },
    alignment: { horizontal: "center", vertical: "center", wrapText: true },
    border: BORDER,
  },
  text: {
    font: { name: "맑은 고딕", sz: 9 },
    alignment: { horizontal: "left", vertical: "center", wrapText: true },
    border: BORDER,
  },
  textCenter: {
    font: { name: "맑은 고딕", sz: 9 },
    alignment: { horizontal: "center", vertical: "center" },
    border: BORDER,
  },
  number: {
    font: { name: "맑은 고딕", sz: 9 },
    alignment: { horizontal: "right", vertical: "center" },
    border: BORDER,
    numFmt: "#,##0",
  },
  foot: {
    font: { bold: true, name: "맑은 고딕", sz: 9 },
    fill: { fgColor: { rgb: "F5F5F5" } },
    alignment: { horizontal: "right", vertical: "center" },
    border: BORDER,
    numFmt: "#,##0",
  },
  footTotal: {
    font: { bold: true, name: "맑은 고딕", sz: 10 },
    fill: { fgColor: { rgb: "DCE8F5" } },
    alignment: { horizontal: "right", vertical: "center" },
    border: BORDER,
    numFmt: "#,##0",
  },
};

function addr(row, col) {
  return XLSX.utils.encode_cell({ r: row, c: col });
}

function setCell(ws, row, col, value, style) {
  const ref = addr(row, col);
  const isNum = typeof value === "number" && Number.isFinite(value);
  ws[ref] = {
    t: isNum ? "n" : "s",
    v: isNum ? value : String(value ?? ""),
    s: style,
  };
}

function applyRowStyle(ws, row, colCount, style) {
  for (let c = 0; c < colCount; c += 1) {
    const ref = addr(row, c);
    if (!ws[ref]) ws[ref] = { t: "s", v: "" };
    ws[ref].s = style;
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
  bigoLabel = "",
}) {
  const prepared = prepareEstimatePrintRows(rows, {
    printFormat,
    showDistribDesc,
  });
  const { rows: printRows, totals, statementFormat, descLabel } = prepared;
  const title = getPrintFormatDocTitle(printFormat);
  const colCount = statementFormat ? 10 : showBoxQty ? 9 : 8;

  const aoa = [];
  const merges = [];

  aoa.push([title]);
  merges.push({ s: { r: 0, c: 0 }, e: { r: 0, c: colCount - 1 } });

  aoa.push([
    `수신: ${custName || ""}`,
    `차수: ${week || ""}차`,
    `출력일자: ${printDate || ""}`,
    serialNo ? `일련번호: ${serialNo}` : "",
  ]);
  if (bigoLabel) aoa.push([`비고: ${bigoLabel}`]);
  aoa.push([
    `금액: ${Number(totals.total || 0).toLocaleString()}원 (공급가 ${Number(totals.supply || 0).toLocaleString()} + 세액 ${Number(totals.vat || 0).toLocaleString()}) / VAT 포함`,
  ]);
  aoa.push([]);

  const headerRow = aoa.length;
  if (statementFormat) {
    aoa.push([
      "번호",
      "품목",
      "원산지",
      "단위",
      "규격",
      "수량",
      "단가",
      "금액",
      "세액",
      "비고",
    ]);
  } else {
    const headers = ["순번", "품목명[규격]", "수량", "단위"];
    if (showBoxQty) headers.push("박스");
    headers.push("단가", "공급가액", "부가세", "적요");
    aoa.push(headers);
  }

  const dataStart = aoa.length;
  printRows.forEach((r, i) => {
    if (statementFormat) {
      aoa.push([
        i + 1,
        `${estimateTypeLabel(r.EstimateType)}${getStatementProductName(r)}`,
        getEstimateOriginCountry(r),
        r.Unit || "",
        getEstimateSpecLabel(r),
        Number(r.Quantity) || 0,
        Number(r.Cost) || 0,
        Number(r.Amount) || 0,
        Number(r.Vat) || 0,
        descLabel(r),
      ]);
      return;
    }
    const line = [
      i + 1,
      `${estimateTypeLabel(r.EstimateType)}${r.ProdName || ""}`,
      Number(r.Quantity) || 0,
      r.Unit || "",
    ];
    if (showBoxQty) line.push(Number(r.BoxQty) || 0);
    line.push(
      Number(r.Cost) || 0,
      Number(r.Amount) || 0,
      Number(r.Vat) || 0,
      descLabel(r),
    );
    aoa.push(line);
  });

  const footRow = aoa.length;
  if (statementFormat) {
    aoa.push([
      "",
      "",
      "",
      "",
      "",
      "",
      "합계",
      totals.supply,
      totals.vat,
      totals.total,
    ]);
  } else {
    const foot = ["", "공급가액 합계", "", ""];
    if (showBoxQty) foot.push("");
    foot.push("", totals.supply, totals.vat, totals.total);
    aoa.push(foot);
  }

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!merges"] = merges;
  ws["!cols"] = statementFormat
    ? [
        { wch: 5 },
        { wch: 28 },
        { wch: 10 },
        { wch: 6 },
        { wch: 8 },
        { wch: 8 },
        { wch: 10 },
        { wch: 12 },
        { wch: 10 },
        { wch: 16 },
      ]
    : [
        { wch: 5 },
        { wch: 32 },
        { wch: 8 },
        { wch: 6 },
        ...(showBoxQty ? [{ wch: 8 }] : []),
        { wch: 10 },
        { wch: 12 },
        { wch: 10 },
        { wch: 16 },
      ];
  ws["!freeze"] = { xSplit: 0, ySplit: dataStart };

  setCell(ws, 0, 0, title, STYLES.title);
  applyRowStyle(ws, 1, colCount, STYLES.meta);
  if (bigoLabel) applyRowStyle(ws, 2, colCount, STYLES.meta);
  const amountRow = bigoLabel ? 3 : 2;
  applyRowStyle(ws, amountRow, colCount, STYLES.amountBar);

  for (let c = 0; c < colCount; c += 1) {
    setCell(ws, headerRow, c, aoa[headerRow][c], STYLES.header);
  }

  printRows.forEach((r, idx) => {
    const row = dataStart + idx;
    if (statementFormat) {
      setCell(ws, row, 0, idx + 1, STYLES.textCenter);
      setCell(
        ws,
        row,
        1,
        `${estimateTypeLabel(r.EstimateType)}${getStatementProductName(r)}`,
        STYLES.text,
      );
      setCell(ws, row, 2, getEstimateOriginCountry(r), STYLES.textCenter);
      setCell(ws, row, 3, r.Unit || "", STYLES.textCenter);
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
    setCell(
      ws,
      row,
      col++,
      `${estimateTypeLabel(r.EstimateType)}${r.ProdName || ""}`,
      STYLES.text,
    );
    setCell(ws, row, col++, Number(r.Quantity) || 0, STYLES.number);
    setCell(ws, row, col++, r.Unit || "", STYLES.textCenter);
    if (showBoxQty)
      setCell(ws, row, col++, Number(r.BoxQty) || 0, STYLES.number);
    setCell(ws, row, col++, Number(r.Cost) || 0, STYLES.number);
    setCell(ws, row, col++, Number(r.Amount) || 0, STYLES.number);
    setCell(ws, row, col++, Number(r.Vat) || 0, STYLES.number);
    setCell(ws, row, col++, descLabel(r), STYLES.text);
  });

  if (statementFormat) {
    for (let c = 0; c < 6; c += 1)
      setCell(ws, footRow, c, aoa[footRow][c], STYLES.foot);
    setCell(ws, footRow, 6, "합계", STYLES.foot);
    setCell(ws, footRow, 7, totals.supply, STYLES.foot);
    setCell(ws, footRow, 8, totals.vat, STYLES.foot);
    setCell(ws, footRow, 9, totals.total, STYLES.footTotal);
  } else {
    const supplyCol = showBoxQty ? 6 : 5;
    setCell(ws, footRow, 1, "공급가액 합계", STYLES.foot);
    setCell(ws, footRow, supplyCol, totals.supply, STYLES.foot);
    setCell(ws, footRow, supplyCol + 1, totals.vat, STYLES.foot);
    setCell(ws, footRow, supplyCol + 2, totals.total, STYLES.footTotal);
  }

  return ws;
}

export function buildEstimatePrintWorkbook(sheets) {
  const wb = XLSX.utils.book_new();
  (sheets || []).forEach(({ name, worksheet }) => {
    if (worksheet) XLSX.utils.book_append_sheet(wb, worksheet, name);
  });
  return wb;
}

export function downloadEstimatePrintWorkbook(wb, fileName) {
  const safe = String(fileName || "견적서.xlsx").replace(/[\\/?*[\]:]/g, "_");
  XLSX.writeFile(wb, safe.endsWith(".xlsx") ? safe : `${safe}.xlsx`);
}
