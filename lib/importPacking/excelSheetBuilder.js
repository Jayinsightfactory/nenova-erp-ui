// Shared 19-2 Excel template styles, cell helpers, per-country row writers, and sheet builder
import { chinaSourceQuantities } from '../importChinaSourceQuantities.js';
import { stemsPerBunchCO } from './catalogAndMatching.js';

// =============================================================================
// EXCEL HELPERS
// =============================================================================
// CRITICAL: xlsx-js-style uses `numFmt` (NOT `number_format`).  Setting
// `number_format` is silently ignored — that's why earlier outputs lacked
// number formats even though the rest of the styles worked.

const FONT_HEADER_BOLD = { bold: true, sz: 8, name: 'Bookman Old Style' };
const FONT_HEADER = { sz: 8, name: 'Bookman Old Style' };
const FONT_TITLE = { bold: true, sz: 16, name: 'Bookman Old Style' };
const FONT_TABLE_BOLD = { bold: true, sz: 8, name: 'Calibri' };
const FONT_TABLE = { sz: 8, name: 'Calibri' };
const ALIGN_LEFT = { horizontal: 'left', vertical: 'center' };
const ALIGN_LEFT_TOP = { horizontal: 'left', vertical: 'top' };
const ALIGN_CENTER = { horizontal: 'center', vertical: 'center' };
const ALIGN_CENTER_WRAP = { horizontal: 'center', vertical: 'center', wrapText: true };
// Border style objects — used inline by NL/CN/EC/AU generators in their
// TOTAL-row styles.  (Antioquia/Bogotá use bord(top, bot, left, right) instead,
// which builds these on the fly.)
const BORDER_THIN = { style: 'thin', color: { rgb: '000000' } };
const BORDER_MEDIUM = { style: 'medium', color: { rgb: '000000' } };
const NF_TEXT = '@';
// Number formats — using Excel's built-in Number-category formats
// (NOT the Custom/Accounting variants from the original template).
//   '0'                          → Number, 0 decimals
//   '0.00'                       → Number, 2 decimals
//   '#,##0'                      → Number, with thousands separator
//   '#,##0.00'                   → Number, 2 decimals, separator
//   '#,##0;[Red]-#,##0'          → same with red negatives
// These all show as "Number" in Excel's Format Cells dialog.
const NF_PLAIN_INT = '0';
const NF_INT       = '#,##0;[Red]-#,##0';                // BOX, BCH/ST, STEAM BOX, TOTAL BUNCH
const NF_THOUSANDS = '#,##0';                            // TOTAL STEAM (no red negatives needed)
const NF_PRICE3    = '#,##0.000;[Red]-#,##0.000';        // U.PRICE (3 decimals — Bogotá)
const NF_PRICE2    = '#,##0.00;[Red]-#,##0.00';          // U.PRICE / T.PRICE (2 decimals — Antioquia)

// Build a partial-edges border. Pass `null`/`undefined`/empty string for
// edges that should not be drawn.  Each non-empty edge is set to its style.
function bord(top, bot, left, right) {
  const out = {};
  const mk = (s) => ({ style: s, color: { rgb: '000000' } });
  if (top)   out.top    = mk(top);
  if (bot)   out.bottom = mk(bot);
  if (left)  out.left   = mk(left);
  if (right) out.right  = mk(right);
  return out;
}
// Legacy helper, used by NL/CN/EC/AU still — keeps full borders.
function bordersAll(style) {
  return bord(style, style, style, style);
}

// Cell writers — note: xlsx-js-style uses `s` for the style object whose
// properties are font / alignment / border / fill / numFmt (camelCase).
function setCell(ws, addr, v, style) {
  ws[addr] = { v: v, t: typeof v === 'number' ? 'n' : 's', s: style };
}
function setFormula(ws, addr, f, style) {
  ws[addr] = { f: f, t: 'n', s: style };
}
// Empty cell that still carries styling (used for the "blank" cells inside
// merged ranges and the empty data rows of the 19-2 template).
function setEmpty(ws, addr, style) {
  ws[addr] = { t: 's', v: '', s: style };
}

