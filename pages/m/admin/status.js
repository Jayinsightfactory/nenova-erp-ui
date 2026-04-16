// pages/m/admin/status.js — 모바일 진단 대시보드
// 모든 /api/m/* 진단 엔드포인트를 한 화면에 호출해 한 눈에 상태 확인
import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import MobileShell from '../../../components/m/MobileShell';

const CHECKS = [
  { key: 'diag',    label: '🔑 환경/키',    url: '/api/m/diag' },
  { key: 'catalog', label: '📚 카탈로그',   url: '/api/m/catalog' },
  { key: 'biz',     label: '📊 비즈 스냅샷', url: '/api/m/biz' },
  { key: 'usage',   label: '📈 API 사용량',  url: '/api/m/usage' },
  { key: 'cost',    label: '💰 LLM 비용',    url: '/api/m/cost' },
  { key: 'ping',    label: '💓 서버 핑',     url: '/api/ping' },
];

export default function MobileStatus() {
  const router = useRouter();
  const [me, setMe] = useState(null);
  const [results, setResults] = useState({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/auth/me').then(r => r.json()).then(d => {
      if (d?.success) setMe(d.user);
      else router.replace('/m/login?next=/m/admin/status');
    }).catch(() => router.replace('/m/login?next=/m/admin/status'));
  }, [router]);

  async function runAll() {
    setLoading(true);
    const next = {};
    await Promise.all(CHECKS.map(async c => {
      const t0 = Date.now();
      try {
        const r = await fetch(c.url);
        const text = await r.text();
        let json = null;
        try { json = JSON.parse(text); } catch(_) {}
        next[c.key] = {
          ok: r.ok,
          status: r.status,
          ms: Date.now() - t0,
          data: json,
          rawPreview: text.slice(0, 120),
        };
      } catch (e) {
        next[c.key] = { ok: false, error: e.message, ms: Date.now() - t0 };
      }
    }));
    setResults(next);
    setLoading(false);
  }

  useEffect(() => { if (me) runAll(); }, [me]);

  if (!me) return null;

  const fmt = n => Number(n || 0).toLocaleString();

  return (
    <MobileShell title="진단 대시보드" user={me}>
      <Head><title>진단 · 모바일</title></Head>

      <div className="ms-wrap">
        <button className="ms-refresh" onClick={runAll} disabled={loading}>
          {loading ? '🔄 조회 중...' : '🔄 전체 재조회'}
        </button>

        {/* 요약 카드 */}
        {!loading && (
          <div className="ms-summary">
            <div className="ms-summary-item">
              <span className="label">정상</span>
              <span className="value ok">{CHECKS.filter(c => results[c.key]?.ok).length}/{CHECKS.length}</span>
            </div>
            <div className="ms-summary-item">
              <span className="label">총 응답</span>
              <span className="value">{Math.round(Object.values(results).reduce((s,r) => s + (r.ms||0), 0) / CHECKS.length)}ms</span>
            </div>
          </div>
        )}

        {/* 각 체크 결과 */}
        {CHECKS.map(c => {
          const r = results[c.key];
          return (
            <div key={c.key} className="ms-check">
              <div className="ms-check-head">
                <span className="ms-check-label">{c.label}</span>
                <span className={`ms-check-status ${r?.ok ? 'ok' : 'err'}`}>
                  {r ? (r.ok ? `✓ ${r.status} · ${r.ms}ms` : `✗ ${r.status || 'ERR'}`) : '...'}
                </span>
              </div>

              {/* 체크별 맞춤 요약 */}
              {c.key === 'diag' && r?.data && (
                <div className="ms-info">
                  <div>ANTHROPIC_API_KEY: {r.data.anthropicKeyPresent ? `✓ (len=${r.data.anthropicKeyLength})` : '✗ 누락'}</div>
                  <div>환경: {r.data.nodeEnv}</div>
                </div>
              )}
              {c.key === 'catalog' && r?.data?.sizes && (
                <div className="ms-info">
                  <div>거래처: {fmt(r.data.sizes.customers)}곳</div>
                  <div>국가: {fmt(r.data.sizes.countries)} · 꽃: {fmt(r.data.sizes.flowers)} · 지역: {fmt(r.data.sizes.areas)}</div>
                  <div>빌드: {r.data.builtAt?.slice(0, 16)}</div>
                </div>
              )}
              {c.key === 'biz' && r?.data && (
                <div className="ms-info">
                  <div>최근 차수: {r.data.recentMajorWeeks?.join(', ')}</div>
                  <div>거래처 TOP: {r.data.topCustomers?.[0]?.CustName}</div>
                  <div>출고 확정률: {r.data.shipmentStats?.fixRate}%</div>
                </div>
              )}
              {c.key === 'usage' && r?.data?.stats && (
                <div className="ms-info">
                  <div>24h 호출: {fmt(r.data.stats.totalCalls)}회</div>
                  <div>사용자: {r.data.stats.uniqueUsers}명 · 엔드포인트: {r.data.stats.uniqueEndpoints}개</div>
                  {r.data.globalTop?.[0] && <div>TOP: {r.data.globalTop[0].endpoint} ({r.data.globalTop[0].count}회)</div>}
                </div>
              )}
              {c.key === 'cost' && r?.data && (
                <div className="ms-info">
                  <div>24h 호출: {fmt(r.data.totalCalls)}회 / 토큰: {fmt(r.data.totalInputTokens)} + {fmt(r.data.totalOutputTokens)}</div>
                  <div className="ms-cost">${r.data.totalCostUSD} = ₩{fmt(r.data.totalCostKRW)}</div>
                  <div>추정 일일: ${r.data.projectedDailyUSD} · 월: ${r.data.projectedMonthlyUSD}</div>
                </div>
              )}
              {c.key === 'ping' && r?.ok && (
                <div className="ms-info">
                  <div>서버 정상 · {r.ms}ms</div>
                </div>
              )}

              {!r?.ok && r?.rawPreview && (
                <div className="ms-error">{r.rawPreview}</div>
              )}
            </div>
          );
        })}
      </div>

      <style jsx>{`
        .ms-wrap { padding: 12px; }
        .ms-refresh {
          width: 100%; padding: 12px; margin-bottom: 14px;
          background: #2b6cb0; color: white; border: none;
          border-radius: 10px; font-size: 14px; font-weight: 600;
          cursor: pointer; min-height: 48px; font-family: inherit;
        }
        .ms-refresh:disabled { opacity: 0.5; }

        .ms-summary {
          display: flex; gap: 10px; margin-bottom: 14px;
        }
        .ms-summary-item {
          flex: 1; padding: 12px;
          background: white; border: 1px solid #E2E8F0;
          border-radius: 10px; text-align: center;
        }
        .ms-summary-item .label { display:block; font-size: 11px; color: #718096; }
        .ms-summary-item .value { display:block; font-size: 20px; font-weight: 800; color: #2D3748; margin-top:4px; }
        .ms-summary-item .value.ok { color: #38A169; }

        .ms-check {
          background: white; border: 1px solid #E2E8F0;
          border-radius: 10px; padding: 12px;
          margin-bottom: 8px;
        }
        .ms-check-head {
          display: flex; justify-content: space-between; align-items: center;
          margin-bottom: 6px;
        }
        .ms-check-label { font-size: 14px; font-weight: 700; color: #1A202C; }
        .ms-check-status {
          font-size: 11px; font-family: 'Menlo','Monaco',monospace;
          padding: 3px 8px; border-radius: 6px;
        }
        .ms-check-status.ok { background: #C6F6D5; color: #22543D; }
        .ms-check-status.err { background: #FED7D7; color: #742A2A; }

        .ms-info {
          font-size: 12px; color: #4A5568;
          line-height: 1.6; padding-top: 4px;
          border-top: 1px solid #F7FAFC;
        }
        .ms-cost { font-size: 15px; font-weight: 700; color: #2b6cb0; }
        .ms-error {
          font-size: 11px; color: #c53030;
          background: #FFF5F5; padding: 6px 8px;
          border-radius: 4px; margin-top: 6px;
          font-family: 'Menlo','Monaco',monospace;
          white-space: pre-wrap; word-break: break-all;
        }
      `}</style>
    </MobileShell>
  );
}
