import { withAuth } from '../../../lib/auth.js';
import baselineStore, { SOURCE, WeekdayBaselineError, normalizeBaselineScope, canonicalRows } from '../../../lib/weekdayInitialBaselineStore.js';
import { readWeekdayInitialBaselineSnapshot } from '../../../lib/weekdayInitialBaselineSql.js';

// Injectable core lets local tests exercise the actual handler without loading DB/auth runtime.
export function createWeekdayBaselineHandler({ store = baselineStore,
  readSnapshot = async (scope) => {
    const { query, sql } = await import('../../../lib/db.js');
    return readWeekdayInitialBaselineSnapshot(scope, { query, sql });
  },
  now = () => new Date() } = {}) {
  return async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    if (!['GET', 'POST'].includes(req.method)) {
      res.setHeader('Allow', 'GET, POST');
      return res.status(405).json({ success: false, code: 'METHOD_NOT_ALLOWED', error: 'GET 또는 POST만 지원합니다.' });
    }
    try {
      const userId = req.user?.userId;
      if (typeof userId !== 'string' || !userId.trim() || userId.length > 200) {
        throw new WeekdayBaselineError('MISSING_USER', '인증된 사용자 ID가 필요합니다.', 401);
      }
      if (req.method === 'GET') {
        const input = req.query ?? {};
        if (typeof input.orderWeeks !== 'string') throw new WeekdayBaselineError('INVALID_WEEKS', '세부차수를 쉼표로 구분해 명시하세요.');
        const orderWeeks = input.orderWeeks.split(',').map((week) => week.trim());
        const baselines = await store.list({ year: input.year, custKey: input.custKey, orderWeeks });
        return res.status(200).json({ success: true, baselines, readOnly: true });
      }
      const input = req.body;
      if (!input || typeof input !== 'object' || Array.isArray(input) || !['preview', 'confirm'].includes(input.action)) {
        throw new WeekdayBaselineError('INVALID_ACTION', 'preview 또는 confirm 동작을 지정하세요.');
      }
      const scope = normalizeBaselineScope(input);
      if (input.action === 'confirm') {
        // Duplicate confirmation always conflicts, including after ERP rows are removed.
        if (await store.get(scope)) throw new WeekdayBaselineError('BASELINE_ALREADY_CONFIRMED', '이미 최초 기준이 확정된 차수입니다.', 409);
        if (typeof input.expectedDigest !== 'string' || !/^[a-f0-9]{64}$/.test(input.expectedDigest)) {
          throw new WeekdayBaselineError('INVALID_EXPECTED_DIGEST', '미리보기 지문이 필요합니다.');
        }
      }
      const preview = await readSnapshot(scope);
      if (input.action === 'preview') {
        return res.status(200).json({ success: true, readOnly: true,
          preview: { ...scope, digest: preview.digest, rows: canonicalRows(preview.rows) } });
      }
      if (preview.digest !== input.expectedDigest) throw new WeekdayBaselineError('BASELINE_STALE_PREVIEW', '미리보기 이후 전산 분배가 변경되었습니다. 다시 확인하세요.', 409);
      const rows = canonicalRows(preview.rows, { requirePositive: true });
      const baseline = await store.create({ version: 1, ...scope, source: SOURCE,
        confirmedAt: now().toISOString(), confirmedBy: userId.trim(), digest: preview.digest, rows });
      return res.status(201).json({ success: true, baseline, erpChanged: false });
    } catch (error) {
      const known = error instanceof WeekdayBaselineError;
      return res.status(known ? error.statusCode : 500).json({ success: false,
        code: known ? error.code : 'BASELINE_READ_FAILED',
        error: known ? error.message : '최초 기준 조회에 실패했습니다. 전산 및 서버 저장 상태를 확인하세요.' });
    }
  };
}

export default withAuth(createWeekdayBaselineHandler());
export const config = { api: { bodyParser: { sizeLimit: '16kb' } } };
