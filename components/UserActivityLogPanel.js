import { useEffect, useRef, useState } from 'react';
import { apiGet } from '../lib/useApi';

const kindNames = { click: '클릭', change: '입력·선택 변경', submit: '제출 시도', navigation: '화면 이동', api: '서버 응답', desktop: 'PC 앱 조작' };
const outcomes = { success: '성공', failure: '실패', unknown: '결과 미확인' };
const koreanDay = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
function time(value) { if (!value || !Number.isFinite(Date.parse(value))) return '—'; return new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', dateStyle: 'short', timeStyle: 'medium', hour12: false }).format(new Date(value)); }

export default function UserActivityLogPanel() {
  const [allowed, setAllowed] = useState(false);
  const [filters, setFilters] = useState({ from: koreanDay(), to: koreanDay(), userId: '', source: '', kind: '', outcome: '', path: '', hour: '' });
  const [rows, setRows] = useState([]), [cursor, setCursor] = useState(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [loaded, setLoaded] = useState(false);
  const applied = useRef(null), sequence = useRef(0), heading = useRef(null);
  useEffect(() => { let alive = true; apiGet('/api/work/activity', { me: 1 }).then(data => { if (alive) setAllowed(data.canView === true); }).catch(() => {}); return () => { alive = false; sequence.current++; }; }, []);
  async function load(next = false) {
    const id = ++sequence.current;
    const query = next ? applied.current : { ...filters };
    if (!query) return;
    setBusy(true); setError('');
    try {
      const data = await apiGet('/api/work/activity', { ...query, limit: 100, ...(next && cursor ? { cursor } : {}) });
      if (id !== sequence.current) return;
      setRows(data.items || []); setCursor(data.nextCursor || null); applied.current = query; setLoaded(true);
      heading.current?.focus();
    } catch (err) { if (id === sequence.current) setError(err.message || '기록을 불러오지 못했습니다. 다시 조회해 주세요.'); }
    finally { if (id === sequence.current) setBusy(false); }
  }
  if (!allowed) return null;
  const field = (key, value) => setFilters(old => ({ ...old, [key]: value }));
  return <section className="user-activity" aria-labelledby="user-activity-title">
    <h2 id="user-activity-title" tabIndex={-1} ref={heading}>웹 · PC 웹앱 사용자 작업 로그</h2>
    <p>버튼 조작과 서버 응답을 함께 확인합니다. NENOVA.EXE는 수집 대상에 포함되지 않습니다.</p>
    <form onSubmit={event => { event.preventDefault(); load(); }}>
      <label>시작일<input type="date" required value={filters.from} onChange={e => field('from', e.target.value)} /></label>
      <label>종료일<input type="date" required value={filters.to} onChange={e => field('to', e.target.value)} /></label>
      <label>조회 시간 (한국시간)<select value={filters.hour} onChange={e => field('hour', e.target.value)}><option value="">하루 전체</option>{Array.from({length:24}, (_, hour) => <option key={hour} value={hour}>{String(hour).padStart(2,'0')}시</option>)}</select></label>
      <label>사용자 아이디<input value={filters.userId} onChange={e => field('userId', e.target.value)} autoComplete="off" /></label>
      <label>사용 환경<select value={filters.source} onChange={e => field('source', e.target.value)}><option value="">전체</option><option value="web">네노바웹</option><option value="desktop">PC 웹앱</option></select></label>
      <label>동작<select value={filters.kind} onChange={e => field('kind', e.target.value)}><option value="">전체</option>{Object.entries(kindNames).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      <label>결과<select value={filters.outcome} onChange={e => field('outcome', e.target.value)}><option value="">전체</option>{Object.entries(outcomes).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      <label>화면·API 경로<input placeholder="예: /estimate/weekday" value={filters.path} onChange={e => field('path', e.target.value)} /></label>
      <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? '조회 중…' : '로그 조회'}</button>
    </form>
    <p className="hint">조회 기간은 최대 31일입니다. 조회 날짜·시간과 표시 시각은 모두 한국시간입니다. 이 작업 로그에는 입력값·비밀번호·요청/응답 본문을 저장하지 않습니다. HTTP 응답 성공만으로 업무 저장 완료를 뜻하지 않습니다.</p>
    {error && <p role="alert" className="failure">{error}</p>}
    <p role="status" aria-live="polite">{busy ? '기록을 불러오고 있습니다.' : loaded ? `이번 페이지 ${rows.length}건 · 최신 기록순` : '기간과 조건을 선택한 뒤 로그 조회를 눌러 주세요.'}</p>
    {loaded && <div className="audit-table" role="region" aria-label="사용자 작업 기록 표, 가로 스크롤 가능" tabIndex={0}><table><thead><tr>{['서버 기록 시각 (한국시간)', '사용자', '사용 환경', '화면·API', '동작 · 버튼', '결과', '동작 연결 ID'].map(title => <th key={title} scope="col">{title}</th>)}</tr></thead><tbody>
      {!rows.length && <tr><td colSpan={7}>조건에 맞는 기록이 없습니다. 수집 적용 이전 작업은 소급 기록되지 않습니다.</td></tr>}
      {rows.map(row => <tr key={`${row.userId}:${row.id}`}><td>{time(row.receivedAt)}{row.clientAt && <small>기기 시각: {time(row.clientAt)}</small>}</td><td>{row.userName || row.userId}<small>{row.userName ? row.userId : ''}</small></td><td>{row.source === 'desktop' ? 'PC 웹앱' : '네노바웹'}</td><td>{row.path || '—'}{row.pagePath && <small>화면: {row.pagePath}</small>}</td><td><strong>{kindNames[row.kind] || row.kind}</strong><small>{row.recordedBy === 'server' ? '서버 기록' : '기기에서 전달한 조작'}</small><small>{row.label || row.control || '—'}</small>{row.method && <small>{row.method}</small>}</td><td><span className={row.outcome === 'failure' ? 'failure' : ''}>{row.kind === 'api' && row.outcome === 'success' ? '응답 성공' : outcomes[row.outcome] || '결과 미확인'}</span>{row.status != null && <small>HTTP {row.status}</small>}{row.duration != null && <small>{row.duration}ms</small>}</td><td>{row.actionId || '연결 정보 없음'}</td></tr>)}
    </tbody></table></div>}
    {loaded && <div className="paging"><button type="button" className="btn" disabled={busy} onClick={() => load()}>최신 기록부터 조회</button><button type="button" className="btn" disabled={busy || !cursor} onClick={() => load(true)}>다음 페이지</button></div>}
    <style jsx>{`
      .user-activity { min-width:0; margin-bottom:24px; padding:14px; border:1px solid var(--border,#cad8e8); border-radius:8px; background:var(--card-bg,#fff); }
      h2 { margin:0 0 8px; font-size:18px; } p { margin:8px 0; line-height:1.5; } form { display:flex; flex-wrap:wrap; gap:10px; align-items:end; } label { display:flex; flex-direction:column; gap:5px; flex:1 1 150px; min-width:0; } input,select { min-height:36px; width:100%; box-sizing:border-box; border:1px solid var(--border,#cad8e8); border-radius:4px; padding:6px; font:inherit; background:var(--card-bg,#fff); color:inherit; } button { min-height:36px; white-space:normal; } .hint { color:var(--text3,#52677e); font-size:13px; } .audit-table { overflow-x:auto; width:100%; } table { border-collapse:collapse; width:100%; min-width:1080px; table-layout:fixed; } th,td { padding:8px; border-bottom:1px solid var(--border,#cad8e8); text-align:left; white-space:normal; overflow-wrap:anywhere; vertical-align:top; line-height:1.5; } th { background:var(--header-bg,#eef4fb); } small { display:block; font-size:12px; color:var(--text3,#52677e); } .failure { color:#b42318; } .paging { display:flex; flex-wrap:wrap; gap:8px; margin-top:12px; } :focus-visible { outline:3px solid #2168c8; outline-offset:2px; } @media(max-width:600px) { .user-activity { padding:10px; } label { flex-basis:140px; } }
    `}</style>
  </section>;
}
