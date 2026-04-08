// pages/dev/action-log.js — 시스템 액션 로그 & 이상감지 대시보드
import { useState, useEffect, useCallback } from 'react';
import { apiGet } from '../../lib/useApi';

const RISK_COLOR = {
  CRITICAL: { bg: '#fff0f0', border: '#ff4444', text: '#cc0000', badge: '#ff4444' },
  HIGH:     { bg: '#fff8f0', border: '#ff8800', text: '#cc6600', badge: '#ff8800' },
  MEDIUM:   { bg: '#fffef0', border: '#ccaa00', text: '#886600', badge: '#ccaa00' },
  LOW:      { bg: '#f0f8ff', border: '#4499cc', text: '#336699', badge: '#4499cc' },
};
const RESULT_COLOR = { SUCCESS: '#22aa55', FAIL: '#ee4444', ERROR: '#cc6600' };

const fmt = n => Number(n || 0).toLocaleString();
const fmtDtm = s => s ? s.replace('T', ' ').slice(0, 19) : '-';

function RiskBadge({ level }) {
  const c = RISK_COLOR[level] || RISK_COLOR.LOW;
  return (
    <span style={{
      background: c.badge, color: '#fff', borderRadius: 4,
      padding: '2px 7px', fontSize: 11, fontWeight: 700, letterSpacing: 0.5,
    }}>{level}</span>
  );
}

function ResultBadge({ result }) {
  return (
    <span style={{
      color: RESULT_COLOR[result] || '#666', fontWeight: 700, fontSize: 12,
    }}>{result}</span>
  );
}

