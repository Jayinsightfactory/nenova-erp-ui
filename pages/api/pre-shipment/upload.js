import fs from 'fs';
import formidable from 'formidable';
import XLSX from 'xlsx';
import { withAuth } from '../../../lib/auth.js';
import { createPreShipmentPlan } from '../../../lib/preShipment.js';
import { parsePreShipmentWorkbook } from '../../../lib/preShipmentWorkbook.js';

export const config = { api: { bodyParser: false } };
const first = value => Array.isArray(value) ? value[0] : value;

export default withAuth(async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed' });
  const form = formidable({ maxFileSize: 20 * 1024 * 1024, keepExtensions: true, multiples: false });
  let fields; let files;
  try {
    [fields, files] = await new Promise((resolve, reject) => form.parse(req, (error, f, x) => error ? reject(error) : resolve([f, x])));
  } catch (error) {
    return res.status(400).json({ success: false, error: `업로드 실패: ${error.message}` });
  }
  const file = first(files.file);
  if (!file) return res.status(400).json({ success: false, error: '엑셀 파일을 선택하세요.' });
  try {
    const fileName = String(file.originalFilename || '주광.xlsx');
    if (!/\.xlsx?$/i.test(fileName)) throw new Error('xlsx/xls 파일만 업로드할 수 있습니다.');
    const workbook = XLSX.read(fs.readFileSync(file.filepath), { type: 'buffer', cellDates: true });
    const parsed = parsePreShipmentWorkbook(XLSX, workbook);
    const saved = await createPreShipmentPlan({ parsed, orderYear: first(fields.orderYear), majorWeek: first(fields.majorWeek), fileName, user: req.user });
    return res.status(200).json({ success: true, ...saved, sheetName: parsed.sheetName, sourceSheetMajor: parsed.sheetMajor });
  } catch (error) {
    return res.status(error.statusCode || 400).json({ success: false, code: error.code, error: error.message });
  } finally {
    try { fs.unlinkSync(file.filepath); } catch {}
  }
});
