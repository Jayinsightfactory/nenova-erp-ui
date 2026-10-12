import fs from 'fs';
import formidable from 'formidable';
import { withAuth } from '../../../lib/auth.js';
import { parseWeekdayEstimateBuffer } from '../../../lib/weekdayEstimateWorkbook.js';

export const config = { api: { bodyParser: false } };
const MAX_FILE_SIZE = 30 * 1024 * 1024;
const first = (value) => (Array.isArray(value) ? value[0] : value);

export default withAuth(async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).end();
  }

  let files;
  try {
    [, files] = await new Promise((resolve, reject) => {
      formidable({ maxFileSize: MAX_FILE_SIZE, keepExtensions: true, multiples: false })
        .parse(req, (error, fields, parsedFiles) => error ? reject(error) : resolve([fields, parsedFiles]));
    });
  } catch (error) {
    return res.status(400).json({ success: false, error: `업로드 파일을 읽지 못했습니다: ${error.message}` });
  }

  const file = first(files?.file);
  if (!file) return res.status(400).json({ success: false, error: '엑셀 파일을 선택하세요.' });
  const fileName = String(file.originalFilename || '');
  try {
    if (!/\.(xlsx|xls)$/i.test(fileName)) return res.status(400).json({ success: false, error: 'xlsx 또는 xls 파일만 지원합니다.' });
    const parsed = parseWeekdayEstimateBuffer(fs.readFileSync(file.filepath), { fileName });
    return res.status(200).json({ success: true, ...parsed });
  } catch (error) {
    return res.status(400).json({ success: false, error: error.message });
  } finally {
    try { fs.unlinkSync(file.filepath); } catch {}
  }
});