// ---------------------------------------------------------------------------
// 19-2 template helpers (Colombia / hortensias).  These reproduce the layout
// of /mnt/user-data/uploads/*PACKING_LIST_HYDRANGEAS_19-2.xlsx exactly:
//   * dim A1:L58 (always 58 rows, even with few products)
//   * 66 merges (header + B:D for every data row + A:D for TOTAL)
//   * medium border around the header rectangle (rows 2-3) and around the
//     table (row 5 top, row 58 bottom, A col left, L col right)
//   * Bookman Old Style 8pt for header, Calibri 8pt for data
//   * Number formats: NF_INT for counts, NF_THOUSANDS for stems, NF_PRICE2 for $
// ---------------------------------------------------------------------------
function writeTopHeader19_2(ws, grower, weekend, invoice, awb, date) {
  // Row 1 — title spacer.  C1 carries the title font (size 16) so the merged
  // C1:H1 range looks tall.  No borders, no value.
  setEmpty(ws, 'C1', { font: FONT_TITLE, alignment: ALIGN_CENTER, numFmt: NF_TEXT });
  setEmpty(ws, 'I1', { font: FONT_TITLE, alignment: ALIGN_CENTER, numFmt: NF_TEXT });
  setEmpty(ws, 'J1', { font: FONT_TITLE, alignment: { vertical: 'center' }, numFmt: NF_TEXT });

  // Row 2 — Grower / Weekend / Invoice
  // Each "label | value" pair has medium border on its outer edges (top, left
  // for label; top, right for value).  Inner B/D/F/H/J cells fill the merged
  // ranges with matching borders.
  setCell (ws, 'A2', 'Grower:',  { font: FONT_HEADER_BOLD, alignment: ALIGN_LEFT, border: bord('medium', null, 'medium', null), numFmt: NF_TEXT });
  setEmpty(ws, 'B2',             { font: FONT_HEADER_BOLD, border: bord('medium', null, null, null) });
  setCell (ws, 'C2', grower,     { font: FONT_HEADER,      alignment: ALIGN_LEFT, border: bord('medium', null, null, 'medium'), numFmt: NF_TEXT });
  setEmpty(ws, 'D2',             { font: FONT_HEADER,      border: bord('medium', null, null, 'medium') });
  setCell (ws, 'E2', 'Weekend:', { font: FONT_HEADER_BOLD, alignment: ALIGN_LEFT, border: bord('medium', null, 'medium', null), numFmt: NF_TEXT });
  setEmpty(ws, 'F2',             { font: FONT_HEADER_BOLD, border: bord('medium', null, null, null) });
  setCell (ws, 'G2', weekend,    { font: FONT_HEADER,      alignment: ALIGN_LEFT_TOP, border: bord('medium', null, null, 'medium'), numFmt: NF_TEXT });
  setEmpty(ws, 'H2',             { font: FONT_HEADER,      border: bord('medium', null, null, 'medium') });
  setCell (ws, 'I2', 'Invoice:', { font: FONT_HEADER_BOLD, alignment: ALIGN_LEFT, border: bord('medium', null, 'medium', null), numFmt: NF_TEXT });
  setEmpty(ws, 'J2',             { font: FONT_HEADER_BOLD, border: bord('medium', null, null, null) });
  // Invoice number — keep numeric format ('0') so it stays an integer
  setCell (ws, 'K2', invoice ? Number(invoice) || invoice : '', { font: FONT_HEADER, alignment: ALIGN_LEFT, border: bord('medium', null, null, 'medium'), numFmt: NF_PLAIN_INT });
  setEmpty(ws, 'L2',             { font: FONT_HEADER,      border: bord('medium', null, null, 'medium') });

  // Row 3 — AWB / Date / (empty I3:L3 stretch)
  setCell (ws, 'A3', 'AWB:',     { font: FONT_HEADER_BOLD, alignment: ALIGN_LEFT, border: bord(null, 'medium', 'medium', null), numFmt: NF_TEXT });
  setEmpty(ws, 'B3',             { font: FONT_HEADER_BOLD, border: bord(null, 'medium', null, null) });
  setCell (ws, 'C3', awb,        { font: FONT_HEADER,      alignment: ALIGN_LEFT, border: bord(null, 'medium', null, 'medium'), numFmt: NF_TEXT });
  setEmpty(ws, 'D3',             { font: FONT_HEADER,      border: bord(null, 'medium', null, 'medium') });
  setCell (ws, 'E3', 'Date:',    { font: FONT_HEADER_BOLD, alignment: ALIGN_LEFT, border: bord(null, 'medium', 'medium', null), numFmt: NF_TEXT });
  setEmpty(ws, 'F3',             { font: FONT_HEADER_BOLD, border: bord(null, 'medium', null, null) });
  setCell (ws, 'G3', date,       { font: FONT_HEADER,      alignment: ALIGN_LEFT, border: bord(null, 'medium', null, 'medium'), numFmt: NF_TEXT });
  setEmpty(ws, 'H3',             { font: FONT_HEADER,      border: bord(null, 'medium', null, 'medium') });
  // I3:L3 is an empty merged stretch with bottom medium border closing the rectangle
  setEmpty(ws, 'I3',             { font: FONT_HEADER, alignment: ALIGN_LEFT, border: bord(null, 'medium', 'medium', null), numFmt: NF_TEXT });
  setEmpty(ws, 'J3',             { font: FONT_HEADER, border: bord(null, 'medium', null, null) });
  setEmpty(ws, 'K3',             { font: FONT_HEADER, border: bord(null, 'medium', null, null) });
  setEmpty(ws, 'L3',             { font: FONT_HEADER, border: bord(null, 'medium', null, 'medium') });
}

function writeTableHeaders19_2(ws, bchLabel) {
  // Row 5 — table headers.  Top medium, bottom medium, left edge medium on A,
  // right edge medium on L; inner separators thin.
  setCell(ws, 'A5', 'COD',         { font: FONT_TABLE_BOLD, alignment: ALIGN_CENTER,      border: bord('medium', 'medium', 'medium', 'thin'), numFmt: NF_TEXT });
  setCell(ws, 'B5', 'VARIETY NAME',{ font: FONT_TABLE_BOLD, alignment: ALIGN_CENTER,      border: bord('medium', 'medium', null, 'thin'),     numFmt: NF_TEXT });
  setEmpty(ws, 'C5',                { font: FONT_TABLE_BOLD, border: bord('medium', 'medium', null, null) });
  setEmpty(ws, 'D5',                { font: FONT_TABLE_BOLD, border: bord('medium', 'medium', null, 'thin') });
  setCell(ws, 'E5', 'SIZE',        { font: FONT_TABLE_BOLD, alignment: ALIGN_CENTER,      border: bord('medium', 'medium', 'thin', 'thin') });
  setCell(ws, 'F5', 'BOX',         { font: FONT_TABLE_BOLD, alignment: ALIGN_CENTER,      border: bord('medium', 'medium', 'thin', 'thin') });
  setCell(ws, 'G5', bchLabel || 'BCH/ST', { font: FONT_TABLE_BOLD, alignment: ALIGN_CENTER_WRAP, border: bord('medium', 'medium', 'thin', 'thin') });
  setCell(ws, 'H5', 'STEAM BOX',   { font: FONT_TABLE_BOLD, alignment: ALIGN_CENTER_WRAP, border: bord('medium', 'medium', 'thin', 'thin') });
  setCell(ws, 'I5', 'TOTAL\nBUNCH',{ font: FONT_TABLE_BOLD, alignment: ALIGN_CENTER_WRAP, border: bord('medium', 'medium', 'thin', null) });
  setCell(ws, 'J5', 'TOTAL STEAM', { font: FONT_TABLE_BOLD, alignment: ALIGN_CENTER_WRAP, border: bord('medium', 'medium', 'thin', 'medium'), numFmt: NF_TEXT });
  setCell(ws, 'K5', 'U.PRICE',     { font: FONT_TABLE_BOLD, alignment: ALIGN_CENTER,      border: bord('medium', 'medium', 'thin', 'thin') });
  setCell(ws, 'L5', 'T.PRICE',     { font: FONT_TABLE_BOLD, alignment: ALIGN_CENTER_WRAP, border: bord('medium', 'medium', 'thin', 'medium'), numFmt: NF_TEXT });
}