export default function ActionLogPage() {
  const [logs,      setLogs]      = useState([]);
  const [total,     setTotal]     = useState(0);
  const [summary,   setSummary]   = useState({});
  const [byActor,   setByActor]   = useState([]);
  const [byType,    setByType]    = useState([]);
  const [anomalies, setAnomalies] = useState([]);
  const [loading,   setLoading]   = useState(false);
  const [offset,    setOffset]    = useState(0);
  const LIMIT = 50;

  // 필터
  const [filterActor,  setFilterActor]  = useState('');
  const [filterRisk,   setFilterRisk]   = useState('');
  const [filterType,   setFilterType]   = useState('');
  const [filterResult, setFilterResult] = useState('');
  const [filterStart,  setFilterStart]  = useState('');
  const [filterEnd,    setFilterEnd]    = useState('');

  // 선택된 로그 상세
  const [selected, setSelected] = useState(null);

  const loadAll = useCallback(async (newOffset = 0) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: LIMIT, offset: newOffset });
      if (filterActor)  params.set('actor', filterActor);
      if (filterRisk)   params.set('riskLevel', filterRisk);
      if (filterType)   params.set('actionType', filterType);
      if (filterResult) params.set('result', filterResult);
      if (filterStart)  params.set('startDate', filterStart);
      if (filterEnd)    params.set('endDate', filterEnd);

      const [logsData, summaryData, anomalyData] = await Promise.all([
        apiGet(`/api/dev/action-log?${params}`),
        apiGet('/api/dev/action-log?mode=summary'),
        apiGet('/api/dev/action-log?mode=anomaly'),
      ]);

      setLogs(logsData.logs || []);
      setTotal(logsData.total || 0);
      setSummary(summaryData.summary || {});
      setByActor(summaryData.byActor || []);
      setByType(summaryData.byType   || []);
      setAnomalies(anomalyData.anomalies || []);
      setOffset(newOffset);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [filterActor, filterRisk, filterType, filterResult, filterStart, filterEnd]);

  useEffect(() => { loadAll(0); }, []);

  const handleSearch = () => loadAll(0);

  return (
    <div style={{ padding: '20px 24px', fontFamily: 'sans-serif', fontSize: 13 }}>
      <h2 style={{ margin: '0 0 16px', fontSize: 18, fontWeight: 700 }}>
        🔍 시스템 액션 로그
        <span style={{ fontSize: 12, fontWeight: 400, color: '#888', marginLeft: 10 }}>
          — API 쓰기 작업 자동 기록 (Claude 포함)
        </span>
      </h2>

      {/* ── 이상감지 알림 */}
      {anomalies.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontWeight: 700, marginBottom: 6, color: '#cc0000' }}>
            ⚠️ 이상 감지 ({anomalies.length}건)
          </div>
          {anomalies.map((a, i) => {
            const c = RISK_COLOR[a.level] || RISK_COLOR.LOW;
            return (
              <div key={i} style={{
                background: c.bg, border: `1px solid ${c.border}`,
                borderRadius: 6, padding: '8px 12px', marginBottom: 6,
                display: 'flex', alignItems: 'flex-start', gap: 10,
              }}>
                <RiskBadge level={a.level} />
                <div>
                  <b style={{ color: c.text }}>[{a.type}]</b> {a.message}
                  <div style={{ color: '#555', fontSize: 12, marginTop: 2 }}>{a.detail}</div>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {anomalies.length === 0 && !loading && (
        <div style={{ background: '#f0fff4', border: '1px solid #88cc88', borderRadius: 6,
          padding: '8px 14px', marginBottom: 16, color: '#336633' }}>
          ✅ 이상 징후 없음
        </div>
      )}

      {/* ── KPI 요약 */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        {[
          { label: '전체 (30일)', val: fmt(summary.total),    color: '#333' },
          { label: '🔴 CRITICAL',  val: fmt(summary.critical), color: '#cc0000' },
          { label: '🟠 HIGH',      val: fmt(summary.high),     color: '#cc6600' },
          { label: '🟡 MEDIUM',    val: fmt(summary.medium),   color: '#886600' },
          { label: '✅ 성공',       val: fmt(summary.success),  color: '#22aa55' },
          { label: '❌ 실패',       val: fmt(summary.fail),     color: '#ee4444' },
          { label: '🤖 Claude',    val: fmt(summary.byClaude), color: '#7744cc' },
        ].map(({ label, val, color }) => (
          <div key={label} style={{
            background: '#fff', border: '1px solid #ddd', borderRadius: 8,
            padding: '10px 16px', minWidth: 100, textAlign: 'center',
          }}>
            <div style={{ fontSize: 11, color: '#888', marginBottom: 2 }}>{label}</div>
            <div style={{ fontSize: 20, fontWeight: 700, color }}>{val}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 16, marginBottom: 16 }}>
        {/* Actor별 */}
        <div style={{ flex: 1, background: '#fff', border: '1px solid #ddd', borderRadius: 8, padding: 12 }}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>Actor별 작업 (상위 10)</div>
          {byActor.map(a => (
            <div key={a.Actor} style={{ display: 'flex', justifyContent: 'space-between',
              padding: '3px 0', borderBottom: '1px solid #f0f0f0', fontSize: 12 }}>
              <span style={{ color: a.Actor?.startsWith('claude:') ? '#7744cc' : '#333' }}>
                {a.Actor?.startsWith('claude:') ? '🤖 ' : '👤 '}{a.Actor}
              </span>
              <span style={{ fontWeight: 700 }}>{fmt(a.cnt)}건</span>
            </div>
          ))}
        </div>
        {/* 타입별 */}
        <div style={{ flex: 1, background: '#fff', border: '1px solid #ddd', borderRadius: 8, padding: 12 }}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>작업 유형별</div>
          {byType.map(t => {
            const c = RISK_COLOR[t.maxRisk] || RISK_COLOR.LOW;
            return (
              <div key={t.ActionType} style={{ display: 'flex', justifyContent: 'space-between',
                alignItems: 'center', padding: '3px 0', borderBottom: '1px solid #f0f0f0', fontSize: 12 }}>
                <span style={{ color: c.text }}>{t.ActionType}</span>
                <span style={{ fontWeight: 700 }}>{fmt(t.cnt)}건</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── 필터 */}
      <div style={{ background: '#f8f8f8', border: '1px solid #ddd', borderRadius: 8,
        padding: 12, marginBottom: 12, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div>
          <div style={{ fontSize: 11, color: '#888', marginBottom: 3 }}>Actor</div>
          <input value={filterActor} onChange={e => setFilterActor(e.target.value)}
            placeholder="claude: / nenovaSS2 ..."
            style={{ padding: '5px 8px', border: '1px solid #ccc', borderRadius: 4, width: 160 }} />
        </div>
        <div>
          <div style={{ fontSize: 11, color: '#888', marginBottom: 3 }}>위험도</div>
          <select value={filterRisk} onChange={e => setFilterRisk(e.target.value)}
            style={{ padding: '5px 8px', border: '1px solid #ccc', borderRadius: 4 }}>
            <option value="">전체</option>
            {['CRITICAL','HIGH','MEDIUM','LOW'].map(r => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>
        <div>
          <div style={{ fontSize: 11, color: '#888', marginBottom: 3 }}>작업유형</div>
          <select value={filterType} onChange={e => setFilterType(e.target.value)}
            style={{ padding: '5px 8px', border: '1px solid #ccc', borderRadius: 4 }}>
            <option value="">전체</option>
            {['ECOUNT_PUSH','ECOUNT_SYNC','AR_WRITE','DATA_DELETE','ESTIMATE_WRITE',
              'SHIPMENT_WRITE','PRODUCT_WRITE','CUSTOMER_WRITE'].map(t => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>
        <div>
          <div style={{ fontSize: 11, color: '#888', marginBottom: 3 }}>결과</div>
          <select value={filterResult} onChange={e => setFilterResult(e.target.value)}
            style={{ padding: '5px 8px', border: '1px solid #ccc', borderRadius: 4 }}>
            <option value="">전체</option>
            {['SUCCESS','FAIL','ERROR'].map(r => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>
        <div>
          <div style={{ fontSize: 11, color: '#888', marginBottom: 3 }}>시작일</div>
          <input type="date" value={filterStart} onChange={e => setFilterStart(e.target.value)}
            style={{ padding: '5px 8px', border: '1px solid #ccc', borderRadius: 4 }} />
        </div>
        <div>
          <div style={{ fontSize: 11, color: '#888', marginBottom: 3 }}>종료일</div>
          <input type="date" value={filterEnd} onChange={e => setFilterEnd(e.target.value)}
            style={{ padding: '5px 8px', border: '1px solid #ccc', borderRadius: 4 }} />
        </div>
        <button onClick={handleSearch}
          style={{ padding: '6px 18px', background: '#1a3a6b', color: '#fff',
            border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 700 }}>
          🔍 조회
        </button>
        <button onClick={() => {
          setFilterActor(''); setFilterRisk(''); setFilterType('');
          setFilterResult(''); setFilterStart(''); setFilterEnd('');
          setTimeout(() => loadAll(0), 100);
        }} style={{ padding: '6px 14px', background: '#fff', border: '1px solid #ccc',
          borderRadius: 6, cursor: 'pointer' }}>초기화</button>
      </div>

      {/* ── 로그 테이블 */}
      <div style={{ background: '#fff', border: '1px solid #ddd', borderRadius: 8, overflow: 'hidden' }}>
        <div style={{ padding: '8px 14px', background: '#f4f4f4', borderBottom: '1px solid #ddd',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontWeight: 700 }}>액션 로그 ({fmt(total)}건)</span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button disabled={offset === 0} onClick={() => loadAll(offset - LIMIT)}
              style={{ padding: '4px 10px', border: '1px solid #ccc', borderRadius: 4,
                cursor: offset === 0 ? 'not-allowed' : 'pointer', opacity: offset === 0 ? 0.4 : 1 }}>◀</button>
            <span style={{ fontSize: 12, lineHeight: '26px', color: '#666' }}>
              {offset + 1}~{Math.min(offset + LIMIT, total)} / {fmt(total)}
            </span>
            <button disabled={offset + LIMIT >= total} onClick={() => loadAll(offset + LIMIT)}
              style={{ padding: '4px 10px', border: '1px solid #ccc', borderRadius: 4,
                cursor: offset + LIMIT >= total ? 'not-allowed' : 'pointer',
                opacity: offset + LIMIT >= total ? 0.4 : 1 }}>▶</button>
            <button onClick={() => loadAll(offset)} style={{ padding: '4px 10px',
              border: '1px solid #ccc', borderRadius: 4, cursor: 'pointer' }}>🔄</button>
          </div>
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: 40, color: '#888' }}>로딩 중...</div>
        ) : logs.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 40, color: '#888' }}>
            아직 기록된 액션이 없습니다.<br/>
            <small>이카운트 전송, 채권 입금등록 등 쓰기 작업 시 자동 기록됩니다.</small>
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ background: '#f8f8f8', borderBottom: '2px solid #ddd' }}>
                {['일시','위험도','결과','Actor','작업유형','엔드포인트','영향건수','영향테이블'].map(h => (
                  <th key={h} style={{ padding: '7px 10px', textAlign: 'left',
                    fontWeight: 600, color: '#555', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {logs.map(log => {
                const c = RISK_COLOR[log.RiskLevel] || RISK_COLOR.LOW;
                const isClaude = log.Actor?.startsWith('claude:');
                return (
                  <tr key={log.LogKey}
                    onClick={() => setSelected(selected?.LogKey === log.LogKey ? null : log)}
                    style={{
                      cursor: 'pointer',
                      background: selected?.LogKey === log.LogKey ? c.bg : (isClaude ? '#fdf8ff' : '#fff'),
                      borderBottom: '1px solid #f0f0f0',
                      borderLeft: `3px solid ${c.border}`,
                    }}>
                    <td style={{ padding: '7px 10px', whiteSpace: 'nowrap', color: '#555' }}>
                      {fmtDtm(log.ActionDtm)}
                    </td>
                    <td style={{ padding: '7px 10px' }}><RiskBadge level={log.RiskLevel} /></td>
                    <td style={{ padding: '7px 10px' }}><ResultBadge result={log.Result} /></td>
                    <td style={{ padding: '7px 10px', color: isClaude ? '#7744cc' : '#333', fontWeight: isClaude ? 700 : 400 }}>
                      {isClaude ? '🤖 ' : '👤 '}{log.Actor}
                    </td>
                    <td style={{ padding: '7px 10px', fontWeight: 600, color: c.text }}>{log.ActionType}</td>
                    <td style={{ padding: '7px 10px', color: '#555', maxWidth: 220,
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {log.Method} {log.Endpoint}
                    </td>
                    <td style={{ padding: '7px 10px', textAlign: 'right', fontWeight: 700 }}>
                      {log.AffectedCount > 0 ? fmt(log.AffectedCount) : '-'}
                    </td>
                    <td style={{ padding: '7px 10px', color: '#888' }}>{log.AffectedTable}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* ── 상세 패널 */}
      {selected && (
        <div style={{
          marginTop: 16, background: '#fff', border: `2px solid ${(RISK_COLOR[selected.RiskLevel]||RISK_COLOR.LOW).border}`,
          borderRadius: 8, padding: 16,
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <span style={{ fontWeight: 700, fontSize: 14 }}>
              📋 상세 — LogKey #{selected.LogKey}
            </span>
            <button onClick={() => setSelected(null)}
              style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: 18 }}>✕</button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 24px', marginBottom: 12 }}>
            {[
              ['일시', fmtDtm(selected.ActionDtm)],
              ['위험도', <RiskBadge key="r" level={selected.RiskLevel} />],
              ['결과', <ResultBadge key="rs" result={selected.Result} />],
              ['Actor', selected.Actor],
              ['SessionId', selected.SessionId || '-'],
              ['작업유형', selected.ActionType],
              ['Method', selected.Method],
              ['엔드포인트', selected.Endpoint],
              ['영향테이블', selected.AffectedTable || '-'],
              ['영향건수', fmt(selected.AffectedCount)],
              ['IP', selected.IpAddress || '-'],
            ].map(([k, v]) => (
              <div key={k} style={{ display: 'flex', gap: 8, fontSize: 12 }}>
                <span style={{ color: '#888', minWidth: 80 }}>{k}</span>
                <span style={{ fontWeight: 500 }}>{v}</span>
              </div>
            ))}
          </div>
          {selected.ResultDesc && (
            <div style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 11, color: '#888', marginBottom: 3 }}>결과 상세</div>
              <div style={{ background: '#fff8f0', border: '1px solid #ffcc88', borderRadius: 4,
                padding: '6px 10px', fontSize: 12, color: '#885500', wordBreak: 'break-all' }}>
                {selected.ResultDesc}
              </div>
            </div>
          )}
          {selected.Payload && selected.Payload !== '{}' && (
            <div>
              <div style={{ fontSize: 11, color: '#888', marginBottom: 3 }}>요청 페이로드</div>
              <pre style={{ background: '#f8f8f8', border: '1px solid #ddd', borderRadius: 4,
                padding: '8px 12px', fontSize: 11, overflowX: 'auto', margin: 0,
                maxHeight: 200, overflowY: 'auto' }}>
                {(() => { try { return JSON.stringify(JSON.parse(selected.Payload), null, 2); } catch { return selected.Payload; } })()}
              </pre>
            </div>
          )}
        </div>
      )}

      <style>{`
        tr:hover td { background: #f8f8ff !important; }
      `}</style>
    </div>
  );
}
