import { withAuth } from '../../../../lib/auth';
import { query } from '../../../../lib/db';
import {
  applyPackingExportBunches, assertPackingExportBunches, PACKING_EXPORT_MAX_BYTES, readPackingExport,
} from '../../../../lib/packingExportBunchGuard.js';

export const config = { api: { bodyParser: { sizeLimit: '720kb' } } };
const MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export default withAuth(async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.user?.accountActive === false) return res.status(403).json({ error: '비활성 계정입니다.' });
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: '지원하지 않는 요청입니다.' });
  }
  const { country, workbook, confirmations } = req.body || {};
  if (typeof workbook !== 'string' || workbook.length > Math.ceil(PACKING_EXPORT_MAX_BYTES / 3) * 4
      || !/^[A-Za-z0-9+/]+={0,2}$/.test(workbook)) {
    return res.status(400).json({ error: '검증할 패킹 엑셀 파일을 확인하세요.' });
  }
  try {
    const buffer = Buffer.from(workbook, 'base64');
    const rows = await readPackingExport(buffer, country);
    const { recordset } = await query(`SELECT ProdKey, ProdName, CounName, OutUnit, EstUnit, SteamOf1Bunch, BunchOf1Box
      FROM dbo.Product WHERE isDeleted = 0 AND NULLIF(LTRIM(RTRIM(ProdName)), '') IS NOT NULL`);
    const automatic = assertPackingExportBunches(rows, recordset, country, confirmations);
    const output = await applyPackingExportBunches(buffer, rows, automatic);
    res.setHeader('Content-Type', MIME);
    return res.status(200).send(output);
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      error: error.statusCode ? error.message : '전산 품목의 단위를 확인하지 못했습니다. 다시 시도하세요.',
      ...(error.issues ? {issues:error.issues} : {}),
    });
  }
});
