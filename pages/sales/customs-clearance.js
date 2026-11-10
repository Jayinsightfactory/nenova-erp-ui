// pages/sales/customs-clearance.js — 그외통관비 입력 (팝업/단독 페이지 전용, 사이드바 없음)
// 실제 입력 UI는 components/CustomsClearancePanel.js — 주차별 매출이익보고서에도 그대로 임베드됨.
import { useState } from 'react';
import Head from 'next/head';
import { getCurrentWeek } from '../../lib/useWeekInput';
import CustomsClearancePanel from '../../components/CustomsClearancePanel';

// This page selects a major separately from the year, unlike shipment week inputs.
export function standaloneCustomsScope(year, rawWeek) {
  const selectedYear = String(year || '').trim();
  if (!/^20\d{2}$/.test(selectedYear)) return null;
  const match = String(rawWeek || '').trim().match(/^(?:(20\d{2})-)?(\d{1,2})(?:-(\d{2}))?$/);
  if (!match || (match[1] && (match[1] !== selectedYear || !match[3]))) return null;
  const major = Number(match[2]), subweek = match[3];
  if (major < 1 || major > 52 || (subweek && !/^0[1-4]$/.test(subweek))) return null;
  return {year:selectedYear, week:String(major).padStart(2, '0') + (subweek ? `-${subweek}` : '')};
}

// SSR provides one canonical URL selection to both server and client: no wrong first GET.
export async function getServerSideProps({query}) {
  const current=String(getCurrentWeek()||'').match(/^(\d{4})-(\d{2})-/);
  const initialSelectedYear=query.year == null ? current?.[1]||'' : String(query.year).slice(0,20);
  const initialSelectedWeek=query.week == null ? current?.[2]||'' : String(query.week).slice(0,30);
  return {props:{initialSelectedYear,initialSelectedWeek,initialFocus:String(query.focus||'')}};
}
export default function CustomsClearancePage({initialSelectedYear='',initialSelectedWeek='',initialFocus=''}) {
  const [week, setWeek] = useState(initialSelectedWeek);
  // ?year= / ?focus= — 매출이익 보고서 경고의 "새 창에서 열기"가 연도·반차수를 미리 선택해 연다.
  const [focus] = useState(initialFocus);
  const [year, setYear] = useState(initialSelectedYear);
  const [refreshKey, setRefreshKey] = useState(0);
  const scope = standaloneCustomsScope(year, week);

  return (
    <>
      <Head><title>📦 그외통관비 입력 - nenova ERP</title></Head>
      <div style={st.page}>
        <div style={st.bar}>
          <h1 data-desktop-chrome style={st.h1}>📦 그외통관비 입력</h1>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 'auto' }}>
            <input style={{ ...st.weekInput, width: 70 }} value={year} onChange={e => setYear(e.target.value.replace(/\D/g, '').slice(0, 4))} aria-label="연도" />
            <input style={st.weekInput} value={week} onChange={e => setWeek(e.target.value)} aria-label="통관 차수" placeholder="27" />
            <button style={st.primaryBtn} onClick={() => setRefreshKey((k) => k + 1)}>조회</button>
          </div>
        </div>
        {scope ? <CustomsClearancePanel key={refreshKey} week={scope.week} year={scope.year} focus={focus || null} />
          : <div role="alert">연도와 차수를 확인하세요. 예: 2026년 · 36 또는 36-01 (1~52차, 반차수 01~04). 전체 차수의 연도는 선택 연도와 같아야 합니다.</div>}
      </div>
    </>
  );
}

const st = {
  page: { padding: '10px 14px', fontFamily: "'Malgun Gothic', sans-serif", background: '#f5f7fa', minHeight: '100vh' },
  bar: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' },
  h1: { fontSize: 17, fontWeight: 800, color: '#1e293b', margin: 0 },
  weekInput: { width: 90, padding: '6px 8px', border: '1px solid #cbd5e1', borderRadius: 6, textAlign: 'center', fontWeight: 700 },
  primaryBtn: { padding: '7px 16px', background: '#1d4ed8', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 700, fontSize: 12.5 },
};
