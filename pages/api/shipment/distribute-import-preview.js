import fs from 'fs';
import formidable from 'formidable';
import XLSX from 'xlsx';
import { withAuth } from '../../../lib/auth';
import { parseAllocationWorkbook, buildImportPreview } from '../../../lib/shipmentImport';
import { getEarlyShipmentExclusions } from '../../../lib/weekdayEarlyShipmentStore';
import { requireEarlyImportMode } from '../../../lib/weekdayEarlyShipmentImport';
import { createReplacementPlan } from '../../../lib/shipmentReplacementPlan.js';
import { mirrorWebUpload } from '../../../lib/workDrive';
import { buildFarmImportPreview } from '../../../lib/shipmentFarmImport';
import { planFarmWorkbook, signFarmExport } from '../../../lib/shipmentFarmWorkbook';
import { fieldVolumePlan, farmWorkbookReadiness } from '../../../lib/shipmentFieldVolume';
import { readFarmDrawingText } from '../../../lib/shipmentFarmDrawing';
import { FARM_SHEET } from '../../../lib/shipmentFarmText';

export const config = {
  api: { bodyParser: false },
};

async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed' });

  const form = formidable({
    maxFileSize: 30 * 1024 * 1024,
    keepExtensions: true,
    multiples: false,
  });

  let fields, files;
  try {
    [fields, files] = await new Promise((resolve, reject) => {
      form.parse(req, (err, flds, fls) => (err ? reject(err) : resolve([flds, fls])));
    });
  } catch (e) {
    return res.status(400).json({ success: false, error: `업로드 파싱 실패: ${e.message}` });
  }

  const file = Array.isArray(files.file) ? files.file[0] : files.file;
  const week = Array.isArray(fields.week) ? fields.week[0] : fields.week;
  const year = Array.isArray(fields.year) ? fields.year[0] : fields.year;
  const requestedMode = Array.isArray(fields.earlyImportMode) ? fields.earlyImportMode[0] : fields.earlyImportMode;
  const rawOverrides = Array.isArray(fields.customerOverrides) ? fields.customerOverrides[0] : fields.customerOverrides;
  const rawProdOverrides = Array.isArray(fields.productOverrides) ? fields.productOverrides[0] : fields.productOverrides;
  let customerOverrides = {};
  let productOverrides = {};
  if (rawOverrides) {
    try { customerOverrides = JSON.parse(rawOverrides) || {}; } catch {}
  }
  if (rawProdOverrides) {
    try { productOverrides = JSON.parse(rawProdOverrides) || {}; } catch {}
  }
  if (!file) return res.status(400).json({ success: false, error: 'file 필드 필요' });
  if (!week) return res.status(400).json({ success: false, error: 'week 필요' });

  try {
    const earlyImportMode = requireEarlyImportMode(requestedMode);
    const field = key => Array.isArray(fields[key]) ? fields[key][0] : fields[key];
    const farmText = String(field('farmText') || '');
    if (farmText.length > 100000) throw Object.assign(new Error('농장분배 텍스트는 10만 자 이내로 입력하세요.'), { statusCode: 400 });
    const farmOverrides = JSON.parse(field('farmOverrides') || '{}');
    if (earlyImportMode === 'ORIGINAL_INCLUDES_EARLY' && Object.entries(customerOverrides).some(([label, choice]) =>
      choice === '__ignore__' && /선출고/.test(label))) {
      const error = new Error('선출고 원문 열을 제외했습니다. 파일 수량은 이미 선출고 제외 상태로 선택한 뒤 다시 검증하세요.');
      error.code = 'EARLY_IMPORT_PROVENANCE_CONFLICT';
      error.statusCode = 409;
      throw error;
    }
    mirrorWebUpload({ filepath: file.filepath, filename: file.originalFilename, user: req.user, source: 'shipment/distribute-import-preview' });
    const workbook = XLSX.readFile(file.filepath, { cellDates: false, cellNF: false, cellStyles: false });
    // Only the new workbook's visible contents determine the scope.
    const parsed = parseAllocationWorkbook(XLSX, workbook);
    const preview = await buildImportPreview({
      parsedRows: parsed.rows,
      fileBasedScope: true,
      rawWeek: week,
      rawYear: year,
      earlyImportMode,
      earlyExclusionLoader: getEarlyShipmentExclusions,
      customerOverrides,
      productOverrides,
      custKeysInScope: parsed.custKeysInScope,
      prodKeysInScope: parsed.prodKeysInScope,
      pairKeysInScope: parsed.pairKeysInScope,
    });
    const original = fs.readFileSync(file.filepath);
    const isXlsx = /\.xlsx$/i.test(file.originalFilename || '');
    const drawingFarmText = isXlsx && !workbook.Sheets[FARM_SHEET] ? await readFarmDrawingText(original) : '';
    await buildFarmImportPreview({ XLSX, workbook, preview, text: farmText, overrides: farmOverrides });
    const exportLayout = isXlsx ? await planFarmWorkbook(original, preview.rows) : {
      entries: [], patches: [], errors: preview.rows.some(r=>r.farmSource) ? ['농장분배 원본 보존 다운로드는 .xlsx 파일을 사용하세요.'] : [],
    };
    preview.farmImport.layoutErrors = exportLayout.errors.map(message=>`원본 보존 다운로드: ${message} 신형 현장물량표는 별도 양식으로 생성합니다.`);
    // Original print-space limits affect only the optional original-layout download.
    // For XLSX, valid farm assignments can be saved and printed in the new layout.
    const readiness = farmWorkbookReadiness({isXlsx,farmErrors:preview.farmImport.errors,layoutErrors:exportLayout.errors,unmatched:preview.unmatched});
    const exportPlan = readiness.canExportOriginal ? signFarmExport(original, exportLayout, req.user.userId) : null;
    // New layout does not require free space in the original print area.
    let fieldPlan = null, fieldExportError = '';
    if (readiness.canPrepareField) {
      try { fieldPlan = await fieldVolumePlan(original, preview); }
      catch (error) { fieldExportError = error.message; }
    }
    const fieldExportReady = !!fieldPlan && preview.rows.every(r =>
      Math.abs(Number(r.currentOutQty || 0)-Number(r.uploadQty || 0))<0.000001 && !r.farmChanged && !Number(r.shipmentDateIssueCount || 0));
    return res.status(200).json({
      ...preview,
      replacementPlan: readiness.canApplyFarm ? createReplacementPlan(preview, req.user.userId) : null,
      exportPlan,
      fieldExportPlan: fieldPlan ? signFarmExport(original, fieldPlan, req.user.userId) : null,
      fieldExportReady,
      fieldExportError,
      drawingFarmText,
      fileName: file.originalFilename || 'upload.xlsx',
      logs: [...parsed.logs, ...preview.logs],
    });
  } catch (e) {
    return res.status(e.statusCode || 500).json({ success: false, error: e.message, code: e.code || '' });
  } finally {
    try { fs.unlinkSync(file.filepath); } catch {}
  }
}

export default withAuth(handler);
