// components/CustomsClearancePanel.js — 그외통관비 입력 패널 (재사용 컴포넌트)
// 국가별(백상창고료/관세/선율/월드운송료/한국방역) + 콜롬비아 4품목 무게배분 공유값 입력.
// H(그외통관비) 자동값의 소스. week 는 부모가 제어(주차별 매출이익보고서에 임베드되거나 단독 페이지로 사용).
// 저장 시 onSaved() 호출 — 부모가 이걸로 매출이익보고서를 재조회해 자동 재계산에 반영한다.
import { useState, useEffect, useCallback, useMemo } from 'react';

const n0 = (v) => (v == null || v === '' || Number.isNaN(Number(v)) ? 0 : Number(v));
const fmt = (v) => Math.round(n0(v)).toLocaleString();

const RATE_FIELDS = [
  ['BakSangRate', '백상 창고료 (원/kg)'], ['Truck1t', '월드운송료 1t (원)'], ['Truck2_5t', '월드운송료 2.5t (원)'],
  ['Truck5t', '월드운송료 5t (원)'], ['QuarantinePerItemRate', '검역대행수수료 (원/품목)'],
];
const COLOMBIA_RATE_FIELDS = [
  ['BoxWeight_콜롬비아장미', '장미 박스당무게(kg)'], ['BoxWeight_콜롬비아카네이션', '카네이션 박스당무게'],
  ['BoxWeight_콜롬비아알스트로', '알스트로 박스당무게'], ['BoxWeight_콜롬비아루스커스', '루스커스 박스당무게'],
  ['BoxCBM_콜롬비아장미', '장미 박스당CBM'], ['BoxCBM_콜롬비아카네이션', '카네이션 박스당CBM'],
  ['BoxCBM_콜롬비아알스트로', '알스트로 박스당CBM'], ['BoxCBM_콜롬비아루스커스', '루스커스 박스당CBM'],
];
const COUNTRY_FIELD_GROUPS = [
  { label: '백상창고료 GW(kg)', keys: ['GW1', 'GW2'] },
  { label: '관세', keys: ['Customs1', 'Customs2'] },
  { label: '선율', keys: ['SunYul1', 'SunYul2'] },
  { label: '월드운송료', keys: ['WorldFreight1', 'WorldFreight2'] },
  { label: '한국방역', keys: ['Quarantine1', 'Quarantine2'] },
];
const COLOMBIA_FIELDS = [
  ['GW', 'GW(kg)'], ['CW', 'CW(kg)'], ['HandlingFee', '선율 통관수수료'], ['ItemCount', '품목수'],
  ['Truck1t', '트럭 1t 대수'], ['Truck2_5t', '트럭 2.5t 대수'], ['Truck5t', '트럭 5t 대수'],
  ['CustomsFee', '관세료'], ['DisinfectFee', '소독비용'], ['QuarantineDeductFee', '검역비용(차감stems)'],
];

// 필드명 → 화면표시 라벨 (이력 팝업용)
const FIELD_LABEL = Object.fromEntries([...COUNTRY_FIELD_GROUPS.flatMap((g) => g.keys.map((k, i) => [k, `${g.label}${i === 0 ? '(1차)' : '(2차)'}`])), ...COLOMBIA_FIELDS]);

