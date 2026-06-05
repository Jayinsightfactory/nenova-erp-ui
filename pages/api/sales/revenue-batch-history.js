// pages/api/sales/revenue-batch-history.js
// 영업매출 업로드 저장 이력 + 롤백.
//   GET            → 저장 이력 목록(최근순)
//   DELETE ?id=..  → 그 항목 롤백(직전 상태 복원) 후 항목 삭제 → 갱신 요약 반환
// ⚠️ 네노바웹 비교용 저장소만 갱신. 이카운트 원본 무관.

import { withAuth } from '../../../lib/auth';
import { withActionLog } from '../../../lib/withActionLog';
import { query } from '../../../lib/db';
import { loadSalesRevenueMappings } from '../../../lib/salesRevenueMappings';
import { listBatchHistory, rollbackBatchHistory, buildSummary, buildCustomerDir } from '../../../lib/salesRevenueBatches';

async function handler(req, res) {
  if (req.method === 'GET') {
    return res.status(200).json({ success: true, history: listBatchHistory(200) });
  }

  if (req.method === 'DELETE') {
    const id = (req.query.id || req.body?.id || '').toString();
    if (!id) return res.status(400).json({ success: false, error: 'id 필요' });
    const r = rollbackBatchHistory(id);
    if (!r.ok) return res.status(404).json({ success: false, error: r.reason || '롤백 실패' });

    const mappings = loadSalesRevenueMappings(true);
    let customerDir = null;
    try {
      const cr = await query(`SELECT CustKey, CustName, Manager FROM Customer WHERE isDeleted=0`);
      customerDir = buildCustomerDir(cr.recordset);
    } catch { customerDir = null; }

    return res.status(200).json({
      success: true,
      batchKey: r.batchKey,
      restored: r.restored,
      summary: buildSummary({ channel: r.channel, mappings, customerDir }),
      message: r.restored ? '이전 저장 상태로 롤백했습니다.' : '해당 저장본을 삭제(롤백)했습니다.',
    });
  }

  return res.status(405).json({ success: false, error: 'GET/DELETE only' });
}

export default withAuth(withActionLog(handler, {
  actionType: 'SALES_REVENUE_ROLLBACK',
  affectedTable: 'data/sales-revenue-batch-history.json',
  riskLevel: 'MEDIUM',
}));
