import { Fragment, useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  validItem,
  farmTotals,
  importItemView,
  importTotalsText,
  importCategoryLabel,
  importTotalKey,
  manualImportReviews,
  messageOrder,
  groupFarmTotalsByCycle,
  matchesCountryOrderScope,
  visibleKakaoMessages,
  kakaoMessagePageSize,
  normalizeFarmName,
  buildFarmSummary,
  formatFarmCardText,
  formatFarmTransferText,
  formatUnitDisplay,
} from '../../lib/importKakaoAdditions';
import { parsePastedKakaoChat } from '../../lib/importKakaoOrderText';
import { importCountryLabel } from '../../lib/importToolsDisplay';

const fields = [
  ['country', '국가'],
  ['group', '품목군'],
  ['week', '차수'],
  ['product', '품종'],
  ['quantity', '수량'],
  ['unit', '단위'],
  ['customer', '업체 / CL'],
  ['farm', '농장'],
];

const groupKey = row => importCategoryLabel(row, { showMissing: true });
const weekKey = row => row.year + '/' + (row.week || '차수 미상');
const importRoom = '수입방';
const requestFilters = ['전체', '추가', '취소', '합계 반영'];
const sourceType = m => m.kind === 'addition' ? '추가' : /취소|삭제되었습니다/.test(m.text) ? '취소' : '검토';
const sourceReference = id => '원문 ' + id.replace(/^archive:/, '').slice(0, 10).toUpperCase();

