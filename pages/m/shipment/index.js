// pages/m/shipment/index.js — 모바일 출고 현황
// 탭: 오늘출고 / 확정 / 미확정
import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import MobileShell from '../../../components/m/MobileShell';

const TABS = [
  { key: 'today', label: '오늘출고' },
  { key: 'fixed', label: '확정' },
  { key: 'unfixed', label: '미확정' },
];

export default function MobileShipmentList() {
  const router = useRouter();
  const [me, setMe] = useState(null);
  const [tab, setTab] = useState('today');
  const [shipments, setShipments] = useState([]);
  const [loading, setLoading] = useState(false);

  // 인증
  useEffect(() => {
    fetch('/api/auth/me').then(r => r.json()).then(d => {
      if (d?.success && d?.user) setMe(d.user);
      else router.replace('/m/login?next=/m/shipment');
    }).catch(() => router.replace('/m/login?next=/m/shipment'));
  }, [router]);

  // URL 탭 동기화
  useEffect(() => {
    const t = router.query.tab;
    if (t && ['today', 'fixed', 'unfixed'].includes(t)) setTab(t);
  }, [router.query.tab]);

  // 출고 데이터 로드
  useEffect(() => {
    if (!me) return;
    setLoading(true);
    fetch('/api/shipment')
      .then(r => r.json())
      .then(d => {
        if (d?.success) setShipments(d.shipments || []);
        else setShipments([]);
      })
      .catch(() => setShipments([]))
      .finally(() => setLoading(false));
  }, [me]);

  function changeTab(key) {
    setTab(key);
    router.replace(`/m/shipment?tab=${key}`, undefined, { shallow: true });
  }

  // 탭별 필터
  function filterByTab(list) {
    const today = new Date().toISOString().slice(0, 10);
    if (tab === 'today') {
      return list.filter(s => s.isFix === 1 || s.isFix === true);
    }
    if (tab === 'fixed') {
      return list.filter(s => s.isFix === 1 || s.isFix === true);
    }
    if (tab === 'unfixed') {
      return list.filter(s => !s.isFix || s.isFix === 0);
    }
    return list;
  }

  const filtered = filterByTab(shipments);
  const fmtN = n => Number(n || 0).toLocaleString();

  if (!me) return null;

  return (
    <MobileShell title="출고 현황" user={me}>
      <Head><title>출고 현황 - 모바일</title></Head>

      <div className="ms-wrap">
        {/* 탭 버튼 */}
        <div className="ms-tabs">
          {TABS.map(t => (
            <button
              key={t.key}
              className={`ms-tab-btn ${tab === t.key ? 'active' : ''}`}
              onClick={() => changeTab(t.key)}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* 결과 수 */}
        <div className="ms-count">{filtered.length}건</div>

        {/* 카드 리스트 */}
        {loading ? (
          <div className="ms-empty">조회 중...</div>
        ) : filtered.length === 0 ? (
          <div className="ms-empty">출고 데이터가 없습니다</div>
        ) : (
          filtered.map((s, i) => (
            <button
              key={s.ShipmentKey || i}
              className="ms-card"
              onClick={() => router.push(`/m/shipment/${s.ShipmentKey}`)}
            >
              <div className="ms-card-top">
                <span className="ms-card-name">{s.CustName || '거래처'}</span>
                <span className={`ms-badge ${s.isFix ? 'fix' : 'unfix'}`}>
                  {s.isFix ? '확정' : '미확정'}
                </span>
              </div>
              <div className="ms-card-mid">
                <span>{s.OrderWeek || ''}차</span>
                <span>{s.CustArea || ''}</span>
              </div>
              <div className="ms-card-bot">
                <span>수량 {fmtN(s.totalQty)}</span>
                <span className="ms-card-amt">{fmtN(s.totalAmount)}원</span>
              </div>
            </button>
          ))
        )}
      </div>

      <style jsx>{`
        .ms-wrap { padding: 12px; }
        .ms-tabs { display: flex; gap: 6px; margin-bottom: 12px; }
        .ms-tab-btn {
          flex: 1; padding: 12px 8px;
          border: 1px solid #CBD5E0; border-radius: 10px;
          background: white; font-size: 14px; font-weight: 600;
          color: #4A5568; cursor: pointer; text-align: center;
          min-height: 48px; font-family: inherit;
        }
        .ms-tab-btn.active {
          background: #2b6cb0; color: white; border-color: #2b6cb0;
        }
        .ms-tab-btn:active { opacity: 0.8; }
        .ms-count {
          font-size: 12px; color: #718096; margin-bottom: 8px;
          font-weight: 600;
        }
        .ms-card {
          display: block; width: 100%;
          padding: 14px; margin-bottom: 8px;
          background: white; border: 1px solid #E2E8F0;
          border-radius: 12px; text-align: left;
          cursor: pointer; font-family: inherit;
        }
        .ms-card:active { background: #F7FAFC; }
        .ms-card-top {
          display: flex; justify-content: space-between;
          align-items: center; margin-bottom: 6px;
        }
        .ms-card-name { font-size: 15px; font-weight: 700; color: #1A202C; }
        .ms-badge {
          padding: 3px 10px; border-radius: 12px;
          font-size: 11px; font-weight: 700;
        }
        .ms-badge.fix { background: #C6F6D5; color: #22543D; }
        .ms-badge.unfix { background: #FED7D7; color: #9B2C2C; }
        .ms-card-mid {
          display: flex; gap: 8px;
          font-size: 12px; color: #718096; margin-bottom: 4px;
        }
        .ms-card-bot {
          display: flex; justify-content: space-between;
          font-size: 13px; color: #4A5568;
        }
        .ms-card-amt { font-weight: 700; color: #2b6cb0; }
        .ms-empty {
          padding: 40px 16px; text-align: center;
          color: #A0AEC0; font-size: 14px;
        }
      `}</style>
    </MobileShell>
  );
}
