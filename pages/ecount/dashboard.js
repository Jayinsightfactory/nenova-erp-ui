// pages/ecount/dashboard.js — 이카운트 연동 현황 대시보드

import { useState, useEffect, useCallback } from 'react';
import Layout from '../../components/Layout';
import { apiGet, apiPost } from '../../lib/useApi';

const fmt = n => Number(n || 0).toLocaleString();

const SYNC_TYPE_COLOR = {
  '판매입력': { bg: '#dbeafe', color: '#1d4ed8' },
  '구매입력': { bg: '#fce7f3', color: '#9d174d' },
  '거래처':   { bg: '#d1fae5', color: '#065f46' },
  '품목':     { bg: '#fef3c7', color: '#92400e' },
  '자동분개': { bg: '#ede9fe', color: '#5b21b6' },
};

function SyncTypeBadge({ type }) {
  const c = SYNC_TYPE_COLOR[type] || { bg: '#e5e7eb', color: '#374151' };
  return (
    <span style={{
      display: 'inline-block', padding: '2px 8px', borderRadius: 10,
      fontSize: 11, fontWeight: 700, background: c.bg, color: c.color,
    }}>
      {type}
    </span>
  );
}

function StatusDot({ connected }) {
  return (
    <span style={{
      display: 'inline-block', width: 10, height: 10, borderRadius: '50%',
      background: connected ? '#22c55e' : '#ef4444',
      boxShadow: connected ? '0 0 6px #22c55e' : '0 0 6px #ef4444',
      marginRight: 6,
    }} />
  );
}

