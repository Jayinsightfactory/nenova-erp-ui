import { withAuth } from '../../../lib/auth';
import { isOrbitReportViewer } from '../../../lib/orbitReportAccess';
import { arrivalDriveStatus, saveArrivalDriveConfig, runArrivalDriveAuto } from '../../../lib/arrivalDriveAuto';

export default withAuth(async function handler(req, res) {
  if (!isOrbitReportViewer(req.user)) return res.status(403).json({ success: false, error: '관리자 전용입니다' });
  res.setHeader('Cache-Control', 'no-store');
  try {
    if (req.method === 'GET') return res.json({ success: true, ...arrivalDriveStatus() });
    if (req.method === 'POST') {
      if (req.body?.action === 'run-now') {
        if (req.body.confirm !== true) return res.status(400).json({ success: false, error: '선택 파일 즉시 처리 확인이 필요합니다' });
        await runArrivalDriveAuto({ selection: req.body.selection || {}, user: req.user });
        return res.json({ success: true, ...arrivalDriveStatus() });
      }
      if (req.body?.action) return res.status(400).json({ success: false, error: '지원하지 않는 작업입니다' });
      saveArrivalDriveConfig(req.body || {}, req.user);
      return res.json({ success: true, ...arrivalDriveStatus() });
    }
    res.setHeader('Allow', 'GET, POST'); return res.status(405).end();
  } catch (e) { return res.status(400).json({ success: false, error: e.message }); }
});
