// pages/admin/order-requests.js — 관리자 주문 신청 승인 페이지
import { useEffect, useState } from 'react';

export default function OrderRequestsPage() {
  const [requests, setRequests] = useState([]);
  const [details, setDetails]   = useState({}); // {requestKey: [details]}
  const [filter, setFilter]     = useState('pending');
  const [loading, setLoading]   = useState(false);
  const [msg, setMsg]           = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const r = await fetch(`/api/m/order-request?status=${filter}`);
      const d = await r.json();
      if (d.success) setRequests(d.requests);
    } catch (e) { setMsg(e.message); }
    setLoading(false);
  };

  useEffect(() => { load(); }, [filter]);

  const loadDetails = async (rk) => {
    if (details[rk]) return;
    const r = await fetch(`/api/m/order-request-detail?requestKey=${rk}`);
    const d = await r.json();
    if (d.success) setDetails(prev => ({ ...prev, [rk]: d.items }));
  };

  const approve = async (rk) => {
    if (!confirm('이 신청을 승인하시겠습니까? 실제 OrderMaster에 반영됩니다.')) return;
    const r = await fetch('/api/m/order-request-approve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requestKey: rk, action: 'approve' }),
    });
    const d = await r.json();
    if (d.success) { setMsg(`✅ 승인 완료 (OrderKey: ${d.orderKey})`); load(); }
    else setMsg(`⚠️ ${d.error}`);
  };

  const reject = async (rk) => {
    const reason = prompt('거절 사유 (선택):') || '';
    const r = await fetch('/api/m/order-request-approve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requestKey: rk, action: 'reject', rejectReason: reason }),
    });
    const d = await r.json();
    if (d.success) { setMsg('🚫 거절 처리됨'); load(); }
    else setMsg(`⚠️ ${d.error}`);
  };

  return (
    <div style={{ padding: 16 }}>
      <h2 style={{ margin: '0 0 12px' }}>📋 주문 등록 신청 관리</h2>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        {['pending', 'approved', 'rejected'].map(s => (
          <button
            key={s}
            className={`btn ${filter === s ? 'btn-primary' : ''}`}
            onClick={() => setFilter(s)}
          >
            {s === 'pending' ? '⏳ 대기' : s === 'approved' ? '✅ 승인' : '🚫 거절'}
          </button>
        ))}
        <button className="btn" onClick={load}>🔄 새로고침</button>
      </div>
      {msg && <div style={{ padding: 8, background: '#EDF2F7', borderRadius: 4, marginBottom: 12 }}>{msg}</div>}
      {loading && <div>로딩 중...</div>}
      {!loading && requests.length === 0 && <div>신청이 없습니다.</div>}
      <table className="tbl" style={{ width: '100%' }}>
        <thead>
          <tr>
            <th>#</th><th>거래처</th><th>차수</th><th>신청자</th>
            <th>품목수</th><th>신청일시</th><th>상태</th><th>액션</th>
          </tr>
        </thead>
        <tbody>
          {requests.map(r => (
            <tr key={r.RequestKey}>
              <td>{r.RequestKey}</td>
              <td>{r.CustName}</td>
              <td>{r.OrderWeek}</td>
              <td>{r.RequesterName}</td>
              <td style={{ textAlign: 'center' }}>
                <button className="btn btn-sm" onClick={() => loadDetails(r.RequestKey)}>
                  {r.itemCount}품목 {details[r.RequestKey] ? '▲' : '▼'}
                </button>
                {details[r.RequestKey] && (
                  <div style={{ textAlign: 'left', padding: 4, background: '#F7FAFC', marginTop: 4, fontSize: 11 }}>
                    {details[r.RequestKey].map((d, i) => (
                      <div key={i}>• {d.ProdName} : {d.Quantity} {d.Unit}</div>
                    ))}
                  </div>
                )}
              </td>
              <td>{new Date(r.CreatedAt).toLocaleString('ko-KR')}</td>
              <td>
                {r.Status === 'pending' && '⏳ 대기'}
                {r.Status === 'approved' && `✅ 승인 (Order #${r.ApprovedOrderKey})`}
                {r.Status === 'rejected' && `🚫 거절 ${r.RejectReason ? `· ${r.RejectReason}` : ''}`}
              </td>
              <td>
                {r.Status === 'pending' && (
                  <>
                    <button className="btn btn-sm btn-primary" onClick={() => approve(r.RequestKey)}>승인</button>
                    <button className="btn btn-sm" onClick={() => reject(r.RequestKey)}>거절</button>
                  </>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
