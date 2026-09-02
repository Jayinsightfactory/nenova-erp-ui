import { withAuth } from '../../../lib/auth.js';
import { loadPreShipmentHistory } from '../../../lib/preShipmentHistory.js';

function parseItems(rawItems) {
  if (Array.isArray(rawItems)) return rawItems;
  if (typeof rawItems !== 'string') return rawItems;
  try { return JSON.parse(rawItems); }
  catch { throw new Error('items는 JSON 배열이어야 합니다.'); }
}

/** 선출고/정상차수 재고 이력 조회. ERP 및 웹 계획 원장 모두 SELECT-only. */
export default withAuth(async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ success: false, error: 'GET only' });
  try {
    const history = await loadPreShipmentHistory({
      orderYear: req.query.orderYear,
      preWeek: req.query.preWeek,
      normalWeek: req.query.normalWeek,
      custKey: req.query.custKey,
      items: parseItems(req.query.items),
    });
    return res.status(200).json({ success: true, ...history });
  } catch (error) {
    return res.status(400).json({ success: false, error: error.message });
  }
});
