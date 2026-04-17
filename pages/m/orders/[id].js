// pages/m/orders/[id].js — 모바일 주문 상세 (꽃종류별 접이식 카드)
// URL: /m/orders/16-01-13 (week-custKey)
import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import MobileShell from '../../../components/m/MobileShell';

export default function MobileOrderDetail() {
  const router = useRouter();
  const { id } = router.query; // "16-01-13"
  const [me, setMe] = useState(null);
  const [items, setItems] = useState([]);
  const [custName, setCustName] = useState('');
  const [week, setWeek] = useState('');
  const [viewMode, setViewMode] = useState('flower'); // flower | unit | total
  const [expanded, setExpanded] = useState({});

  useEffect(() => {
    fetch('/api/auth/me').then(r => r.json()).then(d => {
      if (d?.success) setMe(d.user);
      else router.replace('/m/login');
    }).catch(() => router.replace('/m/login'));
  }, [router]);

  useEffect(() => {
    if (!id || !me) return;
    // id = "16-01-13" → week="16-01", custKey=13
    const parts = id.split('-');
    if (parts.length < 3) return;
    const wk = `${parts[0]}-${parts[1]}`;
    const ck = parts.slice(2).join('-');
    setWeek(wk);

    fetch(`/api/orders?week=${parts[0]}`)
      .then(r => r.json())
      .then(d => {
        if (!d?.orders) return;
        const filtered = d.orders.filter(o =>
          o.OrderWeek === wk && String(o.CustKey) === ck && o.ProdName
        );
        if (filtered.length > 0) setCustName(filtered[0].CustName || '');
        setItems(filtered);
        // 기본 전부 펼침
        const exp = {};
        const groups = getFlowerGroups(filtered);
        groups.forEach(g => { exp[g.name] = true; });
        setExpanded(exp);
      });
  }, [id, me]);

  function getQty(o) {
    const u = (o.OutUnit || '').toLowerCase();
    if (u.includes('박스') || u.includes('box')) return o.BoxQuantity || 0;
    if (u.includes('단') || u.includes('bunch')) return o.BunchQuantity || 0;
    if (u.includes('송이') || u.includes('steam') || u.includes('stem')) return o.SteamQuantity || 0;
    return o.BoxQuantity || 0;
  }

  function getFlowerGroups(list) {
    const map = {};
    for (const o of list) {
      const g = o.FlowerName || '기타';
      if (!map[g]) map[g] = [];
      map[g].push(o);
    }
    return Object.entries(map).map(([name, rows]) => ({ name, rows }));
  }

  function getUnitTotals(list) {
    const map = {};
    for (const o of list) {
      const u = o.OutUnit || '기타';
      map[u] = (map[u] || 0) + getQty(o);
    }
    return Object.entries(map);
  }

  const groups = getFlowerGroups(items);
  const unitTotals = getUnitTotals(items);
  const totalQty = items.reduce((s, o) => s + getQty(o), 0);

  if (!me) return null;

  return (
    <MobileShell title={custName || '주문 상세'} user={me}>
      <Head><title>{custName} {week} · 주문</title></Head>

      <div className="md-wrap">
        {/* 헤더 정보 */}
        <div className="md-info">
          <div className="md-info-week">{week}차</div>
          <div className="md-info-count">{items.length}품목 · 합계 {totalQty.toLocaleString()}</div>
        </div>

        {/* 세그먼트 탭 (버튼형) */}
        <div className="md-tabs">
          {[
            ['flower', '꽃종류별'],
            ['unit', '단위별'],
            ['total', '합계'],
          ].map(([k, l]) => (
            <button
              key={k}
              className={`md-tab ${viewMode === k ? 'active' : ''}`}
              onClick={() => setViewMode(k)}
            >
              {l}
            </button>
          ))}
        </div>

        {/* 꽃종류별 보기 */}
        {viewMode === 'flower' && groups.map(g => (
          <div key={g.name} className="md-group">
            <button
              className="md-group-header"
              onClick={() => setExpanded(e => ({ ...e, [g.name]: !e[g.name] }))}
            >
              <span>🌸 {g.name} ({g.rows.length}종)</span>
              <span>{expanded[g.name] ? '▼' : '▶'}</span>
            </button>
            {expanded[g.name] && (
              <div className="md-group-body">
                {g.rows.map((o, i) => (
                  <div key={i} className="md-item">
                    <span className="md-item-name">{o.DisplayName || o.ProdName}</span>
                    <span className="md-item-qty">
                      {getQty(o).toLocaleString()} {o.OutUnit || ''}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}

        {/* 단위별 보기 */}
        {viewMode === 'unit' && (
          <div className="md-unit-list">
            {unitTotals.map(([u, q]) => (
              <div key={u} className="md-unit-row">
                <span className="md-unit-label">{u}</span>
                <span className="md-unit-value">{q.toLocaleString()}</span>
              </div>
            ))}
          </div>
        )}

        {/* 합계 보기 */}
        {viewMode === 'total' && (
          <div className="md-total">
            <div className="md-total-big">{totalQty.toLocaleString()}</div>
            <div className="md-total-sub">{items.length}품목 ({unitTotals.map(([u, q]) => `${u} ${q.toLocaleString()}`).join(' / ')})</div>
          </div>
        )}
      </div>

      <style jsx>{`
        .md-wrap { padding: 12px; }
        .md-info {
          text-align: center; margin-bottom: 12px;
          padding: 12px; background: white; border-radius: 10px;
          border: 1px solid #E2E8F0;
        }
        .md-info-week { font-size: 20px; font-weight: 800; color: #2b6cb0; }
        .md-info-count { font-size: 13px; color: #718096; margin-top: 4px; }

        .md-tabs {
          display: flex; gap: 6px; margin-bottom: 14px;
        }
        .md-tab {
          flex: 1; padding: 10px; border: 1px solid #CBD5E0;
          border-radius: 10px; background: white;
          font-size: 13px; font-weight: 600; color: #4A5568;
          cursor: pointer; text-align: center;
          min-height: 44px; font-family: inherit;
        }
        .md-tab.active { background: #2b6cb0; color: white; border-color: #2b6cb0; }
        .md-tab:active { opacity: 0.8; }

        .md-group { margin-bottom: 8px; }
        .md-group-header {
          display: flex; justify-content: space-between; align-items: center;
          width: 100%; padding: 12px 14px;
          background: #EDF2F7; border: 1px solid #E2E8F0;
          border-radius: 10px; font-size: 14px; font-weight: 700;
          color: #2D3748; cursor: pointer;
          min-height: 48px; font-family: inherit;
        }
        .md-group-header:active { background: #E2E8F0; }
        .md-group-body {
          border: 1px solid #E2E8F0; border-top: none;
          border-radius: 0 0 10px 10px; background: white;
        }
        .md-item {
          display: flex; justify-content: space-between; align-items: center;
          padding: 10px 14px; border-bottom: 1px solid #F7FAFC;
        }
        .md-item:last-child { border-bottom: none; }
        .md-item-name { font-size: 13px; color: #1A202C; flex: 1; }
        .md-item-qty { font-size: 14px; font-weight: 700; color: #2b6cb0; white-space: nowrap; }

        .md-unit-list {
          background: white; border-radius: 10px;
          border: 1px solid #E2E8F0; overflow: hidden;
        }
        .md-unit-row {
          display: flex; justify-content: space-between;
          padding: 14px 16px; border-bottom: 1px solid #F7FAFC;
        }
        .md-unit-row:last-child { border-bottom: none; }
        .md-unit-label { font-size: 15px; font-weight: 600; color: #4A5568; }
        .md-unit-value { font-size: 18px; font-weight: 800; color: #2b6cb0; }

        .md-total {
          text-align: center; padding: 32px 16px;
          background: white; border-radius: 10px;
          border: 1px solid #E2E8F0;
        }
        .md-total-big { font-size: 40px; font-weight: 900; color: #2b6cb0; }
        .md-total-sub { font-size: 13px; color: #718096; margin-top: 8px; }
      `}</style>
    </MobileShell>
  );
}
