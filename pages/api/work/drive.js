// pages/api/work/drive.js
// 업무 드라이브 조회 API — 로그인 필요. 부서 접근 규칙(lib/workDrive.canView/canDownload)로 거른 목록·내려받기·교정.
// GET                 → { me, dept, isAdmin, stages, files[] }   (본인·부서·인수인계 범위만)
// GET ?download=<id>  → 파일 스트림 (내려받기 기록 남김)
// GET ?log=<id>       → 내려받기 기록 (사장만)
// POST { id, cycle?, stage?, deleted? } → 차수·단계 교정 / 숨김 (사장 또는 올린 본인)
// POST { action:'reclassifyAll' } → 규칙 변경 후 전체 재분류 (사장만, 손으로 고친 행 제외)
import fs from 'fs';
import path from 'path';
import { withAuth } from '../../../lib/auth';
import { listVisible, getFile, reclassify, reclassifyAll, downloadLog, deptOfName, STAGES } from '../../../lib/workDrive';
import { sendDriveListJson } from '../../../lib/workDriveListResponse.cjs';
import { readDriveListAsync, readDriveUsageAsync, readDrivePreviewAsync } from '../../../lib/workDriveListAsync.cjs';
import { isOrbitReportViewer } from '../../../lib/orbitReportAccess';
import { WORK_DRIVE_ADMIN_USER_IDS } from '../../../lib/workDrive';

export default withAuth(async function handler(req, res) {
  const user = req.user;
  if (req.method === 'GET') {
    // 새로고침해도 옛 목록이 보이던 문제(2026-09-28): ETag만 있고 Cache-Control이 없어 브라우저가 304로 옛 응답 재사용 → 항상 새로 받게
    res.setHeader('Cache-Control', 'no-store');
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
    const isAdmin = isOrbitReportViewer(user) || WORK_DRIVE_ADMIN_USER_IDS.includes(String(user.userId || '').trim());
    // usage(2026-11-09): 관리자에게만 실제 사용량(색인 최신행 기준 + 디스크 교차검증, 5GB 대비 %) — 507 용량 오판 재발 감시용
    if (req.query.usage === 'only') {
      if (!isAdmin) return res.status(403).json({success:false,error:'사용량 조회 권한이 없습니다.'});
      try { const snapshot=await readDriveUsageAsync();return res.status(200).json({success:true,usage:snapshot.usage}); }
      catch { res.setHeader('Retry-After','2');return res.status(503).json({success:false,error:'사용량을 확인하지 못했습니다. 파일 목록은 계속 사용할 수 있습니다.'}); }
    }
    if (req.query.format==='table-v1' && req.query.preview==='1') {
      try {
        const preview=await readDrivePreviewAsync(user);
        return sendDriveListJson(res,{success:true,me:who.name||user.userName||user.userId,dept:who.dept,isAdmin,stages:STAGES,files:preview.files,catalog:{complete:preview.totalFiles===preview.files.length,totalFiles:preview.totalFiles},...(isAdmin?{usage:null}:{})},{table:true});
      } catch {res.setHeader('Retry-After','2');return res.status(503).json({success:false,error:'최근 파일을 불러오지 못했습니다. 다시 시도해 주세요.'});}
    }
    const deferredUsage=req.query.format==='table-v1' && req.query.usage==='deferred';
    let snapshot,usage;
    try {
      [snapshot,usage]=await Promise.all([readDriveListAsync(),isAdmin&&!deferredUsage?readDriveUsageAsync():null]);
    }
    catch { res.setHeader('Retry-After','2');return res.status(503).json({success:false,error:'업무 파일 목록을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.'}); }
    return sendDriveListJson(res, { success: true, me: who.name || user.userName || user.userId, dept: who.dept, isAdmin, stages: STAGES, files: listVisible(user, snapshot.rows), ...(req.query.format==='table-v1'?{catalog:{complete:true}}:{}), ...(isAdmin ? { usage: usage?.usage ?? null } : {}) }, { table: req.query.format === 'table-v1' });
  }
  if (req.method === 'POST') {
    const b = req.body || {};
    if (b.action === 'reclassifyAll') { const r = reclassifyAll(user); return r.ok ? res.status(200).json({ success: true, ...r }) : res.status(r.status).json({ success: false, error: r.error }); }
    const r = reclassify(user, String(b.id || ''), b);
    return r.ok ? res.status(200).json({ success: true, item: r.item }) : res.status(r.status).json({ success: false, error: r.error });
  }
  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ success: false, error: 'Method not allowed' });
});
