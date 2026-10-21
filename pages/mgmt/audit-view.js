// 변경 감사로그 통합뷰. 변경 사건(무엇이·언제·전→후)이 주어. 실행자 열은 되돌리기·문의 목적이며 사람별 집계는 없다.
import { useCallback, useEffect, useState } from 'react';
import { apiGet } from '../../lib/useApi';

const KINDS = ['단가', '수량', '확정', '한도', '승인'];

export default function MgmtAuditView() {
  const [f, setF] = useState({ from: '', to: '', kind: '', week: '', cust: '' });
  const [rows, setRows] = useState([]);
  const [missing, setMissing] = useState([]);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const qs = (extra = '') => {
    const p = new URLSearchParams();
    Object.entries(f).forEach(([k, v]) => { if (v) p.set(k, v); });
    return `${p.toString()}${extra}`;
  };

  const load = useCallback(async () => {
    setErr(''); setBusy(true);
    try {
      const r = await apiGet(`/api/mgmt/audit-view?${qs()}`);
      if (!r.success) throw new Error(r.error);
      setRows(r.events || []); setMissing(r.missing || []);
      setF((o) => (o.from ? o : { ...o, from: r.from, to: r.to }));
    } catch (e) { setErr(e.message || String(e)); } finally { setBusy(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f]);

  useEffect(() => { load(); /* 최초 1회(기본 7일) */ // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  return (
    <div className="av">
      <h2>변경 감사로그 통합뷰</h2>
      <p className="note">단가·수량·확정·한도·승인 변경만 표시합니다(조회 로그 제외). 실행자 열은 되돌리기·문의 용도입니다.</p>
      <div>
        <input type="date" value={f.from} onChange={set('from')} /> ~ <input type="date" value={f.to} onChange={set('to')} />
        <select value={f.kind} onChange={set('kind')}><option value="">전체 구분</option>{KINDS.map((k) => <option key={k} value={k}>{k}</option>)}</select>
        <input placeholder="차수 예 42-1" value={f.week} onChange={set('week')} size={10} />
        <input placeholder="거래처" value={f.cust} onChange={set('cust')} size={12} />
        <button type="button" disabled={busy} onClick={load}>조회</button>
        <a href={`/api/mgmt/audit-view?${qs('&format=csv')}`}>CSV 내보내기</a>
      </div>
      {err && <div className="err">{err}</div>}
      {missing.length > 0 && <div className="note">읽지 못한 원천: {missing.join(', ')}</div>}
      <table>
        <thead><tr><th>일시</th><th>구분</th><th>대상</th><th>변경 전</th><th>변경 후</th><th>원천</th><th>실행자(되돌리기·문의)</th></tr></thead>
        <tbody>
          {rows.map((e, i) => (
            <tr key={`${e.source}-${e.at}-${i}`}>
              <td>{String(e.at).replace('T', ' ').slice(0, 19)}</td><td>{e.kind}</td><td>{e.target}</td>
              <td>{e.before}</td><td>{e.after}</td><td>{e.source}</td><td>{e.actor}</td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={7} className="note">조건에 맞는 변경이 없습니다.</td></tr>}
        </tbody>
      </table>
      <style jsx>{`
        .av{padding:8px 4px;font-size:13px}.note{font-size:12px;color:var(--text3,#64748b)}.err{color:#b91c1c;margin:6px 0}
        table{border-collapse:collapse;width:100%;margin:8px 0}th,td{border-bottom:1px solid var(--border,#e2e8f0);padding:4px 8px;text-align:left}
        input,select{margin-right:6px;padding:4px 6px}button{margin-right:8px}
      `}</style>
    </div>
  );
}
