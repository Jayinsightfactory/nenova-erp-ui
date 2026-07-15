// lib/raumPnlExcel.js — 라움 손익계산서 엑셀 생성 (서버 전용, exceljs)
// 사장님 수기 양식(라움 손익계산서.xlsx: 차수시트 + 결산시트)을 재현:
// 차수마다 시트 하나(품목·매입/매출·이익·네노바/미우 분배, 수식), 마지막에 '결산' 시트(차수별 합산, 시트 참조 수식).
// 수식은 하드코딩 값 대신 실제 계산식으로 넣어 엑셀에서 수정하면 재계산된다. 분배비율은 각 시트 O1 셀 참조.
import ExcelJS from 'exceljs';

const FONT = { name: '맑은 고딕', size: 10 };
const FONT_BOLD = { ...FONT, bold: true };
const FONT_INPUT = { ...FONT, color: { argb: 'FF0000FF' } }; // 파랑 = 사용자 입력값(매입단가)
const FMT_MONEY = '#,##0';
const FMT_PRICE = '#,##0.0';
const FMT_PCT = '0.0%';
const THIN = { style: 'thin', color: { argb: 'FF999999' } };
const BORDER = { top: THIN, left: THIN, bottom: THIN, right: THIN };
const HEAD_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
const TOTAL_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFAFAFA' } };

const dateStr = (v) => {
  if (!v) return '';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? String(v).slice(0, 10) : `${d.getMonth() + 1}/${d.getDate()}`;
};

// 차수 손익 합계 — 매출은 사입 포함, 손익은 사입 제외 (웹 computeTotals 와 동일 정의).
// 모든 수식 셀에 이 값을 result 캐시로 심는다 — 재계산 안 하는 뷰어(미리보기·한셀 등)에서도 값이 보이게.
function recordTotals(items, pct) {
  const t = { qty: 0, sale: 0, consignedSale: 0, cost: 0, profit: 0, branchQty: {} };
  for (const it of items) {
    const qty = Number(it.qty || 0);
    const sale = qty * Number(it.price || 0);
    t.qty += qty;
    t.sale += sale;
    for (const [b, q] of Object.entries(it.byBranch || {})) t.branchQty[b] = (t.branchQty[b] || 0) + Number(q || 0);
    if (it.consigned) { t.consignedSale += sale; continue; }
    const cost = it.costPrice != null ? Number(it.costPrice) * qty : 0;
    t.cost += cost;
    t.profit += sale - cost;
  }
  t.pnlSale = t.sale - t.consignedSale;
  t.rate = t.pnlSale > 0 ? t.profit / t.pnlSale : 0;
  t.nen = t.profit * pct;
  t.miu = t.profit * (1 - pct);
  return t;
}

