// pages/sales/forwarding-clearance.js — 포워딩 입력 (팝업 전용, 사이드바 없음)
// 네덜란드·중국·콜롬비아 수국·에콰도르·태국 국가별 USD 직접입력 + 콜롬비아 4품목 항공료단가(반차수 공유값).
// S(포워딩) 자동값의 소스 — 주차별 매출이익 보고서에서 [🚢 포워딩 입력]으로 연결.
import { useState, useEffect, useCallback } from 'react';
import Head from 'next/head';
import { useWeekInput, getCurrentWeek } from '../../lib/useWeekInput';

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

const fmt2 = (v) => (v == null ? '' : Number(v).toLocaleString(undefined, { maximumFractionDigits: 2 }));

const COUNTRY_LABEL = {
  '네덜란드': '네덜란드 (SERVICE FEE 인보이스)', '중국': '중국 (SERVICE FEE 인보이스)',
  '콜롬비아 수국': '콜롬비아 수국 (freightwise)', '에콰도르': '에콰도르 (freightwise ecuador)', '태국': '태국 (외부 엑셀)',
};

export default function ForwardingClearancePage() {
  const weekInput = useWeekInput(initialWeek());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [data, setData] = useState(null);
  const [directEdits, setDirectEdits] = useState({});
  const [airEdits, setAirEdits] = useState({});
  const [saving, setSaving] = useState('');

  const load = useCallback(async () => {
    if (!weekInput.value) return;
    setLoading(true); setError(''); setMessage('');
    try {
      const r = await fetch(`/api/sales/forwarding-clearance?week=${encodeURIComponent(weekInput.value)}`, { credentials: 'same-origin' });
      const d = await r.json();
      if (!d.success) throw new Error(d.error || '조회 실패');
      setData(d);
      setDirectEdits({}); setAirEdits({});
    } catch (e) { setError(e.message); } finally { setLoading(false); }
  }, [weekInput.value]);
  useEffect(() => { if (weekInput.value) load(); }, [weekInput.value, load]);

  const directValue = (row) => {
    if (directEdits[row.category] !== undefined) return directEdits[row.category];
    if (row.saved != null) return row.saved;
    if (row.carry != null) return row.carry;
    return '';
  };
  const airValue = (c) => {
    if (airEdits[c.orderWeek] !== undefined) return airEdits[c.orderWeek];
    if (c.savedAirRateUSD != null) return c.savedAirRateUSD;
    if (c.carryAirRateUSD != null) return c.carryAirRateUSD;
    return '';
  };

  const saveDirect = async (row) => {
    setSaving(row.category); setError('');
    try {
      const r = await fetch('/api/sales/forwarding-clearance', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin',
        body: JSON.stringify({ week: weekInput.value, action: 'saveDirect', category: row.category, amountUSD: directValue(row) }),
      });
      const d = await r.json();
      if (!d.success) throw new Error(d.error);
      setMessage(`${row.category} 저장 완료`);
      await load();
    } catch (e) { setError(e.message); } finally { setSaving(''); }
  };

  const saveAir = async (c) => {
    setSaving(c.orderWeek); setError('');
    try {
      const r = await fetch('/api/sales/forwarding-clearance', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin',
        body: JSON.stringify({ week: weekInput.value, action: 'saveColombiaAir', orderWeek: c.orderWeek, airRateUSD: airValue(c) }),
      });
      const d = await r.json();
      if (!d.success) throw new Error(d.error);
      setMessage(`${c.orderWeek} 항공료단가 저장 완료`);
      await load();
    } catch (e) { setError(e.message); } finally { setSaving(''); }
  };

  return (
    <>
      <Head><title>🚢 포워딩 입력 - nenova ERP</title></Head>
      <div style={st.page}>
        <div style={st.bar}>
          <h1 style={st.h1}>🚢 포워딩 입력{data ? ` — ${data.major}차 (${data.orderYear})` : ''}</h1>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 'auto' }}>
            <input style={st.weekInput} {...weekInput.props} placeholder="27" />
            <button style={st.primaryBtn} onClick={load} disabled={loading}>{loading ? '조회 중…' : '조회'}</button>
          </div>
        </div>
        <div style={st.hint}>
          5개 국가 모두 우리 DB엔 없는 값 — 매주 외부 소스(인보이스·freightwise류 웹조회·엑셀)를 보고 USD로 직접 입력합니다.
          콜롬비아 카네이션·장미·알스트로·루스커스는 항공료단가(USD/kg) 하나만 입력하면 [📦 그외통관비 입력]에서 저장한 GW/CW·박스수량 비율로
          자동 배분됩니다(GW≈CW면 무게비율, 아니면 CBM비율). 저장값 없으면 <b style={{ color: '#e65100' }}>전차수 값</b>이 기본으로 채워집니다.
        </div>

        {error && <div style={st.error}>{error}</div>}
        {message && <div style={st.message}>{message}</div>}

        {data && (
          <>
            <div style={st.panel}>
              <div style={st.panelHead}><strong>국가별 포워딩(USD) 직접입력</strong></div>
              <table style={st.table}>
                <thead><tr><th style={st.th}>국가</th><th style={st.th}>USD 금액</th><th style={st.th}></th></tr></thead>
                <tbody>
                  {data.direct.map((row) => {
                    const carried = row.saved == null && row.carry != null;
                    return (
                      <tr key={row.category} style={{ background: carried ? '#fff7ed' : '#fff' }}>
                        <td style={st.tdLabel}>{COUNTRY_LABEL[row.category] || row.category}</td>
                        <td style={st.tdNum}>
                          <input style={st.cellInput} value={directValue(row)}
                            onChange={(e) => setDirectEdits((p) => ({ ...p, [row.category]: e.target.value.replace(/[^0-9.\-]/g, '') }))} />
                        </td>
                        <td style={st.tdNum}>
                          <button style={st.tinyBtn} onClick={() => saveDirect(row)} disabled={saving === row.category}>
                            {saving === row.category ? '저장중' : '저장'}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div style={st.panel}>
              <div style={st.panelHead}><strong>콜롬비아 4품목 항공료단가 (반차수별)</strong></div>
              {(data.colombia || []).map((c) => {
                const carried = c.savedAirRateUSD == null && c.carryAirRateUSD != null;
                return (
                  <div key={c.orderWeek} style={{ padding: 12, borderBottom: '1px solid #eef2f7', background: carried ? '#fff7ed' : '#fff' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                      <b style={{ fontSize: 13 }}>{c.orderWeek}</b>
                      <span style={{ fontSize: 11, color: '#64748b' }}>GW={c.gw ?? '-'} CW={c.cw ?? '-'} (그외통관비 입력 화면 저장값)</span>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 4, marginLeft: 'auto', fontSize: 12 }}>
                        항공료단가(USD/kg)
                        <input style={st.cellInput} value={airValue(c)}
                          onChange={(e) => setAirEdits((p) => ({ ...p, [c.orderWeek]: e.target.value.replace(/[^0-9.\-]/g, '') }))} />
                      </label>
                      <button style={st.tinyBtn} onClick={() => saveAir(c)} disabled={saving === c.orderWeek}>
                        {saving === c.orderWeek ? '저장중' : '저장'}
                      </button>
                    </div>
                    <div style={{ fontSize: 12, color: '#334155' }}>
                      배분 미리보기(S, USD): 장미 {fmt2(c.allocationS['콜롬비아 장미'])} · 카네이션 {fmt2(c.allocationS['콜롬비아 카네이션'])} ·
                      알스트로 {fmt2(c.allocationS['콜롬비아 알스트로'])} · 루스커스 {fmt2(c.allocationS['콜롬비아 루스커스'])}
                    </div>
                  </div>
                );
              })}
              {(!data.colombia || data.colombia.length === 0) && <div style={{ padding: 16, color: '#94a3b8', fontSize: 12 }}>이 차수에 콜롬비아 입고 데이터가 없습니다.</div>}
            </div>
          </>
        )}
      </div>
    </>
  );
}

const st = {
  page: { padding: '10px 14px', fontFamily: "'Malgun Gothic', sans-serif", background: '#f5f7fa', minHeight: '100vh' },
  bar: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' },
  h1: { fontSize: 17, fontWeight: 800, color: '#1e293b', margin: 0 },
  hint: { fontSize: 11.5, color: '#64748b', background: '#eef2ff', border: '1px solid #c7d2fe', borderRadius: 8, padding: '8px 10px', marginBottom: 10, lineHeight: 1.5 },
  weekInput: { width: 90, padding: '6px 8px', border: '1px solid #cbd5e1', borderRadius: 6, textAlign: 'center', fontWeight: 700 },
  primaryBtn: { padding: '7px 16px', background: '#0f766e', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 700, fontSize: 12.5 },
  tinyBtn: { padding: '4px 12px', background: '#0f766e', color: '#fff', border: 'none', borderRadius: 5, cursor: 'pointer', fontWeight: 700, fontSize: 11 },
  error: { background: '#fee2e2', color: '#b91c1c', padding: '8px 12px', borderRadius: 6, marginBottom: 8, fontSize: 12.5 },
  message: { background: '#dcfce7', color: '#166534', padding: '8px 12px', borderRadius: 6, marginBottom: 8, fontSize: 12.5 },
  panel: { background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, marginBottom: 12, overflow: 'hidden' },
  panelHead: { display: 'flex', alignItems: 'center', padding: '9px 12px', background: '#f1f5f9', borderBottom: '1px solid #e2e8f0', fontSize: 13 },
  table: { borderCollapse: 'collapse', width: '100%', fontSize: 12.5 },
  th: { padding: '6px 8px', background: '#f8fafc', borderBottom: '2px solid #e2e8f0', fontSize: 11, color: '#475569', textAlign: 'left' },
  tdLabel: { padding: '6px 8px', fontWeight: 700, borderBottom: '1px solid #f1f5f9' },
  tdNum: { padding: '4px 8px', borderBottom: '1px solid #f1f5f9' },
  cellInput: { width: 100, textAlign: 'right', border: '1px solid #cbd5e1', borderRadius: 4, padding: '4px 6px', fontSize: 12 },
};
