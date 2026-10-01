// 새 차수 자동 점검 패널 — 오류만 표시(입력 필요 + 화면 링크 · 확인 필요). 문제가 없으면 아무것도 렌더하지 않는다.
// API: GET /api/sales/profit-report-week-check (읽기 전용). 본표 조회를 막지 않게 따로 불러온다.
import { useEffect, useState } from 'react';

const CHIP = {
  input: { background: '#fee2e2', color: '#991b1b', border: '1px solid #fca5a5' },
  review: { background: '#fef3c7', color: '#92400e', border: '1px solid #fcd34d' },
};
const chip = (status) => ({ ...CHIP[status], borderRadius: 999, padding: '1px 8px', fontSize: 11, fontWeight: 800, whiteSpace: 'nowrap' });

export default function ProfitWeekCheckPanel({ orderYear, major }) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState({ loading: false, error: '', data: null });

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
  const rows = (d?.rows || []).filter((r) => r.status === 'input' || r.status === 'review');
  const groups = [];
  for (const r of rows) {
    const g = groups.at(-1);
    if (g && g.subWeek === r.subWeek) g.rows.push(r); else groups.push({ subWeek: r.subWeek, rows: [r] });
  }
  // 사장님(2026-09-30): "오류가 없으면 표시할 게 없는 거고 오류만 표시되게". 로딩 중·문제 0건이면 렌더하지 않는다.
  if (state.error) {
    return <div style={{ fontSize: 12, color: '#b91c1c', marginBottom: 8 }} data-testid="profit-week-check">🩺 자동 점검 실패: {state.error}</div>;
  }
  if (!rows.length) return null;
  const s2 = { input: rows.filter((r) => r.status === 'input').length, review: rows.filter((r) => r.status === 'review').length };
  return (
    <div style={{ border: '1px solid #cbd5e1', borderRadius: 8, marginBottom: 8, background: '#fff' }} data-testid="profit-week-check">
      <button type="button" onClick={() => setOpen((v) => !v)}
        style={{ width: '100%', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', padding: '8px 12px', background: 'none', border: 0, cursor: 'pointer', textAlign: 'left', fontSize: 13 }}>
        <b>🩺 {major ? `${Number(major)}차` : ''} 자동 점검</b>
        {s2.input > 0 && <span style={chip('input')}>입력 필요 {s2.input}</span>}
        {s2.review > 0 && <span style={chip('review')}>확인 필요 {s2.review}</span>}
        <span style={{ marginLeft: 'auto', color: '#64748b', fontSize: 12 }}>{open ? '접기 ▲' : '펼치기 ▼'}</span>
      </button>
      {open && d && (
        <div style={{ padding: '0 12px 10px' }}>
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
