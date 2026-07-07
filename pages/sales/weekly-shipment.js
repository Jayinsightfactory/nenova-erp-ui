import { useState, useEffect, useMemo } from 'react';
import { apiGetExe } from '../../lib/exeParity/client.js';
import { useLang } from '../../lib/i18n';

const fmt = (n) => Number(n || 0).toLocaleString();
const YEARS = ['2024', '2025', '2026', '2027'];
const FIX_OPTS = [
  { v: 'all', label: '전체(분배)' },
  { v: 'fixed', label: '확정만' },
  { v: 'unfixed', label: '미확정만' },
];
const METRICS = [
  { v: 'amount', label: '매출(공급가)' },
  { v: 'total', label: '합계(VAT포함)' },
  { v: 'qty', label: '출고수량' },
];

export default function WeeklyShipmentSales() {
  const { t } = useLang();
  const [year, setYear] = useState('2026');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [fix, setFix] = useState('all');
  const [metric, setMetric] = useState('amount');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  const load = (params = {}) => {
    setLoading(true);
    apiGetExe('/api/sales/weekly-shipment', { year, fix, from: from || undefined, to: to || undefined, ...params })
      .then((d) => {
        setData(d);
        setErr('');
        if (d.from && !from) setFrom(d.from);
        if (d.to && !to) setTo(d.to);
      })
      .catch((e) => setErr(e.message))
      .finally(() => setLoading(false));
  };

  // 최초 + 연도/확정 변경 시 조회 (범위는 서버 기본값)
  useEffect(() => { setFrom(''); setTo(''); load({ from: undefined, to: undefined }); /* eslint-disable-next-line */ }, [year, fix]);

  const weeks = data?.weeks || [];
  const rows = data?.rows || [];
  const countryTotals = data?.countryTotals || {};
  const weekTotals = data?.weekTotals || {};
  const grand = data?.grandTotal || {};
  const available = data?.availableWeeks || [];
  const isMoney = metric !== 'qty';

  const mv = (cell) => (!cell ? 0 : metric === 'qty' ? cell.qty : metric === 'total' ? cell.total : cell.amount);

  // 국가별 그룹 렌더 목록
  const groups = useMemo(() => {
    const g = [];
    let cur = null;
    for (const row of rows) {
      if (!cur || cur.counName !== row.counName) {
        cur = { counName: row.counName, rows: [] };
        g.push(cur);
      }
      cur.rows.push(row);
    }
    return g;
  }, [rows]);

  const handleExport = () => {
    const qs = new URLSearchParams({ year, from: from || data?.from || '', to: to || data?.to || '', fix }).toString();
    const a = document.createElement('a');
    a.href = `/api/sales/weekly-shipment-excel?${qs}`;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  return (
    <div>
      <div className="filter-bar" style={{ flexWrap: 'wrap', gap: 8 }}>
        <span className="filter-label">연도</span>
        <select className="filter-input" value={year} onChange={(e) => setYear(e.target.value)}>
          {YEARS.map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
        <span className="filter-label">차수</span>
        <select className="filter-input" value={from} onChange={(e) => setFrom(e.target.value)}>
          {available.map((w) => <option key={w} value={w}>{w}</option>)}
        </select>
        <span style={{ color: 'var(--text3)' }}>~</span>
        <select className="filter-input" value={to} onChange={(e) => setTo(e.target.value)}>
          {available.map((w) => <option key={w} value={w}>{w}</option>)}
        </select>
        <span className="filter-label">확정</span>
        <select className="filter-input" value={fix} onChange={(e) => setFix(e.target.value)}>
          {FIX_OPTS.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
        </select>
        <span className="filter-label">지표</span>
        <select className="filter-input" value={metric} onChange={(e) => setMetric(e.target.value)}>
          {METRICS.map((m) => <option key={m.v} value={m.v}>{m.label}</option>)}
        </select>
        <div className="page-actions">
          <button className="btn btn-primary" onClick={() => load()}>{t('조회')}</button>
          <button className="btn btn-secondary" onClick={handleExport} disabled={!rows.length}>{t('엑셀')}</button>
        </div>
      </div>

      {err && <div style={{ padding: '8px 14px', background: 'var(--red-bg)', color: 'var(--red)', borderRadius: 8, marginBottom: 10, fontSize: 13 }}>⚠️ {err}</div>}

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
        <div style={{ padding: '8px 14px', background: 'var(--blue-bg)', color: 'var(--blue)', borderRadius: 8, fontSize: 13 }}>
          💰 총 매출(공급가) <strong>{fmt(grand.amount)}</strong> 원 · 합계(VAT포함) <strong>{fmt(grand.total)}</strong> 원 · 출고 <strong>{fmt(grand.qty)}</strong>
        </div>
        {grand.noPriceCnt > 0 && (
          <div style={{ padding: '8px 14px', background: 'var(--red-bg)', color: 'var(--red)', borderRadius: 8, fontSize: 13 }}>
            ⚠️ 단가 미설정 출고 <strong>{fmt(grand.noPriceCnt)}</strong>건 (수량 {fmt(grand.noPriceQty)}) — 매출 0 처리됨. 업체별 단가 확인 필요
          </div>
        )}
      </div>

      {loading ? (
        <div className="skeleton" style={{ height: 400, borderRadius: 12 }} />
      ) : !rows.length ? (
        <div className="card" style={{ padding: 40, textAlign: 'center', color: 'var(--text3)' }}>해당 범위에 출고 데이터가 없습니다.</div>
      ) : (
        <div className="card">
          <div className="card-header">
            <span className="card-title">차수별 품종 매출 — {METRICS.find((m) => m.v === metric)?.label}</span>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table className="tbl" style={{ minWidth: 700 }}>
              <thead>
                <tr>
                  <th style={{ position: 'sticky', left: 0, background: 'var(--bg2, #fff)', minWidth: 80 }}>국가</th>
                  <th style={{ minWidth: 150 }}>품종</th>
                  {weeks.map((w) => <th key={w} style={{ textAlign: 'right', fontFamily: 'var(--mono)' }}>{w}</th>)}
                  <th style={{ textAlign: 'right', fontWeight: 800 }}>합계</th>
                </tr>
              </thead>
              <tbody>
                {groups.map((g) => {
                  const ct = countryTotals[g.counName];
                  return [
                    ...g.rows.map((row, i) => (
                      <tr key={`${g.counName}-${row.countryFlower}`}>
                        <td style={{ color: 'var(--text3)', fontSize: 12 }}>{i === 0 ? g.counName : ''}</td>
                        <td>{row.countryFlower}{row.total.noPriceCnt > 0 && <span title={`단가미설정 ${row.total.noPriceCnt}건`} style={{ color: 'var(--red)', marginLeft: 4 }}>⚠</span>}</td>
                        {weeks.map((w) => <td key={w} className="num">{mv(row.byWeek[w]) ? fmt(mv(row.byWeek[w])) : <span style={{ color: 'var(--text3)' }}>-</span>}</td>)}
                        <td className="num" style={{ fontWeight: 700, color: isMoney ? 'var(--blue)' : 'inherit' }}>{fmt(mv(row.total))}</td>
                      </tr>
                    )),
                    ct && (
                      <tr key={`${g.counName}-subtotal`} style={{ background: 'var(--bg3, #f7f7f7)', fontWeight: 700 }}>
                        <td colSpan={2} style={{ fontSize: 12 }}>{g.counName} 소계</td>
                        {weeks.map((w) => <td key={w} className="num">{fmt(mv(ct.byWeek[w]))}</td>)}
                        <td className="num">{fmt(mv(ct.total))}</td>
                      </tr>
                    ),
                  ];
                })}
              </tbody>
              <tfoot>
                <tr className="foot" style={{ fontWeight: 800 }}>
                  <td colSpan={2}>차수별 합계</td>
                  {weeks.map((w) => <td key={w} className="num">{fmt(mv(weekTotals[w]))}</td>)}
                  <td className="num">{fmt(mv(grand))}</td>
                </tr>
              </tfoot>
            </table>
          </div>
          <div style={{ padding: '8px 14px', fontSize: 11, color: 'var(--text3)', borderTop: '1px solid var(--border, #eee)' }}>
            판매금액 = 업체별단가 × 환산수량. 공급가 = 청구액 ÷ 1.1 (exe 동일). "전체(분배)"는 미확정 출고도 포함 — 진행 중 차수 확인용.
          </div>
        </div>
      )}
    </div>
  );
}
