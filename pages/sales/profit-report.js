// 주차별 매출이익 보고서 — "매출원가 양식.xlsx" 첫 시트와 동일 셀 구조.
// 자동(SQL): N순수매출·L불량·O그외매출·Q구매외화·S포워딩USD(추정) / 수기: E기초·F기말·H통관비·R환율·S수정·비고
// 계산열은 엑셀 수식 그대로: C=N+L+O, G=P+T, P=Q×R, T=S×R, I=E+G+H−F, J=C−I, K=J/C, M=−L/C, D=C/ΣC, U=P/ΣP
// (이스라엘·뉴질랜드·일본: I=E+G+H, J=C−I+F, K=J/(C+F) — 원본 수식 변형 유지)
import { useEffect, useMemo, useState } from 'react';
// Layout 은 _app.js 가 전역 래핑 — 페이지 자체 래핑 금지(이중 사이드바 원인)
import { getCurrentWeek, useWeekInput } from '../../lib/useWeekInput';

function getDefaultMajor() {
  const m = String(getCurrentWeek() || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? m[2] : '';
}
const n0 = v => (v == null || Number.isNaN(Number(v)) ? 0 : Number(v));
const fmt = v => (v == null || Number.isNaN(v) ? '' : Math.round(v).toLocaleString());
const pct = v => (v == null || !Number.isFinite(v) ? '' : `${(v * 100).toFixed(1)}%`);

function computeRow(row, edits) {
  const e = edits[row.category] || {};
  const pick = (col, fallback) => {
    const ev = e[col];
    if (ev !== undefined) return ev === '' ? null : Number(ev);
    const mv = row.manual[col];
    if (mv != null) return Number(mv);
    return fallback;
  };
  const N = row.auto.N, L = row.auto.L, O = row.auto.O, Q = row.auto.Q;
  const E = pick('E', null), F = pick('F', null), H = pick('H', null), R = pick('R', null);
  const S = pick('S', row.auto.S || null);
  const C = N + L + O;
  const P = Q * n0(R);
  const T = n0(S) * n0(R);
  const G = P + T;
  const noEnd = row.variant === 'noEnding';
  const I = noEnd ? n0(E) + G + n0(H) : n0(E) + G + n0(H) - n0(F);
  const J = noEnd ? C - I + n0(F) : C - I;
  const K = noEnd ? (C + n0(F) !== 0 ? J / (C + n0(F)) : null) : (C !== 0 ? J / C : null);
  const M = C !== 0 ? -(L / C) : null;
  return { N, L, O, Q, E, F, H, R, S, C, P, T, G, I, J, K, M };
}

export default function ProfitReportPage() {
  const weekInput = useWeekInput(getDefaultMajor());
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [data, setData] = useState(null);
  const [edits, setEdits] = useState({});   // { category: { colKey: 'value' } }
  const [note, setNote] = useState('');

  const load = async () => {
    setLoading(true); setError(''); setMessage(''); setEdits({});
    try {
      const res = await fetch(`/api/sales/profit-report?week=${encodeURIComponent(weekInput.value)}`, { credentials: 'same-origin' });
      const d = await res.json();
      if (!d.success) throw new Error(d.error || '조회 실패');
      setData(d);
      setNote(d.note || '');
    } catch (e) { setError(e.message); } finally { setLoading(false); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const save = async () => {
    setSaving(true); setError(''); setMessage('');
    try {
      const values = {};
      for (const row of data?.rows || []) {
        const e = edits[row.category] || {};
        const out = {};
        for (const col of ['E', 'F', 'H', 'R', 'S']) {
          if (e[col] !== undefined) out[col] = e[col] === '' ? null : Number(e[col]);
          else if (row.manual[col] != null) out[col] = row.manual[col];
        }
        if (Object.keys(out).length) values[row.category] = out;
      }
      const res = await fetch('/api/sales/profit-report', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin',
        body: JSON.stringify({ week: weekInput.value, values, note }),
      });
      const d = await res.json();
      if (!d.success) throw new Error(d.error || '저장 실패');
      setMessage('저장 완료 — 수기값(기초/기말/통관비/환율/포워딩)과 비고가 보관되었습니다.');
      await load();
    } catch (e) { setError(e.message); } finally { setSaving(false); }
  };

  const rowsCalc = useMemo(() => {
    const rows = (data?.rows || []).map(r => ({ ...r, calc: computeRow(r, edits) }));
    const nonDeduct = rows.filter(r => r.category !== '공제');
    const sum = (sel, list = rows) => list.reduce((s, r) => s + n0(sel(r.calc)), 0);
    const totals = {
      C: sum(c => c.C), E: sum(c => c.E), F: sum(c => c.F), J: sum(c => c.J), L: sum(c => c.L, nonDeduct),
      G: sum(c => c.G, nonDeduct), H: sum(c => c.H, nonDeduct), I: sum(c => c.I, nonDeduct),
      N: sum(c => c.N, nonDeduct), O: sum(c => c.O, nonDeduct), P: sum(c => c.P, nonDeduct),
      Q: sum(c => c.Q, nonDeduct), S: sum(c => c.S, nonDeduct), T: sum(c => c.T, nonDeduct),
    };
    totals.K = totals.C + totals.F !== 0 ? totals.J / (totals.C + totals.F) : null;
    totals.M = totals.C !== 0 ? -(totals.L / totals.C) : null;
    return { rows, totals };
  }, [data, edits]);

  const setEdit = (cat, col, val) => setEdits(prev => ({ ...prev, [cat]: { ...(prev[cat] || {}), [col]: val } }));
  const dirty = Object.keys(edits).length > 0;

  const EditCell = ({ row, col, width = 86 }) => {
    const e = edits[row.category]?.[col];
    const base = row.manual[col];
    const auto = col === 'S' ? row.auto.S : null;
    const val = e !== undefined ? e : (base != null ? base : '');
    const placeholder = col === 'S' && auto ? String(Math.round(auto * 100) / 100) : (col === 'E' && row.inheritedE ? '' : '');
    return (
      <input
        style={{ ...st.cellInput, width, background: e !== undefined ? '#fef9c3' : (base != null ? '#ecfdf5' : '#fff') }}
        value={val}
        placeholder={placeholder}
        title={col === 'S' ? '비우면 DB 추정치(placeholder) 사용, 입력하면 수기값 우선' : row.inheritedE && col === 'E' ? '전차수 기말재고에서 자동 이월됨' : ''}
        onChange={ev => setEdit(row.category, col, ev.target.value.replace(/[^0-9.\-]/g, ''))}
      />
    );
  };

  const { rows, totals } = rowsCalc;

  return (
    <div style={st.page}>
      <div style={st.bar}>
        <h1 style={st.h1}>📈 주차별 매출이익 보고서{data ? ` — ${data.major}차 (${data.orderYear})` : ''}</h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 'auto', flexWrap: 'wrap' }}>
          <label style={st.label}>차수</label>
          <input style={st.weekInput} value={weekInput.value} onChange={e => weekInput.setValue(e.target.value)} placeholder="27" />
          <button style={st.primaryBtn} onClick={load} disabled={loading}>{loading ? '조회 중…' : '조회'}</button>
          <button style={{ ...st.primaryBtn, background: dirty ? '#16a34a' : '#94a3b8' }} onClick={save} disabled={saving || !data}>
            {saving ? '저장 중…' : `저장${dirty ? ' *' : ''}`}
          </button>
        </div>
      </div>
      <div style={st.hint}>
        자동(파랑): 순수매출·불량·그외매출·구매금액 = 전산 DB / 수기(노랑=수정중·초록=저장됨): 기초·기말재고, 그외통관비, 환율, 포워딩.
        포워딩(USD)은 비우면 BILL 기반 추정치 사용. 기초재고는 전차수 기말에서 자동 이월.
        {data?.rates?.length ? ` · 참고 환율: ${data.rates.map(r => `${r.CurrencyCode} ${Number(r.ExchangeRate).toLocaleString()}`).join(' · ')}` : ''}
      </div>

      {error && <div style={st.error}>{error}</div>}
      {message && <div style={st.message}>{message}</div>}

      {data && (
        <div style={st.tableWrap}>
          <table style={st.table}>
            <thead>
              <tr>
                {['품명', '매출액', '매출비율', '기초상품재고액', '기말상품재고액', '매입액(상품+포워딩)', '그외통관비', '매출원가', '매출이익', '이익률', '불량금액', '불량율', '순수매출액', '그 외 매출액', '상품 금액(구매)', '구매금액(외화)', '환율', '포워딩(USD)', '포워딩 원화환산', '상품구매비율']
                  .map((h, i) => <th key={i} style={{ ...st.th, ...(i === 0 ? { ...st.stickyCol, background: '#1e293b', zIndex: 3 } : {}) }}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map(row => {
                const c = row.calc;
                const D = totals.C !== 0 ? c.C / totals.C : null;
                const U = totals.P !== 0 ? c.P / totals.P : null;
                return (
                  <tr key={row.category} style={row.category === '기타(미분류)' ? { background: '#fffbeb' } : undefined}>
                    <td style={{ ...st.td, ...st.stickyCol, fontWeight: 700 }}>{row.category}</td>
                    <td style={st.tdNum}>{fmt(c.C)}</td>
                    <td style={st.tdNum}>{pct(D)}</td>
                    <td style={st.tdNum}><EditCell row={row} col="E" /></td>
                    <td style={st.tdNum}><EditCell row={row} col="F" /></td>
                    <td style={st.tdNum}>{fmt(c.G)}</td>
                    <td style={st.tdNum}><EditCell row={row} col="H" width={74} /></td>
                    <td style={{ ...st.tdNum, fontWeight: 700 }}>{fmt(c.I)}</td>
                    <td style={{ ...st.tdNum, fontWeight: 700, color: c.J < 0 ? '#dc2626' : '#166534' }}>{fmt(c.J)}</td>
                    <td style={st.tdNum}>{pct(c.K)}</td>
                    <td style={{ ...st.tdNum, color: '#1d4ed8' }}>{fmt(c.L)}</td>
                    <td style={st.tdNum}>{pct(c.M)}</td>
                    <td style={{ ...st.tdNum, color: '#1d4ed8' }}>{fmt(c.N)}</td>
                    <td style={{ ...st.tdNum, color: '#1d4ed8' }}>{fmt(c.O)}</td>
                    <td style={st.tdNum}>{fmt(c.P)}</td>
                    <td style={{ ...st.tdNum, color: '#1d4ed8' }}>{c.Q ? Number(c.Q).toLocaleString(undefined, { maximumFractionDigits: 2 }) : ''}</td>
                    <td style={st.tdNum}><EditCell row={row} col="R" width={70} /></td>
                    <td style={st.tdNum}><EditCell row={row} col="S" width={86} /></td>
                    <td style={st.tdNum}>{fmt(c.T)}</td>
                    <td style={st.tdNum}>{pct(U)}</td>
                  </tr>
                );
              })}
              <tr style={{ background: '#e2e8f0', fontWeight: 800 }}>
                <td style={{ ...st.td, ...st.stickyCol, background: '#e2e8f0' }}>합계</td>
                <td style={st.tdNum}>{fmt(totals.C)}</td>
                <td style={st.tdNum}>{pct(1)}</td>
                <td style={st.tdNum}>{fmt(totals.E)}</td>
                <td style={st.tdNum}>{fmt(totals.F)}</td>
                <td style={st.tdNum}>{fmt(totals.G)}</td>
                <td style={st.tdNum}>{fmt(totals.H)}</td>
                <td style={st.tdNum}>{fmt(totals.I)}</td>
                <td style={{ ...st.tdNum, color: totals.J < 0 ? '#dc2626' : '#166534' }}>{fmt(totals.J)}</td>
                <td style={st.tdNum}>{pct(totals.K)}</td>
                <td style={st.tdNum}>{fmt(totals.L)}</td>
                <td style={st.tdNum}>{pct(totals.M)}</td>
                <td style={st.tdNum}>{fmt(totals.N)}</td>
                <td style={st.tdNum}>{fmt(totals.O)}</td>
                <td style={st.tdNum}>{fmt(totals.P)}</td>
                <td style={st.tdNum}>{totals.Q ? Number(totals.Q).toLocaleString(undefined, { maximumFractionDigits: 2 }) : ''}</td>
                <td style={st.tdNum}></td>
                <td style={st.tdNum}>{totals.S ? Number(totals.S).toLocaleString(undefined, { maximumFractionDigits: 2 }) : ''}</td>
                <td style={st.tdNum}>{fmt(totals.T)}</td>
                <td style={st.tdNum}>{pct(1)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {data && (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: '#334155', marginBottom: 4 }}>비고사항</div>
          <textarea
            style={st.noteArea}
            value={note}
            onChange={e => setNote(e.target.value)}
            placeholder="예: 콜롬비아 수국: 냉해 21박스 (약 1,644,545원) …"
          />
        </div>
      )}
    </div>
  );
}

const st = {
  page: { padding: 14, maxWidth: 1900, margin: '0 auto' },
  bar: { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6, flexWrap: 'wrap' },
  h1: { fontSize: 18, fontWeight: 800, margin: 0 },
  label: { fontSize: 13, fontWeight: 700, color: '#334155' },
  weekInput: { border: '1px solid #cbd5e1', borderRadius: 8, padding: '7px 10px', fontSize: 14, width: 70 },
  primaryBtn: { background: '#2563eb', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 16px', fontSize: 13, fontWeight: 700, cursor: 'pointer' },
  hint: { fontSize: 11.5, color: '#64748b', marginBottom: 10, lineHeight: 1.6 },
  error: { background: '#fef2f2', border: '1px solid #ef4444', color: '#b91c1c', borderRadius: 8, padding: '9px 12px', fontSize: 13, marginBottom: 8 },
  message: { background: '#ecfdf5', border: '1px solid #34d399', color: '#065f46', borderRadius: 8, padding: '9px 12px', fontSize: 13, marginBottom: 8 },
  tableWrap: { overflow: 'auto', maxHeight: 'calc(100vh - 220px)', border: '1px solid #cbd5e1', borderRadius: 10, background: '#fff' },
  table: { borderCollapse: 'collapse', fontSize: 12, minWidth: 1800 },
  th: { position: 'sticky', top: 0, background: '#1e293b', color: '#fff', padding: '7px 8px', fontSize: 11, whiteSpace: 'nowrap', zIndex: 2 },
  stickyCol: { position: 'sticky', left: 0, background: '#f8fafc', zIndex: 1, minWidth: 130 },
  td: { border: '1px solid #e2e8f0', padding: '5px 8px', whiteSpace: 'nowrap' },
  tdNum: { border: '1px solid #e2e8f0', padding: '5px 8px', textAlign: 'right', whiteSpace: 'nowrap' },
  cellInput: { border: '1px solid #cbd5e1', borderRadius: 5, padding: '3px 6px', fontSize: 12, textAlign: 'right' },
  noteArea: { width: '100%', minHeight: 90, border: '1px solid #cbd5e1', borderRadius: 8, padding: 10, fontSize: 13, boxSizing: 'border-box' },
};
