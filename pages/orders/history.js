// pages/orders/history.js — 주문 변경이력 상세 조회
import { useEffect, useState } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { apiGet } from '../../lib/useApi';
import { formatWeekDisplay } from '../../lib/useWeekInput';

const fmtValue = (value) => {
  const raw = String(value ?? '').trim();
  return raw || '0';
};

export default function OrderHistoryPage() {
  const router = useRouter();
  const [week, setWeek] = useState('');
  const [custName, setCustName] = useState('');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  const load = async (nextWeek = week, nextCustName = custName) => {
    setLoading(true);
    setErr('');
    try {
      const d = await apiGet('/api/orders/history', {
        week: nextWeek,
        custName: nextCustName,
      });
      if (!d.success) throw new Error(d.error || '조회 실패');
      setRows(d.history || []);
    } catch (e) {
      setErr(e.message);
      setRows([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!router.isReady) return;
    const qWeek = String(router.query.week || '');
    const qCustName = String(router.query.custName || '');
    setWeek(qWeek);
    setCustName(qCustName);
    load(qWeek, qCustName);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router.isReady, router.query.week, router.query.custName]);

  const countByCustomer = rows.reduce((acc, row) => {
    const key = row.거래처명 || '기타';
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  return (
    <>
      <Head><title>주문 변경이력 - nenova ERP</title></Head>
      <div style={{ padding: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
          <h2 style={{ margin: 0, fontSize: 18, color: '#1a237e' }}>주문 변경이력</h2>
          {week && (
            <span style={{ padding: '3px 10px', borderRadius: 12, background: '#e8eaf6', color: '#1a237e', fontSize: 12, fontWeight: 800 }}>
              {formatWeekDisplay(week)}
            </span>
          )}
          <button
            onClick={() => window.opener ? window.close() : history.back()}
            style={{ marginLeft: 'auto', padding: '6px 14px', border: '1px solid #bbb', borderRadius: 5, background: '#f5f5f5', cursor: 'pointer' }}
          >
            닫기
          </button>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', padding: 10, border: '1px solid #cfd8dc', borderRadius: 8, background: '#f8fbff', marginBottom: 12 }}>
          <label style={{ display: 'grid', gap: 3, fontSize: 12, fontWeight: 700, color: '#455a64' }}>
            차수
            <input
              value={week}
              onChange={e => setWeek(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && load()}
              placeholder="2026-23-01"
              style={{ width: 140, padding: '6px 8px', border: '1px solid #b0bec5', borderRadius: 5 }}
            />
          </label>
          <label style={{ display: 'grid', gap: 3, fontSize: 12, fontWeight: 700, color: '#455a64' }}>
            거래처
            <input
              value={custName}
              onChange={e => setCustName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && load()}
              placeholder="거래처명"
              style={{ width: 180, padding: '6px 8px', border: '1px solid #b0bec5', borderRadius: 5 }}
            />
          </label>
          <button
            onClick={() => load()}
            disabled={loading}
            style={{ alignSelf: 'end', padding: '7px 18px', border: 'none', borderRadius: 5, background: loading ? '#90a4ae' : '#1565c0', color: '#fff', fontWeight: 800, cursor: loading ? 'wait' : 'pointer' }}
          >
            {loading ? '조회중' : '조회'}
          </button>
          <div style={{ marginLeft: 'auto', fontSize: 12, color: '#607d8b' }}>
            총 <strong style={{ color: '#263238' }}>{rows.length}</strong>건
          </div>
        </div>

        {Object.keys(countByCustomer).length > 0 && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
            {Object.entries(countByCustomer).slice(0, 18).map(([name, count]) => (
              <button
                key={name}
                onClick={() => { setCustName(name === '기타' ? '' : name); load(week, name === '기타' ? '' : name); }}
                style={{ padding: '4px 9px', border: '1px solid #c5cae9', borderRadius: 12, background: '#fff', color: '#1a237e', cursor: 'pointer', fontSize: 12 }}
              >
                {name} {count}
              </button>
            ))}
          </div>
        )}

        {err && (
          <div style={{ padding: 10, border: '1px solid #ffcdd2', borderRadius: 6, background: '#ffebee', color: '#c62828', marginBottom: 10 }}>
            {err}
          </div>
        )}

        <div style={{ border: '1px solid #cfd8dc', borderRadius: 8, overflow: 'auto', background: '#fff' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 1040 }}>
            <thead>
              <tr style={{ background: '#dfe6f2', color: '#263238' }}>
                <th style={th}>변경일자</th>
                <th style={th}>거래처명</th>
                <th style={th}>국가</th>
                <th style={th}>꽃</th>
                <th style={{ ...th, textAlign: 'left' }}>품목명</th>
                <th style={th}>변경항목</th>
                <th style={th}>기준값</th>
                <th style={th}>변경값</th>
                <th style={{ ...th, textAlign: 'left' }}>비고</th>
                <th style={th}>사용자</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={10} style={{ padding: 24, textAlign: 'center', color: '#607d8b' }}>변경이력을 불러오는 중입니다.</td></tr>
              )}
              {!loading && rows.length === 0 && (
                <tr><td colSpan={10} style={{ padding: 24, textAlign: 'center', color: '#78909c' }}>표시할 주문 변경이력이 없습니다.</td></tr>
              )}
              {!loading && rows.map((row, idx) => (
                <tr key={`${row.변경일자}-${row.거래처명}-${row.품목명}-${idx}`} style={{ background: idx % 2 ? '#fbfcff' : '#fff', borderTop: '1px solid #edf1f5' }}>
                  <td style={tdCenter}>{row.변경일자}</td>
                  <td style={{ ...tdCenter, fontWeight: 800, color: '#1a237e' }}>{row.거래처명 || '-'}</td>
                  <td style={tdCenter}>{row.국가 || '-'}</td>
                  <td style={tdCenter}>{row.꽃 || '-'}</td>
                  <td style={tdLeft}>{row.품목명 || '-'}</td>
                  <td style={tdCenter}>{row.변경항목 || row.변경유형 || '-'}</td>
                  <td style={{ ...tdCenter, color: '#999', textDecoration: 'line-through' }}>{fmtValue(row.기준값)}</td>
                  <td style={{ ...tdCenter, color: '#2e7d32', fontWeight: 900 }}>{fmtValue(row.변경값)}</td>
                  <td style={tdLeft}>{row.비고 || ''}</td>
                  <td style={tdCenter}>{row.변경사용자 || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

const th = { padding: '8px 9px', borderRight: '1px solid #c8d3df', textAlign: 'center', whiteSpace: 'nowrap', fontWeight: 800 };
const tdCenter = { padding: '7px 9px', borderRight: '1px solid #edf1f5', textAlign: 'center', whiteSpace: 'nowrap' };
const tdLeft = { padding: '7px 9px', borderRight: '1px solid #edf1f5', textAlign: 'left' };
