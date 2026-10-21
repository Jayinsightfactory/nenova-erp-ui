// 채권 aging API. GET ?asOf=YYYY-MM-DD (기본 오늘). 읽기 전용.
import { withAuth } from '../../../lib/auth.js';
import { getArAgingInputs } from '../../../lib/mgmt/receivables.js';
import { receivableSourceLabel } from '../../../lib/mgmt/sources.js';
import { agingForCustomer, summarizeAging, sortAgingRows } from '../../../lib/mgmt/aging.js';

function todayKst() {
  return new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
}

export default withAuth(async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ success: false, error: 'Method Not Allowed' });
  }
  const asOf = req.query.asOf ? String(req.query.asOf) : todayKst();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) return res.status(400).json({ success: false, error: 'asOf 형식 YYYY-MM-DD' });
  try {
    const inputs = await getArAgingInputs();
    const rows = sortAgingRows(inputs.map((c) => ({
      custKey: c.custKey, custName: c.custName, area: c.area, manager: c.manager,
      ...agingForCustomer(c.charges, c.totalPaid, asOf),
    })));
    return res.status(200).json({ success: true, asOf, source: await receivableSourceLabel(), totals: summarizeAging(rows), rows });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});
