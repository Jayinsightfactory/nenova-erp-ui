// pages/incoming-price/credit-history.js — 크레딧 변경/삭제 이력 (팝업)
import { useState, useEffect } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';

const fmtDtm = (v) => {
  if (!v) return '—';
  const d = new Date(v);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
};
const fmtUSD = v => v == null ? '—' : `$${Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function CreditHistoryPage() {
  const router = useRouter();
  const { farm, week } = router.query;

  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filterFarm, setFilterFarm] = useState('');
  const [filterWeek, setFilterWeek] = useState('');
  const [showDeleted, setShowDeleted] = useState(true);

  useEffect(() => {
    if (!router.isReady) return;
    setFilterFarm(farm || '');
    setFilterWeek(week || '');
    const params = new URLSearchParams();
    if (farm) params.set('farm', farm);
    if (week) params.set('week', week);
    fetch(`/api/incoming-price/credit-history?${params}`, { credentials: 'same-origin' })
      .then(r => r.json())
      .then(d => {
        if (d.success) setHistory(d.history || []);
        else setError(d.error || '조회 실패');
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [router.isReady, farm, week]);

  const reload = () => {
    setLoading(true);
    setError('');
    const params = new URLSearchParams();
    if (filterFarm) params.set('farm', filterFarm);
    if (filterWeek) params.set('week', filterWeek);
    fetch(`/api/incoming-price/credit-history?${params}`, { credentials: 'same-origin' })
      .then(r => r.json())
      .then(d => {
        if (d.success) setHistory(d.history || []);
        else setError(d.error || '조회 실패');
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  };

  const displayed = history.filter(h => showDeleted || !h.isDeleted);

  const farms = [...new Set(history.map(h => h.FarmName).filter(Boolean))].sort();
  const weeks = [...new Set(history.map(h => h.OrderWeek).filter(Boolean))].sort((a,b) => b.localeCompare(a));

  return (
    <>
      <Head><title>크레딧 변경 이력 — nenova ERP</title></Head>
      <div style={{ fontFamily: 'Arial, sans-serif', background: '#f8f9fa', minHeight: '100vh', padding: '0 0 40px' }}>
        {/* 헤더 */}
        <div style={{
          background: 'linear-gradient(to right, #000080, #1084d0)',
          color: '#fff', padding: '10px 20px',
          display: 'flex', alignItems: 'center', gap: 12,
        }}>
          <span style={{ fontWeight: 700, fontSize: 15 }}>💳 크레딧 변경/삭제 이력</span>
          <span style={{ fontSize: 11, opacity: 0.7, marginLeft: 'auto' }}>nenova ERP</span>
          <button onClick={() => window.close()}
            style={{ background: 'none', border: '1px solid rgba(255,255,255,0.4)', color: '#fff', cursor: 'pointer', fontSize: 11, padding: '2px 8px', borderRadius: 3 }}>
            닫기
          </button>
        </div>

        <div style={{ padding: '16px 20px' }}>
          {/* 필터 */}
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 14, flexWrap: 'wrap' }}>
            <select
              value={filterFarm}
              onChange={e => setFilterFarm(e.target.value)}
              style={{ padding: '5px 10px', border: '1px solid #ddd', borderRadius: 5, fontSize: 13 }}
            >
              <option value="">전체 농장</option>
              {farms.map(f => <option key={f} value={f}>{f}</option>)}
            </select>
            <select
              value={filterWeek}
              onChange={e => setFilterWeek(e.target.value)}
              style={{ padding: '5px 10px', border: '1px solid #ddd', borderRadius: 5, fontSize: 13 }}
            >
              <option value="">전체 차수</option>
              {weeks.map(w => <option key={w} value={w}>{w}</option>)}
            </select>
            <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 13, cursor: 'pointer' }}>
              <input type="checkbox" checked={showDeleted} onChange={e => setShowDeleted(e.target.checked)} />
              삭제 기록 포함
            </label>
            <button onClick={reload}
              style={{ padding: '5px 16px', background: '#1a237e', color: '#fff', border: 'none', borderRadius: 5, fontSize: 13, cursor: 'pointer' }}>
              조회
            </button>
            <span style={{ fontSize: 12, color: '#888', marginLeft: 'auto' }}>
              총 {displayed.length}건
            </span>
          </div>

          {error && <div style={{ color: '#c62828', marginBottom: 12, fontSize: 13 }}>❌ {error}</div>}
          {loading && <div style={{ textAlign: 'center', padding: 40, color: '#999' }}>로딩 중…</div>}

          {!loading && displayed.length === 0 && (
            <div style={{ textAlign: 'center', padding: 60, color: '#aaa', fontSize: 15 }}>이력이 없습니다.</div>
          )}

          {!loading && displayed.length > 0 && (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, background: '#fff', boxShadow: '0 1px 4px rgba(0,0,0,0.08)' }}>
              <thead>
                <tr style={{ background: '#1a237e', color: '#fff' }}>
                  <th style={thS(50)}>상태</th>
                  <th style={thS(120, 'left')}>농장</th>
                  <th style={thS(80)}>차수</th>
                  <th style={thS(100, 'right')}>금액</th>
                  <th style={thS(0, 'left')}>비고</th>
                  <th style={thS(150)}>변경일시</th>
                </tr>
              </thead>
              <tbody>
                {displayed.map((h, i) => {
                  const isDeleted = h.isDeleted === true || h.isDeleted === 1;
                  return (
                    <tr key={i} style={{
                      background: isDeleted ? '#fff5f5' : i % 2 === 0 ? '#fff' : '#f9f9f9',
                      borderBottom: '1px solid #eee',
                    }}>
                      <td style={{ padding: '8px 10px', textAlign: 'center' }}>
                        <span style={{
                          fontSize: 11, padding: '2px 8px', borderRadius: 10, fontWeight: 700,
                          background: isDeleted ? '#ffcdd2' : '#c8e6c9',
                          color: isDeleted ? '#c62828' : '#2e7d32',
                        }}>
                          {isDeleted ? '삭제' : '저장'}
                        </span>
                      </td>
                      <td style={{ padding: '8px 10px', fontWeight: 600 }}>{h.FarmName}</td>
                      <td style={{ padding: '8px 10px', textAlign: 'center', color: '#555' }}>{h.OrderWeek}</td>
                      <td style={{
                        padding: '8px 10px', textAlign: 'right', fontWeight: 600,
                        color: isDeleted ? '#999' : '#1a237e',
                        textDecoration: isDeleted ? 'line-through' : 'none',
                      }}>
                        {fmtUSD(h.CreditUSD)}
                      </td>
                      <td style={{ padding: '8px 10px', color: '#666', fontSize: 12 }}>{h.Memo || '—'}</td>
                      <td style={{ padding: '8px 10px', textAlign: 'center', color: '#888', fontSize: 12 }}>
                        {fmtDtm(h.ChangeDtm)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </>
  );
}

function thS(w, align = 'center') {
  return {
    padding: '9px 10px', textAlign: align, fontWeight: 700,
    ...(w > 0 ? { width: w, minWidth: w } : {}),
    borderRight: '1px solid rgba(255,255,255,0.15)',
  };
}
