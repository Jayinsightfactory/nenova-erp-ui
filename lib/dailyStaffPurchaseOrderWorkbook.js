import * as XLSXStyledModule from 'xlsx-js-style';
import { buildPurchaseOrderSheetRowsAoA } from './dailyStaffPurchaseOrder.js';

const XLSXStyled = XLSXStyledModule.utils ? XLSXStyledModule : XLSXStyledModule.default;

const FONT_NAME = '맑은 고딕';

const THIN_BORDER = {
  top: { style: 'thin', color: { rgb: 'CBD5E1' } },
  bottom: { style: 'thin', color: { rgb: 'CBD5E1' } },
  left: { style: 'thin', color: { rgb: 'CBD5E1' } },
  right: { style: 'thin', color: { rgb: 'CBD5E1' } },
};

const GROUP_TOP_BORDER = {
  ...THIN_BORDER,
  top: { style: 'medium', color: { rgb: '94A3B8' } },
};

const TOTAL_BORDER = {
  top: { style: 'medium', color: { rgb: '475569' } },
  bottom: { style: 'double', color: { rgb: '1E293B' } },
  left: { style: 'thin', color: { rgb: 'CBD5E1' } },
  right: { style: 'thin', color: { rgb: 'CBD5E1' } },
};

function estimateLineCount(text, colWidth) {
  const str = String(text || '');
  if (!str) return 1;
  const capacity = Math.max(10, colWidth - 4);
  return str.split(/\r?\n/).reduce((total, paragraph) => {
    let width = 0;
    let lines = 1;
    for (const ch of paragraph) {
      width += ch.charCodeAt(0) > 0x7f ? 2 : 1;
      if (width > capacity) {
        lines += 1;
        width = ch.charCodeAt(0) > 0x7f ? 2 : 1;
      }
    }
    return total + lines;
  }, 0);
}

