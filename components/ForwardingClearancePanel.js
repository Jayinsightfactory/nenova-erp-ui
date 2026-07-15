// components/ForwardingClearancePanel.js — 포워딩 입력 패널 (재사용 컴포넌트)
// 네덜란드/중국/콜롬비아 수국/에콰도르/태국 국가별 USD 직접입력 + 콜롬비아 4품목 항공료 총액(반차수 공유값).
// S(포워딩) 자동값의 소스. week 는 부모가 제어(주차별 매출이익보고서에 임베드되거나 단독 페이지로 사용).
import { useState, useEffect, useCallback } from 'react';

const fmt2 = (v) => (v == null ? '' : Number(v).toLocaleString(undefined, { maximumFractionDigits: 2 }));

const COUNTRY_LABEL = {
  '네덜란드': '네덜란드 (SERVICE FEE 인보이스)', '중국': '중국 (SERVICE FEE 인보이스)',
  '콜롬비아 수국': '콜롬비아 수국 (freightwise)', '에콰도르': '에콰도르 (freightwise ecuador)', '태국': '태국 (외부 엑셀)',
};

function HistoryButton({ orderYear, scopeType, scopeKey, fieldLabel = {} }) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState(null);
  const toggle = async () => {
    if (open) { setOpen(false); return; }
    setOpen(true);
    if (rows == null) {
      try {
        const r = await fetch(`/api/sales/customs-history?year=${encodeURIComponent(orderYear)}&scopeType=${encodeURIComponent(scopeType)}&scopeKey=${encodeURIComponent(scopeKey)}`, { credentials: 'same-origin' });
        const d = await r.json();
        setRows(d.success ? d.rows : []);
      } catch { setRows([]); }
    }
  };
  return (
    <span style={{ position: 'relative', display: 'inline-block' }}>
      <button type="button" style={hst.histBtn} onClick={toggle} title="수정 이력">🕘</button>
      {open && (
        <div style={hst.histPop}>
          <div style={{ fontWeight: 700, marginBottom: 4, display: 'flex', justifyContent: 'space-between' }}>
            수정 이력 <span style={{ cursor: 'pointer', color: '#94a3b8' }} onClick={() => setOpen(false)}>✕</span>
          </div>
          {rows == null && <div style={{ color: '#94a3b8' }}>불러오는 중…</div>}
          {rows && rows.length === 0 && <div style={{ color: '#94a3b8' }}>수정 이력 없음</div>}
          {rows && rows.map((h, i) => (
            <div key={i} style={hst.histRow}>
              <b>{fieldLabel[h.FieldName] || h.FieldName}</b>: {h.OldValue == null ? '(없음)' : fmt2(h.OldValue)} → {h.NewValue == null ? '(없음)' : fmt2(h.NewValue)}
              <div style={{ color: '#94a3b8', fontSize: 10 }}>{h.ChangedBy || '?'} · {h.ChangedAt}</div>
            </div>
          ))}
        </div>
      )}
    </span>
  );
}

