// pages/m/estimate/index.js — 모바일 견적서 목록
// 차수 버튼 -> 거래처별 견적서 카드
import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import MobileShell from '../../../components/m/MobileShell';

export default function MobileEstimateList() {
  const router = useRouter();
  const [me, setMe] = useState(null);
  const [weeks, setWeeks] = useState([]);
  const [selWeek, setSelWeek] = useState('');
  const [estimates, setEstimates] = useState([]);
  const [loading, setLoading] = useState(false);

  // 인증
  useEffect(() => {
    fetch('/api/auth/me').then(r => r.json()).then(d => {
      if (d?.success && d?.user) setMe(d.user);
      else router.replace('/m/login?next=/m/estimate');
    }).catch(() => router.replace('/m/login?next=/m/estimate'));
  }, [router]);

  // 차수 목록 로드 (biz API에서 최근 차수)
  useEffect(() => {
    if (!me) return;
    fetch('/api/m/biz')
      .then(r => r.json())
      .then(d => {
        if (d?.recentMajorWeeks) {
          setWeeks(d.recentMajorWeeks);
          setSelWeek(d.recentMajorWeeks[0] || '');
        }
      })
      .catch(() => {});
  }, [me]);

  // 견적서 목록 로드
  useEffect(() => {
    if (!selWeek || !me) return;
    setLoading(true);
    fetch(`/api/estimate?week=${selWeek}`)
      .then(r => r.json())
      .then(d => {
        if (d?.success) setEstimates(d.shipments || []);
        else setEstimates([]);
      })
      .catch(() => setEstimates([]))
      .finally(() => setLoading(false));
  }, [selWeek, me]);

  const fmtN = n => Number(n || 0).toLocaleString();

  if (!me) return null;

  return (
    <MobileShell title="견적서" user={me}>
      <Head><title>견적서 - 모바일</title></Head>

      <div className="me-wrap">
        {/* 차수 버튼 */}
        <div className="me-section">
          <div className="me-label">차수 선택</div>
          <div className="me-chips">
            {weeks.slice(0, 8).map(w => (
              <button
                key={w}
                className={`me-chip ${selWeek === w ? 'active' : ''}`}
                onClick={() => setSelWeek(w)}
              >
                {w}차
              </button>
            ))}
          </div>
        </div>

        {/* 거래처별 견적서 카드 */}
        <div className="me-section">
          <div className="me-label">
            거래처 ({estimates.length}곳)
          </div>

          {loading ? (
            <div className="me-empty">조회 중...</div>
          ) : estimates.length === 0 ? (
            <div className="me-empty">견적서가 없습니다</div>
          ) : (
            estimates.map((e, i) => (
              <button
                key={e.CustKey || i}
                className="me-card"
                onClick={() => {
                  const sk = e.firstShipmentKey || e.ShipmentKeys?.split(',')[0];
                  if (sk) router.push(`/m/shipment/${sk}`);
                }}
              >
                <div className="me-card-top">
                  <span className="me-card-name">{e.CustName || '거래처'}</span>
                  <span className="me-card-arrow">&#9654;</span>
                </div>
                <div className="me-card-mid">
                  {e.SubWeeks && (
                    <span className="me-card-sub">세부차수: {e.SubWeeks}</span>
                  )}
                </div>
                <div className="me-card-bot">
                  <span className="me-card-amt">{fmtN(e.totalAmount || 0)}원</span>
                </div>
              </button>
            ))
          )}
        </div>
      </div>

      <style jsx>{`
        .me-wrap { padding: 12px; }
        .me-section { margin-bottom: 16px; }
        .me-label {
          font-size: 12px; font-weight: 700; color: #4A5568;
          margin-bottom: 6px;
        }
        .me-chips { display: flex; flex-wrap: wrap; gap: 6px; }
        .me-chip {
          padding: 10px 16px; border: 1px solid #CBD5E0;
          border-radius: 20px; background: white;
          font-size: 14px; font-weight: 600; color: #2D3748;
          cursor: pointer; min-height: 44px;
          display: flex; align-items: center; font-family: inherit;
        }
        .me-chip.active {
          background: #2b6cb0; color: white; border-color: #2b6cb0;
        }
        .me-chip:active { opacity: 0.8; }

        .me-card {
          display: block; width: 100%;
          padding: 14px; margin-bottom: 8px;
          background: white; border: 1px solid #E2E8F0;
          border-radius: 12px; text-align: left;
          cursor: pointer; font-family: inherit;
        }
        .me-card:active { background: #F7FAFC; }
        .me-card-top {
          display: flex; justify-content: space-between;
          align-items: center; margin-bottom: 4px;
        }
        .me-card-name { font-size: 15px; font-weight: 700; color: #1A202C; }
        .me-card-arrow { color: #A0AEC0; font-size: 12px; }
        .me-card-mid { margin-bottom: 4px; }
        .me-card-sub { font-size: 12px; color: #718096; }
        .me-card-bot { text-align: right; }
        .me-card-amt { font-size: 14px; font-weight: 700; color: #2b6cb0; }
        .me-empty {
          padding: 40px 16px; text-align: center;
          color: #A0AEC0; font-size: 14px;
        }
      `}</style>
    </MobileShell>
  );
}
