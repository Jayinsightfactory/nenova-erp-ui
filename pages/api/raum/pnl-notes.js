import { withAuth } from '../../../lib/auth.js';
import { requirePnlPartner } from '../../../lib/pnlHotelRegistry.js';
import { loadPnlSpecialNote, RaumPnlSpecialNoteError, savePnlSpecialNote } from '../../../lib/raumPnlSpecialNote.js';

function safeError(error) {
  if (error instanceof RaumPnlSpecialNoteError) {
    return { status: error.statusCode, code: error.code, error: error.message };
  }
  if (error?.statusCode && error?.code) {
    return { status: error.statusCode, code: error.code, error: error.message };
  }
  return { status: 503, code: 'PNL_SPECIAL_NOTE_UNAVAILABLE', error: '특이사항을 지금 처리할 수 없습니다. 잠시 후 다시 시도하세요.' };
}

export default withAuth(async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    if (req.method === 'GET') {
      const partner = await requirePnlPartner(req.query.partner);
      const note = await loadPnlSpecialNote({ partnerCode: partner.code, orderYear: req.query.year });
      return res.status(200).json({ success: true, partner, note });
    }
    if (req.method === 'PUT') {
      const partner = await requirePnlPartner(req.body?.partner);
      const result = await savePnlSpecialNote({
        partnerCode: partner.code,
        orderYear: req.body?.orderYear,
        text: req.body?.text,
        expectedRevision: req.body?.expectedRevision,
        actor: req.user?.userName || req.user?.userId || 'user',
      });
      return res.status(200).json({ success: true, partner, ...result });
    }
    res.setHeader('Allow', 'GET, PUT');
    return res.status(405).json({ success: false, code: 'METHOD_NOT_ALLOWED', error: 'GET 또는 PUT만 사용할 수 있습니다.' });
  } catch (error) {
    const safe = safeError(error);
    return res.status(safe.status).json({ success: false, code: safe.code, error: safe.error });
  }
});