// Build the full 66-merge set for the 19-2 template.
// All hortensia packing lists use the same layout independent of how many
// products there are.
// Build the merge set for the 19-2 template.
// Rows are dynamic: pass the actual lastDataRow and totalRow calculated from
// the product count so pseudo-rows beyond row 57 are never silently dropped.
function buildMerges19_2(lastDataRow, totalRow) {
  const m = [];
  // Title row (row 1, 0-indexed r:0): C1:H1
  m.push({ s: { r: 0, c: 2 }, e: { r: 0, c: 7 } });
  // Header row 2 (r:1): A2:B2, C2:D2, E2:F2, G2:H2, I2:J2, K2:L2
  for (const c of [0, 2, 4, 6, 8, 10]) m.push({ s: { r: 1, c }, e: { r: 1, c: c + 1 } });
  // Header row 3 (r:2): A3:B3, C3:D3, E3:F3, G3:H3, I3:L3 (note: I3:L3 spans 4)
  for (const c of [0, 2, 4, 6])  m.push({ s: { r: 2, c }, e: { r: 2, c: c + 1 } });
  m.push({ s: { r: 2, c: 8 }, e: { r: 2, c: 11 } });
  // Table header row 5 (r:4): B5:D5
  m.push({ s: { r: 4, c: 1 }, e: { r: 4, c: 3 } });
  // Data rows 6..lastDataRow: each has B:D merged
  for (let r = 5; r <= lastDataRow - 1; r++) m.push({ s: { r, c: 1 }, e: { r, c: 3 } });
  // TOTAL row: A:D merged
  m.push({ s: { r: totalRow - 1, c: 0 }, e: { r: totalRow - 1, c: 3 } });
  return m;
}

// Apply the column widths and the first-five row heights from the 19-2 template.
function applyColWidths19_2(ws) {
  ws['!cols'] = [
    { wch: 3.54 },  { wch: 7.0 },   { wch: 13.45 }, { wch: 8.45 },
    { wch: 5.45 },  { wch: 4.27 },  { wch: 4.0 },   { wch: 5.18 },
    { wch: 6.18 },  { wch: 7.0 },   { wch: 7.27 }, { wch: 9.18 },
  ];
  ws['!rows'] = [
    { hpt: 34.5 },  { hpt: 16.5 }, { hpt: 17.25 }, { hpt: 7.5 }, { hpt: 26.25 },
  ];
}

// ---------------------------------------------------------------------------
// Legacy helpers (used by NL/CN/EC/AU generators).  Kept unchanged in semantics
// so those generators still produce the same output they did before.  Only the
// `number_format` → `numFmt` bug fix is applied here.
// ---------------------------------------------------------------------------
function writeTopHeader(ws, grower, weekend, invoice, awb, date) {
  const lblStyle = { font: FONT_HEADER_BOLD, alignment: ALIGN_LEFT, border: bordersAll('thin') };
  const valStyle = { font: FONT_HEADER,      alignment: ALIGN_LEFT, border: bordersAll('thin') };
  setCell(ws, 'A2', 'Grower:', lblStyle); setCell(ws, 'C2', grower,  valStyle);
  setCell(ws, 'E2', 'Weekend:', lblStyle); setCell(ws, 'G2', weekend, valStyle);
  setCell(ws, 'I2', 'Invoice:', lblStyle); setCell(ws, 'K2', invoice, valStyle);
  setCell(ws, 'A3', 'AWB:',     lblStyle); setCell(ws, 'C3', awb,     valStyle);
  setCell(ws, 'E3', 'Date:',    lblStyle); setCell(ws, 'G3', date,    valStyle);
}
function writeTableHeaders(ws, bchLabel) {
  const hs = { font: FONT_TABLE_BOLD, alignment: ALIGN_CENTER_WRAP, border: bordersAll('thin') };
  setCell(ws, 'A5', 'COD', hs); setCell(ws, 'B5', 'VARIETY NAME', hs);
  setCell(ws, 'E5', 'SIZE', hs); setCell(ws, 'F5', 'BOX', hs);
  setCell(ws, 'G5', bchLabel || 'BCH/ST', hs); setCell(ws, 'H5', 'STEAM BOX', hs);
  setCell(ws, 'I5', 'TOTAL\nBUNCH', hs); setCell(ws, 'J5', 'TOTAL STEAM', hs);
  setCell(ws, 'K5', 'U.PRICE', hs); setCell(ws, 'L5', 'T.PRICE', hs);
}
function buildMerges(lastDataRow, totalRow, extraRows) {
  const m = [
    { s: { r: 1, c: 0 }, e: { r: 1, c: 1 } },
    { s: { r: 1, c: 2 }, e: { r: 1, c: 3 } },
    { s: { r: 1, c: 4 }, e: { r: 1, c: 5 } },
    { s: { r: 1, c: 6 }, e: { r: 1, c: 7 } },
    { s: { r: 1, c: 8 }, e: { r: 1, c: 9 } },
    { s: { r: 1, c: 10 }, e: { r: 1, c: 11 } },
    { s: { r: 2, c: 0 }, e: { r: 2, c: 1 } },
    { s: { r: 2, c: 2 }, e: { r: 2, c: 3 } },
    { s: { r: 2, c: 4 }, e: { r: 2, c: 5 } },
    { s: { r: 2, c: 6 }, e: { r: 2, c: 7 } },
    { s: { r: 2, c: 8 }, e: { r: 2, c: 11 } },
  ];
  for (let r = 6; r <= lastDataRow; r++) m.push({ s: { r: r - 1, c: 1 }, e: { r: r - 1, c: 3 } });
  extraRows.forEach((r) => m.push({ s: { r: r - 1, c: 1 }, e: { r: r - 1, c: 3 } }));
  m.push({ s: { r: totalRow - 1, c: 0 }, e: { r: totalRow - 1, c: 3 } });
  return m;
}
function applyColWidths(ws) {
  ws['!cols'] = [{ wch: 3.5 }, { wch: 7 }, { wch: 13.5 }, { wch: 8.5 }, { wch: 5.5 }, { wch: 4.3 }, { wch: 4 }, { wch: 5.2 }, { wch: 6.2 }, { wch: 7 }, { wch: 7.3 }, { wch: 9.2 }];
  ws['!rows'] = [{ hpt: 34.5 }, { hpt: 16.5 }, { hpt: 17.25 }, { hpt: 7.5 }, { hpt: 26.25 }];
}

