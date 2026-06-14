import formidable from 'formidable';
import fs from 'fs';
import path from 'path';
import { withAuth } from '../../../../lib/auth';
import {
  addImageRecord,
  ensureCatalogDirs,
  groupByProdKey,
  listImages,
  newImageId,
  pickExt,
  publicUrl,
  relPathFor,
} from '../../../../lib/catalogImages';

export const config = { api: { bodyParser: false } };

const MAX_FILE_SIZE = 10 * 1024 * 1024;

async function parseUpload(req) {
  const form = formidable({
    maxFileSize: MAX_FILE_SIZE,
    keepExtensions: true,
    multiples: false,
  });
  const [fields, files] = await new Promise((resolve, reject) => {
    form.parse(req, (err, flds, fls) => (err ? reject(err) : resolve([flds, fls])));
  });
  const file = Array.isArray(files.file) ? files.file[0] : files.file;
  const prodKeyRaw = Array.isArray(fields.prodKey) ? fields.prodKey[0] : fields.prodKey;
  const prodKey = parseInt(prodKeyRaw, 10);
  if (!prodKey || prodKey <= 0) throw new Error('prodKey(품목키)가 필요합니다.');
  if (!file) throw new Error("'file' 필드가 필요합니다.");
  const mime = file.mimetype || '';
  if (!mime.startsWith('image/')) {
    try { fs.unlinkSync(file.filepath); } catch { /* ignore */ }
    throw new Error('이미지 파일만 허용됩니다.');
  }
  return { file, prodKey };
}

async function saveUploadedFile(file, prodKey) {
  const ext = pickExt(file.originalFilename, file.mimetype || '');
  const imageId = newImageId();
  const rel = relPathFor(prodKey, imageId, ext);
  const dir = ensureCatalogDirs(prodKey);
  const dest = path.join(dir, `${imageId}${ext}`);

  try {
    fs.renameSync(file.filepath, dest);
  } catch {
    fs.copyFileSync(file.filepath, dest);
    try { fs.unlinkSync(file.filepath); } catch { /* ignore */ }
  }

  const stat = fs.statSync(dest);
  return { rel, url: publicUrl(rel), fileSize: stat.size, imageId };
}

export default withAuth(async function handler(req, res) {
  if (req.method === 'GET') {
    const { prodKey, prodKeys } = req.query;
    let keys = [];
    if (prodKeys) keys = String(prodKeys).split(',').map(s => s.trim()).filter(Boolean);
    const images = listImages({
      prodKey: prodKey || undefined,
      prodKeys: keys.length ? keys : undefined,
    });
    return res.status(200).json({
      success: true,
      images,
      byProdKey: groupByProdKey(images),
    });
  }

  if (req.method === 'POST') {
    try {
      const { file, prodKey } = await parseUpload(req);
      const saved = await saveUploadedFile(file, prodKey);
      const image = addImageRecord({
        id: saved.imageId,
        prodKey,
        relPath: saved.rel,
        url: saved.url,
        fileSize: saved.fileSize,
        uploadedBy: req.user?.userId || req.user?.userName || null,
      });
      return res.status(200).json({ success: true, image });
    } catch (e) {
      return res.status(400).json({ success: false, error: e.message });
    }
  }

  res.setHeader('Allow', 'GET, POST');
  return res.status(405).end();
});
