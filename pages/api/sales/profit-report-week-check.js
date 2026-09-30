// 새 차수 자동 점검 API — 반차수별 반복 위험(박스당 무게/CBM·그외통관비·환율·입고 입력 형태·혼적 AWB·항공료 전표·
// 최근 매입 없음)과 자동 처리 결과. GET 전용·읽기 전용(ERP·웹 테이블 SELECT). lib/profitReportWeekCheck.js
import { withAuth } from '../../../lib/auth';
import { resolveActiveOrderYear } from '../../../lib/orderUtils';
import { computeCustomsAndForwarding } from '../../../lib/customsForwarding';
import { loadWeekCheckSources, buildWeekCheck } from '../../../lib/profitReportWeekCheck';
import { parseMajor, loadWeeklyReportPayload } from './profit-report';

export async function loadWeekCheck(major, orderYear) {
  const [sources, customs, report] = await Promise.all([
    loadWeekCheckSources(major, orderYear),
    computeCustomsAndForwarding(major, orderYear),
    // 보고서 경고(PR #815 상세)·환율 원천 — 계산 결과 스냅샷이 있으면 그 값(빠름), 읽기 전용
    loadWeeklyReportPayload(major, orderYear, { preferLive: false }),
  ]);
  return buildWeekCheck({
    orderYear, major, sources,
    colombiaWeeks: customs?.components?.colombiaWeeks || [],
    report,
  });
}

export default withAuth(async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ success: false, error: 'Method not allowed' });
  try {
    const major = parseMajor(req.query.week);
    if (!major) return res.status(400).json({ success: false, error: 'week 필요 (예: 40)' });
    const orderYear = resolveActiveOrderYear(`${major}-01`, req.query.year);
    const data = await loadWeekCheck(major, orderYear);
    return res.status(200).json({ success: true, ...data });
  } catch (e) {
    return res.status(e.statusCode || 500).json({ success: false, error: e.message });
  }
});
