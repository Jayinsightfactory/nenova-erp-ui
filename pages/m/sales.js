// pages/m/sales.js — 모바일 매출 요약
// 기간 탭: 이번달 / 지난달 / 올해 -> 거래처별 매출 카드 (금액순)
import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import MobileShell from '../../components/m/MobileShell';

const PERIODS = [
  { key: 'thisMonth', label: '이번달' },
  { key: 'lastMonth', label: '지난달' },
  { key: 'thisYear', label: '올해' },
];

function getDateRange(period) {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth(); // 0-based
  if (period === 'thisMonth') {
    const from = `${y}-${String(m + 1).padStart(2, '0')}-01`;
    const to = `${y}-${String(m + 1).padStart(2, '0')}-${String(new Date(y, m + 1, 0).getDate()).padStart(2, '0')}`;
    return { dateFrom: from, dateTo: to };
  }
  if (period === 'lastMonth') {
    const pm = m === 0 ? 11 : m - 1;
    const py = m === 0 ? y - 1 : y;
    const from = `${py}-${String(pm + 1).padStart(2, '0')}-01`;
    const to = `${py}-${String(pm + 1).padStart(2, '0')}-${String(new Date(py, pm + 1, 0).getDate()).padStart(2, '0')}`;
    return { dateFrom: from, dateTo: to };
  }
  // thisYear
  return { dateFrom: `${y}-01-01`, dateTo: `${y}-12-31` };
}

export default function MobileSales() {
  const router = useRouter();
  const [me, setMe] = useState(null);
  const [period, setPeriod] = useState('thisMonth');
  const [custSales, setCustSales] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(false);

  // 인증
  useEffect(() => {
    fetch('/api/auth/me').then(r => r.json()).then(d => {
      if (d?.success && d?.user) setMe(d.user);
      else router.replace('/m/login?next=/m/sales');
    }).catch(() => router.replace('/m/login?next=/m/sales'));
  }, [router]);

  // 매출 데이터 로드
  useEffect(() => {
    if (!me) return;
    setLoading(true);
    const { dateFrom, dateTo } = getDateRange(period);
    fetch(`/api/sales/status?dateFrom=${dateFrom}&dateTo=${dateTo}`)
      .then(r => r.json())
      .then(d => {
        if (d?.success) {
          setSummary(d.summary || null);
          // 거래처별 집계
          const map = {};
          for (const row of (d.rows || [])) {
            const ck = row.CustKey;
            if (!map[ck]) {
              map[ck] = {
                CustKey: ck,
                CustName: row.CustName,
                CustArea: row.CustArea,
                totalAmt: 0,
                totalQty: 0,
              };
            }
            map[ck].totalAmt += (row.supplyAmt || 0) + (row.vatAmt || 0);
            map[ck].totalQty += row.qty || 0;
          }
          const sorted = Object.values(map).sort((a, b) => b.totalAmt - a.totalAmt);
          setCustSales(sorted);
        } else {
          setCustSales([]);
          setSummary(null);
        }
      })
      .catch(() => { setCustSales([]); setSummary(null); })
      .finally(() => setLoading(false));
  }, [me, period]);

  const fmtN = n => Number(n || 0).toLocaleString();
  const fmtM = n => {
    const v = Math.round((n || 0) / 10000);
    return v > 0 ? `${fmtN(v)}만원` : `${fmtN(n || 0)}원`;
  };

  if (!me) return null;

  return (
    <MobileShell title="매출 요약" user={me}>
      <Head><title>매출 요약 - 모바일</title></Head>

      <div className="sl-wrap">
        {/* 기간 탭 */}
        <div className="sl-tabs">
          {PERIODS.map(p => (
            <button
              key={p.key}
              className={`sl-tab ${period === p.key ? 'active' : ''}`}
              onClick={() => setPeriod(p.key)}
            >
              {p.label}
            </button>
          ))}
        </div>

        {/* 요약 */}
        {summary && (
          <div className="sl-summary">
            <div className="sl-sum-big">{fmtM(summary.totalAmt)}</div>
            <div className="sl-sum-sub">
              {fmtN(summary.totalQty || 0)}건 | {summary.custCount || custSales.length}곳
            </div>
          </div>
        )}

        {/* 거래처별 카드 */}
        {loading ? (
          <div className="sl-empty">조회 중...</div>
        ) : custSales.length === 0 ? (
          <div className="sl-empty">매출 데이터가 없습니다</div>
        ) : (
          custSales.map((c, i) => (
            <div key={c.CustKey || i} className="sl-card">
              <div className="sl-card-top">
                <span className="sl-rank">{i + 1}</span>
                <span className="sl-card-name">{c.CustName}</span>
              </div>
              <div className="sl-card-bot">
                <span className="sl-card-area">{c.CustArea || ''}</span>
                <span className="sl-card-amt">{fmtM(c.totalAmt)}</span>
              </div>
            </div>
          ))
        )}
      </div>

      <style jsx>{`
        .sl-wrap { padding: 12px; }
        .sl-tabs { display: flex; gap: 6px; margin-bottom: 12px; }
        .sl-tab {
          flex: 1; padding: 12px 8px;
          border: 1px solid #CBD5E0; border-radius: 10px;
          background: white; font-size: 14px; font-weight: 600;
          color: #4A5568; cursor: pointer; text-align: center;
          min-height: 48px; font-family: inherit;
        }
        .sl-tab.active {
          background: #2b6cb0; color: white; border-color: #2b6cb0;
        }
        .sl-tab:active { opacity: 0.8; }

        .sl-summary {
          text-align: center; padding: 20px 16px;
          background: white; border: 1px solid #E2E8F0;
          border-radius: 12px; margin-bottom: 14px;
        }
        .sl-sum-big { font-size: 28px; font-weight: 900; color: #2b6cb0; }
        .sl-sum-sub { font-size: 13px; color: #718096; margin-top: 4px; }

        .sl-card {
          background: white; border: 1px solid #E2E8F0;
          border-radius: 10px; padding: 12px 14px; margin-bottom: 6px;
        }
        .sl-card-top {
          display: flex; align-items: center; gap: 10px;
          margin-bottom: 4px;
        }
        .sl-rank {
          width: 24px; height: 24px;
          display: flex; align-items: center; justify-content: center;
          background: #EDF2F7; border-radius: 50%;
          font-size: 12px; font-weight: 700; color: #4A5568;
        }
        .sl-card-name { font-size: 14px; font-weight: 700; color: #1A202C; }
        .sl-card-bot {
          display: flex; justify-content: space-between;
          font-size: 13px; padding-left: 34px;
        }
        .sl-card-area { color: #718096; }
        .sl-card-amt { font-weight: 700; color: #2b6cb0; }
        .sl-empty {
          padding: 40px 16px; text-align: center;
          color: #A0AEC0; font-size: 14px;
        }
      `}</style>
    </MobileShell>
  );
}
