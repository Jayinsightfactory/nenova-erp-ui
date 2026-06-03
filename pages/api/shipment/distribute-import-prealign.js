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
  if (process.env.SHIPMENT_IMPORT_PREDISTRIBUTE_ENABLED !== 'true') {
    return res.status(409).json({
      success: false,
      error: '업로드 품종 일괄분배는 전산 nenova.exe의 usp_DistributeTotal/One/Clear 경로와 1:1 검증이 끝날 때까지 비활성화되었습니다. 먼저 검증하기로 변경분을 확인한 뒤 승인 후 주문등록+분배를 사용하세요.',
    });
  }

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
