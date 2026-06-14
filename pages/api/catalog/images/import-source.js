// POST — 카탈로그 원본(PPTX/XLSX/JSON)에서 이미지+품목명 추출 → ERP 매칭 등록

import fs from 'fs';
import path from 'path';
import formidable from 'formidable';
import { withAuth } from '../../../../lib/auth';
import { query } from '../../../../lib/db';
import { BULK_IMPORT_DIR } from '../../../../lib/catalogImageImport';
import { importCatalogSourceBuffer } from '../../../../lib/catalogSourceImport';
import { groupByProdKey, listImages } from '../../../../lib/catalogImages';

export const config = { api: { bodyParser: false } };

const MAX_SIZE = 80 * 1024 * 1024;
const SOURCE_EXT = ['.pptx', '.xlsx', '.xls', '.json', '.zip'];

async function loadProducts() {
  const r = await query(
    `SELECT ProdKey, ProdCode, ProdName, DisplayName, FlowerName, CounName FROM Product WHERE isDeleted=0`,
  );
  return r.recordset;
}

function listSourceFiles() {
  if (!fs.existsSync(BULK_IMPORT_DIR)) return [];
  const out = [];
  for (const ent of fs.readdirSync(BULK_IMPORT_DIR, { withFileTypes: true })) {
    if (!ent.isFile()) continue;
    const ext = ent.name.toLowerCase().slice(ent.name.lastIndexOf('.'));
    if (SOURCE_EXT.includes(ext)) out.push(path.join(BULK_IMPORT_DIR, ent.name));
  }
  return out;
}

export default withAuth(async function handler(req, res) {
  if (req.method === 'GET') {
    const pending = listSourceFiles();
    const images = listImages();
    return res.status(200).json({
      success: true,
      bulkImportDir: BULK_IMPORT_DIR,
      pendingSources: pending.map(p => path.basename(p)),
      registeredProducts: Object.keys(groupByProdKey(images)).length,
    });
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).end();
  }

  const products = await loadProducts();
  const uploadedBy = req.user?.userId || req.user?.userName || null;

  if (req.query.scan === '1') {
    const files = listSourceFiles();
    if (!files.length) {
      return res.status(400).json({
        success: false,
        error: `_bulk_import 폴더에 PPTX/XLSX/JSON 없음 (${BULK_IMPORT_DIR})`,
      });
    }
    const merged = { matched: [], skipped: [], unmatched: [], matchedCount: 0, sources: [] };
    for (const fp of files) {
      const buf = fs.readFileSync(fp);
      const r = await importCatalogSourceBuffer(buf, path.basename(fp), products, uploadedBy);
      merged.sources.push({ file: path.basename(fp), ...r });
      merged.matched.push(...r.matched);
      merged.skipped.push(...r.skipped);
      merged.unmatched.push(...r.unmatched);
      merged.matchedCount += r.matchedCount;
    }
    return res.status(200).json({ success: true, ...merged, message: `카탈로그 원본 ${merged.matchedCount}건 등록` });
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

  const name = file.originalFilename || 'upload.pptx';
  const ext = name.toLowerCase().slice(name.lastIndexOf('.'));
  if (!SOURCE_EXT.includes(ext)) {
    return res.status(400).json({ success: false, error: 'PPTX, XLSX, JSON, ZIP 만 지원합니다.' });
  }

  try {
    const buf = fs.readFileSync(file.filepath);
    const result = await importCatalogSourceBuffer(buf, name, products, uploadedBy);
    return res.status(200).json({
      success: true,
      ...result,
      message: `카탈로그에서 이미지 ${result.matchedCount}건 등록 (추출 ${result.extracted}건)`,
    });
  } catch (e) {
    return res.status(400).json({ success: false, error: e.message });
  } finally {
    try { fs.unlinkSync(file.filepath); } catch { /* ignore */ }
  }
});
