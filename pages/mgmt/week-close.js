// 차수 마감 체크리스트 화면. 상태/메모는 추가 전용 기록(최신 행이 현재 상태).
import { useCallback, useState } from 'react';
import { apiGet, apiPost } from '../../lib/useApi';

const ST = { open: '미처리', done: '완료', skipped: '건너뜀' };

export default function MgmtWeekClose() {
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [week, setWeek] = useState('');
  const [data, setData] = useState(null);
  const [notes, setNotes] = useState({});
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setErr(''); setBusy(true);
    try {
      const r = await apiGet(`/api/mgmt/week-close?orderYear=${encodeURIComponent(year)}&orderWeek=${encodeURIComponent(week)}`);
      if (!r.success) throw new Error(r.error);
      setData(r);
      setNotes(Object.fromEntries((r.items || []).map((i) => [i.code, i.note || ''])));
    } catch (e) { setErr(e.message || String(e)); } finally { setBusy(false); }
  }, [year, week]);

  const mark = async (itemCode, status) => {
    setErr(''); setBusy(true);
    try {
      const r = await apiPost('/api/mgmt/week-close', { orderYear: year, orderWeek: week, itemCode, status, note: notes[itemCode] || '' });
      if (!r.success) throw new Error(r.error);
      setData(r);
    } catch (e) { setErr(e.message || String(e)); } finally { setBusy(false); }
  };

  return (
    <div className="wc">
      <h2>차수 마감 체크리스트</h2>
      <p className="note">자동 건수는 읽기 전용 집계입니다. 상태·메모는 기록으로만 쌓입니다(최신 기록이 현재 상태).</p>
      <div>
        <input value={year} onChange={(e) => setYear(e.target.value)} placeholder="연도" size={5} />
        <input value={week} onChange={(e) => setWeek(e.target.value)} placeholder="차수 예 42-1" size={10} />
        <button type="button" disabled={busy} onClick={load}>조회</button>
        {data?.closeable && <span className="badge">마감 가능</span>}
      </div>
      {err && <div className="err">{err}</div>}
      {data && (
        <table>
          <thead><tr><th>항목</th><th className="r">자동 건수</th><th>상태</th><th>메모</th><th /></tr></thead>
          <tbody>
            {data.items.map((i) => (
              <tr key={i.code}>
                <td>{i.label}</td>
                <td className="r">{i.auto ? (i.count == null ? '미연결' : i.count) : (data.verifyWeek?.available ? '실행 가능' : '스크립트 없음')}</td>
                <td>{ST[i.status]}</td>
                <td><input value={notes[i.code] || ''} onChange={(e) => setNotes({ ...notes, [i.code]: e.target.value })} placeholder="메모" /></td>
                <td>
                  <button type="button" disabled={busy} onClick={() => mark(i.code, 'done')}>완료</button>
                  <button type="button" disabled={busy} onClick={() => mark(i.code, 'skipped')}>건너뜀</button>
                  <button type="button" disabled={busy} onClick={() => mark(i.code, 'open')}>되돌림</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {data?.verifyWeek && <p className="note">불변식 검증은 화면에서 실행하지 않습니다. 터미널: {data.verifyWeek.command}</p>}
      <style jsx>{`
        .wc{padding:8px 4px;font-size:13px}.note{font-size:12px;color:var(--text3,#64748b)}.err{color:#b91c1c;margin:6px 0}
        table{border-collapse:collapse;width:100%;margin:8px 0}th,td{border-bottom:1px solid var(--border,#e2e8f0);padding:4px 8px;text-align:left}
        .r{text-align:right}input{margin-right:6px;padding:4px 6px}button{margin-right:4px}
        .badge{background:#166534;color:#fff;border-radius:10px;padding:2px 10px;margin-left:8px;font-weight:600}
      `}</style>
    </div>
  );
}
