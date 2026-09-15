import { withAuth } from '../../../lib/auth.js';
import { createPnlHotel, listPnlHotels, PnlHotelRegistryError } from '../../../lib/pnlHotelRegistry.js';

function safeRegistryError(error) {
  if (error instanceof PnlHotelRegistryError) {
    return { status: error.statusCode, code: error.code, error: error.message };
  }
  return {
    status: 503,
    code: 'PNL_HOTEL_REGISTRY_UNAVAILABLE',
    error: '호텔 등록부를 지금 조회할 수 없습니다. 잠시 후 다시 시도하세요.',
  };
}

export default withAuth(async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    if (req.method === 'GET') {
      const partners = await listPnlHotels();
      return res.status(200).json({ success: true, partners });
    }
    if (req.method === 'POST') {
      const actor = req.user?.userName || req.user?.userId || 'user';
      const result = await createPnlHotel(req.body?.name, actor);
      return res.status(result.created ? 201 : 200).json({ success: true, partner: result.hotel });
    }
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ success: false, code: 'METHOD_NOT_ALLOWED', error: 'GET 또는 POST만 사용할 수 있습니다.' });
  } catch (error) {
    const safe = safeRegistryError(error);
    return res.status(safe.status).json({ success: false, code: safe.code, error: safe.error });
  }
});
