// pages/api/sales/revenue-save.js
// 미리보기(import-excel)로 받은 pending 배치를 실제 저장(커밋)한다 + 저장 이력 기록.
//   POST { meta:{salesYear,orderWeek,channel,dateFrom,dateTo,fileName,...}, rows:[...] }
//   → saveBatchWithHistory → 갱신 요약 + 이력 항목 반환
// ⚠️ 이카운트 원본에 쓰기/전송 없음. 네노바웹 비교용 저장소(data/*.json)만 갱신.

import { withAuth } from '../../../lib/auth';
import { withActionLog } from '../../../lib/withActionLog';
import { query } from '../../../lib/db';
import { loadSalesRevenueMappings } from '../../../lib/salesRevenueMappings';
import { saveBatchWithHistory, buildSummary, buildCustomerDir, viewBatchRaw } from '../../../lib/salesRevenueBatches';

async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'POST only' });

  const { meta, rows } = req.body || {};
  if (!meta || !Array.isArray(rows) || rows.length === 0) {
    return res.status(400).json({ success: false, error: 'meta, rows 필요(미리보기 후 저장하세요).' });
  }
  if (!meta.salesYear || !meta.orderWeek || !meta.channel) {
    return res.status(400).json({ success: false, error: '연도/차수/지점 정보가 없습니다.' });
  }

  const by = req.user?.userName || req.user?.userId || '';
  const { batch, entry } = saveBatchWithHistory(
    { ...meta, fetchedBy: meta.fetchedBy || by },
    rows,
    by
  );

  const mappings = loadSalesRevenueMappings(true);
  let customerDir = null;
  try {
    const r = await query(`SELECT CustKey, CustName, Manager FROM Customer WHERE isDeleted=0`);
    customerDir = buildCustomerDir(r.recordset);
  } catch { customerDir = null; }

  return res.status(200).json({
    success: true,
    batch: viewBatchRaw(batch, mappings),
    historyEntry: { ...entry, before: undefined, hasBefore: !!entry.before },
    summary: buildSummary({ channel: meta.channel, mappings, customerDir }),
    message: `${batch.salesYear}년 ${batch.orderWeek}차 / ${batch.channel} · ${batch.rawCount}건(합계 ${batch.rawTotal.toLocaleString()})을 저장했습니다.${entry.action === 'replace' ? ' (기존 저장본 교체 — 이력에서 롤백 가능)' : ''}`,
  });
}

export default withAuth(withActionLog(handler, {
  actionType: 'SALES_REVENUE_SAVE',
  affectedTable: 'data/sales-revenue-batches.json',
  riskLevel: 'LOW',
}));
