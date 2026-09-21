// pages/api/work/drive.js
// 업무 드라이브 조회 API — 로그인 필요. 부서 접근 규칙(lib/workDrive.canView/canDownload)로 거른 목록·내려받기·교정.
// GET                 → { me, dept, isAdmin, stages, files[] }   (본인·부서·인수인계 범위만)
// GET ?download=<id>  → 파일 스트림 (내려받기 기록 남김)
// GET ?log=<id>       → 내려받기 기록 (사장만)
// POST { id, cycle?, stage?, deleted? } → 차수·단계 교정 / 숨김 (사장 또는 올린 본인)
import fs from 'fs';
import path from 'path';
import { withAuth } from '../../../lib/auth';
import { listVisible, getFile, reclassify, downloadLog, deptOfName, STAGES } from '../../../lib/workDrive';
import { isOrbitReportViewer } from '../../../lib/orbitReportAccess';

export default withAuth(async function handler(req, res) {
  const user = req.user;
  if (req.method === 'GET') {
    if (req.query.download) {
      const g = getFile(user, String(req.query.download));
      if (!g) return res.status(404).json({ success: false, error: '없거나 내려받기 권한이 없습니다' });
      res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(path.basename(g.row.filename))}`);
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Content-Length', String(g.row.size || fs.statSync(g.abs).size));
      return fs.createReadStream(g.abs).pipe(res);
    }
    if (req.query.log) return res.status(200).json({ success: true, log: downloadLog(user, String(req.query.log)) });
    const who = deptOfName(user.userName);
    return res.status(200).json({ success: true, me: who.name || user.userName || user.userId, dept: who.dept, isAdmin: isOrbitReportViewer(user), stages: STAGES, files: listVisible(user) });
  }
  if (req.method === 'POST') {
    const b = req.body || {};
    const r = reclassify(user, String(b.id || ''), b);
    return r.ok ? res.status(200).json({ success: true, item: r.item }) : res.status(r.status).json({ success: false, error: r.error });
  }
  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ success: false, error: 'Method not allowed' });
});