// =============================================================================
// EXCEL GENERATORS
// =============================================================================

// ---------------------------------------------------------------------------
// buildSheet19_2 — write the 19-2 template layout into a worksheet.
// Used by ALL generators so every country produces the same look:
//   * dim A1:L58 (always 58 rows, even with few products)
//   * 66 merges (header rectangle + B:D for every data row + A:D for TOTAL)
//   * medium border around header rectangle (rows 2-3) and around the TOTAL row
//   * Bookman Old Style 8pt header, Calibri 8pt data
//   * empty rows beyond product count are still styled
//
// `opts` fields:
//   grower      string  — Grower name (header C2)
//   weekend     string  — e.g. '19-02'
//   invoice     string  — invoice number
//   awb         string  — air waybill
//   date        string  — invoice date
//   bchLabel    string  — header for column G (default 'BCH/ST', NL uses 'BUNCH/ST')
//   products    array   — resolved products with .matchedName, .pcs, .bunch_st,
//                         .steam_box, .u_price, .unmatched
//   priceFmt    string  — 'NF_PRICE2' (default) or 'NF_PRICE3' for U.PRICE
//   stemsAreBxBox  bool — if true (default), stems = boxes × steam_box.
//                         If false, .total_stems is taken from product directly.
// ---------------------------------------------------------------------------
// ===========================================================================
// Per-country DATA-ROW WRITERS
// Each `writeDataRow{Country}(ws, r, p, styles)` writes the 12 cells of a
// single product row using the semantics of that country's invoice.
//
// All writers MUST also return the line's contribution to the running total
// (a number) so the builder can validate against the invoice's grand total.
// Empty rows are NOT this writer's concern — the builder handles them.
// ===========================================================================

// CO ANTIOQUIA — pcs is input, bunch_st=1, steam_box=stems/box.
//   F=pcs  G=bunch_st  H=steam_box  I==J/G  J==F*H  K=u_price  L==K*J  (per stem)
function writeDataRowCOAntioquia(ws, r, p, styles) {
  const pcs = p.pcs || 0;
  const bunchSt = p.bunch_st || 1;
  const steamBox = p.steam_box || 0;
  const uPrice = p.u_price || 0;
  // "Retail" mode: some Colombian invoices (Esperance, Maxiflores,
  // Construnorte, El Milagro, Daflor, Redil, Tiba, Funza, etc.) sell at the
  // unit level — they have NO "Boxes" / "ST/BOX" columns, just a "Cantidad"
  // and "Precio Unitario".  In that case the model returns pcs=0 and
  // total_stems=<cantidad>.  We write the stems directly into J (TOTAL STEAM)
  // and leave F (BOX) blank, with G=1 so I=J/G renders the same value in
  // TOTAL BUNCH for visual parity.
  const isRetail = (pcs === 0) && (Number(p.total_stems) || 0) > 0;
  if (isRetail) {
    const totalStems = Number(p.total_stems) || 0;
    // Aplicamos la misma regla de stems-per-bunch por familia que en
    // wholesale.  Para familias no listadas (Ruscus, etc.) cae a 1 porque
    // en modo retail el PDF no trae bunch_st explícito.
    const bunchStRetail = stemsPerBunchCO(p.matchedName, 1);
    setCell   (ws, `F${r}`, '',          styles.F);
    setCell   (ws, `G${r}`, bunchStRetail, styles.G);
    setCell   (ws, `H${r}`, '',          styles.H);
    setFormula(ws, `I${r}`, `J${r}/G${r}`, styles.I);
    setCell   (ws, `J${r}`, totalStems,  styles.J);
    setCell   (ws, `K${r}`, uPrice,      styles.K);
    setFormula(ws, `L${r}`, `K${r}*J${r}`, styles.L);
    ws[`L${r}`].v = uPrice * totalStems;
    return uPrice * totalStems;
  }
  setCell   (ws, `F${r}`, pcs,        styles.F);
  // CO: sobreescribimos bunch_st por la regla fija de familia (rosa 10,
  // clavel 20, mini-carn 10, alstro 10, hydrangea 1, etc.).  Ruscus y otros
  // no listados conservan el valor del PDF.
  const bunchStCO = stemsPerBunchCO(p.matchedName, bunchSt);
  const calcStems = pcs * steamBox;
  const calcBunch = bunchStCO > 0 ? calcStems / bunchStCO : 0;
  setCell   (ws, `G${r}`, bunchStCO,  styles.G);
  setCell   (ws, `H${r}`, steamBox,   styles.H);
  setFormula(ws, `I${r}`, `J${r}/G${r}`, styles.I);
  ws[`I${r}`].v = calcBunch;
  setFormula(ws, `J${r}`, `F${r}*H${r}`, styles.J);
  ws[`J${r}`].v = calcStems;
  setCell   (ws, `K${r}`, uPrice,     styles.K);
  setFormula(ws, `L${r}`, `K${r}*J${r}`, styles.L);
  ws[`L${r}`].v = uPrice * calcStems;
  return uPrice * calcStems;          // per-stem total
}

