// POST multipart — 확정 "매출원가 양식" 엑셀을 업로드해 해당 차수 웹 보고서와 셀 단위 대조.
// 규칙 분류(26~31차 확정 대조 체계) + LLM(claude-haiku-4-5) 소견. 키 없으면 규칙 요약만 반환.
import fs from 'fs';
import formidable from 'formidable';
import * as XLSX from 'xlsx';
import { withAuth } from '../../../lib/auth';
import { resolveActiveOrderYear } from '../../../lib/orderUtils';
import { loadReportData, parseMajor } from './profit-report';
import { computeProfitRow, computeProfitTotals } from '../../../lib/profitReportCalc';
import {
  parseProfitWorkbookSheet, diffProfitReportAgainstWorkbook,
  formatRuleBasedSummary, buildExcelAuditOpinion,
} from '../../../lib/profitReportExcelAudit';

export const config = { api: { bodyParser: false } };
const MAX_FILE_SIZE = 30 * 1024 * 1024;

function first(value) { return Array.isArray(value) ? value[0] : value; }

export default withAuth(async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).end();
  }
  const form = formidable({ maxFileSize: MAX_FILE_SIZE, keepExtensions: true, multiples: false });
  let fields;
  let files;
  try {
    [fields, files] = await new Promise((resolve, reject) => {
      form.parse(req, (error, parsedFields, parsedFiles) => (error ? reject(error) : resolve([parsedFields, parsedFiles])));
    });
  } catch (error) {
    return res.status(400).json({ success: false, error: `업로드 실패: ${error.message}` });
  }
  const file = first(files.file);
  if (!file) return res.status(400).json({ success: false, error: 'file 필드가 필요합니다.' });
  const fileName = String(file.originalFilename || 'profit-report.xlsx');
  try {
    if (!/\.(xlsx|xlsm|xls)$/i.test(fileName)) {
      return res.status(400).json({ success: false, error: 'xlsx/xlsm/xls 파일만 업로드할 수 있습니다.' });
    }
    const major = parseMajor(first(fields.week));
    if (!major) return res.status(400).json({ success: false, error: 'week 필요 (예: 31)' });
    const orderYear = resolveActiveOrderYear(`${major}-01`, first(fields.year));

    const workbook = XLSX.read(fs.readFileSync(file.filepath), { type: 'buffer' });
    const parsed = parseProfitWorkbookSheet(workbook);
    if (!Object.keys(parsed.rows).length) {
      return res.status(400).json({
        success: false,
        error: `'${parsed.sheetName}' 시트에서 본표(품명 헤더)를 찾지 못했습니다. 매출원가 양식 원본인지 확인하세요.`,
      });
    }

    const data = await loadReportData(major, orderYear);
    const webRows = (data.rows || []).map((row) => ({ ...row, calc: computeProfitRow(row) }));
    const webTotals = computeProfitTotals(webRows);
    const { diffs, totalDiffs, counts } = diffProfitReportAgainstWorkbook({
      webRows, webTotals, workbookRows: parsed.rows, workbookTotal: parsed.total,
    });
    const ruleSummary = formatRuleBasedSummary({ major, diffs, totalDiffs, counts });
    const llm = await buildExcelAuditOpinion({ major, diffs, totalDiffs, counts });

    return res.status(200).json({
      success: true,
      major,
      orderYear,
      fileName,
      sheetName: parsed.sheetName,
      categoriesCompared: Object.keys(parsed.rows).length,
      counts,
      diffs,
      totalDiffs,
      ruleSummary,
      llmOpinion: llm?.opinion || null,
      llmModel: llm?.model || null,
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  } finally {
    try { fs.unlinkSync(file.filepath); } catch { /* 임시파일 정리 실패 무시 */ }
  }
});
