import { withAuth } from '../../../lib/auth';
import { isOrbitReportViewer } from '../../../lib/orbitReportAccess';
import { arrivalDriveStatus, saveArrivalDriveConfig } from '../../../lib/arrivalDriveAuto';

export default withAuth(async function handler(req, res) {
  if (!isOrbitReportViewer(req.user)) return res.status(403).json({ success: false, error: '관리자 전용입니다' });
  res.setHeader('Cache-Control', 'no-store');
  try {
    if (req.method === 'GET') return res.json({ success: true, ...arrivalDriveStatus() });
    if (req.method === 'POST') {
      saveArrivalDriveConfig(req.body || {}, req.user);
      return res.json({ success: true, ...arrivalDriveStatus() });
    }
    res.setHeader('Allow', 'GET, POST'); return res.status(405).end();
  } catch (e) { return res.status(400).json({ success: false, error: e.message }); }
});
