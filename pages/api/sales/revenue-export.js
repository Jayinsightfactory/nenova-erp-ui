// pages/api/sales/revenue-export.js
// GET: 매칭된 영업매출 비교 결과를 엑셀로 다운로드.
//   - 시트1 "차수별매출비교": 매출비교.xlsx와 동일한 2단 헤더 + 색상 + 숫자서식
//        제목 / (단위:원·작성일자·작성자) / [차수 그룹] / [전년·당년·성장률] / 업체 통용명 행
//   - 시트2 "원본매칭내역": 저장된 모든 Batch의 원본 행 + 매칭 통용명/상태
//
// query: channel, y1, y2, y3
// ⚠️ 읽기 전용. 저장된 Batch만 읽어 매핑 적용 후 엑셀로 만든다.
//
// 색상은 매출비교.xlsx의 테마색(accent3/1/4 lighter 80%)을 RGB로 변환해 그대로 사용:
//   차수 그룹 헤더 = 연녹색 EBF1DE, 전년/당년 = 연파랑 DCE6F2, 성장률 = 연보라 E6E0EC

import ExcelJS from 'exceljs';
import { withAuth } from '../../../lib/auth';
import { loadSalesRevenueMappings } from '../../../lib/salesRevenueMappings';
import { buildSummary, listBatches, viewBatchRaw } from '../../../lib/salesRevenueBatches';
import { COMPARE_WEEKS } from '../../../lib/salesRevenueConfig';

// 매출비교.xlsx 테마색(lighter 80%) → ARGB
const C_GROUP = 'FFEBF1DE'; // accent3 80% (연녹색) — 차수 그룹 헤더
const C_YEAR = 'FFDCE6F2';  // accent1 80% (연파랑) — 전년/당년
const C_GROWTH = 'FFE6E0EC'; // accent4 80% (연보라) — 성장률
const FMT_AMT = '#,##0';
const FMT_PCT = '0.0%';

const thin = { style: 'thin', color: { argb: 'FFBFBFBF' } };
const BORDER = { top: thin, left: thin, bottom: thin, right: thin };

function solid(argb) {
  return { type: 'pattern', pattern: 'solid', fgColor: { argb } };
}

function growthFrac(cur, prev) {
  if (!prev) return cur ? '신규' : null;
  return (cur - prev) / prev;
}

