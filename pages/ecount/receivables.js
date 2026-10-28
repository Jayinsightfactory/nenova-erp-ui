// ECOUNT 채권 스냅샷 요약과 Nenovaweb 확정 출고 기준 최근 12개월 매출 평균.
import { useState, useEffect, useCallback } from 'react';

const fmt = (n) => Number(n || 0).toLocaleString();
const won = (n) => fmt(Math.round(n));

export default function EcountReceivablesPage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [sortBy, setSortBy] = useState('balance'); // balance | aging
  const [overdueOnly, setOverdueOnly] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setErr('');
    try {
      const res = await fetch('/api/ecount/receivables', { credentials: 'same-origin' });
      const d = await res.json();
      if (!d.success) throw new Error(d.error || '조회 실패');
      setData(d);
    } catch (e) { setErr(e.message); } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  const s = data?.summary;
  let rows = data?.rows || [];
  if (overdueOnly) rows = rows.filter((r) => r.agingMonths >= 4 && r.balance > 0);
  rows = [...rows].sort((a, b) => (sortBy === 'aging' ? b.agingMonths - a.agingMonths || b.balance - a.balance : b.balance - a.balance));
  const shownTotal = rows.reduce((total, row) => ({
    sales: total.sales + row.sales, receipt: total.receipt + row.receipt,
    etcDiff: total.etcDiff + row.etcDiff, balance: total.balance + row.balance,
  }), { sales: 0, receipt: 0, etcDiff: 0, balance: 0 });
  const lastIncludedDay = data?.averageWindow?.to
    ? new Date(`${data.averageWindow.to}T00:00:00Z`)
    : null;
  if (lastIncludedDay) lastIncludedDay.setUTCDate(lastIncludedDay.getUTCDate() - 1);
  const avgWindowLabel = data?.averageWindow?.from && data?.averageWindow?.to
    ? `${data.averageWindow.from} ~ ${lastIncludedDay.toISOString().slice(0, 10)} 최근 12개월`
    : '최근 12개월';

  return (
    <div style={{ padding: 16, maxWidth: 1100, margin: '0 auto' }}>
      <h1 data-desktop-chrome style={{ fontSize: 20, fontWeight: 800, margin: '0 0 4px' }}>💳 ECOUNT 채권 요약</h1>
      <p style={{ fontSize: 13, color: '#475569', margin: '0 0 12px', lineHeight: 1.6 }}>
        {data?.scope === 'all' ? '관리자 전체 거래처' : '담당자 배정 거래처'}의 매출·수금·할인 차액과 잔액을 표시합니다.
        {data?.takenAt && <span style={{ color: '#94a3b8' }}> · 스냅샷 #{data.snapshotKey} ({data.takenAt})</span>}
        <button onClick={load} disabled={loading} style={{ marginLeft: 10, background: '#2563eb', color: '#fff', border: 'none', borderRadius: 8, padding: '5px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>{loading ? '조회 중…' : '화면 새로고침'}</button>
      </p>

      {err && <div style={{ background: '#fef2f2', border: '1px solid #ef4444', color: '#b91c1c', borderRadius: 8, padding: '10px 12px', fontSize: 13, marginBottom: 10 }}>⚠️ {err}</div>}
      {data?.noEcount && <div style={{ background: '#fffbeb', border: '1px solid #f59e0b', color: '#92400e', borderRadius: 8, padding: '10px 12px', fontSize: 13, marginBottom: 10 }}>스크랩된 ECOUNT 채권 데이터가 없습니다. ECOUNT 수집 데몬을 먼저 실행하세요.</div>}

      {s && (
        <div style={{ display: 'flex', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
          {[
            { label: '총 미수 잔액', value: won(s.totalBalance), color: '#0f172a' },
            { label: '미수 거래처', value: fmt(s.posCount) },
            { label: '4개월+ 미수', value: `${won(s.overdue4.amount)} (${s.overdue4.count})`, color: '#ea580c' },
            { label: '7개월+ 미수', value: `${won(s.overdue7.amount)} (${s.overdue7.count})`, color: '#dc2626' },
            { label: '13개월+ 미수', value: `${won(s.overdue13.amount)} (${s.overdue13.count})`, color: '#7f1d1d' },
          ].map((c) => (
            <div key={c.label} style={{ flex: '1 1 130px', minWidth: 120, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, padding: '10px 14px', textAlign: 'center' }}>
              <div style={{ fontSize: 11, color: '#64748b', marginBottom: 4 }}>{c.label}</div>
              <div style={{ fontSize: 15, fontWeight: 800, color: c.color || '#0f172a', fontFamily: 'ui-monospace,monospace' }}>{c.value}</div>
            </div>
          ))}
        </div>
      )}

      {/* aging 버킷 바 */}
      {data?.aging && (
        <div style={{ display: 'flex', gap: 6, marginBottom: 14, flexWrap: 'wrap' }}>
          {data.aging.map((b) => (
            <div key={b.key} style={{ flex: '1 1 150px', minWidth: 130, background: '#fff', border: `1px solid ${b.color}`, borderRadius: 8, padding: '8px 12px' }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: b.color }}>{b.label}</div>
              <div style={{ fontSize: 14, fontWeight: 800, fontFamily: 'ui-monospace,monospace' }}>{won(b.amount)}</div>
              <div style={{ fontSize: 11, color: '#94a3b8' }}>{b.count}개 거래처</div>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12, color: '#64748b' }}>정렬</span>
        <button onClick={() => setSortBy('balance')} style={segStyle(sortBy === 'balance')}>잔액 큰 순</button>
        <button onClick={() => setSortBy('aging')} style={segStyle(sortBy === 'aging')}>오래된 순</button>
        <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: '#475569', marginLeft: 6 }}>
          <input type="checkbox" checked={overdueOnly} onChange={(e) => setOverdueOnly(e.target.checked)} />
          장기미수(4개월+)만
        </label>
      </div>

      {data && !data.noEcount && (
        <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, overflow: 'hidden' }}>
          <div style={{ maxHeight: 'calc(100vh - 340px)', overflow: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
              <tr style={{ background: '#f1f5f9' }}>
                  <th style={{ textAlign: 'left', padding: '7px 12px', whiteSpace: 'nowrap' }}>거래처명</th>
                  <th style={{ textAlign: 'right', padding: '7px 12px', whiteSpace: 'nowrap' }}>매출합계</th>
                  <th style={{ textAlign: 'right', padding: '7px 12px', whiteSpace: 'nowrap' }}>수금합계</th>
                  <th style={{ textAlign: 'right', padding: '7px 12px', whiteSpace: 'nowrap' }}>기타할인등차액</th>
                  <th style={{ textAlign: 'right', padding: '7px 12px', whiteSpace: 'nowrap' }}>잔액</th>
                  <th style={{ textAlign: 'center', padding: '7px 12px', whiteSpace: 'nowrap' }}>미회수월</th>
                  <th style={{ textAlign: 'right', padding: '7px 12px', whiteSpace: 'nowrap' }}>월평균 매출</th>
                  <th style={{ textAlign: 'right', padding: '7px 12px', whiteSpace: 'nowrap' }}>차수별 평균 매출</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && <tr><td colSpan={8} style={{ padding: 24, textAlign: 'center', color: '#94a3b8' }}>표시할 거래처가 없습니다. 담당자 배정과 ECOUNT 거래처명을 확인해 주세요.</td></tr>}
                {rows.map((r, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid #eef2f7' }}>
                    <td style={{ padding: '7px 12px', fontWeight: 700, whiteSpace: 'nowrap' }}>{r.name}</td>
                    <td style={{ padding: '7px 12px', textAlign: 'right', fontFamily: 'ui-monospace,monospace', color: '#64748b', whiteSpace: 'nowrap' }}>{won(r.sales)}</td>
                    <td style={{ padding: '7px 12px', textAlign: 'right', fontFamily: 'ui-monospace,monospace', color: '#64748b', whiteSpace: 'nowrap' }}>{won(r.receipt)}</td>
                    <td style={{ padding: '7px 12px', textAlign: 'right', fontFamily: 'ui-monospace,monospace', color: '#64748b', whiteSpace: 'nowrap' }}>{won(r.etcDiff)}</td>
                    <td style={{ padding: '7px 12px', textAlign: 'right', fontFamily: 'ui-monospace,monospace', fontWeight: 800, color: r.balance < 0 ? '#2563eb' : '#0f172a', whiteSpace: 'nowrap' }}>{won(r.balance)}</td>
                    <td style={{ padding: '7px 12px', textAlign: 'center' }}>
                      {r.agingRaw ? (
                        <span style={{ fontSize: 11, fontWeight: 800, color: '#fff', background: r.color, borderRadius: 999, padding: '2px 9px' }}>
                          {r.agingRaw}
                        </span>
                      ) : r.agingMonths > 0 ? `${r.agingMonths}개월` : ''}
                    </td>
                    <td style={{ padding: '7px 12px', textAlign: 'right', fontFamily: 'ui-monospace,monospace', whiteSpace: 'nowrap' }}>{r.avgSalesMonthly == null ? '—' : won(r.avgSalesMonthly)}</td>
                    <td style={{ padding: '7px 12px', textAlign: 'right', fontFamily: 'ui-monospace,monospace', whiteSpace: 'nowrap' }}>{r.avgSalesCycle == null ? '—' : won(r.avgSalesCycle)}</td>
                  </tr>
                ))}
                {rows.length > 0 && <tr style={{ background: '#f1f5f9', fontWeight: 800, borderTop: '2px solid #cbd5e1' }}>
                  <td style={{ padding: '8px 12px', whiteSpace: 'nowrap' }}>표시 합계</td>
                  <td style={{ padding: '8px 12px', textAlign: 'right', fontFamily: 'ui-monospace,monospace', whiteSpace: 'nowrap' }}>{won(shownTotal.sales)}</td>
                  <td style={{ padding: '8px 12px', textAlign: 'right', fontFamily: 'ui-monospace,monospace', whiteSpace: 'nowrap' }}>{won(shownTotal.receipt)}</td>
                  <td style={{ padding: '8px 12px', textAlign: 'right', fontFamily: 'ui-monospace,monospace', whiteSpace: 'nowrap' }}>{won(shownTotal.etcDiff)}</td>
                  <td style={{ padding: '8px 12px', textAlign: 'right', fontFamily: 'ui-monospace,monospace', whiteSpace: 'nowrap' }}>{won(shownTotal.balance)}</td>
                  <td />
                  <td style={{ padding: '8px 12px', textAlign: 'right' }}>—</td>
                  <td style={{ padding: '8px 12px', textAlign: 'right' }}>—</td>
                </tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <p style={{ fontSize: 12, color: '#94a3b8', marginTop: 12, lineHeight: 1.6 }}>
        · 매출·수금·기타할인등차액·잔액·미회수월은 ECOUNT 채권 리포트 값입니다. 매출 평균은 Nenovaweb 확정 출고(Amount+Vat) 기준입니다.
        · 월평균은 {avgWindowLabel} 매출을 12로 나눈 값, 차수별 평균은 같은 기간 매출이 발생한 연도·대차수(세부차수 합산) 단위 평균입니다. 거래처명이 ERP 거래처와 유일하게 연결되지 않으면 평균은 —로 표시합니다.
        · 화면 새로고침은 현재 저장된 스냅샷을 다시 읽습니다.
      </p>
    </div>
  );
}

const segStyle = (on) => ({
  padding: '4px 12px', fontSize: 12, fontWeight: on ? 700 : 400, cursor: 'pointer',
  border: '1px solid ' + (on ? '#2563eb' : '#cbd5e1'), borderRadius: 6,
  background: on ? '#2563eb' : '#fff', color: on ? '#fff' : '#475569',
});