// 입고관리 GW 기준값 힌트 — 있으면 클릭 적용, 없으면 '확인 필요' 표시만(입고 자체가 없을 수 있음: 사용자 방침)
function GwHint({ auto, current, onApply }) {
  const a = auto == null ? null : Math.round(Number(auto) * 10) / 10;
  const cur = current === '' || current == null ? null : Number(current);
  if (!a) {
    // 입고 GW 없음 — 수기값이 있을 때만 체크 배지 (미사용 국가 노이즈 방지)
    if (cur == null || cur === 0) return null;
    return <span style={{ fontSize: 9, color: '#b45309', fontWeight: 700, whiteSpace: 'nowrap' }} title="입고관리에 Gross weight 라인이 없어 대조 불가 — 값 직접 확인 필요">⚠ 입고GW없음·확인</span>;
  }
  const match = cur != null && Math.abs(cur - a) < 1;
  return (
    <button
      type="button"
      onClick={onApply}
      title={match ? '입고관리 Gross weight와 일치' : '클릭 → 입고관리 Gross weight 값 적용'}
      style={{
        fontSize: 9, fontWeight: 700, whiteSpace: 'nowrap', cursor: 'pointer',
        border: 'none', background: 'none', padding: 0,
        color: match ? '#059669' : '#dc2626',
      }}>
      입고 {a.toLocaleString()}{match ? ' ✓' : ' ↵'}
    </button>
  );
}

function HistoryButton({ orderYear, scopeType, scopeKey }) {
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
              <b>{FIELD_LABEL[h.FieldName] || h.FieldName}</b>: {h.OldValue == null ? '(없음)' : fmt(h.OldValue)} → {h.NewValue == null ? '(없음)' : fmt(h.NewValue)}
              <div style={{ color: '#94a3b8', fontSize: 10 }}>{h.ChangedBy || '?'} · {h.ChangedAt}</div>
            </div>
          ))}
        </div>
      )}
    </span>
  );
}

