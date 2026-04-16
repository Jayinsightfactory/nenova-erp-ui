// pages/m/shipment/[key].js — 모바일 출고 상세
// 거래처별 출고 품목 카드 + 확정여부 배지 + 금액 표시
import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import MobileShell from '../../../components/m/MobileShell';

export default function MobileShipmentDetail() {
  const router = useRouter();
  const { key } = router.query;
  const [me, setMe] = useState(null);
  const [master, setMaster] = useState(null);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);

  // 인증
  useEffect(() => {
    fetch('/api/auth/me').then(r => r.json()).then(d => {
      if (d?.success && d?.user) setMe(d.user);
      else router.replace('/m/login');
    }).catch(() => router.replace('/m/login'));
  }, [router]);

  // 출고 상세 로드
  useEffect(() => {
    if (!key || !me) return;
    setLoading(true);
    fetch(`/api/shipment/${key}`)
      .then(r => r.json())
      .then(d => {
        if (d?.success) {
          setMaster(d.master || d.shipment || null);
          setItems(d.details || d.items || []);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [key, me]);

  const fmtN = n => Number(n || 0).toLocaleString();
  const custName = master?.CustName || '출고 상세';
  const isFix = master?.isFix === 1 || master?.isFix === true;
  const totalAmt = items.reduce((s, it) => s + (it.Amount || it.amount || 0), 0);
  const totalQty = items.reduce((s, it) => s + (it.OutQuantity || it.qty || 0), 0);

  if (!me) return null;

  return (
    <MobileShell title={custName} user={me}>
      <Head><title>{custName} 출고 상세</title></Head>

      <div className="sd-wrap">
        {loading ? (
          <div className="sd-empty">조회 중...</div>
        ) : (
          <>
            {/* 요약 카드 */}
            <div className="sd-summary">
              <div className="sd-sum-row">
                <span className="sd-sum-label">차수</span>
                <span className="sd-sum-val">{master?.OrderWeek || '-'}</span>
              </div>
              <div className="sd-sum-row">
                <span className="sd-sum-label">상태</span>
                <span className={`sd-badge ${isFix ? 'fix' : 'unfix'}`}>
                  {isFix ? '확정' : '미확정'}
                </span>
              </div>
              <div className="sd-sum-row">
                <span className="sd-sum-label">품목수</span>
                <span className="sd-sum-val">{items.length}종</span>
              </div>
              <div className="sd-sum-row">
                <span className="sd-sum-label">합계수량</span>
                <span className="sd-sum-val">{fmtN(totalQty)}</span>
              </div>
              <div className="sd-sum-row">
                <span className="sd-sum-label">합계금액</span>
                <span className="sd-sum-val amt">{fmtN(totalAmt)}원</span>
              </div>
            </div>

            {/* 품목 카드 리스트 */}
            {items.length === 0 ? (
              <div className="sd-empty">품목이 없습니다</div>
            ) : (
              items.map((it, i) => (
                <div key={i} className="sd-item">
                  <div className="sd-item-top">
                    <span className="sd-item-name">{it.ProdName || it.prodName || '-'}</span>
                    <span className="sd-item-unit">{it.OutUnit || ''}</span>
                  </div>
                  <div className="sd-item-bot">
                    <span>수량 {fmtN(it.OutQuantity || it.qty || 0)}</span>
                    <span className="sd-item-amt">{fmtN(it.Amount || it.amount || 0)}원</span>
                  </div>
                </div>
              ))
            )}
          </>
        )}
      </div>

      <style jsx>{`
        .sd-wrap { padding: 12px; }
        .sd-summary {
          background: white; border: 1px solid #E2E8F0;
          border-radius: 12px; padding: 14px; margin-bottom: 14px;
        }
        .sd-sum-row {
          display: flex; justify-content: space-between;
          align-items: center; padding: 6px 0;
          border-bottom: 1px solid #F7FAFC;
        }
        .sd-sum-row:last-child { border-bottom: none; }
        .sd-sum-label { font-size: 13px; color: #718096; }
        .sd-sum-val { font-size: 14px; font-weight: 700; color: #1A202C; }
        .sd-sum-val.amt { color: #2b6cb0; }
        .sd-badge {
          padding: 3px 10px; border-radius: 12px;
          font-size: 11px; font-weight: 700;
        }
        .sd-badge.fix { background: #C6F6D5; color: #22543D; }
        .sd-badge.unfix { background: #FED7D7; color: #9B2C2C; }

        .sd-item {
          background: white; border: 1px solid #E2E8F0;
          border-radius: 10px; padding: 12px 14px; margin-bottom: 6px;
        }
        .sd-item-top {
          display: flex; justify-content: space-between;
          align-items: center; margin-bottom: 4px;
        }
        .sd-item-name { font-size: 14px; font-weight: 600; color: #1A202C; }
        .sd-item-unit { font-size: 11px; color: #A0AEC0; }
        .sd-item-bot {
          display: flex; justify-content: space-between;
          font-size: 13px; color: #4A5568;
        }
        .sd-item-amt { font-weight: 700; color: #2b6cb0; }
        .sd-empty {
          padding: 40px 16px; text-align: center;
          color: #A0AEC0; font-size: 14px;
        }
      `}</style>
    </MobileShell>
  );
}
