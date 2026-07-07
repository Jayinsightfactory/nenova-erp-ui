// pages/api/sales/weekly-shipment-excel.js
// 차수매출관리 — 스타일 엑셀 다운로드 (지표별 시트 + 상세 시트)
import XLSX from 'xlsx-js-style';
import { withAuth } from '../../../lib/auth';
import { aggregateWeeklySales } from '../../../lib/weeklyShipmentSales';

const METRIC_LABEL = { amount: '매출(공급가)', total: '합계(VAT포함)', qty: '출고수량' };
const FIX_LABEL = { all: '전체분배', fixed: '확정만', unfixed: '미확정만' };

const B = { style: 'thin', color: { rgb: 'D0D0D0' } };
const ALLB = { top: B, bottom: B, left: B, right: B };
const NUMFMT = '#,##0;[Red]-#,##0;-';
const stTitle = { font: { bold: true, sz: 13, color: { rgb: 'FFFFFF' } }, fill: { patternType: 'solid', fgColor: { rgb: '1565C0' } }, alignment: { horizontal: 'left', vertical: 'center' } };
const stHeader = { font: { bold: true, sz: 11 }, fill: { patternType: 'solid', fgColor: { rgb: 'E3F2FD' } }, alignment: { horizontal: 'center', vertical: 'center' }, border: ALLB };
const stText = { alignment: { horizontal: 'left', vertical: 'center' }, border: ALLB };
const stCountry = { font: { color: { rgb: '888888' }, sz: 10 }, alignment: { horizontal: 'left', vertical: 'center' }, border: ALLB };
const stNum = { alignment: { horizontal: 'right' }, border: ALLB, numFmt: NUMFMT };
const stNumBold = { font: { bold: true, color: { rgb: '1565C0' } }, alignment: { horizontal: 'right' }, border: ALLB, numFmt: NUMFMT };
const stSub = { font: { bold: true }, fill: { patternType: 'solid', fgColor: { rgb: 'F1F8E9' } }, alignment: { horizontal: 'right' }, border: ALLB, numFmt: NUMFMT };
const stSubLabel = { font: { bold: true }, fill: { patternType: 'solid', fgColor: { rgb: 'F1F8E9' } }, alignment: { horizontal: 'left' }, border: ALLB };
const stTot = { font: { bold: true, color: { rgb: 'FFFFFF' } }, fill: { patternType: 'solid', fgColor: { rgb: '37474F' } }, alignment: { horizontal: 'right' }, border: ALLB, numFmt: NUMFMT };
const stTotLabel = { font: { bold: true, color: { rgb: 'FFFFFF' } }, fill: { patternType: 'solid', fgColor: { rgb: '37474F' } }, alignment: { horizontal: 'left' }, border: ALLB };

const mv = (cell, metric) => (!cell ? 0 : metric === 'qty' ? cell.qty : metric === 'total' ? cell.total : cell.amount);

function buildPivotSheet(data, metric) {
  const weeks = data.weeks;
  const ncol = 2 + weeks.length + 1;
  const ws = {};
  const merges = [];
  let R = 0;
  const put = (r, c, v, s, t) => { ws[XLSX.utils.encode_cell({ r, c })] = { v, s, t: t || (typeof v === 'number' ? 'n' : 's') }; };

  // 제목
  put(R, 0, `차수매출관리 · ${METRIC_LABEL[metric]} · ${data.year}  ${data.from}~${data.to}  (${FIX_LABEL[data.fix] || ''})`, stTitle, 's');
  for (let c = 1; c < ncol; c++) put(R, c, '', stTitle, 's');
  merges.push({ s: { r: R, c: 0 }, e: { r: R, c: ncol - 1 } });
  R += 1;

  // 헤더
  put(R, 0, '국가', stHeader, 's');
  put(R, 1, '품종', stHeader, 's');
  weeks.forEach((w, i) => put(R, 2 + i, w, stHeader, 's'));
  put(R, 2 + weeks.length, '합계', stHeader, 's');
  R += 1;

  // 국가 그룹
  const groups = [];
  let cur = null;
  for (const row of data.rows) {
    if (!cur || cur.counName !== row.counName) { cur = { counName: row.counName, rows: [] }; groups.push(cur); }
    cur.rows.push(row);
  }
  for (const g of groups) {
    g.rows.forEach((row, idx) => {
      put(R, 0, idx === 0 ? g.counName : '', stCountry, 's');
      put(R, 1, row.countryFlower + (row.total.noPriceCnt > 0 ? '  ⚠단가미설정' : ''), stText, 's');
      weeks.forEach((w, i) => put(R, 2 + i, mv(row.byWeek[w], metric), stNum, 'n'));
      put(R, 2 + weeks.length, mv(row.total, metric), stNumBold, 'n');
      R += 1;
    });
    const ct = data.countryTotals[g.counName];
    put(R, 0, '', stSubLabel, 's');
    put(R, 1, `${g.counName} 소계`, stSubLabel, 's');
    weeks.forEach((w, i) => put(R, 2 + i, mv(ct.byWeek[w], metric), stSub, 'n'));
    put(R, 2 + weeks.length, mv(ct.total, metric), stSub, 'n');
    R += 1;
  }

  // 차수별 합계
  put(R, 0, '', stTotLabel, 's');
  put(R, 1, '차수별 합계', stTotLabel, 's');
  weeks.forEach((w, i) => put(R, 2 + i, mv(data.weekTotals[w], metric), stTot, 'n'));
  put(R, 2 + weeks.length, mv(data.grandTotal, metric), stTot, 'n');
  R += 1;

  ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: R - 1, c: ncol - 1 } });
  ws['!merges'] = merges;
  ws['!cols'] = [{ wch: 12 }, { wch: 28 }, ...weeks.map(() => ({ wch: 13 })), { wch: 15 }];
  ws['!rows'] = [{ hpx: 28 }, { hpx: 22 }];
  ws['!freeze'] = { xSplit: 2, ySplit: 2, topLeftCell: 'C3', activePane: 'bottomRight', state: 'frozen' };
  return ws;
}

