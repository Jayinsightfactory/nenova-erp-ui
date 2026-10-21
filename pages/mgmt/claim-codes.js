// 클레임 사유코드 화면: 코드 사전 + 불량차감 행 코드 연결 + 농장×사유 집계.
import { useCallback, useEffect, useState } from 'react';
import { apiGet, apiPost } from '../../lib/useApi';

export default function MgmtClaimCodes() {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [data, setData] = useState({ codes: [], rows: [], summary: [] });
  const [form, setForm] = useState({ code: '', label: '', category: '' });
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');

  const load = useCallback(async () => {
    setErr('');
    try { setData(await apiGet('/api/mgmt/claim-codes', { from: from || undefined, to: to || undefined })); }
    catch (e) { setErr(e.message || String(e)); }
  }, [from, to]);
  useEffect(() => { load(); }, [load]);

  const post = async (body, okMsg) => {
    setErr(''); setMsg('');
    try { const r = await apiPost('/api/mgmt/claim-codes', body); setMsg(okMsg ? okMsg(r) : '저장됨'); await load(); }
    catch (e) { setErr(e.message || String(e)); }
  };
  const active = data.codes.filter((c) => c.IsActive);

  return (
    <div className="cc">
      <h2>클레임 사유코드</h2>
      {msg && <div className="ok">{msg}</div>}
      {err && <div className="bad">{err}</div>}

      <h3>코드 사전</h3>
      <div className="bar">
        <button onClick={() => post({ action: 'seed' }, (r) => `시드 ${r.inserted}건 추가, ${r.skipped}건 이미 있음`)}>시드 넣기</button>
        <input placeholder="코드(예: Q-WILT)" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} />
        <input placeholder="이름" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} />
        <input placeholder="분류" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} />
        <button onClick={() => post({ action: 'save', ...form })}>추가/수정</button>
      </div>
      <table>
        <thead><tr><th>코드</th><th>이름</th><th>분류</th><th>사용</th></tr></thead>
        <tbody>
          {data.codes.length === 0 && <tr><td colSpan={4} className="empty">코드가 없습니다. [시드 넣기]를 누르세요.</td></tr>}
          {data.codes.map((c) => (
            <tr key={c.Code} className={c.IsActive ? '' : 'off'}>
              <td>{c.Code}</td><td>{c.Label}</td><td>{c.Category}</td>
              <td><button onClick={() => post({ action: 'toggle', code: c.Code, isActive: !c.IsActive })}>{c.IsActive ? '사용 중 → 끄기' : '꺼짐 → 켜기'}</button></td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3>기간 필터(불량차감 등록일 기준)</h3>
      <div className="bar">
        <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        <span>~</span>
        <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        <button onClick={load}>조회</button>
      </div>

      <h3>농장별·사유별 집계</h3>
      <table>
        <thead><tr><th>농장</th><th>사유코드</th><th>건수</th><th>수량 합</th></tr></thead>
        <tbody>
          {data.summary.length === 0 && <tr><td colSpan={4} className="empty">데이터 없음</td></tr>}
          {data.summary.map((s) => (
            <tr key={`${s.farm}|${s.code}`}><td>{s.farm}</td><td>{s.code}</td><td className="n">{s.count}</td><td className="n">{s.quantity.toLocaleString('ko-KR')}</td></tr>
          ))}
        </tbody>
      </table>
      <p className="note">수량 합은 행의 단위(박스/단 등)가 섞여 있을 수 있어 건수 중심으로 보세요. 농장이 비어 있는 행은 &apos;농장 미연결&apos;, 코드 미연결 행은 &apos;미분류&apos;로 표시합니다.</p>

      <h3>최근 불량차감 행(읽기) — 사유코드 연결</h3>
      <table>
        <thead><tr><th>키</th><th>차수</th><th>거래처</th><th>품목</th><th>농장</th><th>수량</th><th>사유코드</th></tr></thead>
        <tbody>
          {data.rows.length === 0 && <tr><td colSpan={7} className="empty">불량차감 행이 없습니다.</td></tr>}
          {data.rows.map((r) => (
            <tr key={r.deductionKey}>
              <td>{r.deductionKey}</td><td>{r.orderYear}-{r.orderWeek}</td><td>{r.custName}</td><td>{r.prodName}</td>
              <td>{r.farmName || '농장 미연결'}</td><td className="n">{r.quantity} {r.sourceUnit}</td>
              <td>
                <select value={r.code} onChange={(e) => e.target.value && post({ action: 'link', deductionKey: r.deductionKey, code: e.target.value })}>
                  <option value="">(미분류)</option>
                  {active.map((c) => <option key={c.Code} value={c.Code}>{c.Code} {c.Label}</option>)}
                </select>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <style jsx>{`
        .cc{padding:8px 4px;font-size:13px}h3{margin:14px 0 6px;font-size:14px}.note{font-size:12px;color:var(--text3,#64748b)}
        .bar{display:flex;gap:6px;margin:6px 0;flex-wrap:wrap}.bar input{padding:4px 6px;border:1px solid var(--border,#cbd5e1);border-radius:4px}
        table{border-collapse:collapse;width:100%}th,td{border:1px solid var(--border,#cbd5e1);padding:4px 8px;text-align:left}.n{text-align:right}
        .empty{text-align:center;color:var(--text3,#64748b)}.ok{color:#15803d}.bad{color:#b91c1c}tr.off{opacity:.5}
      `}</style>
    </div>
  );
}
