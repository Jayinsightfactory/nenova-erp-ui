// pages/api/sales/revenue-export.js
// GET: 매칭된 영업매출 비교 결과를 엑셀로 다운로드 — 매출비교.xlsx 와 동일한 "월별 시트" 구성.
//   - 월별 시트(1월~6월 등): 그 달의 차수 + 월총매출 + 현재까지매출총합, 각 [전년/당년/성장률]
//        절대 차수 매핑: 1월=1~4, 2월=5~8, 3월=9~13, 4월=14~17, 5월=18~21, 6월=22~26 (MONTH_WEEK_GROUPS)
//   - 마지막 시트 "원본매칭내역": 저장된 모든 Batch 원본 행 + 매칭 통용명/상태
//
// query: channel, y2(전년), y3(당년)
// ⚠️ 읽기 전용. 저장된 Batch/seed/override 만 읽어 매핑 적용 후 엑셀로 만든다.
//
// 색상은 매출비교.xlsx 테마색(accent3/1/4 lighter 80%)을 RGB로 변환해 그대로 사용.

import ExcelJS from 'exceljs';
import { withAuth } from '../../../lib/auth';
import { loadSalesRevenueMappings } from '../../../lib/salesRevenueMappings';
import { buildSummary, listBatches, viewBatchRaw } from '../../../lib/salesRevenueBatches';
import { MONTH_WEEK_GROUPS } from '../../../lib/salesRevenueConfig';

// 매출비교.xlsx 테마색(lighter 80%) → ARGB
const C_GROUP = 'FFEBF1DE'; // accent3 80% (연녹색) — 차수/월 그룹 헤더
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
    const weeksSet = new Set(summary.weeks || []);
    // 데이터가 있는 월만 시트로(없으면 전체 월)
    let monthGroups = MONTH_WEEK_GROUPS.filter(g => g.weeks.some(w => weeksSet.has(w)));
    if (monthGroups.length === 0) monthGroups = MONTH_WEEK_GROUPS;

    const wb = new ExcelJS.Workbook();

    // 업체별 누적(현재까지 매출총합) — 월 순서대로 더해간다.
    const cumPrev = {};
    const cumCur = {};

    for (const mg of monthGroups) {
      const ws = wb.addWorksheet(`${mg.month}월`, { views: [{ state: 'frozen', xSplit: 2, ySplit: 4 }] });
      const wkRange = `${mg.weeks[0]}~${mg.weeks[mg.weeks.length - 1]}주차`;

      // 컬럼 그룹: 그 달 차수들 + 월총매출 + 현재까지매출총합 (각 3칸: 전년/당년/성장률)
      const colGroups = [
        ...mg.weeks.map(w => ({ label: `${w}차`, type: 'week', week: w })),
        { label: `${mg.month}월 총매출`, type: 'monthTotal' },
        { label: '현재까지 매출총합', type: 'cumTotal' },
      ];
      const FIRST = 3;
      const lastCol = 2 + colGroups.length * 3;

      // 컬럼 너비
      ws.getColumn(1).width = 2;
      ws.getColumn(2).width = 18;
      for (let g = 0; g < colGroups.length; g++) {
        const base = FIRST + g * 3;
        ws.getColumn(base).width = 13;
        ws.getColumn(base + 1).width = 13;
        ws.getColumn(base + 2).width = 9;
      }

      // 행1 제목
      ws.mergeCells(1, 1, 1, lastCol);
      const title = ws.getCell(1, 1);
      title.value = `${channel || '양재동'} ${mg.month}월(${wkRange}) 매출 비교내역`;
      title.font = { bold: true, size: 14 };
      title.alignment = { horizontal: 'center', vertical: 'middle' };
      ws.getRow(1).height = 30;

      // 행2 단위/작성일자/작성자
      ws.getCell(2, 2).value = '단위:원';
      ws.getCell(2, Math.max(3, lastCol - 4)).value = `작성일자:${today}`;
      ws.getCell(2, lastCol - 1).value = `작성자:${author}`;

      // 행3~4 2단 헤더
      ws.mergeCells(3, 2, 4, 2);
      const custHdr = ws.getCell(3, 2);
      custHdr.value = '업체 통용명';
      custHdr.font = { bold: true };
      custHdr.alignment = { horizontal: 'center', vertical: 'middle' };
      custHdr.fill = solid(C_GROUP);
      custHdr.border = BORDER;
      ws.getCell(4, 2).border = BORDER;

      colGroups.forEach((cg, gi) => {
        const base = FIRST + gi * 3;
        ws.mergeCells(3, base, 3, base + 2);
        const gh = ws.getCell(3, base);
        gh.value = cg.label;
        gh.font = { bold: true };
        gh.alignment = { horizontal: 'center', vertical: 'middle' };
        gh.fill = solid(C_GROUP);
        for (let k = 0; k < 3; k++) ws.getCell(3, base + k).border = BORDER;
        const subs = [{ t: yy(y2), c: C_YEAR }, { t: yy(y3), c: C_YEAR }, { t: '성장률', c: C_GROWTH }];
        subs.forEach((s, k) => {
          const cell = ws.getCell(4, base + k);
          cell.value = s.t;
          cell.font = { bold: true };
          cell.alignment = { horizontal: 'center', vertical: 'middle' };
          cell.fill = solid(s.c);
          cell.border = BORDER;
        });
      });

      // 데이터 행
      let r = 5;
      for (const c of summary.customers) {
        const nameCell = ws.getCell(r, 2);
        nameCell.value = c.canonicalName;
        nameCell.font = { bold: true };
        nameCell.border = BORDER;

        const writeTriple = (base, v2, v3) => {
          const a = ws.getCell(r, base);
          a.value = v2 || null; a.numFmt = FMT_AMT; a.border = BORDER;
          const b = ws.getCell(r, base + 1);
          b.value = v3 || null; b.numFmt = FMT_AMT; b.border = BORDER;
          const gcell = ws.getCell(r, base + 2);
          gcell.value = growthFrac(v3, v2); gcell.numFmt = FMT_PCT; gcell.border = BORDER;
          gcell.fill = solid(C_GROWTH);
        };

        let mt2 = 0, mt3 = 0;
        colGroups.forEach((cg, gi) => {
          const base = FIRST + gi * 3;
          if (cg.type === 'week') {
            const v2 = c.weeks?.[cg.week]?.[y2]?.total || 0;
            const v3 = c.weeks?.[cg.week]?.[y3]?.total || 0;
            mt2 += v2; mt3 += v3;
            writeTriple(base, v2, v3);
          } else if (cg.type === 'monthTotal') {
            writeTriple(base, mt2, mt3);
          } else { // cumTotal — 이 달 총매출을 누적에 더한 뒤 기록
            cumPrev[c.canonicalName] = (cumPrev[c.canonicalName] || 0) + mt2;
            cumCur[c.canonicalName] = (cumCur[c.canonicalName] || 0) + mt3;
            writeTriple(base, cumPrev[c.canonicalName], cumCur[c.canonicalName]);
          }
        });
        r++;
      }
    }

    // ── 마지막 시트: 원본 매칭 내역
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
    const fileName = `영업매출비교_${channel || '양재동'}_${y3}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(fileName)}"`);
    res.setHeader('Content-Length', buf.byteLength);
    return res.status(200).send(Buffer.from(buf));
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});
