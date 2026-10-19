import { withAuth } from '../../../lib/auth';
import { outputScope } from '../../../lib/profitRangeOutput.mjs';
import { collectIndependentAudit } from '../../../lib/profitIndependentAuditSource';

export default withAuth(async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') return res.status(405).json({ success: false, error: 'GET만 허용합니다.' });
  let scope, detail;
  try {
    scope = outputScope(req.query.year, req.query.week);
    detail = outputScope(scope.year, req.query.detail ?? scope.major).major;
    if (Number(detail) > Number(scope.major)) throw new Error('상세 차수가 조회 범위를 벗어났습니다.');
  }
  catch (error) { return res.status(400).json({ success: false, error: error.message }); }
  const controller = new AbortController();
  const cancel = () => { if (!res.writableEnded) controller.abort(); };
  res.on('close', cancel);
  try {
    const result = await collectIndependentAudit(scope, controller.signal);
    if (controller.signal.aborted) return;
    // Return all summaries, but only one week's full item detail (avoid multi-megabyte repeat payloads).
    const weeks = result.weeks.map(week => week.major === detail ? week : {
      ...week, entries: [], detailsLoaded: false,
      begin: compactValuation(week.begin), end: compactValuation(week.end),
    });
    return res.status(200).json({ success: true, orderYear: scope.year, major: scope.major, ...result, detail, weeks });
  } catch (error) {
    if (controller.signal.aborted) return;
    console.error('[profit-independent-audit]', error.code || error.name);
    return res.status(500).json({ success: false, error: '독립 검산 원천을 읽지 못했습니다. 정상으로 판정하지 않았습니다. 다시 조회하세요.' });
  } finally { res.removeListener('close', cancel); }
});

function compactValuation(snapshot) {
  if (!snapshot) return snapshot;
  return { ...snapshot, categories: Object.fromEntries(Object.entries(snapshot.categories).map(([key, value]) => [key, { ...value, items: [] }])) };
}