// CO BOGOTÁ — same layout as Antioquia.
const writeDataRowCOBogota = writeDataRowCOAntioquia;

// NL HOLEX — pcs/colli is input, bunch_st input, steam_box per box,
//   total_bunch is INPUT (col I), total_stem = I*G (col J), per-stem price
//   F=pcs  G=bunch_st  H=steam_box  I=total_bunch  J==I*G  K=u_price  L==K*J
function writeDataRowNL(ws, r, p, styles) {
  const pcs = p.pcs || 0;
  const bunchSt = p.bunch_st || 1;
  const steamBox = p.steam_box || 0;
  const totalBunch = p.total_bunch || 0;
  const uPrice = p.u_price || 0;
  const totalStems = totalBunch * bunchSt;
  setCell   (ws, `F${r}`, pcs,         styles.F);
  setCell   (ws, `G${r}`, bunchSt,     styles.G);
  setCell   (ws, `H${r}`, steamBox,    styles.H);
  setCell   (ws, `I${r}`, totalBunch,  styles.I);
  setFormula(ws, `J${r}`, `I${r}*G${r}`, styles.J);
  ws[`J${r}`].v = totalStems;
  setCell   (ws, `K${r}`, uPrice,      styles.K);
  setFormula(ws, `L${r}`, `K${r}*J${r}`, styles.L);
  ws[`L${r}`].v = uPrice * totalStems;
  return uPrice * totalStems;          // per-stem total
}

// CHINA — total_bunch input, per-bunch price.
//   F=boxes G=stems/bunch H=stems/box I=bunches J=source stems K=u_price L=K*I
function writeDataRowCN(ws, r, p, styles) {
  const quantities = chinaSourceQuantities(p);
  const pcs = quantities.pcs;
  const bunchSt = quantities.bunch_st;
  const steamBox = quantities.steam_box;
  const totalBunch = quantities.total_bunch;
  const uPrice = p.u_price || 0;
  setCell   (ws, `F${r}`, pcs,         styles.F);
  setCell   (ws, `G${r}`, bunchSt,     styles.G);
  setCell   (ws, `H${r}`, steamBox,    styles.H);
  setCell   (ws, `I${r}`, totalBunch,  styles.I);
  setCell(ws, `J${r}`, quantities.total_stems, styles.J);
  setCell   (ws, `K${r}`, uPrice,      styles.K);
  setFormula(ws, `L${r}`, `K${r}*I${r}`, styles.L);
  ws[`L${r}`].v = uPrice * totalBunch;
  return uPrice * totalBunch;          // per-bunch total
}

// ECUADOR — total_stems direct.
//   F=pcs  G=bunch_st  H=steam_box  I=total_bunch  J=total_stems  K=u_price  L==K*J  (per stem)
function writeDataRowEC(ws, r, p, styles) {
  const pcs = p.pcs || 0;
  const bunchSt = p.bunch_st ?? 0;
  const steamBox = p.steam_box || 0;
  const totalBunch = p.total_bunch;
  const totalStems = p.total_stems || 0;
  const uPrice = p.u_price || 0;
  setCell(ws, `F${r}`, pcs,         styles.F);
  setCell(ws, `G${r}`, bunchSt,     styles.G);
  setCell(ws, `H${r}`, steamBox,    styles.H);
  if (totalBunch == null) setEmpty(ws, `I${r}`, styles.I);
  else setCell(ws, `I${r}`, totalBunch, styles.I);
  setCell(ws, `J${r}`, totalStems,  styles.J);
  setCell(ws, `K${r}`, uPrice,      styles.K);
  setFormula(ws, `L${r}`, `K${r}*J${r}`, styles.L);
  ws[`L${r}`].v = uPrice * totalStems;
  return uPrice * totalStems;        // per-stem total
}

