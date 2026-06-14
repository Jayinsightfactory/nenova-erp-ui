import formidable from 'formidable';
import fs from 'fs';
import path from 'path';
import { withAuth } from '../../../../lib/auth';
import {
  deleteImageRecord,
  loadIndex,
  pickExt,
  publicUrl,
  relPathFor,
  replaceImageFile,
  setPrimaryImage,
  ensureCatalogDirs,
} from '../../../../lib/catalogImages';

export const config = { api: { bodyParser: false } };

async function parseReplaceUpload(req) {
  const form = formidable({
    maxFileSize: 10 * 1024 * 1024,
    keepExtensions: true,
    multiples: false,
  });
  const [, files] = await new Promise((resolve, reject) => {
    form.parse(req, (err, flds, fls) => (err ? reject(err) : resolve([flds, fls])));
  });
  const file = Array.isArray(files.file) ? files.file[0] : files.file;
  if (!file) return null;
  const mime = file.mimetype || '';
  if (!mime.startsWith('image/')) {
    try { fs.unlinkSync(file.filepath); } catch { /* ignore */ }
    throw new Error('이미지 파일만 허용됩니다.');
  }
  return file;
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw.trim()) return {};
  return JSON.parse(raw);
}

export default withAuth(async function handler(req, res) {
  const { id } = req.query;
  if (!id) return res.status(400).json({ success: false, error: 'id 필요' });

  const data = loadIndex();
  const existing = data.images.find(i => i.id === id && !i.deleted);
  if (!existing && req.method !== 'DELETE') {
    return res.status(404).json({ success: false, error: '이미지를 찾을 수 없습니다.' });
  }

  if (req.method === 'PUT' || req.method === 'PATCH') {
    if (req.query.action === 'primary') {
      const image = setPrimaryImage(id);
      if (!image) return res.status(404).json({ success: false, error: 'not found' });
      return res.status(200).json({ success: true, image });
    }

    const contentType = req.headers['content-type'] || '';
    if (contentType.includes('application/json')) {
      try {
        const body = await readJsonBody(req);
        if (body.isPrimary) {
          const image = setPrimaryImage(id);
          if (!image) return res.status(404).json({ success: false, error: 'not found' });
          return res.status(200).json({ success: true, image });
        }
        return res.status(400).json({ success: false, error: '지원하지 않는 요청입니다.' });
      } catch (e) {
        return res.status(400).json({ success: false, error: e.message });
      }
    }

    try {
      const file = await parseReplaceUpload(req);
      if (!file) return res.status(400).json({ success: false, error: "'file' 필드 필요" });
      const ext = pickExt(file.originalFilename, file.mimetype || '');
      const rel = relPathFor(existing.prodKey, existing.id, ext);
      const dir = ensureCatalogDirs(existing.prodKey);
      const dest = path.join(dir, `${existing.id}${ext}`);
      try {
        fs.renameSync(file.filepath, dest);
      } catch {
        fs.copyFileSync(file.filepath, dest);
        try { fs.unlinkSync(file.filepath); } catch { /* ignore */ }
      }
      const stat = fs.statSync(dest);
      const image = replaceImageFile(id, {
        relPath: rel,
        url: publicUrl(rel),
        fileSize: stat.size,
      });
      return res.status(200).json({ success: true, image });
    } catch (e) {
      return res.status(400).json({ success: false, error: e.message });
    }
  }

  if (req.method === 'DELETE') {
    const removed = deleteImageRecord(id, { hard: true });
    if (!removed) return res.status(404).json({ success: false, error: 'not found' });
    return res.status(200).json({ success: true, id });
  }

  res.setHeader('Allow', 'PUT, PATCH, DELETE');
  return res.status(405).end();
});
