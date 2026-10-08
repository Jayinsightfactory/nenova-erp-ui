import { useEffect, useMemo, useRef, useState } from 'react';
import styles from './DevelopmentJourney.module.css';

const PAGE_SIZE = 50;
const sourceNames = { erp: 'Nenova ERP', 'mindmap-viewer': 'MindMap Viewer', nenovakakao: 'Nenova Kakao' };
const projectNames = { 'mindmap-orbit': 'MindMap · Orbit', 'nenova-kakao': 'Nenova Kakao', 'nenova-erp': 'Nenova ERP' };
const workNames = { initial: '처음 개발', research: '자료 확인·조사', plan: '기획·설계', fix: '수정·보정', feature: '기능 추가', 'test-guard': '오류 확인·예방', 'ops-refactor': '유지관리·구조 개선', other: '분류되지 않은 작업' };
const evidenceNames = { 'verified-root': '첫 코드 기록으로 확인됨', 'subject-prefix': '원본 기록 제목의 표현을 기준으로 분류됨', unclassified: '원본 기록 제목만으로 작업 종류 확인 어려움' };
const dateFormat = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' });
const timeFormat = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit' });
const fmt = value => Number(value || 0).toLocaleString('ko-KR');
function dateLabel(value) { if (!value) return '날짜 확인 불가'; const date = new Date(value); return Number.isNaN(date.getTime()) ? '날짜 확인 불가' : dateFormat.format(date); }
function timeLabel(value) { if (!value) return '시간 확인 불가'; const date = new Date(value); return Number.isNaN(date.getTime()) ? '시간 확인 불가' : timeFormat.format(date); }
function dateTimeLabel(value) { return value ? `${dateLabel(value)} ${timeLabel(value)}` : '확인 불가'; }
function monthLabel(value) { const [year, month] = String(value || '').split('-'); return `${year || '연도 미상'}년 ${Number(month) || '?'}월`; }
async function readJson(url, signal) {
  const response = await fetch(url, { signal });
  const body = await response.json();
  if (!response.ok || body.success === false) throw new Error(body.error || '개발 기록을 불러오지 못했습니다.');
  return body;
}

function Mascot() {
  return <svg className={styles.mascot} viewBox="0 0 200 170" role="img" aria-label="작은 기록 안내 캐릭터가 개발 이력 책을 들고 있습니다">
    <defs><linearGradient id="journey-body" x2="0" y2="1"><stop stopColor="#5DA8DF" /><stop offset="1" stopColor="#2473B4" /></linearGradient></defs>
    <ellipse cx="100" cy="156" rx="72" ry="8" fill="#bed9ef" opacity=".6" />
    <path d="M48 92c0-35 21-60 52-60s52 25 52 60v35c0 17-18 28-52 28s-52-11-52-28z" fill="url(#journey-body)" stroke="#17558d" strokeWidth="3" />
    <path d="M69 38 60 17l27 14M131 38l9-21-27 14" fill="#5DA8DF" stroke="#17558d" strokeWidth="3" strokeLinejoin="round" />
    <circle cx="80" cy="80" r="5" fill="#15375c" /><circle cx="120" cy="80" r="5" fill="#15375c" />
    <path d="M93 96q7 7 14 0" fill="none" stroke="#15375c" strokeWidth="3" strokeLinecap="round" />
    <circle cx="67" cy="94" r="8" fill="#f3a8a9" opacity=".7" /><circle cx="133" cy="94" r="8" fill="#f3a8a9" opacity=".7" />
    <path d="M55 110 26 99M145 110l29-11" stroke="#17558d" strokeWidth="9" strokeLinecap="round" />
    <path d="M70 111q15-7 30 1 15-8 30-1v30q-15-7-30 1-15-8-30-1z" fill="#fff" stroke="#17558d" strokeWidth="3" strokeLinejoin="round" />
    <path d="M100 112v30M79 121l13 3M108 124l13-3" stroke="#85b5d9" strokeWidth="2" />
    <path d="m31 56 5-12 5 12 12 5-12 5-5 12-5-12-12-5z" fill="#f6cc69" /><path d="m164 39 3-8 3 8 8 3-8 3-3 8-3-8-8-3z" fill="#f6cc69" />
  </svg>;
}