// THAILAND — matches Krung Thep Interflora and Super Fresh reference packing
// lists.  Pricing is per stem.
//   F = blank                          (BOX — not used)
//   G = stems per bunch (BUNCH/ST)     (10, 5, 100 depending on item)
//   H = blank                          (STEAM BOX — not used)
//   I = total bunches (TOTAL BUNCH)
//   J = =I*G                           (TOTAL STEAM)
//   K = u_price                        (per stem, USD)
//   L = =K*J                           (T.PRICE)
function writeDataRowTH(ws, r, p, styles) {
  const bunchSt    = p.bunch_st  || 1;
  const totalBunch = p.total_bunch || 0;
  const uPrice     = p.u_price   || 0;
  const totalStems = bunchSt * totalBunch;
  // F and H stay empty in the reference Thailand template.
  setCell   (ws, `F${r}`, '',           styles.F);
  setCell   (ws, `G${r}`, bunchSt,      styles.G);
  setCell   (ws, `H${r}`, '',           styles.H);
  setCell   (ws, `I${r}`, totalBunch,   styles.I);
  setFormula(ws, `J${r}`, `I${r}*G${r}`, styles.J);
  ws[`J${r}`].v = totalStems;
  setCell   (ws, `K${r}`, uPrice,       styles.K);
  setFormula(ws, `L${r}`, `K${r}*J${r}`, styles.L);
  ws[`L${r}`].v = uPrice * totalStems;
  return uPrice * totalStems;           // per-stem total
}

// AUSTRALIA — matches the Premium Greens reference packing list exactly.
//   F = =I/H               (BOX, computed)
//   G = stems per bunch    (input — from "(N stems/bunch)" in description)
//   H = bunches per box    (input — derived as total_bunch / pcs from invoice)
//   I = total bunches      (input — from invoice "Units" column)
//   J = =I*G               (TOTAL STEAM)
//   K = u_price            (input — price per bunch)
//   L = =K*I               (T.PRICE per bunch)
function writeDataRowAU(ws, r, p, styles) {
  const stemsPerBunch = p.bunch_st || 1;
  const totalBunch = p.total_bunch || 0;
  const pcs = p.pcs || 1;
  // bunches per box.  If the invoice provided it explicitly use it; otherwise
  // derive from total_bunch / pcs (rounded — boxes are atomic).
  const bunchesPerBox = p.bunches_per_box || (pcs > 0 ? Math.round(totalBunch / pcs) : 0);
  const uPrice = p.u_price || 0;
  setFormula(ws, `F${r}`, `I${r}/H${r}`, styles.F);
  if (bunchesPerBox > 0) ws[`F${r}`].v = totalBunch / bunchesPerBox;
  setCell   (ws, `G${r}`, stemsPerBunch, styles.G);
  setCell   (ws, `H${r}`, bunchesPerBox, styles.H);
  setCell   (ws, `I${r}`, totalBunch,    styles.I);
  setFormula(ws, `J${r}`, `I${r}*G${r}`, styles.J);
  ws[`J${r}`].v = totalBunch * stemsPerBunch;
  setCell   (ws, `K${r}`, uPrice,        styles.K);
  setFormula(ws, `L${r}`, `K${r}*I${r}`, styles.L);
  ws[`L${r}`].v = uPrice * totalBunch;
  return uPrice * totalBunch;            // per-bunch total
}

// USA / HOOD CANAL — per-box pricing.  The reference Hood Canal packing list
// uses simple semantics: F=Boxes (input), J=Stem Count (input from invoice),
// K=price per box, L=K*F. Record G/H/I only when supported by source packing.
//   F=pcs (input)  G=∅  H=∅  I=∅  J=stem_count (input)  K=u_price  L==K*F  (per box)
function writeDataRowUS(ws, r, p, styles) {
  const pcs = p.pcs || 0;
  const totalStems = p.total_stems || 0;
  const uPrice = p.u_price || 0;
  setCell   (ws, `F${r}`, pcs,        styles.F);
  if (p.bunch_st > 0) setCell(ws, `G${r}`, p.bunch_st, styles.G);
  else setEmpty(ws, `G${r}`, styles.G);
  if (p.steam_box > 0) setCell(ws, `H${r}`, p.steam_box, styles.H);
  else setEmpty(ws, `H${r}`, styles.H);
  if (p.total_bunch != null) setCell(ws, `I${r}`, p.total_bunch, styles.I);
  else setEmpty(ws, `I${r}`, styles.I);
  setCell   (ws, `J${r}`, totalStems, styles.J);
  setCell   (ws, `K${r}`, uPrice,     styles.K);
  setFormula(ws, `L${r}`, `K${r}*F${r}`, styles.L);
  ws[`L${r}`].v = uPrice * pcs;
  return uPrice * pcs;                   // per-box total
}

// VIETNAM / ROYAL BASE — orchid stems, sold per stem, packed N stems/box.
//   F==J/H  G=∅  H=stems_per_box (input)  I=∅  J=total_stems (input)
//   K=u_price  L==K*J  (per stem)
function writeDataRowVN(ws, r, p, styles) {
  const stemsPerBox = p.steam_box || 1;
  const totalStems = p.total_stems || 0;
  const uPrice = p.u_price || 0;
  setFormula(ws, `F${r}`, `J${r}/H${r}`, styles.F);
  ws[`F${r}`].v = totalStems / stemsPerBox;
  setEmpty  (ws, `G${r}`,              styles.G);
  setCell   (ws, `H${r}`, stemsPerBox, styles.H);
  setEmpty  (ws, `I${r}`,              styles.I);
  setCell   (ws, `J${r}`, totalStems,  styles.J);
  setCell   (ws, `K${r}`, uPrice,      styles.K);
  setFormula(ws, `L${r}`, `K${r}*J${r}`, styles.L);
  ws[`L${r}`].v = uPrice * totalStems;
  return uPrice * totalStems;            // per-stem total
}

