// pages/api/public/desktop-releases/[...path].js
// Cafe24 자체 정적 데스크톱 업데이트 피드(/desktop-releases/*) — 무인증·읽기 전용 스트리밍.
// GitHub Private 전환 후에도 직원 PC 네노바 데스크톱앱이 추가 비용 0원으로 자동 업데이트되도록
// 배포 디렉터리 밖 영구 경로(/var/lib/nenova/desktop-releases)에서 직접 스트리밍한다.
import fs from 'fs';
import {
  getReleasesDir,
  isAllowedReleaseFile,
  contentTypeFor,
  cacheControlFor,
  resolveReleaseFilePath,
  parseLatestYml,
} from '../../../../lib/desktopReleases.cjs';

function parseByteRange(rangeHeader, totalSize) {
  if (typeof rangeHeader !== 'string' || !rangeHeader.startsWith('bytes=')) return null;
  const spec = rangeHeader.slice(6).trim();
  if (!spec || spec.includes(',')) return { invalid: true };
  const match = spec.match(/^(\d*)-(\d*)$/);
  if (!match || (!match[1] && !match[2])) return { invalid: true };

  let start;
  let end;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return { invalid: true };
    start = Math.max(0, totalSize - suffix);
    end = totalSize - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Number(match[2]) : totalSize - 1;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= totalSize) {
      return { invalid: true };
    }
    end = Math.min(end, totalSize - 1);
  }
  return { start, end };
}

export default function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    return res.status(405).end();
  }

  const parts = Array.isArray(req.query.path) ? req.query.path : [req.query.path];
  if (!parts || parts.length !== 1 || typeof parts[0] !== 'string') {
    return res.status(400).end('bad path');
  }

  const name = parts[0];
  const rootDir = getReleasesDir();

  // /desktop-releases/latest → latest.yml에 검증된 최신 설치 파일로 302 리다이렉트
  if (name === 'latest') {
    const latestFile = resolveReleaseFilePath(rootDir, 'latest.yml');
    try {
      const parsed = parseLatestYml(fs.readFileSync(latestFile, 'utf8'));
      const exePath = parsed ? resolveReleaseFilePath(rootDir, parsed.url) : null;
      if (!parsed || !exePath || !fs.statSync(exePath).isFile()) {
        return res.status(404).end('not found');
      }
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Location', `/desktop-releases/${parsed.url}`);
      return res.status(302).end();
    } catch {
      return res.status(404).end('not found');
    }
  }

  if (!isAllowedReleaseFile(name)) {
    return res.status(400).end('bad path');
  }

  const fullPath = resolveReleaseFilePath(rootDir, name);
  if (!fullPath) return res.status(400).end('bad path');

  let stat;
  try {
    stat = fs.statSync(fullPath);
  } catch {
    return res.status(404).end('not found');
  }
  if (!stat.isFile()) return res.status(404).end('not found');

  res.setHeader('Content-Type', contentTypeFor(name));
  res.setHeader('Cache-Control', cacheControlFor(name));
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Last-Modified', stat.mtime.toUTCString());
  if (name.endsWith('.exe')) {
    res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
  }

  const range = parseByteRange(req.headers.range, stat.size);
  if (range?.invalid) {
    res.setHeader('Content-Range', `bytes */${stat.size}`);
    return res.status(416).end();
  }

  const start = range ? range.start : 0;
  const end = range ? range.end : Math.max(0, stat.size - 1);
  const length = stat.size === 0 ? 0 : end - start + 1;

  if (range) {
    res.status(206);
    res.setHeader('Content-Range', `bytes ${start}-${end}/${stat.size}`);
  } else {
    res.status(200);
  }
  res.setHeader('Content-Length', length);

  if (req.method === 'HEAD' || length === 0) return res.end();

  const stream = fs.createReadStream(fullPath, { start, end });
  stream.on('error', () => {
    if (!res.headersSent) res.status(500).end();
    else res.destroy();
  });
  res.on('close', () => stream.destroy());
  stream.pipe(res);
}

export const config = {
  api: { responseLimit: false },
};
