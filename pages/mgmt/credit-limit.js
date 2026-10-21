// 여신한도 화면. 한도는 추가 전용 이력(덮어쓰기 없음). 잔액은 /api/sales/ar 와 같은 원천.
import { useCallback, useEffect, useState } from 'react';
import { apiGet, apiPost } from '../../lib/useApi';
import CreditBadge from '../../components/mgmt/CreditBadge';

const won = (n) => (n == null ? '-' : Math.round(Number(n)).toLocaleString());
const COLOR = { ok: '#166534', warn: '#92400e', over: '#991b1b', none: '#64748b' };

export default function MgmtCreditLimit() {
  const [rows, setRows] = useState([]);
  const [history, setHistory] = useState([]);
  const [total, setTotal] = useState(0);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [edit, setEdit] = useState(null);

  const load = useCallback(async () => {
    setErr('');
    try {
      const r = await apiGet('/api/mgmt/credit-limit');
      if (!r.success) throw new Error(r.error);
      setRows(r.rows || []);
      setHistory(r.history || []);
      setTotal(r.balanceTotal || 0);
    } catch (e) { setErr(e.message || String(e)); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const save = async () => {
    setBusy(true);
    try {
      const r = await apiPost('/api/mgmt/credit-limit', { custKey: edit.custKey, limitKRW: edit.limit, reason: edit.reason });
      if (!r.success) throw new Error(r.error);
      setEdit(null);
      await load();
    } catch (e) { setErr(e.message || String(e)); } finally { setBusy(false); }
  };

  return (
    <div className="cl">
      <h2>여신한도</h2>
      <p className="note">현재 채권 잔액 합계 {won(total)}원 (채권관리와 같은 계산). 한도 변경은 이력으로만 쌓입니다.</p>
      {err && <div className="err">{err}</div>}
      <table>
        <thead><tr><th>간판명</th><th>사업자명</th><th>담당자</th><th className="r">현재 한도</th><th className="r">채권 잔액</th><th className="r">한도 대비</th><th>상태</th><th /></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.custKey}>
              <td>{r.signboard}</td><td>{r.custName}</td><td>{r.manager}</td>
              <td className="r">{won(r.limitKRW)}</td><td className="r">{won(r.balance)}</td>
              <td className="r">{r.pct == null ? '-' : `${r.pct}%`}</td>
              <td style={{ color: COLOR[r.status], fontWeight: 600 }}>{r.statusLabel}</td>
              <td><button type="button" onClick={() => setEdit({ custKey: r.custKey, name: r.signboard, limit: r.limitKRW ?? '', reason: '' })}>한도 변경</button></td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={8} className="note">표시할 거래처가 없습니다.</td></tr>}
        </tbody>
      </table>

      {edit && (
        <div className="panel">
          <strong>{edit.name} 한도 변경</strong> <CreditBadge custKey={edit.custKey} />
          <div>
            <input type="number" min="0" placeholder="한도(원)" value={edit.limit} onChange={(e) => setEdit({ ...edit, limit: e.target.value })} />
            <input type="text" placeholder="변경 사유(필수)" value={edit.reason} onChange={(e) => setEdit({ ...edit, reason: e.target.value })} />
            <button type="button" disabled={busy} onClick={save}>저장(이력 추가)</button>
            <button type="button" onClick={() => setEdit(null)}>닫기</button>
          </div>
        </div>
      )}

      <h3>한도 변경 이력</h3>
      <table>
        <thead><tr><th>일시</th><th>거래처</th><th className="r">한도</th><th>사유</th><th>등록자</th></tr></thead>
        <tbody>
          {history.map((h) => (
            <tr key={h.HistoryKey}><td>{String(h.CreatedAt).replace('T', ' ').slice(0, 19)}</td><td>{h.signboard}</td><td className="r">{won(h.LimitKRW)}</td><td>{h.Reason}</td><td>{h.CreatedBy}</td></tr>
          ))}
          {history.length === 0 && <tr><td colSpan={5} className="note">변경 이력이 없습니다.</td></tr>}
        </tbody>
      </table>
      <style jsx>{`
        .cl{padding:8px 4px;font-size:13px}.note{font-size:12px;color:var(--text3,#64748b)}.err{color:#b91c1c;margin:6px 0}
        table{border-collapse:collapse;width:100%;margin:8px 0}th,td{border-bottom:1px solid var(--border,#e2e8f0);padding:4px 8px;text-align:left}
        .r{text-align:right}.panel{border:1px solid var(--border,#cbd5e1);border-radius:8px;padding:10px;margin:10px 0}
        .panel input{margin:6px 6px 0 0;padding:4px 6px}
      `}</style>
    </div>
  );
}
