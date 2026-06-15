// POST — 카달로그_통합본.pptx 서버 _bulk_import 저장 (자동 import용)

import fs from 'fs';
import path from 'path';
import formidable from 'formidable';
import { withAuth } from '../../../../lib/auth';
import { BULK_IMPORT_DIR } from '../../../../lib/catalogImageImport';

export const config = { api: { bodyParser: false } };

const MAX_SIZE = 80 * 1024 * 1024;
const TARGET_NAME = '카달로그_통합본.pptx';

export default withAuth(async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).end();
  }

  const form = formidable({ maxFileSize: MAX_SIZE, keepExtensions: true, multiples: false });
  let files;
  try {
    [, files] = await new Promise((resolve, reject) => {
      form.parse(req, (err, _f, fls) => (err ? reject(err) : resolve([_f, fls])));
    });
  } catch (e) {
    return res.status(400).json({ success: false, error: e.message });
  }

  const file = Array.isArray(files.file) ? files.file[0] : files.file;
  if (!file) return res.status(400).json({ success: false, error: 'file 필수' });

  const ext = (file.originalFilename || '').toLowerCase();
  if (!ext.endsWith('.pptx')) {
    return res.status(400).json({ success: false, error: 'PPTX만 지원' });
  }

  try {
    fs.mkdirSync(BULK_IMPORT_DIR, { recursive: true });
    const dest = path.join(BULK_IMPORT_DIR, TARGET_NAME);
    fs.copyFileSync(file.filepath, dest);
    const stat = fs.statSync(dest);
    return res.status(200).json({
      success: true,
      path: dest,
      fileName: TARGET_NAME,
      size: stat.size,
      message: `서버에 ${TARGET_NAME} 저장됨 — 다음 카탈로그 진입 시 자동 등록`,
    });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  } finally {
    try { fs.unlinkSync(file.filepath); } catch { /* ignore */ }
  }
});
