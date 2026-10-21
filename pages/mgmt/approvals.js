// 승인요청(결재선) 목록·처리 화면. 요청자 본인은 승인/반려 불가(서버 검사).
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { apiGet, apiPost } from '../../lib/useApi';

const STATUS_LABEL = { draft: '초안', requested: '요청', approved: '승인', rejected: '반려', applied: '완료', cancelled: '취소' };
const NEXT = { draft: ['requested', 'cancelled'], requested: ['approved', 'rejected', 'cancelled'], approved: ['applied', 'cancelled'] };

export default function MgmtApprovals() {
  const router = useRouter();
  const targetKind = typeof router.query.targetKind === 'string' ? router.query.targetKind : '';
  const [status, setStatus] = useState('');
  const [rows, setRows] = useState([]);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setErr('');
    try {
      const r = await apiGet('/api/mgmt/approvals', { targetKind: targetKind || undefined, status: status || undefined });
      setRows(r.rows || []);
    } catch (e) { setErr(e.message || String(e)); }
  }, [targetKind, status]);

  useEffect(() => { load(); }, [load]);

  const act = async (requestId, to) => {
    const note = (to === 'rejected') ? window.prompt('반려 사유') : '';
    if (to === 'rejected' && !note) return;
    setBusy(true);
    try {
      const r = await apiPost('/api/mgmt/approvals', { action: 'transition', requestId, to, note });
      if (!r.success) throw new Error(r.error);
      await load();
    } catch (e) { setErr(e.message || String(e)); } finally { setBusy(false); }
  };

  return (
    <div className="mgmt-approvals">
      <h2>승인요청 {targetKind ? `· ${targetKind}` : ''}</h2>
      <div className="toolbar">
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">전체 상태</option>
          {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <button className="btn" onClick={load} disabled={busy}>새로고침</button>
      </div>
      {err && <div className="err">{err}</div>}
      <table className="table">
        <thead><tr><th>#</th><th>종류</th><th>대상</th><th>v</th><th>상태</th><th>요청자</th><th>요청시각</th><th>결정</th><th>처리</th></tr></thead>
        <tbody>
          {rows.length === 0 && <tr><td colSpan={9} className="empty">승인요청이 없습니다.</td></tr>}
          {rows.map((r) => (
            <tr key={r.RequestId}>
              <td>{r.RequestId}</td><td>{r.TargetKind}</td><td>{r.TargetRef}</td><td>{r.Version}</td>
              <td><span className={`st st-${r.Status}`}>{STATUS_LABEL[r.Status] || r.Status}</span></td>
              <td>{r.RequestedBy}</td><td>{r.RequestedAt ? String(r.RequestedAt).slice(0, 16).replace('T', ' ') : ''}</td>
              <td>{r.DecidedBy ? `${r.DecidedBy} ${r.DecisionNote ? `· ${r.DecisionNote}` : ''}` : ''}</td>
              <td>{(NEXT[r.Status] || []).map((to) => <button key={to} className="btn btn-sm" disabled={busy} onClick={() => act(r.RequestId, to)}>{STATUS_LABEL[to]}</button>)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <style jsx>{`
        .toolbar{display:flex;gap:8px;align-items:center;margin:8px 0}.err{background:#fff1f2;color:#b91c1c;padding:8px;margin-bottom:8px}
        .table{width:100%;font-size:12px}.table td,.table th{padding:5px 8px;white-space:nowrap}.empty{text-align:center;color:var(--text3,#64748b)}
        .st{padding:2px 6px;border-radius:4px;background:#eef2f7}.st-approved,.st-applied{background:#e8f5ec;color:#166534}.st-rejected,.st-cancelled{background:#fff1f2;color:#b91c1c}.st-requested{background:#fff7ed;color:#9a3412}
        .btn-sm{margin-right:4px}
      `}</style>
    </div>
  );
}
