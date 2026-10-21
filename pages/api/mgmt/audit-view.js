// 변경 감사로그 통합뷰(읽기 전용). GET ?from=&to=&kind=단가,수량&week=&cust=&format=csv
// 기본 기간 최근 7일. 조회 로그 제외, 단가·수량·확정·한도·승인 변경만.
import { withAuth } from '../../../lib/auth.js';
import { loadAuditEvents } from '../../../lib/mgmt/auditView.js';
import { defaultRange, toCsv, AUDIT_KINDS } from '../../../lib/mgmt/auditViewCore.js';

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export default withAuth(async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ success: false, error: 'Method Not Allowed' });
  }
  try {
    const d = defaultRange(7);
    const from = DAY.test(req.query.from || '') ? req.query.from : d.from;
    const to = DAY.test(req.query.to || '') ? req.query.to : d.to;
    const { events, missing } = await loadAuditEvents({ from, to, kind: req.query.kind, week: req.query.week, cust: req.query.cust });
    if (req.query.format === 'csv') {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="audit-${from}_${to}.csv"`);
      return res.status(200).send(toCsv(events));
    }
    return res.status(200).json({ success: true, from, to, kinds: AUDIT_KINDS, missing, count: events.length, events: events.slice(0, 1000) });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});