export default function CustomsClearancePanel({ week, onSaved }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [data, setData] = useState(null);
  const [countryEdits, setCountryEdits] = useState({});
  const [colombiaEdits, setColombiaEdits] = useState({});
  const [rateEdits, setRateEdits] = useState({});
  const [showRates, setShowRates] = useState(false);
  const [saving, setSaving] = useState('');

  const load = useCallback(async () => {
    if (!week) return;
    setLoading(true); setError(''); setMessage('');
    try {
      const r = await fetch(`/api/sales/customs-clearance?week=${encodeURIComponent(week)}`, { credentials: 'same-origin' });
      const d = await r.json();
      if (!d.success) throw new Error(d.error || '조회 실패');
      setData(d);
      setCountryEdits({}); setColombiaEdits({}); setRateEdits({});
    } catch (e) { setError(e.message); } finally { setLoading(false); }
  }, [week]);
  useEffect(() => { if (week) load(); }, [week, load]);

  const countryValue = (row, field) => {
    if (countryEdits[row.category]?.[field] !== undefined) return countryEdits[row.category][field];
    if (row.saved?.[field] != null) return row.saved[field];
    if (row.carry?.[field] != null) return row.carry[field];
    return '';
  };
  const setCountryEdit = (cat, field, val) => setCountryEdits((prev) => ({ ...prev, [cat]: { ...(prev[cat] || {}), [field]: val } }));

  const colValue = (c, field) => {
    if (colombiaEdits[c.orderWeek]?.[field] !== undefined) return colombiaEdits[c.orderWeek][field];
    if (c.saved?.[field] != null) return c.saved[field];
    if (c.carry?.[field] != null) return c.carry[field];
    return '';
  };
  const setColEdit = (wk, field, val) => setColombiaEdits((prev) => ({ ...prev, [wk]: { ...(prev[wk] || {}), [field]: val } }));

  const saveCountry = async (row) => {
    setSaving(row.category); setError('');
    try {
      const fields = COUNTRY_FIELD_GROUPS.flatMap((g) => g.keys);
      const out = {};
      fields.forEach((f) => { out[f] = countryValue(row, f); });
      const r = await fetch('/api/sales/customs-clearance', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin',
        body: JSON.stringify({ week, action: 'saveCountry', category: row.category, row: out }),
      });
      const d = await r.json();
      if (!d.success) throw new Error(d.error);
      setMessage(`${row.category} 저장 완료 — 매출이익보고서에 자동 반영됩니다`);
      await load();
      onSaved?.();
    } catch (e) { setError(e.message); } finally { setSaving(''); }
  };

  const saveColombia = async (c) => {
    setSaving(c.orderWeek); setError('');
    try {
      const out = {};
      COLOMBIA_FIELDS.forEach(([f]) => { out[f] = colValue(c, f); });
      const r = await fetch('/api/sales/customs-clearance', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin',
        body: JSON.stringify({ week, action: 'saveColombia', orderWeek: c.orderWeek, row: out }),
      });
      const d = await r.json();
      if (!d.success) throw new Error(d.error);
      setMessage(`${c.orderWeek} 콜롬비아 배분값 저장 완료 — 매출이익보고서에 자동 반영됩니다`);
      await load();
      onSaved?.();
    } catch (e) { setError(e.message); } finally { setSaving(''); }
  };

  const saveRates = async () => {
    setSaving('rates'); setError('');
    try {
      const merged = { ...data.rates, ...rateEdits };
      const r = await fetch('/api/sales/customs-clearance', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin',
        body: JSON.stringify({ week, action: 'saveRates', rates: merged }),
      });
      const d = await r.json();
      if (!d.success) throw new Error(d.error);
      setMessage('단가표 저장 완료');
      await load();
      onSaved?.();
    } catch (e) { setError(e.message); } finally { setSaving(''); }
  };

  const totalAll = useMemo(() => {
    if (!data) return 0;
    const countrySum = data.countries.reduce((s, r) => s + n0(r.total), 0);
    const colSum = (data.colombia || []).reduce((s, c) => s + Object.values(c.allocationH || {}).reduce((a, b) => a + n0(b), 0), 0);
    return countrySum + colSum;
  }, [data]);

  if (!week) return <div style={{ padding: 16, color: '#94a3b8', fontSize: 12 }}>차수를 먼저 조회하세요.</div>;

  return (
    <div>
      <div style={st.hint}>
        국가별(백상창고료GW×단가 그대로 + 관세 그대로 + 선율·월드운송료·한국방역 ÷1.1) 합산 = H(그외통관비).
        콜롬비아 4품목(카네이션·장미·알스트로·루스커스)은 반차수(1차/2차)별 통관비 TOTAL을 박스당무게×박스수량 비율로 배분(항상 무게비율).
        저장값 없으면 <b style={{ color: '#e65100' }}>전차수 값</b>이 기본으로 채워집니다 — 확인 후 저장하세요. 🕘 아이콘으로 수정 이력(누가·언제·얼마→얼마)을 볼 수 있습니다.
      </div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        <button style={st.secondaryBtn} onClick={() => setShowRates((v) => !v)}>{showRates ? '단가표 닫기' : '⚙ 단가표'}</button>
        {loading && <span style={{ fontSize: 12, color: '#64748b', alignSelf: 'center' }}>로딩중…</span>}
      </div>

      {error && <div style={st.error}>{error}</div>}
      {message && <div style={st.message}>{message}</div>}

      {showRates && data && (
        <div style={st.panel}>
          <div style={st.panelHead}><strong>⚙ 단가표 (관리자 수정 — 백상/트럭/검역대행/콜롬비아 박스당무게·CBM)</strong></div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, padding: 12 }}>
            {[...RATE_FIELDS, ...COLOMBIA_RATE_FIELDS].map(([key, label]) => (
              <label key={key} style={st.rateField}>
                <span style={{ fontSize: 11, color: '#64748b', display: 'flex', gap: 3, alignItems: 'center' }}>
                  {label} <HistoryButton orderYear="_global" scopeType="Rate" scopeKey={key} />
                </span>
                <input style={st.input} type="text"
                  value={rateEdits[key] !== undefined ? rateEdits[key] : (data.rates[key] ?? '')}
                  onChange={(e) => setRateEdits((p) => ({ ...p, [key]: e.target.value.replace(/[^0-9.]/g, '') }))} />
              </label>
            ))}
          </div>
          <div style={{ padding: '0 12px 12px' }}>
            <button style={st.primaryBtn} onClick={saveRates} disabled={saving === 'rates'}>단가표 저장</button>
          </div>
        </div>
      )}

      {data && (
        <>
          <div style={st.panel}>
            <div style={st.panelHead}><strong>국가별 그외통관비</strong><span style={{ marginLeft: 'auto', fontSize: 12, color: '#64748b' }}>합계(콜롬비아 4품목 포함) {fmt(totalAll)}원</span></div>
            <div style={{ overflowX: 'auto' }}>
              <table style={st.table}>
                <thead>
                  <tr>
                    <th style={st.th}>국가</th>
                    {COUNTRY_FIELD_GROUPS.map((g) => <th key={g.label} colSpan={2} style={st.th}>{g.label}(1차/2차)</th>)}
                    <th style={st.th}>합계</th><th style={st.th}></th>
                  </tr>
                </thead>
                <tbody>
                  {data.countries.map((row) => {
                    const carried = !row.saved && row.carry;
                    return (
                      <tr key={row.category} style={{ background: carried ? '#fff7ed' : '#fff' }}>
                        <td style={st.tdLabel}>{row.category}</td>
                        {COUNTRY_FIELD_GROUPS.flatMap((g) => g.keys).map((f) => {
                          const isGw = f === 'GW1' || f === 'GW2';
                          const auto = isGw ? data.autoGw?.countries?.[row.category]?.[f] : null;
                          return (
                            <td key={f} style={st.tdNum}>
                              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 1 }}>
                                <input style={st.cellInput} value={countryValue(row, f)}
                                  onChange={(e) => setCountryEdit(row.category, f, e.target.value.replace(/[^0-9.\-]/g, ''))} />
                                {isGw && (
                                  <GwHint auto={auto} current={countryValue(row, f)}
                                    onApply={() => setCountryEdit(row.category, f, String(Math.round(Number(auto) * 10) / 10))} />
                                )}
                              </div>
                            </td>
                          );
                        })}
                        <td style={st.tdNum}>{fmt(row.total)}</td>
                        <td style={st.tdNum}>
                          <div style={{ display: 'flex', gap: 3, alignItems: 'center' }}>
                            <button style={st.tinyBtn} onClick={() => saveCountry(row)} disabled={saving === row.category}>
                              {saving === row.category ? '저장중' : '저장'}
                            </button>
                            <HistoryButton orderYear={data.orderYear} scopeType="Country" scopeKey={`${data.major}|${row.category}`} />
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div style={st.panel}>
            <div style={st.panelHead}><strong>콜롬비아 4품목 무게배분 (반차수별 — 카네이션·장미·알스트로·루스커스 공유)</strong></div>
            {(data.colombia || []).map((c) => {
              const carried = !c.saved && c.carry;
              return (
                <div key={c.orderWeek} style={{ padding: 12, borderBottom: '1px solid #eef2f7', background: carried ? '#fff7ed' : '#fff' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                    <b style={{ fontSize: 13 }}>{c.orderWeek}</b>
                    <span style={{ fontSize: 11, color: '#64748b' }}>
                      박스수량(자동): 장미{c.boxQty['콜롬비아 장미'] || 0} · 카네이션{c.boxQty['콜롬비아 카네이션'] || 0} · 알스트로{c.boxQty['콜롬비아 알스트로'] || 0} · 루스커스{c.boxQty['콜롬비아 루스커스'] || 0}
                    </span>
                    <div style={{ marginLeft: 'auto', display: 'flex', gap: 4, alignItems: 'center' }}>
                      <button style={st.tinyBtn} onClick={() => saveColombia(c)} disabled={saving === c.orderWeek}>
                        {saving === c.orderWeek ? '저장중' : '저장'}
                      </button>
                      <HistoryButton orderYear={data.orderYear} scopeType="Colombia" scopeKey={c.orderWeek} />
                    </div>
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    {COLOMBIA_FIELDS.map(([f, label]) => {
                      const isGw = f === 'GW' || f === 'CW';
                      const auto = isGw ? data.autoGw?.colombia?.[c.orderWeek]?.[f] : null;
                      return (
                        <label key={f} style={st.rateField}>
                          <span style={{ fontSize: 10, color: '#64748b' }}>{label}</span>
                          <input style={st.input} value={colValue(c, f)}
                            onChange={(e) => setColEdit(c.orderWeek, f, e.target.value.replace(/[^0-9.\-]/g, ''))} />
                          {isGw && (
                            <GwHint auto={auto} current={colValue(c, f)}
                              onApply={() => setColEdit(c.orderWeek, f, String(Math.round(Number(auto) * 10) / 10))} />
                          )}
                        </label>
                      );
                    })}
                  </div>
                  <div style={{ marginTop: 8, fontSize: 12, color: '#334155' }}>
                    배분 미리보기(H): 장미 {fmt(c.allocationH['콜롬비아 장미'])} · 카네이션 {fmt(c.allocationH['콜롬비아 카네이션'])} ·
                    알스트로 {fmt(c.allocationH['콜롬비아 알스트로'])} · 루스커스 {fmt(c.allocationH['콜롬비아 루스커스'])}
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
  primaryBtn: { padding: '7px 16px', background: '#1d4ed8', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 700, fontSize: 12.5 },
  secondaryBtn: { padding: '7px 14px', background: '#fff', color: '#1d4ed8', border: '1px solid #1d4ed8', borderRadius: 6, cursor: 'pointer', fontWeight: 700, fontSize: 12.5 },
  tinyBtn: { padding: '4px 10px', background: '#0f766e', color: '#fff', border: 'none', borderRadius: 5, cursor: 'pointer', fontWeight: 700, fontSize: 11 },
  error: { background: '#fee2e2', color: '#b91c1c', padding: '8px 12px', borderRadius: 6, marginBottom: 8, fontSize: 12.5 },
  message: { background: '#dcfce7', color: '#166534', padding: '8px 12px', borderRadius: 6, marginBottom: 8, fontSize: 12.5 },
  panel: { background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, marginBottom: 12, overflow: 'hidden' },
  panelHead: { display: 'flex', alignItems: 'center', padding: '9px 12px', background: '#f1f5f9', borderBottom: '1px solid #e2e8f0', fontSize: 13 },
  table: { borderCollapse: 'collapse', width: '100%', fontSize: 12 },
  th: { padding: '6px 8px', background: '#f8fafc', borderBottom: '2px solid #e2e8f0', fontSize: 11, color: '#475569', whiteSpace: 'nowrap' },
  tdLabel: { padding: '4px 8px', fontWeight: 700, whiteSpace: 'nowrap', borderBottom: '1px solid #f1f5f9' },
  tdNum: { padding: '3px 6px', textAlign: 'right', borderBottom: '1px solid #f1f5f9', whiteSpace: 'nowrap' },
  cellInput: { width: 68, textAlign: 'right', border: '1px solid #cbd5e1', borderRadius: 4, padding: '3px 5px', fontSize: 11.5 },
  rateField: { display: 'flex', flexDirection: 'column', gap: 2 },
  input: { width: 100, padding: '5px 7px', border: '1px solid #cbd5e1', borderRadius: 5, fontSize: 12, textAlign: 'right' },
};

const hst = {
  histBtn: { border: '1px solid #cbd5e1', background: '#fff', borderRadius: 4, cursor: 'pointer', fontSize: 11, padding: '2px 5px', lineHeight: 1 },
  histPop: { position: 'absolute', top: '110%', right: 0, zIndex: 50, width: 260, maxHeight: 260, overflow: 'auto', background: '#fff', border: '1px solid #cbd5e1', borderRadius: 8, boxShadow: '0 6px 20px rgba(0,0,0,0.15)', padding: 10, fontSize: 11, textAlign: 'left' },
  histRow: { padding: '4px 0', borderTop: '1px solid #f1f5f9' },
};
