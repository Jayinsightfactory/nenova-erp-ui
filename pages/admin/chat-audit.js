import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { apiGet } from '../../lib/useApi';

const PAGE_SIZE = 100;
const FONT_STACK = "'Pretendard Variable', 'Pretendard', -apple-system, BlinkMacSystemFont, 'Malgun Gothic', '맑은 고딕', sans-serif";

function flagList(value) {
  return String(value || '')
    .split(',')
    .map(v => v.trim())
    .filter(Boolean);
}

function parseDebug(value) {
  try {
    return value ? JSON.parse(value) : null;
  } catch {
    return null;
  }
}

function fmtDate(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleString('ko-KR');
}

const Badge = memo(function Badge({ children, tone = 'neutral' }) {
  const colors = {
    neutral: { bg: '#f5f5f5', color: '#444', border: '#ddd' },
    ok: { bg: '#e8f5e9', color: '#2e7d32', border: '#a5d6a7' },
    warn: { bg: '#fff8e1', color: '#ef6c00', border: '#ffcc80' },
    danger: { bg: '#ffebee', color: '#c62828', border: '#ef9a9a' },
    info: { bg: '#e3f2fd', color: '#1565c0', border: '#90caf9' },
  };
  const c = colors[tone] || colors.neutral;
  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      padding: '2px 6px',
      border: `1px solid ${c.border}`,
      background: c.bg,
      color: c.color,
      borderRadius: 4,
      fontSize: 11,
      fontWeight: 700,
      whiteSpace: 'nowrap',
    }}>
      {children}
    </span>
  );
});

const ChatAuditRow = memo(function ChatAuditRow({ item }) {
  const { row, debug, routeFlags, riskFlags, formattedDate } = item;
  return (
    <tr style={{ contentVisibility: 'auto', containIntrinsicSize: '0 84px', fontVariantNumeric: 'tabular-nums' }}>
      <td style={{ fontSize: 11, whiteSpace: 'nowrap' }}>{formattedDate}</td>
      <td>
        <div style={{ fontWeight: 700 }}>{row.UserName || row.UserID || '-'}</div>
        <div style={{ fontSize: 10, color: 'var(--text3)' }}>{row.DurationMs || 0}ms</div>
      </td>
      <td style={{ whiteSpace: 'pre-wrap', lineHeight: 1.45 }}>{row.UserMessage}</td>
      <td>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {routeFlags.map(flag => (
            <Badge key={flag} tone={flag === 'LLM_SQL' ? 'info' : flag === 'ASKBACK' ? 'warn' : 'neutral'}>{flag}</Badge>
          ))}
          {row.Success ? <Badge tone="ok">SUCCESS</Badge> : <Badge tone="danger">ERROR</Badge>}
        </div>
      </td>
      <td>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {riskFlags.length
            ? riskFlags.map(flag => <Badge key={flag} tone="warn">{flag}</Badge>)
            : <Badge tone="ok">없음</Badge>}
        </div>
        {row.ErrorMessage && <div style={{ marginTop: 4, fontSize: 11, color: '#c62828' }}>{row.ErrorMessage}</div>}
      </td>
      <td>
        <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.45, maxHeight: 130, overflow: 'auto' }}>
          {row.BotText || row.ErrorMessage || '-'}
        </div>
        {debug?.sql && (
          <details style={{ marginTop: 6 }}>
            <summary style={{ cursor: 'pointer', fontSize: 11, color: '#1565c0' }}>SQL {debug.rowCount != null ? `(${debug.rowCount}건)` : ''}</summary>
            <pre style={{ whiteSpace: 'pre-wrap', fontSize: 11, fontFamily: FONT_STACK, background: '#f7f7f7', padding: 8, border: '1px solid #ddd', marginTop: 4 }}>
              {debug.sql}
            </pre>
          </details>
        )}
      </td>
    </tr>
  );
});

