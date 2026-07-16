// pages/stats/pivot-import.js — 수입부 Pivot
// 입고(AWB/인보이스) 관점 피벗: 행 = 주문차수 ▶ AWB ▶ 인보이스 / 열 = 농장 칩 / 값 = 입고총단가(USD)
// + 칸추가: AWB/인보이스에 Claim·은행수수료 등 수기항목(텍스트+참조번호+금액, 음수 허용) 추가
// + 정산서 엑셀: 농장별 [일자-No./거래처명/품목명(규격)/외화금액/차수·품목/인보이스넘버/결제일] + 농장 계/총계
import { useState, useEffect, useMemo, Fragment } from 'react';
import { useWeekInput, WeekInput } from '../../lib/useWeekInput';
import { apiGet, apiPost, apiDelete } from '../../lib/useApi';

const fmt2 = n => Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function PivotImport() {
  const weekFromInput = useWeekInput('');
  const weekToInput = useWeekInput('');
  const [rows, setRows] = useState([]);
  const [adjustments, setAdjustments] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [meta, setMeta] = useState(null);
  const [selFarms, setSelFarms] = useState(new Set()); // 빈 Set = 전체
  const [search, setSearch] = useState('');
  const [payDate, setPayDate] = useState(`${new Date().getMonth() + 1}/${new Date().getDate()}`);
  const [adjModal, setAdjModal] = useState(null); // { week, awb, invoiceNo, farmName, scope:'invoice'|'awb' }
  const [fwdInvoices, setFwdInvoices] = useState({}); // { 'week|awb': 'FEX-1234' } 포워더 인보이스(웹 매핑)
  const [adjForm, setAdjForm] = useState({ label: 'Claim', refNo: '', amount: '' });
  const [saving, setSaving] = useState(false);

  const load = () => {
    if (!weekFromInput.value) { setErr('차수를 입력하세요.'); return; }
    setLoading(true); setErr('');
    apiGet('/api/stats/pivot-import', {
      weekStart: weekFromInput.value,
      weekEnd: weekToInput.value || weekFromInput.value,
    })
      .then(d => {
        setRows(d.rows || []); setAdjustments(d.adjustments || []); setFwdInvoices(d.fwdInvoices || {});
        setMeta({ orderYear: d.orderYear, weekStart: d.weekStart, weekEnd: d.weekEnd });
        setSelFarms(new Set());
      })
      .catch(e => setErr(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (weekFromInput.value && !weekToInput.value) weekToInput.setValue(weekFromInput.value);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekFromInput.value]);

  const farmList = useMemo(() => {
    const totals = {};
    rows.forEach(r => { totals[r.farmName || '(농장미상)'] = (totals[r.farmName || '(농장미상)'] || 0) + Number(r.inTotal || 0); });
    adjustments.forEach(a => { const f = a.farmName || '(농장미상)'; totals[f] = (totals[f] || 0) + Number(a.amount || 0); });
    return Object.entries(totals).sort((a, b) => b[1] - a[1]).map(([name, total]) => ({ name, total }));
  }, [rows, adjustments]);

  const searchLive = search.trim().toLowerCase();
  const matchesFilters = (farm, awb, billNo) => {
    if (selFarms.size > 0 && !selFarms.has(farm)) return false;
    if (searchLive &&
      !String(awb || '').toLowerCase().includes(searchLive) &&
      !String(billNo || '').toLowerCase().includes(searchLive) &&
      !farm.toLowerCase().includes(searchLive)) return false;
    return true;
  };
  const visible = useMemo(() => rows.filter(r => matchesFilters(r.farmName || '(농장미상)', r.awb, r.billNo)),
    [rows, selFarms, searchLive]); // eslint-disable-line react-hooks/exhaustive-deps
  const visibleAdjs = useMemo(() => adjustments.filter(a => matchesFilters(a.farmName || '(농장미상)', a.awb, a.invoiceNo || a.refNo)),
    [adjustments, selFarms, searchLive]); // eslint-disable-line react-hooks/exhaustive-deps

  const farmCols = useMemo(() => {
    const names = selFarms.size > 0 ? farmList.filter(f => selFarms.has(f.name)) : farmList;
    return names.slice(0, 12).map(f => f.name);
  }, [farmList, selFarms]);
  const farmColsTruncated = (selFarms.size > 0 ? selFarms.size : farmList.length) > 12;

  // 차수 ▶ AWB ▶ 인보이스 그룹 (수기항목은 AWB/인보이스 밑에 붙임)
  const grouped = useMemo(() => {
    const byWeek = new Map();
    for (const r of visible) {
      const wk = `${r.orderYear}-${r.week}`;
      if (!byWeek.has(wk)) byWeek.set(wk, new Map());
      const byAwb = byWeek.get(wk);
      const awb = r.awb || '(AWB미상)';
      if (!byAwb.has(awb)) byAwb.set(awb, { bills: [], adjs: [] });
      byAwb.get(awb).bills.push(r);
    }
    for (const a of visibleAdjs) {
      const wk = `${a.orderYear}-${a.week}`;
      if (!byWeek.has(wk)) byWeek.set(wk, new Map());
      const byAwb = byWeek.get(wk);
      const awb = a.awb || '(AWB미상)';
      if (!byAwb.has(awb)) byAwb.set(awb, { bills: [], adjs: [] });
      byAwb.get(awb).adjs.push(a);
    }
    return byWeek;
  }, [visible, visibleAdjs]);

  const grandTotal = visible.reduce((s, r) => s + Number(r.inTotal || 0), 0)
    + visibleAdjs.reduce((s, a) => s + Number(a.amount || 0), 0);

  const toggleFarm = (name) => setSelFarms(prev => {
    const n = new Set(prev); n.has(name) ? n.delete(name) : n.add(name); return n;
  });

  const openAdjModal = (row, scope) => {
    setAdjForm({ label: 'Claim', refNo: '', amount: '' });
    setAdjModal({
      week: row.week, awb: row.awb, farmName: row.farmName,
      invoiceNo: scope === 'invoice' ? row.billNo : '',
      scope,
    });
  };

  const saveAdj = async () => {
    const amt = parseFloat(adjForm.amount);
    if (!adjForm.label.trim()) { alert('구분(텍스트)을 입력하세요. 예: Claim, 은행수수료'); return; }
    if (Number.isNaN(amt)) { alert('금액을 입력하세요 (음수 가능, 예: -28.80)'); return; }
    setSaving(true);
    try {
      await apiPost('/api/stats/pivot-import', {
        week: adjModal.week, awb: adjModal.awb, invoiceNo: adjModal.invoiceNo,
        farmName: adjModal.farmName, label: adjForm.label.trim(), refNo: adjForm.refNo.trim(), amount: amt,
      });
      setAdjModal(null);
      load();
    } catch (e) { alert(e.message); } finally { setSaving(false); }
  };

  const deleteAdj = async (key) => {
    if (!confirm('이 수기항목을 삭제하시겠습니까?')) return;
    try { await apiDelete('/api/stats/pivot-import', { key }); load(); }
    catch (e) { alert(e.message); }
  };

  // 포워더 인보이스 번호 입력 (FEX-#### 등) — 입고관리 인보이스칸은 태그(콜카장 등)라 별도 저장
  const editFwdInvoice = async (row) => {
    const cur = fwdInvoices[`${row.week}|${row.awb}`] || '';
    const val = prompt(
      `포워더 인보이스 번호 입력\nAWB ${row.awb} (${row.week} ${row.billNo})\n비우면 삭제됩니다.`, cur);
    if (val === null) return;
    try {
      await apiPost('/api/stats/pivot-import', { type: 'fwdInvoice', week: row.week, awb: row.awb, invoiceNo: val.trim() });
      load();
    } catch (e) { alert(e.message); }
  };

  const handleSettlementExcel = () => {
    const qs = new URLSearchParams({
      weekStart: weekFromInput.value, weekEnd: weekToInput.value || weekFromInput.value,
      excel: '1', payDate,
    });
    window.location.href = `/api/stats/pivot-import?${qs.toString()}`;
  };

  const cellNum = { textAlign: 'right', fontFamily: 'var(--mono)', whiteSpace: 'nowrap' };
  const adjStyle = { background: '#fff8e1' };

  return (
    <div>
      <div className="filter-bar">
        <WeekInput weekInput={weekFromInput} label="차수" />
        <span className="filter-label">~</span>
        <WeekInput weekInput={weekToInput} />
        <span className="filter-label">검색</span>
        <input className="filter-input" placeholder="AWB / 인보이스 / 농장" value={search}
          onChange={e => setSearch(e.target.value)} style={{ minWidth: 170 }} />
        <span className="filter-label">결제일</span>
        <input className="filter-input" value={payDate} onChange={e => setPayDate(e.target.value)}
          style={{ width: 64, textAlign: 'center' }} title="정산서 엑셀 결제일 열에 들어갑니다 (예: 7/15)" />
        <div className="page-actions">
          <button className="btn btn-primary" onClick={load} disabled={loading}>{loading ? '조회 중…' : '🔄 조회'}</button>
          <button className="btn btn-primary" onClick={handleSettlementExcel} disabled={!weekFromInput.value}
            style={{ background: '#0e7a3d' }}>📄 정산서 엑셀</button>
        </div>
      </div>

      {err && <div style={{ padding: '8px 14px', background: 'var(--red-bg)', color: 'var(--red)', borderRadius: 8, marginBottom: 10, fontSize: 13 }}>⚠️ {err}</div>}

      {meta && (
        <div style={{ padding: '6px 12px', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, marginBottom: 8, fontSize: 12, color: 'var(--text2)' }}>
          📅 <b>기준연도 {meta.orderYear}년</b> · {meta.weekStart}{meta.weekEnd !== meta.weekStart ? ` ~ ${meta.weekEnd}` : ''} ·
          구분 <b>03. 입고</b> · 값 = <b>입고총단가(USD)</b> · 입고 {rows.length}건 + 수기 {adjustments.length}건 /
          합계 <b>{fmt2(grandTotal)}</b>
          <span style={{ marginLeft: 8, color: 'var(--text3)' }}>행의 [＋]로 Claim·은행수수료 등 수기항목을 추가하세요</span>
        </div>
      )}

      {rows.length > 0 && (
        <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 10px', marginBottom: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text3)' }}>거래처/농장</span>
            <button onClick={() => setSelFarms(new Set())} style={chip(selFarms.size === 0)}>전체</button>
            {farmList.map(f => (
              <button key={f.name} onClick={() => toggleFarm(f.name)} style={chip(selFarms.has(f.name))}
                title={`합계 ${fmt2(f.total)}`}>{f.name}</button>
            ))}
          </div>
        </div>
      )}

      <div className="card" style={{ overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto', maxHeight: 'calc(100vh - 300px)', overflowY: 'auto' }}>
          {loading ? <div className="skeleton" style={{ margin: 16, height: 300, borderRadius: 8 }} /> : (
            <table className="tbl">
              <thead>
                <tr>
                  <th style={{ whiteSpace: 'nowrap' }}>주문차수 ▲</th>
                  <th style={{ whiteSpace: 'nowrap' }}>AWB ▲</th>
                  <th style={{ whiteSpace: 'nowrap' }}>인보이스</th>
                  <th style={{ whiteSpace: 'nowrap' }}>거래처명/농장명</th>
                  <th style={{ width: 30 }}></th>
                  {farmCols.map(f => <th key={f} style={{ ...cellNum, fontSize: 11 }}>{f}</th>)}
                  <th style={{ ...cellNum, background: 'var(--green-bg)' }}>합계</th>
                </tr>
              </thead>
              <tbody>
                {grouped.size === 0
                  ? <tr><td colSpan={6 + farmCols.length} style={{ textAlign: 'center', padding: 40, color: 'var(--text3)' }}>
                      데이터 없음 — 차수를 입력하고 조회하세요
                    </td></tr>
                  : [...grouped.entries()].map(([wk, byAwb]) => {
                    const weekRows = [...byAwb.values()].flatMap(g => g.bills);
                    const weekAdjs = [...byAwb.values()].flatMap(g => g.adjs);
                    const weekTotal = weekRows.reduce((s, r) => s + Number(r.inTotal || 0), 0)
                      + weekAdjs.reduce((s, a) => s + Number(a.amount || 0), 0);
                    const bodyRowCount = weekRows.length + weekAdjs.length + byAwb.size + 1;
                    return (
                      <Fragment key={wk}>
                        {[...byAwb.entries()].map(([awb, g], awbIdx) => {
                          const awbTotal = g.bills.reduce((s, r) => s + Number(r.inTotal || 0), 0)
                            + g.adjs.reduce((s, a) => s + Number(a.amount || 0), 0);
                          const groupLen = g.bills.length + g.adjs.length;
                          return (
                            <Fragment key={`${wk}|${awb}`}>
                              {g.bills.map((r, i) => (
                                <tr key={`b|${wk}|${awb}|${r.billNo}|${r.farmName}|${i}`}>
                                  {awbIdx === 0 && i === 0 && (
                                    <td rowSpan={bodyRowCount}
                                      style={{ fontWeight: 800, verticalAlign: 'top', background: 'var(--bg)', whiteSpace: 'nowrap' }}>
                                      ▾ {wk.replace(/^\d{4}-/, '')}
                                      <div style={{ fontSize: 10, color: 'var(--text3)', fontWeight: 400 }}>{wk.slice(0, 4)}년</div>
                                    </td>
                                  )}
                                  {i === 0 && (
                                    <td rowSpan={groupLen} style={{ fontFamily: 'var(--mono)', fontSize: 12, verticalAlign: 'top', whiteSpace: 'nowrap' }}>
                                      {awb}
                                      <button onClick={() => openAdjModal(g.bills[0], 'awb')} title="이 AWB에 수기항목 추가"
                                        style={plusBtn}>＋</button>
                                    </td>
                                  )}
                                  <td style={{ fontFamily: 'var(--mono)', fontSize: 12, whiteSpace: 'nowrap' }}>
                                    {isFwdFarm(r.farmName) ? (
                                      <>
                                        <span title="포워더 태그(입고관리 인보이스칸)">{r.billNo || '—'}</span>
                                        <span style={{ color: 'var(--blue)', marginLeft: 4 }}>
                                          {fwdInvoices[`${r.week}|${r.awb}`] || ''}
                                        </span>
                                        <button onClick={() => editFwdInvoice(r)} title="포워더 인보이스 번호(FEX-#### 등) 입력 — 정산서 인보이스넘버 칸에 사용"
                                          style={plusBtn}>✎</button>
                                      </>
                                    ) : (r.billNo || '—')}
                                  </td>
                                  <td style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
                                    {r.farmName || '(농장미상)'}
                                    <button onClick={() => openAdjModal(r, 'invoice')} title="이 인보이스에 수기항목 추가 (Claim/은행수수료)"
                                      style={plusBtn}>＋</button>
                                  </td>
                                  <td style={{ fontSize: 10, color: 'var(--text3)' }}>{r.inputDate?.slice(5) || ''}</td>
                                  {farmCols.map(f => (
                                    <td key={f} style={cellNum}>
                                      {(r.farmName || '(농장미상)') === f ? fmt2(r.inTotal) : ''}
                                    </td>
                                  ))}
                                  <td style={{ ...cellNum, fontWeight: 600, background: 'var(--green-bg)' }}>{fmt2(r.inTotal)}</td>
                                </tr>
                              ))}
                              {g.adjs.map((a) => (
                                <tr key={`a|${a.key}`} style={adjStyle}>
                                  {g.bills.length === 0 && (
                                    <td style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>{awb}</td>
                                  )}
                                  <td style={{ fontSize: 12, fontStyle: 'italic' }}>{a.refNo || a.invoiceNo || '—'}</td>
                                  <td style={{ fontSize: 12 }}>
                                    ✏️ {a.label}
                                    <span style={{ fontSize: 10, color: 'var(--text3)', marginLeft: 4 }}>{a.farmName}</span>
                                    <button onClick={() => deleteAdj(a.key)} title="수기항목 삭제"
                                      style={{ ...plusBtn, color: 'var(--red)' }}>✕</button>
                                  </td>
                                  <td style={{ fontSize: 10, color: 'var(--text3)' }}>{a.createDate?.slice(5) || ''}</td>
                                  {farmCols.map(f => (
                                    <td key={f} style={cellNum}>
                                      {(a.farmName || '(농장미상)') === f ? fmt2(a.amount) : ''}
                                    </td>
                                  ))}
                                  <td style={{ ...cellNum, fontWeight: 600, color: a.amount < 0 ? 'var(--red)' : undefined, background: '#fff3cd' }}>
                                    {fmt2(a.amount)}
                                  </td>
                                </tr>
                              ))}
                              <tr style={{ background: 'var(--bg)' }}>
                                <td colSpan={3} style={{ fontSize: 11, color: 'var(--text3)', textAlign: 'right' }}>AWB 소계</td>
                                {farmCols.map(f => <td key={f} />)}
                                <td style={{ ...cellNum, fontWeight: 700 }}>{fmt2(awbTotal)}</td>
                              </tr>
                            </Fragment>
                          );
                        })}
                        <tr style={{ background: '#e3f2fd' }}>
                          <td colSpan={4} style={{ fontWeight: 700, fontSize: 12, textAlign: 'right' }}>
                            {wk.replace(/^\d{4}-/, '')} 차수 합계
                          </td>
                          {farmCols.map(f => {
                            const t = weekRows.filter(r => (r.farmName || '(농장미상)') === f)
                              .reduce((s, r) => s + Number(r.inTotal || 0), 0)
                              + weekAdjs.filter(a => (a.farmName || '(농장미상)') === f)
                                .reduce((s, a) => s + Number(a.amount || 0), 0);
                            return <td key={f} style={{ ...cellNum, fontWeight: 700 }}>{t ? fmt2(t) : ''}</td>;
                          })}
                          <td style={{ ...cellNum, fontWeight: 800, background: 'var(--green-bg)' }}>{fmt2(weekTotal)}</td>
                        </tr>
                      </Fragment>
                    );
                  })}
                {(visible.length > 0 || visibleAdjs.length > 0) && (
                  <tr style={{ borderTop: '2px solid var(--border2)', background: 'var(--bg)' }}>
                    <td colSpan={5} style={{ fontWeight: 800, textAlign: 'right' }}>총 합계</td>
                    {farmCols.map(f => {
                      const t = visible.filter(r => (r.farmName || '(농장미상)') === f)
                        .reduce((s, r) => s + Number(r.inTotal || 0), 0)
                        + visibleAdjs.filter(a => (a.farmName || '(농장미상)') === f)
                          .reduce((s, a) => s + Number(a.amount || 0), 0);
                      return <td key={f} style={{ ...cellNum, fontWeight: 700 }}>{t ? fmt2(t) : ''}</td>;
                    })}
                    <td style={{ ...cellNum, fontWeight: 900, background: 'var(--green-bg)' }}>{fmt2(grandTotal)}</td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>
      {farmColsTruncated && (
        <div style={{ fontSize: 11, color: 'var(--amber)', marginTop: 6 }}>
          ⚠ 농장 열은 금액순 상위 12개까지만 표시됩니다 — 위 칩에서 원하는 농장만 선택하세요. (합계 열은 전체 반영)
        </div>
      )}

      {/* 수기항목(칸추가) 모달 */}
      {adjModal && (
        <div className="modal-overlay" onClick={() => setAdjModal(null)}>
          <div className="modal" style={{ maxWidth: 400 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">수기항목 추가 (칸추가)</span>
              <button className="btn btn-secondary btn-sm" onClick={() => setAdjModal(null)}>✕</button>
            </div>
            <div className="modal-body">
              <div style={{ fontSize: 12, color: 'var(--text2)', marginBottom: 12, lineHeight: 1.7 }}>
                대상: <b>{adjModal.farmName || '(농장미상)'}</b><br />
                차수 <b>{adjModal.week}</b> · AWB <b style={{ fontFamily: 'var(--mono)' }}>{adjModal.awb}</b>
                {adjModal.invoiceNo ? <> · 인보이스 <b style={{ fontFamily: 'var(--mono)' }}>{adjModal.invoiceNo}</b></> : ' · (AWB 전체)'}
              </div>
              <div className="form-row form-row-1"><div className="form-group">
                <label className="form-label">구분 (품목명 칸에 표시)</label>
                <input className="form-control" value={adjForm.label}
                  onChange={e => setAdjForm(f => ({ ...f, label: e.target.value }))}
                  placeholder="예: Claim, 은행수수료" list="adj-labels" />
                <datalist id="adj-labels">
                  <option value="Claim" /><option value="은행수수료" /><option value="SERVICE FEE" />
                </datalist>
              </div></div>
              <div className="form-row form-row-1"><div className="form-group">
                <label className="form-label">참조번호 (인보이스넘버 칸, 선택)</label>
                <input className="form-control" value={adjForm.refNo}
                  onChange={e => setAdjForm(f => ({ ...f, refNo: e.target.value }))}
                  placeholder="예: CN-MAT-2026-001 (비우면 구분 텍스트 사용)" />
              </div></div>
              <div className="form-row form-row-1"><div className="form-group">
                <label className="form-label">금액 (USD, 음수 가능)</label>
                <input className="form-control" type="number" step="0.01" value={adjForm.amount}
                  onChange={e => setAdjForm(f => ({ ...f, amount: e.target.value }))}
                  placeholder="예: -28.80" />
              </div></div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-primary" onClick={saveAdj} disabled={saving}>
                💾 {saving ? '저장 중…' : '추가'}
              </button>
              <button className="btn btn-secondary" onClick={() => setAdjModal(null)}>닫기</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// 포워더(운송료) 농장 판정 — API isForwarder 와 동일 규칙
const isFwdFarm = (farm) => /^freightwise/i.test(String(farm || '')) || String(farm || '').trim().toUpperCase() === 'EXCEL';

const plusBtn = {
  marginLeft: 6, width: 20, height: 20, lineHeight: '18px', padding: 0, fontSize: 12,
  border: '1px solid var(--border2)', borderRadius: 4, cursor: 'pointer',
  background: 'var(--surface)', color: 'var(--blue)', fontWeight: 700,
};

const chip = (active) => ({
  padding: '2px 9px', borderRadius: 12, border: '1px solid', fontSize: 11, cursor: 'pointer',
  fontWeight: active ? 700 : 400,
  borderColor: active ? 'var(--blue)' : 'var(--border)',
  background: active ? 'var(--blue)' : 'var(--surface)',
  color: active ? '#fff' : 'var(--text2)',
});
