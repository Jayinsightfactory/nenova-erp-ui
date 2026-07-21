// 전산 오류 진단 — nenova.exe 오류알림이 "왜 생겼고 어디서 생겼는지" 차수 단위로 스캔.
// 읽기 전용: DB 를 절대 수정하지 않는다 (수리는 각 항목의 해결 안내 경로로).
import { useState } from 'react';
// Layout 은 _app.js 가 전역 래핑 — 페이지 자체 래핑 금지(이중 사이드바 원인)
import { getCurrentWeek, useWeekInput } from '../../lib/useWeekInput';

function getDefaultWeek() {
  const current = getCurrentWeek();
  const match = String(current || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${match[2]}-${match[3]}` : current;
}

function getDefaultYear() {
  const current = getCurrentWeek();
  const match = String(current || '').match(/^(\d{4})-/);
  return match ? match[1] : String(new Date().getFullYear());
}

export default function ExeErrorsPage() {
  const weekInput = useWeekInput(getDefaultWeek());
  const [year, setYear] = useState(getDefaultYear());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [data, setData] = useState(null);
  const [openCodes, setOpenCodes] = useState({});

  const scan = async () => {
    setLoading(true);
    setError('');
    setData(null);
    try {
      const res = await fetch(`/api/shipment/exe-errors?week=${encodeURIComponent(weekInput.value)}&year=${encodeURIComponent(year)}`, { credentials: 'same-origin' });
      const d = await res.json();
      if (!d.success) throw new Error(d.error || '스캔 실패');
      setData(d);
      const opens = {};
      for (const c of d.checks || []) if (c.count > 0) opens[c.code] = true;
      setOpenCodes(opens);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <div style={st.page}>
        <h1 style={st.h1}>🩺 전산 오류 진단</h1>
        <p style={st.desc}>
          nenova.exe 에서 뜨는 오류 알림은 DB 상태에서 발생합니다. 알려진 유발 패턴을 차수 단위로 전수 스캔해
          <b> 왜 생겼고 어디서(업체/품목/키) 생겼는지</b> 보여줍니다. 이 화면은 읽기 전용 — 아무것도 수정하지 않습니다.
        </p>

        <div style={st.bar}>
          <label style={st.label}>차수</label>
          <input style={st.weekInput} value={weekInput.value} onChange={e => weekInput.setValue(e.target.value)} placeholder="예: 28-01" />
          <label style={st.label}>연도</label>
          <input style={st.yearInput} value={year} onChange={e => setYear(e.target.value)} inputMode="numeric" placeholder="예: 2026" />
          <button style={st.primaryBtn} onClick={scan} disabled={loading}>{loading ? '스캔 중…' : '스캔'}</button>
          {data && (
            <span style={{ fontSize: 13, fontWeight: 800, color: data.totalIssues > 0 ? '#dc2626' : '#059669' }}>
              {data.week}차 ({data.orderYear}년) — 선택연도 오류 {data.totalIssues}건 · 교차연도 후보 {data.crossYearIssues || 0}건
            </span>
          )}
        </div>

        {data && <div style={st.basis}>진단 기준: {data.diagnosticBasis}</div>}

        {error && <div style={st.error}>{error}</div>}

        {data && (
          <>
            {(data.checks || []).map(c => (
              <div key={c.code} style={{ ...st.card, borderColor: c.count > 0 ? '#fca5a5' : '#d1fae5' }}>
                <button
                  type="button"
                  style={st.cardHead}
                  onClick={() => setOpenCodes(prev => ({ ...prev, [c.code]: !prev[c.code] }))}
                >
                  <span style={{ fontSize: 16 }}>{c.count > 0 ? '🔴' : '🟢'}</span>
                  <span style={{ fontWeight: 800 }}>{c.title}</span>
                  {c.scope === 'cross-year-candidate' && <span style={st.scopeTag}>교차연도 후보</span>}
                  <span style={{ color: c.count > 0 ? '#dc2626' : '#059669', fontWeight: 800 }}>
                    {c.count}건{c.truncated ? ' (100건까지 표시)' : ''}
                  </span>
                  <span style={{ marginLeft: 'auto', color: '#94a3b8' }}>{openCodes[c.code] ? '▲' : '▼'}</span>
                </button>
                {openCodes[c.code] && (
                  <div style={st.cardBody}>
                    <div style={st.metaRow}><b>exe 증상</b> {c.exeAlert}</div>
                    <div style={st.metaRow}><b>왜 생기나</b> {c.cause}</div>
                    {c.operations?.length > 0 && <div style={st.metaRow}><b>발생 가능 작업</b> {c.operations.join(' · ')}</div>}
                    <div style={st.metaRow}><b>해결</b> {c.fix}</div>
                    {c.count > 0 && (
                      <table style={st.table}>
                        <thead>
                          <tr>{c.cols.filter(Boolean).map((h, i) => <th key={i}>{h}</th>)}</tr>
                        </thead>
                        <tbody>
                          {c.items.map((it, i) => (
                            <tr key={i}>
                              <td>{it.CustName || '—'}</td>
                              {c.cols[1] ? <td>{it.ProdName || '—'}</td> : null}
                              <td>{it.keyNo}</td>
                              {c.cols[3] ? <td>{it.v1 ?? ''}</td> : null}
                              {c.cols[4] ? <td>{it.v2 ?? ''}</td> : null}
                              {c.cols[5] ? <td>{it.v3 ?? ''}</td> : null}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                )}
              </div>
            ))}

            <div style={{ ...st.card, borderColor: (data.webErrors || []).length ? '#fcd34d' : '#d1fae5' }}>
              <div style={{ ...st.cardHead, cursor: 'default' }}>
                <span style={{ fontSize: 16 }}>🌐</span>
                <span style={{ fontWeight: 800 }}>웹 오류 로그 (AppLog · 최근 30건, 차수 무관)</span>
              </div>
              <div style={st.cardBody}>
                {(data.webErrors || []).length === 0 ? <div style={st.emptyTxt}>오류 로그 없음</div> : (
                  <table style={st.table}>
                    <thead><tr><th>시각</th><th>분류</th><th>단계</th><th>내용</th></tr></thead>
                    <tbody>
                      {data.webErrors.map(w => (
                        <tr key={w.LogKey}>
                          <td style={{ whiteSpace: 'nowrap' }}>{w.logDtm}</td>
                          <td>{w.Category}</td>
                          <td>{w.Step}</td>
                          <td style={{ fontSize: 11 }}>{w.Detail}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>

            <div style={{ ...st.card, borderColor: (data.ecountFails || []).length ? '#fcd34d' : '#d1fae5' }}>
              <div style={{ ...st.cardHead, cursor: 'default' }}>
                <span style={{ fontSize: 16 }}>🔄</span>
                <span style={{ fontWeight: 800 }}>ECOUNT 동기화 실패 (최근 10건, 차수 무관)</span>
              </div>
              <div style={st.cardBody}>
                {(data.ecountFails || []).length === 0 ? <div style={st.emptyTxt}>실패 이력 없음</div> : (
                  <table style={st.table}>
                    <thead><tr><th>시각</th><th>유형</th><th>RefKey</th><th>오류</th></tr></thead>
                    <tbody>
                      {data.ecountFails.map(e => (
                        <tr key={e.LogKey}>
                          <td style={{ whiteSpace: 'nowrap' }}>{e.syncDtm}</td>
                          <td>{e.SyncType}</td>
                          <td>{e.RefKey}</td>
                          <td style={{ fontSize: 11 }}>{String(e.ErrorMsg || '').slice(0, 160)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </>
  );
}

const st = {
  page: { padding: 20, maxWidth: 1100, margin: '0 auto' },
  h1: { fontSize: 20, fontWeight: 800, margin: '0 0 6px' },
  desc: { fontSize: 13, color: '#475569', margin: '0 0 14px', lineHeight: 1.6 },
  bar: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14, flexWrap: 'wrap' },
  label: { fontSize: 13, fontWeight: 700, color: '#334155' },
  weekInput: { border: '1px solid #cbd5e1', borderRadius: 8, padding: '8px 10px', fontSize: 14, width: 110 },
  yearInput: { border: '1px solid #cbd5e1', borderRadius: 8, padding: '8px 10px', fontSize: 14, width: 82 },
  primaryBtn: { background: '#2563eb', color: '#fff', border: 'none', borderRadius: 8, padding: '9px 18px', fontSize: 14, fontWeight: 700, cursor: 'pointer' },
  basis: { background: '#eff6ff', border: '1px solid #bfdbfe', color: '#1e40af', borderRadius: 8, padding: '9px 12px', fontSize: 12, marginBottom: 12 },
  scopeTag: { color: '#7c3aed', background: '#f5f3ff', border: '1px solid #ddd6fe', borderRadius: 999, padding: '2px 7px', fontSize: 11, fontWeight: 700 },
  error: { background: '#fef2f2', border: '1px solid #ef4444', color: '#b91c1c', borderRadius: 8, padding: '10px 12px', fontSize: 13, marginBottom: 12 },
  card: { border: '1px solid', borderRadius: 10, marginBottom: 10, background: '#fff', overflow: 'hidden' },
  cardHead: { display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left', background: 'none', border: 'none', padding: '11px 14px', fontSize: 14, cursor: 'pointer' },
  cardBody: { padding: '0 14px 12px' },
  metaRow: { fontSize: 12, color: '#475569', marginBottom: 4, lineHeight: 1.5 },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 12, marginTop: 8 },
  emptyTxt: { fontSize: 12, color: '#64748b' },
};
