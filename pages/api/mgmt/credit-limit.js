// 여신한도 API. GET: 거래처별 한도·잔액·상태 / ?custKey= 단건 / POST {custKey, limitKRW, reason} 이력 추가.
// 잔액은 lib/mgmt/receivables.js(= /api/sales/ar 와 같은 원천·계산). ERP 원장은 읽기만.
import { withAuth } from '../../../lib/auth.js';
import { getArBalances } from '../../../lib/mgmt/receivables.js';
import { listCustomersBasic } from '../../../lib/mgmt/sources.js';
import { appendLimit, listAllLimitRows, listLimitHistory } from '../../../lib/mgmt/creditLimitStore.js';
import { creditPct, creditStatus, latestLimitByCust, validateLimitInput, CREDIT_STATUS_LABEL } from '../../../lib/mgmt/creditLimit.js';

export default withAuth(async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const custKey = req.query.custKey ? Number.parseInt(req.query.custKey, 10) : null;
      if (req.query.custKey && !Number.isInteger(custKey)) return res.status(400).json({ success: false, error: 'custKey 오류' });
      const latest = latestLimitByCust(await listAllLimitRows());
      const balances = await getArBalances({ custKey });
      const balMap = new Map(balances.map((b) => [b.custKey, b]));
      const make = (ck, base) => {
        const lim = latest.get(ck);
        const limitKRW = lim ? Number(lim.LimitKRW) : null;
        const balance = balMap.get(ck)?.balance ?? 0;
        const status = creditStatus(limitKRW, balance);
        return { custKey: ck, ...base, limitKRW, balance, pct: creditPct(limitKRW, balance), status, statusLabel: CREDIT_STATUS_LABEL[status] };
      };
      if (custKey) {
        const history = await listLimitHistory({ custKey, limit: 50 });
        return res.status(200).json({ success: true, ...make(custKey, {}), history });
      }
      const customers = await listCustomersBasic();
      const rows = customers
        .filter((c) => latest.has(c.custKey) || (balMap.get(c.custKey)?.balance || 0) !== 0)
        .map((c) => make(c.custKey, { signboard: c.signboard, custName: c.custName, manager: c.manager || '' }));
      const rank = { over: 0, warn: 1, ok: 2, none: 3 };
      rows.sort((a, b) => (rank[a.status] - rank[b.status]) || (b.balance - a.balance));
      const history = await listLimitHistory({ limit: 100 });
      const nameOf = new Map(customers.map((c) => [c.custKey, c.signboard]));
      return res.status(200).json({
        success: true,
        rows,
        balanceTotal: balances.reduce((s, b) => s + b.balance, 0),
        history: history.map((h) => ({ ...h, signboard: nameOf.get(h.CustKey) || String(h.CustKey) })),
      });
    }
    if (req.method === 'POST') {
      const v = validateLimitInput(req.body);
      if (v.error) return res.status(400).json({ success: false, error: v.error });
      const historyKey = await appendLimit({ ...v, actorId: req.user?.userId || '' });
      return res.status(200).json({ success: true, historyKey });
    }
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ success: false, error: 'Method Not Allowed' });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});
