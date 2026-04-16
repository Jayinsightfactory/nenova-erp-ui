// pages/m/customers/index.js — 모바일 거래처 목록
// 검색 + TOP 버튼 + 거래처 카드
import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import MobileShell from '../../../components/m/MobileShell';

export default function MobileCustomerList() {
  const router = useRouter();
  const [me, setMe] = useState(null);
  const [customers, setCustomers] = useState([]);
  const [topCusts, setTopCusts] = useState([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [showAll, setShowAll] = useState(false);

  // 인증
  useEffect(() => {
    fetch('/api/auth/me').then(r => r.json()).then(d => {
      if (d?.success && d?.user) setMe(d.user);
      else router.replace('/m/login?next=/m/customers');
    }).catch(() => router.replace('/m/login?next=/m/customers'));
  }, [router]);

  // TOP 거래처 (biz API)
  useEffect(() => {
    if (!me) return;
    fetch('/api/m/biz')
      .then(r => r.json())
      .then(d => {
        if (d?.topCustomers) setTopCusts(d.topCustomers.slice(0, 8));
      })
      .catch(() => {});
  }, [me]);

  // 거래처 검색
  useEffect(() => {
    if (!me) return;
    if (!search && !showAll) return;
    setLoading(true);
    const url = search
      ? `/api/customers/search?q=${encodeURIComponent(search)}`
      : '/api/customers/search';
    fetch(url)
      .then(r => r.json())
      .then(d => {
        if (d?.success) setCustomers(d.customers || []);
        else setCustomers([]);
      })
      .catch(() => setCustomers([]))
      .finally(() => setLoading(false));
  }, [me, search, showAll]);

  if (!me) return null;

  return (
    <MobileShell title="거래처" user={me}>
      <Head><title>거래처 - 모바일</title></Head>

      <div className="mc-wrap">
        {/* 검색 */}
        <div className="mc-search">
          <input
            className="mc-input"
            type="text"
            placeholder="거래처명, 담당자 검색"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>

        {/* TOP 거래처 버튼 */}
        {!search && topCusts.length > 0 && (
          <div className="mc-section">
            <div className="mc-label">자주 거래하는 TOP</div>
            <div className="mc-chips">
              {topCusts.map((c, i) => (
                <button
                  key={c.CustKey || i}
                  className="mc-chip"
                  onClick={() => router.push(`/m/customers/${c.CustKey}`)}
                >
                  {c.CustName}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* 전체 보기 버튼 */}
        {!search && !showAll && (
          <button className="mc-all-btn" onClick={() => setShowAll(true)}>
            전체 거래처 보기
          </button>
        )}

        {/* 거래처 카드 리스트 */}
        {(search || showAll) && (
          <div className="mc-section">
            <div className="mc-label">거래처 ({customers.length}곳)</div>
            {loading ? (
              <div className="mc-empty">검색 중...</div>
            ) : customers.length === 0 ? (
              <div className="mc-empty">거래처가 없습니다</div>
            ) : (
              customers.map((c, i) => (
                <button
                  key={c.CustKey || i}
                  className="mc-card"
                  onClick={() => router.push(`/m/customers/${c.CustKey}`)}
                >
                  <div className="mc-card-top">
                    <span className="mc-card-name">{c.CustName}</span>
                    <span className="mc-card-arrow">&#9654;</span>
                  </div>
                  <div className="mc-card-bot">
                    <span>{c.CustArea || ''}</span>
                    <span>{c.Manager || ''}</span>
                    {c.OrderCode && <span>{c.OrderCode}</span>}
                  </div>
                </button>
              ))
            )}
          </div>
        )}
      </div>

      <style jsx>{`
        .mc-wrap { padding: 12px; }
        .mc-search { margin-bottom: 12px; }
        .mc-input {
          width: 100%; padding: 12px 14px;
          border: 1px solid #CBD5E0; border-radius: 10px;
          font-size: 14px; background: white;
          min-height: 48px; font-family: inherit;
          outline: none;
        }
        .mc-input:focus { border-color: #2b6cb0; }

        .mc-section { margin-bottom: 16px; }
        .mc-label {
          font-size: 12px; font-weight: 700; color: #4A5568;
          margin-bottom: 6px;
        }
        .mc-chips { display: flex; flex-wrap: wrap; gap: 6px; }
        .mc-chip {
          padding: 10px 14px; border: 1px solid #CBD5E0;
          border-radius: 20px; background: white;
          font-size: 13px; font-weight: 600; color: #2D3748;
          cursor: pointer; min-height: 44px;
          display: flex; align-items: center; font-family: inherit;
        }
        .mc-chip:active { background: #EDF2F7; }

        .mc-all-btn {
          display: block; width: 100%;
          padding: 14px; margin-bottom: 12px;
          background: #EDF2F7; border: 1px dashed #CBD5E0;
          border-radius: 10px; font-size: 14px; color: #4A5568;
          text-align: center; cursor: pointer;
          min-height: 48px; font-family: inherit;
        }
        .mc-all-btn:active { background: #E2E8F0; }

        .mc-card {
          display: block; width: 100%;
          padding: 14px; margin-bottom: 6px;
          background: white; border: 1px solid #E2E8F0;
          border-radius: 10px; text-align: left;
          cursor: pointer; font-family: inherit;
        }
        .mc-card:active { background: #F7FAFC; }
        .mc-card-top {
          display: flex; justify-content: space-between;
          align-items: center; margin-bottom: 4px;
        }
        .mc-card-name { font-size: 14px; font-weight: 700; color: #1A202C; }
        .mc-card-arrow { color: #A0AEC0; font-size: 12px; }
        .mc-card-bot {
          display: flex; gap: 10px;
          font-size: 12px; color: #718096;
        }
        .mc-empty {
          padding: 40px 16px; text-align: center;
          color: #A0AEC0; font-size: 14px;
        }
      `}</style>
    </MobileShell>
  );
}