// Pseudo-row writer used for non-product rows like 운송료, Gross weight, etc.
// It writes whatever fields are non-empty in `p` and skips formulas.
function writeDataRowPseudo(ws, r, p, styles) {
  // Use named fields so each generator can place values in the right columns.
  // A field can be:
  //   - a number/string                      → setCell
  //   - { formula: 'K*I' } (pattern only)    → setFormula with row substituted
  //   - null/undefined                       → setEmpty (styled but blank)
  const cells = {
    F: p.cellF, G: p.cellG, H: p.cellH,
    I: p.cellI, J: p.cellJ, K: p.cellK, L: p.cellL,
  };
  for (const col of 'FGHIJKL') {
    const v = cells[col];
    if (v == null) {
      setEmpty(ws, `${col}${r}`, styles[col]);
    } else if (typeof v === 'object' && v.formula) {
      // Replace bare column letters in the pattern with cell refs (e.g. K → K6)
      const expanded = v.formula.replace(/([A-Z])(?![\w$])/g, (_, c) => `${c}${r}`);
      setFormula(ws, `${col}${r}`, expanded, styles[col]);
      if (typeof v.value === 'number' && Number.isFinite(v.value)) {
        ws[`${col}${r}`].v = v.value;
      } else if (col === 'L' && Number.isFinite(Number(p.lineTotal))) {
        ws[`${col}${r}`].v = Number(p.lineTotal);
      }
    } else {
      setCell(ws, `${col}${r}`, v, styles[col]);
    }
  }
  return Number(p.lineTotal) || 0;
}