export default function EcountDashboard() {
  // API 상태
  const [apiStatus, setApiStatus]         = useState(null);
  const [apiLoading, setApiLoading]       = useState(false);

  // 동기화 이력
  const [logs, setLogs]                   = useState([]);
  const [pendingSales, setPendingSales]   = useState(0);
  const [pendingPurchases, setPendingPurchases] = useState(0);
  const [summary, setSummary]             = useState({ success: 0, fail: 0 });
  const [logsLoading, setLogsLoading]     = useState(false);

  // 세션 새로고침
  const [sessionLoading, setSessionLoading] = useState(false);
  const [sessionMsg, setSessionMsg]         = useState('');

  // 거래처 동기화
  const [custLoading, setCustLoading]     = useState(false);
  const [custMsg, setCustMsg]             = useState('');

  const loadStatus = useCallback(async () => {
    setApiLoading(true);
    try {
      const data = await apiGet('/api/ecount/status');
      setApiStatus(data);
    } catch (e) {
      setApiStatus({ connected: false, message: e.message });
    } finally {
      setApiLoading(false);
    }
  }, []);

  const loadLogs = useCallback(async () => {
    setLogsLoading(true);
    try {
      const data = await apiGet('/api/ecount/sync-log');
      setLogs(data.logs || []);
      setPendingSales(data.pendingSales || 0);
      setPendingPurchases(data.pendingPurchases || 0);
      setSummary(data.summary || { success: 0, fail: 0 });
    } catch (e) {
      console.error('sync-log error:', e.message);
    } finally {
      setLogsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadStatus();
    loadLogs();
  }, []);

  const handleSessionRefresh = useCallback(async () => {
    setSessionLoading(true);
    setSessionMsg('');
    try {
      const data = await apiPost('/api/ecount/session', {});
      setSessionMsg(data.message || '세션 갱신 완료');
      await loadStatus();
    } catch (e) {
      setSessionMsg(`오류: ${e.message}`);
    } finally {
      setSessionLoading(false);
      setTimeout(() => setSessionMsg(''), 6000);
    }
  }, [loadStatus]);

  const handleCustSync = useCallback(async () => {
    if (!confirm('모든 활성 거래처를 이카운트에 동기화하시겠습니까?')) return;
    setCustLoading(true);
    setCustMsg('⏳ 거래처 동기화 시작...');

    let offset       = 0;
    const LIMIT      = 20;
    let totalSynced  = 0;
    let totalFailed  = 0;
    let grandTotal   = null;

    try {
      while (true) {
        const data = await apiPost('/api/ecount/customers-sync', { all: true, offset, limit: LIMIT });
        totalSynced += data.synced  || 0;
        totalFailed += data.failed  || 0;
        if (grandTotal === null) grandTotal = data.total || 0;

        // 첫 번째 배치 실패 시 에러 원인 즉시 표시 후 계속 진행
        if (!data.success && data.ecountResponse && offset === 0) {
          console.warn('[custSync] 1번째 배치 이카운트 응답:', data.ecountResponse);
        }

        const processed = data.processed || (offset + LIMIT);
        setCustMsg(`⏳ 동기화 중... ${Math.min(processed, grandTotal)}/${grandTotal}건`);

        if (data.nextOffset === null || data.nextOffset === undefined) break;
        offset = data.nextOffset;

        // 이카운트 rate limit 방지 — 배치 간 200ms 대기 (브라우저 측)
        await new Promise(r => setTimeout(r, 200));
      }

      if (totalFailed === 0) {
        setCustMsg(`✅ 거래처 동기화 완료: ${totalSynced}건 성공`);
      } else {
        setCustMsg(`⚠️ 동기화 완료: 성공 ${totalSynced}건 / 실패 ${totalFailed}건`);
      }
      loadLogs();
    } catch (e) {
      setCustMsg(`❌ 오류: ${e.message}`);
    } finally {
      setCustLoading(false);
      setTimeout(() => setCustMsg(''), 10000);
    }
  }, [loadLogs]);

  const statusCards = [
    {
      label: '미전송 판매',
      value: fmt(pendingSales),
      suffix: '건',
      color: pendingSales > 0 ? 'var(--orange, #f57c00)' : 'var(--text3)',
      warn:  pendingSales > 0,
    },
    {
      label: '미전송 구매',
      value: fmt(pendingPurchases),
      suffix: '건',
      color: pendingPurchases > 0 ? 'var(--orange, #f57c00)' : 'var(--text3)',
      warn:  pendingPurchases > 0,
    },
    {
      label: '30일 성공',
      value: fmt(summary.success),
      suffix: '건',
      color: 'var(--green, #2e7d32)',
      warn:  false,
    },
    {
      label: '30일 실패',
      value: fmt(summary.fail),
      suffix: '건',
      color: summary.fail > 0 ? 'var(--red, #e53935)' : 'var(--text3)',
      warn:  summary.fail > 0,
    },
  ];

  return (
    <Layout title="이카운트 연동 현황">
      {/* API 연결 상태 */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header">
          <span className="card-title">이카운트 API 연결 상태</span>
          <button
            className="btn btn-sm btn-secondary"
            onClick={loadStatus}
            disabled={apiLoading}
          >
            {apiLoading ? '확인중...' : '🔄 새로고침'}
          </button>
        </div>
        <div style={{ padding: '14px 16px' }}>
          {apiStatus ? (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24, alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', fontSize: 15, fontWeight: 700 }}>
                <StatusDot connected={apiStatus.connected} />
                {apiStatus.connected ? '연결 정상' : '연결 실패'}
              </div>
              {[
                { label: 'ZONE',    value: apiStatus.zone    || '-' },
                { label: '회사코드', value: apiStatus.comCode  || '미설정' },
                { label: '사용자',  value: apiStatus.userId   || '-' },
                { label: '세션만료', value: apiStatus.sessionExpiry
                    ? new Date(apiStatus.sessionExpiry).toLocaleTimeString('ko-KR')
                    : '-'
                },
              ].map(({ label, value }) => (
                <div key={label} style={{ fontSize: 13 }}>
                  <span style={{ color: 'var(--text3)', marginRight: 4 }}>{label}:</span>
                  <strong>{value}</strong>
                </div>
              ))}
              {apiStatus.message && (
                <div style={{
                  fontSize: 12, color: apiStatus.connected ? 'var(--green, #2e7d32)' : 'var(--red, #e53935)',
                }}>
                  {apiStatus.message}
                </div>
              )}
            </div>
          ) : (
            <div className="skeleton" style={{ height: 40, borderRadius: 6 }} />
          )}
        </div>
      </div>

      {/* 통계 카드 */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        {statusCards.map(card => (
          <div key={card.label} className="card" style={{
            flex: '1 1 140px', minWidth: 130, padding: '12px 16px', textAlign: 'center',
            borderTop: card.warn ? '3px solid var(--orange, #f57c00)' : '3px solid var(--border)',
          }}>
            <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 6 }}>{card.label}</div>
            <div style={{ fontSize: 24, fontWeight: 900, color: card.color, fontFamily: 'var(--mono)' }}>
              {card.value}
              <span style={{ fontSize: 13, fontWeight: 400, marginLeft: 2 }}>{card.suffix}</span>
            </div>
          </div>
        ))}
      </div>

      {/* 액션 버튼 */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <button
          className="btn btn-primary"
          onClick={handleSessionRefresh}
          disabled={sessionLoading}
        >
          {sessionLoading ? '갱신중...' : '🔑 세션 새로고침'}
        </button>
        <button
          className="btn"
          style={{ background: '#065f46', color: '#fff', borderColor: '#064e3b' }}
          onClick={handleCustSync}
          disabled={custLoading}
        >
          {custLoading ? '동기화중...' : '👥 거래처 전체 동기화'}
        </button>
        <button
          className="btn btn-secondary"
          onClick={loadLogs}
          disabled={logsLoading}
        >
          {logsLoading ? '로딩중...' : '🔄 이력 새로고침'}
        </button>

        {sessionMsg && (
          <span style={{
            fontSize: 13,
            color: sessionMsg.startsWith('오류') ? 'var(--red, #e53935)' : 'var(--green, #2e7d32)',
          }}>
            {sessionMsg}
          </span>
        )}
        {custMsg && (
          <span style={{
            fontSize: 13,
            color: custMsg.startsWith('❌') ? 'var(--red, #e53935)' : 'var(--green, #2e7d32)',
          }}>
            {custMsg}
          </span>
        )}
      </div>

      {/* 동기화 이력 테이블 */}
      <div className="card">
        <div className="card-header">
          <span className="card-title">최근 동기화 이력</span>
          <span style={{ fontSize: 12, color: 'var(--text3)' }}>최근 50건</span>
        </div>
        <div style={{ overflowX: 'auto' }}>
          {logsLoading ? (
            <div className="skeleton" style={{ margin: 16, height: 300, borderRadius: 8 }} />
          ) : logs.length === 0 ? (
            <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text3)', fontSize: 14 }}>
              동기화 이력이 없습니다.
            </div>
          ) : (
            <table className="tbl">
              <thead>
                <tr>
                  <th>#</th>
                  <th>동기화 유형</th>
                  <th>참조 키</th>
                  <th>이카운트 전표번호</th>
                  <th>동기화 일시</th>
                  <th>상태</th>
                  <th>오류 메시지</th>
                </tr>
              </thead>
              <tbody>
                {logs.map(log => (
                  <tr key={log.LogKey}>
                    <td style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text3)' }}>
                      {log.LogKey}
                    </td>
                    <td><SyncTypeBadge type={log.SyncType} /></td>
                    <td style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>
                      {log.RefKey || '—'}
                    </td>
                    <td style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--text3)' }}>
                      {log.EcountRef || '—'}
                    </td>
                    <td style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text3)' }}>
                      {log.SyncDtm}
                    </td>
                    <td>
                      <span style={{
                        display: 'inline-block', padding: '2px 8px', borderRadius: 10,
                        fontSize: 11, fontWeight: 700,
                        background: log.SyncStatus === '성공' ? '#d1fae5' : '#fee2e2',
                        color:      log.SyncStatus === '성공' ? '#065f46' : '#b91c1c',
                      }}>
                        {log.SyncStatus}
                      </span>
                    </td>
                    <td style={{ fontSize: 11, color: 'var(--red, #e53935)', maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {log.ErrorMsg || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </Layout>
  );
}
