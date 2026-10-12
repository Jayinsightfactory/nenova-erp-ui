// 과세환율(R) 조회·저장 API — 매출이익 보고서 전용, 웹 전용 테이블만 읽고 쓴다.
//
// GET  ?week=27&year=2026            → 그 대차수에 저장/캐시된 과세환율 + 변경 이력 + 공식조회 가능 여부
// POST { week, year, entries:[{currency, category?, rate, rateSource?, sourceRefFrom?, sourceRefTo?, sourceNote?}] }
//
// GET은 SELECT 전용이다 — CREATE/ALTER/MERGE를 절대 하지 않는다(스키마는 POST 경로 또는
// docs/migrations/2026-08-12_web_taxable_exchange_rate.sql 에서만 만든다).
// ERP 공용 원장(주문/분배/재고/견적)은 이 API가 읽지도 쓰지도 않는다.
import { withAuth } from '../../../lib/auth';
import { resolveActiveOrderYear } from '../../../lib/orderUtils';
import {
  loadTaxableRates, saveTaxableRates, loadTaxableRateHistory,
  hasKcsApiCredentials, KCS_API_KEY_ENV, KCS_API_URL_ENV,
} from '../../../lib/taxableExchangeRate.js';

function parseMajor(raw) {
  const m = String(raw || '').trim().match(/^(\d{1,2})(-\d{2})?$/);
  return m ? m[1].padStart(2, '0') : null;
}

export default withAuth(async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const major = parseMajor(req.query.week);
      if (!major) return res.status(400).json({ success: false, error: 'week 필요 (예: 27)' });
      const orderYear = resolveActiveOrderYear(`${major}-01`, req.query.year);
      const saved = await loadTaxableRates(major, orderYear);
      const history = saved.schemaMissing
        ? []
        : await loadTaxableRateHistory(major, orderYear, req.query.currency || null);
      return res.status(200).json({
        success: true, major, orderYear, saved, history,
        // 공식 조회(관세청 OpenAPI) 자격정보 주입 여부만 알린다 — 키 값 자체는 응답에 넣지 않는다.
        officialLookup: {
          configured: hasKcsApiCredentials(),
          requiredEnv: [KCS_API_URL_ENV, KCS_API_KEY_ENV],
          note: hasKcsApiCredentials()
            ? '공식 과세환율 조회 가능'
            : '공식 조회 자격정보가 없습니다. 인보이스의 과세환율을 직접 입력하세요.',
        },
      });
    }

    if (req.method === 'POST') {
      const major = parseMajor(req.body?.week);
      if (!major) return res.status(400).json({ success: false, error: 'week 필요' });
      const orderYear = resolveActiveOrderYear(`${major}-01`, req.body?.year);
      const actor = req.user?.userName || req.user?.userId || 'user';
      const entries = Array.isArray(req.body?.entries) ? req.body.entries : [];
      if (!entries.length) return res.status(400).json({ success: false, error: '저장할 과세환율이 없습니다' });
      const result = await saveTaxableRates(major, orderYear, entries, actor);
      return res.status(200).json({ success: true, ...result });
    }

    return res.status(405).json({ success: false, error: 'Method not allowed' });
  } catch (e) {
    return res.status(e.statusCode || 500).json({ success: false, error: e.message });
  }
});