export function buildPurchaseOrderWorkbook(model) {
  const wb = XLSXStyled.utils.book_new();
  const aoa = buildPurchaseOrderSheetRowsAoA(model);
  const ws = XLSXStyled.utils.aoa_to_sheet(aoa);

  const detailCount = model.detailRows.length;
  const summaryCount = model.customerSummaryRows.length;

  const titleRowIdx = 0;
  const detailHeaderRowIdx = 2;
  const detailStartIdx = 3;
  const detailTotalRowIdx = 3 + detailCount;
  const summaryTitleRowIdx = 5 + detailCount;
  const summaryHeaderRowIdx = 7 + detailCount;
  const summaryStartIdx = 8 + detailCount;
  const summaryTotalRowIdx = 8 + detailCount + summaryCount;

  ws['!cols'] = [
    { wch: 11 }, // A: No. / 거래처(요약)
    { wch: 28 }, // B: 거래처 / 품목 건수
    { wch: 18 }, // C: 품목(대분류) / 단순 수량 합계
    { wch: 34 }, // D: 상세품종 / 규격 / 주요 발주 내역 요약
    { wch: 13 }, // E: 수량
    { wch: 13 }, // F: 단위
    { wch: 32 }, // G: 비고 (차수 + 기존비고)
  ];

  const merges = [
    { s: { r: titleRowIdx, c: 0 }, e: { r: titleRowIdx, c: 6 } },
    { s: { r: detailTotalRowIdx, c: 0 }, e: { r: detailTotalRowIdx, c: 3 } },
    { s: { r: summaryTitleRowIdx, c: 0 }, e: { r: summaryTitleRowIdx, c: 6 } },
    { s: { r: summaryHeaderRowIdx, c: 3 }, e: { r: summaryHeaderRowIdx, c: 6 } },
    { s: { r: summaryTotalRowIdx, c: 3 }, e: { r: summaryTotalRowIdx, c: 6 } },
  ];
  for (let i = 0; i < summaryCount; i += 1) {
    const r = summaryStartIdx + i;
    merges.push({ s: { r, c: 3 }, e: { r, c: 6 } });
  }
  ws['!merges'] = merges;

  const rowsMeta = [];
  for (let r = 0; r <= summaryTotalRowIdx; r += 1) {
    if (r === titleRowIdx) rowsMeta[r] = { hpt: 32 };
    else if (r === 1 || r === detailTotalRowIdx + 1 || r === summaryTitleRowIdx + 1) rowsMeta[r] = { hpt: 12 };
    else if (r === detailHeaderRowIdx || r === summaryHeaderRowIdx) rowsMeta[r] = { hpt: 26 };
    else if (r === detailTotalRowIdx || r === summaryTotalRowIdx) rowsMeta[r] = { hpt: 25 };
    else if (r === summaryTitleRowIdx) rowsMeta[r] = { hpt: 26 };
    else if (r >= summaryStartIdx && r < summaryTotalRowIdx) {
      const summaryText = model.customerSummaryRows[r - summaryStartIdx]?.summaryText || '';
      const lines = estimateLineCount(summaryText, 88);
      rowsMeta[r] = { hpt: Math.max(22, Math.min(96, lines * 16 + 6)) };
    } else {
      rowsMeta[r] = { hpt: 21 };
    }
  }
  ws['!rows'] = rowsMeta;

  const setStyle = (r, c, style, numFmt) => {
    const ref = XLSXStyled.utils.encode_cell({ r, c });
    if (!ws[ref]) ws[ref] = { t: 's', v: '' };
    ws[ref].s = style;
    if (numFmt) ws[ref].z = numFmt;
  };

  for (let c = 0; c <= 6; c += 1) {
    setStyle(titleRowIdx, c, {
      font: { name: FONT_NAME, sz: 16, bold: true, color: { rgb: '0F172A' } },
      alignment: { horizontal: 'left', vertical: 'center' },
      border: { bottom: { style: 'medium', color: { rgb: '1E293B' } } },
    });
  }

  for (let c = 0; c <= 6; c += 1) {
    setStyle(detailHeaderRowIdx, c, {
      font: { name: FONT_NAME, sz: 11, bold: true, color: { rgb: 'FFFFFF' } },
      fill: { patternType: 'solid', fgColor: { rgb: '1E293B' } },
      alignment: { horizontal: c === 4 ? 'right' : (c === 0 || c === 5 ? 'center' : 'left'), vertical: 'center' },
      border: THIN_BORDER,
    });
  }

  for (let i = 0; i < detailCount; i += 1) {
    const r = detailStartIdx + i;
    const item = model.detailRows[i];
    const border = item.isNewCustomer && i > 0 ? GROUP_TOP_BORDER : THIN_BORDER;
    for (let c = 0; c <= 6; c += 1) {
      const horiz = c === 0 || c === 5 ? 'center' : c === 4 ? 'right' : 'left';
      const bold = (c === 1 && Boolean(item.customerDisplay)) || (c === 2 && Boolean(item.categoryDisplay));
      setStyle(
        r,
        c,
        {
          font: { name: FONT_NAME, sz: 10.5, bold, color: { rgb: '0F172A' } },
          fill: { patternType: 'solid', fgColor: { rgb: 'FFFFFF' } },
          alignment: { horizontal: horiz, vertical: 'center', wrapText: c === 3 || c === 6 },
          border,
        },
        c === 0 ? '#,##0' : c === 4 ? '#,##0.###' : undefined,
      );
    }
  }

  for (let c = 0; c <= 6; c += 1) {
    const horiz = c === 4 ? 'right' : c === 5 ? 'center' : 'left';
    setStyle(
      detailTotalRowIdx,
      c,
      {
        font: { name: FONT_NAME, sz: 10.5, bold: true, color: { rgb: c === 6 ? '475569' : '0F172A' } },
        fill: { patternType: 'solid', fgColor: { rgb: 'F1F5F9' } },
        alignment: { horizontal: horiz, vertical: 'center' },
        border: TOTAL_BORDER,
      },
      c === 4 ? '#,##0.###' : undefined,
    );
  }

  for (let c = 0; c <= 6; c += 1) {
    setStyle(summaryTitleRowIdx, c, {
      font: { name: FONT_NAME, sz: 13, bold: true, color: { rgb: '0F172A' } },
      alignment: { horizontal: 'left', vertical: 'center' },
      border: { bottom: { style: 'thin', color: { rgb: '64748B' } } },
    });
  }

  for (let c = 0; c <= 6; c += 1) {
    setStyle(summaryHeaderRowIdx, c, {
      font: { name: FONT_NAME, sz: 11, bold: true, color: { rgb: 'FFFFFF' } },
      fill: { patternType: 'solid', fgColor: { rgb: '334155' } },
      alignment: { horizontal: c === 1 || c === 2 ? 'right' : 'left', vertical: 'center' },
      border: THIN_BORDER,
    });
  }

  for (let i = 0; i < summaryCount; i += 1) {
    const r = summaryStartIdx + i;
    for (let c = 0; c <= 6; c += 1) {
      setStyle(
        r,
        c,
        {
          font: { name: FONT_NAME, sz: 10.5, bold: c === 0, color: { rgb: '0F172A' } },
          fill: { patternType: 'solid', fgColor: { rgb: i % 2 === 1 ? 'F8FAFC' : 'FFFFFF' } },
          alignment: { horizontal: c === 1 || c === 2 ? 'right' : 'left', vertical: 'center', wrapText: c >= 3 },
          border: THIN_BORDER,
        },
        c === 1 ? '#,##0' : c === 2 ? '#,##0.###' : undefined,
      );
    }
  }

  for (let c = 0; c <= 6; c += 1) {
    setStyle(
      summaryTotalRowIdx,
      c,
      {
        font: { name: FONT_NAME, sz: 10.5, bold: true, color: { rgb: '0F172A' } },
        fill: { patternType: 'solid', fgColor: { rgb: 'F1F5F9' } },
        alignment: { horizontal: c === 1 || c === 2 ? 'right' : 'left', vertical: 'center' },
        border: TOTAL_BORDER,
      },
      c === 1 ? '#,##0' : c === 2 ? '#,##0.###' : undefined,
    );
  }

  XLSXStyled.utils.book_append_sheet(wb, ws, '화훼 발주 내역서');
  return wb;
}

export function writePurchaseOrderWorkbookBuffer(model) {
  const wb = buildPurchaseOrderWorkbook(model);
  return XLSXStyled.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

export function downloadPurchaseOrderWorkbook(model) {
  const wb = buildPurchaseOrderWorkbook(model);
  XLSXStyled.writeFile(wb, model.filename || '화훼_발주_내역서.xlsx');
}
