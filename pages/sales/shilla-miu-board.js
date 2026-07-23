// 신라·미우 통합 게시판 — 차수별 가로 수량 흐름/분배 매칭

import { useEffect, useMemo, useState } from 'react';
import Layout from '../../components/Layout';
import { apiGet, apiPost } from '../../lib/useApi';
import { getCurrentWeek } from '../../lib/useWeekInput';
import { getOperationalWeekSummary, normalizeMajorWeek } from '../../lib/shillaMiuBoard';

const fmt = (value) => Number(value || 0).toLocaleString('ko-KR', { maximumFractionDigits: 2 });
const qty = (value) => Number(value || 0);

function currentMajor() {
  const match = String(getCurrentWeek() || '').match(/(?:^|-)0?(\d{1,2})-/);
  return match ? String(Number(match[1])) : '1';
}

function editorKey(prodKey, useWeek, destination) {
  return `${prodKey}|${useWeek}|${destination}`;
}

export default function ShillaMiuBoardPage() {
  const major = useMemo(() => Number(currentMajor()), []);
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [startWeek, setStartWeek] = useState(String(Math.max(1, major - 3)));
  const [endWeek, setEndWeek] = useState(String(major));
  const [supplyWeek, setSupplyWeek] = useState(String(major));
  const [weeks, setWeeks] = useState([]);
  const [rows, setRows] = useState([]);
  const [drafts, setDrafts] = useState({});
  const [dirty, setDirty] = useState(new Set());
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true); setError(''); setMessage('');
    try {
      const data = await apiGet('/api/sales/shilla-miu-board', { year, startWeek, endWeek });
      setWeeks(data.weeks || []); setRows(data.rows || []); setSupplyWeek((current) => (data.weeks || []).includes(String(current).padStart(2, '0')) ? String(current).padStart(2, '0') : (data.weeks || [])[0] || '01');
      setDrafts({}); setDirty(new Set());
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const sourceRecord = (row, useWeek, destination) => {
    const sources = row.weeks?.[useWeek]?.web?.[destination]?.sources || [];
    return sources.find((source) => source.supplyWeek === supplyWeek) || null;
  };
  const webQty = (row, useWeek, destination) => {
    const key = editorKey(row.prodKey, useWeek, destination);
    if (Object.prototype.hasOwnProperty.call(drafts, key)) return drafts[key].qty;
    return sourceRecord(row, useWeek, destination)?.qty ?? 0;
  };
  const webMatched = (row, useWeek, destination) => {
    const key = editorKey(row.prodKey, useWeek, destination);
    if (Object.prototype.hasOwnProperty.call(drafts, key)) return !!drafts[key].matched;
    return !!sourceRecord(row, useWeek, destination)?.matched;
  };
  const updateDraft = (row, useWeek, destination, patch) => {
    const key = editorKey(row.prodKey, useWeek, destination);
    setDrafts((current) => ({ ...current, [key]: { qty: webQty(row, useWeek, destination), matched: webMatched(row, useWeek, destination), ...patch } }));
    setDirty((current) => new Set(current).add(key));
  };

  const save = async () => {
    const allocations = [...dirty].map((key) => {
      const [prodKey, useWeek, destination] = key.split('|');
      const row = rows.find((item) => String(item.prodKey) === prodKey);
      return { prodKey: Number(prodKey), supplyWeek, useWeek, destination, qty: Number(drafts[key]?.qty || 0), matched: !!drafts[key]?.matched, memo: row?.prodName || '' };
    });
    if (!allocations.length) { setMessage('변경된 분배가 없습니다.'); return; }
    setSaving(true); setError('');
    try {
      await apiPost('/api/sales/shilla-miu-board', { year, allocations });
      setMessage(`${allocations.length}건의 라움·미우 분배와 매칭 상태를 저장했습니다.`);
      await load();
    } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  };

  return (
    <Layout title="신라-미우 통합 게시판">
      <div className="board-page">
        <div className="board-head">
          <div>
            <h1>신라-미우 통합 게시판</h1>
            <p>전산 주문·입고·확정분배를 차수별로 연결하고, 라움·미우 잔량 분배와 매칭 여부를 저장합니다.</p>
          </div>
          <div className="board-actions">
            <label>연도 <input value={year} onChange={(e) => setYear(e.target.value)} /></label>
            <label>시작차수 <input value={startWeek} onChange={(e) => setStartWeek(e.target.value)} /></label>
            <label>종료차수 <input value={endWeek} onChange={(e) => setEndWeek(e.target.value)} /></label>
            <label>분배 공급차수 <select value={supplyWeek} onChange={(e) => setSupplyWeek(e.target.value)}>{weeks.map((week) => <option key={week} value={week}>{Number(week)}차</option>)}</select></label>
            <button className="btn" onClick={load} disabled={loading}>{loading ? '조회 중…' : '조회'}</button>
            <button className="btn btn-primary" onClick={save} disabled={saving || !dirty.size}>{saving ? '저장 중…' : `분배 저장${dirty.size ? ` (${dirty.size})` : ''}`}</button>
          </div>
        </div>
        <div className="board-note">전재고는 전산 재고 스냅샷에서 자동 표시됩니다. 공급차수 {Number(supplyWeek || 0)}차만 미우 분배 입력이 가능하고, 이전 차수는 확인용으로 표시됩니다. 입력값은 전산 주문·출고 원장을 변경하지 않고 공급차수/사용차수 매칭 원장에만 저장됩니다.</div>
        {message && <div className="board-success">{message}</div>}
        {error && <div className="board-error">{error}</div>}
        <div className="board-legend">
          <span><b className="erp-dot" /> 전산 확정분배</span>
          <span><b className="need-dot" /> 잔량 분배 필요</span>
          <span><b className="web-dot" /> 이번차수 입력</span>
          <span><b className="match-dot" /> 하이라이트 = 매칭완료</span>
        </div>
        <div className="board-scroll">
          <table className="board-table">
            <thead>
              <tr>
                <th className="sticky c-country" rowSpan="2">국가</th>
                <th className="sticky c-product" rowSpan="2">품목명</th>
                <th className="sticky c-unit" rowSpan="2">단위</th>
                <th className="sticky c-opening" rowSpan="2">전재고</th>
                {weeks.map((week) => <th key={week} className="week-group" colSpan="9">{Number(week)}차</th>)}
              </tr>
              <tr>
                {weeks.flatMap((week) => [
                  <th key={`${week}-in`}>입고<br /><small>공급</small></th>, <th key={`${week}-shilla`}>신라<br /><small>분배</small></th>,
                  <th key={`${week}-shilla-remain`}>신라잔량<br /><small>→ 미우</small></th>, <th key={`${week}-raum-order`}>라움<br /><small>주문</small></th>,
                  <th key={`${week}-raum`}>라움<br /><small>분배</small></th>, <th key={`${week}-raum-remain`}>라움잔량<br /><small>→ 미우</small></th>,
                  <th key={`${week}-miu`}>미우<br /><small>분배</small></th>, <th key={`${week}-miu-need`}>이번차수<br /><small>미우 필요</small></th>, <th key={`${week}-matched`}>확인</th>,
                ])}
              </tr>
            </thead>
            <tbody>
              {!rows.length && <tr><td colSpan={4 + weeks.length * 9} className="empty">조회된 품목이 없습니다.</td></tr>}
              {rows.map((row) => {
                return <tr key={row.prodKey}>
                  <td className="sticky c-country">{row.country || '-'}</td>
                  <td className="sticky c-product" title={row.prodName}>{row.prodName || '-'}</td>
                  <td className="sticky c-unit">{row.unit || '-'}</td>
                  <td className="sticky c-opening num">{fmt(row.openingStock)}</td>
                  {weeks.flatMap((week) => {
                    const w = row.weeks[week];
                    const summary = getOperationalWeekSummary(row, week);
                    const isCurrentWeek = normalizeMajorWeek(week) === normalizeMajorWeek(supplyWeek);
                    const miuInputQty = qty(webQty(row, week, 'MIU'));
                    const miuMatched = webMatched(row, week, 'MIU');
                    const miuSource = sourceRecord(row, week, 'MIU');
                    return [
                      <td key={`${week}-incoming`} className="num">{fmt(summary.incoming)}</td>,
                      <td key={`${week}-shilla`} className="num erp-cell">{fmt(summary.shillaDistribution)}</td>,
                      <td key={`${week}-shilla-remain`} className={`num remainder-cell ${summary.shillaRemainder > 0 ? 'needs' : ''}`}>{fmt(summary.shillaRemainder)}</td>,
                      <td key={`${week}-raum-order`} className="num order-cell">{fmt(summary.raumOrder)}</td>,
                      <td key={`${week}-raum`} className="num erp-cell">{fmt(summary.raumDistribution)}</td>,
                      <td key={`${week}-raum-remain`} className={`num remainder-cell ${summary.raumRemainder > 0 ? 'needs' : ''}`}>{fmt(summary.raumRemainder)}</td>,
                      <td key={`${week}-miu`} className={`miu-cell ${isCurrentWeek && miuInputQty > 0 ? 'has-input' : ''} ${isCurrentWeek && miuInputQty > 0 && miuMatched ? 'matched' : ''}`}>
                        <span className="aggregate">전산 {fmt(w.erp.miu)}{w.web.MIU.qty ? ` · 입력 ${fmt(w.web.MIU.qty)}` : ''}</span>
                        {isCurrentWeek ? <>
                          <input type="number" min="0" value={webQty(row, week, 'MIU') || ''} placeholder="분배량" onChange={(e) => updateDraft(row, week, 'MIU', { qty: e.target.value })} />
                          <label className="match-check" title={`${Number(supplyWeek)}차 미우 분배 매칭완료`}><input type="checkbox" checked={miuMatched} onChange={(e) => updateDraft(row, week, 'MIU', { matched: e.target.checked })} />✓</label>
                        </> : <small>{w.web.MIU.qty ? '웹 저장값' : ''}</small>}
                        {miuSource && isCurrentWeek && <small>{Number(miuSource.supplyWeek)}차 공급</small>}
                      </td>,
                      <td key={`${week}-miu-need`} className={`num need-cell ${summary.miuNeed > 0 ? 'pending' : summary.totalMiuNeed > 0 ? 'ready' : ''}`}>{fmt(summary.miuNeed)}</td>,
                      <td key={`${week}-matched`} className="complete-cell">{miuMatched && miuInputQty > 0 ? '✓' : ''}</td>,
                    ];
                  })}
                </tr>;
              })}
            </tbody>
          </table>
        </div>
      </div>
      <style jsx>{`
        .board-page { min-width: 1050px; color: #172033; }
        .board-head { display:flex; gap:18px; justify-content:space-between; align-items:flex-end; border-bottom:1px solid #cbd5e1; padding:5px 0 10px; }
        h1 { margin:0; font-size:20px; } p { margin:4px 0 0; color:#64748b; font-size:12px; }
        .board-actions { display:flex; align-items:center; gap:5px; flex-wrap:wrap; justify-content:flex-end; }
        .board-actions label { display:flex; align-items:center; gap:3px; font-size:12px; white-space:nowrap; }
        .board-actions input, .board-actions select { height:28px; border:1px solid #94a3b8; padding:0 5px; width:62px; box-sizing:border-box; }
        .board-actions select { width:85px; }
        .board-note, .board-success, .board-error { margin:8px 0; padding:7px 10px; font-size:12px; border:1px solid #bfdbfe; background:#eff6ff; }
        .board-success { color:#166534; border-color:#86efac; background:#f0fdf4; } .board-error { color:#b91c1c; border-color:#fca5a5; background:#fef2f2; }
        .board-legend { display:flex; gap:15px; margin:7px 0; font-size:11px; color:#475569; } .board-legend b { display:inline-block; width:10px; height:10px; border-radius:2px; margin-right:3px; vertical-align:-1px; }
        .erp-dot { background:#dbeafe; border:1px solid #60a5fa; } .need-dot { background:#fef3c7; border:1px solid #f59e0b; } .web-dot { background:#fff7ed; border:1px solid #fb923c; } .match-dot { background:#dcfce7; border:1px solid #22c55e; }
        .board-scroll { overflow:auto; max-height:calc(100vh - 220px); border:1px solid #94a3b8; background:#fff; }
        .board-table { border-collapse:separate; border-spacing:0; min-width:max-content; font-size:11px; }
        th, td { border-right:1px solid #cbd5e1; border-bottom:1px solid #cbd5e1; padding:4px 5px; height:34px; box-sizing:border-box; white-space:nowrap; }
        th { background:#e2e8f0; text-align:center; position:sticky; top:0; z-index:3; } th.week-group { background:#1d4ed8; color:#fff; font-size:13px; border-color:#93c5fd; }
        thead tr:nth-child(2) th { top:29px; background:#f1f5f9; color:#334155; } thead tr:nth-child(2) th small { font-weight:400; color:#64748b; }
        .sticky { position:sticky; z-index:2; background:#fff; } th.sticky { z-index:5; background:#e2e8f0; } .c-country { left:0; width:82px; min-width:82px; } .c-product { left:82px; width:300px; min-width:300px; overflow:hidden; text-overflow:ellipsis; } .c-unit { left:382px; width:52px; min-width:52px; } .c-opening { left:434px; width:72px; min-width:72px; }
        tbody tr:nth-child(even) td { background:#f8fafc; } tbody tr:nth-child(even) .sticky { background:#f8fafc; }
        .num { text-align:right; min-width:68px; } .erp-cell { background:#eff6ff !important; color:#1e3a8a; } .order-cell { background:#f8fafc; color:#334155; } .remainder-cell.needs { background:#fef3c7 !important; color:#92400e; font-weight:700; } .miu-cell { min-width:122px; text-align:center; padding:3px; } .miu-cell.has-input { background:#fff7ed !important; } .miu-cell.has-input.matched { background:#dcfce7 !important; box-shadow:inset 0 0 0 2px #22c55e; }
        .miu-cell .aggregate { display:block; font-size:10px; color:#9a3412; } .miu-cell input[type=number] { width:64px; height:22px; font-size:11px; text-align:right; border:1px solid #fdba74; } .miu-cell small { display:block; color:#64748b; font-size:9px; } .need-cell.pending { background:#fee2e2 !important; color:#b91c1c; font-weight:800; } .need-cell.ready { background:#dcfce7 !important; color:#166534; font-weight:800; }
        .match-check { display:inline-flex; align-items:center; gap:2px; margin-left:2px; height:22px; padding:0 3px; cursor:pointer; font-weight:700; color:#166534; } .match-check input { width:14px; height:14px; accent-color:#16a34a; }
        .complete-cell { text-align:center; color:#16a34a; font-weight:900; min-width:45px; } .negative { color:#b91c1c; font-weight:700; } .empty { padding:30px; text-align:center; color:#64748b; }
      `}</style>
    </Layout>
  );
}
