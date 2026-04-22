// pages/api/public/photo/[...path].js
// 런타임 업로드된 사진을 파일시스템에서 직접 스트리밍 (인증 없음).
// Next.js 16 은 public/ 을 빌드 시점에 고정하므로 런타임 파일은 서빙 안 됨.
// 이 라우트가 그 역할을 대신. next.config.js 의 rewrites 로 /uploads/photos/* → 여기로 매핑.

import fs from 'fs';
import path from 'path';

const PHOTOS_ROOT = path.join(process.cwd(), 'public', 'uploads', 'photos');

const MIME = {
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png':  'image/png',
  '.gif':  'image/gif',
  '.webp': 'image/webp',
};

export default function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    return res.status(405).end();
  }

  const parts = Array.isArray(req.query.path) ? req.query.path : [req.query.path];
  if (!parts || parts.some(p => !p || p.includes('..') || p.includes('\\'))) {
    return res.status(400).end('bad path');
  }

  const rel = parts.join('/');
  const full = path.join(PHOTOS_ROOT, rel);

  // PHOTOS_ROOT 밖으로 나가는 경로 차단
  const normalized = path.resolve(full);
  if (!normalized.startsWith(path.resolve(PHOTOS_ROOT))) {
    return res.status(400).end('bad path');
  }

  let stat;
  try { stat = fs.statSync(normalized); }
  catch { return res.status(404).end('not found'); }
  if (!stat.isFile()) return res.status(404).end('not found');

  const ext = path.extname(normalized).toLowerCase();
  const mime = MIME[ext] || 'application/octet-stream';

  res.setHeader('Content-Type', mime);
  res.setHeader('Content-Length', stat.size);
  res.setHeader('Cache-Control', 'public, max-age=2592000, immutable'); // 30일
  res.setHeader('Last-Modified', stat.mtime.toUTCString());

  if (req.method === 'HEAD') return res.status(200).end();

  fs.createReadStream(normalized).pipe(res);
}

export const config = {
  api: { responseLimit: false },
};