export default withAuth(async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ success: false, error: 'GET only' });

  const now = new Date();
  const cy = now.getFullYear();
  const { channel = null } = req.query;
  const y2 = String(req.query.y2 || cy - 1);
  const y3 = String(req.query.y3 || cy);
  const yy = s => `${String(s).slice(-2)}년`;
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const author = req.user?.userName || req.user?.userId || '';

  const mappings = loadSalesRevenueMappings();

  try {
    const summary = buildSummary({ channel, mappings });
    const weeks = summary.weeks && summary.weeks.length ? summary.weeks : COMPARE_WEEKS;
    const wb = new ExcelJS.Workbook();

    // ── 시트1: 차수별 매출 비교 (매출비교.xlsx 형태)
    const ws = wb.addWorksheet('차수별매출비교', { views: [{ state: 'frozen', xSplit: 2, ySplit: 4 }] });

    const groups = [...weeks.map(w => `${w}차`), '총매출'];
    const FIRST_DATA_COL = 3; // A=여백, B=업체 통용명, C~=데이터
    const lastCol = 2 + groups.length * 3;

    // 컬럼 너비
    ws.getColumn(1).width = 2;
    ws.getColumn(2).width = 18;
    for (let g = 0; g < groups.length; g++) {
      const base = FIRST_DATA_COL + g * 3;
      ws.getColumn(base).width = 13;
      ws.getColumn(base + 1).width = 13;
      ws.getColumn(base + 2).width = 9;
    }

    // 행1: 제목
    ws.mergeCells(1, 1, 1, lastCol);
    const title = ws.getCell(1, 1);
    title.value = `${channel || '전체'} ${y3}년 매출 비교내역`;
    title.font = { bold: true, size: 14 };
    title.alignment = { horizontal: 'center', vertical: 'middle' };
    ws.getRow(1).height = 30;

    // 행2: 단위/작성일자/작성자
    ws.getCell(2, 2).value = '단위:원';
    ws.getCell(2, Math.max(3, lastCol - 4)).value = `작성일자:${today}`;
    ws.getCell(2, lastCol - 1).value = `작성자:${author}`;

    // 행3~4: 2단 헤더
    ws.mergeCells(3, 2, 4, 2);
    const custHdr = ws.getCell(3, 2);
    custHdr.value = '업체 통용명';
    custHdr.font = { bold: true };
    custHdr.alignment = { horizontal: 'center', vertical: 'middle' };
    custHdr.fill = solid(C_GROUP);
    custHdr.border = BORDER;
    ws.getCell(4, 2).border = BORDER;

    for (let g = 0; g < groups.length; g++) {
      const base = FIRST_DATA_COL + g * 3;
      // 행3 그룹 헤더 (3칸 병합)
      ws.mergeCells(3, base, 3, base + 2);
      const gh = ws.getCell(3, base);
      gh.value = groups[g];
      gh.font = { bold: true };
      gh.alignment = { horizontal: 'center', vertical: 'middle' };
      gh.fill = solid(C_GROUP);
      for (let k = 0; k < 3; k++) ws.getCell(3, base + k).border = BORDER;
      // 행4 서브 헤더
      const subs = [{ t: yy(y2), c: C_YEAR }, { t: yy(y3), c: C_YEAR }, { t: '성장률', c: C_GROWTH }];
      subs.forEach((s, k) => {
        const cell = ws.getCell(4, base + k);
        cell.value = s.t;
        cell.font = { bold: true };
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
        cell.fill = solid(s.c);
        cell.border = BORDER;
      });
    }

    // 데이터 행
    let r = 5;
    for (const c of summary.customers) {
      const nameCell = ws.getCell(r, 2);
      nameCell.value = c.canonicalName;
      nameCell.font = { bold: true };
      nameCell.border = BORDER;

      let t2 = 0, t3 = 0;
      const writeTriple = (base, v2, v3) => {
        const a = ws.getCell(r, base);
        a.value = v2 || null; a.numFmt = FMT_AMT; a.border = BORDER;
        const b = ws.getCell(r, base + 1);
        b.value = v3 || null; b.numFmt = FMT_AMT; b.border = BORDER;
        const gcell = ws.getCell(r, base + 2);
        const gv = growthFrac(v3, v2);
        gcell.value = gv; gcell.numFmt = FMT_PCT; gcell.border = BORDER;
        gcell.fill = solid(C_GROWTH);
      };

      weeks.forEach((w, gi) => {
        const v2 = c.weeks?.[w]?.[y2]?.total || 0;
        const v3 = c.weeks?.[w]?.[y3]?.total || 0;
        t2 += v2; t3 += v3;
        writeTriple(FIRST_DATA_COL + gi * 3, v2, v3);
      });
      // 총매출 그룹
      writeTriple(FIRST_DATA_COL + weeks.length * 3, t2, t3);
      r++;
    }

    // ── 시트2: 원본 매칭 내역
    const ws2 = wb.addWorksheet('원본매칭내역', { views: [{ state: 'frozen', ySplit: 1 }] });
    const cols2 = [
      ['연도', 6], ['차수', 6], ['지점', 8], ['일자-No.', 14], ['거래처명', 24], ['통용명', 12], ['품목명', 22],
      ['수량', 8], ['단가(vat포함)', 13], ['공급가액', 13], ['부가세', 11], ['합계', 13], ['적요', 16], ['매칭상태', 9], ['소스', 14], ['파일', 20],
    ];
    ws2.columns = cols2.map(([h, w]) => ({ header: h, width: w }));
    const head2 = ws2.getRow(1);
    head2.font = { bold: true };
    head2.eachCell(cell => { cell.fill = solid('FFF2F2F2'); cell.border = BORDER; cell.alignment = { horizontal: 'center' }; });

    const batches = listBatches().filter(b => !channel || channel === '전체' || b.channel === channel);
    for (const b of batches) {
      const { raw } = viewBatchRaw(b, mappings);
      for (const rr of raw) {
        const row = ws2.addRow([
          b.salesYear, b.orderWeek, b.channel, rr.ecountDateNo, rr.ecountCustName, rr.canonicalName, rr.productName,
          rr.quantity, rr.unitPriceVatIncluded, rr.supplyAmount, rr.vat, rr.totalAmount, rr.remark, rr.mappingStatus,
          b.sourceType, b.fileName || '',
        ]);
        [9, 10, 11, 12].forEach(ci => { row.getCell(ci).numFmt = FMT_AMT; });
        row.getCell(8).numFmt = '#,##0';
      }
    }

    const buf = await wb.xlsx.writeBuffer();
    const fileName = `영업매출비교_${channel || '전체'}_${y3}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(fileName)}"`);
    res.setHeader('Content-Length', buf.byteLength);
    return res.status(200).send(Buffer.from(buf));
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});
