// 영업수입불량차감 원본 엑셀 업로드 → 미리보기/자동매칭만 수행한다.
// 실제 웹 원장·Estimate 저장은 사용자가 페이지에서 저장/일괄 등록을 눌렀을 때만 수행한다.

import fs from 'node:fs';
import formidable from 'formidable';
import { withAuth } from '../../../lib/auth';
import { withActionLog } from '../../../lib/withActionLog';
import {
  loadMatchContext,
  matchSalesDefectRows,
} from '../../../lib/salesDefectDeductions.js';
import { parseSalesDefectWorkbook } from '../../../lib/salesDefectDeductionExcel.js';

export const config = { api: { bodyParser: false } };

function first(value) { return Array.isArray(value) ? value[0] : value; }

async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'POST만 지원합니다.' });
  const form = formidable({ maxFileSize: 15 * 1024 * 1024, keepExtensions: true, multiples: false });
  let fields;
  let files;
  try {
    [fields, files] = await new Promise((resolve, reject) => {
      form.parse(req, (error, parsedFields, parsedFiles) => error
        ? reject(error)
        : resolve([parsedFields, parsedFiles]));
    });
  } catch (error) {
    return res.status(400).json({ success: false, error: `엑셀 업로드 파싱 실패: ${error.message}` });
  }

  const file = first(files?.file);
  if (!file) return res.status(400).json({ success: false, error: 'file 필드가 필요합니다.' });
  const fileName = String(file.originalFilename || '').toLowerCase();
  if (!/\.(xlsx|xls)$/.test(fileName)) {
    try { fs.unlinkSync(file.filepath); } catch { /* ignore */ }
    return res.status(400).json({ success: false, error: 'xlsx 또는 xls 파일만 업로드할 수 있습니다.' });
  }

  try {
    const parsed = await parseSalesDefectWorkbook(fs.readFileSync(file.filepath));
    const context = await loadMatchContext();
    const rows = matchSalesDefectRows(parsed.rows, context).map((row) => ({
      ...row,
      sourceFileName: file.originalFilename || '',
    }));
    return res.status(200).json({
      success: true,
      sourceFileName: file.originalFilename || '',
      sheetName: parsed.sheetName,
      title: parsed.title,
      rows,
      summary: {
        total: rows.length,
        customerMatched: rows.filter((r) => r.custKey).length,
        productMatched: rows.filter((r) => r.prodKey).length,
        needsReview: rows.filter((r) => r.needsReview).length,
      },
    });
  } catch (error) {
    return res.status(400).json({ success: false, error: error.message });
  } finally {
    try { fs.unlinkSync(file.filepath); } catch { /* ignore */ }
  }
}

export default withAuth(withActionLog(handler, {
  actionType: 'SALES_DEFECT_DEDUCTION_UPLOAD',
  affectedTable: 'WebSalesDefectDeduction (preview only)',
  riskLevel: 'MEDIUM',
}));

