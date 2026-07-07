// pages/api/sales/weekly-shipment.js
// 차수매출관리 — 차수별 × 품종(국가/CountryFlower) 판매금액 집계 (JSON)
import { withAuth } from '../../../lib/auth';
import { aggregateWeeklySales } from '../../../lib/weeklyShipmentSales';

export default withAuth(async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();
  try {
    const data = await aggregateWeeklySales({
      year: req.query.year,
      from: req.query.from,
      to: req.query.to,
      fix: req.query.fix,
    });
    return res.status(200).json({ success: true, ...data });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});
