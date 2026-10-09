import { useEffect, useMemo, useRef, useState } from 'react';
import styles from './DevelopmentPurposeStories.module.css';

const PAGE_SIZE = 50;
const sourceNames = { erp: '회사 업무 프로그램 (Nenova ERP)', 'mindmap-viewer': '생각 정리 프로그램 (MindMap Viewer)', nenovakakao: '카카오톡 업무 도우미 (Nenova Kakao)' };
const confidenceNames = { verified: '기록에서 확인함', supported: '관련 기록으로 확인함', partial: '일부는 더 확인 필요' };
const number = value => Number(value || 0).toLocaleString('ko-KR');
const kst = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: 'long', day: 'numeric' });
function dateLabel(value) {
  if (!value) return '날짜 확인 필요';
  const text = String(value);
  const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(text) ? `${text}T12:00:00+09:00` : text);
  return Number.isNaN(date.getTime()) ? '날짜 확인 필요' : kst.format(date);
}
function periodLabel(first, last) { if (!first) return '연결 날짜 확인 필요'; return first === last ? dateLabel(first) : `${dateLabel(first)} ~ ${dateLabel(last)}`; }
function chapterLabel(value) { if (!value) return '날짜 확인 필요'; const [year, month] = value.split('-'); return `${year}년 ${Number(month)}월`; }
async function getJson(url, signal) {
  const response = await fetch(url, { signal });
  const body = await response.json();
  if (!response.ok || body.success === false) throw new Error(body.error || '개발 이야기를 불러오지 못했습니다.');
  return body;
}

function GuideCharacter() {
  return <svg className={styles.mascot} viewBox="0 0 210 170" role="img" aria-label="기록을 읽는 안내 캐릭터">
    <ellipse cx="108" cy="157" rx="76" ry="7" fill="#b8d8d7" opacity=".6" />
    <path d="M62 75c0-29 19-50 47-50s47 21 47 50v46c0 20-19 32-47 32s-47-12-47-32z" fill="#59a8aa" stroke="#176971" strokeWidth="3" />
    <path d="M77 38 72 12l25 17M140 38l5-26-25 17" fill="#78c1bd" stroke="#176971" strokeWidth="3" strokeLinejoin="round" />
    <circle cx="89" cy="77" r="5" fill="#123e4d" /><circle cx="128" cy="77" r="5" fill="#123e4d" /><path d="M100 94q9 8 18 0" fill="none" stroke="#123e4d" strokeWidth="3" strokeLinecap="round" />
    <path d="m65 107-27-9m117 9 27-9" stroke="#176971" strokeWidth="9" strokeLinecap="round" />
    <path d="M76 111q16-7 33 1 17-8 33-1v31q-16-7-33 1-17-8-33-1z" fill="#fff" stroke="#176971" strokeWidth="3" strokeLinejoin="round" /><path d="M109 112v31M84 122l16 3m17 0 16-3" stroke="#8bbdbe" strokeWidth="2" />
    <path d="m31 51 5-12 5 12 12 5-12 5-5 12-5-12-12-5z" fill="#edc66e" /><path d="m174 37 3-8 3 8 8 3-8 3-3 8-3-8-8-3z" fill="#edc66e" />
  </svg>;
}

