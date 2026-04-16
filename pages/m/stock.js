// pages/m/stock.js — 모바일 재고 현황
// 3단계 드릴다운: 국가 버튼 -> 꽃종류 버튼 -> 품목 카드 리스트
import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import MobileShell from '../../components/m/MobileShell';

export default function MobileStock() {
  const router = useRouter();
  const [me, setMe] = useState(null);
  const [groups, setGroups] = useState([]);
  const [countries, setCountries] = useState([]);
  const [flowers, setFlowers] = useState([]);
  const [selCountry, setSelCountry] = useState('');
  const [selFlower, setSelFlower] = useState('');
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [lowStock, setLowStock] = useState([]);

  // 인증
  useEffect(() => {
    fetch('/api/auth/me').then(r => r.json()).then(d => {
      if (d?.success && d?.user) setMe(d.user);
      else router.replace('/m/login?next=/m/stock');
    }).catch(() => router.replace('/m/login?next=/m/stock'));
  }, [router]);

  // 그룹 목록 (국가+꽃) 로드
  useEffect(() => {
    if (!me) return;
    fetch('/api/products/search?groupsOnly=1')
      .then(r => r.json())
      .then(d => {
        if (d?.success && d?.groups) {
          setGroups(d.groups);
          const ctrs = [...new Set(d.groups.map(g => g.country).filter(Boolean))];
          setCountries(ctrs);
          if (ctrs.length > 0) setSelCountry(ctrs[0]);
        }
      })
      .catch(() => {});
  }, [me]);

  // 국가 선택 시 꽃 목록 업데이트
  useEffect(() => {
    if (!selCountry) { setFlowers([]); return; }
    const fls = groups
      .filter(g => g.country === selCountry)
      .map(g => g.flower)
      .filter(Boolean);
    const unique = [...new Set(fls)];
    setFlowers(unique);
    setSelFlower('');
    setProducts([]);
  }, [selCountry, groups]);

  // 꽃 선택 시 품목 로드
  useEffect(() => {
    if (!selCountry || !selFlower || !me) return;
    setLoading(true);
    fetch(`/api/products/search?country=${encodeURIComponent(selCountry)}&flower=${encodeURIComponent(selFlower)}`)
      .then(r => r.json())
      .then(d => {
        if (d?.success) setProducts(d.products || []);
        else setProducts([]);
      })
      .catch(() => setProducts([]))
      .finally(() => setLoading(false));
  }, [selCountry, selFlower, me]);

  // 재고 부족 품목 로드
  useEffect(() => {
    if (!me) return;
    fetch('/api/stock')
      .then(r => r.json())
      .then(d => {
        if (d?.success && d?.stock) {
          const low = d.stock.filter(s => {
            const remaining = (s.prevStock || 0) + (s.inQty || 0) - (s.outQty || 0) + (s.adjustQty || 0);
            return remaining < 0;
          });
          setLowStock(low.slice(0, 5));
        }
      })
      .catch(() => {});
  }, [me]);

  const fmtN = n => Number(n || 0).toLocaleString();

  if (!me) return null;

  return (
    <MobileShell title="재고 현황" user={me}>
      <Head><title>재고 현황 - 모바일</title></Head>

      <div className="st-wrap">
        {/* 재고 부족 경고 */}
        {lowStock.length > 0 && (
          <div className="st-alert">
            <div className="st-alert-title">재고 부족 품목</div>
            {lowStock.map((s, i) => (
              <div key={i} className="st-alert-row">
                <span>{s.ProdName}</span>
                <span className="st-alert-val">
                  {fmtN((s.prevStock || 0) + (s.inQty || 0) - (s.outQty || 0))}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* 1단계: 국가 선택 */}
        <div className="st-section">
          <div className="st-label">국가</div>
          <div className="st-chips">
            {countries.map(c => (
              <button
                key={c}
                className={`st-chip ${selCountry === c ? 'active' : ''}`}
                onClick={() => setSelCountry(c)}
              >
                {c}
              </button>
            ))}
          </div>
        </div>

        {/* 2단계: 꽃 종류 선택 */}
        {flowers.length > 0 && (
          <div className="st-section">
            <div className="st-label">꽃 종류</div>
            <div className="st-chips">
              {flowers.map(f => (
                <button
                  key={f}
                  className={`st-chip sm ${selFlower === f ? 'active' : ''}`}
                  onClick={() => setSelFlower(f)}
                >
                  {f}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* 3단계: 품목 카드 리스트 */}
        {selFlower && (
          <div className="st-section">
            <div className="st-label">품목 ({products.length}건)</div>
            {loading ? (
              <div className="st-empty">조회 중...</div>
            ) : products.length === 0 ? (
              <div className="st-empty">품목이 없습니다</div>
            ) : (
              products.map((p, i) => (
                <div key={p.ProdKey || i} className="st-card">
                  <div className="st-card-top">
                    <span className="st-card-name">{p.ProdName}</span>
                    <span className="st-card-unit">{p.OutUnit || ''}</span>
                  </div>
                  <div className="st-card-bot">
                    <span>원가 {fmtN(p.Cost || 0)}원</span>
                    <span className="st-card-info">
                      B/Box {p.BunchOf1Box || 0} | S/B {p.SteamOf1Bunch || 0}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      <style jsx>{`
        .st-wrap { padding: 12px; }
        .st-alert {
          background: #FFF5F5; border: 1px solid #FEB2B2;
          border-radius: 12px; padding: 12px; margin-bottom: 14px;
        }
        .st-alert-title {
          font-size: 13px; font-weight: 700; color: #C53030;
          margin-bottom: 6px;
        }
        .st-alert-row {
          display: flex; justify-content: space-between;
          font-size: 12px; color: #742A2A; padding: 3px 0;
        }
        .st-alert-val { font-weight: 700; }

        .st-section { margin-bottom: 16px; }
        .st-label {
          font-size: 12px; font-weight: 700; color: #4A5568;
          margin-bottom: 6px;
        }
        .st-chips { display: flex; flex-wrap: wrap; gap: 6px; }
        .st-chip {
          padding: 10px 16px; border: 1px solid #CBD5E0;
          border-radius: 20px; background: white;
          font-size: 14px; font-weight: 600; color: #2D3748;
          cursor: pointer; min-height: 44px;
          display: flex; align-items: center; font-family: inherit;
        }
        .st-chip.sm { padding: 8px 12px; font-size: 13px; min-height: 38px; }
        .st-chip.active {
          background: #2b6cb0; color: white; border-color: #2b6cb0;
        }
        .st-chip:active { opacity: 0.8; }

        .st-card {
          background: white; border: 1px solid #E2E8F0;
          border-radius: 10px; padding: 12px 14px; margin-bottom: 6px;
        }
        .st-card-top {
          display: flex; justify-content: space-between;
          align-items: center; margin-bottom: 4px;
        }
        .st-card-name { font-size: 14px; font-weight: 600; color: #1A202C; }
        .st-card-unit { font-size: 11px; color: #A0AEC0; }
        .st-card-bot {
          display: flex; justify-content: space-between;
          font-size: 12px; color: #718096;
        }
        .st-card-info { font-size: 11px; color: #A0AEC0; }
        .st-empty {
          padding: 40px 16px; text-align: center;
          color: #A0AEC0; font-size: 14px;
        }
      `}</style>
    </MobileShell>
  );
}
