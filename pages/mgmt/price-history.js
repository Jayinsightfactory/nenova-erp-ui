// 단가 변경이력 화면. 스냅샷 비교 방식: [스냅샷 실행] 시점 간의 차이만 기록된다.
import { useCallback, useEffect, useState } from 'react';
import { apiGet, apiPost } from '../../lib/useApi';

const KIND = { customer: '거래처 단가', default: '기본 단가' };
const fmt = (v) => (v == null ? '-' : Number(v).toLocaleString('ko-KR', { maximumFractionDigits: 4 }));
const when = (v) => (v ? String(v).replace('T', ' ').slice(0, 19) : '-');

export default function MgmtPriceHistory() {
  const [q, setQ] = useState('');
  const [prodKey, setProdKey] = useState('');
  const [custKey, setCustKey] = useState('');
  const [rows, setRows] = useState([]);
  const [last, setLast] = useState(null);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setErr('');
    try {
      const r = await apiGet('/api/mgmt/price-history', { q: q || undefined, prodKey: prodKey || undefined, custKey: custKey || undefined });
      setRows(r.rows || []);
      setLast(r.last || null);
    } catch (e) { setErr(e.message || String(e)); }
  }, [q, prodKey, custKey]);
  useEffect(() => { load(); }, [load]);

  const snapshot = async () => {
    setBusy(true); setMsg(''); setErr('');
    try {
      const r = await apiPost('/api/mgmt/price-history', { action: 'snapshot' });
      setMsg(r.baseline ? `기준 스냅샷 저장(${r.rows}건). 다음 스냅샷부터 변경이 기록됩니다.` : `스냅샷 저장(${r.rows}건), 변경 ${r.changes}건 기록`);
      await load();
    } catch (e) { setErr(e.message || String(e)); } finally { setBusy(false); }
  };

  return (
    <div className="ph">
      <h2>단가 변경이력</h2>
      <p className="note">마지막 스냅샷: <b>{last?.takenAt ? when(last.takenAt) : '없음(아직 실행 안 함)'}</b> · 변경 시각은 정확한 수정 시각이 아니라 <b>스냅샷 시각</b>입니다(스냅샷 사이의 여러 번 수정은 최종값만 반영).</p>
      <div className="bar">
        <input placeholder="품목/거래처명" value={q} onChange={(e) => setQ(e.target.value)} />
        <input placeholder="ProdKey" value={prodKey} onChange={(e) => setProdKey(e.target.value.replace(/\D/g, ''))} style={{ width: 90 }} />
        <input placeholder="CustKey" value={custKey} onChange={(e) => setCustKey(e.target.value.replace(/\D/g, ''))} style={{ width: 90 }} />
        <button onClick={load}>조회</button>
        <button onClick={snapshot} disabled={busy}>{busy ? '실행 중…' : '스냅샷 실행'}</button>
      </div>
      {msg && <div className="ok">{msg}</div>}
      {err && <div className="bad">{err}</div>}
      <table>
        <thead><tr><th>변경 시각(스냅샷)</th><th>구분</th><th>거래처</th><th>품목</th><th>이전</th><th>이후</th><th>유형</th></tr></thead>
        <tbody>
          {rows.length === 0 && <tr><td colSpan={7} className="empty">이력이 없습니다. 스냅샷을 2회 이상 실행해야 차이가 기록됩니다.</td></tr>}
          {rows.map((r) => (
            <tr key={r.HistoryKey}>
              <td>{when(r.CreatedAt)}</td>
              <td>{KIND[r.PriceKind] || r.PriceKind}</td>
              <td>{r.CustKey == null ? '(전체)' : (r.CustName || r.CustKey)}</td>
              <td>{r.ProdName || r.ProdKey}</td>
              <td className="n">{fmt(r.BeforeValue)}</td>
              <td className="n">{fmt(r.AfterValue)}</td>
              <td>{r.BeforeValue == null ? '신규' : r.AfterValue == null ? '삭제' : '변경'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="panel">
        <b>단가 적용순서</b>
        <ul>
          <li>확인됨(pages/api/master/pricing-matrix.js): 단가 원천은 <code>CustomerProdCost</code>(거래처×품목 단가)와 <code>Product.Cost</code>(기본 단가) 두 가지입니다.</li>
          <li>특별단가: <b>미검증</b> — pricing-matrix 코드에 특별단가 테이블/우선순위 로직이 없습니다.</li>
          <li>거래처단가 &gt; 기본단가 우선순위: <b>미검증</b> — 이 코드는 조회·저장만 하며 실제 적용(견적/분배)의 선택 규칙은 확인하지 않았습니다.</li>
        </ul>
      </div>
      <style jsx>{`
        .ph{padding:8px 4px;font-size:13px}.note{font-size:12px;color:var(--text3,#64748b)}
        .bar{display:flex;gap:6px;margin:8px 0;flex-wrap:wrap}.bar input{padding:4px 6px;border:1px solid var(--border,#cbd5e1);border-radius:4px}
        table{border-collapse:collapse;width:100%}th,td{border:1px solid var(--border,#cbd5e1);padding:4px 8px;text-align:left}.n{text-align:right}
        .empty{text-align:center;color:var(--text3,#64748b)}.ok{color:#15803d}.bad{color:#b91c1c}
        .panel{margin-top:12px;padding:8px 12px;border:1px solid var(--border,#cbd5e1);border-radius:6px;background:var(--surface,#fff)}
      `}</style>
    </div>
  );
}