export default function DevelopmentJourney() {
  const [source, setSource] = useState('all');
  const [project, setProject] = useState('all');
  const [type, setType] = useState('all');
  const [workType, setWorkType] = useState('all');
  const [q, setQ] = useState('');
  const [submittedQ, setSubmittedQ] = useState('');
  const [summary, setSummary] = useState(null);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [summaryError, setSummaryError] = useState('');
  const [selectedMonth, setSelectedMonth] = useState('');
  const [selectedDay, setSelectedDay] = useState('');
  const [page, setPage] = useState(1);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const [expanded, setExpanded] = useState(null);
  const [refresh, setRefresh] = useState(0);
  const [retry, setRetry] = useState(0);
  const detailCache = useRef(new Map());
  const dayRefs = useRef({});
  const recordRefs = useRef([]);
  const detailRef = useRef(null);

  useEffect(() => { const id = setTimeout(() => setSubmittedQ(q.trim()), 250); return () => clearTimeout(id); }, [q]);
  const filterParams = useMemo(() => {
    const params = new URLSearchParams({ source, project, type, workType });
    if (submittedQ) params.set('q', submittedQ);
    return params;
  }, [source, project, type, workType, submittedQ]);
  const filterKey = filterParams.toString();

  useEffect(() => {
    const controller = new AbortController();
    setSummaryLoading(true); setSummaryError(''); setSummary(null); setDetail(null);
    readJson(`/api/dev/development-journey?${filterKey}`, controller.signal)
      .then(body => {
        if (controller.signal.aborted) return;
        setSummary(body);
        const first = body.months?.[0];
        setSelectedMonth(first?.month || '');
        setSelectedDay(first?.days?.[0]?.date || '');
        setPage(1); setExpanded(null); setSummaryLoading(false);
      })
      .catch(error => { if (controller.signal.aborted || error.name === 'AbortError') return; setSummaryError(error.message); setSummaryLoading(false); });
    return () => controller.abort();
  }, [filterKey, refresh, retry]);

  useEffect(() => {
    if (!selectedDay || summaryLoading || summaryError) return undefined;
    const params = new URLSearchParams(filterKey);
    params.set('from', selectedDay); params.set('to', selectedDay);
    params.set('order', 'oldest'); params.set('page', String(page)); params.set('limit', String(PAGE_SIZE));
    const url = `/api/dev/full-history?${params}`;
    const cached = detailCache.current.get(url);
    if (cached) { setDetail(cached); setDetailLoading(false); setDetailError(''); return undefined; }
    const controller = new AbortController();
    setDetail(null); setDetailLoading(true); setDetailError('');
    readJson(url, controller.signal)
      .then(body => {
        if (controller.signal.aborted) return;
        detailCache.current.set(url, body);
        if (detailCache.current.size > 20) detailCache.current.delete(detailCache.current.keys().next().value);
        setDetail(body); setDetailLoading(false);
      })
      .catch(error => { if (controller.signal.aborted || error.name === 'AbortError') return; setDetailError(error.message); setDetailLoading(false); });
    return () => controller.abort();
  }, [filterKey, selectedDay, page, refresh, retry, summaryLoading, summaryError]);

  const months = summary?.months || [];
  const firstDay = months[0]?.days?.[0]?.date;
  const lastMonth = months[months.length - 1];
  const lastDay = lastMonth?.days?.[lastMonth.days.length - 1]?.date;
  const currentMonth = months.find(item => item.month === selectedMonth);
  const days = currentMonth?.days || [];
  const selectedDayData = days.find(item => item.date === selectedDay);
  const totalPages = Math.max(1, detail?.totalPages || Math.ceil((selectedDayData?.totalEvents || 0) / PAGE_SIZE));

  function changeFilter(setter, value) { setter(value); setSelectedMonth(''); setSelectedDay(''); setPage(1); setExpanded(null); }
  function chooseMonth(month) { setSelectedMonth(month.month); setSelectedDay(month.days?.[0]?.date || ''); setPage(1); setExpanded(null); }
  function chooseDay(day) { setSelectedDay(day.date); setPage(1); setExpanded(null); detailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  function resetFilters() { setSource('all'); setProject('all'); setType('all'); setWorkType('all'); setQ(''); setSubmittedQ(''); setSelectedMonth(months[0]?.month || ''); setSelectedDay(months[0]?.days?.[0]?.date || ''); setPage(1); setExpanded(null); }
  function refreshData() { detailCache.current.clear(); setRefresh(value => value + 1); }
  function retryData() { detailCache.current.clear(); setRetry(value => value + 1); }
  function moveDayFocus(event, index) {
    if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? days.length - 1 : ['ArrowDown', 'ArrowRight'].includes(event.key) ? Math.min(days.length - 1, index + 1) : Math.max(0, index - 1);
    dayRefs.current[days[next]?.date]?.focus();
  }
  function moveRecordFocus(event, index, count) {
    if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? count - 1 : event.key === 'ArrowDown' ? Math.min(count - 1, index + 1) : Math.max(0, index - 1);
    recordRefs.current[next]?.focus();
  }
  function handleDetailKey(event) {
    if (event.key !== 'Escape') return;
    if (expanded) { setExpanded(null); event.preventDefault(); }
    dayRefs.current[selectedDay]?.focus();
  }
  function pageNav(target) { if (detailLoading || target < 1 || target > totalPages || target === page) return; detailRef.current?.focus({ preventScroll: true }); setPage(target); setDetail(null); setExpanded(null); detailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }

  useEffect(() => {
    const onBack = event => {
      if (source === 'all' && project === 'all' && type === 'all' && workType === 'all' && !q && !expanded && page === 1 && (!firstDay || selectedDay === firstDay)) return;
      event.preventDefault(); resetFilters();
    };
    window.addEventListener('nenova:menu-back-request', onBack);
    return () => window.removeEventListener('nenova:menu-back-request', onBack);
  }, [source, project, type, workType, q, expanded, page, firstDay, selectedDay]);

  return <section className={styles.root} aria-label="개발 여정">
    <header className={styles.hero}>
      <div><p className={styles.eyebrow}>DEVELOPMENT JOURNEY · 기록으로 보는 흐름</p><h1>개발 여정</h1>
        <p className={styles.lead}>전체 기록을 날짜별로 묶었습니다. 처음 남겨진 기록부터 최근 기록까지, 월과 날짜를 따라 실제 개발 변경 내역을 살펴보세요.</p>
        <p className={styles.caveat}>코드 변경 기록은 기능 수·요청 건수·배포 횟수가 아닙니다. 작업 메모는 별도로 셉니다. 이 화면은 기록에 없는 성과나 사건을 추정하지 않습니다.</p>
        <p className={styles.coverage}>자료 확인 시각: {summary?.generatedAt ? dateTimeLabel(summary.generatedAt) : '확인 중'} · 저장된 개발 기록과 이 웹사이트에 포함된 기록을 표시하며, 현재 진행 중인 로컬 작업은 포함하지 않습니다.</p>
      </div><Mascot />
    </header>
    <div className={styles.toolbar}>
      <label><span>개발 프로젝트</span><select value={source} onChange={event => changeFilter(setSource, event.target.value)}><option value="all">전체</option>{Object.entries(sourceNames).map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
      <label><span>관련 프로젝트</span><select value={project} onChange={event => changeFilter(setProject, event.target.value)}><option value="all">전체</option>{Object.entries(projectNames).map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
      <label><span>기록 종류</span><select value={type} onChange={event => changeFilter(setType, event.target.value)}><option value="all">전체</option><option value="nonmerge">개별 코드 변경</option><option value="merge">코드 통합</option><option value="summary">작업 메모</option></select></label>
      <label><span>작업 종류</span><select value={workType} onChange={event => changeFilter(setWorkType, event.target.value)}><option value="all">전체</option>{Object.entries(workNames).map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
      <label className={styles.search}><span>원본 기록 제목·공개 가능한 파일 경로 검색</span><input type="search" value={q} onChange={event => changeFilter(setQ, event.target.value)} placeholder="검색어 입력" /></label>
      <button type="button" onClick={resetFilters}>조건 초기화</button><button type="button" onClick={refreshData} disabled={summaryLoading}>새로고침</button>
    </div>
    {summaryLoading && <p role="status" className={styles.state}>개발 여정을 불러오는 중입니다…</p>}
    {summaryError && <div role="alert" className={styles.error}>월별 기록을 불러오지 못했습니다: {summaryError} <button type="button" onClick={retryData}>다시 시도</button></div>}
    {!summaryLoading && !summaryError && summary && <>
      <div className={styles.overview}><div><span>조건에 맞는 기록</span><strong>{fmt(summary.totalEvents)}</strong><small>코드 변경과 작업 메모 합계</small></div><div><span>첫 기록 날짜</span><strong className={styles.dateValue}>{firstDay || '확인 불가'}</strong></div><div><span>마지막 기록 날짜</span><strong className={styles.dateValue}>{lastDay || '확인 불가'}</strong></div><div><span>개별 코드 변경 · 통합 · 메모</span><strong className={styles.compactValue}>{fmt(summary.filteredCounts?.nonMerge)} · {fmt(summary.filteredCounts?.merge)} · {fmt(summary.filteredCounts?.summaries)}</strong></div></div>
      <p className={styles.sourceNote}>출처별 수집 시각: {(summary.sources || []).map(item => `${sourceNames[item.id] || item.label} ${dateTimeLabel(item.collectedAt)}`).join(' · ') || '확인 불가'}. 저장된 외부 개발 기록이 현재 원본과 같은지는 별도 확인이 필요합니다.</p>
      {!months.length ? <p className={styles.state}>조건에 맞는 개발 기록이 없습니다.</p> : <>
        <div className={styles.sectionHeading}><div><p className={styles.eyebrow}>01 · MONTHLY CHAPTERS</p><h2>월별 기록</h2><p>가장 오래된 달부터 표시합니다. 월을 선택하면 해당 날짜의 기록을 볼 수 있습니다.</p></div><span>{fmt(months.length)}개월</span></div>
        <div className={styles.months} role="group" aria-label="월 선택">{months.map(month => {
          const maxDay = Math.max(1, ...month.days.map(day => day.totalEvents));
          return <button key={month.month} type="button" className={styles.monthCard} aria-pressed={month.month === selectedMonth} onClick={() => chooseMonth(month)}>
            <span className={styles.monthTitle}>{monthLabel(month.month)}</span><strong>{fmt(month.totalEvents)}<small>건</small></strong>
            <span className={styles.miniBars} aria-hidden="true">{month.days.map(day => <i key={day.date} style={{ height: `${Math.max(15, day.totalEvents / maxDay * 100)}%` }} />)}</span>
            <span className={styles.monthMeta}>코드 변경 {fmt(month.commits)} · 작업 메모 {fmt(month.summaries)}</span>
          </button>;
        })}</div>
        <div className={styles.sectionHeading}><div><p className={styles.eyebrow}>02 · DAY BY DAY</p><h2>{monthLabel(selectedMonth)}의 날짜</h2><p>방향키로 날짜를 이동하고 Enter 또는 Space로 선택할 수 있습니다.</p></div><span>{fmt(days.length)}일</span></div>
        <div className={styles.contentGrid}>
          <div className={styles.dayRail} role="group" aria-label="날짜 선택">{days.map((day, index) => <button key={day.date} ref={node => { dayRefs.current[day.date] = node; }} type="button" aria-pressed={day.date === selectedDay} onKeyDown={event => moveDayFocus(event, index)} onClick={() => chooseDay(day)}>
            <span>{dateLabel(`${day.date}T12:00:00+09:00`)}</span><strong>{fmt(day.totalEvents)}건</strong><small>코드 변경 {fmt(day.commits)} · 작업 메모 {fmt(day.summaries)}</small>
          </button>)}</div>
          <div ref={detailRef} tabIndex={-1} className={styles.detailArea} onKeyDown={handleDetailKey}>
            <div className={styles.detailHeading}><div><p className={styles.eyebrow}>03 · ORIGINAL RECORDS</p><h2>{selectedDay ? dateLabel(`${selectedDay}T12:00:00+09:00`) : '날짜 선택'}</h2><p>{fmt(selectedDayData?.totalEvents)}건의 기록 · 오래된 순서</p></div><span className={styles.datePill}>{selectedDay}</span></div>
            {detailLoading && <p className={styles.state} role="status">이 날짜의 원본 기록을 불러오는 중입니다…</p>}
            {detailError && <div className={styles.error} role="alert">날짜별 기록을 불러오지 못했습니다: {detailError} <button type="button" onClick={retryData}>다시 시도</button></div>}
            {!detailLoading && !detailError && detail && <>
              {!detail.timeline?.length && <p className={styles.state}>이 날짜에 표시할 기록이 없습니다.</p>}
              <ol className={styles.records}>{(detail.timeline || []).map((item, index) => {
                const commit = item.kind === 'commit';
                const recordType = !commit ? '작업 메모' : item.parents.length > 1 ? '코드 통합 기록' : '개별 코드 변경 기록';
                const title = commit ? item.subject : item.title;
                const sources = commit ? item.sourceIds : [item.sourceId];
                return <li key={item.id} className={styles.record}>
                  <button ref={node => { recordRefs.current[index] = node; }} type="button" className={styles.recordButton} aria-expanded={expanded === item.id} onKeyDown={event => moveRecordFocus(event, index, detail.timeline.length)} onClick={() => setExpanded(current => current === item.id ? null : item.id)}>
                    <span className={styles.ordinal}>#{fmt((page - 1) * PAGE_SIZE + index + 1)}</span><span className={styles.recordMain}><span className={styles.recordTop}><time>{timeLabel(item.committedAt || item.date)}</time><span>{recordType}</span>{commit && <span className={styles.workBadge} data-work-type={item.workType}>{workNames[item.workType] || workNames.other}</span>}</span><strong>{title}</strong><span className={styles.chips}>{sources.map(id => <span key={id}>{sourceNames[id] || id}</span>)}</span></span><span className={styles.expandMark} aria-hidden="true">{expanded === item.id ? '−' : '+'}</span>
                  </button>
                  {expanded === item.id && <div className={styles.recordDetails}><p>{commit ? '원본 기록 제목' : item.titleKnown ? '문서 제목 확인' : '문서 날짜만 확인'}: {title}</p>{commit ? <><p>분류 근거: {evidenceNames[item.typeEvidence] || evidenceNames.unclassified}</p><p>확인번호 {item.hash.slice(0, 10)} · 변경 파일 {fmt(item.changedFileCount)}개 · 공개 가능한 경로 {fmt(item.paths?.length)}개</p>{item.paths?.length > 0 && <ul>{item.paths.map(path => <li key={path}>{path}</li>)}</ul>}</> : <p>작업 메모는 제목과 날짜만 표시합니다. 문서 본문은 수집하지 않았습니다.</p>}</div>}
                </li>;
              })}</ol>
              {totalPages > 1 && <nav className={styles.pagination} aria-label="날짜별 기록 페이지"><button type="button" disabled={detailLoading || page <= 1} onClick={() => pageNav(1)}>맨 처음</button><button type="button" disabled={detailLoading || page <= 1} onClick={() => pageNav(page - 1)}>이전</button><span>{page} / {totalPages}</span><button type="button" disabled={detailLoading || page >= totalPages} onClick={() => pageNav(page + 1)}>다음</button><button type="button" disabled={detailLoading || page >= totalPages} onClick={() => pageNav(totalPages)}>맨 끝</button></nav>}
            </>}
          </div>
        </div>
      </>}
    </>}
  </section>;
}
