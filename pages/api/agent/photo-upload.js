// pages/api/agent/photo-upload.js
// 카카오워크 Bot 이미지 업로드용. multipart/form-data → public/uploads/photos/YYYY/MM/DD/uuid.ext
// 공개 URL 반환 (Next.js 가 public/ 을 루트에서 자동 서빙 → /uploads/photos/* 는 인증 없이 접근 가능)
// 보존 30일: 업로드마다 가볍게 오래된 파일 정리 (별도 cron 불필요)

import { withAuth } from '../../../lib/auth';
import formidable from 'formidable';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

export const config = {
  api: { bodyParser: false },
};

const PHOTOS_ROOT = path.join(process.cwd(), 'public', 'uploads', 'photos');
const MAX_FILE_SIZE = 20 * 1024 * 1024;      // 20MB
const RETENTION_MS = 30 * 24 * 60 * 60 * 1000; // 30일
const ALLOWED_EXT = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp']);

let _lastCleanupAt = 0;
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // 최대 시간당 1회

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function pickExt(originalName, mime) {
  const ext = (path.extname(originalName || '') || '').toLowerCase();
  if (ALLOWED_EXT.has(ext)) return ext;
  if (mime === 'image/png')  return '.png';
  if (mime === 'image/gif')  return '.gif';
  if (mime === 'image/webp') return '.webp';
  return '.jpg';
}

// 30일 초과 파일 정리 — 업로드 시점에 1시간 debounce 로 수행
function cleanupOldFilesAsync() {
  const now = Date.now();
  if (now - _lastCleanupAt < CLEANUP_INTERVAL_MS) return;
  _lastCleanupAt = now;
  setImmediate(() => {
    try {
      if (!fs.existsSync(PHOTOS_ROOT)) return;
      const cutoff = now - RETENTION_MS;
      walkAndPrune(PHOTOS_ROOT, cutoff);
    } catch (e) {
      console.warn('[photo-upload] cleanup 실패:', e.message);
    }
  });
}

function walkAndPrune(dir, cutoff) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
  catch { return; }
  for (const ent of entries) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      walkAndPrune(full, cutoff);
      // 빈 디렉토리 정리 (ROOT 자체는 제외)
      if (full !== PHOTOS_ROOT) {
        try {
          if (fs.readdirSync(full).length === 0) fs.rmdirSync(full);
        } catch {}
      }
    } else if (ent.isFile()) {
      try {
        const st = fs.statSync(full);
        if (st.mtimeMs < cutoff) fs.unlinkSync(full);
      } catch {}
    }
  }
}

async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const form = formidable({
    maxFileSize: MAX_FILE_SIZE,
    keepExtensions: true,
    multiples: false,
  });

  let fields, files;
  try {
    [fields, files] = await new Promise((resolve, reject) => {
      form.parse(req, (err, flds, fls) => err ? reject(err) : resolve([flds, fls]));
    });
  } catch (e) {
    return res.status(400).json({ error: `업로드 파싱 실패: ${e.message}` });
  }

  const file = Array.isArray(files.file) ? files.file[0] : files.file;
  if (!file) return res.status(400).json({ error: "'file' 필드 필요" });

  const mime = file.mimetype || '';
  if (!mime.startsWith('image/')) {
    try { fs.unlinkSync(file.filepath); } catch {}
    return res.status(400).json({ error: '이미지 파일만 허용' });
  }

  const now = new Date();
  const yyyy = String(now.getFullYear());
  const mm   = String(now.getMonth() + 1).padStart(2, '0');
  const dd   = String(now.getDate()).padStart(2, '0');
  const dir  = path.join(PHOTOS_ROOT, yyyy, mm, dd);
  ensureDir(dir);

  const ext = pickExt(file.originalFilename, mime);
  const uuid = crypto.randomUUID();
  const filename = `${uuid}${ext}`;
  const dest = path.join(dir, filename);

  try {
    fs.renameSync(file.filepath, dest);
  } catch {
    // 다른 볼륨이면 rename 실패 → copy + unlink
    fs.copyFileSync(file.filepath, dest);
    try { fs.unlinkSync(file.filepath); } catch {}
  }

  const room = (Array.isArray(fields.room) ? fields.room[0] : fields.room) || '';
  if (room) {
    try {
      fs.appendFileSync(
        path.join(PHOTOS_ROOT, '.upload.log'),
        `${now.toISOString()}\t${req.user?.userId || '-'}\t${room}\t/uploads/photos/${yyyy}/${mm}/${dd}/${filename}\t${file.size}\n`
      );
    } catch {}
  }

  cleanupOldFilesAsync();

  const protocol = req.headers['x-forwarded-proto'] || 'https';
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const url = `${protocol}://${host}/uploads/photos/${yyyy}/${mm}/${dd}/${filename}`;

  return res.status(200).json({ url });
}

export default withAuth(handler);
