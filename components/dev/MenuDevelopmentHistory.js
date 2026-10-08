import { useCallback, useEffect, useRef, useState } from 'react';
import styles from './MenuDevelopmentHistory.module.css';

const API = '/api/dev/menu-history';
const PAGE_SIZE = 50;
const dateFormat = new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hour12: false,
});

function kst(value) {
  if (!value) return '확인 불가';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '확인 불가' : `${dateFormat.format(date)} KST`;
}

function count(value) {
  return Number.isFinite(value) ? value.toLocaleString('ko-KR') : '확인 불가';
}

export default function MenuDevelopmentHistory() {
  const [query, setQuery] = useState('');
  const [submittedQuery, setSubmittedQuery] = useState('');
  const [sort, setSort] = useState('changes');
  const [menu, setMenu] = useState('');
  const [feature, setFeature] = useState('');
  const [page, setPage] = useState(1);
  const [revision, setRevision] = useState(0);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState({});
  const searchRef = useRef(null);
  const menuRefs = useRef([]);
  const featureRefs = useRef([]);

  useEffect(() => {
    const id = setTimeout(() => setSubmittedQuery(query.trim()), 250);
    return () => clearTimeout(id);
  }, [query]);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ sort, page: String(page), limit: String(PAGE_SIZE) });
    if (submittedQuery) params.set('q', submittedQuery);
    if (menu) params.set('menu', menu);
    if (feature) params.set('feature', feature);
    setLoading(true);
    setError('');
    fetch(`${API}?${params}`, { signal: controller.signal })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok || body.success === false) throw new Error(body.error || '이력을 불러오지 못했습니다.');
        return body;
      })
      .then((body) => { setData(body); setLoading(false); })
      .catch((reason) => {
        if (reason.name === 'AbortError') return;
        setError(reason.message || '이력을 불러오지 못했습니다.');
        setLoading(false);
      });
    return () => controller.abort();
  }, [submittedQuery, sort, menu, feature, page, revision]);

  const reset = useCallback(() => {
    setQuery(''); setSubmittedQuery(''); setSort('changes');
    setMenu(''); setFeature(''); setPage(1); setExpanded({});
    searchRef.current?.focus();
  }, []);

  useEffect(() => {
    const onBack = (event) => {
      if (!query && !menu && !feature && page === 1) return;
      event.preventDefault();
      reset();
    };
    const onEscape = (event) => {
      if (event.key !== 'Escape') return;
      if (Object.values(expanded).some(Boolean)) {
        setExpanded({});
        return;
      }
      if (query || menu || feature || page !== 1) reset();
    };
    window.addEventListener('nenova:menu-back-request', onBack);
    window.addEventListener('keydown', onEscape);
    return () => {
      window.removeEventListener('nenova:menu-back-request', onBack);
      window.removeEventListener('keydown', onEscape);
    };
  }, [query, menu, feature, page, expanded, reset]);

  const menus = data?.menus || [];
  const features = data?.features || [];
  const timeline = data?.timeline || [];
  const selectedMenu = data?.selectedMenu || menus.find((item) => item.href === menu);
  const totalPages = Math.max(1, data?.totalPages || 1);

  function onListKey(event, index, refs, length) {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) || length === 0) return;
    event.preventDefault();
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? length - 1
      : event.key === 'ArrowDown' ? (index + 1) % length : (index - 1 + length) % length;
    refs.current[next]?.focus();
  }

  return (
    <section className={styles.root} aria-label="메뉴별 기능 개발 이력">
      <div className={styles.heading}>
        <div>
          <p className={styles.eyebrow}>기능 추가·수정 내역</p>
          <h1>메뉴별 기능</h1>
          <p className={styles.intro}>메뉴와 기능을 선택하면 어떤 기능을 추가하고 수정했는지 날짜순으로 볼 수 있습니다.</p>
          {data && <p className={styles.snapshot}>전체 메뉴 {count(data.totalMenuCount ?? data.menus?.length)}개 · 중복을 제외한 변경 기록 {count(data.uniqueCommitCount)}건 · 자료 확인 시각 {kst(data.generatedAt)} · {data.sourceStatus === 'git' ? '개발 기록 원본에서 확인' : '저장해 둔 자료 기준 · 현재 원본과 같은지는 미확인'}</p>}
        </div>
        <button type="button" className={styles.refresh} onClick={() => setRevision((value) => value + 1)} disabled={loading}>
          {loading ? '불러오는 중…' : '새로고침'}
        </button>
      </div>

      <div className={styles.notice} role="note">
        수정한 프로그램 파일을 기준으로 메뉴와 기능을 분류했습니다. 변경 횟수는 프로그램을 변경해 저장한 기록 수입니다. 요청한 기능 개수나 담당자의 작업 횟수는 아닙니다.
        한 변경이 여러 기능에 포함될 수 있어 기능별 횟수를 더하면 전체와 다를 수 있습니다. 최초 추가 기록이 없으면 최초 추가일과 이후 수정 횟수는 “확인 불가”로 표시합니다.
      </div>
      {data?.coverageNote && <p className={styles.coverage}>여러 작업을 합친 기록에서는 기본 개발 흐름 한 갈래를 따라 변경 파일 목록을 확인합니다. 다른 갈래의 모든 개별 변경을 보여주는 화면은 아닙니다. 파일 내용이나 실제 업무 내용을 읽어 분류한 것은 아닙니다. {data.isShallow && '이전에 개발한 기록 일부가 없어 집계가 불완전합니다. 실제 변경으로 확인하지 못한 기록은 제외했습니다.'}</p>}

      <div className={styles.toolbar}>
        <label className={styles.searchLabel}>
          <span>검색</span>
          <input ref={searchRef} type="search" value={query} onChange={(event) => { setQuery(event.target.value); setMenu(''); setFeature(''); setPage(1); }} placeholder="메뉴·기능·변경 내용 검색" />
        </label>
        <label className={styles.sortLabel}>
          <span>정렬</span>
          <select value={sort} onChange={(event) => { setSort(event.target.value); setPage(1); }}>
            <option value="changes">변경 많은 순</option>
            <option value="recent">최근 변경 순</option>
          </select>
        </label>
        <button type="button" className={styles.reset} onClick={reset}>선택 초기화</button>
      </div>

      {error && <div role="alert" className={styles.error}>이력을 불러오지 못했습니다: {error} <button type="button" onClick={() => setRevision((value) => value + 1)}>다시 시도</button></div>}
      {loading && <p className={styles.state} role="status">메뉴와 기능 이력을 불러오는 중입니다…</p>}
      {!loading && !error && !menus.length && <p className={styles.state}>조건에 맞는 메뉴 이력이 없습니다.</p>}

      {!loading && !error && menus.length > 0 && (
        <div className={styles.columns} aria-busy={loading}>
          <nav className={styles.menuPanel} aria-label="메뉴 선택">
            <div className={styles.panelTitle}><h2>메뉴</h2><span>{count(menus.length)}개</span></div>
            <div className={styles.menuList}>
              {menus.map((item, index) => (
                <button key={item.href} ref={(node) => { menuRefs.current[index] = node; }} type="button"
                  className={`${styles.menuButton} ${menu === item.href ? styles.selected : ''}`}
                  aria-current={menu === item.href ? 'true' : undefined}
                  onKeyDown={(event) => onListKey(event, index, menuRefs, menus.length)}
                  onClick={() => { setMenu(item.href); setFeature(''); setPage(1); setExpanded({}); }}>
                  <span className={styles.menuLabel}>{item.label}</span>
                  <span className={styles.menuMeta}>{item.group} · 기능 {count(item.featureCount)}개 · 변경 {count(item.changeCount)}회</span>
                  <span className={styles.menuMeta}>최근 {kst(item.lastChangedAt)}</span>
                </button>
              ))}
            </div>
          </nav>

          <div className={styles.detail}>
            {!menu && <div className={styles.emptyDetail}>왼쪽에서 메뉴를 선택하면 기능과 변경 이력이 표시됩니다.</div>}
            {menu && <>
              <div className={styles.detailHeader}>
                <div><p className={styles.eyebrow}>{selectedMenu?.group || '메뉴'}</p><h2>{selectedMenu?.label || menu}</h2><p className={styles.path}>{menu}</p></div>
                <div className={styles.summary}><span>메뉴 변경 <strong>{count(selectedMenu?.changeCount)}</strong>회</span><span>기능 <strong>{count(selectedMenu?.featureCount)}</strong>개</span></div>
              </div>
              <h3 className={styles.sectionTitle}>기능</h3>
              {!features.length && <p className={styles.state}>조건에 맞는 기능이 없습니다.</p>}
              <div className={styles.features}>
                {features.map((item, index) => (
                  <button key={item.id} ref={(node) => { featureRefs.current[index] = node; }} type="button"
                    className={`${styles.featureCard} ${feature === item.id ? styles.featureSelected : ''}`}
                    aria-pressed={feature === item.id}
                    onKeyDown={(event) => onListKey(event, index, featureRefs, features.length)}
                    onClick={() => { setFeature(feature === item.id ? '' : item.id); setPage(1); setExpanded({}); }}>
                    <span className={styles.featureTitle}>{item.title}</span>
                    {item.description && <span className={styles.featureDescription}>{item.description}</span>}
                    <span className={styles.featureStats}>변경 {count(item.changeCount)}회 · 최초 추가 {item.firstAddedKnown ? kst(item.firstAddedAt) : '확인 불가'} · 이후 수정 {item.firstAddedKnown ? count(item.modificationCount) : '확인 불가'}회</span>
                  </button>
                ))}
              </div>
              <div className={styles.timelineHeader}><h3 className={styles.sectionTitle}>날짜별 변경 내역</h3><span>조건에 맞는 변경 기록 {count(data?.totalEvents)}건</span></div>
              {!timeline.length && <p className={styles.state}>표시할 변경 이력이 없습니다.</p>}
              <ol className={styles.timeline}>
                {timeline.map((item) => (
                  <li key={`${item.hash}-${item.featureId || ''}`} className={styles.event}>
                    <button type="button" className={styles.eventButton} aria-expanded={Boolean(expanded[item.hash])}
                      onClick={() => setExpanded((current) => ({ ...current, [item.hash]: !current[item.hash] }))}>
                      <span className={styles.eventSubject}>{item.displayTitle || item.subject || '제목 없는 변경'}</span>
                      <span className={styles.eventMeta}>{kst(item.date)} · 확인번호 <code>{item.hash?.slice(0, 10) || '확인 불가'}</code> · 변경 파일 {count(item.changedFiles?.length)}개</span>
                    </button>
                    {expanded[item.hash] && <div className={styles.eventFiles}>
                      {item.bodyExcerpt && <p>{item.bodyExcerpt}</p>}
                      <strong>변경 파일</strong>
                      {item.changedFiles?.length ? <ul>{item.changedFiles.map((file) => <li key={typeof file === 'string' ? file : file.path || file.file}>{typeof file === 'string' ? file : file.path || file.file}</li>)}</ul> : <p>파일 목록을 확인할 수 없습니다.</p>}
                    </div>}
                  </li>
                ))}
              </ol>
              {totalPages > 1 && <nav className={styles.pagination} aria-label="이력 페이지">
                <button type="button" disabled={page <= 1 || loading} onClick={() => setPage((value) => value - 1)}>이전</button>
                <span>{page} / {totalPages}</span>
                <button type="button" disabled={page >= totalPages || loading} onClick={() => setPage((value) => value + 1)}>다음</button>
              </nav>}
            </>}
          </div>
        </div>
      )}
    </section>
  );
}
