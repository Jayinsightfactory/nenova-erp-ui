// pages/api/work/drive-ingest.js
// 직원 PC 데몬(Orbit work-file-uploader)이 업무 파일을 자동 업로드하는 수신 API. 토큰 인증(로그인 아님).
// 토큰: ORBIT_DRIVE_INGEST_TOKEN (서버 env 전용, 독립 회전). 데몬은 Orbit 서버에서 이 토큰을 받아 쓴다.
// multipart: file + fields(orbitUserId, userName, hostname, dir, mtime, eventType). 저장·분류는 lib/workDrive(파일 전용, MSSQL 무관).
import fs from 'fs';
import crypto from 'crypto';
import formidable from 'formidable';
import { ingestFile, FILE_MAX } from '../../../lib/workDrive';
import { importRemitFile } from '../../../lib/farmRemitInbox';
import { REMIT_FILE_RE } from '../../../lib/farmRemitImport';

export const config = { api: { bodyParser: false } };

function tokenOk(req) {
  const want = process.env.ORBIT_DRIVE_INGEST_TOKEN || '';
  if (!want) return { ok: false, status: 503, error: 'ORBIT_DRIVE_INGEST_TOKEN 서버 미설정' };
  const auth = String(req.headers.authorization || '');
  const got = auth.replace(/^Bearer\s+/i, '').trim() || String(req.headers['x-orbit-ingest-token'] || '').trim();
  if (!got) return { ok: false, status: 401, error: '토큰 없음' };
  const a = Buffer.from(got), b = Buffer.from(want);
  const same = a.length === b.length && crypto.timingSafeEqual(a, b);
  return same ? { ok: true } : { ok: false, status: 401, error: '토큰 불일치' };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ success: false, error: 'Method not allowed' }); }
  const t = tokenOk(req);
  if (!t.ok) return res.status(t.status).json({ success: false, error: t.error });
  const form = formidable({ maxFileSize: FILE_MAX, keepExtensions: true, multiples: false });
  let fields, files;
  try { [fields, files] = await form.parse(req); } catch (e) { return res.status(413).json({ success: false, error: '업로드 파싱 실패: ' + e.message }); }
  const f = Array.isArray(files.file) ? files.file[0] : files.file;
  if (!f) return res.status(400).json({ success: false, error: 'file 필드 없음' });
  const pick = (k) => { const v = fields[k]; return Array.isArray(v) ? v[0] : v; };
  let buffer;
  try { buffer = fs.readFileSync(f.filepath); } finally { try { fs.unlinkSync(f.filepath); } catch {} }
  const r = ingestFile({ buffer, filename: pick('filename') || f.originalFilename, orbitUserId: pick('orbitUserId'), userName: pick('userName'), hostname: pick('hostname'), dir: pick('dir'), mtime: pick('mtime'), eventType: pick('eventType') });
  if (!r.ok) return res.status(r.status || 400).json({ success: false, error: r.error });
  // 송금 자동 인식: 경영지원의 '해외건별송금신청*.xlsx'가 올라오면 행을 읽어 농장 송금 대기함(WebFarmRemit PENDING)에 넣는다. 실패는 로그만(업로드는 성공 처리)
  let remit = null;
  const _fn = pick('filename') || f.originalFilename || '';
  if (!r.duplicate && REMIT_FILE_RE.test(_fn) && /\.xlsx?$/i.test(_fn)) {
    try { remit = await importRemitFile({ buffer, fileId: r.id, fileName: _fn, by: 'drive:' + (r.classification?.uploaderName || '') }); }
    catch (e) { console.error('[drive-ingest] remit import failed:', e.message); remit = { error: e.message }; }
  }
  return res.status(200).json({ success: true, id: r.id, duplicate: r.duplicate, version: r.version, classification: r.classification, remit });
}
