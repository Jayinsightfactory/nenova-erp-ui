// POST — 이미지 일괄 업로드 (multipart 다중 파일) | ?scan=1 — 서버 _bulk_import 폴더 스캔

import fs from 'fs';
import formidable from 'formidable';
import { withAuth } from '../../../../lib/auth';
import { query } from '../../../../lib/db';
import {
  BULK_IMPORT_DIR,
  listBulkImportFiles,
  runBulkImport,
} from '../../../../lib/catalogImageImport';
import { groupByProdKey, listImages } from '../../../../lib/catalogImages';

export const config = { api: { bodyParser: false } };

const MAX_FILE_SIZE = 15 * 1024 * 1024;
const MAX_FILES = 400;

async function loadProducts() {
  const r = await query(
    `SELECT ProdKey, ProdCode, ProdName, DisplayName FROM Product WHERE isDeleted=0`,
  );
  return r.recordset;
}

export default withAuth(async function handler(req, res) {
  if (req.method === 'GET') {
    fs.mkdirSync(BULK_IMPORT_DIR, { recursive: true });
    const pending = listBulkImportFiles();
    const images = listImages();
    return res.status(200).json({
      success: true,
      bulkImportDir: BULK_IMPORT_DIR,
      pendingFiles: pending.length,
      registeredProducts: Object.keys(groupByProdKey(images)).length,
      totalImages: images.length,
    });
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).end();
  }

  const products = await loadProducts();
  const uploadedBy = req.user?.userId || req.user?.userName || null;

  if (req.query.scan === '1') {
    fs.mkdirSync(BULK_IMPORT_DIR, { recursive: true });
    const files = listBulkImportFiles();
    if (!files.length) {
      return res.status(400).json({
        success: false,
        error: `_bulk_import 폴더에 이미지가 없습니다. (${BULK_IMPORT_DIR})`,
        bulkImportDir: BULK_IMPORT_DIR,
      });
    }
    const result = runBulkImport(products, files, { uploadedBy, fromScan: true });
    return res.status(200).json({ success: true, ...result, source: 'scan' });
  }

  const form = formidable({
    multiples: true,
    maxFileSize: MAX_FILE_SIZE,
    maxFiles: MAX_FILES,
    keepExtensions: true,
  });

  let files;
  try {
    [, files] = await new Promise((resolve, reject) => {
      form.parse(req, (err, _f, fls) => (err ? reject(err) : resolve([_f, fls])));
    });
  } catch (e) {
    return res.status(400).json({ success: false, error: `업로드 실패: ${e.message}` });
  }

  const fileList = [];
  const push = (f) => {
    if (Array.isArray(f)) f.forEach(push);
    else if (f) fileList.push(f);
  };
  push(files.file);
  push(files.files);

  if (!fileList.length) {
    return res.status(400).json({ success: false, error: '이미지 파일을 선택하세요.' });
  }

  const result = runBulkImport(products, fileList, { uploadedBy });
  for (const f of fileList) {
    try { fs.unlinkSync(f.filepath); } catch { /* temp cleanup */ }
  }

  return res.status(200).json({
    success: true,
    ...result,
    source: 'upload',
    message: `이미지 ${result.matchedCount}건 등록`,
  });
});
