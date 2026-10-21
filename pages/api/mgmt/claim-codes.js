// 클레임 사유코드 API. web_mgmt 만 쓰고, 불량차감 테이블은 읽기만 한다(pages/api/sales/defect-deductions* 미수정).
// GET  ?from=&to=               코드 사전 + 최근 불량차감 행(연결 포함) + 농장×사유 집계
// POST {action:'seed'|'save'|'toggle'|'link'}
import { withAuth } from '../../../lib/auth.js';
import { denyIfNotMgmtAdmin } from '../../../lib/mgmt/access.js';
import { listCodes, seedCodes, saveCode, setCodeActive, linkCode, recentDefectRows } from '../../../lib/mgmt/claimCodes.js';
import { aggregateByFarmReason, latestLinkBySource } from '../../../lib/mgmt/claimCodesCore.js';

export default withAuth(async function handler(req, res) {
  if (denyIfNotMgmtAdmin(req, res)) return;
  try {
    if (req.method === 'GET') {
      const from = req.query.from || undefined;
      const to = req.query.to || undefined;
      const codes = await listCodes();
      const { rows, links } = await recentDefectRows({ from, to, limit: req.query.limit });
      const latest = latestLinkBySource(links);
      const withCode = rows.map((r) => ({ ...r, code: latest.get(String(r.deductionKey))?.code || '' }));
      return res.status(200).json({ success: true, codes, rows: withCode, summary: aggregateByFarmReason(rows, links) });
    }
    if (req.method === 'POST') {
      const b = req.body || {};
      const actorId = req.user?.userId || '';
      if (b.action === 'seed') return res.status(200).json({ success: true, ...(await seedCodes()) });
      if (b.action === 'save') return res.status(200).json({ success: true, code: await saveCode(b) });
      if (b.action === 'toggle') { await setCodeActive(b.code, !!b.isActive); return res.status(200).json({ success: true }); }
      if (b.action === 'link') { await linkCode({ deductionKey: b.deductionKey, code: b.code, note: b.note, actorId }); return res.status(200).json({ success: true }); }
      return res.status(400).json({ success: false, error: 'action 은 seed | save | toggle | link' });
    }
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ success: false, error: 'Method Not Allowed' });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});
