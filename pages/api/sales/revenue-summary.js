// pages/api/sales/revenue-summary.js
// GET: 영업매출관리 — 저장된 Batch 기반 업체별/차수별/연도별 비교표 반환.
//
// 입력(query): channel, year, week
//   - channel: 지점 필터 (없거나 '전체'면 전 지점 합산)
//   - year, week: (선택) 해당 (연도/차수/지점) Batch의 원본 raw + 매칭 검토 리스트 반환
//
// ⚠️ 읽기 전용. 이카운트 API를 호출하지 않는다. 저장된 Batch만 읽어 매핑을 적용해 반환한다.

import { withAuth } from '../../../lib/auth';
import { loadSalesRevenueMappings } from '../../../lib/salesRevenueMappings';
import { buildSummary, getBatch, viewBatchRaw } from '../../../lib/salesRevenueBatches';

export default withAuth(function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'GET only' });
  }

  const { channel = null, year, week } = req.query || {};
  const mappings = loadSalesRevenueMappings();

  const summary = buildSummary({ channel, mappings });

  let currentBatch = { meta: null, raw: [], review: [], totals: null };
  if (year && week) {
    const batch = getBatch(year, week, channel || '양재동');
    if (batch) currentBatch = viewBatchRaw(batch, mappings);
  }

  return res.status(200).json({
    success: true,
    summary,
    currentBatch,
  });
});
