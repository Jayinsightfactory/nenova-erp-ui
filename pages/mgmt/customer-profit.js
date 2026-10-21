// 거래처별 이익·월 목표 화면. 이익 = 매출이익 보고서 스냅샷을 거래처 출고 비중으로 배분(합계 == 보고서 총이익).
import { useCallback, useEffect, useState } from 'react';
import { apiGet, apiPost } from '../../lib/useApi';

const won = (n) => Math.round(Number(n || 0)).toLocaleString();
const pct = (n) => (n == null ? '-' : `${n}%`);

function csvCell(v) {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function thisMonth() {
  const k = new Date(Date.now() + 9 * 3600000);
  return `${k.getUTCFullYear()}-${String(k.getUTCMonth() + 1).padStart(2, '0')}`;
}

export default function MgmtCustomerProfit() {
  const [month, setMonth] = useState(thisMonth());
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [edit, setEdit] = useState({}); // custKey -> { s, p }

  const load = useCallback(async () => {
    setErr('');
    setBusy(true);
    try {
      const r = await apiGet('/api/mgmt/customer-profit', { month });
      if (!r.success) throw new Error(r.error);
      setData(r);
      setEdit({});
    } catch (e) { setErr(e.message || String(e)); } finally { setBusy(false); }
  }, [month]);

  useEffect(() => { load(); }, [load]);

  const saveTarget = async (row) => {
    const e = edit[row.custKey] || {};
    const s = e.s !== undefined ? e.s : (row.targetSalesKRW ?? '');
    const p = e.p !== undefined ? e.p : (row.targetProfitKRW ?? '');
    try {
      const r = await apiPost('/api/mgmt/customer-profit', { custKey: row.custKey, targetMonth: month, targetSalesKRW: s, targetProfitKRW: p });
      if (!r.success) throw new Error(r.error);
      await load();
    } catch (er) { setErr(er.message || String(er)); }
  };

  const exportCsv = () => {
    if (!data) return;
    const head = ['거래처', '매출', '원가', '이익', '이익률(%)', '목표매출', '목표이익', '매출달성률(%)', '이익달성률(%)'];
    const lines = [head, ...data.rows.map((r) => [r.name, r.salesKRW, r.costKRW, r.profitKRW, r.marginPct, r.targetSalesKRW, r.targetProfitKRW, r.salesAchievePct, r.profitAchievePct])];
    lines.push(['합계', data.totals.salesKRW, data.totals.salesKRW - data.totals.profitKRW, data.totals.profitKRW, '', '', '', '', '']);
    const csv = `﻿${lines.map((l) => l.map(csvCell).join(',')).join('\r\n')}`;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    a.download = `customer-profit-${month}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const g = data?.golden;
  const inputVal = (row, k, base) => (edit[row.custKey]?.[k] !== undefined ? edit[row.custKey][k] : (base ?? ''));
  const setField = (row, k, v) => setEdit((cur) => ({ ...cur, [row.custKey]: { ...cur[row.custKey], [k]: v } }));

  return (
    <div className="cp">
      <h2>거래처별 이익·월 목표</h2>
      <div>
        월 <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
        <button type="button" onClick={load} disabled={busy}>{busy ? '불러오는 중' : '새로고침'}</button>
        <button type="button" onClick={exportCsv} disabled={!data}>CSV 내보내기</button>
        {g && (
          <span className={`badge ${g.ok ? 'ok' : 'bad'}`}>
            {g.ok ? '보고서 총이익 일치' : '보고서 총이익 불일치 경고'} · 보고서 {won(g.reportTotal)} / 거래처 합 {won(g.sumByCustomer)} / 차이 {won(g.diff)}
          </span>
        )}
      </div>
      {err && <div className="err">{err}</div>}
      {data && (
        <>
          <p className="note">
            원천: {data.meta.source} · {data.meta.sourceNote} 월 = 차수 기준 수요일이 속한 월 (대상 차수 {data.meta.weeks.map((w) => `${w.orderYear}-${w.major}`).join(', ') || '없음'})
            {data.meta.missingWeeks.length > 0 && <strong className="warn"> · 보고서 스냅샷 없는 차수(제외됨): {data.meta.missingWeeks.join(', ')}</strong>}
          </p>
          <table>
            <thead>
              <tr>
                <th>거래처</th><th className="r">매출</th><th className="r">원가</th><th className="r">이익</th><th className="r">이익률</th>
                <th className="r">목표매출</th><th className="r">목표이익</th><th className="r">매출달성</th><th className="r">이익달성</th><th />
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={r.custKey}>
                  <td>{r.name}</td>
                  <td className="r">{won(r.salesKRW)}</td><td className="r">{won(r.costKRW)}</td><td className="r">{won(r.profitKRW)}</td>
                  <td className="r">{pct(r.marginPct)}</td>
                  {r.custKey > 0 ? (
                    <>
                      <td className="r"><input className="num" inputMode="numeric" value={inputVal(r, 's', r.targetSalesKRW)} onChange={(e) => setField(r, 's', e.target.value)} /></td>
                      <td className="r"><input className="num" inputMode="numeric" value={inputVal(r, 'p', r.targetProfitKRW)} onChange={(e) => setField(r, 'p', e.target.value)} /></td>
                    </>
                  ) : <><td /><td /></>}
                  <td className="r">{pct(r.salesAchievePct)}</td><td className="r">{pct(r.profitAchievePct)}</td>
                  <td>{r.custKey > 0 && edit[r.custKey] && <button type="button" onClick={() => saveTarget(r)}>목표 저장</button>}</td>
                </tr>
              ))}
              {data.rows.length === 0 && <tr><td colSpan={10} className="note">해당 월에 보고서 스냅샷이 있는 차수가 없습니다.</td></tr>}
            </tbody>
            <tfoot>
              <tr>
                <td>합계</td><td className="r">{won(data.totals.salesKRW)}</td><td className="r">{won(data.totals.salesKRW - data.totals.profitKRW)}</td>
                <td className="r">{won(data.totals.profitKRW)}</td><td className="r">{pct(data.totals.salesKRW ? Math.round((data.totals.profitKRW / data.totals.salesKRW) * 1000) / 10 : null)}</td>
                <td colSpan={5} />
              </tr>
            </tfoot>
          </table>
        </>
      )}
      <style jsx>{`
        .cp{padding:8px 4px;font-size:13px}.note{font-size:12px;color:var(--text3,#64748b)}.err{color:#b91c1c;margin:6px 0}.warn{color:#b45309}
        .badge{margin-left:10px;padding:2px 8px;border-radius:10px;font-size:12px}.badge.ok{background:#dcfce7;color:#166534}.badge.bad{background:#fee2e2;color:#991b1b}
        table{border-collapse:collapse;width:100%}th,td{border-bottom:1px solid var(--border,#e2e8f0);padding:4px 8px;text-align:left}
        .r{text-align:right}.num{width:110px;text-align:right}tfoot td{font-weight:700}
      `}</style>
    </div>
  );
}
