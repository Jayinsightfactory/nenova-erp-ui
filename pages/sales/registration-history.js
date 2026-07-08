// 판매등록 히스토리 — 차수별 분배(매출) 고정 스냅샷과 변경 이력.
// 화 17:00(최종 분배 적용, 불변) · 수 16:00(점검, 불변) · 변경감지(CHANGE) · 수동(MANUAL).
// 화요일 이후 수치가 바뀌면(AI 작업 포함) 어디가 얼마나 달라졌는지 찾아내는 화면.
import { useEffect, useMemo, useState } from 'react';
// Layout 은 _app.js 가 전역 래핑 — 페이지 자체 래핑 금지(이중 사이드바 원인)
import { getCurrentWeek, useWeekInput } from '../../lib/useWeekInput';

function getDefaultWeek() {
  const current = getCurrentWeek();
  const m = String(current || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[2]}-${m[3]}` : current;
}
const fmt = n => Number(n || 0).toLocaleString();
const TYPE_META = {
  TUE_FINAL: { label: '🔒 화요일 최종분배', color: '#1d4ed8', bg: '#dbeafe' },
  WED_CHECK: { label: '🔒 수요일 점검', color: '#7c3aed', bg: '#ede9fe' },
  CHANGE: { label: '⚠ 변경감지', color: '#b91c1c', bg: '#fee2e2' },
  MANUAL: { label: '📌 수동', color: '#334155', bg: '#e2e8f0' },
};

export default function SalesRegistrationHistoryPage() {
  const weekInput = useWeekInput(getDefaultWeek());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [data, setData] = useState(null);            // { snapshots, live }
  const [selKey, setSelKey] = useState(null);        // 선택 스냅샷
  const [rows, setRows] = useState([]);              // 선택 스냅샷 행
  const [selCust, setSelCust] = useState(null);      // 업체 시트 선택
  const [viewTab, setViewTab] = useState('cust');    // cust | flower
  const [diff, setDiff] = useState(null);            // 기준 vs 현재 diff
  const [changeLog, setChangeLog] = useState(null);

  const load = async () => {
    setLoading(true); setError(''); setMessage(''); setDiff(null); setChangeLog(null); setSelCust(null);
    try {
      const res = await fetch(`/api/sales/registration-history?week=${encodeURIComponent(weekInput.value)}`, { credentials: 'same-origin' });
      const d = await res.json();
      if (!d.success) throw new Error(d.error || '조회 실패');
      setData(d);
      const baseline = (d.snapshots || []).find(s => s.SnapshotType === 'TUE_FINAL');
      const first = baseline || (d.snapshots || [])[0];
      if (first) await selectSnapshot(first.SnapshotKey);
      else { setSelKey(null); setRows([]); }
    } catch (e) { setError(e.message); } finally { setLoading(false); }
  };

  const selectSnapshot = async (key) => {
    setSelKey(key); setSelCust(null);
    try {
      const res = await fetch(`/api/sales/registration-history?week=${encodeURIComponent(weekInput.value)}&rows=${key}`, { credentials: 'same-origin' });
      const d = await res.json();
      setRows(d.rows || []);
    } catch { setRows([]); }
  };

  const runDiff = async (fromKey) => {
    setDiff(null);
    try {
      const res = await fetch(`/api/sales/registration-history?week=${encodeURIComponent(weekInput.value)}&diffFrom=${fromKey}&diffTo=current`, { credentials: 'same-origin' });
      const d = await res.json();
      if (d.success) setDiff({ fromKey, ...d.diff });
    } catch { /* ignore */ }
  };

  const loadChangeLog = async () => {
    try {
      const res = await fetch(`/api/sales/registration-history?week=${encodeURIComponent(weekInput.value)}&changeLog=1`, { credentials: 'same-origin' });
      const d = await res.json();
      if (d.success) setChangeLog(d);
    } catch { /* ignore */ }
  };

  const post = async (action) => {
    setMessage(''); setError('');
    try {
      const res = await fetch('/api/sales/registration-history', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin',
        body: JSON.stringify({ action, week: weekInput.value }),
      });
      const d = await res.json();
      if (!d.success) throw new Error(d.error || '실패');
      if (action === 'checkNow') setMessage(d.changed ? `변경 발견 → CHANGE 스냅샷 기록: ${d.note || ''}` : '변경 없음 — 마지막 스냅샷과 현재 DB가 일치합니다.');
      else setMessage(d.skipped ? `건너뜀 (${d.reason})` : `수동 스냅샷 저장 (#${d.snapshotKey}, ${fmt(d.rowCnt)}행)`);
      await load();
    } catch (e) { setError(e.message); }
  };

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const baseline = (data?.snapshots || []).find(s => s.SnapshotType === 'TUE_FINAL');
  const baselineTotal = baseline ? Number(baseline.TotalAmount) + Number(baseline.TotalVat) : null;
  const liveTotal = data?.live?.total ?? null;
  const driftAmt = baselineTotal != null && liveTotal != null ? liveTotal - baselineTotal : null;

  // 업체별 합산 (Amount+Vat)
  const byCust = useMemo(() => {
    const m = new Map();
    for (const r of rows) {
      const k = r.CustKey ?? r.CustName;
      if (!m.has(k)) m.set(k, { custKey: r.CustKey, custName: r.CustName || '(미지정)', total: 0, sdCnt: 0, estCnt: 0 });
      const e = m.get(k);
      e.total += Number(r.Amount || 0) + Number(r.Vat || 0);
      if (r.RowType === 'SD') e.sdCnt += 1; else e.estCnt += 1;
    }
    return [...m.values()].sort((a, b) => b.total - a.total);
  }, [rows]);

  // 품종별 합산
  const byFlower = useMemo(() => {
    const m = new Map();
    for (const r of rows) {
      const k = r.CountryFlower || `${r.CounName}${r.FlowerName}` || '(기타)';
      if (!m.has(k)) m.set(k, { name: k, total: 0, estQty: 0 });
      const e = m.get(k);
      e.total += Number(r.Amount || 0) + Number(r.Vat || 0);
      if (r.RowType === 'SD') e.estQty += Number(r.EstQuantity || 0);
    }
    return [...m.values()].sort((a, b) => b.total - a.total);
  }, [rows]);

  const custRows = useMemo(() => {
    if (selCust == null) return [];
    return rows.filter(r => (r.CustKey ?? r.CustName) === selCust)
      .sort((a, b) => (a.RowType === b.RowType ? String(a.ProdName).localeCompare(String(b.ProdName)) : a.RowType === 'SD' ? -1 : 1));
  }, [rows, selCust]);

  const selSnap = (data?.snapshots || []).find(s => s.SnapshotKey === selKey);

  return (
    <div style={st.page}>
      <h1 style={st.h1}>🧾 판매등록 히스토리</h1>
      <p style={st.desc}>
        매주 <b>화요일 17:00 최종 분배 적용</b>과 <b>수요일 16:00 점검</b> 기준값이 자동으로 고정 저장됩니다(수정 불가).
        이후 수치가 바뀌면 — 웹·전산·AI 작업 무엇이든 — <b>변경감지</b> 스냅샷이 자동 기록되어 어디가 얼마나 달라졌는지 추적합니다.
      </p>

      <div style={st.bar}>
        <label style={st.label}>차수</label>
        <input style={st.weekInput} value={weekInput.value} onChange={e => weekInput.setValue(e.target.value)} placeholder="예: 28-01" />
        <button style={st.primaryBtn} onClick={load} disabled={loading}>{loading ? '조회 중…' : '조회'}</button>
        <button style={st.secondaryBtn} onClick={() => post('checkNow')} disabled={loading}>지금 변경검사</button>
        <button style={st.secondaryBtn} onClick={() => post('manual')} disabled={loading}>수동 스냅샷</button>
        {driftAmt != null && (
          <span style={{ fontSize: 13, fontWeight: 800, color: Math.abs(driftAmt) > 0.5 ? '#dc2626' : '#059669' }}>
            {Math.abs(driftAmt) > 0.5
              ? `⚠ 현재 DB가 화요일 기준과 ${fmt(Math.round(driftAmt))}원 다릅니다`
              : '✓ 현재 DB = 화요일 최종분배 기준과 일치'}
          </span>
        )}
      </div>

      {error && <div style={st.error}>{error}</div>}
      {message && <div style={st.message}>{message}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: '330px 1fr', gap: 12, alignItems: 'start' }}>
        {/* 좌: 스냅샷 타임라인 */}
        <div style={st.panel}>
          <div style={st.panelHead}><strong>스냅샷 타임라인</strong></div>
          <div style={{ maxHeight: 'calc(100vh - 300px)', overflow: 'auto' }}>
            {(data?.snapshots || []).length === 0 && (
              <div style={{ padding: 12, fontSize: 12, color: '#64748b' }}>
                이 차수의 스냅샷이 아직 없습니다. 화요일 17:00에 자동 생성되며, 지금 [수동 스냅샷]으로 만들 수도 있습니다.
              </div>
            )}
            {(data?.snapshots || []).map(s => {
              const meta = TYPE_META[s.SnapshotType] || TYPE_META.MANUAL;
              const on = s.SnapshotKey === selKey;
              return (
                <div key={s.SnapshotKey}
                  style={{ padding: '8px 10px', borderBottom: '1px solid #eef2f7', cursor: 'pointer', background: on ? '#f0f9ff' : '#fff' }}
                  onClick={() => selectSnapshot(s.SnapshotKey)}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: 10, fontWeight: 800, color: meta.color, background: meta.bg, borderRadius: 999, padding: '2px 8px' }}>{meta.label}</span>
                    <span style={{ fontSize: 11, color: '#64748b' }}>#{s.SnapshotKey}</span>
                    <span style={{ marginLeft: 'auto', fontSize: 11, color: '#64748b' }}>{s.takenAt}</span>
                  </div>
                  <div style={{ display: 'flex', gap: 10, marginTop: 3, fontSize: 12 }}>
                    <b>{fmt(Math.round(Number(s.TotalAmount) + Number(s.TotalVat)))}원</b>
                    <span style={{ color: '#64748b' }}>{fmt(s.RowCnt)}행</span>
                    <button style={st.tinyBtn} onClick={(e) => { e.stopPropagation(); runDiff(s.SnapshotKey); }}>현재와 비교</button>
                  </div>
                  {s.Note && <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 2 }}>{s.Note}</div>}
                </div>
              );
            })}
          </div>
          <div style={{ padding: '8px 10px', borderTop: '1px solid #e2e8f0' }}>
            <button style={{ ...st.secondaryBtn, width: '100%' }} onClick={loadChangeLog}>변경 주체 로그 보기 (화요일 이후)</button>
          </div>
        </div>

        {/* 우: 선택 스냅샷 내용 */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
          {diff && (
            <div style={{ ...st.panel, borderColor: diff.hasDiff ? '#fca5a5' : '#86efac' }}>
              <div style={st.panelHead}>
                <strong>#{diff.fromKey} vs 현재 DB</strong>
                <span style={{ fontSize: 12, fontWeight: 800, color: diff.hasDiff ? '#dc2626' : '#059669' }}>
                  {diff.hasDiff ? `수정 ${diff.changed.length} · 추가 ${diff.added.length} · 삭제 ${diff.removed.length} · Δ합계 ${fmt(Math.round(diff.amtDelta))}원` : '완전 일치'}
                </span>
              </div>
              {diff.hasDiff && (
                <div style={{ maxHeight: 260, overflow: 'auto' }}>
                  <table style={st.table}>
                    <thead><tr><th>구분</th><th>업체</th><th>품목</th><th>변경 내용</th></tr></thead>
                    <tbody>
                      {diff.changed.map((r, i) => (
                        <tr key={`c${i}`}>
                          <td style={{ color: '#b45309', fontWeight: 700 }}>수정</td>
                          <td>{r.CustName}</td><td>{r.ProdName}</td>
                          <td style={{ fontSize: 11 }}>
                            {Object.entries(r.diffs).map(([f, v]) => `${f}: ${fmt(v.before)}→${fmt(v.after)}`).join(' · ')}
                          </td>
                        </tr>
                      ))}
                      {diff.added.map((r, i) => (
                        <tr key={`a${i}`}><td style={{ color: '#1d4ed8', fontWeight: 700 }}>추가</td><td>{r.CustName}</td><td>{r.ProdName}</td>
                          <td style={{ fontSize: 11 }}>수량 {fmt(r.EstQuantity)} · 금액 {fmt(Math.round(Number(r.Amount) + Number(r.Vat)))}원</td></tr>
                      ))}
                      {diff.removed.map((r, i) => (
                        <tr key={`r${i}`}><td style={{ color: '#dc2626', fontWeight: 700 }}>삭제</td><td>{r.CustName}</td><td>{r.ProdName}</td>
                          <td style={{ fontSize: 11 }}>수량 {fmt(r.EstQuantity)} · 금액 {fmt(Math.round(Number(r.Amount) + Number(r.Vat)))}원</td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {changeLog && (
            <div style={st.panel}>
              <div style={st.panelHead}>
                <strong>변경 주체 로그 (ShipmentHistory · 기준 {changeLog.baselineAt || '-'} 이후)</strong>
                <span style={{ fontSize: 12, color: '#64748b' }}>{(changeLog.entries || []).length}건</span>
              </div>
              <div style={{ maxHeight: 220, overflow: 'auto' }}>
                {(changeLog.entries || []).length === 0 ? (
                  <div style={{ padding: 12, fontSize: 12, color: '#059669' }}>기준 시각 이후 수정 이력이 없습니다.</div>
                ) : (
                  <table style={st.table}>
                    <thead><tr><th>시각</th><th>수정자</th><th>업체</th><th>품목</th><th>전→후</th><th>메모</th></tr></thead>
                    <tbody>
                      {changeLog.entries.map((e, i) => (
                        <tr key={i}>
                          <td style={{ whiteSpace: 'nowrap' }}>{e.changeDtm}</td>
                          <td style={{ fontWeight: 700 }}>{e.ChangeID}</td>
                          <td>{e.CustName || '-'}</td><td>{e.ProdName || '-'}</td>
                          <td>{e.BeforeValue}→{e.AfterValue}</td>
                          <td style={{ fontSize: 10, color: '#64748b' }}>{e.Descr}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          )}

          {selSnap && (
            <div style={st.panel}>
              <div style={st.panelHead}>
                <strong>
                  #{selSnap.SnapshotKey} {(TYPE_META[selSnap.SnapshotType] || {}).label} · {selSnap.takenAt}
                  <span style={{ marginLeft: 10, color: '#1d4ed8' }}>{fmt(Math.round(Number(selSnap.TotalAmount) + Number(selSnap.TotalVat)))}원</span>
                </strong>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button style={viewTab === 'cust' ? st.segOn : st.seg} onClick={() => setViewTab('cust')}>업체별 매출</button>
                  <button style={viewTab === 'flower' ? st.segOn : st.seg} onClick={() => setViewTab('flower')}>품종별 판매금액</button>
                </div>
              </div>

              {viewTab === 'cust' ? (
                <div style={{ display: 'grid', gridTemplateColumns: selCust != null ? '1fr 1.4fr' : '1fr', gap: 0 }}>
                  <div style={{ maxHeight: 'calc(100vh - 380px)', overflow: 'auto', borderRight: selCust != null ? '1px solid #e2e8f0' : 'none' }}>
                    <table style={st.table}>
                      <thead><tr><th>업체</th><th style={{ textAlign: 'right' }}>매출금액(VAT포함)</th><th>정상출고</th><th>차감</th></tr></thead>
                      <tbody>
                        {byCust.map(c => (
                          <tr key={c.custKey ?? c.custName}
                            style={{ cursor: 'pointer', background: selCust === (c.custKey ?? c.custName) ? '#eff6ff' : undefined }}
                            onClick={() => setSelCust(c.custKey ?? c.custName)}>
                            <td style={{ fontWeight: 700 }}>{c.custName}</td>
                            <td style={{ textAlign: 'right' }}>{fmt(Math.round(c.total))}</td>
                            <td>{c.sdCnt}</td><td>{c.estCnt}</td>
                          </tr>
                        ))}
                        <tr style={{ background: '#f8fafc', fontWeight: 800 }}>
                          <td>합계</td>
                          <td style={{ textAlign: 'right' }}>{fmt(Math.round(byCust.reduce((s, c) => s + c.total, 0)))}</td>
                          <td colSpan={2}></td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                  {selCust != null && (
                    <div style={{ maxHeight: 'calc(100vh - 380px)', overflow: 'auto' }}>
                      <div style={{ padding: '6px 10px', fontSize: 12, fontWeight: 800, color: '#334155', borderBottom: '1px solid #e2e8f0' }}>
                        {custRows[0]?.CustName} — 품목별 (견적서 구조)
                        <button style={{ ...st.tinyBtn, marginLeft: 8 }} onClick={() => setSelCust(null)}>닫기</button>
                      </div>
                      <table style={st.table}>
                        <thead><tr><th>구분</th><th>품목</th><th>단위</th><th style={{ textAlign: 'right' }}>수량</th><th style={{ textAlign: 'right' }}>단가</th><th style={{ textAlign: 'right' }}>공급가</th><th style={{ textAlign: 'right' }}>부가세</th><th style={{ textAlign: 'right' }}>합계</th></tr></thead>
                        <tbody>
                          {custRows.map((r, i) => (
                            <tr key={i} style={{ color: r.RowType === 'EST' ? '#b91c1c' : undefined }}>
                              <td>{r.RowType === 'SD' ? '정상출고' : (r.EstimateType || '차감')}</td>
                              <td>{r.ProdName}</td>
                              <td>{r.EstUnit}</td>
                              <td style={{ textAlign: 'right' }}>{fmt(r.EstQuantity)}</td>
                              <td style={{ textAlign: 'right' }}>{fmt(r.Cost)}</td>
                              <td style={{ textAlign: 'right' }}>{fmt(Math.round(r.Amount))}</td>
                              <td style={{ textAlign: 'right' }}>{fmt(Math.round(r.Vat))}</td>
                              <td style={{ textAlign: 'right', fontWeight: 700 }}>{fmt(Math.round(Number(r.Amount) + Number(r.Vat)))}</td>
                            </tr>
                          ))}
                          <tr style={{ background: '#f8fafc', fontWeight: 800 }}>
                            <td colSpan={7}>합계</td>
                            <td style={{ textAlign: 'right' }}>{fmt(Math.round(custRows.reduce((s, r) => s + Number(r.Amount) + Number(r.Vat), 0)))}</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              ) : (
                <div style={{ maxHeight: 'calc(100vh - 380px)', overflow: 'auto' }}>
                  <table style={st.table}>
                    <thead><tr><th>품종(국가+꽃)</th><th style={{ textAlign: 'right' }}>판매금액(VAT포함)</th><th style={{ textAlign: 'right' }}>수량(견적단위)</th></tr></thead>
                    <tbody>
                      {byFlower.map(f => (
                        <tr key={f.name}>
                          <td style={{ fontWeight: 700 }}>{f.name}</td>
                          <td style={{ textAlign: 'right' }}>{fmt(Math.round(f.total))}</td>
                          <td style={{ textAlign: 'right' }}>{fmt(f.estQty)}</td>
                        </tr>
                      ))}
                      <tr style={{ background: '#f8fafc', fontWeight: 800 }}>
                        <td>합계</td>
                        <td style={{ textAlign: 'right' }}>{fmt(Math.round(byFlower.reduce((s, f) => s + f.total, 0)))}</td>
                        <td></td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const st = {
  page: { padding: 16, maxWidth: 1500, margin: '0 auto' },
  h1: { fontSize: 20, fontWeight: 800, margin: '0 0 6px' },
  desc: { fontSize: 13, color: '#475569', margin: '0 0 12px', lineHeight: 1.6 },
  bar: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, flexWrap: 'wrap' },
  label: { fontSize: 13, fontWeight: 700, color: '#334155' },
  weekInput: { border: '1px solid #cbd5e1', borderRadius: 8, padding: '8px 10px', fontSize: 14, width: 100 },
  primaryBtn: { background: '#2563eb', color: '#fff', border: 'none', borderRadius: 8, padding: '9px 16px', fontSize: 13, fontWeight: 700, cursor: 'pointer' },
  secondaryBtn: { background: '#fff', color: '#334155', border: '1px solid #94a3b8', borderRadius: 8, padding: '8px 14px', fontSize: 13, fontWeight: 700, cursor: 'pointer' },
  tinyBtn: { background: '#fff', color: '#2563eb', border: '1px solid #93c5fd', borderRadius: 6, padding: '1px 8px', fontSize: 10, fontWeight: 700, cursor: 'pointer' },
  error: { background: '#fef2f2', border: '1px solid #ef4444', color: '#b91c1c', borderRadius: 8, padding: '10px 12px', fontSize: 13, marginBottom: 10 },
  message: { background: '#ecfdf5', border: '1px solid #34d399', color: '#065f46', borderRadius: 8, padding: '10px 12px', fontSize: 13, marginBottom: 10 },
  panel: { border: '1px solid #dbe3ef', borderRadius: 10, background: '#fff', overflow: 'hidden' },
  panelHead: { minHeight: 40, padding: '6px 12px', borderBottom: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 12 },
  seg: { background: '#fff', border: '1px solid #cbd5e1', borderRadius: 6, padding: '4px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer', color: '#475569' },
  segOn: { background: '#1d4ed8', border: '1px solid #1d4ed8', borderRadius: 6, padding: '4px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer', color: '#fff' },
};
