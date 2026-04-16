// pages/m/orders/index.js — 모바일 주문 목록 (버튼 드릴다운)
// 차수 버튼 → 세부차수 버튼 → 거래처 카드 리스트
import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import MobileShell from '../../../components/m/MobileShell';

export default function MobileOrders() {
  const router = useRouter();
  const [me, setMe] = useState(null);
  const [weeks, setWeeks] = useState([]);       // 대차수 목록
  const [selMajor, setSelMajor] = useState('');  // 선택된 대차수
  const [subWeeks, setSubWeeks] = useState([]);  // 세부차수
  const [selWeek, setSelWeek] = useState('');     // 선택된 세부차수
  const [customers, setCustomers] = useState([]); // 거래처 리스트
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');

  // 인증
  useEffect(() => {
    fetch('/api/auth/me').then(r => r.json()).then(d => {
      if (d?.success) setMe(d.user);
      else router.replace('/m/login?next=/m/orders');
    }).catch(() => router.replace('/m/login?next=/m/orders'));
  }, [router]);

  // 대차수 목록 로드
  useEffect(() => {
    if (!me) return;
    fetch('/api/orders?weekList=1').then(r => r.json()).then(d => {
      if (d?.weeks) {
        setWeeks(d.weeks);
        const initial = router.query.week || d.weeks[0] || '';
        setSelMajor(initial);
      }
    }).catch(() => {
      // fallback: biz API 에서 recentMajorWeeks
      fetch('/api/m/biz').then(r => r.json()).then(d => {
        if (d?.recentMajorWeeks) {
          setWeeks(d.recentMajorWeeks);
          setSelMajor(d.recentMajorWeeks[0] || '');
        }
      }).catch(() => {});
    });
  }, [me, router.query.week]);

  // 세부차수 + 거래처 로드
  const loadWeekData = useCallback(async (major) => {
    if (!major) return;
    setLoading(true);
    try {
      const r = await fetch(`/api/orders?week=${major}`);
      const d = await r.json();
      if (d?.orders) {
        // 세부차수 추출
        const subs = [...new Set(d.orders.map(o => o.OrderWeek))].sort();
        setSubWeeks(subs);
        if (!selWeek || !subs.includes(selWeek)) {
          setSelWeek(subs[0] || '');
        }
        // 거래처별 그룹
        groupByCustomer(d.orders, subs[0] || selWeek);
      }
    } catch { }
    setLoading(false);
  }, [selWeek]);

  useEffect(() => { loadWeekData(selMajor); }, [selMajor, loadWeekData]);

  // 세부차수 변경 시 거래처 다시 그룹화
  const [allOrders, setAllOrders] = useState([]);
  const loadSubWeek = useCallback(async (week) => {
    setSelWeek(week);
    setLoading(true);
    try {
      const r = await fetch(`/api/orders?week=${week.split('-')[0]}`);
      const d = await r.json();
      if (d?.orders) {
        setAllOrders(d.orders);
        groupByCustomer(d.orders, week);
      }
    } catch { }
    setLoading(false);
  }, []);

  function groupByCustomer(orders, week) {
    const filtered = week ? orders.filter(o => o.OrderWeek === week) : orders;
    const map = {};
    for (const o of filtered) {
      const key = o.CustKey || o.CustName;
      if (!map[key]) map[key] = { custName: o.CustName, custKey: o.CustKey, items: [], totalQty: 0 };
      if (o.ProdName) {
        const qty = getQty(o);
        map[key].items.push(o);
        map[key].totalQty += qty;
      }
    }
    setCustomers(Object.values(map).sort((a, b) => b.totalQty - a.totalQty));
  }

  function getQty(o) {
    const u = (o.OutUnit || '').toLowerCase();
    if (u.includes('박스') || u.includes('box')) return o.BoxQuantity || 0;
    if (u.includes('단') || u.includes('bunch')) return o.BunchQuantity || 0;
    if (u.includes('송이') || u.includes('steam') || u.includes('stem')) return o.SteamQuantity || 0;
    return o.BoxQuantity || 0;
  }

  const filtered = search
    ? customers.filter(c => c.custName?.toLowerCase().includes(search.toLowerCase()))
    : customers;

  if (!me) return null;

  return (
    <MobileShell title="주문관리" user={me}>
      <Head><title>주문관리 · 모바일</title></Head>

      <div className="mo-wrap">
        {/* 대차수 버튼 */}
        <div className="mo-section">
          <div className="mo-label">차수</div>
          <div className="mo-chips">
            {weeks.slice(0, 6).map(w => (
              <button
                key={w}
                className={`mo-chip ${selMajor === w ? 'active' : ''}`}
                onClick={() => setSelMajor(w)}
              >
                {w}차
              </button>
            ))}
          </div>
        </div>

        {/* 세부차수 버튼 */}
        {subWeeks.length > 0 && (
          <div className="mo-section">
            <div className="mo-label">세부차수</div>
            <div className="mo-chips">
              {subWeeks.map(w => (
                <button
                  key={w}
                  className={`mo-chip sm ${selWeek === w ? 'active' : ''}`}
                  onClick={() => loadSubWeek(w)}
                >
                  {w}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* 거래처 카드 리스트 */}
        <div className="mo-section">
          <div className="mo-label">거래처 ({filtered.length}곳)</div>

          {loading ? (
            <div className="mo-loading">조회 중...</div>
          ) : filtered.length === 0 ? (
            <div className="mo-empty">주문 데이터가 없습니다</div>
          ) : (
            filtered.map((c, i) => (
              <button
                key={c.custKey || i}
                className="mo-cust-card"
                onClick={() => router.push(`/m/orders/${selWeek}-${c.custKey}`)}
              >
                <div className="mo-cust-top">
                  <span className="mo-cust-name">{c.custName}</span>
                  <span className="mo-cust-arrow">▶</span>
                </div>
                <div className="mo-cust-sub">
                  {c.items.length}품목 · 수량 {c.totalQty.toLocaleString()}
                </div>
              </button>
            ))
          )}

          {/* 검색 (맨 아래) */}
          <button
            className="mo-search-btn"
            onClick={() => {
              const q = prompt('거래처 검색');
              if (q) setSearch(q);
              else setSearch('');
            }}
          >
            🔍 거래처 검색
          </button>
        </div>
      </div>

      <style jsx>{`
        .mo-wrap { padding: 12px; }
        .mo-section { margin-bottom: 16px; }
        .mo-label { font-size: 12px; font-weight: 700; color: #4A5568; margin-bottom: 6px; }
        .mo-chips { display: flex; flex-wrap: wrap; gap: 6px; }
        .mo-chip {
          padding: 10px 16px; border: 1px solid #CBD5E0;
          border-radius: 20px; background: white;
          font-size: 14px; font-weight: 600; color: #2D3748;
          cursor: pointer; min-height: 44px;
          display: flex; align-items: center; font-family: inherit;
        }
        .mo-chip.sm { padding: 8px 12px; font-size: 13px; min-height: 38px; }
        .mo-chip.active { background: #2b6cb0; color: white; border-color: #2b6cb0; }
        .mo-chip:active { opacity: 0.8; }

        .mo-cust-card {
          display: block; width: 100%;
          padding: 14px; margin-bottom: 6px;
          background: white; border: 1px solid #E2E8F0;
          border-radius: 10px; text-align: left;
          cursor: pointer; min-height: 56px;
          font-family: inherit;
        }
        .mo-cust-card:active { background: #F7FAFC; }
        .mo-cust-top { display: flex; justify-content: space-between; align-items: center; }
        .mo-cust-name { font-size: 14px; font-weight: 700; color: #1A202C; }
        .mo-cust-arrow { color: #A0AEC0; font-size: 12px; }
        .mo-cust-sub { font-size: 12px; color: #718096; margin-top: 4px; }

        .mo-search-btn {
          display: block; width: 100%;
          padding: 12px; margin-top: 10px;
          background: #EDF2F7; border: 1px dashed #CBD5E0;
          border-radius: 10px; font-size: 14px; color: #4A5568;
          text-align: center; cursor: pointer;
          min-height: 48px; font-family: inherit;
        }
        .mo-search-btn:active { background: #E2E8F0; }

        .mo-loading, .mo-empty {
          padding: 24px; text-align: center;
          color: #A0AEC0; font-size: 14px;
        }
      `}</style>
    </MobileShell>
  );
}