function EvidenceRecords({ storyId, total, page, setPage, data, loading, error, retry, close, panelRef }) {
  const itemRefs = useRef([]);
  const [expanded, setExpanded] = useState('');
  useEffect(() => setExpanded(''), [page, storyId]);
  const totalPages = Math.max(1, data?.totalPages || Math.ceil(total / PAGE_SIZE));
  function moveFocus(event, index, count) {
    if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? count - 1 : event.key === 'ArrowDown' ? Math.min(count - 1, index + 1) : Math.max(0, index - 1);
    itemRefs.current[next]?.focus();
  }
  return <div ref={panelRef} tabIndex={-1} className={styles.evidencePanel} onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); if (expanded) { setExpanded(''); itemRefs.current.find(node => node?.dataset?.recordId === expanded)?.focus(); } else close(); } }}>
    <div className={styles.evidenceHeading}><div><strong>{storyId === 'review-pending' ? '아직 정리할 원본 기록' : '이 이야기를 확인한 원본 기록'}</strong><p>날짜와 기록 종류를 먼저 보여 줍니다. 원본 제목은 기록을 펼치면 볼 수 있습니다.</p></div><button type="button" onClick={close}>원본 기록 목록 닫기</button></div>
    {loading && <p className={styles.state} role="status">근거 기록을 불러오는 중입니다…</p>}
    {error && <div className={styles.error} role="alert">근거 기록을 불러오지 못했습니다: {error} <button type="button" onClick={retry}>다시 시도</button></div>}
    {!loading && !error && data && <>
      {!data.timeline?.length && <p className={styles.state}>표시할 근거 기록이 없습니다.</p>}
      <ol className={styles.evidenceList}>{(data.timeline || []).map((item, index) => {
        const commit = item.kind === 'commit';
        const label = commit ? item.isMerge ? '여러 수정을 합친 기록' : '프로그램을 고친 기록' : '작업 메모';
        const title = commit ? item.subject : item.title;
        return <li key={item.id}><button ref={node => { itemRefs.current[index] = node; }} data-record-id={item.id} type="button" onKeyDown={event => moveFocus(event, index, data.timeline.length)} onClick={() => setExpanded(current => current === item.id ? '' : item.id)} aria-expanded={expanded === item.id} aria-label={`${(page - 1) * PAGE_SIZE + index + 1}번째 ${label}, 원본 제목 ${expanded === item.id ? '접기' : '펼치기'}`}>
          <span className={styles.recordOrdinal}>{number((page - 1) * PAGE_SIZE + index + 1)}</span><span className={styles.recordBody}><time>{dateLabel(item.date)}</time><strong>{label}</strong><small>{item.sourceIds?.map(id => sourceNames[id] || id).join(', ') || '프로그램 확인 필요'}{commit && item.shortHash ? ` · 확인번호 ${item.shortHash}` : ''}</small></span>
        </button>{expanded === item.id && <div className={styles.recordExtra}>{item.assignment?.reviewReason && <p>확인한 내용: {item.assignment.reviewReason}</p>}원본 기록 제목: {title}. {commit && item.shortHash ? `확인번호 ${item.shortHash}.` : '작업 메모 본문은 표시하지 않습니다.'}</div>}</li>;
      })}</ol>
      {totalPages > 1 && <nav className={styles.pageNav} aria-label="근거 기록 페이지"><button type="button" disabled={page <= 1} onClick={() => setPage(1)}>맨 처음</button><button type="button" disabled={page <= 1} onClick={() => setPage(page - 1)}>이전</button><span>{page} / {totalPages}</span><button type="button" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>다음</button><button type="button" disabled={page >= totalPages} onClick={() => setPage(totalPages)}>맨 끝</button></nav>}
    </>}
  </div>;
}

