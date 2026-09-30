// 새 차수 자동 점검 패널 — 반차수별 반복 위험과 자동 처리 결과(자동처리됨 값/출처 · 입력 필요 + 화면 링크 · 확인 필요).
// API: GET /api/sales/profit-report-week-check (읽기 전용). 본표 조회를 막지 않게 따로 불러온다.
import { useEffect, useState } from 'react';

const CHIP = {
  input: { background: '#fee2e2', color: '#991b1b', border: '1px solid #fca5a5' },
  review: { background: '#fef3c7', color: '#92400e', border: '1px solid #fcd34d' },
  auto: { background: '#dbeafe', color: '#1e40af', border: '1px solid #93c5fd' },
  ok: { background: '#dcfce7', color: '#166534', border: '1px solid #86efac' },
};
const chip = (status) => ({ ...CHIP[status], borderRadius: 999, padding: '1px 8px', fontSize: 11, fontWeight: 800, whiteSpace: 'nowrap' });

export default function ProfitWeekCheckPanel({ orderYear, major }) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState({ loading: false, error: '', data: null });
  const [showOk, setShowOk] = useState(true);

  useEffect(() => {
    if (!orderYear || !major) return undefined;
    let cancelled = false;
    setState({ loading: true, error: '', data: null });
    fetch(`/api/sales/profit-report-week-check?year=${encodeURIComponent(orderYear)}&week=${encodeURIComponent(major)}`, { credentials: 'same-origin' })
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        if (!d.success) throw new Error(d.error || '점검 조회 실패');
        setState({ loading: false, error: '', data: d });
      })
      .catch((e) => { if (!cancelled) setState({ loading: false, error: e.message, data: null }); });
    return () => { cancelled = true; };
  }, [orderYear, major]);

  const d = state.data;
  const s = d?.summary || {};
  const rows = (d?.rows || []).filter((r) => showOk || (r.status !== 'ok' && r.status !== 'auto'));
  const groups = [];
  for (const r of rows) {
    const g = groups.at(-1);
    if (g && g.subWeek === r.subWeek) g.rows.push(r); else groups.push({ subWeek: r.subWeek, rows: [r] });
  }
  return (
    <div style={{ border: '1px solid #cbd5e1', borderRadius: 8, marginBottom: 8, background: '#fff' }} data-testid="profit-week-check">
      <button type="button" onClick={() => setOpen((v) => !v)}
        style={{ width: '100%', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', padding: '8px 12px', background: 'none', border: 0, cursor: 'pointer', textAlign: 'left', fontSize: 13 }}>
        <b>🩺 {major ? `${Number(major)}차` : ''} 자동 점검</b>
        {state.loading && <span style={{ color: '#64748b' }}>점검 중…</span>}
        {state.error && <span style={{ color: '#b91c1c' }}>점검 실패: {state.error}</span>}
        {d && (
          <>
            <span style={chip('input')}>입력 필요 {s.input || 0}</span>
            <span style={chip('review')}>확인 필요 {s.review || 0}</span>
            <span style={chip('auto')}>자동처리됨 {s.auto || 0}</span>
            <span style={chip('ok')}>정상 {s.ok || 0}</span>
          </>
        )}
        <span style={{ marginLeft: 'auto', color: '#64748b', fontSize: 12 }}>{open ? '접기 ▲' : '펼치기 ▼'}</span>
      </button>
      {open && d && (
        <div style={{ padding: '0 12px 10px' }}>
          <label style={{ fontSize: 12, color: '#475569', display: 'inline-flex', gap: 4, alignItems: 'center', marginBottom: 6 }}>
            <input type="checkbox" checked={showOk} onChange={(e) => setShowOk(e.target.checked)} /> 자동처리됨·정상도 보기
          </label>
          {groups.length === 0 && <div style={{ fontSize: 12.5, color: '#166534' }}>처리할 항목이 없습니다.</div>}
          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12.5 }}>
              <tbody>
                {groups.map((g) => g.rows.map((r, i) => (
                  <tr key={`${g.subWeek}-${i}`} style={{ borderTop: '1px solid #e2e8f0', verticalAlign: 'top' }}>
                    <td style={{ padding: '5px 6px', whiteSpace: 'nowrap', fontWeight: 700, color: '#334155' }}>{i === 0 ? g.subWeek : ''}</td>
                    <td style={{ padding: '5px 6px', whiteSpace: 'nowrap' }}>{r.topic}</td>
                    <td style={{ padding: '5px 6px' }}><span style={chip(r.status)}>{r.statusLabel}</span></td>
                    <td style={{ padding: '5px 6px', lineHeight: 1.5 }}>{r.text}</td>
                    <td style={{ padding: '5px 6px', whiteSpace: 'nowrap' }}>
                      {r.link?.href && <a href={r.link.href} target="_blank" rel="noreferrer" style={{ color: '#1d4ed8', fontWeight: 700 }}>{r.link.label} ↗</a>}
                    </td>
                  </tr>
                )))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
