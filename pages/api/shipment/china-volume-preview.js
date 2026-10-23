import { withAuth } from '../../../lib/auth';
import { previewDutchVolume } from './dutch-volume-preview';

export const config = { api: { bodyParser: { sizeLimit: '10mb' } } };
export const previewChinaVolume = (body, user, deps = {}) => previewDutchVolume(body, user, { ...deps, country: '중국' });

export default withAuth(async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ success: false });
  try { return res.status(200).json(await previewChinaVolume(req.body, req.user)); }
  catch (error) { return res.status(error.statusCode || 400).json({ success: false, code: error.code, error: error.message }); }
});
