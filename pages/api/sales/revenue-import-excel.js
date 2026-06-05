// pages/api/sales/revenue-import-excel.js
// POST(멀티파트): ECOUNT 판매현황 다운로드 엑셀을 업로드 → 파싱 → 네노바웹 비교용 Batch 저장.
//
// 흐름(물량표 업로드와 동일한 방식):
//   1) 사용자가 ECOUNT 판매현황 화면에서 받은 엑셀을 업로드
//   2) 헤더 기반 파서로 원본 행 추출(거래처명/품목명/수량/단가/공급가액/부가세/합계/적요)
//   3) (연도/차수/지점) Batch로 저장 — 같은 키면 덮어씀(재업로드 = 갱신)
//   4) 저장 매핑 + 내장후보로 자동 매칭 적용
//   5) 비교표 요약 + 현재 Batch 원본/검토 리스트 반환
//
// ⚠️ ECOUNT 원본을 읽기만 한다(업로드된 파일 파싱). ECOUNT로의 쓰기/전송(push) 없음.

import fs from 'fs';
import formidable from 'formidable';
import XLSX from 'xlsx';
import { withAuth } from '../../../lib/auth';
import { withActionLog } from '../../../lib/withActionLog';
import { query } from '../../../lib/db';
import { parseEcountSalesAoa } from '../../../lib/salesRevenueExcel';
import { loadSalesRevenueMappings } from '../../../lib/salesRevenueMappings';
import { saveBatch, viewBatchRaw, buildSummary, buildCustomerDir } from '../../../lib/salesRevenueBatches';

export const config = {
  api: { bodyParser: false },
};

function firstVal(v) {
  return Array.isArray(v) ? v[0] : v;
}

async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'POST only' });
  }

  const form = formidable({ maxFileSize: 30 * 1024 * 1024, keepExtensions: true, multiples: false });

  let fields, files;
  try {
    [fields, files] = await new Promise((resolve, reject) => {
      form.parse(req, (err, flds, fls) => (err ? reject(err) : resolve([flds, fls])));
    });
  } catch (e) {
    return res.status(400).json({ success: false, error: `업로드 파싱 실패: ${e.message}` });
  }

  const file = firstVal(files.file);
  const salesYear = String(firstVal(fields.salesYear) || '').trim();
  const orderWeek = String(firstVal(fields.orderWeek) || '').trim();
  const channel = String(firstVal(fields.channel) || '양재동').trim();

  if (!file) return res.status(400).json({ success: false, error: 'file 필드 필요' });
  if (!salesYear || !orderWeek) {
    return res.status(400).json({ success: false, error: '조회연도(salesYear), 차수(orderWeek)를 입력하세요.' });
  }

  let parsed;
  try {
    const workbook = XLSX.readFile(file.filepath, { cellDates: false, cellNF: false, cellStyles: false });
    const sheetName = workbook.SheetNames[0];
    const ws = workbook.Sheets[sheetName];
    const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false, defval: null });
    parsed = parseEcountSalesAoa(aoa);
  } catch (e) {
    return res.status(400).json({ success: false, error: e.message });
  } finally {
    try { fs.unlinkSync(file.filepath); } catch {}
  }

  if (!parsed.rows.length) {
    return res.status(400).json({ success: false, error: '엑셀에서 판매 데이터 행을 찾지 못했습니다.' });
  }

  const mappings = loadSalesRevenueMappings(true);
  const saved = saveBatch(
    {
      sourceType: 'ecount_excel',
      salesYear,
      orderWeek,
      channel,
      dateFrom: parsed.dateFrom || '',
      dateTo: parsed.dateTo || '',
      fetchedBy: req.user?.userName || req.user?.userId || '',
      ecountEndpoint: 'excel-upload',
      fileName: file.originalFilename || 'upload.xlsx',
      apiStatus: 'success',
      memo: parsed.companyLine || '',
    },
    parsed.rows
  );

  const view = viewBatchRaw(saved, mappings);
  let customerDir = null;
  try {
    const r = await query(`SELECT CustKey, CustName, Manager FROM Customer WHERE isDeleted=0`);
    customerDir = buildCustomerDir(r.recordset);
  } catch { customerDir = null; }
  return res.status(200).json({
    success: true,
    fileName: file.originalFilename || 'upload.xlsx',
    rawCount: saved.rawCount,
    rawTotal: saved.rawTotal,
    period: { dateFrom: parsed.dateFrom, dateTo: parsed.dateTo },
    skipped: parsed.skipped,
    batch: view,
    summary: buildSummary({ channel, mappings, customerDir }),
    message: `판매현황 엑셀 ${saved.rawCount}건(합계 ${saved.rawTotal.toLocaleString()})을 ${salesYear}년 ${orderWeek}차로 저장하고 매칭을 적용했습니다.`,
  });
}

export default withAuth(withActionLog(handler, {
  actionType: 'SALES_REVENUE_IMPORT_EXCEL',
  affectedTable: 'data/sales-revenue-batches.json',
  riskLevel: 'LOW',
}));
