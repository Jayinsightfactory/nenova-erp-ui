// pages/api/sales/revenue-cell.js
// 영업매출 비교표 셀(업체×차수×연도 금액) 수동 수정 + 이력.
//   POST: { channel, canonicalName, week, year, amount, prev } → override 저장 + 이력 기록 → 갱신 요약 반환
//   GET:  ?key=...           → 해당 셀 수정 이력
//         ?channel=&canonicalName=&week=&year=  → 키 조합으로 이력
//         (없으면) 최근 전체 이력
//
// 수동 수정 칸은 locked → 이후 ECOUNT 업로드가 덮지 않는다. 모든 수정은 이력에 남는다.

import { withAuth } from '../../../lib/auth';
import { withActionLog } from '../../../lib/withActionLog';
import {
  editCell,
  listCellHistory,
  recentCellHistory,
  cellKey,
} from '../../../lib/salesRevenueCells';
import { loadSalesRevenueMappings } from '../../../lib/salesRevenueMappings';
import { buildSummary } from '../../../lib/salesRevenueBatches';

export default withAuth(withActionLog(function handler(req, res) {
  if (req.method === 'GET') {
    const { key, channel, canonicalName, week, year } = req.query || {};
    if (key) return res.status(200).json({ success: true, history: listCellHistory(key) });
    if (channel && canonicalName && week && year) {
      return res.status(200).json({ success: true, history: listCellHistory(cellKey(channel, canonicalName, week, year)) });
    }
    return res.status(200).json({ success: true, history: recentCellHistory(200) });
  }

  if (req.method === 'POST') {
    const { channel, canonicalName, week, year, amount, prev, note } = req.body || {};
    const by = req.user?.userName || req.user?.userId || '';
    const result = editCell({ channel, canonicalName, week, year, amount, prev, by, note });
    if (!result.saved) {
      return res.status(400).json({ success: false, error: result.reason || '셀 저장 실패', detail: result.error });
    }
    const mappings = loadSalesRevenueMappings();
    return res.status(200).json({
      success: true,
      key: result.key,
      cell: result.cell,
      history: listCellHistory(result.key),
      summary: buildSummary({ channel, mappings }),
      message: `${canonicalName} ${week}차 ${year}년 매출을 ${Number(amount).toLocaleString()}으로 수정했습니다.`,
    });
  }

  return res.status(405).json({ success: false, error: 'GET/POST only' });
}, { actionType: 'SALES_REVENUE_CELL_EDIT', affectedTable: 'data/sales-revenue-cells.json', riskLevel: 'LOW' }));
