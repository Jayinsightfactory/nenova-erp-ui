// pages/sales/forwarding-clearance.js — 포워딩 입력 (팝업/단독 페이지 전용, 사이드바 없음)
// 실제 입력 UI는 components/ForwardingClearancePanel.js — 주차별 매출이익보고서에도 그대로 임베드됨.
import { useState } from 'react';
import Head from 'next/head';
import { useWeekInput, getCurrentWeek } from '../../lib/useWeekInput';
import ForwardingClearancePanel from '../../components/ForwardingClearancePanel';

// URL의 ?week= 를 초기값으로 동기 반영 — useEffect로 나중에 setValue 하면 그 사이 잘못된 기본값으로
// 첫 조회가 나가는 경쟁상태가 생김(2026-07-10 발견, customs-clearance와 동일 패턴).
function initialWeek() {
  if (typeof window === 'undefined') return '';
  try {
    const w = new URLSearchParams(window.location.search).get('week');
    if (w) return w;
  } catch {}
  const m = String(getCurrentWeek() || '').match(/^\d{4}-(\d{2})-\d{2}$/);
  return m ? m[1] : '';
}

export default function ForwardingClearancePage() {
  const weekInput = useWeekInput(initialWeek());
  const [refreshKey, setRefreshKey] = useState(0);

  return (
    <>
      <Head><title>🚢 포워딩 입력 - nenova ERP</title></Head>
      <div style={st.page}>
        <div style={st.bar}>
          <h1 style={st.h1}>🚢 포워딩 입력</h1>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 'auto' }}>
            <input style={st.weekInput} {...weekInput.props} placeholder="27" />
            <button style={st.primaryBtn} onClick={() => setRefreshKey((k) => k + 1)}>조회</button>
          </div>
        </div>
        <ForwardingClearancePanel key={refreshKey} week={weekInput.value} />
      </div>
    </>
  );
}

const st = {
  page: { padding: '10px 14px', fontFamily: "'Malgun Gothic', sans-serif", background: '#f5f7fa', minHeight: '100vh' },
  bar: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' },
  h1: { fontSize: 17, fontWeight: 800, color: '#1e293b', margin: 0 },
  weekInput: { width: 90, padding: '6px 8px', border: '1px solid #cbd5e1', borderRadius: 6, textAlign: 'center', fontWeight: 700 },
  primaryBtn: { padding: '7px 16px', background: '#0f766e', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 700, fontSize: 12.5 },
};
