import fs from 'fs';
import formidable from 'formidable';
import XLSX from 'xlsx';
import { withAuth } from '../../../lib/auth';
import { withActionLog } from '../../../lib/withActionLog';
import { parseAllocationWorkbook, buildImportPreview, preDistributeImportProductsToOrders } from '../../../lib/shipmentImport';

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
  if (!file) return res.status(400).json({ success: false, error: 'file 필드 필요' });
  if (!week) return res.status(400).json({ success: false, error: 'week 필요' });

  try {
    const workbook = XLSX.readFile(file.filepath, { cellDates: false, cellNF: false, cellStyles: false });
    const parsed = parseAllocationWorkbook(XLSX, workbook, { sourceName: file.originalFilename || 'upload.xlsx' });
    const preview = await buildImportPreview({ parsedRows: parsed.rows, rawWeek: week });
    const matchedRows = (preview.rows || []).filter(r => r.custKey && r.prodKey);
    const result = await preDistributeImportProductsToOrders({
      rawWeek: preview.week || week,
      rawYear: year,
      rows: matchedRows,
      user: req.user,
    });

    return res.status(200).json({
      ...result,
      affected: result.appliedCount || 0,
      fileName: file.originalFilename || 'upload.xlsx',
      unmatchedCount: (preview.unmatched || []).length,
      parseLogs: [...parsed.logs, ...preview.logs],
      logs: [
        ...result.logs,
        (preview.unmatched || []).length > 0
          ? `미매칭 ${(preview.unmatched || []).length}건은 사전분배 대상에서 제외됨`
          : '미매칭 없이 사전분배 대상 추출 완료',
      ],
    });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  } finally {
    try { fs.unlinkSync(file.filepath); } catch {}
  }
}

export default withAuth(withActionLog(handler, {
  actionType: 'SHIPMENT_IMPORT_PREDISTRIBUTE',
  affectedTable: 'ShipmentMaster/ShipmentDetail/ShipmentDate/ShipmentHistory',
  riskLevel: 'HIGH',
}));
