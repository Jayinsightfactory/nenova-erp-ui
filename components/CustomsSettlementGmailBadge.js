import { useEffect, useState } from 'react';

export default function CustomsSettlementGmailBadge() {
  const [status, setStatus] = useState(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/sales/customs-settlement?status=1', { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!cancelled && d?.gmailAuto) setStatus(d);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const ga = status?.gmailAuto;
  const workerOk = status?.worker?.connected === true;

  return (
    <div style={st.wrap} aria-label="선율 정산서 Gmail 자동 수집 상태">
      <span style={st.badge}>Gmail [정산서] 자동 수집 연동</span>
      <span style={st.detail}>
        관세법인 선율 정산서(관세·통관비·적용환율) 메일 수신 시 자동 투입
        {ga?.totalIngested > 0
          ? ` · 누적 ${ga.totalIngested}건${ga.lastMajor ? ` (최근 ${ga.lastYear}년 ${Number(ga.lastMajor)}차)` : ''}`
          : ' · 대기 중'}
        {status ? (workerOk ? ' · OCR 워커 연결됨' : ' · OCR 워커 대기') : ''}
      </span>
    </div>
  );
}

const st = {
  wrap: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
    padding: '8px 12px',
    marginBottom: 10,
    borderRadius: 8,
    border: '1px solid #bfdbfe',
    background: '#eff6ff',
    fontSize: 13,
    color: '#1e3a8a',
  },
  badge: {
    fontWeight: 700,
    padding: '2px 8px',
    borderRadius: 999,
    background: '#1d4ed8',
    color: '#ffffff',
    fontSize: 12,
  },
  detail: {
    color: '#1e40af',
  },
};