export default function ChatAuditPage() {
  const [rows, setRows] = useState([]);
  const [summary, setSummary] = useState({});
  const [byRisk, setByRisk] = useState([]);
  const [limit, setLimit] = useState(80);
  const [visibleLimit, setVisibleLimit] = useState(PAGE_SIZE);
  const [mineOnly, setMineOnly] = useState(false);
  const [search, setSearch] = useState('');
  const [routeFilter, setRouteFilter] = useState('');
  const [riskOnly, setRiskOnly] = useState(false);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    setErr('');
    setVisibleLimit(PAGE_SIZE);
    apiGet('/api/m/chat-audit', {
      limit,
      mine: mineOnly ? '1' : '',
    })
      .then(data => {
        setRows(data.rows || []);
        setSummary(data.summary || {});
        setByRisk(data.byRisk || []);
      })
      .catch(e => setErr(e.message))
      .finally(() => setLoading(false));
  }, [limit, mineOnly]);

  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const enrichedRows = useMemo(() => rows.map(row => ({
    row,
    debug: parseDebug(row.DebugJson),
    routeFlags: flagList(row.RouteFlags),
    riskFlags: flagList(row.RiskFlags),
    formattedDate: fmtDate(row.CreateDtm),
    haystack: [
      row.UserID,
      row.UserName,
      row.UserMessage,
      row.BotText,
      row.RouteFlags,
      row.RiskFlags,
      row.ErrorMessage,
    ].map(v => String(v || '').toLowerCase()).join(' '),
  })), [rows]);

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    return enrichedRows.filter(item => {
      const { row, haystack } = item;
      if (routeFilter && !String(row.RouteFlags || '').includes(routeFilter)) return false;
      if (riskOnly && !String(row.RiskFlags || '').trim()) return false;
      if (!s) return true;
      return haystack.includes(s);
    });
  }, [enrichedRows, search, routeFilter, riskOnly]);

  const visibleItems = useMemo(() => filtered.slice(0, visibleLimit), [filtered, visibleLimit]);

  const exportCsv = () => {
    const header = ['시간', '사용자', '질문', '처리경로', '위험플래그', '성공', '소요ms', '답변'];
    const csvRows = [header, ...filtered.map(({ row: r, formattedDate }) => [
      formattedDate,
      r.UserName || r.UserID || '',
      r.UserMessage || '',
      r.RouteFlags || '',
      r.RiskFlags || '',
      r.Success ? 'Y' : 'N',
      r.DurationMs || '',
      r.BotText || r.ErrorMessage || '',
    ])];
    const csv = csvRows.map(row => row.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `chat_audit_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div style={{ fontFamily: FONT_STACK, fontVariantNumeric: 'tabular-nums' }}>
      <div className="filter-bar">
        <span className="filter-label">표시</span>
        <select className="filter-select" value={limit} onChange={e => setLimit(Number(e.target.value))}>
          {[30, 50, 80, 120, 200].map(v => <option key={v} value={v}>{v}건</option>)}
        </select>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12 }}>
          <input type="checkbox" checked={mineOnly} onChange={e => setMineOnly(e.target.checked)} />
          내 질문
        </label>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12 }}>
          <input type="checkbox" checked={riskOnly} onChange={e => { setRiskOnly(e.target.checked); setVisibleLimit(PAGE_SIZE); }} />
          위험 플래그
        </label>
        <span className="filter-label">경로</span>
        <select className="filter-select" value={routeFilter} onChange={e => { setRouteFilter(e.target.value); setVisibleLimit(PAGE_SIZE); }}>
          <option value="">전체</option>
          <option value="RULE_HANDLER">고정 핸들러</option>
          <option value="LLM_SQL">LLM SQL</option>
          <option value="ASKBACK">역질문</option>
          <option value="CONTEXT_FOLLOWUP">대화맥락</option>
          <option value="INVESTIGATIVE">후보확인</option>
        </select>
        <input className="filter-input" value={search} onChange={e => { setSearch(e.target.value); setVisibleLimit(PAGE_SIZE); }} placeholder="질문/답변/사용자 검색" style={{ minWidth: 220 }} />
        <div className="page-actions">
          <button className="btn btn-primary" onClick={load} disabled={loading}>{loading ? '조회중' : '조회'}</button>
          <button className="btn" onClick={exportCsv}>Excel</button>
        </div>
      </div>

      {err && <div className="banner-err">{err}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, minmax(110px, 1fr))', gap: 8, marginBottom: 8 }}>
        <Stat label="전체" value={summary.total || 0} />
        <Stat label="오류" value={summary.errorCount || 0} tone={(summary.errorCount || 0) > 0 ? 'danger' : 'ok'} />
        <Stat label="위험" value={summary.riskCount || 0} tone={(summary.riskCount || 0) > 0 ? 'warn' : 'ok'} />
        <Stat label="LLM SQL" value={summary.llmSqlCount || 0} tone="info" />
        <Stat label="고정답변" value={summary.ruleCount || 0} />
        <Stat label="역질문" value={summary.askbackCount || 0} tone="info" />
      </div>

      {byRisk.length > 0 && (
        <div className="card" style={{ marginBottom: 8 }}>
          <div className="card-header">
            <span className="card-title">위험 플래그 요약</span>
          </div>
          <div style={{ padding: 8, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {byRisk.map(r => (
              <Badge key={r.RiskFlags} tone="warn">{r.RiskFlags} {r.cnt}건</Badge>
            ))}
          </div>
        </div>
      )}

      <div className="card">
        <div className="card-header">
          <span className="card-title">챗봇 질문 및 처리현황</span>
          <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text3)' }}>{filtered.length}건</span>
        </div>
        <div className="table-wrap" style={{ border: 'none' }}>
          {loading ? (
            <div className="skeleton" style={{ height: 320, margin: 12 }} />
          ) : (
            <>
              <table className="tbl">
                <thead>
                  <tr>
                    <th style={{ minWidth: 130 }}>시간</th>
                    <th style={{ minWidth: 80 }}>사용자</th>
                    <th style={{ minWidth: 260 }}>질문</th>
                    <th style={{ minWidth: 160 }}>처리</th>
                    <th style={{ minWidth: 160 }}>위험</th>
                    <th style={{ minWidth: 360 }}>답변/SQL</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleItems.map(item => (
                    <ChatAuditRow key={item.row.AuditKey} item={item} />
                  ))}
                  {!filtered.length && (
                    <tr>
                      <td colSpan={6} style={{ textAlign: 'center', padding: 28, color: 'var(--text3)' }}>
                        조건에 맞는 대화 로그가 없습니다.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
              {filtered.length > visibleLimit && (
                <div style={{ padding: 10, borderTop: '1px solid var(--border)', textAlign: 'center' }}>
                  <button type="button" className="btn btn-sm" onClick={() => setVisibleLimit(v => v + PAGE_SIZE)}>
                    더 보기 (+{PAGE_SIZE}건 · {visibleItems.length}/{filtered.length}건 표시)
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

const Stat = memo(function Stat({ label, value, tone = 'neutral' }) {
  const color = tone === 'danger' ? '#c62828' : tone === 'warn' ? '#ef6c00' : tone === 'info' ? '#1565c0' : 'var(--text1)';
  return (
    <div className="card" style={{ padding: '8px 10px' }}>
      <div style={{ fontSize: 11, color: 'var(--text3)' }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 800, fontVariantNumeric: 'tabular-nums', color }}>{value}</div>
    </div>
  );
});
