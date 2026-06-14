import fs from 'fs';
import path from 'path';
import { CATALOG_ROOT } from '../../../../lib/catalogImages';

const MIME = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
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

  const full = path.join(CATALOG_ROOT, ...parts);
  const normalized = path.resolve(full);
  if (!normalized.startsWith(path.resolve(CATALOG_ROOT))) {
    return res.status(400).end('bad path');
  }

  let stat;
  try { stat = fs.statSync(normalized); }
  catch { return res.status(404).end('not found'); }
  if (!stat.isFile()) return res.status(404).end('not found');

  const ext = path.extname(normalized).toLowerCase();
  res.setHeader('Content-Type', MIME[ext] || 'application/octet-stream');
  res.setHeader('Content-Length', stat.size);
  res.setHeader('Cache-Control', 'public, max-age=2592000, immutable');

  if (req.method === 'HEAD') return res.status(200).end();
  fs.createReadStream(normalized).pipe(res);
}

export const config = { api: { responseLimit: false } };
