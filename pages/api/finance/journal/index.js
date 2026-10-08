// GET /api/finance/journal — 전표현황(명세 §6, 읽기 전용)
//   ?dateFrom&dateTo&journalNo&journalType&custKey&custName&accountCode&dept&amountMin&amountMax&descr&approvedOnly=1&includeClosed=1&includeCancelled=1
//   &format=xlsx → Excel 다운로드(월별 소계·총계 행 포함)   &journalKey=N → 전표 1건 상세(라인 포함)
import ExcelJS from 'exceljs';
import { withAuth } from '../../../../lib/auth';
import { listJournals, getJournal } from '../../../../lib/voucherStore';
import { summarizeByMonth } from '../../../../lib/voucherJournal';

const flag = (v) => v === '1' || v === 'true';

export default withAuth(async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ success: false, error: 'GET only' });
  try {
    if (req.query.journalKey) {
      const j = await getJournal(req.query.journalKey);
      if (!j) return res.status(404).json({ success: false, error: '전표 없음' });
      return res.status(200).json({ success: true, journal: j });
    }
    const q = req.query || {};
    const r = await listJournals({ ...q, approvedOnly: flag(q.approvedOnly), includeClosed: flag(q.includeClosed), includeCancelled: flag(q.includeCancelled) });
    const summary = summarizeByMonth(r.rows);
    if (q.format === 'xlsx') return sendExcel(res, r.rows, summary, q);
    return res.status(200).json({ success: true, rows: r.rows, count: r.count, byMonth: summary.byMonth, grand: summary.grand });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

async function sendExcel(res, rows, summary, q) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('전표현황');
  ws.columns = [
    { header: '일자-No.', key: 'no', width: 14 }, { header: '거래유형', key: 'type', width: 12 }, { header: '합계', key: 'amt', width: 16 },
    { header: '거래처명', key: 'cust', width: 24 }, { header: '계정', key: 'acc', width: 28 }, { header: '부서', key: 'dept', width: 12 },
    { header: '적요', key: 'descr', width: 40 }, { header: '결재상태', key: 'st', width: 10 }, { header: '전표상태', key: 'jst', width: 10 },
  ];
  ws.getRow(1).font = { bold: true };
  const bold = { bold: true };
  let curYm = null;
  const flush = (ym) => {
    const m = summary.byMonth.find((x) => x.ym === ym);
    if (!m) return;
    const r = ws.addRow({ no: `${ym} 월계`, amt: m.total });
    r.font = bold; r.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEBF1DE' } };
  };
  for (const j of rows) {
    const ym = j.journalDate.slice(0, 7);
    if (curYm && ym !== curYm) flush(curYm);
    curYm = ym;
    ws.addRow({ no: `${j.journalDate} ${j.journalNo}`, type: j.journalType, amt: j.totalDebit, cust: j.custName, acc: j.accounts, dept: j.depts, descr: j.descr, st: j.voucherStatus || '', jst: j.status });
  }
  if (curYm) flush(curYm);
  const g = ws.addRow({ no: '총계', amt: summary.grand });
  g.font = bold; g.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDCE6F2' } };
  ws.getColumn('amt').numFmt = '#,##0';
  const buf = await wb.xlsx.writeBuffer();
  const fileName = `전표현황_${q.dateFrom || ''}_${q.dateTo || ''}.xlsx`;
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(fileName)}"`);
  res.setHeader('Content-Length', buf.byteLength);
  return res.status(200).send(Buffer.from(buf));
}