// 한 차수 시트 — 반환: 결산 시트가 참조할 시트명
function addWeekSheet(wb, record) {
  const { master, items } = record;
  const major = Number(master.MajorWeek);
  const sheetName = `${major}차`;
  const ws = wb.addWorksheet(sheetName);
  const branches = [...new Set(items.flatMap(it => Object.keys(it.byBranch || {})))];
  const nB = branches.length;

  // 열: A품목명 B단위 [지점...] E수량 F매입단가 G매입액 H매출단가 I매출액 J이익 K이익율 L네노바 M미우 N적요
  const col = {
    name: 1, unit: 2, branch0: 3,
    qty: 3 + nB, cost: 4 + nB, costAmt: 5 + nB, sale: 6 + nB, saleAmt: 7 + nB,
    profit: 8 + nB, rate: 9 + nB, nen: 10 + nB, miu: 11 + nB, remark: 12 + nB,
  };
  const L = (c) => ws.getColumn(c).letter;
  const lastCol = col.remark;
  const pct = Number(master.NenovaPct || 80) / 100;

  // 1행: 제목 + 분배비율 셀(수식이 참조 — 여기만 바꾸면 전체 재계산)
  ws.mergeCells(1, 1, 1, col.rate);
  const title = ws.getCell(1, 1);
  title.value = `라움 ${major}차 (${dateStr(master.QuoteDate)}) — VAT별도`;
  title.font = { ...FONT_BOLD, size: 13 };
  title.alignment = { horizontal: 'center', vertical: 'middle' };
  ws.getRow(1).height = 22;
  ws.getCell(1, col.nen).value = '네노바비율→';
  ws.getCell(1, col.nen).font = { ...FONT, size: 9 };
  ws.getCell(1, col.nen).alignment = { horizontal: 'right' };
  const pctCell = ws.getCell(1, col.miu);
  pctCell.value = pct;
  pctCell.numFmt = '0%';
  pctCell.font = FONT_INPUT;
  const PCT_REF = `$${L(col.miu)}$1`;

  // 2행: 헤더
  const heads = ['품목명', '단위', ...branches, '수량계', '매입단가', '매입액', '매출단가', '매출액', '이익', '이익율',
    `네노바이익(${Math.round(pct * 100)}%)`, `미우이익(${Math.round((1 - pct) * 100)}%)`, '적요'];
  heads.forEach((h, i) => {
    const c = ws.getCell(2, i + 1);
    c.value = h;
    c.font = FONT_BOLD;
    c.fill = HEAD_FILL;
    c.border = BORDER;
    c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  });

  // 품목 행
  const first = 3;
  items.forEach((it, i) => {
    const r = first + i;
    const row = ws.getRow(r);
    const qty = Number(it.qty || 0);
    const cost = it.costPrice != null ? Number(it.costPrice) : null;
    const sale = it.price != null ? Number(it.price) : 0;
    row.getCell(col.name).value = it.name + (it.isCustom ? ' (수동)' : '');
    row.getCell(col.unit).value = it.unit || '';
    branches.forEach((b, bi) => {
      const v = Number(it.byBranch?.[b] || 0);
      row.getCell(col.branch0 + bi).value = v || null;
      row.getCell(col.branch0 + bi).numFmt = FMT_MONEY;
    });
    row.getCell(col.qty).value = qty;
    row.getCell(col.qty).numFmt = FMT_MONEY;
    row.getCell(col.sale).value = sale;
    row.getCell(col.sale).numFmt = FMT_PRICE;
    row.getCell(col.saleAmt).value = { formula: `${L(col.qty)}${r}*${L(col.sale)}${r}`, result: qty * sale };
    if (it.consigned) {
      // 사입(원산지 없음) — 매출액만 (손익 열은 비움 → 합계 SUM 에서 자연 제외)
      row.getCell(col.remark).value = `사입(손익 제외)${it.remark ? ` · ${it.remark}` : ''}`;
    } else {
      const cc = row.getCell(col.cost);
      cc.value = cost;
      cc.numFmt = FMT_PRICE;
      cc.font = FONT_INPUT; // 파랑 = 입력칸
      row.getCell(col.costAmt).value = { formula: `${L(col.qty)}${r}*${L(col.cost)}${r}`, result: cost != null ? qty * cost : 0 };
      row.getCell(col.profit).value = { formula: `${L(col.saleAmt)}${r}-${L(col.costAmt)}${r}`, result: qty * sale - (cost != null ? qty * cost : 0) };
      row.getCell(col.rate).value = { formula: `IFERROR(${L(col.profit)}${r}/${L(col.saleAmt)}${r},0)`, result: qty * sale ? (qty * sale - (cost != null ? qty * cost : 0)) / (qty * sale) : 0 };
      row.getCell(col.rate).numFmt = FMT_PCT;
      row.getCell(col.nen).value = { formula: `${L(col.profit)}${r}*${PCT_REF}`, result: (qty * sale - (cost != null ? qty * cost : 0)) * pct };
      row.getCell(col.miu).value = { formula: `${L(col.profit)}${r}*(1-${PCT_REF})`, result: (qty * sale - (cost != null ? qty * cost : 0)) * (1 - pct) };
      row.getCell(col.remark).value = it.remark || '';
    }
    for (const c of [col.costAmt, col.saleAmt, col.profit, col.nen, col.miu]) row.getCell(c).numFmt = FMT_MONEY;
    for (let c = 1; c <= lastCol; c += 1) {
      row.getCell(c).border = BORDER;
      if (!row.getCell(c).font) row.getCell(c).font = FONT;
      if (it.consigned) row.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F4F6' } };
    }
  });
  const consignedSale = items.filter(it => it.consigned).reduce((a, it) => a + Number(it.qty || 0) * Number(it.price || 0), 0);

  // 합계행 — 결산 시트가 MATCH("합계") 로 찾음
  const tr = first + items.length;
  const trow = ws.getRow(tr);
  trow.getCell(col.name).value = '합계';
  const totals = recordTotals(items, pct);
  const sum = (c, result) => ({ formula: `SUM(${L(c)}${first}:${L(c)}${tr - 1})`, result: result ?? 0 });
  branches.forEach((b, bi) => { trow.getCell(col.branch0 + bi).value = sum(col.branch0 + bi, totals.branchQty[b] || 0); });
  trow.getCell(col.qty).value = sum(col.qty, totals.qty);
  trow.getCell(col.costAmt).value = sum(col.costAmt, totals.cost);
  trow.getCell(col.saleAmt).value = sum(col.saleAmt, totals.sale);
  trow.getCell(col.profit).value = sum(col.profit, totals.profit);
  trow.getCell(col.nen).value = sum(col.nen, totals.nen);
  trow.getCell(col.miu).value = sum(col.miu, totals.miu);
  // 이익율 분모 = 손익대상 매출(전체 매출 − 사입 매출). 사입 매출 셀(아래 라벨행)을 참조해 재계산 가능.
  const consignedCellRef = consignedSale > 0 ? `${L(col.saleAmt)}${tr + 1}` : null;
  trow.getCell(col.rate).value = {
    formula: consignedCellRef
      ? `IFERROR(${L(col.profit)}${tr}/(${L(col.saleAmt)}${tr}-${consignedCellRef}),0)`
      : `IFERROR(${L(col.profit)}${tr}/${L(col.saleAmt)}${tr},0)`,
    result: totals.rate,
  };
  trow.getCell(col.rate).numFmt = FMT_PCT;
  for (let c = 1; c <= lastCol; c += 1) {
    const cell = trow.getCell(c);
    cell.border = BORDER;
    cell.fill = TOTAL_FILL;
    cell.font = FONT_BOLD;
    if ([col.qty, col.costAmt, col.saleAmt, col.profit, col.nen, col.miu, col.branch0, col.branch0 + 1].includes(c)) cell.numFmt = FMT_MONEY;
  }

  // 사입 매출 라벨행 — 합계 이익율 수식이 참조 (SUMIF 로 항상 재계산: 적요에 '사입' 표기된 행의 매출액 합)
  if (consignedSale > 0) {
    const cr = tr + 1;
    ws.getCell(cr, col.name).value = '사입 매출(원산지 없음 — 매출 포함·손익 제외)';
    ws.getCell(cr, col.name).font = { ...FONT, italic: true, color: { argb: 'FF64748B' } };
    ws.getCell(cr, col.saleAmt).value = {
      formula: `SUMIF(${L(col.remark)}${first}:${L(col.remark)}${tr - 1},"사입*",${L(col.saleAmt)}${first}:${L(col.saleAmt)}${tr - 1})`,
      result: consignedSale,
    };
    ws.getCell(cr, col.saleAmt).numFmt = FMT_MONEY;
    ws.getCell(cr, col.saleAmt).font = { ...FONT, italic: true, color: { argb: 'FF64748B' } };
  }

  // 특이사항
  if (master.Note) {
    const nr = tr + 3;
    ws.getCell(nr, 1).value = '특이사항';
    ws.getCell(nr, 1).font = FONT_BOLD;
    ws.mergeCells(nr, 2, nr, col.rate);
    ws.getCell(nr, 2).value = master.Note;
    ws.getCell(nr, 2).font = FONT;
    ws.getCell(nr, 2).alignment = { wrapText: true };
  }

  // 열너비
  ws.getColumn(col.name).width = 26;
  ws.getColumn(col.unit).width = 6;
  branches.forEach((b, bi) => { ws.getColumn(col.branch0 + bi).width = 9; });
  for (const c of [col.qty, col.cost, col.sale]) ws.getColumn(c).width = 10;
  for (const c of [col.costAmt, col.saleAmt, col.profit, col.nen, col.miu]) ws.getColumn(c).width = 12;
  ws.getColumn(col.rate).width = 8;
  ws.getColumn(col.remark).width = 16;
  ws.views = [{ state: 'frozen', ySplit: 2 }];

  return { sheetName, totals, cols: { costAmt: L(col.costAmt), saleAmt: L(col.saleAmt), profit: L(col.profit), rate: L(col.rate), nen: L(col.nen), miu: L(col.miu) } };
}