export default function DevelopmentPurposeStories() {
  const [overview, setOverview] = useState(null);
  const [overviewLoading, setOverviewLoading] = useState(true);
  const [overviewError, setOverviewError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [query, setQuery] = useState('');
  const [source, setSource] = useState('all');
  const [confidence, setConfidence] = useState('all');
  const [status, setStatus] = useState('all');
  const [openStory, setOpenStory] = useState('');
  const [page, setPage] = useState(1);
  const [records, setRecords] = useState(null);
  const [recordsLoading, setRecordsLoading] = useState(false);
  const [recordsError, setRecordsError] = useState('');
  const [retryCount, setRetryCount] = useState(0);
  const cache = useRef(new Map());
  const openRefs = useRef({});
  const panelRef = useRef(null);

  useEffect(() => {
    const controller = new AbortController();
    setOverviewLoading(true); setOverviewError('');
    getJson('/api/dev/development-stories', controller.signal)
      .then(body => { if (controller.signal.aborted) return; setOverview(body); setOverviewLoading(false); })
      .catch(error => { if (controller.signal.aborted || error.name === 'AbortError') return; setOverviewError(error.message); setOverviewLoading(false); });
    return () => controller.abort();
  }, [refresh]);

  useEffect(() => {
    if (!openStory) return undefined;
    const params = new URLSearchParams({ mode: 'records', storyId: openStory, page: String(page), limit: String(PAGE_SIZE), order: 'oldest' });
    const url = `/api/dev/development-stories?${params}`;
    const cached = cache.current.get(url);
    if (cached) { setRecords(cached); setRecordsLoading(false); setRecordsError(''); return undefined; }
    const controller = new AbortController();
    setRecords(null); setRecordsLoading(true); setRecordsError('');
    getJson(url, controller.signal)
      .then(body => {
        if (controller.signal.aborted) return;
        cache.current.set(url, body);
        if (cache.current.size > 16) cache.current.delete(cache.current.keys().next().value);
        setRecords(body); setRecordsLoading(false);
        if (body.page !== page) setPage(body.page);
      })
      .catch(error => { if (controller.signal.aborted || error.name === 'AbortError') return; setRecordsError(error.message); setRecordsLoading(false); });
    return () => controller.abort();
  }, [openStory, page, retryCount]);

  const sourceFilterAvailable = !!overview?.stories?.every(story => Array.isArray(story.sourceIds));
  const visible = useMemo(() => (overview?.stories || []).filter(story => {
    const text = `${story.title} ${story.purpose} ${story.userValue} ${(story.changes || []).map(change => `${change.title} ${change.problem || ''} ${change.description} ${change.result || ''}`).join(' ')}`.toLocaleLowerCase();
    return (status !== 'review') && (!query || text.includes(query.trim().toLocaleLowerCase())) && (source === 'all' || story.sourceIds?.includes(source)) && (confidence === 'all' || story.confidence === confidence);
  }), [overview, query, source, confidence, status]);
  const chapters = useMemo(() => {
    const grouped = new Map();
    for (const story of visible) {
      const key = story.firstDate?.slice(0, 7) || 'unknown';
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(story);
    }
    return [...grouped].sort(([a], [b]) => a.localeCompare(b));
  }, [visible]);
  const showReview = status === 'review' || status === 'all' && !query.trim() && source === 'all' && confidence === 'all';
  const linkIds = [...visible.map(story => story.id), ...(showReview && overview?.coverage?.reviewPending ? ['review-pending'] : [])];
  useEffect(() => { if (openStory) panelRef.current?.focus(); }, [openStory, page]);
  function closeRecords() { const id = openStory; setOpenStory(''); setRecords(null); setRecordsError(''); setPage(1); requestAnimationFrame(() => openRefs.current[id]?.focus()); }
  function toggleRecords(id) { if (openStory === id) { closeRecords(); return; } setOpenStory(id); setPage(1); setRecords(null); setRecordsError(''); }
  function moveStoryFocus(event, id) {
    if (!['ArrowDown', 'ArrowUp', 'ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const index = linkIds.indexOf(id);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? linkIds.length - 1 : ['ArrowDown', 'ArrowRight'].includes(event.key) ? Math.min(linkIds.length - 1, index + 1) : Math.max(0, index - 1);
    openRefs.current[linkIds[next]]?.focus();
  }
  function refreshAll() { cache.current.clear(); setOpenStory(''); setRecords(null); setRefresh(value => value + 1); }
  function retryRecords() { cache.current.clear(); setRetryCount(value => value + 1); }
  function changeFilter(setter, value) { if (openStory) closeRecords(); setter(value); }
  useEffect(() => {
    const onBack = event => {
      if (openStory) { event.preventDefault(); closeRecords(); return; }
      if (query || source !== 'all' || confidence !== 'all' || status !== 'all') { event.preventDefault(); setQuery(''); setSource('all'); setConfidence('all'); setStatus('all'); }
    };
    window.addEventListener('nenova:menu-back-request', onBack);
    return () => window.removeEventListener('nenova:menu-back-request', onBack);
  }, [openStory, query, source, confidence, status]);

  return <section className={styles.root} aria-label="업무가 편해진 과정">
    <header className={styles.hero}><div><p className={styles.eyebrow}>개발 이력 쉽게 보기</p><h1>왜 만들었고, 무엇이 편해졌는지</h1>
      <p className={styles.lead}>기능마다 필요했던 이유, 추가하거나 고친 내용, 편해진 점을 순서대로 볼 수 있습니다.</p>
      <p className={styles.caveat}>아래 숫자는 확인한 원본 기록의 수입니다. 기능·요청·완료한 일의 수와 같지 않습니다. 어느 이야기인지 확실하지 않은 기록은 따로 두었습니다.</p>
      <p className={styles.snapshot}>마지막 자료 확인: {overview?.generatedAt ? dateLabel(overview.generatedAt) : '불러오는 중'}</p>
    </div><GuideCharacter /></header>
    {overviewLoading && <p role="status" className={styles.state}>목적별 개발 이야기를 불러오는 중입니다…</p>}
    {overviewError && <div className={styles.error} role="alert">개발 이야기를 불러오지 못했습니다: {overviewError} <button type="button" onClick={() => setRefresh(value => value + 1)}>다시 시도</button></div>}
    {!overviewLoading && !overviewError && overview && <>
      <p className={styles.coverageNote}>아래 숫자는 검색 조건과 관계없이 모든 원본 기록을 셉니다. 기능 수가 아닙니다.</p>
      <div className={styles.coverage} aria-label="원본 기록 정리 현황"><div><span>확인한 원본 기록</span><strong>{number(overview.coverage?.totalRecords)}건</strong></div><div><span>이야기로 정리한 기록</span><strong>{number(overview.coverage?.assignedRecords)}건</strong></div><div className={styles.pendingCount}><span>아직 정리할 기록</span><strong>{number(overview.coverage?.reviewPending)}건</strong></div></div>
      <div className={styles.toolbar}><label className={styles.search}><span>필요했던 이유·달라진 점 찾기</span><input type="search" value={query} disabled={status === 'review'} onChange={event => changeFilter(setQuery, event.target.value)} placeholder="업무나 기능 이름으로 찾기" /></label>
        {sourceFilterAvailable && <label><span>어느 프로그램</span><select value={source} disabled={status === 'review'} onChange={event => changeFilter(setSource, event.target.value)}><option value="all">모든 프로그램</option>{Object.entries(sourceNames).map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>}
        <label><span>얼마나 확인했나</span><select value={confidence} disabled={status === 'review'} onChange={event => changeFilter(setConfidence, event.target.value)}><option value="all">전체</option>{Object.entries(confidenceNames).map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
        <label><span>정리 상태</span><select value={status} onChange={event => changeFilter(setStatus, event.target.value)}><option value="all">전체</option><option value="linked">이야기로 정리됨</option><option value="review">아직 정리 중</option></select></label>
        <button type="button" onClick={() => { setQuery(''); setSource('all'); setConfidence('all'); setStatus('all'); if (openStory) closeRecords(); }}>조건 초기화</button><button type="button" onClick={refreshAll} disabled={overviewLoading}>새로고침</button>
      </div>
      <p className={styles.resultCount}>현재 조건 이야기 {number(visible.length)}개 / 전체 {number(overview.stories?.length)}개</p>
      {status === 'review' && <p className={styles.filterNote}>아직 정리 중인 원본 기록은 업무 검색·어느 프로그램·얼마나 확인했나 조건을 적용하지 않은 전체 목록입니다. 이 보기에서는 이야기 검색 조건을 사용할 수 없습니다.</p>}
      {status !== 'review' && !visible.length && <p className={styles.state}>검색 조건에 맞는 목적 이야기가 없습니다. 전체 기록 현황은 위 집계를 확인해 주세요.</p>}
      {chapters.map(([month, stories], chapterIndex) => <section className={styles.chapter} key={month} aria-label={`${chapterLabel(month)} 목적 이야기`}><div className={styles.chapterHeading}><span className={styles.chapterIndex}>{String(chapterIndex + 1).padStart(2, '0')}</span><div><p className={styles.eyebrow}>시작한 시기</p><h2>{chapterLabel(month)}</h2><p>{number(stories.length)}개의 이야기 · 여러 달의 보완도 같은 이야기에서 이어집니다.</p></div></div>
        <div className={styles.storyList}>{stories.map(story => <article key={story.id} className={styles.storyCard}><div className={styles.storyHeader}><div><p className={styles.period}>{periodLabel(story.firstDate, story.lastDate)}</p><h3>{story.title}</h3></div><span className={`${styles.confidence} ${styles[story.confidence] || ''}`}>{confidenceNames[story.confidence] || '확인 수준 검토 필요'}</span></div>
          <div className={styles.storyNarrative}><div><span className={styles.fieldLabel}>왜 필요했나</span><p>{story.purpose}</p></div><div><span className={styles.fieldLabel}>무엇이 편해졌나</span><p>{story.userValue}</p></div></div>
          <div className={styles.changes}><h4>만들고 다듬은 흐름</h4><ol>{(story.changes || []).map((change, index) => <li key={`${story.id}-${index}`}><span className={styles.changeDate}>{periodLabel(change.firstDate, change.lastDate)}</span><div><strong>{change.title}</strong>{change.problem && <p><b>불편했던 점</b> · {change.problem}</p>}<p>{change.problem || change.result ? <><b>추가·수정한 기능</b> · </> : null}{change.description}</p>{change.result && <p><b>편해진 점</b> · {change.result}</p>}{Number.isFinite(change.evidenceCount) && <small>확인한 원본 기록 {number(change.evidenceCount)}건</small>}</div></li>)}</ol></div>
          <p className={styles.scope}><strong>확인 범위</strong> · {story.scopeNote}</p>
          <button ref={node => { openRefs.current[story.id] = node; }} className={styles.openEvidence} type="button" aria-expanded={openStory === story.id} onKeyDown={event => moveStoryFocus(event, story.id)} onClick={() => toggleRecords(story.id)}>확인한 원본 기록 {number(story.recordCount)}건 {openStory === story.id ? '닫기' : '보기'}</button>
          {openStory === story.id && <EvidenceRecords storyId={story.id} total={story.recordCount} page={page} setPage={setPage} data={records} loading={recordsLoading} error={recordsError} retry={retryRecords} close={closeRecords} panelRef={panelRef} />}
        </article>)}</div>
      </section>)}
      {showReview && <section className={`${styles.chapter} ${styles.reviewChapter}`} aria-label="목적 검토가 필요한 기록"><div className={styles.chapterHeading}><span className={styles.chapterIndex}>?</span><div><p className={styles.eyebrow}>목적 확인 중</p><h2>아직 목적을 확인 중인 기록</h2><p>다른 이야기로 억지로 연결하지 않고 원본 기록을 그대로 확인할 수 있습니다.</p></div></div>
        <div className={styles.reviewCard}><div><strong>{number(overview.coverage?.reviewPending)}건 별도 확인</strong><p>어느 이야기에 넣을지 하나로 정하기 어려운 기록 {number(overview.coverage?.ambiguous)}건과 아직 알맞은 이야기를 찾지 못한 기록 {number(overview.coverage?.unmatched)}건입니다. 이 가운데 여러 수정을 합친 기록 {number(overview.reviewPending?.counts?.merge)}건은 새 기능이나 완료한 일의 수로 세지 않습니다. 이 숫자는 검색 조건과 관계없는 전체 기록 수입니다.</p></div>
          <button ref={node => { openRefs.current['review-pending'] = node; }} type="button" className={styles.openEvidence} disabled={!overview.coverage?.reviewPending} aria-expanded={openStory === 'review-pending'} onKeyDown={event => moveStoryFocus(event, 'review-pending')} onClick={() => toggleRecords('review-pending')}>검토 대기 원본 기록 {openStory === 'review-pending' ? '닫기' : '보기'}</button>
          {openStory === 'review-pending' && <EvidenceRecords storyId="review-pending" total={overview.coverage.reviewPending} page={page} setPage={setPage} data={records} loading={recordsLoading} error={recordsError} retry={retryRecords} close={closeRecords} panelRef={panelRef} />}
        </div>
      </section>}
    </>}
  </section>;
}