export default function ForwardingClearancePanel({ week, onSaved }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [data, setData] = useState(null);
  const [directEdits, setDirectEdits] = useState({});
  const [airEdits, setAirEdits] = useState({});
  const [saving, setSaving] = useState('');

  const load = useCallback(async () => {
    if (!week) return;
    setLoading(true); setError(''); setMessage('');
    try {
      const r = await fetch(`/api/sales/forwarding-clearance?week=${encodeURIComponent(week)}`, { credentials: 'same-origin' });
      const d = await r.json();
      if (!d.success) throw new Error(d.error || '조회 실패');
      setData(d);
      setDirectEdits({}); setAirEdits({});
    } catch (e) { setError(e.message); } finally { setLoading(false); }
  }, [week]);
  useEffect(() => { if (week) load(); }, [week, load]);

  // 입력칸 = 수기 override 값만(자동감지값은 placeholder로 보여주고 입력칸엔 안 채움) — 자동감지가 1순위이므로
  // "저장값 없으면 자동감지 그대로 쓰인다"는 걸 화면에서 분명히 하기 위함(2026-07-10).
  const directValue = (row) => (directEdits[row.category] !== undefined ? directEdits[row.category] : (row.saved ?? ''));
  const airValue = (c) => (airEdits[c.orderWeek] !== undefined ? airEdits[c.orderWeek] : (c.savedAirRateUSD ?? ''));

  const saveDirect = async (row) => {
    setSaving(row.category); setError('');
    try {
      const r = await fetch('/api/sales/forwarding-clearance', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin',
        body: JSON.stringify({ week, action: 'saveDirect', category: row.category, amountUSD: directValue(row) }),
      });
      const d = await r.json();
      if (!d.success) throw new Error(d.error);
      setMessage(`${row.category} 저장 완료 — 매출이익보고서에 자동 반영됩니다`);
      await load();
      onSaved?.();
    } catch (e) { setError(e.message); } finally { setSaving(''); }
  };

  const saveAir = async (c) => {
    setSaving(c.orderWeek); setError('');
    try {
      const r = await fetch('/api/sales/forwarding-clearance', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin',
        body: JSON.stringify({ week, action: 'saveColombiaAir', orderWeek: c.orderWeek, airRateUSD: airValue(c) }),
      });
      const d = await r.json();
      if (!d.success) throw new Error(d.error);
      setMessage(`${c.orderWeek} 항공료 총액 저장 완료 — 매출이익보고서에 자동 반영됩니다`);
      await load();
      onSaved?.();
    } catch (e) { setError(e.message); } finally { setSaving(''); }
  };

  if (!week) return <div style={{ padding: 16, color: '#94a3b8', fontSize: 12 }}>차수를 먼저 조회하세요.</div>;

  return (
    <div>
      <div style={st.hint}>
        <b style={{ color: '#166534' }}>입고관리에서 자동감지</b>됩니다(WarehouseDetail의 '운송료'/'SERVICE FEE' 라인을 농장·인보이스로 국가 판별).
        회색 자동감지값이 그대로 계산에 쓰이며, 새 농장이라 못 잡혔거나 값을 고칠 땐 아래 입력칸에 직접 넣으면 그 값이 우선(override)됩니다.
        콜롬비아 카네이션·장미·알스트로·루스커스는 반차수 총액을 [📦 그외통관비 입력]에서 저장한 GW/CW·박스수량 비율로 자동 배분됩니다
        (GW≈CW면 무게비율, 아니면 CBM비율). 🕘 아이콘으로 수정 이력을 볼 수 있습니다.
      </div>
      {loading && <span style={{ fontSize: 12, color: '#64748b' }}>로딩중…</span>}
      {error && <div style={st.error}>{error}</div>}
      {message && <div style={st.message}>{message}</div>}

      {data && (
        <>
          <div style={st.panel}>
            <div style={st.panelHead}><strong>국가별 포워딩(USD)</strong></div>
            <table style={st.table}>
              <thead><tr><th style={st.th}>국가</th><th style={st.th}>자동감지(USD)</th><th style={st.th}>override 입력</th><th style={st.th}></th></tr></thead>
              <tbody>
                {data.direct.map((row) => {
                  const overridden = row.saved != null;
                  const missing = row.auto == null && row.saved == null;
                  return (
                    <tr key={row.category} style={{ background: overridden ? '#fef9c3' : missing ? '#fff7ed' : '#fff' }}>
                      <td style={st.tdLabel}>{COUNTRY_LABEL[row.category] || row.category}</td>
                      <td style={st.tdNum}>{row.auto != null ? fmt2(row.auto) : <span style={{ color: '#dc2626' }}>미감지</span>}</td>
                      <td style={st.tdNum}>
                        <input style={st.cellInput} value={directValue(row)} placeholder={row.auto != null ? String(row.auto) : '직접 입력'}
                          onChange={(e) => setDirectEdits((p) => ({ ...p, [row.category]: e.target.value.replace(/[^0-9.\-]/g, '') }))} />
                      </td>
                      <td style={st.tdNum}>
                        <div style={{ display: 'flex', gap: 3, alignItems: 'center' }}>
                          <button style={st.tinyBtn} onClick={() => saveDirect(row)} disabled={saving === row.category}>
                            {saving === row.category ? '저장중' : '저장'}
                          </button>
                          <HistoryButton orderYear={data.orderYear} scopeType="Forwarding" scopeKey={`${data.major}|${row.category}`} fieldLabel={{ AmountUSD: 'USD 금액' }} />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div style={st.panel}>
            <div style={st.panelHead}><strong>콜롬비아 4품목 항공료 총액 (반차수별)</strong></div>
            {(data.colombia || []).map((c) => {
              const overridden = c.savedAirRateUSD != null;
              const missing = !c.autoAirTotal && !overridden;
              return (
                <div key={c.orderWeek} style={{ padding: 12, borderBottom: '1px solid #eef2f7', background: overridden ? '#fef9c3' : missing ? '#fff7ed' : '#fff' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                    <b style={{ fontSize: 13 }}>{c.orderWeek}</b>
                    <span style={{ fontSize: 11, color: '#64748b' }}>GW={c.gw ?? '-'} CW={c.cw ?? '-'} (그외통관비 입력 화면 저장값)</span>
                    <span style={{ fontSize: 11, color: '#166534', fontWeight: 700 }}>자동감지 {fmt2(c.autoAirTotal)} USD</span>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 4, marginLeft: 'auto', fontSize: 12 }}>
                      항공료 총액 override(USD)
                      <input style={st.cellInput} value={airValue(c)} placeholder={String(c.autoAirTotal ?? '')}
                        onChange={(e) => setAirEdits((p) => ({ ...p, [c.orderWeek]: e.target.value.replace(/[^0-9.\-]/g, '') }))} />
                    </label>
                    <button style={st.tinyBtn} onClick={() => saveAir(c)} disabled={saving === c.orderWeek}>
                      {saving === c.orderWeek ? '저장중' : '저장'}
                    </button>
                    <HistoryButton orderYear={data.orderYear} scopeType="Colombia" scopeKey={c.orderWeek} fieldLabel={{ AirRateUSD: '항공료 총액' }} />
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
  );
}

const st = {
  hint: { fontSize: 11.5, color: '#64748b', background: '#eef2ff', border: '1px solid #c7d2fe', borderRadius: 8, padding: '8px 10px', marginBottom: 10, lineHeight: 1.5 },
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

const hst = {
  histBtn: { border: '1px solid #cbd5e1', background: '#fff', borderRadius: 4, cursor: 'pointer', fontSize: 11, padding: '2px 5px', lineHeight: 1 },
  histPop: { position: 'absolute', top: '110%', right: 0, zIndex: 50, width: 260, maxHeight: 260, overflow: 'auto', background: '#fff', border: '1px solid #cbd5e1', borderRadius: 8, boxShadow: '0 6px 20px rgba(0,0,0,0.15)', padding: 10, fontSize: 11, textAlign: 'left' },
  histRow: { padding: '4px 0', borderTop: '1px solid #f1f5f9' },
};
