// 채권 aging 화면. 미결 청구 발생일 기준 FIFO 상계 → 0-30/31-60/61-90/90+ 일 구간.
import { useCallback, useEffect, useState } from 'react';
import { apiGet } from '../../lib/useApi';
import { AGING_BUCKETS, AGING_LABELS } from '../../lib/mgmt/aging';

const won = (n) => Number(n || 0).toLocaleString();

function csvCell(v) {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export default function MgmtArAging() {
  const [asOf, setAsOf] = useState('');
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    setErr('');
    try {
      const r = await apiGet('/api/mgmt/ar-aging', { asOf: asOf || undefined });
      if (!r.success) throw new Error(r.error);
      setData(r);
    } catch (e) { setErr(e.message || String(e)); }
  }, [asOf]);

  useEffect(() => { load(); }, [load]);

  const exportCsv = () => {
    if (!data) return;
    const head = ['거래처', '지역', '담당자', ...AGING_BUCKETS.map((k) => AGING_LABELS[k]), '초과입금', '합계', '최고령일수'];
    const lines = [head, ...data.rows.map((r) => [r.custName, r.area, r.manager, ...AGING_BUCKETS.map((k) => r[k]), r.credit, r.total, r.oldestDays])];
    const csv = `﻿${lines.map((l) => l.map(csvCell).join(',')).join('\r\n')}`;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    a.download = `ar-aging-${data.asOf}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="ag">
      <h2>채권 aging</h2>
      <div>
        기준일 <input type="date" value={asOf || data?.asOf || ''} onChange={(e) => setAsOf(e.target.value)} />
        <button type="button" onClick={exportCsv} disabled={!data}>CSV 내보내기</button>
        {data && <span className="note"> 원천: {data.source} · 입금은 오래된 청구부터 상계</span>}
      </div>
      {err && <div className="err">{err}</div>}
      {data && (
        <>
          <div className="cards">
            {AGING_BUCKETS.map((k) => (
              <div key={k} className={`card ${k === 'd90p' ? 'hot' : ''}`}><span>{AGING_LABELS[k]}</span><strong>{won(data.totals[k])}</strong></div>
            ))}
          </div>
          <p className="note">잔액 합계 {won(data.totals.total)}원 (초과입금 {won(data.totals.credit)}원 차감 후, 채권관리 잔액 합계와 일치)</p>
          <table>
            <thead>
              <tr><th>거래처</th>{AGING_BUCKETS.map((k) => <th key={k} className="r">{AGING_LABELS[k]}</th>)}<th className="r">합계</th><th className="r">최고령(일)</th></tr>
            </thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={r.custKey} className={r.d90p > 0 ? 'hotrow' : ''}>
                  <td>{r.custName}</td>
                  {AGING_BUCKETS.map((k) => <td key={k} className="r">{won(r[k])}</td>)}
                  <td className="r">{won(r.total)}</td><td className="r">{r.oldestDays}</td>
                </tr>
              ))}
              {data.rows.length === 0 && <tr><td colSpan={7} className="note">채권 데이터가 없습니다.</td></tr>}
            </tbody>
          </table>
        </>
      )}
      <style jsx>{`
        .ag{padding:8px 4px;font-size:13px}.note{font-size:12px;color:var(--text3,#64748b)}.err{color:#b91c1c;margin:6px 0}
        .cards{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin:10px 0}
        .card{border:1px solid var(--border,#cbd5e1);border-radius:8px;padding:10px;display:flex;flex-direction:column;gap:4px}
        .card.hot{border-color:#dc2626}.card strong{font-size:16px}
        table{border-collapse:collapse;width:100%}th,td{border-bottom:1px solid var(--border,#e2e8f0);padding:4px 8px;text-align:left}
        .r{text-align:right}.hotrow td{background:#fff1f2}
      `}</style>
    </div>
  );
}
