import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import { verifyReqUser } from '../lib/auth';
import styles from '../styles/OperationsKnowledge.module.css';
import { homeKnowledgeTarget } from '../lib/homeSourceLink';

const CATEGORIES = { SITUATION: '상황별 처리', CASE: '과거 사례', SEASON: '시즌 주의', HANDOFF: '인수인계', CHECKLIST: '체크리스트' };
const STATUSES = { CHECK: '확인 필요', CURRENT: '현재 적용', RETIRED: '적용 종료' };
const PRIORITIES = { NORMAL: '일반', IMPORTANT: '중요' };
const TAGS = { countries: '국가', flowers: '꽃', farms: '농장', stages: '단계' };
const EMPTY = { title: '', category: 'SITUATION', status: 'CHECK', priority: 'NORMAL', tags: { countries: [], flowers: [], farms: [], stages: [] }, situation: '', action: '', caution: '', checklist: '', contact: '', reviewDate: null };
const dateText = (value) => value ? (String(value).includes('T') ? new Date(value).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : String(value).slice(0, 10)) : '—';
const actorText = (value) => typeof value === 'string' ? value : (value?.name || value?.userName || value?.userId || '기록됨');
const auditActions = { CREATE_ITEM: '지침 등록', UPDATE_ITEM: '지침 수정', ADD_COMMENT: '댓글 등록', ADD_ATTACHMENT: '첨부 등록' };
const fieldLabels = { title: '제목', category: '분류', status: '상태', priority: '중요도', situation: '상황', action: '처리 방법', caution: '주의사항', checklist: '체크리스트', contact: '연락처', reviewDate: '검토일', 'tags.countries': '국가 태그', 'tags.flowers': '꽃 태그', 'tags.farms': '농장 태그', 'tags.stages': '단계 태그' };
export function auditLabel(entry) { const changed = Array.isArray(entry.changedFields) ? entry.changedFields.map((field) => fieldLabels[field] || field) : []; return `${auditActions[entry.action] || entry.action}${changed.length ? ` · 변경: ${changed.join(', ')}` : ''}`; }
const legacyDisplay = (entry) => Object.defineProperty({ id: entry.id, statusLabel: entry.statusLabel, '상황': entry.issue || '', '처리 방법': entry.action || '', '주의사항': entry.caution || '', '확인 항목': entry.checks || '', '기존 진행 상태': entry.legacyStatus || '', '중요도': PRIORITIES[entry.priority] || entry.priority || '', '기록 담당': actorText(entry.legacyActor), '기록 시각': dateText(entry.legacyActor?.at) }, 'title', { value: entry.title, enumerable: false });
const tagText = (item) => Object.values(item?.tags || {}).flat().join(' ');
const searchText = (item) => [item.title, item.situation, item.action, item.caution, item.checklist, item.contact, tagText(item)].join(' ').toLocaleLowerCase();
export function filterKnowledgeItems(items, { category = 'ALL', status = 'ACTIVE', priority = 'ALL', filters = {}, search = '' } = {}) {
  return items.filter((item) =>
    (category === 'ALL' || item.category === category) &&
    (status === 'ALL' || (status === 'ACTIVE' ? item.status !== 'RETIRED' : item.status === status)) &&
    (priority === 'ALL' || item.priority === priority) &&
    Object.keys(TAGS).every((key) => !filters[key] || item.tags?.[key]?.includes(filters[key])) &&
    (!search.trim() || searchText(item).includes(search.trim().toLocaleLowerCase()))
  ).sort((a, b) => Number(b.priority === 'IMPORTANT') - Number(a.priority === 'IMPORTANT') || String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
}
const editable = (item) => ({ ...EMPTY, ...Object.fromEntries(Object.keys(EMPTY).map((key) => [key, item?.[key] ?? EMPTY[key]])), tags: Object.fromEntries(Object.keys(TAGS).map((key) => [key, [...(item?.tags?.[key] || [])]])) });
const errorMessage = (data, status) => data?.error || (status === 409 ? '다른 사용자가 먼저 저장했습니다. 초안은 유지됩니다. 최신 자료를 확인하세요.' : '요청에 실패했습니다. 다시 시도하세요.');

export async function getServerSideProps({ req }) {
  const user = verifyReqUser(req);
  if (!user) return { redirect: { destination: '/login', permanent: false } };
  if (user.accountActive === false) return { notFound: true };
  return { props: {} };
}

export default function OperationsKnowledge() {
  const router = useRouter();
  const [storedSnapshot, setSnapshot] = useState({ revision: null, items: [], audit: [], legacyHandoffs: { items: [] } });
  const snapshot = useMemo(() => ({ ...storedSnapshot, audit: (storedSnapshot.audit || []).map((entry) => ({ ...entry, action: auditLabel(entry) })), legacyHandoffs: { ...storedSnapshot.legacyHandoffs, items: (storedSnapshot.legacyHandoffs?.items || []).map(legacyDisplay) } }), [storedSnapshot]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [conflict, setConflict] = useState(false);
  const [category, setCategory] = useState('ALL');
  const [status, setStatus] = useState('ACTIVE');
  const [priority, setPriority] = useState('ALL');
  const [filters, setFilters] = useState({ countries: '', flowers: '', farms: '', stages: '' });
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState(null);
  const [legacyId, setLegacyId] = useState(null);
  const [draft, setDraft] = useState(null);
  const [tagInputs, setTagInputs] = useState({ countries: '', flowers: '', farms: '', stages: '' });
  const [draftOrigin, setDraftOrigin] = useState('');
  const [draftRevision, setDraftRevision] = useState(null);
  const [comment, setComment] = useState('');
  const [file, setFile] = useState(null);
  const detailRef = useRef(null);
  const listRefs = useRef([]);
  const returnFocus = useRef(null);
  const draftDirty = draft && JSON.stringify(draft) !== draftOrigin;
  const dirtyRef = useRef(false);
  const busyRef = useRef(false);
  const loadSequence = useRef(0);
  dirtyRef.current = Boolean(draftDirty || comment.trim() || file);
  busyRef.current = busy;

  const load = useCallback(async ({ quiet = false } = {}) => {
    if (busyRef.current) return null;
    const sequence = ++loadSequence.current;
    if (!quiet) setLoading(true);
    try {
      const response = await fetch('/api/operations-knowledge', { credentials: 'same-origin', cache: 'no-store' });
      const data = await response.json();
      if (sequence !== loadSequence.current) return null;
      if (!response.ok || !data.success) throw new Error(errorMessage(data, response.status));
      setSnapshot(data);
      setError('');
      setConflict((old) => old && draftRevision !== null && draftRevision !== data.revision);
      return data;
    } catch (err) { if (sequence === loadSequence.current) setError(err.message || '자료를 불러오지 못했습니다.'); return null; }
    finally { if (sequence === loadSequence.current) setLoading(false); }
  }, [draftRevision]);

  useEffect(() => { load(); }, []); // initial request only
  useEffect(() => {
    const onBeforeUnload = (event) => { if (dirtyRef.current) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, []);
  useEffect(() => {
    const onRouteChange = () => {
      if (busyRef.current || (dirtyRef.current && !window.confirm('저장하지 않은 내용이 있습니다. 다른 화면으로 이동할까요?'))) {
        const cancelled = new Error('Navigation cancelled by operations knowledge draft');
        cancelled.cancelled = true;
        router.events.emit('routeChangeError', cancelled);
        throw cancelled;
      }
    };
    router.events.on('routeChangeStart', onRouteChange);
    return () => router.events.off('routeChangeStart', onRouteChange);
  }, [router.events]);

  const closeDetail = useCallback(() => {
    if (busyRef.current) return false;
    if (dirtyRef.current && !window.confirm('저장하지 않은 내용이 있습니다. 닫을까요?')) return false;
    setDraft(null); setComment(''); setFile(null); setSelectedId(null); setLegacyId(null); setConflict(false); setError('');
    requestAnimationFrame(() => returnFocus.current?.focus());
    return true;
  }, []);
  useEffect(() => {
    const onBack = (event) => { if (selectedId || legacyId || draft) { event.preventDefault(); closeDetail(); } };
    const onKey = (event) => { if (event.key === 'Escape' && (selectedId || legacyId || draft)) { event.preventDefault(); closeDetail(); } };
    window.addEventListener('nenova:menu-back-request', onBack);
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('nenova:menu-back-request', onBack); window.removeEventListener('keydown', onKey); };
  }, [selectedId, legacyId, draft, closeDetail]);
  useEffect(() => { if (selectedId || legacyId || draft) detailRef.current?.focus(); }, [selectedId, legacyId, Boolean(draft)]);
  useEffect(() => { if (detailRef.current) detailRef.current.inert = busy; }, [busy]);

  const items = Array.isArray(snapshot.items) ? snapshot.items : [];
  const legacyItems = Array.isArray(snapshot.legacyHandoffs?.items) ? snapshot.legacyHandoffs.items : [];
  const choices = useMemo(() => Object.fromEntries(Object.keys(TAGS).map((key) => [key, [...new Set(items.flatMap((item) => item.tags?.[key] || []))].sort((a, b) => a.localeCompare(b, 'ko'))])), [items]);
  const visible = useMemo(() => filterKnowledgeItems(items, { category, status, priority, filters, search }), [items, category, status, priority, filters, search]);
  const selected = items.find((item) => item.id === selectedId);
  const legacy = legacyItems.find((item) => String(item.id) === String(legacyId));
  const isOpen = Boolean(selectedId || legacyId || draft);
  const linkedItem = useRef('');
  useEffect(() => {
    if (!router.isReady || loading || busyRef.current || dirtyRef.current) return;
    const id = homeKnowledgeTarget(router.query);
    if (!id || linkedItem.current === id) return;
    linkedItem.current = id;
    if (!items.some(item => item.id === id)) { setNotice('연결된 지침이 없거나 더 이상 조회할 수 없습니다.'); return; }
    setSelectedId(id); setLegacyId(null); setDraft(null);
  }, [router.isReady, router.query.itemId, loading, storedSnapshot]);

  function chooseItem(item, event, isLegacy = false) {
    if (busyRef.current) return;
    if (dirtyRef.current && !window.confirm('저장하지 않은 내용이 있습니다. 다른 자료로 이동할까요?')) return;
    returnFocus.current = event.currentTarget;
    setSelectedId(isLegacy ? null : item.id); setLegacyId(isLegacy ? item.id : null);
    setDraft(null); setComment(''); setFile(null); setConflict(false); setError(''); setNotice('');
  }
  function openDraft(item, event) {
    if (busyRef.current) return;
    if (dirtyRef.current && !window.confirm('저장하지 않은 내용이 있습니다. 다른 편집을 시작할까요?')) return;
    returnFocus.current = event.currentTarget;
    const value = editable(item);
    setTagInputs(Object.fromEntries(Object.keys(TAGS).map((key) => [key, value.tags[key].join(', ')])));
    setDraft(value); setDraftOrigin(JSON.stringify(value)); setDraftRevision(snapshot.revision);
    setSelectedId(item?.id || null); setLegacyId(null); setComment(''); setFile(null); setConflict(false); setError(''); setNotice('');
  }
  function changeDraft(key, value) { if (busyRef.current) return; setDraft((old) => ({ ...old, [key]: value })); }
  function changeTags(key, value) { if (busyRef.current) return; setTagInputs((old) => ({ ...old, [key]: value })); setDraft((old) => ({ ...old, tags: { ...old.tags, [key]: [...new Set(value.split(',').map((v) => v.trim()).filter(Boolean))] } })); }
  async function sendJson(payload, successText) {
    if (busyRef.current) return null;
    busyRef.current = true;
    loadSequence.current += 1;
    setLoading(false); setBusy(true); setError(''); setNotice('');
    try {
      const response = await fetch('/api/operations-knowledge', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expectedRevision: payload.item ? draftRevision : snapshot.revision, ...payload }) });
      const data = await response.json();
      if (!response.ok || !data.success) {
        if (response.status === 409) setConflict(true);
        throw new Error(errorMessage(data, response.status));
      }
      setSnapshot((old) => ({ ...old, ...data })); setConflict(false); setNotice(successText);
      return data;
    } catch (err) { setError(err.message || '저장에 실패했습니다.'); return null; }
    finally { busyRef.current = false; setBusy(false); }
  }
  async function saveDraft(event) {
    event.preventDefault();
    if (!draft || conflict || draftRevision !== snapshot.revision || (selectedId && !draftDirty)) return;
    const data = await sendJson({ action: selectedId ? 'UPDATE_ITEM' : 'CREATE_ITEM', ...(selectedId ? { itemId: selectedId } : {}), item: draft }, '지침을 저장했습니다.');
    if (!data) return;
    const saved = selectedId ? data.items?.find((item) => item.id === selectedId) : data.items?.find((item) => !items.some((old) => old.id === item.id));
    setDraft(null); setSelectedId(saved?.id || selectedId); setDraftOrigin(''); setDraftRevision(null);
  }
  async function addComment(event) {
    event.preventDefault();
    if (!selectedId || !comment.trim()) return;
    const data = await sendJson({ action: 'ADD_COMMENT', itemId: selectedId, body: comment.trim() }, '댓글을 등록했습니다.');
    if (data) setComment('');
  }
  async function upload(event) {
    event.preventDefault();
    if (!selectedId || !file || busyRef.current) return;
    const form = event.currentTarget;
    busyRef.current = true;
    loadSequence.current += 1;
    setLoading(false); setBusy(true); setError(''); setNotice('');
    try {
      const body = new FormData(); body.append('expectedRevision', String(snapshot.revision)); body.append('itemId', selectedId); body.append('file', file);
      const response = await fetch('/api/operations-knowledge/attachments', { method: 'POST', credentials: 'same-origin', body });
      const data = await response.json();
      if (!response.ok || !data.success) { if (response.status === 409) setConflict(true); throw new Error(errorMessage(data, response.status)); }
      setSnapshot((old) => ({ ...old, ...data })); setFile(null); form.reset(); setNotice('첨부파일을 등록했습니다.');
    } catch (err) { setError(err.message || '첨부에 실패했습니다.'); }
    finally { busyRef.current = false; setBusy(false); }
  }
  async function refresh() {
    if (busyRef.current) return;
    const data = await load({ quiet: true });
    if (data && draft) {
      if (data.revision !== draftRevision) { setConflict(true); setNotice('최신 자료를 불러왔습니다. 초안은 유지했습니다. 비교 후 편집을 다시 시작하세요.'); }
      else setNotice('최신 자료입니다.');
    }
  }
  function restartEdit() {
    if (busyRef.current) return;
    if (!window.confirm('현재 초안을 버리고 최신 자료로 편집을 다시 시작할까요?')) return;
    const latest = snapshot.items?.find((item) => item.id === selectedId);
    const value = editable(latest);
    setTagInputs(Object.fromEntries(Object.keys(TAGS).map((key) => [key, value.tags[key].join(', ')])));
    setDraft(value); setDraftOrigin(JSON.stringify(value)); setDraftRevision(snapshot.revision); setConflict(false); setError('');
  }
  function onListKey(event, index, length) {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    listRefs.current[(index + (event.key === 'ArrowDown' ? 1 : -1) + length) % length]?.focus();
  }

  return <main className={styles.page}>
    <header className={styles.pageHeader}><div><p data-desktop-chrome className={styles.eyebrow}>업무 매뉴얼 · 공동 지식</p><h1 data-desktop-chrome>주의·이슈 및 업무처리 지침</h1><p>반복 상황과 처리 근거를 남겨 팀에서 함께 확인합니다. 시즌 정보는 제목·태그·본문에 기록하세요.</p></div><div className={styles.headerActions}><button type="button" className={styles.ghost} onClick={refresh} disabled={loading || busy}>새로고침</button><button type="button" className={styles.primary} onClick={(event) => openDraft(null, event)} disabled={loading || busy || snapshot.revision === null}>+ 새 지침</button></div></header>
    <div className={styles.statRow}><span>현재 적용 <strong>{items.filter((item) => item.status === 'CURRENT').length}</strong></span><span>확인 필요 <strong>{items.filter((item) => item.status === 'CHECK').length}</strong></span><span>중요 <strong>{items.filter((item) => item.priority === 'IMPORTANT' && item.status !== 'RETIRED').length}</strong></span><span>자료 버전 <strong>{snapshot.revision ?? '—'}</strong></span></div>
    {error && <div className={styles.error} role="alert">{error}</div>}{notice && <div className={styles.notice} role="status">{notice}</div>}
    {conflict && <div className={styles.warning} role="alert">다른 사용자의 저장 내용이 먼저 반영되었습니다. 입력한 초안은 유지됩니다. <button type="button" onClick={refresh}>최신 자료 다시 조회</button>{draft && <button type="button" onClick={restartEdit}>초안 버리고 최신 자료로 편집</button>}</div>}
    <nav className={styles.tabs} aria-label="지침 분류"><button className={category === 'ALL' ? styles.activeTab : ''} onClick={() => setCategory('ALL')} type="button">전체</button>{Object.entries(CATEGORIES).map(([key, label]) => <button key={key} className={category === key ? styles.activeTab : ''} type="button" onClick={() => setCategory(key)}>{label}</button>)}</nav>
    <section className={styles.filters} aria-label="검색과 필터"><label className={styles.search}>검색<input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="제목, 상황, 처리 방법, 태그 검색" type="search" /></label><label>상태<select value={status} onChange={(event) => setStatus(event.target.value)}><option value="ACTIVE">기본 · 확인 필요 + 현재 적용</option><option value="CHECK">확인 필요</option><option value="CURRENT">현재 적용</option><option value="RETIRED">적용 종료</option><option value="ALL">전체 상태</option></select></label><label>중요도<select value={priority} onChange={(event) => setPriority(event.target.value)}><option value="ALL">전체</option>{Object.entries(PRIORITIES).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>{Object.entries(TAGS).map(([key, label]) => <label key={key}>{label}<select value={filters[key]} onChange={(event) => setFilters((old) => ({ ...old, [key]: event.target.value }))}><option value="">전체</option>{choices[key].map((value) => <option key={value} value={value}>{value}</option>)}</select></label>)}</section>
    <div className={styles.workspace}><section className={styles.listPane} aria-label="지침 목록"><div className={styles.sectionHeading}><h2>지침 목록</h2><span>{visible.length}건</span></div>{loading ? <p className={styles.empty}>자료를 불러오는 중입니다.</p> : visible.length ? <div className={styles.list} role="list">{visible.map((item, index) => <button type="button" role="listitem" ref={(node) => { listRefs.current[index] = node; }} key={item.id} className={`${styles.card} ${selectedId === item.id ? styles.selected : ''}`} onKeyDown={(event) => onListKey(event, index, visible.length)} onClick={(event) => chooseItem(item, event)}><span className={styles.cardTop}><span className={styles.category}>{CATEGORIES[item.category] || item.category}</span><span className={item.status === 'RETIRED' ? styles.mutedBadge : styles.badge}>{STATUSES[item.status] || item.status}</span>{item.priority === 'IMPORTANT' && <span className={styles.important}>중요</span>}</span><strong>{item.title}</strong><span className={styles.cardExcerpt}>{item.situation}</span><span className={styles.cardMeta}>{tagText(item) || '태그 없음'} · 수정 {dateText(item.updatedAt)}</span></button>)}</div> : <p className={styles.empty}>조건에 맞는 지침이 없습니다. 상태와 태그 필터를 조정해 보세요.</p>}
      {category === 'HANDOFF' && <section className={styles.legacy}><div className={styles.sectionHeading}><h2>기존 인수인계 · 읽기 전용</h2><span>{legacyItems.length}건</span></div><p>기존 자료의 상태는 새 지침의 “현재 적용” 상태로 분류하지 않습니다.</p>{legacyItems.map((item, index) => <button type="button" className={styles.legacyCard} key={item.id ?? index} onClick={(event) => chooseItem(item, event, true)}><strong>{item.title || item.subject || item.name || `기존 인수인계 ${index + 1}`}</strong><span>{item.statusLabel || '기존 자료 · 상태 미분류'}</span></button>)}</section>}
    </section><section className={styles.detailPane} ref={detailRef} tabIndex={-1} aria-label="지침 상세">{!isOpen ? <div className={styles.placeholder}><span>↗</span><h2>지침을 선택하세요</h2><p>상황과 처리 기준, 댓글과 첨부를 한곳에서 확인할 수 있습니다.</p></div> : <><div className={styles.sectionHeading}><h2>{draft ? (selectedId ? '지침 편집' : '새 지침') : legacy ? '기존 인수인계' : '지침 상세'}</h2><button type="button" className={styles.ghost} onClick={closeDetail}>닫기 <kbd>Esc</kbd></button></div>
      {draft ? <form className={styles.editor} onSubmit={saveDraft}><div className={styles.formRow}><label>제목 *<input required maxLength={160} value={draft.title} onChange={(event) => changeDraft('title', event.target.value)} /></label><label>분류<select value={draft.category} onChange={(event) => changeDraft('category', event.target.value)}>{Object.entries(CATEGORIES).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label></div><div className={styles.formRow}><label>상태<select value={draft.status} onChange={(event) => changeDraft('status', event.target.value)}>{Object.entries(STATUSES).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><label>중요도<select value={draft.priority} onChange={(event) => changeDraft('priority', event.target.value)}>{Object.entries(PRIORITIES).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><label>검토일<input type="date" value={draft.reviewDate || ''} onChange={(event) => changeDraft('reviewDate', event.target.value || null)} /></label></div><div className={styles.tagGrid}>{Object.entries(TAGS).map(([key, label]) => <label key={key}>{label} 태그 <small>쉼표로 구분</small><input value={tagInputs[key]} onChange={(event) => changeTags(key, event.target.value)} placeholder={`${label} 입력`} /></label>)}</div>{[['situation', '상황 *'], ['action', '처리 방법'], ['caution', '주의사항'], ['checklist', '체크리스트']].map(([key, label]) => <label key={key}>{label}<textarea required={key === 'situation'} maxLength={4000} rows={key === 'situation' ? 3 : 4} value={draft[key]} onChange={(event) => changeDraft(key, event.target.value)} /></label>)}<label>연락처<input maxLength={300} value={draft.contact} onChange={(event) => changeDraft('contact', event.target.value)} /></label><p className={styles.helper}>적용 종료는 자료를 삭제하지 않습니다. 댓글·첨부·변경 기록은 그대로 남습니다. 첨부는 먼저 지침을 저장한 뒤 등록할 수 있습니다.</p><div className={styles.formActions}><button type="button" className={styles.ghost} onClick={closeDetail}>취소</button><button type="submit" className={styles.primary} disabled={busy || conflict || draftRevision !== snapshot.revision || (selectedId && !draftDirty)}>{busy ? '저장 중…' : conflict ? '최신 자료 확인 필요' : '지침 저장'}</button></div></form> : legacy ? <div className={styles.readonly}><p className={styles.warning}>기존 자료 · 상태 미분류 · 읽기 전용</p><h3>{legacy.title || legacy.subject || legacy.name || '기존 인수인계'}</h3>{Object.entries(legacy).filter(([key, value]) => !['id', 'readOnly', 'status', 'statusLabel', 'category'].includes(key) && ['string', 'number'].includes(typeof value)).map(([key, value]) => <p key={key}><strong>{key}</strong><br />{String(value)}</p>)}</div> : selected ? <div className={styles.detail}><div className={styles.detailTitle}><div><span className={styles.category}>{CATEGORIES[selected.category]}</span> <span className={selected.status === 'RETIRED' ? styles.mutedBadge : styles.badge}>{STATUSES[selected.status]}</span> {selected.priority === 'IMPORTANT' && <span className={styles.important}>중요</span>}<h3>{selected.title}</h3></div><button type="button" className={styles.ghost} onClick={(event) => openDraft(selected, event)}>편집</button></div><div className={styles.detailMeta}>작성 {actorText(selected.createdBy)} · {dateText(selected.createdAt)} / 수정 {actorText(selected.updatedBy)} · {dateText(selected.updatedAt)} / 검토일 {dateText(selected.reviewDate)}</div><div className={styles.tagLine}>{Object.entries(TAGS).flatMap(([key, label]) => (selected.tags?.[key] || []).map((tag) => <span key={`${key}:${tag}`}>{label} · {tag}</span>))}</div>{[['situation', '상황'], ['action', '처리 방법'], ['caution', '주의사항'], ['checklist', '체크리스트'], ['contact', '연락처']].map(([key, label]) => <section key={key} className={styles.fieldBlock}><h4>{label}</h4><p>{selected[key] || '기록 없음'}</p></section>)}<section className={styles.activity}><h4>댓글 · {selected.comments?.length || 0}</h4>{(selected.comments || []).map((entry) => <div key={entry.id} className={styles.comment}><p>{entry.body}</p><small>{actorText(entry.author)} · {dateText(entry.createdAt)}</small></div>)}<form onSubmit={addComment}><label>댓글 추가<textarea value={comment} onChange={(event) => setComment(event.target.value)} maxLength={2000} rows={3} placeholder="처리 결과나 추가 확인 사항을 남기세요" /></label><button type="submit" className={styles.primary} disabled={busy || conflict || !comment.trim()}>댓글 등록</button></form></section><section className={styles.activity}><h4>첨부 · {selected.attachments?.length || 0}</h4>{(selected.attachments || []).map((entry) => <a key={entry.id} className={styles.attachment} href={`/api/operations-knowledge/attachments?id=${encodeURIComponent(entry.id)}`} target="_blank" rel="noopener noreferrer">{entry.originalName || '첨부파일'} <small>{dateText(entry.createdAt)}</small></a>)}<form onSubmit={upload}><label>파일 추가 <small>PDF, 문서, 이미지, CSV, TXT · 최대 10 MiB</small><input type="file" accept=".jpg,.jpeg,.png,.webp,.pdf,.docx,.xlsx,.csv,.txt" onChange={(event) => setFile(event.target.files?.[0] || null)} /></label><button type="submit" className={styles.ghost} disabled={busy || conflict || !file}>첨부 등록</button></form></section><section className={styles.activity}><h4>변경 이력</h4>{(snapshot.audit || []).filter((entry) => entry.itemId === selected.id).slice().reverse().map((entry, index) => <p className={styles.audit} key={`${entry.revision}:${index}`}>{entry.action} · {actorText(entry.actor)} · {dateText(entry.at)}</p>)}</section></div> : <p className={styles.empty}>자료가 갱신되었습니다. 목록에서 다시 선택하세요.</p>}</>}</section></div>
  </main>;
}
