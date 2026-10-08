import { useCallback, useEffect, useRef, useState } from 'react';
import styles from './FullDevelopmentHistory.module.css';

const API = '/api/dev/full-history';
const PAGE_SIZE = 50;
const typeLabels = { initial: '최초 도입', research: '검색·조사', plan: '기획·설계', fix: '수정·보정', feature: '기능 추가', 'test-guard': '테스트·가드', 'ops-refactor': '운영·구조 개선', other: '미분류' };
const sourceLabels = { erp: 'Nenova ERP 저장소', 'mindmap-viewer': 'MindMap Viewer 저장소', nenovakakao: 'Nenova Kakao 저장소' };
const projectOptions = [['all', '전체'], ['mindmap-orbit', 'MindMap · Orbit'], ['nenova-kakao', 'Nenova Kakao'], ['nenova-erp', 'Nenova ERP'], ['nenovaweb', '연결 대기']];
const dateFormatter = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
function dateLabel(value) { if (!value) return '확인 불가'; const date = new Date(value); return Number.isNaN(date.getTime()) ? '확인 불가' : `${dateFormatter.format(date)} KST`; }
function number(value) { return Number.isFinite(value) ? value.toLocaleString('ko-KR') : '확인 불가'; }

export default function FullDevelopmentHistory() {
  const [project, setProject] = useState('all');
  const [source, setSource] = useState('all');
  const [type, setType] = useState('all');
  const [workType, setWorkType] = useState('all');
  const [q, setQ] = useState('');
  const [submittedQ, setSubmittedQ] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const [revision, setRevision] = useState(0);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState({});
  const searchRef = useRef(null);
  const cardRefs = useRef([]);
  const tabRefs = useRef([]);

  useEffect(() => { const id = setTimeout(() => setSubmittedQ(q.trim()), 250); return () => clearTimeout(id); }, [q]);
  useEffect(() => {
    if (project === 'nenovaweb') { setLoading(false); setError(''); return undefined; }
    const controller = new AbortController();
    const params = new URLSearchParams({ project, source, type, workType, page: String(page), limit: String(PAGE_SIZE) });
    if (submittedQ) params.set('q', submittedQ);
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    setLoading(true); setError('');
    fetch(`${API}?${params}`, { signal: controller.signal })
      .then(async response => { const body = await response.json(); if (!response.ok || body.success === false) throw new Error(body.error || '이력을 불러오지 못했습니다.'); return body; })
      .then(body => { setData(body); setLoading(false); })
      .catch(reason => { if (reason.name === 'AbortError') return; setError(reason.message || '이력을 불러오지 못했습니다.'); setLoading(false); });
    return () => controller.abort();
  }, [project, source, type, workType, submittedQ, from, to, page, revision]);

  const reset = useCallback(() => {
    setProject('all'); setSource('all'); setType('all'); setWorkType('all'); setQ(''); setSubmittedQ(''); setFrom(''); setTo(''); setPage(1); setExpanded({}); searchRef.current?.focus();
  }, []);
  useEffect(() => {
    const onBack = event => { if (Object.values(expanded).some(Boolean)) { event.preventDefault(); setExpanded({}); return; } if (project === 'all' && source === 'all' && type === 'all' && workType === 'all' && !q && !from && !to && page === 1) return; event.preventDefault(); reset(); };
    const onEscape = event => {
      if (event.key !== 'Escape') return;
      const open = Object.keys(expanded).find(key => expanded[key]);
      if (open) { setExpanded({}); cardRefs.current.find(node => node?.dataset?.cardId === open)?.focus(); return; }
      if (project !== 'all' || source !== 'all' || type !== 'all' || workType !== 'all' || q || from || to || page !== 1) reset();
    };
    window.addEventListener('nenova:menu-back-request', onBack); window.addEventListener('keydown', onEscape);
    return () => { window.removeEventListener('nenova:menu-back-request', onBack); window.removeEventListener('keydown', onEscape); };
  }, [project, source, type, workType, q, from, to, page, expanded, reset]);

  const timeline = data?.timeline || [];
  const totalPages = Math.max(1, data?.totalPages || 1);
  function changeFilter(setter, value) { setter(value); setPage(1); setExpanded({}); }
  function moveFocus(event, index, refs, count) {
    if (!['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key) || !count) return;
    event.preventDefault();
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? count - 1 : ['ArrowDown', 'ArrowRight'].includes(event.key) ? (index + 1) % count : (index - 1 + count) % count;
    refs.current[next]?.focus();
  }
  return <section className={styles.root} aria-label="전체 개발 이력">
    <div className={styles.heading}><div><p className={styles.eyebrow}>DEVELOPMENT HISTORY</p><h1>전체 개발 이력</h1>
      <p className={styles.intro}>최초 MindMap Viewer부터 Nenova ERP까지, 등록된 세 저장소의 기준 ref에서 확인된 커밋을 시간순으로 찾습니다.</p>
      <p className={styles.snapshot}>스냅샷 {dateLabel(data?.generatedAt)} · 외부 저장소 main / ERP 빌드 HEAD · 다른 미병합 ref, 로컬 미커밋 작업, 비공개 대화 원문 제외</p></div>
      <button type="button" className={styles.refresh} onClick={() => setRevision(value => value + 1)} disabled={loading}>{loading ? '불러오는 중…' : '새로고침'}</button></div>
    <div className={styles.stats} aria-label="검증된 개발 이력 집계"><div><span>고유 커밋</span><strong>{number(data?.counts?.uniqueCommits)}</strong></div><div><span>비병합 커밋</span><strong>{number(data?.counts?.nonMerge)}</strong></div><div><span>병합 커밋</span><strong>{number(data?.counts?.merge)}</strong></div><div><span>별도 업무 기록</span><strong>{number(data?.counts?.summaries)}</strong></div></div>
    <p className={styles.notice}>{data?.coverageNote || '커밋은 사용자 요청 수나 작업 횟수가 아닙니다. 업무 기록 문서는 커밋 합계에 포함되지 않습니다.'} {data && `업무 기록 중 제목 확인 ${number(data.counts?.knownSummaryTitles)}건 · 날짜만 확인한 문서 ${number(data.counts?.unknownSummaryTitles)}건.`}</p>
    <div className={styles.tabs} role="group" aria-label="프로젝트 선택">{projectOptions.map(([id, label], index) => <button key={id} ref={node => { tabRefs.current[index] = node; }} type="button" aria-pressed={project === id} onKeyDown={event => moveFocus(event, index, tabRefs, projectOptions.length)} onClick={() => changeFilter(setProject, id)}>{label}</button>)}</div>
    {project === 'nenovaweb' ? <div className={styles.state}>Nenovaweb의 Git 원장은 아직 확인되지 않았습니다. 커밋 수를 0건으로 해석하지 않습니다.</div> : <>
      <div className={styles.filters}>
        <label className={styles.search}><span>검색 · 제목/안전한 경로</span><input ref={searchRef} type="search" value={q} placeholder="커밋 제목이나 파일 경로" onChange={event => { setQ(event.target.value); setPage(1); }} /></label>
        <label><span>원본 저장소</span><select value={source} onChange={event => changeFilter(setSource, event.target.value)}><option value="all">전체 저장소</option>{Object.entries(sourceLabels).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
        <label><span>레코드 종류</span><select value={type} onChange={event => changeFilter(setType, event.target.value)}><option value="all">전체</option><option value="nonmerge">비병합 커밋</option><option value="merge">병합 커밋</option><option value="summary">업무 기록</option></select></label>
        <label><span>변경 성격</span><select value={workType} onChange={event => changeFilter(setWorkType, event.target.value)}><option value="all">전체 성격</option>{Object.entries(typeLabels).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
        <label><span>시작일</span><input type="date" value={from} onChange={event => changeFilter(setFrom, event.target.value)} /></label>
        <label><span>종료일</span><input type="date" value={to} onChange={event => changeFilter(setTo, event.target.value)} /></label>
        <button type="button" className={styles.reset} onClick={reset}>조건 초기화</button>
      </div>
      <div className={styles.sources}>{data?.sources?.map(item => <div key={item.id}><strong>{sourceLabels[item.id] || item.label}</strong><span>{item.ref} · {item.headHash?.slice(0, 10) || 'head 미확인'} · {number(item.totalCommits)} 커밋</span><small>{item.sourceStatus === 'tracked-manifest' ? '보관된 외부 main manifest · 현재 원본과 동일 여부 미확인' : '빌드 HEAD Git 확인 · 기본 브랜치 여부 배포 시 확인'} · 수집 {dateLabel(item.collectedAt)}</small></div>)}</div>
      {error && <div role="alert" className={styles.error}>이력을 불러오지 못했습니다: {error} <button type="button" onClick={() => setRevision(value => value + 1)}>다시 시도</button></div>}
      {loading && <p role="status" className={styles.state}>전체 개발 이력을 불러오는 중입니다…</p>}
      {!loading && !error && <><h2 className={styles.resultHeading}>시간순 이력 <small>조건에 맞는 레코드 {number(data?.totalEvents)}건 · 커밋 {number(data?.filteredCounts?.commits)}건 / 업무 기록 {number(data?.filteredCounts?.summaries)}건</small></h2>
        {!timeline.length && <p className={styles.state}>조건에 맞는 이력이 없습니다.</p>}
        <ol className={styles.timeline}>{timeline.map((item, index) => <li key={item.id} className={styles.card}>
          <button ref={node => { cardRefs.current[index] = node; }} data-card-id={item.id} className={styles.cardButton} type="button" aria-expanded={!!expanded[item.id]} onKeyDown={event => moveFocus(event, index, cardRefs, timeline.length)} onClick={() => setExpanded(previous => ({ ...previous, [item.id]: !previous[item.id] }))}>
            <span className={styles.cardMeta}>{dateLabel(item.committedAt || item.date)} · {item.kind === 'summary' ? '업무 기록' : item.parents.length > 1 ? '병합 커밋' : '비병합 커밋'} · {item.kind === 'commit' ? typeLabels[item.workType] : item.titleKnown ? '문서 제목 확인' : '문서 날짜만 확인'}</span>
            <strong>{item.kind === 'summary' ? item.title : item.subject}</strong>
            <span className={styles.cardMeta}>{item.kind === 'commit' ? `${item.hash.slice(0, 10)} · ${item.sourceIds.map(id => sourceLabels[id] || id).join(', ')} · 변경 파일 ${number(item.changedFileCount)}개 · 메뉴 연결 ${number(item.menuHrefs.length)}개` : `${sourceLabels[item.sourceId] || item.sourceId} · 커밋 수에 미포함`}</span>
          </button>
          {expanded[item.id] && <div className={styles.details}>{item.kind === 'commit' ? <><p>분류 근거: {item.typeEvidence} · 프로젝트: {item.projectIds.join(', ')}</p><p>안전 경로 {number(item.paths.length)}개 · 가린 경로 {number(item.redactedPathCount)}개</p>{item.paths.length > 0 && <ul>{item.paths.map(path => <li key={path}>{path}</li>)}</ul>}{item.menuHrefs.length > 0 && <p>연결 메뉴: {item.menuHrefs.join(', ')}</p>}</> : <p>날짜형 문서 제목만 표시합니다. 본문은 수집하지 않았습니다.</p>}</div>}
        </li>)}</ol>
        {totalPages > 1 && <nav className={styles.pagination} aria-label="이력 페이지"><button type="button" disabled={page <= 1} onClick={() => setPage(value => value - 1)}>이전</button><span>{page} / {totalPages}</span><button type="button" disabled={page >= totalPages} onClick={() => setPage(value => value + 1)}>다음</button></nav>}
      </>}
    </>}
  </section>;
}
