// pages/stats/pivot-import.js — 수입부 Pivot
// 입고(AWB/BILL) 관점 피벗: 행 = 주문차수 ▶ AWB ▶ BILL번호 / 열 = 농장명(칩 선택) / 값 = 입고총단가(USD)
// 기존 Pivot 통계는 주문·품목 관점이라 BILL(InvoiceNo) 단위 조회가 안 돼 수입부용으로 분리.
import { useState, useEffect, useMemo, Fragment } from 'react';
import { useWeekInput, WeekInput } from '../../lib/useWeekInput';
import { apiGet } from '../../lib/useApi';

const fmt2 = n => Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function PivotImport() {
  const weekFromInput = useWeekInput('');
  const weekToInput = useWeekInput('');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [meta, setMeta] = useState(null);
  const [selFarms, setSelFarms] = useState(new Set()); // 빈 Set = 전체
  const [search, setSearch] = useState('');

  const load = () => {
    if (!weekFromInput.value) { setErr('차수를 입력하세요.'); return; }
    setLoading(true); setErr('');
    apiGet('/api/stats/pivot-import', {
      weekStart: weekFromInput.value,
      weekEnd: weekToInput.value || weekFromInput.value,
    })
      .then(d => { setRows(d.rows || []); setMeta({ orderYear: d.orderYear, weekStart: d.weekStart, weekEnd: d.weekEnd }); setSelFarms(new Set()); })
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
    return Object.entries(totals).sort((a, b) => b[1] - a[1]).map(([name, total]) => ({ name, total }));
  }, [rows]);

  const searchLive = search.trim().toLowerCase();
  const visible = useMemo(() => rows.filter(r => {
    const farm = r.farmName || '(농장미상)';
    if (selFarms.size > 0 && !selFarms.has(farm)) return false;
    if (searchLive &&
      !String(r.awb || '').toLowerCase().includes(searchLive) &&
      !String(r.billNo || '').toLowerCase().includes(searchLive) &&
      !farm.toLowerCase().includes(searchLive)) return false;
    return true;
  }), [rows, selFarms, searchLive]);

  // 열 = 선택 농장 (미선택 시 금액순 상위 노출, 12개 초과면 안내)
  const farmCols = useMemo(() => {
    const names = selFarms.size > 0 ? farmList.filter(f => selFarms.has(f.name)) : farmList;
    return names.slice(0, 12).map(f => f.name);
  }, [farmList, selFarms]);
  const farmColsTruncated = (selFarms.size > 0 ? selFarms.size : farmList.length) > 12;

  // 차수 ▶ AWB ▶ BILL 그룹 구성
  const grouped = useMemo(() => {
    const byWeek = new Map();
    for (const r of visible) {
      const wk = `${r.orderYear}-${r.week}`;
      if (!byWeek.has(wk)) byWeek.set(wk, new Map());
      const byAwb = byWeek.get(wk);
      const awb = r.awb || '(AWB미상)';
      if (!byAwb.has(awb)) byAwb.set(awb, []);
      byAwb.get(awb).push(r);
    }
    return byWeek;
  }, [visible]);

  const grandTotal = visible.reduce((s, r) => s + Number(r.inTotal || 0), 0);

  const toggleFarm = (name) => setSelFarms(prev => {
    const n = new Set(prev); n.has(name) ? n.delete(name) : n.add(name); return n;
  });

  const handleExcel = () => {
    const head = ['주문년도', '주문차수', 'AWB', 'BILL번호', '거래처명/농장명', '구분', '수량', '입고총단가'];
    const lines = [head];
    visible.forEach(r => lines.push([
      r.orderYear, r.week, r.awb, r.billNo, r.farmName, '03. 입고', r.qty, Number(r.inTotal || 0).toFixed(2),
    ]));
    const csv = lines.map(row => row.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `수입부피벗_${meta?.weekStart || ''}_${meta?.weekEnd || ''}.csv`;
    a.click();
  };

  const cellNum = { textAlign: 'right', fontFamily: 'var(--mono)', whiteSpace: 'nowrap' };

  return (
    <div>
      <div className="filter-bar">
        <WeekInput weekInput={weekFromInput} label="차수" />
        <span className="filter-label">~</span>
        <WeekInput weekInput={weekToInput} />
        <span className="filter-label">검색</span>
        <input className="filter-input" placeholder="AWB / BILL / 농장 (즉시 필터)" value={search}
          onChange={e => setSearch(e.target.value)} style={{ minWidth: 190 }} />
        <div className="page-actions">
          <button className="btn btn-primary" onClick={load} disabled={loading}>{loading ? '조회 중…' : '🔄 조회'}</button>
          <button className="btn btn-secondary" onClick={handleExcel} disabled={!visible.length}>📊 엑셀</button>
        </div>
      </div>

      {err && <div style={{ padding: '8px 14px', background: 'var(--red-bg)', color: 'var(--red)', borderRadius: 8, marginBottom: 10, fontSize: 13 }}>⚠️ {err}</div>}

      {meta && (
        <div style={{ padding: '6px 12px', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, marginBottom: 8, fontSize: 12, color: 'var(--text2)' }}>
          📅 <b>기준연도 {meta.orderYear}년</b> · {meta.weekStart}{meta.weekEnd !== meta.weekStart ? ` ~ ${meta.weekEnd}` : ''} ·
          구분 <b>03. 입고</b> · 값 = <b>입고총단가(USD)</b> · 총 {rows.length}건 / 합계 <b>{fmt2(grandTotal)}</b>
        </div>
      )}

      {rows.length > 0 && (
        <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 10px', marginBottom: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text3)' }}>거래처/농장</span>
            <button onClick={() => setSelFarms(new Set())}
              style={chip(selFarms.size === 0)}>전체</button>
            {farmList.map(f => (
              <button key={f.name} onClick={() => toggleFarm(f.name)} style={chip(selFarms.has(f.name))}
                title={`합계 ${fmt2(f.total)}`}>
                {f.name}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="card" style={{ overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto', maxHeight: 'calc(100vh - 280px)', overflowY: 'auto' }}>
          {loading ? <div className="skeleton" style={{ margin: 16, height: 300, borderRadius: 8 }} /> : (
            <table className="tbl">
              <thead>
                <tr>
                  <th style={{ whiteSpace: 'nowrap' }}>주문차수 ▲</th>
                  <th style={{ whiteSpace: 'nowrap' }}>AWB ▲</th>
                  <th style={{ whiteSpace: 'nowrap' }}>BILL번호</th>
                  <th style={{ whiteSpace: 'nowrap' }}>거래처명/농장명</th>
                  {farmCols.map(f => <th key={f} style={{ ...cellNum, fontSize: 11 }}>{f}</th>)}
                  <th style={{ ...cellNum, background: 'var(--green-bg)' }}>합계</th>
                </tr>
              </thead>
              <tbody>
                {visible.length === 0
                  ? <tr><td colSpan={5 + farmCols.length} style={{ textAlign: 'center', padding: 40, color: 'var(--text3)' }}>
                      데이터 없음 — 차수를 입력하고 조회하세요
                    </td></tr>
                  : [...grouped.entries()].map(([wk, byAwb]) => {
                    const weekRows = [...byAwb.values()].flat();
                    const weekTotal = weekRows.reduce((s, r) => s + Number(r.inTotal || 0), 0);
                    return (
                      <Fragment key={wk}>
                        {[...byAwb.entries()].map(([awb, bills], awbIdx) => {
                          const awbTotal = bills.reduce((s, r) => s + Number(r.inTotal || 0), 0);
                          return (
                            <Fragment key={`${wk}|${awb}`}>
                              {bills.map((r, i) => (
                                <tr key={`${wk}|${awb}|${r.billNo}|${r.farmName}|${i}`}>
                                  {awbIdx === 0 && i === 0 && (
                                    <td rowSpan={weekRows.length + byAwb.size + 1}
                                      style={{ fontWeight: 800, verticalAlign: 'top', background: 'var(--bg)', whiteSpace: 'nowrap' }}>
                                      ▾ {wk.replace(/^\d{4}-/, '')}
                                      <div style={{ fontSize: 10, color: 'var(--text3)', fontWeight: 400 }}>{wk.slice(0, 4)}년</div>
                                    </td>
                                  )}
                                  {i === 0 && (
                                    <td rowSpan={bills.length} style={{ fontFamily: 'var(--mono)', fontSize: 12, verticalAlign: 'top', whiteSpace: 'nowrap' }}>
                                      {awb}
                                    </td>
                                  )}
                                  <td style={{ fontFamily: 'var(--mono)', fontSize: 12, whiteSpace: 'nowrap' }}>{r.billNo || '—'}</td>
                                  <td style={{ fontSize: 12 }}>{r.farmName || '(농장미상)'}</td>
                                  {farmCols.map(f => (
                                    <td key={f} style={cellNum}>
                                      {(r.farmName || '(농장미상)') === f ? fmt2(r.inTotal) : ''}
                                    </td>
                                  ))}
                                  <td style={{ ...cellNum, fontWeight: 600, background: 'var(--green-bg)' }}>{fmt2(r.inTotal)}</td>
                                </tr>
                              ))}
                              <tr style={{ background: 'var(--bg)' }}>
                                <td colSpan={2} style={{ fontSize: 11, color: 'var(--text3)', textAlign: 'right' }}>AWB 소계</td>
                                {farmCols.map(f => <td key={f} />)}
                                <td style={{ ...cellNum, fontWeight: 700 }}>{fmt2(awbTotal)}</td>
                              </tr>
                            </Fragment>
                          );
                        })}
                        <tr style={{ background: 'var(--blue-bg, #e3f2fd)' }}>
                          <td colSpan={3} style={{ fontWeight: 700, fontSize: 12, textAlign: 'right' }}>
                            {wk.replace(/^\d{4}-/, '')} 차수 합계
                          </td>
                          {farmCols.map(f => {
                            const t = weekRows.filter(r => (r.farmName || '(농장미상)') === f)
                              .reduce((s, r) => s + Number(r.inTotal || 0), 0);
                            return <td key={f} style={{ ...cellNum, fontWeight: 700 }}>{t ? fmt2(t) : ''}</td>;
                          })}
                          <td style={{ ...cellNum, fontWeight: 800, background: 'var(--green-bg)' }}>{fmt2(weekTotal)}</td>
                        </tr>
                      </Fragment>
                    );
                  })}
                {visible.length > 0 && (
                  <tr style={{ borderTop: '2px solid var(--border2)', background: 'var(--bg)' }}>
                    <td colSpan={4} style={{ fontWeight: 800, textAlign: 'right' }}>총 합계</td>
                    {farmCols.map(f => {
                      const t = visible.filter(r => (r.farmName || '(농장미상)') === f)
                        .reduce((s, r) => s + Number(r.inTotal || 0), 0);
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
    </div>
  );
}

const chip = (active) => ({
  padding: '2px 9px', borderRadius: 12, border: '1px solid', fontSize: 11, cursor: 'pointer',
  fontWeight: active ? 700 : 400,
  borderColor: active ? 'var(--blue)' : 'var(--border)',
  background: active ? 'var(--blue)' : 'var(--surface)',
  color: active ? '#fff' : 'var(--text2)',
});