// 결산 시트 — 차수별 합산 (각 차수 시트 합계행을 INDEX/MATCH 로 참조: 시트 수정 시 자동 반영)
function addSummarySheet(wb, records, refs) {
  const ws = wb.addWorksheet('결산');
  const year = records[0]?.master?.OrderYear || '';
  ws.mergeCells('A1:H1');
  ws.getCell('A1').value = `${year} 라움 손익 결산`;
  ws.getCell('A1').font = { ...FONT_BOLD, size: 13 };
  ws.getCell('A1').alignment = { horizontal: 'center', vertical: 'middle' };
  ws.getRow(1).height = 22;

  const heads = ['차수', '견적일', '총 매입', '총 매출(VAT별도)', '총 이익', '이익율', '네노바이익', '미우이익'];
  heads.forEach((h, i) => {
    const c = ws.getCell(2, i + 1);
    c.value = h;
    c.font = FONT_BOLD;
    c.fill = HEAD_FILL;
    c.border = BORDER;
    c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  });

  const first = 3;
  records.forEach((rec, i) => {
    const r = first + i;
    const ref = refs[i];
    const t = ref.totals;
    const sn = `'${ref.sheetName}'`;
    const idx = (colLetter, result) => ({ formula: `INDEX(${sn}!${colLetter}:${colLetter},MATCH("합계",${sn}!A:A,0))`, result: result ?? 0 });
    const row = ws.getRow(r);
    row.getCell(1).value = ref.sheetName;
    row.getCell(2).value = dateStr(rec.master.QuoteDate);
    row.getCell(3).value = idx(ref.cols.costAmt, t.cost);
    row.getCell(4).value = idx(ref.cols.saleAmt, t.sale);
    // 총이익·이익율은 각 차수 시트 합계행 참조 — 사입(손익 제외) 반영값. D−C 로 계산하면 사입 매출이 이익으로 섞임.
    row.getCell(5).value = idx(ref.cols.profit, t.profit);
    row.getCell(6).value = idx(ref.cols.rate, t.rate);
    row.getCell(7).value = idx(ref.cols.nen, t.nen);
    row.getCell(8).value = idx(ref.cols.miu, t.miu);
    for (let c = 1; c <= 8; c += 1) {
      const cell = row.getCell(c);
      cell.border = BORDER;
      cell.font = FONT;
      if (c >= 3 && c !== 6) cell.numFmt = FMT_MONEY;
      if (c === 6) cell.numFmt = FMT_PCT;
    }
  });

  const tr = first + records.length;
  const trow = ws.getRow(tr);
  trow.getCell(1).value = '합계';
  const g = (k) => refs.reduce((a, ref) => a + (ref.totals?.[k] || 0), 0);
  const grand = { cost: g('cost'), sale: g('sale'), profit: g('profit'), nen: g('nen'), miu: g('miu') };
  const grandVals = { 3: grand.cost, 4: grand.sale, 5: grand.profit, 7: grand.nen, 8: grand.miu };
  for (const c of [3, 4, 5, 7, 8]) {
    trow.getCell(c).value = { formula: `SUM(${ws.getColumn(c).letter}${first}:${ws.getColumn(c).letter}${tr - 1})`, result: grandVals[c] };
    trow.getCell(c).numFmt = FMT_MONEY;
  }
  // 손익대상 매출 = 총매입 + 총이익 (사입 제외 매출과 동치) — 이익율 분모로 사용
  trow.getCell(6).value = {
    formula: `IFERROR(E${tr}/(C${tr}+E${tr}),0)`,
    result: (grand.cost + grand.profit) > 0 ? grand.profit / (grand.cost + grand.profit) : 0,
  };
  trow.getCell(6).numFmt = FMT_PCT;
  for (let c = 1; c <= 8; c += 1) {
    trow.getCell(c).border = BORDER;
    trow.getCell(c).fill = TOTAL_FILL;
    trow.getCell(c).font = FONT_BOLD;
  }

  [8, 10, 13, 15, 13, 8, 13, 13].forEach((w, i) => { ws.getColumn(i + 1).width = w; });
}

/** records: [{ master, items }] — 차수 오름차순. 반환: xlsx Buffer */
export async function buildRaumPnlWorkbook(records) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'nenovaweb';
  wb.calcProperties.fullCalcOnLoad = true; // 열 때 전체 재계산 — 수식 결과 최신 보장
  const refs = records.map(rec => addWeekSheet(wb, rec));
  addSummarySheet(wb, records, refs);
  return Buffer.from(await wb.xlsx.writeBuffer());
}