function ChoiceButtons({ label, values, value, onChange, all }) {
  const [expanded, setExpanded] = useState(false);
  const limit = label === '차수' ? 5 : 6;
  const choices = ['', ...values];
  const compact = choices.slice(0, limit);
  if (value && !compact.includes(value)) compact[compact.length - 1] = value;
  const visible = expanded ? choices : compact;
  return (
    <div
      className="kakao-choices"
      role="group"
      aria-label={label}
      onKeyDown={e => {
        if (!['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
        const buttons = [...e.currentTarget.querySelectorAll('button')];
        const index = buttons.indexOf(document.activeElement);
        if (index < 0) return;
        e.preventDefault();
        const next = e.key === 'Home'
          ? 0
          : e.key === 'End'
            ? buttons.length - 1
            : (index + (['ArrowLeft', 'ArrowUp'].includes(e.key) ? -1 : 1) + buttons.length) % buttons.length;
        buttons[next].focus();
      }}
    >
      <strong>{label}</strong>
      {visible.map(v => (
        <button key={v} type="button" aria-pressed={value === v} onClick={() => onChange(v)}>
          {v || all}
        </button>
      ))}
      {choices.length > limit && (
        <button type="button" className="kakao-more" aria-expanded={expanded} onClick={() => setExpanded(v => !v)}>
          {expanded ? label + ' 접기' : label + ' 더 보기 (' + (choices.length - limit) + ')'}
        </button>
      )}
    </div>
  );
}

const noHiddenMessages = new Set();
function readHiddenMessages(key) {
  const saved = JSON.parse(localStorage.getItem(key) || '[]');
  return new Set(Array.isArray(saved) ? saved.filter(id => typeof id === 'string') : []);
}

function useHiddenMessages(userId) {
  const [hidden, setHidden] = useState(null);
  useEffect(() => {
    if (!userId) return;
    let disposed = false;
    let storageKey = '';
    function onStorage(event) {
      if (event.key !== storageKey) return;
      try {
        setHidden({ userId, key: storageKey, ids: readHiddenMessages(storageKey) });
      } catch {}
    }
    async function load() {
      let ids = noHiddenMessages;
      try {
        const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(userId));
        storageKey = 'nenova.kakao-visibility.v1.' + Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
        ids = readHiddenMessages(storageKey);
      } catch {}
      if (disposed) return;
      setHidden({ userId, key: storageKey, ids });
      if (storageKey) window.addEventListener('storage', onStorage);
    }
    load();
    return () => {
      disposed = true;
      window.removeEventListener('storage', onStorage);
    };
  }, [userId]);
  const current = hidden?.userId === userId ? hidden : null;
  function change(id, hide) {
    if (!current) return false;
    const ids = new Set(current.ids);
    let saved = false;
    if (hide) ids.add(id);
    else ids.delete(id);
    try {
      if (current.key) {
        localStorage.setItem(current.key, JSON.stringify([...ids]));
        saved = true;
      }
    } catch {}
    setHidden({ ...current, ids });
    return saved;
  }
  return { ids: current?.ids || noHiddenMessages, ready: !!current, change };
}

function RecentReview({ orderScope, userId, knownFarms = [] }) {
  const [feed, setFeed] = useState(null);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [loading, setLoading] = useState(true);
  const [edits, setEdits] = useState({});
  const [notice, setNotice] = useState('');
  const [week, setWeek] = useState('');
  const [group, setGroup] = useState('');
  const [farmFilter, setFarmFilter] = useState('');
  const [focus, setFocus] = useState(null);
  const scopeKey = JSON.stringify(orderScope);
  const [lastScopeKey, setLastScopeKey] = useState(scopeKey);
  const [messageLimit, setMessageLimit] = useState(kakaoMessagePageSize);
  const [showAudit, setShowAudit] = useState(false);
  const [auditQuery, setAuditQuery] = useState('');
  const [sourceQuery, setSourceQuery] = useState('');
  const [sourceFilter, setSourceFilter] = useState('전체');
  const [manual, setManual] = useState({});
  const [openEditors, setOpenEditors] = useState({});
  const [toolbarOpen, setToolbarOpen] = useState(false);
  const [showHidden, setShowHidden] = useState(false);

  // Farm copy formatting preferences & direct paste buffer (browser-only, 0 ERP write)
  const [copyFormat, setCopyFormat] = useState('concise');
  const [copyLang, setCopyLang] = useState('ko');
  const [copiedCardKey, setCopiedCardKey] = useState('');
  const [pasteDraft, setPasteDraft] = useState('');
  const [pastedFeed, setPastedFeed] = useState(null);

  const toolbarDetailsId = useId();
  const hiddenMessages = useHiddenMessages(userId);
  const visibilityButton = useRef(null);
  const originalHeading = useRef(null);
  const totalHeading = useRef(null);
  const sourceList = useRef(null);

  if (scopeKey !== lastScopeKey) {
    setLastScopeKey(scopeKey);
    setWeek('');
    setGroup('');
    setFarmFilter('');
    setFocus(null);
    setSourceFilter('전체');
    setSourceQuery('');
    setShowHidden(false);
    setMessageLimit(kakaoMessagePageSize);
  }

  useEffect(() => {
    if (!focus) return;
    const heading = focus.type === 'total' ? originalHeading.current : totalHeading.current;
    heading?.scrollIntoView({ block: 'start' });
    heading?.focus({ preventScroll: true });
    if (focus.type === 'total') {
      const list = sourceList.current;
      const first = list?.querySelector('.kakao-order-message.kakao-linked');
      if (first) list.scrollTop += first.getBoundingClientRect().top - list.getBoundingClientRect().top;
    }
  }, [focus]);

  useEffect(() => {
    const controller = new AbortController();
    let pending = false;
    async function refresh(foreground = false) {
      if (pending) return;
      pending = true;
      if (foreground) {
        setLoading(true);
        setError('');
      }
      try {
        const response = await fetch('/api/import/tools/kakao-additions' + (showAudit ? '?audit=1' : ''), {
          signal: controller.signal,
          cache: 'no-store',
        });
        const body = await response.json();
        if (!response.ok || !Array.isArray(body.messages)) throw Error(body.error || '조회하지 못했습니다.');
        if (!controller.signal.aborted) {
          setFeed(body);
          setError('');
        }
      } catch (failure) {
        if (!controller.signal.aborted) setError(failure.message);
      } finally {
        pending = false;
        if (foreground && !controller.signal.aborted) setLoading(false);
      }
    }
    refresh(true);
    const timer = setInterval(refresh, 60000);
    return () => {
      clearInterval(timer);
      controller.abort();
    };
  }, [retry, showAudit]);

  const activeFeed = pastedFeed || feed;
  const messages = activeFeed?.messages || [];
  const recovered = manualImportReviews(manual, activeFeed);
  const reviews = [...(activeFeed?.review || []), ...recovered];
  const allMessages = [...messages, ...reviews];

  const view = row => {
    const base = importItemView(row, edits[row.key]);
    if (base.farm) {
      return { ...base, farm: normalizeFarmName(base.farm, knownFarms) || base.farm };
    }
    return base;
  };

  const inOrderScope = row => pastedFeed ? true : matchesCountryOrderScope(row, orderScope);
  const allRows = allMessages
    .filter(m => sourceType(m) !== '취소')
    .flatMap(m => m.items.map(view))
    .filter(inOrderScope);

  const nonCancelledScopeRows = allRows.filter(r => !r.cancelled);
  const weeks = [...new Set(nonCancelledScopeRows.map(weekKey))].sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
  const activeWeek = weeks.includes(week) ? week : '';

  const groups = [...new Set(nonCancelledScopeRows.filter(r => !activeWeek || weekKey(r) === activeWeek).map(groupKey))].sort();
  const activeGroup = groups.includes(group) ? group : '';

  const namedFarms = [...new Set(
    nonCancelledScopeRows
      .filter(r => (!activeWeek || weekKey(r) === activeWeek) && (!activeGroup || groupKey(r) === activeGroup))
      .map(r => normalizeFarmName(r.farm, knownFarms))
      .filter(Boolean)
  )].sort((a, b) => a.localeCompare(b, 'ko'));
  const activeFarm = namedFarms.includes(farmFilter) ? farmFilter : '';

  const inScope = row =>
    inOrderScope(row) &&
    (!activeWeek || weekKey(row) === activeWeek) &&
    (!activeGroup || groupKey(row) === activeGroup) &&
    (!activeFarm || normalizeFarmName(row.farm, knownFarms) === activeFarm);

  const rows = allRows.filter(inScope);
  const totals = farmTotals(rows, { knownFarms });
  const invalid = rows.some(r => r.checked && !r.cancelled && (!validItem(r) || !r.unit || !/^\d{1,2}(?:-\d{1,2})?$/.test(r.week)));

  const includedSourceKeys = new Set(invalid ? [] : totals.flatMap(total => total.sourceKeys));
  const includedRows = new Map(rows.filter(row => includedSourceKeys.has(row.key)).map(row => [row.key, row]));

  const selectedTotal = focus?.type === 'total' ? totals.find(t => t.key === focus.key) : null;
  const selectedMessage = focus?.type === 'message' ? allMessages.find(m => m.id === focus.id) : null;
  const sourceKeys = new Set(selectedTotal?.sourceKeys || []);
  const messageKeys = new Set(selectedMessage?.items.map(i => i.key) || []);
  const shownTotals = selectedMessage ? totals.filter(t => t.sourceKeys.some(k => messageKeys.has(k))) : totals;
  const cycleTotals = groupFarmTotalsByCycle(shownTotals);
  const linkedSources = selectedTotal ? allMessages.filter(m => m.items.some(i => sourceKeys.has(i.key))) : [];

  const query = sourceQuery.normalize('NFKC').trim().toLowerCase();
  const matchesCurrentScope = m => (
    (m.kind === 'review' && (!orderScope || pastedFeed || manual[m.id] || m.items.some(i => inOrderScope(view(i))))) ||
    m.items.some(i => inScope(view(i))) ||
    (pastedFeed && (m.memos?.length || m.excludedItems?.length))
  );
  const scopedMessages = allMessages.filter(matchesCurrentScope);
  const hiddenCount = scopedMessages.filter(m => hiddenMessages.ids.has(m.id)).length;
  const linkedIds = new Set(linkedSources.map(m => m.id));
  if (selectedMessage) linkedIds.add(selectedMessage.id);

  const shownMessages = scopedMessages
    .filter(m => linkedIds.has(m.id) || (
      hiddenMessages.ids.has(m.id) === showHidden &&
      (sourceFilter === '전체' || (sourceFilter === '합계 반영'
        ? m.items.some(item => includedSourceKeys.has(item.key))
        : sourceType(m) === sourceFilter)) &&
      (!query || [importRoom, m.time, m.text].some(value => String(value || '').normalize('NFKC').toLowerCase().includes(query)))
    ))
    .sort((a, b) => messageOrder(b.time).localeCompare(messageOrder(a.time)));

  const visibleMessages = visibleKakaoMessages(shownMessages, messageLimit, linkedIds);
  const scopeLabel = orderScope && [
    importCountryLabel(orderScope.country),
    orderScope.year && orderScope.majorWeek ? orderScope.year + '/' + (orderScope.orderWeek || orderScope.majorWeek) + '차' : '',
  ].filter(Boolean).join(' · ');

  // Collect scoped excluded/cancelled items, ignored total lines, and operational memos
  const scopedExcludedItems = useMemo(() => {
    const items = [];
    for (const m of scopedMessages) {
      if (sourceType(m) === '취소') {
        for (const it of m.items || []) {
          items.push({ product: it.product, quantity: it.quantity, unit: it.unit, farm: it.farm, reason: '취소 원문' });
        }
      } else {
        for (const ex of m.excludedItems || []) {
          if (pastedFeed || matchesCountryOrderScope(ex, orderScope)) {
            items.push(ex);
          }
        }
      }
    }
    return items;
  }, [scopedMessages, orderScope, pastedFeed]);

  const scopedIgnoredTotals = useMemo(
    () => scopedMessages.flatMap(m => m.ignoredTotals || []),
    [scopedMessages]
  );

  const scopedMemos = useMemo(
    () => scopedMessages.flatMap(m => m.memos || []),
    [scopedMessages]
  );

  const reviewMessageCount = useMemo(
    () => scopedMessages.filter(m => sourceType(m) === '검토').length,
    [scopedMessages]
  );

  const farmSummary = useMemo(
    () => buildFarmSummary(invalid ? [] : shownTotals, {
      knownFarms,
      excludedItems: scopedExcludedItems,
      ignoredTotals: scopedIgnoredTotals,
      memos: scopedMemos,
      reviewCount: reviewMessageCount,
    }),
    [invalid, shownTotals, knownFarms, scopedExcludedItems, scopedIgnoredTotals, scopedMemos, reviewMessageCount]
  );

  const fullTransferText = useMemo(
    () => formatFarmTransferText(farmSummary, { format: copyFormat, lang: copyLang, memo: true }),
    [farmSummary, copyFormat, copyLang]
  );

  function changeVisibility(message, hide) {
    const persisted = hiddenMessages.change(message.id, hide);
    if (hide && linkedIds.has(message.id)) setFocus(null);
    setNotice((hide ? '원문을 목록에서 숨겼습니다.' : '원문을 다시 표시했습니다.') + (persisted ? '' : ' 이 화면에서만 적용됩니다.'));
    visibilityButton.current?.focus({ preventScroll: true });
  }

  function matchTotal(key) {
    setFocus({ type: 'total', key });
  }

  const update = (key, patch) => {
    setNotice('');
    setFocus(null);
    setEdits(prev => ({ ...prev, [key]: { ...prev[key], ...patch } }));
  };

  function addManual(m) {
    const key = JSON.stringify(['manual', m.id, m.text]);
    setManual(prev => ({
      ...prev,
      [m.id]: {
        ...m,
        kind: 'review',
        reason: '제외 원문에서 수동 검토',
        items: [{ key, year: m.time.match(/^\d{4}/)?.[0] || '', product: '', quantity: '', unit: '', week: '', farm: '', reviewReason: '원문과 대조 후 포함' }],
      },
    }));
    setOpenEditors(previous => ({ ...previous, [m.id]: true }));
    setSourceFilter('전체');
    setSourceQuery('');
    setShowHidden(false);
    setWeek('');
    setGroup('');
    setFarmFilter('');
    setFocus(null);
    setNotice('검토 목록에 가져왔습니다. 품목·수량·단위·차수를 확인한 뒤 합산을 체크하세요.');
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(importTotalsText(groupFarmTotalsByCycle(totals).flatMap(cycle => cycle.rows)));
      setNotice('전달용 합계를 복사했습니다.');
    } catch {
      setNotice('복사할 수 없습니다. 합계 표를 선택해 복사하세요.');
    }
  }

  async function copyFarmTransferAll() {
    if (!fullTransferText) return;
    try {
      await navigator.clipboard.writeText(fullTransferText);
      setCopiedCardKey('__ALL__');
      setNotice(`농장별 전달 양식(${farmSummary.cards.length}개 그룹)을 클립보드에 복사했습니다.`);
    } catch {
      setNotice('복사할 수 없습니다. 아래 미리보기 문구를 직접 선택해 복사하세요.');
    }
  }

  async function copySingleFarm(card) {
    const text = formatFarmCardText(card, { format: copyFormat, lang: copyLang, memo: true });
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopiedCardKey(card.key);
      setNotice(`[${card.title}] 전달용 합계를 복사했습니다.`);
    } catch {
      setNotice('복사할 수 없습니다. 미리보기 문구를 직접 선택해 복사하세요.');
    }
  }

  function applyPastedChat() {
    const trimmed = pasteDraft.trim();
    if (!trimmed) {
      setNotice('분석할 카톡 내용을 먼저 붙여넣으세요.');
      return;
    }
    const defaultYear = String(orderScope?.year || new Date().getFullYear());
    const defaultWeek = orderScope?.orderWeek || (orderScope?.majorWeek ? `${orderScope.majorWeek}-01` : '01-01');
    const defaultCountry = orderScope?.country ? importCountryLabel(orderScope.country) : '';
    const parsed = parsePastedKakaoChat(trimmed, {
      year: defaultYear,
      week: defaultWeek,
      country: defaultCountry,
      knownFarms,
    });
    setPastedFeed(parsed);
    setWeek('');
    setGroup('');
    setFarmFilter('');
    setFocus(null);
    setCopiedCardKey('');
    setNotice(`붙여넣은 카톡 원문을 분석했습니다 (발주 ${parsed.messages.length}건 · 검토 ${parsed.review.length}건 · 잡담/헤더 ${parsed.noise}줄 제거).`);
  }

  function resetPastedChat() {
    setPastedFeed(null);
    setPasteDraft('');
    setWeek('');
    setGroup('');
    setFarmFilter('');
    setFocus(null);
    setCopiedCardKey('');
    setNotice('수입방 자동 수집 원문 보기로 돌아왔습니다.');
  }

  function renderTotal(r) {
    const picked = selectedTotal?.key === r.key;
    const selectedKeys = selectedMessage && new Set(r.sourceKeys);
    const sourceAmounts = selectedMessage?.items
      .filter(i => selectedKeys.has(i.key))
      .map(i => {
        const row = view(i);
        return row.quantity + ' ' + row.unit;
      });
    const scopeText = r.farm ? `${groupKey(r)} · ${r.farm}` : groupKey(r);
    return (
      <tr key={r.key} className={picked || selectedMessage ? 'kakao-linked' : ''}>
        <td className="kakao-row-scope">{groupKey(r)}</td>
        <td>
          <button type="button" className="kakao-match-total" aria-pressed={picked} onClick={() => matchTotal(r.key)}>
            {r.farm ? `[${r.farm}] ${r.product}` : r.product} <small>원문 {r.sourceKeys.length}행 보기</small>
          </button>
          {picked && <small className="kakao-source-reference">{linkedSources.map(m => sourceReference(m.id)).join(' · ')}</small>}
        </td>
        <td className="kakao-quantity">
          {r.quantity} {r.unit}
          {sourceAmounts?.length > 0 && <small className="kakao-source-reference">이 원문 {sourceAmounts.join(' + ')}</small>}
        </td>
        <td title={scopeText}>
          {r.notes || (!r.requests && !r.revisions && <span className="kakao-no-notes" role="img" aria-label="업체 미기재">–</span>)}
          {r.revisions && <small className="kakao-revision-tag">{r.revisions}</small>}
          {r.requests && <small>요청: {r.requests}</small>}
        </td>
      </tr>
    );
  }

  function renderMessage(m) {
    const visible = m.kind === 'review'
      ? m.items.filter(i => manual[m.id] || inOrderScope(view(i)))
      : m.items.filter(i => inScope(view(i)));
    const linked = selectedMessage?.id === m.id || m.items.some(i => sourceKeys.has(i.key));
    const contributions = m.items.map(item => includedRows.get(item.key)).filter(Boolean);
    const type = sourceType(m);
    const open = !!openEditors[m.id];
    const hidden = hiddenMessages.ids.has(m.id);
    return (
      <article key={m.id} data-source-id={m.id} data-source-kind={m.kind} className={'kakao-order-message ' + (linked ? 'kakao-linked' : '')}>
        <div className="kakao-source-meta">
          <strong>{pastedFeed ? '붙여넣기' : importRoom}</strong>
          <span>{m.time}</span>
          <span>{type === '추가' ? '추가 발주' : type === '취소' ? '취소 요청' : '검토 필요'}</span>
          {contributions.length > 0 && <span className="kakao-source-included"><span aria-hidden="true">✓ </span>합계 반영</span>}
          {linked && hidden && !showHidden && <span className="kakao-temporary-source">숨긴 원문 · 매칭으로 표시</span>}
          {linked && <strong className="kakao-source-reference">{sourceReference(m.id)}</strong>}
        </div>
        {contributions.length > 0 && (
          <div className="kakao-source-contributions" aria-label="이 원문에서 합산한 품목">
            <ul>
              {contributions.slice(0, 3).map(row => (
                <li key={row.key}>
                  {row.farm && `[${row.farm}] `}{row.product} {row.quantity} {row.unit}{row.customer && ' · ' + row.customer}
                </li>
              ))}
            </ul>
            {contributions.length > 3 && (
              <details>
                <summary>반영 품목 {contributions.length - 3}개 더 보기</summary>
                <ul>
                  {contributions.slice(3).map(row => (
                    <li key={row.key}>
                      {row.farm && `[${row.farm}] `}{row.product} {row.quantity} {row.unit}{row.customer && ' · ' + row.customer}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        )}
        <pre className="kakao-source-body">{m.text}</pre>
        <div className="kakao-source-actions">
          {visible.length > 0 && type !== '취소' && (
            <button type="button" className="kakao-match-source" aria-pressed={selectedMessage?.id === m.id} onClick={() => setFocus({ type: 'message', id: m.id })}>
              이 원문의 합계 보기
            </button>
          )}
          {(visible.length > 0 || m.reason) && (
            <button type="button" className="kakao-edit-source" aria-expanded={open} onClick={() => setOpenEditors(previous => ({ ...previous, [m.id]: !open }))}>
              {open ? '품목·수량 접기' : m.kind === 'review' ? '발주 내용 검토' : '품목·수량 확인'}
            </button>
          )}
          {hiddenMessages.ready && !pastedFeed && (
            <button type="button" className="kakao-visibility-action" aria-label={hidden ? '숨긴 원문 다시 표시' : '정리: 원문 숨기기'} onClick={() => changeVisibility(m, !hidden)}>
              {hidden ? '다시 표시' : '정리'}
            </button>
          )}
        </div>
        {open && (
          <div>
            {m.reason && <p className="kakao-review-reason">{m.reason} · {type === '취소' ? '취소 수량은 합산 제외' : '확인 전 합계 제외'}</p>}
            {m.retained?.map((r, i) => (
              <p key={i}>기존 주문 유지: {r.product} {r.quantity} {r.unit} · 새 추가 수량이 아니므로 합산하지 않습니다.</p>
            ))}
            {visible.map(base => {
              const row = view(base);
              const isRowDisabled = type === '취소';
              return (
                <fieldset key={row.key} disabled={isRowDisabled} className={sourceKeys.has(row.key) ? 'kakao-linked' : ''}>
                  <legend>
                    <label>
                      <input
                        type="checkbox"
                        disabled={isRowDisabled}
                        checked={!isRowDisabled && !!row.checked}
                        onChange={e => update(row.key, { checked: e.target.checked })}
                      />{' '}
                      {type === '취소' || row.cancelled ? '취소·제외 품종' : m.kind === 'review' ? '검토 후 합산' : '합산'} · {row.product || '품종 확인'}
                    </label>
                  </legend>
                  {fields.map(([key, label]) => (
                    <label key={key}>
                      {label}
                      <input value={row[key] || ''} onChange={e => update(row.key, { [key]: e.target.value })} />
                    </label>
                  ))}
                  <small>
                    {row.checked ? '합계에 포함' : row.reviewReason || '합계에서 제외'}
                    {row.revisionNote && ' · ' + row.revisionNote}
                    {row.note && ' · 요청: ' + row.note}
                  </small>
                  {row.checked && validItem(row) && (
                    <button type="button" onClick={() => matchTotal(importTotalKey(row, knownFarms))}>
                      이 품종 원문 모아보기
                    </button>
                  )}
                </fieldset>
              );
            })}
            {m.unparsed?.length > 0 && <p>해석하지 못한 수량 행: {m.unparsed.join(' / ')}</p>}
            {manual[m.id] && (
              <button
                type="button"
                onClick={() =>
                  setManual(prev => ({
                    ...prev,
                    [m.id]: {
                      ...prev[m.id],
                      items: [
                        ...prev[m.id].items,
                        {
                          key: JSON.stringify(['manual', m.id, m.text, prev[m.id].items.length]),
                          year: m.time.match(/^\d{4}/)?.[0] || '',
                          product: '',
                          quantity: '',
                          unit: '',
                          week: '',
                          farm: '',
                          reviewReason: '원문과 대조 후 포함',
                        },
                      ],
                    },
                  }))
                }
              >
                품목 행 추가
              </button>
            )}
          </div>
        )}
      </article>
    );
  }

  const stats = activeFeed?.stats;
  const accounted = stats && stats.selected + stats.review + stats.excluded + stats.duplicates;
  const auditRows = (activeFeed?.audit || []).filter(m => !auditQuery || m.text.toLowerCase().includes(auditQuery.toLowerCase()));
  const copyDisabled = !pastedFeed && (loading || !!error);

  return (
    <>
      <header className="kakao-toolbar">
        <div className="kakao-toolbar-main">
          <h3>
            <button type="button" className="kakao-toolbar-toggle" aria-expanded={toolbarOpen} aria-controls={toolbarDetailsId} onClick={() => setToolbarOpen(open => !open)}>
              수입방 카톡 추가 발주 <span aria-hidden="true">{toolbarOpen ? '▴' : '▾'}</span>
            </button>
          </h3>
          <div className="kakao-toolbar-buttons">
            {pastedFeed && (
              <button type="button" className="kakao-paste-reset" onClick={resetPastedChat}>
                수입방 자동 원문 복귀
              </button>
            )}
            <button type="button" className="kakao-refresh" disabled={loading} onClick={() => { setPastedFeed(null); setLoading(true); setRetry(v => v + 1); }}>
              {loading ? '조회 중…' : '새로 조회'}
            </button>
          </div>
        </div>
        {scopeLabel && !pastedFeed && <p className="kakao-order-scope">왼쪽 선택 반영 · {scopeLabel}</p>}
        {pastedFeed && <p className="kakao-order-scope">직접 붙여넣은 카톡 대화 분류 결과 · 브라우저 전용 (ERP·시트 저장 없음)</p>}
        <div id={toolbarDetailsId} hidden={!toolbarOpen}>
          <p>발주가 있는 최근 2일 · 최신 카톡순 · 1분마다 갱신</p>
          {activeFeed && !pastedFeed && (
            <p>
              {activeFeed.orderDays?.length ? '발주일: ' + activeFeed.orderDays.join(' · ') : '합산 가능한 발주일 없음'}
              {activeFeed.latest && ' · 최근 수집 원문 ' + activeFeed.latest}
            </p>
          )}
          {activeFeed?.reviewThrough && <p>선택 발주일 이후 {activeFeed.reviewThrough}까지의 취소·변경도 확인합니다.</p>}
          {stats && (
            <p className="kakao-counts">
              카톡 {stats.scanned}건 분석 · 추가 발주 {stats.selected}건 · 검토 {stats.review}건 · 일반 대화 제외 {stats.excluded}건 · 중복 제외 {stats.duplicates}건
            </p>
          )}
          <p>차수·품목군·농장 버튼으로 범위를 좁히고 원문과 합계를 상호 대조하세요. 수정 및 붙여넣기 분류는 이 화면에서만 유지됩니다.</p>
        </div>
        {((week && !activeWeek) || (group && !activeGroup) || (farmFilter && !activeFarm)) && (
          <p role="status">선택한 필터가 현재 자료에 없어 전체 범위를 표시합니다. 버튼에서 다시 선택하세요.</p>
        )}
        <span role="status" className="kakao-live-notice">{notice}</span>
      </header>

      <div className="kakao-columns">
        <section className="kakao-totals" aria-label="농장 전달용 자동 합계">
          <div className="kakao-totals-head">
            <h4 ref={totalHeading} tabIndex={-1}>농장 전달용 자동 합계</h4>
          </div>

          <details className="kakao-paste-panel">
            <summary>카톡 대화 직접 붙여넣기 · 자동 분류 {pastedFeed ? '(적용 중)' : ''}</summary>
            <p className="kakao-paste-guide">
              PC·모바일 카톡에서 복사한 대화(`[이름] [오전 10:15]`, 농장 헤더, `합계` 줄, `3B -&gt; 5B`, 취소·메모 포함)를 붙여넣으면 노이즈와 중복 합계를 제거하고 농장별로 정돈합니다.
            </p>
            <textarea
              rows={5}
              aria-label="카톡 발주 원문 붙여넣기"
              placeholder={'[정재훈] [오전 9:25] [콜롬비아] 엘리떼 농장 47-2 발주 추가\n몬디알 Select 60cm 5FB\n프리덤 50cm * 3HB\n합계 8박스\n수요일 선적분 부탁드립니다'}
              value={pasteDraft}
              onChange={e => setPasteDraft(e.target.value)}
            />
            <div className="kakao-paste-actions">
              <button type="button" className="kakao-primary-btn" onClick={applyPastedChat}>붙여넣기 분류 실행</button>
              {pastedFeed && <button type="button" onClick={resetPastedChat}>초기화 · 자동 수집 원문 보기</button>}
            </div>
          </details>

          {loading && !pastedFeed && (
            <p className="kakao-feed-status" role="status">{feed ? '자동 합계를 갱신하는 중…' : '농장 전달용 합계를 불러오는 중…'}</p>
          )}
          {error && !loading && !pastedFeed && (
            <p className="kakao-feed-status" role="alert">{feed ? '자동 합계 갱신 실패 · 이전 합계 표시 중' : '자동 합계를 불러오지 못했습니다.'} {error}</p>
          )}

          {activeFeed && (
            <>
              <div className="kakao-kpi-bar" role="region" aria-label="농장 전달용 요약 지표">
                <div className="kakao-kpi-item">
                  <span className="kakao-kpi-label">분류 농장</span>
                  <strong className="kakao-kpi-value">
                    {farmSummary.farmCount > 0
                      ? `${farmSummary.farmCount}곳${farmSummary.unassignedCount > 0 ? ` · 미지정 ${farmSummary.unassignedCount}` : ''}`
                      : farmSummary.unassignedCount > 0
                        ? `미지정 ${farmSummary.unassignedCount}그룹`
                        : '0곳'}
                  </strong>
                </div>
                <div className="kakao-kpi-item">
                  <span className="kakao-kpi-label">합산 품목</span>
                  <strong className="kakao-kpi-value">{farmSummary.itemCount}종</strong>
                </div>
                <div className="kakao-kpi-item kakao-kpi-wide">
                  <span className="kakao-kpi-label">단위별 총 수량</span>
                  <strong className="kakao-kpi-value">{farmSummary.units.totalLine || '0'}</strong>
                </div>
                <div className="kakao-kpi-item">
                  <span className="kakao-kpi-label">제외 · 확인필요</span>
                  <strong className="kakao-kpi-value">
                    제외 {scopedExcludedItems.length} · 확인 {reviewMessageCount + farmSummary.memos.length}
                  </strong>
                </div>
              </div>

              <ChoiceButtons
                label="차수"
                all="전체 차수"
                values={weeks}
                value={activeWeek}
                onChange={v => { setWeek(v); setGroup(''); setFarmFilter(''); setFocus(null); setMessageLimit(kakaoMessagePageSize); }}
              />
              <ChoiceButtons
                label="품목군"
                all="전체 품목군"
                values={groups}
                value={activeGroup}
                onChange={v => { setGroup(v); setFarmFilter(''); setFocus(null); setMessageLimit(kakaoMessagePageSize); }}
              />
              {namedFarms.length > 0 && (
                <ChoiceButtons
                  label="농장"
                  all="전체 농장"
                  values={namedFarms}
                  value={activeFarm}
                  onChange={v => { setFarmFilter(v); setFocus(null); setMessageLimit(kakaoMessagePageSize); }}
                />
              )}
            </>
          )}

          {selectedMessage && (
            <p className="kakao-match-notice">
              {sourceReference(selectedMessage.id)} · 선택 원문이 포함된 전체 합계 {shownTotals.length}행{' '}
              <button type="button" onClick={() => setFocus(null)}>매칭 해제</button>
            </p>
          )}
          {invalid && <p role="alert">합산할 행의 차수, 품종, 양수 수량과 단위를 확인하세요.</p>}

          {totals.length > 0 && !invalid ? (
            <>
              <div className="kakao-farm-board" aria-label="농장별 전달 정돈 카드">
                <div className="kakao-copy-toolbar">
                  <div className="kakao-copy-toggles">
                    <div role="group" aria-label="전달 포맷 선택" className="kakao-segmented">
                      <button type="button" aria-pressed={copyFormat === 'concise'} onClick={() => setCopyFormat('concise')}>간결 전달용</button>
                      <button type="button" aria-pressed={copyFormat === 'detailed'} onClick={() => setCopyFormat('detailed')}>상세(업체·변경)</button>
                    </div>
                    <div role="group" aria-label="단위 언어 선택" className="kakao-segmented">
                      <button type="button" aria-pressed={copyLang === 'ko'} onClick={() => setCopyLang('ko')}>국문 단위</button>
                      <button type="button" aria-pressed={copyLang === 'en'} onClick={() => setCopyLang('en')}>영문(Farm)</button>
                    </div>
                  </div>
                  <button type="button" className="kakao-primary-btn" disabled={copyDisabled} onClick={copyFarmTransferAll}>
                    {copiedCardKey === '__ALL__' ? '전체 전달 양식 복사됨' : '농장 전달용 전체 복사'}
                  </button>
                </div>

                <details className="kakao-preview-box">
                  <summary>복사될 농장 전달 문구 미리보기 ({farmSummary.cards.length}개 그룹)</summary>
                  <pre className="kakao-copy-preview">{fullTransferText}</pre>
                </details>

                <div className="kakao-farm-card-list">
                  {farmSummary.cards.map(card => {
                    const cardSubtotal = (copyLang === 'en' ? card.unitsEn : card.units).totalLine;
                    return (
                      <article key={card.key} className="kakao-farm-card" aria-label={card.title}>
                        <header className="kakao-farm-card-head">
                          <div className="kakao-farm-card-heading">
                            <strong>{card.title}</strong>
                            <span className="kakao-farm-badge">{card.cycle}</span>
                            {card.groups.length > 0 && card.isNamedFarm && (
                              <span className="kakao-farm-group-tag">{card.groups.join(' · ')}</span>
                            )}
                          </div>
                          <div className="kakao-farm-card-right">
                            <span className="kakao-farm-subtotal">{cardSubtotal}</span>
                            <button
                              type="button"
                              className="kakao-copy-farm-btn"
                              disabled={copyDisabled}
                              onClick={() => copySingleFarm(card)}
                            >
                              {copiedCardKey === card.key ? '복사됨' : '이 농장 복사'}
                            </button>
                          </div>
                        </header>
                        <div className="kakao-farm-table-wrap">
                          <table className="kakao-farm-card-table">
                            <thead>
                              <tr>
                                <th scope="col">번호</th>
                                <th scope="col">품목명</th>
                                <th scope="col">규격 · 포장</th>
                                <th scope="col">수량</th>
                                <th scope="col">비고</th>
                              </tr>
                            </thead>
                            <tbody>
                              {card.items.map((item, idx) => {
                                const isPicked = selectedTotal && item.totalKeys.includes(selectedTotal.key);
                                const displayName = item.spec ? item.baseName : item.product;
                                const specText = [item.spec, item.packSpec].filter(Boolean).join(' · ');
                                const remarks = [
                                  item.revisions,
                                  copyFormat === 'detailed' ? item.customers : '',
                                  ...item.requestNotes,
                                ].filter(Boolean).join(' · ');
                                return (
                                  <tr key={item.key} className={isPicked ? 'kakao-linked' : ''}>
                                    <td className="kakao-col-num">{idx + 1}</td>
                                    <td>
                                      <button
                                        type="button"
                                        className="kakao-farm-item-btn"
                                        aria-pressed={Boolean(isPicked)}
                                        onClick={() => matchTotal(item.key)}
                                      >
                                        {displayName}
                                      </button>
                                    </td>
                                    <td className="kakao-col-spec">{specText || '–'}</td>
                                    <td className="kakao-col-qty">{formatUnitDisplay(item.quantity, item.unit, copyLang)}</td>
                                    <td className="kakao-col-note">{remarks || '–'}</td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                        {card.memos.length > 0 && (
                          <p className="kakao-farm-memo">
                            <strong>전달 메모</strong> {card.memos.join(' / ')}
                          </p>
                        )}
                      </article>
                    );
                  })}
                </div>
              </div>

              {(scopedExcludedItems.length > 0 || scopedIgnoredTotals.length > 0 || farmSummary.memos.some(m => !m.attached)) && (
                <div className="kakao-separated-notes" aria-label="제외 항목 및 확인 필요 메모">
                  {scopedExcludedItems.length > 0 && (
                    <div className="kakao-note-block kakao-note-excluded">
                      <strong>합계 제외 · 취소 항목 ({scopedExcludedItems.length}건)</strong>
                      <ul>
                        {scopedExcludedItems.map((ex, i) => (
                          <li key={i}>
                            {ex.farm ? `[${ex.farm}] ` : ''}{ex.product}
                            {ex.quantity && ex.quantity !== '0' ? ` ${ex.quantity}${ex.unit || ''}` : ''} — {ex.reason}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {scopedIgnoredTotals.length > 0 && (
                    <p className="kakao-ignored-totals">
                      원문 내 요약·합계 줄 {scopedIgnoredTotals.length}건(`{scopedIgnoredTotals.map(t => t.text).slice(0, 3).join('`, `')}`)은 중복 합산 방지를 위해 자동 제외했습니다.
                    </p>
                  )}
                  {farmSummary.memos.some(m => !m.attached) && (
                    <div className="kakao-note-block kakao-note-memo">
                      <strong>특이사항 · 확인 필요 메모</strong>
                      <ul>
                        {farmSummary.memos.filter(m => !m.attached).map((m, i) => (
                          <li key={i}>{m.farm ? `[${m.farm}] ` : ''}{m.text}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}

              <h5 className="kakao-ledger-subheading">차수 · 원문 대조 원장</h5>
              <div className="kakao-table">
                <table>
                  <thead>
                    <tr>
                      {['국가 · 품목군', '품종 / 원문 대조', '수량', '비고 (업체·수량)'].map(v => <th key={v}>{v}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {cycleTotals.map(cycle => (
                      <Fragment key={cycle.key}>
                        <tr className="kakao-cycle-heading"><td colSpan={4}><h5>{cycle.label}</h5></td></tr>
                        {cycle.rows.map(renderTotal)}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
              <button type="button" disabled={copyDisabled} onClick={copy}>농장 전달용 복사</button>
              <small>선택한 차수·품목군 전체 합계를 한 줄 원장 형식으로 복사합니다.</small>
            </>
          ) : (
            !invalid && activeFeed && (!loading || pastedFeed) && (!error || pastedFeed) && (
              <>
                <p role="status">현재 범위에 자동 합산할 추가 발주가 없습니다. 검토 필요 목록을 확인하세요.</p>
                {(scopedExcludedItems.length > 0 || scopedMemos.length > 0) && (
                  <div className="kakao-separated-notes">
                    {scopedExcludedItems.length > 0 && (
                      <p className="kakao-ignored-totals">취소·제외 처리된 항목 {scopedExcludedItems.length}건은 합계에 반영되지 않았습니다.</p>
                    )}
                    {scopedMemos.length > 0 && (
                      <div className="kakao-note-block kakao-note-memo">
                        <strong>특이사항 · 확인 필요 메모</strong>
                        <ul>{scopedMemos.map((m, i) => <li key={i}>{m.farm ? `[${m.farm}] ` : ''}{m.text}</li>)}</ul>
                      </div>
                    )}
                  </div>
                )}
              </>
            )
          )}
        </section>

        <section className="kakao-originals" aria-label="선별된 카톡 원문">
          <h4 ref={originalHeading} tabIndex={-1}>카톡 추가·취소 요청</h4>
          {loading && !pastedFeed && (
            <p className="kakao-feed-status" role="status">{feed ? '카톡 원문을 갱신하는 중…' : '수입방 카톡 원문을 불러오는 중…'}</p>
          )}
          {error && !loading && !pastedFeed && (
            <p className="kakao-feed-status" role="alert">{feed ? '카톡 원문 갱신 실패 · 이전 원문 표시 중' : '수입방 카톡 원문을 불러오지 못했습니다.'} {error}</p>
          )}
          {activeFeed && (
            <>
              <p className="kakao-source-period">
                {pastedFeed ? '직접 붙여넣은 카톡 원문' : (activeFeed?.orderDays?.length ? activeFeed.orderDays.join(' · ') : '최근 발주일') + ' · 수입방'}
              </p>
              <input
                type="search"
                aria-label="카톡 원문 검색"
                placeholder="방·시각·내용 검색"
                value={sourceQuery}
                onChange={e => { setSourceQuery(e.target.value); setMessageLimit(kakaoMessagePageSize); }}
              />
              <div className="kakao-source-controls" role="group" aria-label="카톡 요청 유형">
                {requestFilters.map(type => (
                  <button key={type} type="button" aria-pressed={sourceFilter === type} onClick={() => { setSourceFilter(type); setMessageLimit(kakaoMessagePageSize); }}>
                    {type}
                  </button>
                ))}
                <span role="status">최신순 · {visibleMessages.length} / {shownMessages.length}건</span>
              </div>
              {hiddenMessages.ready && !pastedFeed && (
                <button
                  ref={visibilityButton}
                  type="button"
                  className="kakao-hidden-toggle"
                  aria-pressed={showHidden}
                  onClick={() => { setShowHidden(show => !show); setFocus(null); setSourceQuery(''); setSourceFilter('전체'); setMessageLimit(kakaoMessagePageSize); }}
                >
                  숨긴 원문 {hiddenCount}건
                </button>
              )}
              {showHidden && <p className="kakao-hidden-note">이 브라우저의 현재 계정에서만 목록을 정리합니다. 숨긴 원문도 합계에 반영됩니다.</p>}
              {selectedTotal && (
                <p className="kakao-match-notice">
                  {selectedTotal.product} {selectedTotal.quantity} {selectedTotal.unit}의 근거 원문{' '}
                  <button type="button" onClick={() => setFocus(null)}>매칭 해제</button>
                </p>
              )}
              <div className="kakao-source-list" role="region" aria-label="카톡 요청 목록" tabIndex={0} ref={sourceList}>
                {visibleMessages.map(renderMessage)}
                {visibleMessages.length < shownMessages.length && (
                  <button type="button" className="kakao-more-sources" onClick={() => setMessageLimit(n => n + kakaoMessagePageSize)}>
                    카톡 원문 {Math.min(kakaoMessagePageSize, shownMessages.length - visibleMessages.length)}건 더 보기
                  </button>
                )}
                {activeFeed && !shownMessages.length && (!loading || pastedFeed) && (!error || pastedFeed) && (
                  <p>{showHidden ? '조건에 맞는 숨긴 카톡 원문이 없습니다.' : '표시할 카톡 요청이 없습니다.'}</p>
                )}
              </div>
              <details className="kakao-audit" onToggle={e => setShowAudit(e.currentTarget.open)}>
                <summary>누락 확인 · 제외 원문 대조</summary>
                <p>{stats ? `수집 ${stats.scanned}건 = 발주·검토·제외·중복 ${accounted}건 (${stats.scanned === accounted ? '분류 건수 일치' : '분류 건수 불일치'})` : ''}</p>
                <p>이 대조는 nenovakakao가 보관한 수입방 원문 기준입니다. 카톡방 전체의 수집 누락 여부는 확인되지 않았습니다. 카톡방의 최근 메시지 시각·본문을 위 수집 시각과 대조하고, 사진 속 주문은 별도로 확인하세요.</p>
                <label>제외 원문 검색<input value={auditQuery} onChange={e => setAuditQuery(e.target.value)} placeholder="품목명 또는 수량" /></label>
                {showAudit && !pastedFeed && !activeFeed?.audit && !error && <p>제외 원문을 불러오는 중…</p>}
                {auditRows.map(m => (
                  <details key={m.id} data-audit-id={m.id}>
                    <summary>{m.time} · {m.quantityCandidate ? '수량 포함 · ' : ''}{m.reason}</summary>
                    <blockquote>{m.text}</blockquote>
                    {m.duplicateOf ? (
                      <p>중복 원본 요청: {m.duplicateOf}</p>
                    ) : (
                      <button type="button" disabled={!!manual[m.id]} onClick={() => addManual(m)}>
                        {manual[m.id] ? '검토로 가져옴' : '발주로 검토'}
                      </button>
                    )}
                  </details>
                ))}
              </details>
            </>
          )}
        </section>
      </div>
    </>
  );
}

export default function KakaoAdditions({ orderScope, userId, knownFarms = [] }) {
  return (
    <aside className="kakao-additions" aria-label="수입방 추가 발주">
      <RecentReview orderScope={orderScope} userId={userId} knownFarms={knownFarms} />
      <style jsx global>{`
        .kakao-additions {
          min-width: 0;
          color: #0f172a;
          align-self: start;
          font-family: 'Pretendard Variable', 'Pretendard', -apple-system, BlinkMacSystemFont, 'Malgun Gothic', '맑은 고딕', 'Segoe UI', sans-serif;
          font-size: 14px;
          line-height: 1.5;
          font-variant-numeric: tabular-nums;
        }
        .kakao-toolbar,
        .kakao-originals,
        .kakao-totals {
          padding: 14px;
          border: 1px solid #cbd5e1;
          border-radius: 10px;
          background: #f8fafc;
          min-width: 0;
        }
        .kakao-toolbar {
          margin-bottom: 10px;
          padding: 8px 12px;
          background: #ffffff;
        }
        .kakao-toolbar-main {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
          align-items: center;
          justify-content: space-between;
        }
        .kakao-toolbar-buttons {
          display: flex;
          gap: 6px;
          flex-wrap: wrap;
          align-items: center;
        }
        .kakao-additions .kakao-toolbar-main h3 {
          margin: 0;
          font-size: 15px;
        }
        .kakao-additions .kakao-toolbar-main button {
          padding: 5px 10px;
          font-size: 13.5px;
        }
        .kakao-toolbar-main .kakao-toolbar-toggle {
          background: transparent;
          border-color: transparent;
          font-weight: 700;
          color: #0f172a;
          padding-left: 2px;
        }
        .kakao-toolbar .kakao-order-scope {
          margin: 4px 0 2px;
          font-size: 12.5px;
          color: #1e3a8a;
          font-weight: 700;
        }
        .kakao-live-notice {
          display: block;
          font-size: 13px;
          color: #1e40af;
          font-weight: 600;
        }
        .kakao-columns {
          display: grid;
          grid-template-columns: minmax(0, 1.15fr) minmax(0, 1fr);
          gap: 12px;
          align-items: start;
        }
        .kakao-additions h3,
        .kakao-additions h4 {
          margin: 0 0 10px;
          color: #0f172a;
        }
        .kakao-totals-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
        }
        .kakao-additions p {
          line-height: 1.5;
          margin: 8px 0;
          font-size: 13.5px;
        }
        .kakao-additions button {
          font: inherit;
          font-size: 13.5px;
          color: #1e293b;
          background: #ffffff;
          border: 1px solid #cbd5e1;
          border-radius: 6px;
          padding: 6px 10px;
          cursor: pointer;
          font-variant-numeric: tabular-nums;
        }
        .kakao-additions button:hover:not(:disabled) {
          background: #f1f5f9;
          border-color: #94a3b8;
        }
        .kakao-additions button:disabled {
          opacity: 0.5;
          cursor: default;
        }
        .kakao-additions button[aria-pressed='true'] {
          background: #1d4ed8;
          border-color: #1d4ed8;
          color: #ffffff;
          font-weight: 600;
        }
        .kakao-additions .kakao-primary-btn {
          background: #1e3a8a;
          border-color: #1e3a8a;
          color: #ffffff;
          font-weight: 600;
        }
        .kakao-additions .kakao-primary-btn:hover:not(:disabled) {
          background: #1d4ed8;
          border-color: #1d4ed8;
        }
        .kakao-additions :focus-visible {
          outline: 3px solid #d97706;
          outline-offset: 2px;
        }
        .kakao-paste-panel {
          margin: 0 0 12px !important;
          background: #ffffff !important;
          border: 1px solid #cbd5e1 !important;
        }
        .kakao-paste-panel summary {
          font-size: 13.5px;
          font-weight: 600;
          color: #1e293b;
        }
        .kakao-paste-guide {
          color: #475569;
          font-size: 12.5px !important;
          margin: 6px 0 8px !important;
        }
        .kakao-paste-panel textarea {
          width: 100%;
          box-sizing: border-box;
          padding: 8px 10px;
          border: 1px solid #cbd5e1;
          border-radius: 6px;
          font-family: 'Pretendard Variable', 'Pretendard', -apple-system, BlinkMacSystemFont, 'Malgun Gothic', '맑은 고딕', 'Segoe UI', sans-serif;
          font-size: 13.5px;
          line-height: 1.5;
          color: #0f172a;
          resize: vertical;
          font-variant-numeric: tabular-nums;
        }
        .kakao-paste-actions {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
          margin-top: 8px;
        }
        .kakao-kpi-bar {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 8px;
          margin-bottom: 12px;
          padding: 10px 12px;
          background: #ffffff;
          border: 1px solid #cbd5e1;
          border-radius: 8px;
        }
        @media (max-width: 1450px) {
          .kakao-kpi-bar {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
        }
        .kakao-kpi-item {
          display: flex;
          flex-direction: column;
          gap: 2px;
          min-width: 0;
        }
        .kakao-kpi-label {
          font-size: 12.5px;
          color: #475569;
          font-weight: 500;
        }
        .kakao-kpi-value {
          font-size: 14px;
          color: #0f172a;
          font-weight: 700;
          font-variant-numeric: tabular-nums;
          overflow-wrap: anywhere;
        }
        .kakao-choices {
          display: flex;
          gap: 6px;
          flex-wrap: wrap;
          margin-bottom: 10px;
        }
        .kakao-choices strong {
          flex-basis: 100%;
          font-size: 13px;
          color: #334155;
        }
        .kakao-choices button {
          font-size: 13.5px;
          padding: 5px 8px;
          line-height: 1.3;
        }
        .kakao-choices .kakao-more {
          border-style: dashed;
        }
        .kakao-farm-board {
          margin-bottom: 14px;
        }
        .kakao-copy-toolbar {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 8px;
          padding: 8px 10px;
          background: #ffffff;
          border: 1px solid #cbd5e1;
          border-radius: 8px;
        }
        .kakao-copy-toggles {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          align-items: center;
        }
        .kakao-segmented {
          display: inline-flex;
          gap: 4px;
          flex-wrap: wrap;
        }
        .kakao-segmented button {
          padding: 4px 8px;
          font-size: 13px;
        }
        .kakao-preview-box {
          margin: 0 0 10px !important;
          background: #ffffff !important;
          border: 1px solid #cbd5e1 !important;
        }
        .kakao-preview-box summary {
          font-size: 13px;
          font-weight: 600;
          color: #334155;
        }
        .kakao-copy-preview {
          margin: 8px 0 0;
          padding: 10px 12px;
          background: #f8fafc;
          border: 1px solid #e2e8f0;
          border-radius: 6px;
          color: #0f172a;
          font-family: 'Pretendard Variable', 'Pretendard', -apple-system, BlinkMacSystemFont, 'Malgun Gothic', '맑은 고딕', 'Segoe UI', sans-serif;
          font-size: 13.5px;
          line-height: 1.55;
          white-space: pre-wrap;
          overflow-wrap: anywhere;
          font-variant-numeric: tabular-nums;
        }
        .kakao-farm-card-list {
          display: flex;
          flex-direction: column;
          gap: 10px;
        }
        .kakao-farm-card {
          background: #ffffff;
          border: 1px solid #cbd5e1;
          border-radius: 8px;
          overflow: hidden;
        }
        .kakao-farm-card-head {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          align-items: center;
          justify-content: space-between;
          padding: 8px 12px;
          background: #f1f5f9;
          border-bottom: 1px solid #cbd5e1;
        }
        .kakao-farm-card-heading {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
          align-items: center;
        }
        .kakao-farm-card-heading strong {
          font-size: 14px;
          color: #0f172a;
        }
        .kakao-farm-badge,
        .kakao-farm-group-tag {
          display: inline-block;
          padding: 1px 7px;
          border-radius: 4px;
          font-size: 12.5px;
          font-weight: 600;
          background: #e2e8f0;
          color: #334155;
          font-variant-numeric: tabular-nums;
        }
        .kakao-farm-card-right {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          align-items: center;
        }
        .kakao-farm-subtotal {
          font-size: 13.5px;
          font-weight: 700;
          color: #1e3a8a;
          font-variant-numeric: tabular-nums;
        }
        .kakao-copy-farm-btn {
          padding: 4px 9px !important;
          font-size: 13px !important;
          font-weight: 600;
        }
        .kakao-farm-table-wrap {
          overflow-x: auto;
        }
        .kakao-farm-card-table {
          width: 100%;
          border-collapse: collapse;
          font-size: 13.5px;
          font-variant-numeric: tabular-nums;
        }
        .kakao-farm-card-table th,
        .kakao-farm-card-table td {
          padding: 5px 8px;
          border-bottom: 1px solid #e2e8f0;
          text-align: left;
          vertical-align: middle;
        }
        .kakao-farm-card-table th {
          background: #f8fafc;
          color: #334155;
          font-size: 12.5px;
          font-weight: 600;
        }
        .kakao-farm-card-table tbody tr:last-child td {
          border-bottom: 0;
        }
        .kakao-col-num {
          width: 38px;
          color: #475569;
          text-align: right !important;
        }
        .kakao-col-spec {
          color: #334155;
          font-size: 13px;
        }
        .kakao-col-qty {
          white-space: nowrap;
          font-weight: 700;
          color: #0f172a;
          text-align: right !important;
        }
        .kakao-col-note {
          color: #475569;
          font-size: 12.5px;
        }
        .kakao-farm-item-btn {
          background: transparent !important;
          border: 0 !important;
          padding: 2px 4px !important;
          text-align: left;
          font-weight: 600;
          color: #0f172a !important;
        }
        .kakao-farm-item-btn:hover {
          text-decoration: underline;
        }
        .kakao-farm-memo {
          margin: 0 !important;
          padding: 7px 12px;
          background: #fffbeb;
          border-top: 1px solid #fde68a;
          color: #78350f;
          font-size: 13px !important;
        }
        .kakao-separated-notes {
          margin: 10px 0 14px;
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .kakao-note-block {
          padding: 8px 12px;
          border-radius: 6px;
          font-size: 13px;
        }
        .kakao-note-block strong {
          display: block;
          margin-bottom: 4px;
          font-size: 13px;
        }
        .kakao-note-block ul {
          margin: 0;
          padding-left: 18px;
        }
        .kakao-note-excluded {
          background: #fef2f2;
          border: 1px solid #fecaca;
          color: #7f1d1d;
        }
        .kakao-note-memo {
          background: #fffbeb;
          border: 1px solid #fde68a;
          color: #78350f;
        }
        .kakao-ignored-totals {
          margin: 0 !important;
          padding: 6px 10px;
          background: #f1f5f9;
          border-left: 3px solid #64748b;
          color: #334155;
          font-size: 12.5px !important;
        }
        .kakao-ledger-subheading {
          margin: 12px 0 6px;
          font-size: 13px;
          color: #334155;
          font-weight: 700;
        }
        .kakao-additions details {
          background: #ffffff;
          padding: 10px;
          margin-top: 8px;
          border: 1px solid #cbd5e1;
          border-radius: 6px;
        }
        .kakao-additions summary {
          cursor: pointer;
          overflow-wrap: anywhere;
        }
        .kakao-additions blockquote {
          white-space: pre-wrap;
          overflow-wrap: anywhere;
          border-left: 3px solid #94a3b8;
          padding-left: 10px;
          margin: 12px 0;
        }
        .kakao-additions fieldset {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
          min-width: 0;
          border: 1px solid #cbd5e1;
          margin: 8px 0;
        }
        .kakao-additions fieldset > label {
          display: grid;
          flex: 1 1 90px;
          font-size: 12.5px;
        }
        .kakao-additions input:not([type='checkbox']) {
          width: 100%;
          min-width: 0;
          box-sizing: border-box;
          padding: 6px;
          border: 1px solid #cbd5e1;
          border-radius: 4px;
          font: inherit;
          font-size: 13.5px;
        }
        .kakao-table {
          overflow-x: auto;
          margin-bottom: 8px;
        }
        .kakao-table table {
          width: 100%;
          border-collapse: collapse;
          background: #ffffff;
          font-size: 13.5px;
          font-variant-numeric: tabular-nums;
        }
        .kakao-table th,
        .kakao-table td {
          text-align: left;
          padding: 4px 7px;
          border-bottom: 1px solid #cbd5e1;
          overflow-wrap: anywhere;
          vertical-align: top;
        }
        .kakao-table th {
          background: #f1f5f9;
          color: #1e293b;
          font-size: 12.5px;
        }
        .kakao-additions small {
          display: block;
          font-size: 12.5px;
          color: #475569;
        }
        .kakao-revision-tag {
          color: #1e40af !important;
          font-weight: 600;
        }
        .kakao-linked {
          background: #fef3c7 !important;
          box-shadow: inset 3px 0 #d97706;
        }
        .kakao-match-notice {
          padding: 8px 10px;
          background: #fef3c7;
          border-radius: 6px;
        }
        .kakao-table .kakao-match-total {
          width: 100%;
          text-align: left;
          padding: 2px 5px;
          min-height: 25px;
          font-size: 13.5px;
        }
        .kakao-no-notes {
          color: #475569;
        }
        .kakao-audit {
          margin-top: 16px !important;
        }
        .kakao-additions h4 {
          scroll-margin-top: 90px;
        }
        .kakao-originals {
          background: #ffffff;
          font-family: 'Pretendard Variable', 'Pretendard', -apple-system, BlinkMacSystemFont, 'Malgun Gothic', '맑은 고딕', 'Segoe UI', sans-serif;
          font-size: 14px;
        }
        .kakao-source-period,
        .kakao-source-meta,
        .kakao-source-controls span {
          color: #334155;
          font-size: 12.5px;
          font-variant-numeric: tabular-nums;
        }
        .kakao-source-controls,
        .kakao-source-actions,
        .kakao-source-meta {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 5px 8px;
        }
        .kakao-source-controls {
          margin: 8px 0;
        }
        .kakao-originals .kakao-hidden-toggle {
          padding: 4px 8px;
          font-size: 13px;
          margin-bottom: 6px;
        }
        .kakao-hidden-note,
        .kakao-temporary-source {
          color: #475569;
          font-size: 12.5px;
        }
        .kakao-source-included {
          display: inline-block;
          white-space: nowrap;
          padding: 1px 6px;
          border-radius: 4px;
          background: #dcfce7;
          color: #14532d;
          font-weight: 700;
          font-size: 12.5px;
        }
        .kakao-source-contributions {
          margin: 5px 0;
          padding: 4px 8px;
          border-left: 2px solid #16a34a;
          color: #14532d;
          background: #f0fdf4;
          font-size: 13.5px;
          font-variant-numeric: tabular-nums;
        }
        .kakao-source-contributions ul {
          padding-left: 17px;
          margin: 0;
        }
        .kakao-source-contributions details {
          margin: 3px 0 0;
          padding: 0;
          border: 0;
          background: transparent;
        }
        .kakao-more-sources {
          margin: 8px;
        }
        .kakao-source-controls button,
        .kakao-source-actions button {
          font-size: 13.5px;
          padding: 4px 8px;
        }
        .kakao-source-list {
          max-height: 65dvh;
          overflow: auto;
          overscroll-behavior: contain;
          border-block: 1px solid #cbd5e1;
        }
        .kakao-order-message {
          padding: 10px 8px;
          border-bottom: 1px solid #e2e8f0;
        }
        .kakao-order-message:last-child {
          border-bottom: 0;
        }
        .kakao-source-body {
          margin: 5px 0 7px;
          font-family: 'Pretendard Variable', 'Pretendard', -apple-system, BlinkMacSystemFont, 'Malgun Gothic', '맑은 고딕', 'Segoe UI', sans-serif;
          font-size: 13.5px;
          color: #0f172a;
          line-height: 1.55;
          white-space: pre-wrap;
          overflow-wrap: anywhere;
          font-variant-numeric: tabular-nums;
        }
        .kakao-feed-status {
          padding: 8px 10px;
          border-left: 3px solid #2563eb;
          background: #eff6ff;
          color: #1e3a8a;
          font-size: 13.5px;
        }
        .kakao-feed-status[role='alert'] {
          border-color: #b45309;
          background: #fffbeb;
          color: #78350f;
        }
        .kakao-table h5 {
          margin: 0;
          font: inherit;
          font-weight: 700;
        }
        .kakao-table .kakao-cycle-heading td {
          background: #e2e8f0;
          color: #0f172a;
          font-size: 13.5px;
          font-variant-numeric: tabular-nums;
        }
        .kakao-table .kakao-row-scope {
          width: 24%;
          font-size: 12.5px;
          color: #334155;
        }
        .kakao-table .kakao-quantity {
          white-space: nowrap;
          font-variant-numeric: tabular-nums;
          font-weight: 600;
        }
        .kakao-additions .kakao-match-total small {
          display: inline-block;
          margin-left: 2px;
          font-size: 12.5px;
          white-space: nowrap;
        }
        .kakao-source-reference {
          color: #78350f;
          font-variant-numeric: tabular-nums;
        }
        .kakao-table .kakao-source-reference {
          white-space: normal;
        }
        @media (max-width: 1200px) {
          .kakao-columns {
            grid-template-columns: minmax(0, 1fr);
          }
        }
      `}</style>
    </aside>
  );
}
