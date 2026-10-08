import fs from 'fs';
import formidable from 'formidable';
import XLSX from 'xlsx';
import { withAuth } from '../../../lib/auth';
import { parseAllocationWorkbook, buildImportPreview } from '../../../lib/shipmentImport';
import { getEarlyShipmentExclusions } from '../../../lib/weekdayEarlyShipmentStore';
import { requireEarlyImportMode } from '../../../lib/weekdayEarlyShipmentImport';

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
    if (earlyImportMode === 'ORIGINAL_INCLUDES_EARLY' && Object.entries(customerOverrides).some(([label, choice]) =>
      choice === '__ignore__' && /선출고/.test(label))) {
      const error = new Error('선출고 원문 열을 제외했습니다. 파일 수량은 이미 선출고 제외 상태로 선택한 뒤 다시 검증하세요.');
      error.code = 'EARLY_IMPORT_PROVENANCE_CONFLICT';
      error.statusCode = 409;
      throw error;
    }
    const workbook = XLSX.readFile(file.filepath, { cellDates: false, cellNF: false, cellStyles: false });
    const parsed = parseAllocationWorkbook(XLSX, workbook, { sourceName: file.originalFilename || 'upload.xlsx' });
    const preview = await buildImportPreview({
      parsedRows: parsed.rows,
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
    return res.status(200).json({
      ...preview,
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