function buildSheet19_2(ws, opts) {
  const {
    grower, weekend, invoice, awb, date,
    bchLabel = 'BCH/ST',
    products = [],
    priceFmt = NF_PRICE2,
    writeDataRow,           // (ws, r, product, styles) → number (line total)
  } = opts;

  writeTopHeader19_2(ws, grower, weekend, invoice, awb, date);
  writeTableHeaders19_2(ws, bchLabel);

  const FIRST_DATA_ROW = 6;
  // Always at least 52 data rows (the original 19-2 template size) so short
  // invoices keep the same look.  Grow dynamically when products.length
  // exceeds 52 so pseudo-rows at the end (운송료, GW, CW) are never silently
  // dropped past row 57.
  const MIN_DATA_ROWS = 52;
  const LAST_DATA_ROW = FIRST_DATA_ROW - 1 + Math.max(MIN_DATA_ROWS, products.length);
  const TOTAL_ROW = LAST_DATA_ROW + 1;

  // Per-column data-row styles (matches the 19-2 template).
  const dataRowStyles = (topMedium) => {
    const tA = topMedium ? null : 'thin';
    const tB = topMedium ? 'medium' : 'thin';
    const tInner = topMedium ? null : 'thin';
    return {
      A: { font: FONT_TABLE, alignment: ALIGN_CENTER, border: bord(tA, 'thin', 'thin', 'thin'), numFmt: NF_TEXT },
      B: { font: FONT_TABLE, alignment: ALIGN_LEFT,   border: bord(tB, 'thin', 'thin', 'thin'), numFmt: NF_TEXT },
      C: { border: bord(tB === 'medium' ? null : 'thin', 'thin', null, null) },
      D: { border: bord(tB === 'medium' ? null : 'thin', 'thin', null, 'thin') },
      E: { font: FONT_TABLE, alignment: ALIGN_CENTER, border: bord(tInner, 'thin', 'thin', 'thin'), numFmt: NF_INT },
      F: { font: FONT_TABLE, alignment: ALIGN_CENTER, border: bord(tInner, 'thin', 'thin', 'thin'), numFmt: NF_INT },
      G: { font: FONT_TABLE, alignment: ALIGN_CENTER, border: bord(tInner, 'thin', 'thin', 'thin'), numFmt: NF_INT },
      H: { font: FONT_TABLE, alignment: ALIGN_CENTER, border: bord(tInner, 'thin', 'thin', 'thin'), numFmt: NF_INT },
      I: { font: FONT_TABLE, alignment: ALIGN_CENTER, border: bord(null,   'thin', 'thin', 'thin'), numFmt: NF_INT },
      J: { font: FONT_TABLE, alignment: ALIGN_CENTER, border: bord(null,   'thin', 'thin', 'thin'), numFmt: NF_THOUSANDS },
      K: { font: FONT_TABLE, alignment: ALIGN_CENTER, border: bord(tInner, 'thin', 'thin', 'thin'), numFmt: priceFmt },
      L: { font: FONT_TABLE, alignment: ALIGN_CENTER, border: bord(null,   'thin', 'thin', 'thin'), numFmt: priceFmt },
    };
  };
  const unmatchedNameStyle = (topMedium) => ({
    font: { name: 'Calibri', sz: 8, color: { rgb: 'C81E1E' } },
    alignment: ALIGN_LEFT,
    border: bord(topMedium ? 'medium' : 'thin', 'thin', 'thin', 'thin'),
    numFmt: NF_TEXT,
  });

  let computedTotal = 0;

  for (let r = FIRST_DATA_ROW; r <= LAST_DATA_ROW; r++) {
    const idx = r - FIRST_DATA_ROW;
    const p = idx < products.length ? products[idx] : null;
    const isFirst = r === FIRST_DATA_ROW;
    const styles = dataRowStyles(isFirst);

    // Cols A, B, C, D, E always get written by the builder
    if (p) setCell(ws, `A${r}`, String(idx + 1), styles.A);
    else setEmpty(ws, `A${r}`, styles.A);
    if (p) {
      const bStyle = p.unmatched ? unmatchedNameStyle(isFirst) : styles.B;
      setCell(ws, `B${r}`, p.matchedName, bStyle);
    } else {
      setEmpty(ws, `B${r}`, styles.B);
    }
    setEmpty(ws, `C${r}`, styles.C);
    setEmpty(ws, `D${r}`, styles.D);
    setEmpty(ws, `E${r}`, styles.E);

    if (p) {
      // Choose writer: pseudo row (운송료 etc.) gets writeDataRowPseudo,
      // real product gets the country writer.
      const writer = p.isPseudo ? writeDataRowPseudo : writeDataRow;
      const lineTotal = writer(ws, r, p, styles);
      computedTotal += Number(lineTotal) || 0;
    } else {
      // Empty rows: NO formulas (avoids #VALUE! propagating into SUM)
      setEmpty(ws, `F${r}`, styles.F);
      setEmpty(ws, `G${r}`, styles.G);
      setEmpty(ws, `H${r}`, styles.H);
      setEmpty(ws, `I${r}`, styles.I);
      setEmpty(ws, `J${r}`, styles.J);
      setEmpty(ws, `K${r}`, styles.K);
      setEmpty(ws, `L${r}`, styles.L);
    }
  }

  // TOTAL row
  const totA          = { font: FONT_TABLE_BOLD, alignment: ALIGN_CENTER, border: bord('medium', 'medium', 'medium', 'thin'),  numFmt: NF_TEXT };
  const totBcd        = { font: FONT_TABLE_BOLD, border: bord('medium', 'medium', null, null) };
  const totBcd_right  = { font: FONT_TABLE_BOLD, border: bord('medium', 'medium', null, 'thin') };
  const totInt        = { font: FONT_TABLE_BOLD, alignment: ALIGN_CENTER, border: bord('medium', 'medium', 'thin', 'thin'),    numFmt: NF_INT };
  const totLast       = { font: FONT_TABLE_BOLD, alignment: ALIGN_CENTER, border: bord('medium', 'medium', 'thin', 'medium'), numFmt: priceFmt };
  const metadataRows = products.slice(0, LAST_DATA_ROW - FIRST_DATA_ROW + 1)
    .flatMap((product, index) => product.isPseudo ? [FIRST_DATA_ROW + index] : []);
  const setGoodsTotal = column => {
    const excluded = metadataRows.filter(row => {
      const cell = ws[`${column}${row}`];
      return cell?.f || cell?.t === 'n';
    });
    const ranges = [];
    let start = FIRST_DATA_ROW;
    for (const row of [...excluded, LAST_DATA_ROW + 1]) {
      if (start < row) ranges.push(`${column}${start}:${column}${row - 1}`);
      start = row + 1;
    }
    const address = `${column}${TOTAL_ROW}`;
    setFormula(ws, address, ranges.length ? `SUM(${ranges.join(',')})` : '0', totInt);
    const cells = products.slice(0, LAST_DATA_ROW - FIRST_DATA_ROW + 1)
      .flatMap((product, index) => product.isPseudo ? [] : [ws[`${column}${FIRST_DATA_ROW + index}`]]);
    if (cells.every(cell => !cell?.f || typeof cell?.v === 'number')) {
      ws[address].v = cells.reduce((sum, cell) => sum + (typeof cell?.v === 'number' && Number.isFinite(cell.v) ? cell.v : 0), 0);
    }
  };
  setCell   (ws, `A${TOTAL_ROW}`, 'TOTAL', totA);
  setEmpty  (ws, `B${TOTAL_ROW}`, totBcd);
  setEmpty  (ws, `C${TOTAL_ROW}`, totBcd);
  setEmpty  (ws, `D${TOTAL_ROW}`, totBcd_right);
  setEmpty  (ws, `E${TOTAL_ROW}`, totInt);
  setGoodsTotal('F');
  setEmpty  (ws, `G${TOTAL_ROW}`, totInt);
  setEmpty  (ws, `H${TOTAL_ROW}`, totInt);
  setGoodsTotal('I');
  setGoodsTotal('J');
  setEmpty  (ws, `K${TOTAL_ROW}`, { ...totInt, numFmt: priceFmt });
  setFormula(ws, `L${TOTAL_ROW}`, `SUM(L${FIRST_DATA_ROW}:L${LAST_DATA_ROW})`, totLast);
  ws[`L${TOTAL_ROW}`].v = computedTotal;

  ws['!ref']    = `A1:L${TOTAL_ROW}`;
  ws['!merges'] = buildMerges19_2(LAST_DATA_ROW, TOTAL_ROW);
  applyColWidths19_2(ws);

  return { computedTotal };
}

export {
  FONT_HEADER_BOLD,
  FONT_HEADER,
  FONT_TITLE,
  FONT_TABLE_BOLD,
  FONT_TABLE,
  ALIGN_LEFT,
  ALIGN_LEFT_TOP,
  ALIGN_CENTER,
  ALIGN_CENTER_WRAP,
  BORDER_THIN,
  BORDER_MEDIUM,
  NF_TEXT,
  NF_PLAIN_INT,
  NF_INT,
  NF_THOUSANDS,
  NF_PRICE3,
  NF_PRICE2,
  bord,
  bordersAll,
  setCell,
  setFormula,
  setEmpty,
  writeTopHeader19_2,
  writeTableHeaders19_2,
  buildMerges19_2,
  applyColWidths19_2,
  writeTopHeader,
  writeTableHeaders,
  buildMerges,
  applyColWidths,
  writeDataRowCOAntioquia,
  writeDataRowCOBogota,
  writeDataRowNL,
  writeDataRowCN,
  writeDataRowEC,
  writeDataRowTH,
  writeDataRowAU,
  writeDataRowUS,
  writeDataRowVN,
  writeDataRowPseudo,
  buildSheet19_2,
};
