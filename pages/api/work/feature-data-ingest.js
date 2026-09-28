// pages/api/work/feature-data-ingest.js
// /my-work 탭2 데이터(기능 후보·스토리보드) 자동 갱신 수신 — 사장님 PC 예약 작업(nenova-work-features/run-all.sh)이 매일 올린다.
// 토큰 인증(로그인 아님): ORBIT_DRIVE_INGEST_TOKEN (업무 드라이브 수신과 같은 서버 전용 토큰). 파일 전용 저장(lib/workFeatureData), MSSQL 무관.
// multipart: file + name(proposals|storyboards)
import fs from 'fs';
import crypto from 'crypto';
import formidable from 'formidable';
import { saveFeatureFile, FEATURE_MAX } from '../../../lib/workFeatureData';

export const config = { api: { bodyParser: false } };

function tokenOk(req) {
  const want = process.env.ORBIT_DRIVE_INGEST_TOKEN || '';
  if (!want) return { ok: false, status: 503, error: 'ORBIT_DRIVE_INGEST_TOKEN 서버 미설정' };
  const got = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim() || String(req.headers['x-orbit-ingest-token'] || '').trim();
  if (!got) return { ok: false, status: 401, error: '토큰 없음' };
  const a = Buffer.from(got), b = Buffer.from(want);
  return a.length === b.length && crypto.timingSafeEqual(a, b) ? { ok: true } : { ok: false, status: 401, error: '토큰 불일치' };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ success: false, error: 'Method not allowed' }); }
  const t = tokenOk(req);
  if (!t.ok) return res.status(t.status).json({ success: false, error: t.error });
  const form = formidable({ maxFileSize: FEATURE_MAX, multiples: false });
  let fields, files;
  try { [fields, files] = await form.parse(req); } catch (e) { return res.status(413).json({ success: false, error: '업로드 파싱 실패: ' + e.message }); }
  const f = Array.isArray(files.file) ? files.file[0] : files.file;
  if (!f) return res.status(400).json({ success: false, error: 'file 필드 없음' });
  const name = String((Array.isArray(fields.name) ? fields.name[0] : fields.name) || '');
  let buffer;
  try { buffer = fs.readFileSync(f.filepath); } finally { try { fs.unlinkSync(f.filepath); } catch {} }
  const r = saveFeatureFile(name, buffer);
  if (!r.ok) return res.status(r.status).json({ success: false, error: r.error });
  return res.status(200).json({ success: true, ...r });
}