function buildDetailSheet(data) {
  const header = ['차수', '국가', '품종', '건수', '출고수량', '공급가', '부가세', '합계(VAT포함)', '단가미설정건'];
  const ws = {};
  let R = 0;
  const put = (r, c, v, s, t) => { ws[XLSX.utils.encode_cell({ r, c })] = { v, s, t: t || (typeof v === 'number' ? 'n' : 's') }; };
  header.forEach((h, c) => put(R, c, h, stHeader, 's'));
  R += 1;
  for (const row of data.rows) {
    for (const w of data.weeks) {
      const cell = row.byWeek[w];
      if (!cell) continue;
      put(R, 0, w, stText, 's');
      put(R, 1, row.counName, stText, 's');
      put(R, 2, row.countryFlower, stText, 's');
      put(R, 3, cell.cnt, stNum, 'n');
      put(R, 4, cell.qty, stNum, 'n');
      put(R, 5, cell.amount, stNum, 'n');
      put(R, 6, cell.vat, stNum, 'n');
      put(R, 7, cell.total, stNum, 'n');
      put(R, 8, cell.noPriceCnt, stNum, 'n');
      R += 1;
    }
  }
  // 총계
  put(R, 0, '합계', stTotLabel, 's');
  put(R, 1, '', stTotLabel, 's');
  put(R, 2, '', stTotLabel, 's');
  put(R, 3, data.grandTotal.cnt, stTot, 'n');
  put(R, 4, data.grandTotal.qty, stTot, 'n');
  put(R, 5, data.grandTotal.amount, stTot, 'n');
  put(R, 6, data.grandTotal.vat, stTot, 'n');
  put(R, 7, data.grandTotal.total, stTot, 'n');
  put(R, 8, data.grandTotal.noPriceCnt, stTot, 'n');
  R += 1;
  ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: R - 1, c: header.length - 1 } });
  ws['!cols'] = [{ wch: 8 }, { wch: 12 }, { wch: 28 }, { wch: 7 }, { wch: 10 }, { wch: 14 }, { wch: 12 }, { wch: 15 }, { wch: 12 }];
  ws['!rows'] = [{ hpx: 22 }];
  ws['!freeze'] = { xSplit: 0, ySplit: 1, topLeftCell: 'A2', activePane: 'bottomLeft', state: 'frozen' };
  return ws;
}

export default withAuth(async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();
  try {
    const data = await aggregateWeeklySales({
      year: req.query.year, from: req.query.from, to: req.query.to, fix: req.query.fix,
    });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, buildPivotSheet(data, 'amount'), '매출(공급가)');
    XLSX.utils.book_append_sheet(wb, buildPivotSheet(data, 'total'), '합계(VAT포함)');
    XLSX.utils.book_append_sheet(wb, buildPivotSheet(data, 'qty'), '출고수량');
    XLSX.utils.book_append_sheet(wb, buildDetailSheet(data), '상세');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx', cellStyles: true });
    const fname = `차수매출_${data.year}_${data.from}-${data.to}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(fname)}`);
    return res.status(200).send(buf);
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});
