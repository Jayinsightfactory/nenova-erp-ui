// pages/finance/journal.js — 전표현황 (명세 §6 회계거래현황/회계거래대장 대응)
// 열: 일자-No. | 거래유형 | 합계 | 거래처명 | 계정 | 부서 | 적요 | 결재상태  + 월별 소계·총계 행, Excel 내보내기
// 필터: 기간, 전표No, 거래유형, 거래처, 계정, 부서, 금액, 적요, 결재완료만, 마감 포함, 취소 포함. 읽기 전용.
import { useState, useEffect, useCallback, Fragment } from 'react';
import { apiGet } from '../../lib/useApi';

const fmt = (n) => Number(n || 0).toLocaleString();
const today = () => new Date().toISOString().slice(0, 10);
const yearStart = () => today().slice(0, 4) + '-01-01';
const JTYPES = ['지출결의서', '지급결의서', '급여결의서', '역분개'];
const STATUS_COLOR = { 작성: '#6b7280', 결재완료: '#1d4ed8', 송금완료: '#b45309', 전표반영: '#065f46', 취소: '#dc2626' };

export default function JournalPage() {
  const [flt, setFlt] = useState({ dateFrom: yearStart(), dateTo: today(), journalNo: '', journalType: '', custName: '', accountCode: '', dept: '', amountMin: '', amountMax: '', descr: '', approvedOnly: '', includeClosed: '1', includeCancelled: '' });
  const [rows, setRows] = useState([]);
  const [byMonth, setByMonth] = useState([]);
  const [grand, setGrand] = useState(0);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [accounts, setAccounts] = useState([]);
  const [detail, setDetail] = useState(null);

  const load = useCallback(() => {
    setLoading(true); setErr('');
    apiGet('/api/finance/journal', flt)
      .then((d) => { setRows(d.rows || []); setByMonth(d.byMonth || []); setGrand(d.grand || 0); })
      .catch((e) => setErr(e.message)).finally(() => setLoading(false));
  }, [flt]);
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { apiGet('/api/finance/voucher/accounts').then((d) => setAccounts(d.accounts || [])).catch(() => {}); }, []);

  const F = (k) => (e) => setFlt((p) => ({ ...p, [k]: e.target.type === 'checkbox' ? (e.target.checked ? '1' : '') : e.target.value }));
  const exportExcel = () => {
    const qs = new URLSearchParams(Object.fromEntries(Object.entries({ ...flt, format: 'xlsx' }).filter(([, v]) => v !== '' && v !== undefined))).toString();
    window.open(`/api/finance/journal?${qs}`, '_blank');
  };
  const openDetail = async (j) => { try { const d = await apiGet('/api/finance/journal', { journalKey: j.journalKey }); setDetail(d.journal); } catch (e) { alert(e.message); } };

  // 월별 그룹(소계 행 삽입)
  const groups = [];
  for (const j of rows) {
    const ym = j.journalDate.slice(0, 7);
    let g = groups[groups.length - 1];
    if (!g || g.ym !== ym) { g = { ym, rows: [], total: byMonth.find((m) => m.ym === ym)?.total || 0 }; groups.push(g); }
    g.rows.push(j);
  }

  return (
    <>
      <div className="filter-bar" style={{ flexWrap: 'wrap', gap: 6 }}>
        <input type="date" className="filter-input" value={flt.dateFrom} onChange={F('dateFrom')} /><span>~</span>
        <input type="date" className="filter-input" value={flt.dateTo} onChange={F('dateTo')} />
        <input className="filter-input" placeholder="전표No" value={flt.journalNo} onChange={F('journalNo')} style={{ width: 100 }} />
        <select className="filter-input" value={flt.journalType} onChange={F('journalType')}><option value="">거래유형 전체</option>{JTYPES.map((t) => <option key={t}>{t}</option>)}</select>
        <input className="filter-input" placeholder="거래처명" value={flt.custName} onChange={F('custName')} style={{ width: 130 }} />
        <select className="filter-input" value={flt.accountCode} onChange={F('accountCode')} style={{ maxWidth: 200 }}><option value="">계정 전체</option>{accounts.map((a) => <option key={a.accountCode} value={a.accountCode}>{a.accountCode} {a.accountName}</option>)}</select>
        <input className="filter-input" placeholder="부서" value={flt.dept} onChange={F('dept')} style={{ width: 90 }} />
        <input className="filter-input" placeholder="금액≥" value={flt.amountMin} onChange={F('amountMin')} style={{ width: 100 }} />
        <input className="filter-input" placeholder="금액≤" value={flt.amountMax} onChange={F('amountMax')} style={{ width: 100 }} />
        <input className="filter-input" placeholder="적요" value={flt.descr} onChange={F('descr')} style={{ width: 150 }} onKeyDown={(e) => e.key === 'Enter' && load()} />
        <label style={{ fontSize: 12 }}><input type="checkbox" checked={flt.approvedOnly === '1'} onChange={F('approvedOnly')} /> 결재완료만</label>
        <label style={{ fontSize: 12 }}><input type="checkbox" checked={flt.includeClosed === '1'} onChange={F('includeClosed')} /> 마감 포함</label>
        <label style={{ fontSize: 12 }}><input type="checkbox" checked={flt.includeCancelled === '1'} onChange={F('includeCancelled')} /> 취소 포함</label>
        <div className="page-actions">
          <button className="btn btn-primary" onClick={load}>검색</button>
          <button className="btn" onClick={exportExcel} disabled={!rows.length}>Excel</button>
          <button className="btn" onClick={() => window.print()}>인쇄</button>
        </div>
      </div>
      {err && <div className="banner-err" style={{ marginBottom: 10 }}>⚠️ {err}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, marginBottom: 12 }}>
        <div className="card" style={{ padding: '10px 14px', borderTop: '3px solid #111827' }}><div style={{ fontSize: 12, color: 'var(--text3)' }}>총계</div><div style={{ fontSize: 20, fontWeight: 700 }}>{fmt(grand)}</div><div style={{ fontSize: 12 }}>{rows.length}건</div></div>
        {byMonth.map((m) => <div key={m.ym} className="card" style={{ padding: '10px 14px', borderTop: '3px solid #1d4ed8' }}><div style={{ fontSize: 12, color: 'var(--text3)' }}>{m.ym} 월계</div><div style={{ fontSize: 18, fontWeight: 700 }}>{fmt(m.total)}</div></div>)}
      </div>

      <div className="card">
        <div className="card-header"><span className="card-title">전표현황</span><span style={{ fontSize: 12, color: 'var(--text3)' }}>검증 앵커: 월별 지출결의서 합계 ↔ ECOUNT 회계거래현황 월계 (행 클릭 → 분개 상세)</span></div>
        {loading ? <div className="skeleton" style={{ height: 240 }} /> : (
          <div style={{ overflowX: 'auto' }}>
            <table className="tbl">
              <thead><tr><th>일자-No.</th><th>거래유형</th><th className="num">합계</th><th>거래처명</th><th>계정(차변)</th><th>부서</th><th>적요</th><th>결재상태</th><th>전표상태</th></tr></thead>
              <tbody>
                {rows.length === 0 && <tr><td colSpan={9} style={{ textAlign: 'center', color: 'var(--text3)', padding: 30 }}>조회 결과 없음</td></tr>}
                {groups.map((g) => (
                  <Fragment key={g.ym}>
                    {g.rows.map((j) => (
                      <tr key={j.journalKey} style={{ cursor: 'pointer', color: j.status === '취소' ? '#9ca3af' : undefined }} onClick={() => openDetail(j)}>
                        <td style={{ fontFamily: 'monospace', whiteSpace: 'nowrap' }}>{j.journalDate.slice(2).replace(/-/g, '/')}-{j.journalNo.split('-')[1]}</td>
                        <td>{j.journalType}</td><td className="num" style={{ fontWeight: 600 }}>{fmt(j.totalDebit)}</td><td>{j.custName}</td>
                        <td style={{ fontSize: 12 }}>{j.accounts}</td><td>{j.depts}</td><td style={{ fontSize: 12 }}>{j.descr}</td>
                        <td><span style={{ color: STATUS_COLOR[j.voucherStatus] || '#6b7280', fontWeight: 600 }}>{j.voucherStatus || '-'}</span></td>
                        <td>{j.status}{j.reversedByKey ? ' (역분개됨)' : ''}{j.isClosed ? ' 🔒' : ''}</td>
                      </tr>
                    ))}
                    <tr style={{ fontWeight: 700, background: '#ebf1de' }}><td colSpan={2}>{g.ym} 월계 ({g.rows.length}건)</td><td className="num">{fmt(g.total)}</td><td colSpan={6} /></tr>
                  </Fragment>
                ))}
              </tbody>
              {rows.length > 0 && <tfoot><tr style={{ fontWeight: 700, background: '#dce6f2' }}><td colSpan={2}>총계 ({rows.length}건)</td><td className="num">{fmt(grand)}</td><td colSpan={6} /></tr></tfoot>}
            </table>
          </div>
        )}
      </div>

      {detail && (
        <div className="modal-overlay" onClick={() => setDetail(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ minWidth: 720, maxHeight: '90vh', overflowY: 'auto' }}>
            <h3 style={{ marginTop: 0 }}>전표 {detail.journalNo} · {detail.journalType} · {detail.status}</h3>
            <div style={{ fontSize: 13, marginBottom: 8 }}>일자 {detail.journalDate} · 거래처 {detail.custName || '-'} · 결의서 {detail.voucherNo || '-'}({detail.voucherStatus || '-'}){detail.reversalOfKey ? ` · 원전표 역분개` : ''}{detail.reversedByKey ? ' · 역분개됨(수정 불가)' : ''}</div>
            <table className="tbl">
              <thead><tr><th>#</th><th>차/대</th><th>계정</th><th className="num">차변</th><th className="num">대변</th><th>적요</th><th>부서</th><th>차수</th></tr></thead>
              <tbody>{detail.lines.map((l) => (
                <tr key={l.lineKey}><td>{l.lineNo}</td><td>{l.side === 'DR' ? '차변' : '대변'}</td><td>{l.accountCode} {l.accountName}</td>
                  <td className="num">{l.side === 'DR' ? fmt(l.amount) : ''}</td><td className="num">{l.side === 'CR' ? fmt(l.amount) : ''}</td><td>{l.descr}</td><td>{l.dept}</td><td>{l.orderYearWeek}</td></tr>
              ))}</tbody>
              <tfoot><tr style={{ fontWeight: 700 }}><td colSpan={3}>합계</td><td className="num">{fmt(detail.totalDebit)}</td><td className="num">{fmt(detail.totalCredit)}</td><td colSpan={3}>{detail.totalDebit === detail.totalCredit ? '✔ 차대 일치' : '✖ 불일치'}</td></tr></tfoot>
            </table>
            <div style={{ textAlign: 'right', marginTop: 8 }}><button className="btn" onClick={() => setDetail(null)}>닫기</button></div>
          </div>
        </div>
      )}
    </>
  );
}
