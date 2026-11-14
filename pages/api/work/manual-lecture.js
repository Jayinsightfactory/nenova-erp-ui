// pages/api/work/manual-lecture.js
// 수입부 인수인계 매뉴얼의 강의형 설명 영상 내보내기 — 로그인한 직원만.
//   GET ?id=<매뉴얼id>  → video/mp4 (이어 받기 Range 지원)
// 영상에는 실제 업무 화면 그림이 들어 있어 저장소·공개 폴더에 두지 않는다. 사장님 PC 가 올린 갱신본
// (import-lecture-<매뉴얼id>: { generatedAt, mp4: base64 })을 처음 요청 때 한 번 풀어 data/runtime 에 두고 그 파일을 보낸다.
import fs from 'fs';
import path from 'path';
import { withAuth } from '../../../lib/auth';
import { featureFilePath } from '../../../lib/workFeatureData';

function lectureFile(id) {
  if (!/^[a-z0-9-]{3,60}$/.test(id)) return null;
  const src = featureFilePath(`import-lecture-${id}`);
  if (!src || !fs.existsSync(src)) return null;
  const st = fs.statSync(src);
  const out = path.join(path.dirname(src), `lecture-${id}-${Math.round(st.mtimeMs)}.mp4`);
  if (!fs.existsSync(out)) {
    const j = JSON.parse(fs.readFileSync(src, 'utf8'));
    if (typeof j?.mp4 !== 'string' || !j.mp4) return null;
    const tmp = `${out}.tmp`;
    fs.writeFileSync(tmp, Buffer.from(j.mp4, 'base64'));
    fs.renameSync(tmp, out);
    // 예전에 풀어 둔 같은 매뉴얼의 영상은 지운다
    for (const f of fs.readdirSync(path.dirname(out))) if (f.startsWith(`lecture-${id}-`) && f.endsWith('.mp4') && f !== path.basename(out)) { try { fs.unlinkSync(path.join(path.dirname(out), f)); } catch { /* 쓰는 중이면 다음에 */ } }
  }
  return out;
}

export default withAuth(async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.setHeader('Allow', 'GET, HEAD'); return res.status(405).json({ success: false, error: 'Method not allowed' }); }
  let file = null;
  try { file = lectureFile(String(req.query.id || '')); } catch { file = null; }
  if (!file) return res.status(404).json({ success: false, error: '이 매뉴얼의 강의 영상이 아직 없습니다' });
  const size = fs.statSync(file).size;
  res.setHeader('Content-Type', 'video/mp4');
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Cache-Control', 'private, max-age=600');
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range || ''));
  if (m && (m[1] || m[2])) {
    let start = m[1] ? parseInt(m[1], 10) : Math.max(0, size - parseInt(m[2], 10));
    let end = m[1] && m[2] ? parseInt(m[2], 10) : size - 1;
    if (!(start >= 0) || start >= size) { res.setHeader('Content-Range', `bytes */${size}`); return res.status(416).end(); }
    end = Math.min(end, size - 1);
    res.status(206);
    res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
    res.setHeader('Content-Length', end - start + 1);
    if (req.method === 'HEAD') return res.end();
    return fs.createReadStream(file, { start, end }).pipe(res);
  }
  res.status(200);
  res.setHeader('Content-Length', size);
  if (req.method === 'HEAD') return res.end();
  return fs.createReadStream(file).pipe(res);
});

export const config = { api: { responseLimit: false } };
