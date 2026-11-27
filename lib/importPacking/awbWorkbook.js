// Air Waybill (AWB) standalone packing-list sheet & workbook builder
import {
  ALIGN_CENTER,
  ALIGN_LEFT,
  FONT_TABLE,
  FONT_TABLE_BOLD,
  NF_INT,
  NF_PRICE2,
  NF_TEXT,
  NF_THOUSANDS,
  bordersAll,
  buildMerges19_2,
  setCell,
  setFormula,
  writeTableHeaders19_2,
  writeTopHeader19_2,
} from './excelSheetBuilder.js';

const AWB_DEFAULT_COMPANIES = ['EXCEL', 'Freightwise Ecuador', 'FREIGHTWISE', 'Apollo'];

// --- AWB packing-list writer --------------------------------------------------
// Uses the 19-2 packing-list helpers (writeTopHeader19_2 +
// writeTableHeaders19_2 + buildMerges19_2) so the file looks like the
// hand-made packing lists Nenova uses (e.g. 19-1_콜수국_AWB.xlsx) but
// trimmed to a sensible length: only 4 fixed rows + 10 spares + TOTAL.
//
// Layout:
//   * dim A1:L20
//   * sheet name 'CO-장미 (2)'
//   * column widths and row heights match the reference template
//   * header table column 'BCH/ST'
//   * Row 6: 운송료 #1  — F=1, G=1, H=1, I=CW (TOTAL BUNCH = chargeable wt),
//                          J=1 (TOTAL STEAM), K=uPrice1, L = K*I
//   * Row 7: 운송료 #2  — F=1, G=1, H=1, J=1, K blank, L=uPrice2 (hardcoded)
//   * Row 8: Gross weight — J=GW
//   * Row 9: Chargeable weight — J=CW
//   * Rows 10..19: empty data rows with J=F*H and L=K*J formulas
//   * Row 20: TOTAL with A:D merged, J=SUM(J6:J19), L=SUM(L6:L19)
function buildAWBSheet(XLSX, opts) {
  // opts: { company, weekend, invoice, awb, date, gw, cw, uPrice1, uPrice2 }
  const ws = {};

  // 1) Top header (rows 1–3) and table headers (row 5) — same as the 19-2 template
  writeTopHeader19_2(ws, opts.company, opts.weekend, opts.invoice, opts.awb, opts.date);
  writeTableHeaders19_2(ws, 'BCH/ST');

  // 2) Column widths and row heights — 19-2 template values exactly
  //    matching the reference file 19-1_콜수국_AWB.xlsx.
  ws['!cols'] = [
    { wch: 3.63 },  { wch: 7.0 },   { wch: 13.5 },  { wch: 13.5 },
    { wch: 5.37 },  { wch: 4.25 },  { wch: 4.0 },   { wch: 5.88 },
    { wch: 6.12 },  { wch: 13.0 },  { wch: 12.08 }, { wch: 13.07 },
  ];
  ws['!rows'] = [
    { hpt: 34.5 }, { hpt: 16.5 }, { hpt: 17.25 }, { hpt: 7.5 }, { hpt: 26.25 },
  ];

  // 3) Data cell styles — thin borders, Calibri 8pt
  const sBase  = { font: FONT_TABLE, alignment: ALIGN_CENTER, border: bordersAll('thin') };
  const sLeft  = { ...sBase, alignment: ALIGN_LEFT };
  const sInt   = { ...sBase, numFmt: NF_INT };
  const sStems = { ...sBase, numFmt: NF_THOUSANDS };
  const sPrice = { ...sBase, numFmt: NF_PRICE2 };

  // 4) Row 6 — 운송료 #1:  L6 = K6 * I6  (TOTAL BUNCH holds the chargeable weight)
  setCell   (ws, 'A6', '1',           { ...sBase, font: FONT_TABLE_BOLD, numFmt: NF_TEXT });
  setCell   (ws, 'B6', '운송료',      sLeft);
  setCell   (ws, 'E6', '',            sBase);
  setCell   (ws, 'F6', 1,             sInt);
  setCell   (ws, 'G6', 1,             sInt);
  setCell   (ws, 'H6', 1,             sInt);
  setCell   (ws, 'I6', opts.cw,       sStems);       // <-- CW goes into TOTAL BUNCH
  setCell   (ws, 'J6', 1,             sStems);
  setCell   (ws, 'K6', opts.uPrice1,  sPrice);
  setFormula(ws, 'L6', 'K6*I6',       sPrice);       // <-- formula uses I, not J
  ws.L6.v = (Number(opts.uPrice1) || 0) * (Number(opts.cw) || 0);

  // 5) Row 7 — 운송료 #2:  L7 = uPrice2 (hardcoded so the grand total matches)
  setCell   (ws, 'A7', '2',           { ...sBase, numFmt: NF_TEXT });
  setCell   (ws, 'B7', '운송료',      sLeft);
  setCell   (ws, 'E7', '',            sBase);
  setCell   (ws, 'F7', 1,             sInt);
  setCell   (ws, 'G7', 1,             sInt);
  setCell   (ws, 'H7', 1,             sInt);
  setCell   (ws, 'I7', '',            sStems);
  setCell   (ws, 'J7', 1,             sStems);
  setCell   (ws, 'K7', '',            sPrice);       // <-- K blank
  setCell   (ws, 'L7', opts.uPrice2,  sPrice);       // <-- hardcoded value

  // 6) Row 8 — Gross weight:  only J holds the GW value
  setCell   (ws, 'A8', '3',           { ...sBase, numFmt: NF_TEXT });
  setCell   (ws, 'B8', 'Gross weight', sLeft);
  setCell   (ws, 'E8', '',            sBase);
  setCell   (ws, 'F8', '',            sInt);
  setCell   (ws, 'G8', '',            sInt);
  setCell   (ws, 'H8', '',            sInt);
  setCell   (ws, 'I8', '',            sStems);
  setCell   (ws, 'J8', opts.gw,       sStems);
  setCell   (ws, 'K8', '',            sPrice);
  setFormula(ws, 'L8', 'IFERROR(K8*J8,0)', sPrice);
  ws.L8.v = 0;

  // 7) Row 9 — Chargeable weight:  only J holds the CW value
  setCell   (ws, 'A9', '4',           { ...sBase, numFmt: NF_TEXT });
  setCell   (ws, 'B9', 'Chargeable weight', sLeft);
  setCell   (ws, 'E9', '',            sBase);
  setCell   (ws, 'F9', '',            sInt);
  setCell   (ws, 'G9', '',            sInt);
  setCell   (ws, 'H9', '',            sInt);
  setCell   (ws, 'I9', '',            sStems);
  setCell   (ws, 'J9', opts.cw,       sStems);
  setCell   (ws, 'K9', '',            sPrice);
  setFormula(ws, 'L9', 'IFERROR(K9*J9,0)', sPrice);
  ws.L9.v = 0;

  // 8) Rows 10..19 — 10 extra empty data rows with the formula skeleton, in
  //    case the user wants to add something later.  We wrap the formulas in
  //    IFERROR so empty K/F/H cells don't produce #VALUE! errors — they just
  //    evaluate to 0, which the NF_INT format renders as "-".
  const lastDataRow = 19;
  for (let r = 10; r <= lastDataRow; r++) {
    setCell   (ws, `A${r}`, '',  sBase);
    setCell   (ws, `B${r}`, '',  sLeft);
    setCell   (ws, `E${r}`, '',  sBase);
    setCell   (ws, `F${r}`, '',  sInt);
    setCell   (ws, `G${r}`, '',  sInt);
    setCell   (ws, `H${r}`, '',  sInt);
    setCell   (ws, `I${r}`, '',  sStems);
    setFormula(ws, `J${r}`, `IFERROR(F${r}*H${r},0)`, sStems);
    setCell   (ws, `K${r}`, '',  sPrice);
    setFormula(ws, `L${r}`, `IFERROR(K${r}*J${r},0)`, sPrice);
  }

  // 9) TOTAL row (row 20) — A:D merged
  const totalRow = 20;
  const sTotalLabel = { font: FONT_TABLE_BOLD, alignment: ALIGN_CENTER, border: bordersAll('thin') };
  const sTotalStems = { font: FONT_TABLE_BOLD, alignment: ALIGN_CENTER, border: bordersAll('thin'), numFmt: NF_THOUSANDS };
  const sTotalPrice = { font: FONT_TABLE_BOLD, alignment: ALIGN_CENTER, border: bordersAll('thin'), numFmt: NF_PRICE2 };
  setCell   (ws, `A${totalRow}`, 'TOTAL', sTotalLabel);
  setCell   (ws, `E${totalRow}`, '',      sTotalLabel);
  setCell   (ws, `F${totalRow}`, '',      sTotalLabel);
  setCell   (ws, `G${totalRow}`, '',      sTotalLabel);
  setCell   (ws, `H${totalRow}`, '',      sTotalLabel);
  setFormula(ws, `I${totalRow}`, `SUM(I6:I${lastDataRow})`, sTotalStems);
  setFormula(ws, `J${totalRow}`, `SUM(J6:J${lastDataRow})`, sTotalStems);
  setCell   (ws, `K${totalRow}`, '',      sTotalPrice);
  setFormula(ws, `L${totalRow}`, `SUM(L6:L${lastDataRow})`, sTotalPrice);

  // 10) Merges — 19-2 template shape, with B:D merged on every row 5..150
  ws['!merges'] = buildMerges19_2(lastDataRow, totalRow);
  ws['!ref'] = `A1:L${totalRow}`;
  return ws;
}

// Write an AWB workbook to a Blob URL (one sheet — name matches reference).
function writeAWBWorkbook(XLSX, opts) {
  const ws = buildAWBSheet(XLSX, opts);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'CO-장미 (2)');
  // Force Excel/LibreOffice to recalculate all formulas the moment the file
  // is opened.  Without this, cells like L151 (=SUM(L6:L150)) appear empty
  // because xlsx-js-style doesn't compute formula values when writing —
  // it relies on the spreadsheet app to evaluate them on open.
  wb.Workbook = wb.Workbook || {};
  wb.Workbook.CalcPr = {
    calcId: 999999,
    fullCalcOnLoad: true,
    calcCompleted: false,
    calcOnSave: true,
  };
  const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  return new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

export {
  AWB_DEFAULT_COMPANIES,
  buildAWBSheet,
  writeAWBWorkbook,
};
