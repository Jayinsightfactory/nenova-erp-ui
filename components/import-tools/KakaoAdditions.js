import { Fragment, memo, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  validItem,
  validSignedItem,
  isCancelItem,
  resolveMinusKind,
  farmTotals,
  importItemView,
  importTotalsText,
  importCategoryLabel,
  importTotalKey,
  manualImportReviews,
  messageOrder,
  groupFarmTotalsByCycle,
  matchesCountryOrderScope,
  matchesCleanedScope,
  formatCleanedSingleLine,
  visibleKakaoMessages,
  kakaoMessagePageSize,
  normalizeFarmName,
  buildFarmSummary,
  formatFarmCardText,
  formatFarmTransferText,
  formatUnitDisplay,
} from '../../lib/importKakaoAdditions';
import { analyzeImportMessage, parsePastedKakaoChat } from '../../lib/importKakaoOrderText';
import { importCountryLabel } from '../../lib/importToolsDisplay';
import {
  KakaoMessageErpSummary,
  KakaoOrderRegisterPanel,
  useKakaoOrderRegisterBridge,
} from './KakaoOrderRegisterBridge';

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
const periodOptions = [7, 14, 30];
const requestFilters = ['전체', '추가', '취소·검토', '합계 반영', '정리처리됨'];
const sourceType = m => {
  if (m.kind === 'addition') return '추가';
  const items = Array.isArray(m.items) ? m.items : [];
  const cancelRows = items.filter(isCancelItem);
  if (cancelRows.length > 0 && cancelRows.length === items.length) {
    return cancelRows.some(r => resolveMinusKind(r) === '현지이슈') ? '현지이슈' : '취소';
  }
  if (/취소|캔슬|삭제되었습니다/.test(m.text)) return '취소';
  if (cancelRows.some(r => resolveMinusKind(r) === '현지이슈') || /현지\s*이슈|이슈|소트|쇼트|미\s*컨펌|결품/.test(m.text)) {
    return '현지이슈';
  }
  return '검토';
};
const sourceReference = id => '원문 ' + id.replace(/^archive:/, '').slice(0, 10).toUpperCase();

function shortKakaoTime(stamp) {
  const text = String(stamp || '').trim();
  const m = text.match(/^(?:\d{4})\s*(?:년|[-./])\s*(\d{1,2})\s*(?:월|[-./])\s*(\d{1,2})(?:일|\b)\s*(.*)$/);
  if (!m) return text;
  const rest = m[3].replace(/:00$/, '').trim();
  return `${Number(m[1])}/${Number(m[2])}${rest ? ' ' + rest : ''}`;
}

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

const emptyArray = [];

const MemoizedCleanedRow = memo(function CleanedRow({
  entry,
  expanded,
  pastedFeed,
  onToggleExpand,
  onRestore,
}) {
  const oneLine = formatCleanedSingleLine(entry.text) || '(빈 메시지)';
  const isDuplicate = Boolean(entry.duplicateOf);
  const isAi = entry.analysisSource === 'llm';
  return (
    <div data-cleaned-id={entry.id} className="kakao-cleaned-item">
      <div className="kakao-cleaned-row">
        <span className="kakao-cleaned-badge">정리처리됨</span>
        {!pastedFeed && (
          <span
            className={'kakao-analysis-badge ' + (isAi ? 'kakao-analysis-ai' : 'kakao-analysis-fallback')}
            title={isAi ? '구독 LLM 정밀 분류 완료' : '미분석 신규 원문 · 정규식 임시 분류'}
          >
            {isAi ? 'AI분류' : '임시분류'}
          </span>
        )}
        <span className="kakao-cleaned-time">{shortKakaoTime(entry.time)}</span>
        <button
          type="button"
          className="kakao-cleaned-text"
          aria-expanded={expanded}
          title={oneLine}
          onClick={() => onToggleExpand(entry.id)}
        >
          {oneLine}
        </button>
        <button
          type="button"
          className="kakao-restore-btn"
          disabled={isDuplicate}
          title={isDuplicate ? '동일 원문 중복' : '발주 검토 목록으로 복원'}
          onClick={() => onRestore(entry)}
        >
          {isDuplicate ? '중복' : '복원'}
        </button>
      </div>
      {expanded && (
        <div className="kakao-cleaned-detail">
          <small className="kakao-cleaned-reason">
            {entry.time}{entry.reason ? ' · ' + entry.reason : ''}
            {entry.duplicateOf ? ' · 중복 원본 ' + sourceReference(entry.duplicateOf) : ''}
          </small>
          <pre className="kakao-source-body">{entry.text}</pre>
        </div>
      )}
    </div>
  );
});

const MemoizedSourceMessageCard = memo(function SourceMessageCard({
  message: m,
  visibleItems,
  contributions,
  linked,
  isMessageSelected,
  open,
  isManual,
  pastedFeed,
  sourceKeys,
  knownFarms,
  viewItem,
  orderBridge,
  onFocusMessage,
  onToggleEditor,
  onCleanMessage,
  onUpdateItem,
  onMatchTotal,
  onAppendManualRow,
}) {
  const type = m._sourceType || sourceType(m);
  const isAi = m.analysisSource === 'llm';
  const viewedItems = visibleItems.map(viewItem);
  const cancelItems = viewedItems.filter(row => row.isCancel || row.cancelled);
  const activeItems = viewedItems.filter(row => !row.isCancel && !row.cancelled);
  const resolvedCustomers = viewedItems.map((row) => {
    const evalEntry = orderBridge?.byKey?.get(row.key)?.evaluation;
    return String(
      evalEntry?.customerMatch?.customer?.CustName ||
      evalEntry?.customerMatch?.rawCustomer ||
      row.customer ||
      ''
    ).trim();
  });
  const distinctCustomers = [...new Set(resolvedCustomers.filter(Boolean))];
  const sharedCustomer =
    resolvedCustomers.length > 0 &&
    resolvedCustomers.every(Boolean) &&
    distinctCustomers.length === 1
      ? distinctCustomers[0]
      : '';
  const hasPositiveContribution = contributions.some(r => !r.isCancel && !r.cancelled);
  const hasMinusContribution = contributions.some(r => r.isCancel || r.cancelled);
  const isMinusOnlyContribution = hasMinusContribution && !hasPositiveContribution;
  const dbToneClass = hasPositiveContribution ? 'is-added' : hasMinusContribution ? 'is-cancelled' : 'is-review';

  return (
    <article data-source-id={m.id} data-source-kind={m.kind} className={'kakao-order-message ' + (linked ? 'kakao-linked' : '')}>
      <div className="kakao-source-meta">
        <strong>{pastedFeed ? '붙여넣기' : importRoom}</strong>
        <span>{m.time}</span>
        <span>{type === '추가' ? '추가 발주' : type === '현지이슈' ? '현지이슈 (-)' : type === '취소' ? '취소 (-)' : '검토 필요'}</span>
        {!pastedFeed && !isManual && (
          <span
            className={'kakao-analysis-badge ' + (isAi ? 'kakao-analysis-ai' : 'kakao-analysis-fallback')}
            title={isAi ? '구독 LLM 정밀 분류 완료' : '미분석 신규 원문 · 정규식 임시 분류'}
          >
            {isAi ? 'AI분류' : '임시분류'}
          </span>
        )}
        {contributions.length > 0 && (
          <button
            type="button"
            className={'kakao-source-included' + (isMinusOnlyContribution ? ' is-cancel' : '') + (isMessageSelected ? ' is-active' : '')}
            aria-pressed={isMessageSelected}
            title={isMinusOnlyContribution ? '농장 전달용 자동 합계에서 차감(-) 반영된 품목 위치로 이동' : '농장 전달용 자동 합계에서 반영된 품목 위치로 이동'}
            onClick={() => onFocusMessage(m.id)}
          >
            {isMinusOnlyContribution
              ? '- 합계 차감'
              : hasMinusContribution
                ? (<><span aria-hidden="true">✓ </span>합계·차감 반영</>)
                : (<><span aria-hidden="true">✓ </span>합계 반영</>)}
          </button>
        )}
        {linked && <strong className="kakao-source-reference">{sourceReference(m.id)}</strong>}
      </div>
      <div className="kakao-source-split-wrap">
        <div className="kakao-source-split">
          <div className="kakao-source-raw-pane">
            <div className="kakao-pane-head">
              <span className="kakao-pane-label">원문</span>
            </div>
            <pre className="kakao-source-body">{m.text}</pre>
          </div>
          <div className={`kakao-source-db-pane ${dbToneClass}`}>
            <div className="kakao-pane-head">
              <span className="kakao-pane-label">매칭값(DB)</span>
              {visibleItems.length > 0 && <span className="kakao-pane-count">{visibleItems.length}건</span>}
              {sharedCustomer && <span className="kakao-pane-customer">{sharedCustomer}</span>}
            </div>
            {visibleItems.length === 0 ? (
              <p className="kakao-db-empty">매칭된 품목 없음</p>
            ) : (
              <>
                {activeItems.length > 0 && (
                  <KakaoMessageErpSummary
                    message={m}
                    visibleItems={activeItems}
                    viewItem={viewItem}
                    bridge={orderBridge}
                    sharedCustomer={sharedCustomer}
                  />
                )}
                {cancelItems.length > 0 && (
                  <div className="kakao-db-cancel-list" aria-label="취소·현지이슈 차감 내역">
                    {cancelItems.map((row) => {
                      const rawQty = String(row.quantity ?? '').replace(/^\-/, '').trim();
                      const qtyLabel = rawQty ? `-${rawQty}${row.unit ? ` ${row.unit}` : ''}` : '수량 미상';
                      const minusLabel = resolveMinusKind(row);
                      return (
                        <div key={row.key} className="kakao-db-cancel-row">
                          <span className="kakao-db-cancel-qty">{qtyLabel}</span>
                          <span className="kakao-db-cancel-name">
                            {row.dbProdName ? `${row.product} (${row.dbProdName})` : row.product}
                            {!sharedCustomer && row.customer ? ` · ${row.customer}` : ''}
                          </span>
                          <span className="kakao-db-cancel-badge">
                            {row.checked ? `${minusLabel} · 합계 차감` : `${minusLabel} · 차감 제외`}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
      <div className="kakao-source-actions">
        {visibleItems.length > 0 && ((!isMinusOnlyContribution && type !== '취소' && type !== '현지이슈') || contributions.length > 0) && (
          <button type="button" className="kakao-match-source" aria-pressed={isMessageSelected} onClick={() => onFocusMessage(m.id)}>
            이 원문의 합계 보기
          </button>
        )}
        {(visibleItems.length > 0 || m.reason) && (
          <button type="button" className="kakao-edit-source" aria-expanded={open} onClick={() => onToggleEditor(m.id)}>
            {open ? '품목·수량 접기' : m.kind === 'review' ? '발주 내용 검토' : '품목·수량 확인'}
          </button>
        )}
        <button type="button" className="kakao-visibility-action" aria-label="발주 외 원문 정리 처리" onClick={() => onCleanMessage(m)}>
          정리 처리
        </button>
      </div>
      {open && (
        <div>
          {m.reason && <p className="kakao-review-reason">{m.reason} · {(type === '취소' || type === '현지이슈') ? '체크 시 합계 차감(-) 반영' : '확인 전 합계 제외'}</p>}
          {m.retained?.map((r, i) => (
            <p key={i}>기존 주문 유지: {r.product} {r.quantity} {r.unit} · 새 추가 수량이 아니므로 합산하지 않습니다.</p>
          ))}
          {visibleItems.map(base => {
            const row = viewItem(base);
            const isRowCancel = Boolean(row.isCancel || row.cancelled);
            return (
              <fieldset key={row.key} className={sourceKeys?.has(row.key) ? 'kakao-linked' : ''}>
                <legend>
                  <label>
                    <input
                      type="checkbox"
                      checked={!!row.checked}
                      onChange={e => onUpdateItem(row.key, { checked: e.target.checked })}
                    />{' '}
                    {isRowCancel ? '합계 차감(-)' : m.kind === 'review' ? '검토 후 합산' : '합산'} · {row.product || '품종 확인'}
                  </label>
                </legend>
                {fields.map(([key, label]) => (
                  <label key={key}>
                    {label}
                    <input value={row[key] || ''} onChange={e => onUpdateItem(row.key, { [key]: e.target.value })} />
                  </label>
                ))}
                <small>
                  {row.checked ? (isRowCancel ? '합계 차감(-) 반영' : '합계에 포함') : row.reviewReason || '합계에서 제외'}
                  {row.revisionNote && ' · ' + row.revisionNote}
                  {row.note && ' · 요청: ' + row.note}
                </small>
                {row.checked && validSignedItem(row) && (
                  <button type="button" onClick={() => onMatchTotal(importTotalKey(row, knownFarms))}>
                    이 품종 원문 모아보기
                  </button>
                )}
              </fieldset>
            );
          })}
          {m.unparsed?.length > 0 && <p>해석하지 못한 수량 행: {m.unparsed.join(' / ')}</p>}
          {isManual && (
            <button type="button" onClick={() => onAppendManualRow(m)}>
              품목 행 추가
            </button>
          )}
        </div>
      )}
    </article>
  );
});

function RecentReview({ orderScope, userId, knownFarms: propKnownFarms = [] }) {
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
  const [windowDays, setWindowDays] = useState(14);
  const [sessionCleaned, setSessionCleaned] = useState(() => new Set());
  const [expandedCleaned, setExpandedCleaned] = useState({});

  // Farm copy formatting preferences & direct paste buffer (browser-only, 0 ERP write)
  const [copyFormat, setCopyFormat] = useState('concise');
  const [copyLang, setCopyLang] = useState('en');
  const [copiedCardKey, setCopiedCardKey] = useState('');
  const [pasteDraft, setPasteDraft] = useState('');
  const [pastedFeed, setPastedFeed] = useState(null);

  const toolbarDetailsId = useId();
  const hiddenMessages = useHiddenMessages(userId);
  const originalHeading = useRef(null);
  const totalHeading = useRef(null);
  const farmBoardRef = useRef(null);
  const sourceList = useRef(null);

  if (scopeKey !== lastScopeKey) {
    setLastScopeKey(scopeKey);
    setWeek('');
    setGroup('');
    setFarmFilter('');
    setFocus(null);
    setSourceFilter('전체');
    setSourceQuery('');
    setMessageLimit(kakaoMessagePageSize);
  }

  useEffect(() => {
    if (!focus) return;
    if (focus.type === 'total') {
      originalHeading.current?.scrollIntoView({ block: 'start' });
      originalHeading.current?.focus({ preventScroll: true });
      const list = sourceList.current;
      const first = list?.querySelector('.kakao-order-message.kakao-linked');
      if (first) list.scrollTop += first.getBoundingClientRect().top - list.getBoundingClientRect().top;
      return;
    }
    const matchedRow = farmBoardRef.current?.querySelector('tr.kakao-linked[data-farm-line-key]');
    if (matchedRow) {
      matchedRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } else {
      totalHeading.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    totalHeading.current?.focus({ preventScroll: true });
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
        const params = new URLSearchParams({ days: String(windowDays) });
        if (showAudit) params.set('audit', '1');
        const response = await fetch(`/api/import/tools/kakao-additions?${params}`, {
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
  }, [retry, showAudit, windowDays]);

  const activeFeed = pastedFeed || feed;
  const knownFarms = useMemo(() => {
    const serverFarms = Array.isArray(feed?.knownFarms) ? feed.knownFarms : emptyArray;
    return [...(propKnownFarms || emptyArray), ...serverFarms];
  }, [propKnownFarms, feed?.knownFarms]);

  const farmNormCache = useMemo(() => new Map(), [knownFarms]);
  const resolveFarmDisplay = useCallback(raw => {
    const text = String(raw || '').trim();
    if (!text) return '';
    if (farmNormCache.has(text)) return farmNormCache.get(text);
    const resolved = normalizeFarmName(text, knownFarms) || text;
    farmNormCache.set(text, resolved);
    return resolved;
  }, [knownFarms, farmNormCache]);

  const resolveCanonicalFarm = useCallback(raw => {
    const text = String(raw || '').trim();
    if (!text) return '';
    const cacheKey = '\0' + text;
    if (farmNormCache.has(cacheKey)) return farmNormCache.get(cacheKey);
    const resolved = normalizeFarmName(text, knownFarms);
    farmNormCache.set(cacheKey, resolved);
    return resolved;
  }, [knownFarms, farmNormCache]);

  const allMessages = useMemo(() => {
    const messages = activeFeed?.messages || emptyArray;
    const recovered = manualImportReviews(manual, activeFeed);
    const reviews = [...(activeFeed?.review || emptyArray), ...recovered];
    return [...messages, ...reviews].map(m => ({
      ...m,
      _orderKey: messageOrder(m.time),
      _sourceType: sourceType(m),
    }));
  }, [activeFeed, manual]);

  const dbProdByProduct = useMemo(() => {
    const map = new Map();
    for (const m of [...(feed?.messages || emptyArray), ...(feed?.review || emptyArray)]) {
      for (const it of m.items || emptyArray) {
        if (it?.product && it?.dbProdName && !map.has(it.product)) {
          map.set(it.product, { dbProdName: it.dbProdName, dbProdKey: it.dbProdKey || null });
        }
      }
    }
    return map;
  }, [feed]);

  const baseViewByKey = useMemo(() => {
    const msgById = new Map(allMessages.map(m => [m.id, m]));
    const firstPass = new Map();
    for (const m of allMessages) {
      const autoCheckCancel = !manual[m.id] && m.kind !== 'addition';
      for (const raw of m.items || emptyArray) {
        if (!raw?.key) continue;
        firstPass.set(raw.key, importItemView(raw, edits[raw.key], { autoCheckCancel }));
      }
    }
    const map = new Map();
    for (const m of allMessages) {
      const autoCheckCancel = !manual[m.id] && m.kind !== 'addition';
      const netMatchedAddition = !manual[m.id]
        && m.kind === 'review'
        && String(m.reason || '').trim() === '같은 차수·품목의 취소/변경 요청 대조 필요'
        && Array.isArray(m.relatedChanges)
        && m.relatedChanges.length > 0
        && m.relatedChanges.every(relId => {
          const rel = msgById.get(relId);
          if (!rel || rel.unparsed?.length || !Array.isArray(rel.items) || rel.items.length === 0) return false;
          const cancelRows = rel.items.filter(isCancelItem);
          return cancelRows.length > 0 && cancelRows.every(ci => Boolean(firstPass.get(ci.key)?.checked));
        });
      for (const raw of m.items || emptyArray) {
        if (!raw?.key) continue;
        const base = netMatchedAddition
          ? importItemView(raw, edits[raw.key], { autoCheckCancel, netMatchedAddition: true })
          : firstPass.get(raw.key);
        const farm = base.farm ? resolveFarmDisplay(base.farm) : '';
        const dbHint = !base.dbProdName && base.product ? dbProdByProduct.get(base.product) : null;
        map.set(raw.key, {
          ...base,
          ...(farm ? { farm } : {}),
          ...(dbHint ? { dbProdName: dbHint.dbProdName, dbProdKey: dbHint.dbProdKey } : {}),
        });
      }
    }
    return map;
  }, [allMessages, manual, edits, resolveFarmDisplay, dbProdByProduct]);

  const view = useCallback(row => {
    if (row?.key && baseViewByKey.has(row.key)) return baseViewByKey.get(row.key);
    const base = importItemView(row, edits[row?.key]);
    if (base.farm) return { ...base, farm: resolveFarmDisplay(base.farm) };
    return base;
  }, [baseViewByKey, edits, resolveFarmDisplay]);

  const cleanedIdSet = useMemo(() => {
    if (pastedFeed) return sessionCleaned;
    if (!sessionCleaned.size) return hiddenMessages.ids;
    const merged = new Set(hiddenMessages.ids);
    for (const id of sessionCleaned) merged.add(id);
    return merged;
  }, [pastedFeed, hiddenMessages.ids, sessionCleaned]);

  const activeMessages = useMemo(
    () => allMessages.filter(m => !cleanedIdSet.has(m.id)),
    [allMessages, cleanedIdSet]
  );

  const inOrderScope = useCallback(
    row => (pastedFeed ? true : matchesCountryOrderScope(row, orderScope)),
    [pastedFeed, orderScope]
  );

  const allRows = useMemo(
    () => activeMessages
      .flatMap(m => m.items.map(view))
      .filter(inOrderScope),
    [activeMessages, view, inOrderScope]
  );

  const nonCancelledScopeRows = useMemo(
    () => allRows.filter(r => !r.cancelled || r.checked),
    [allRows]
  );

  const weeks = useMemo(
    () => [...new Set(nonCancelledScopeRows.map(weekKey))].sort((a, b) => b.localeCompare(a, undefined, { numeric: true })),
    [nonCancelledScopeRows]
  );
  const activeWeek = weeks.includes(week) ? week : '';

  const groups = useMemo(
    () => [...new Set(nonCancelledScopeRows.filter(r => !activeWeek || weekKey(r) === activeWeek).map(groupKey))].sort(),
    [nonCancelledScopeRows, activeWeek]
  );
  const activeGroup = groups.includes(group) ? group : '';

  const namedFarms = useMemo(
    () => [...new Set(
      nonCancelledScopeRows
        .filter(r => (!activeWeek || weekKey(r) === activeWeek) && (!activeGroup || groupKey(r) === activeGroup))
        .map(r => resolveCanonicalFarm(r.farm))
        .filter(Boolean)
    )].sort((a, b) => a.localeCompare(b, 'ko')),
    [nonCancelledScopeRows, activeWeek, activeGroup, resolveCanonicalFarm]
  );
  const activeFarm = namedFarms.includes(farmFilter) ? farmFilter : '';

  const inScope = useCallback(row => (
    inOrderScope(row) &&
    (!activeWeek || weekKey(row) === activeWeek) &&
    (!activeGroup || groupKey(row) === activeGroup) &&
    (!activeFarm || resolveCanonicalFarm(row.farm) === activeFarm)
  ), [inOrderScope, activeWeek, activeGroup, activeFarm, resolveCanonicalFarm]);

  const rows = useMemo(() => allRows.filter(inScope), [allRows, inScope]);
  const totals = useMemo(() => farmTotals(rows, { knownFarms }), [rows, knownFarms]);
  const invalid = useMemo(
    () => rows.some(r => r.checked && (!validSignedItem(r) || !r.unit || !/^\d{1,2}(?:-\d{1,2})?$/.test(r.week))),
    [rows]
  );

  const includedSourceKeys = useMemo(() => {
    if (invalid) return new Set();
    const keys = new Set(totals.flatMap(total => total.sourceKeys));
    for (const r of rows) {
      if (r.checked && validSignedItem(r)) keys.add(r.key);
    }
    return keys;
  }, [invalid, totals, rows]);
  const includedRows = useMemo(
    () => new Map(rows.filter(row => includedSourceKeys.has(row.key)).map(row => [row.key, row])),
    [rows, includedSourceKeys]
  );

  const selectedTotal = useMemo(
    () => (focus?.type === 'total' ? totals.find(t => t.key === focus.key) || null : null),
    [focus, totals]
  );
  const selectedMessage = useMemo(
    () => (focus?.type === 'message' ? activeMessages.find(m => m.id === focus.id) || null : null),
    [focus, activeMessages]
  );
  const sourceKeys = useMemo(() => new Set(selectedTotal?.sourceKeys || emptyArray), [selectedTotal]);
  const messageKeys = useMemo(() => new Set(selectedMessage?.items.map(i => i.key) || emptyArray), [selectedMessage]);
  const shownTotals = useMemo(
    () => (selectedMessage ? totals.filter(t => t.sourceKeys.some(k => messageKeys.has(k))) : totals),
    [selectedMessage, totals, messageKeys]
  );
  const cycleTotals = useMemo(() => groupFarmTotalsByCycle(shownTotals), [shownTotals]);
  const linkedSources = useMemo(
    () => (selectedTotal ? activeMessages.filter(m => m.items.some(i => sourceKeys.has(i.key))) : emptyArray),
    [selectedTotal, activeMessages, sourceKeys]
  );

  const query = sourceQuery.normalize('NFKC').trim().toLowerCase();
  const matchesCurrentScope = useCallback(m => (
    (m.kind === 'review' && (!orderScope || pastedFeed || manual[m.id] || m.items.some(i => inOrderScope(view(i))))) ||
    m.items.some(i => inScope(view(i))) ||
    (pastedFeed && (m.memos?.length || m.excludedItems?.length))
  ), [orderScope, pastedFeed, manual, inOrderScope, inScope, view]);

  const scopedMessages = useMemo(
    () => activeMessages.filter(matchesCurrentScope),
    [activeMessages, matchesCurrentScope]
  );
  const scopedMessageIds = useMemo(
    () => new Set(scopedMessages.map(m => m.id)),
    [scopedMessages]
  );
  const scopedManualCleaned = useMemo(
    () => allMessages.filter(m => cleanedIdSet.has(m.id) && matchesCurrentScope(m)),
    [allMessages, cleanedIdSet, matchesCurrentScope]
  );
  const scopedAutoCleaned = useMemo(
    () => (activeFeed?.cleaned || emptyArray).filter(c => !manual[c.id] && (pastedFeed ? true : matchesCleanedScope(c, orderScope))),
    [activeFeed?.cleaned, manual, pastedFeed, orderScope]
  );

  const cleanedEntries = useMemo(() => {
    const byId = new Map();
    for (const m of scopedManualCleaned) {
      byId.set(m.id, {
        id: m.id,
        time: m.time,
        text: m.text,
        reason: '수동 정리 처리',
        analysisSource: m.analysisSource || 'regex',
        llmProvider: m.llmProvider || '',
        isCleaned: true,
        manualHidden: true,
        sourceMessage: m,
        _orderKey: m._orderKey || messageOrder(m.time),
      });
    }
    for (const c of scopedAutoCleaned) {
      if (!byId.has(c.id)) {
        byId.set(c.id, {
          ...c,
          isCleaned: true,
          manualHidden: false,
          _orderKey: messageOrder(c.time),
        });
      }
    }
    return [...byId.values()].sort((a, b) => b._orderKey.localeCompare(a._orderKey));
  }, [scopedManualCleaned, scopedAutoCleaned]);

  const totalCleanedCount = useMemo(
    () => ((activeFeed?.cleaned || emptyArray).filter(c => !manual[c.id]).length) + allMessages.filter(m => cleanedIdSet.has(m.id)).length,
    [activeFeed?.cleaned, manual, allMessages, cleanedIdSet]
  );

  const linkedIds = useMemo(() => {
    const ids = new Set(linkedSources.map(m => m.id));
    if (selectedMessage) ids.add(selectedMessage.id);
    return ids;
  }, [linkedSources, selectedMessage]);

  const matchesSearch = useCallback(entry => (
    !query || [importRoom, entry.time, entry.text, entry.reason].some(value => String(value || '').normalize('NFKC').toLowerCase().includes(query))
  ), [query]);

  const shownEntries = useMemo(() => {
    if (sourceFilter === '정리처리됨') {
      return cleanedEntries.filter(matchesSearch);
    }
    const activeMatched = scopedMessages.filter(m => linkedIds.has(m.id) || (
      (sourceFilter === '전체'
        || (sourceFilter === '합계 반영' && m.items.some(item => includedSourceKeys.has(item.key)))
        || (sourceFilter === '추가' && m._sourceType === '추가')
        || (sourceFilter === '취소·검토' && (m._sourceType === '취소' || m._sourceType === '현지이슈' || m._sourceType === '검토'))) &&
      matchesSearch(m)
    ));
    if (sourceFilter === '전체') {
      const cleanedMatched = cleanedEntries.filter(matchesSearch);
      return [...activeMatched, ...cleanedMatched].sort((a, b) => b._orderKey.localeCompare(a._orderKey));
    }
    return [...activeMatched].sort((a, b) => b._orderKey.localeCompare(a._orderKey));
  }, [sourceFilter, cleanedEntries, scopedMessages, linkedIds, includedSourceKeys, matchesSearch]);

  const visibleEntries = useMemo(
    () => visibleKakaoMessages(shownEntries, messageLimit, linkedIds),
    [shownEntries, messageLimit, linkedIds]
  );
  const scopeLabel = orderScope && [
    importCountryLabel(orderScope.country),
    orderScope.year && orderScope.majorWeek ? orderScope.year + '/' + (orderScope.orderWeek || orderScope.majorWeek) + '차' : '',
  ].filter(Boolean).join(' · ');

  const orderBridge = useKakaoOrderRegisterBridge({
    allMessages,
    scopedMessageIds,
    scopedMessages,
    baseViewByKey,
    viewItem: view,
    sourceTypeFn: sourceType,
    orderScope: pastedFeed ? null : orderScope,
  });

  // Collect scoped excluded/cancelled items that were NOT already subtracted in farmTotals, ignored total lines, and operational memos
  const scopedExcludedItems = useMemo(() => {
    const items = [];
    for (const m of scopedMessages) {
      const checkedKeysInMsg = new Set(
        (m.items || []).filter(it => view(it).checked).map(it => it.key)
      );
      if (sourceType(m) === '취소' || sourceType(m) === '현지이슈') {
        for (const it of m.items || []) {
          if (!view(it).checked) {
            const mKind = resolveMinusKind(it);
            items.push({ product: it.product, quantity: it.quantity, unit: it.unit, farm: it.farm, reason: `${mKind} 원문 (차감 제외)` });
          }
        }
      } else {
        for (const ex of m.excludedItems || []) {
          if (ex.key && checkedKeysInMsg.has(ex.key)) continue;
          if (pastedFeed || matchesCountryOrderScope(ex, orderScope)) {
            items.push(ex);
          }
        }
      }
    }
    return items;
  }, [scopedMessages, orderScope, pastedFeed, view]);

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
    () => buildFarmSummary(invalid ? emptyArray : totals, {
      knownFarms,
      excludedItems: scopedExcludedItems,
      ignoredTotals: scopedIgnoredTotals,
      memos: scopedMemos,
      reviewCount: reviewMessageCount,
    }),
    [invalid, totals, knownFarms, scopedExcludedItems, scopedIgnoredTotals, scopedMemos, reviewMessageCount]
  );

  const fullTransferText = useMemo(
    () => formatFarmTransferText(farmSummary, { format: copyFormat, lang: copyLang, memo: true }),
    [farmSummary, copyFormat, copyLang]
  );

  const toggleManualClean = useCallback((message, cleanFlag) => {
    let persisted = false;
    if (!pastedFeed && hiddenMessages.ready) {
      persisted = hiddenMessages.change(message.id, cleanFlag);
    } else {
      setSessionCleaned(prev => {
        const next = new Set(prev);
        if (cleanFlag) next.add(message.id);
        else next.delete(message.id);
        return next;
      });
    }
    setFocus(prev => (cleanFlag && prev?.type === 'message' && prev.id === message.id ? null : prev));
    setNotice(
      (cleanFlag
        ? '정리처리됨 상태로 전환했습니다. 한 줄 목록의 [복원]으로 되돌릴 수 있습니다.'
        : '정리처리됨 원문을 발주 목록으로 복원했습니다.')
      + (!pastedFeed && hiddenMessages.ready && persisted ? '' : ' (현재 화면 적용)')
    );
  }, [pastedFeed, hiddenMessages]);

  const matchTotal = useCallback(key => {
    setFocus(prev => (prev?.type === 'total' && prev.key === key ? null : { type: 'total', key }));
  }, []);

  const toggleFocusMessage = useCallback(messageId => {
    setFocus(prev => (prev?.type === 'message' && prev.id === messageId ? null : { type: 'message', id: messageId }));
  }, []);

  const update = useCallback((key, patch) => {
    setNotice('');
    setFocus(null);
    setEdits(prev => ({ ...prev, [key]: { ...prev[key], ...patch } }));
  }, []);

  const handleToggleCleanedExpand = useCallback(entryId => {
    setExpandedCleaned(prev => ({ ...prev, [entryId]: !prev[entryId] }));
  }, []);

  const handleToggleOpenEditor = useCallback(messageId => {
    setOpenEditors(prev => ({ ...prev, [messageId]: !prev[messageId] }));
  }, []);

  const handleCleanMessage = useCallback(message => {
    toggleManualClean(message, true);
  }, [toggleManualClean]);

  const handleAppendManualRow = useCallback(m => {
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
    }));
  }, []);

  function restoreCleaned(m) {
    const defaultYear = m.time?.match(/^\d{4}/)?.[0] || String(orderScope?.year || new Date().getFullYear());
    const defaultWeek = orderScope?.orderWeek || orderScope?.majorWeek || '';
    const defaultCountry = orderScope?.country ? importCountryLabel(orderScope.country) : '';
    const candidate = analyzeImportMessage(
      { id: m.id, time: m.time || '', text: m.text || '', items: [] },
      new Map(),
      { pastedOrder: true, ignoreLlmCache: true, knownFarms, defaultYear, defaultWeek, defaultCountry }
    );
    const parsedItems = (candidate.items || [])
      .filter(it => !it.cancelled)
      .map((it, idx) => ({
        ...it,
        key: JSON.stringify(['manual', m.id, m.text, idx]),
        reviewReason: '정리처리됨 원문에서 복원 · 확인 후 체크',
      }));
    const fallbackKey = JSON.stringify(['manual', m.id, m.text]);
    const items = parsedItems.length > 0
      ? parsedItems
      : [{
          key: fallbackKey,
          year: defaultYear,
          country: defaultCountry,
          group: '',
          product: '',
          quantity: '',
          unit: '박스',
          week: defaultWeek,
          customer: '',
          farm: '',
          reviewReason: '원문과 대조 후 포함',
        }];
    setManual(prev => ({
      ...prev,
      [m.id]: {
        id: m.id,
        time: m.time,
        text: m.text,
        kind: 'review',
        reason: '정리처리됨에서 복원한 원문',
        items,
      },
    }));
    setOpenEditors(previous => ({ ...previous, [m.id]: true }));
    if (sourceFilter === '정리처리됨') setSourceFilter('전체');
    setFocus(null);
    setNotice('정리처리됨 원문을 검토 목록으로 복원했습니다. 품목·수량·단위·차수를 확인한 뒤 합산을 체크하세요.');
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
      setNotice(`전달용 합계 양식(${farmSummary.cards.length}개 묶음)을 클립보드에 복사했습니다.`);
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
    setSessionCleaned(new Set());
    setWeek('');
    setGroup('');
    setFarmFilter('');
    setFocus(null);
    setCopiedCardKey('');
    setNotice(`붙여넣은 카톡 원문을 분석했습니다 (발주 ${parsed.messages.length}건 · 검토 ${parsed.review.length}건 · 정리처리됨 ${(parsed.cleaned || []).length}건 · 잡담/헤더 ${parsed.noise}줄 제거).`);
  }

  function resetPastedChat() {
    setPastedFeed(null);
    setSessionCleaned(new Set());
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

  const handleRestoreCleanedEntry = useCallback(entry => {
    if (entry.manualHidden) {
      toggleManualClean(entry.sourceMessage || entry, false);
    } else {
      restoreCleaned(entry);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toggleManualClean, orderScope, knownFarms, sourceFilter]);

  function renderCleanedRow(entry) {
    return (
      <MemoizedCleanedRow
        key={entry.id}
        entry={entry}
        expanded={!!expandedCleaned[entry.id]}
        pastedFeed={Boolean(pastedFeed)}
        onToggleExpand={handleToggleCleanedExpand}
        onRestore={handleRestoreCleanedEntry}
      />
    );
  }

  function renderMessage(m) {
    const isManual = Boolean(manual[m.id]);
    const visible = m.kind === 'review'
      ? m.items.filter(i => isManual || inOrderScope(view(i)))
      : m.items.filter(i => inScope(view(i)));
    const isMessageSelected = selectedMessage?.id === m.id;
    const linked = isMessageSelected || (sourceKeys.size > 0 && m.items.some(i => sourceKeys.has(i.key)));
    const contributions = m.items.map(item => includedRows.get(item.key)).filter(Boolean);
    const open = !!openEditors[m.id];
    return (
      <MemoizedSourceMessageCard
        key={m.id}
        message={m}
        visibleItems={visible}
        contributions={contributions}
        linked={linked}
        isMessageSelected={isMessageSelected}
        open={open}
        isManual={isManual}
        pastedFeed={Boolean(pastedFeed)}
        sourceKeys={open ? sourceKeys : null}
        knownFarms={knownFarms}
        viewItem={view}
        orderBridge={orderBridge}
        onFocusMessage={toggleFocusMessage}
        onToggleEditor={handleToggleOpenEditor}
        onCleanMessage={handleCleanMessage}
        onUpdateItem={update}
        onMatchTotal={matchTotal}
        onAppendManualRow={handleAppendManualRow}
      />
    );
  }

  const stats = activeFeed?.stats;
  const llmStats = activeFeed?.llmStats;
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
            {!pastedFeed && (
              <div className="kakao-period-group" role="group" aria-label="수입방 수집 조회 기간">
                {periodOptions.map(days => (
                  <button
                    key={days}
                    type="button"
                    aria-pressed={windowDays === days}
                    disabled={loading && windowDays === days}
                    onClick={() => { if (windowDays !== days) { setWindowDays(days); setMessageLimit(kakaoMessagePageSize); } }}
                  >
                    최근 {days}일
                  </button>
                ))}
              </div>
            )}
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
        {stats && !pastedFeed && (
          <p className="kakao-collection-summary">
            최근 {activeFeed?.windowDays || windowDays}일 수입방 원문 {stats.scanned}건 수집 · 추가 발주 {activeMessages.filter(m => sourceType(m) === '추가').length}건 · 검토 {activeMessages.filter(m => sourceType(m) !== '추가').length}건 · 정리처리됨 {totalCleanedCount}건
            {llmStats ? ` · AI 정밀분류 ${llmStats.parsed}건${llmStats.pending > 0 ? ` · 분석대기 ${llmStats.pending}건` : ''}` : ''}
          </p>
        )}
        <div id={toolbarDetailsId} hidden={!toolbarOpen}>
          <p>최근 {activeFeed?.windowDays || windowDays}일 수입방 보관 원문 전체 조회 · 최신순 · 1분마다 갱신</p>
          {activeFeed && !pastedFeed && (
            <p>
              {activeFeed.orderDays?.length ? '발주일: ' + activeFeed.orderDays.join(' · ') : '합산 가능한 발주일 없음'}
              {activeFeed.latest && ' · 최근 수집 원문 ' + activeFeed.latest}
            </p>
          )}
          {activeFeed?.reviewThrough && <p>조회 범위({activeFeed.windowFrom || activeFeed.from || '최근'} ~ {activeFeed.reviewThrough})의 취소·변경 및 비발주 정리처리 내역을 함께 확인합니다.</p>}
          {stats && (
            <p className="kakao-counts">
              카톡 {stats.scanned}건 분석 · 추가 발주 {stats.selected}건 · 검토 {stats.review}건 · 정리처리됨(비발주 {stats.excluded}건 · 중복 {stats.duplicates}건)
            </p>
          )}
          <p>발주 추가가 아닌 대화는 자동으로 정리처리됨(1줄 표시)으로 분류되며, 한 줄 내용을 눌러 전문을 보거나 [복원]으로 발주 검토에 되돌릴 수 있습니다.</p>
        </div>
        {((week && !activeWeek) || (group && !activeGroup) || (farmFilter && !activeFarm)) && (
          <p role="status">선택한 필터가 현재 자료에 없어 전체 범위를 표시합니다. 버튼에서 다시 선택하세요.</p>
        )}
        <span role="status" className="kakao-live-notice">{notice}</span>
      </header>

              <KakaoOrderRegisterPanel
                bridge={orderBridge}
                onFocusMessage={toggleFocusMessage}
              />

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
                  <span className="kakao-kpi-label">발주 묶음</span>
                  <strong className="kakao-kpi-value">
                    {farmSummary.cards.length > 0
                      ? `발주 묶음 ${farmSummary.cards.length}개${farmSummary.farmCount > 0 ? ` · 농장지정 ${farmSummary.farmCount}곳` : ''}`
                      : '0개'}
                  </strong>
                </div>
                <div className="kakao-kpi-item">
                  <span className="kakao-kpi-label">합산 품목</span>
                  <strong className="kakao-kpi-value">{farmSummary.itemCount}종</strong>
                </div>
                <div className="kakao-kpi-item kakao-kpi-wide">
                  <span className="kakao-kpi-label">단위별 총 수량</span>
                  <strong className="kakao-kpi-value">{(copyLang === 'en' ? farmSummary.unitsEn : farmSummary.units).totalLine || '0'}</strong>
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
              <div className="kakao-farm-board" aria-label="농장별 전달 정돈 카드" ref={farmBoardRef}>
                <div className="kakao-copy-toolbar">
                  <div className="kakao-copy-toggles">
                    <div role="group" aria-label="전달 포맷 선택" className="kakao-segmented">
                      <button type="button" aria-pressed={copyFormat === 'concise'} onClick={() => setCopyFormat('concise')}>간결 전달용</button>
                      <button type="button" aria-pressed={copyFormat === 'detailed'} onClick={() => setCopyFormat('detailed')}>상세(업체·변경)</button>
                    </div>
                    <div role="group" aria-label="단위 언어 선택" className="kakao-segmented">
                      <button type="button" aria-pressed={copyLang === 'en'} onClick={() => setCopyLang('en')}>영문(bunches·box·stems)</button>
                      <button type="button" aria-pressed={copyLang === 'ko'} onClick={() => setCopyLang('ko')}>국문 단위</button>
                    </div>
                  </div>
                  <button type="button" className="kakao-primary-btn" disabled={copyDisabled} onClick={copyFarmTransferAll}>
                    {copiedCardKey === '__ALL__' ? '전체 전달 양식 복사됨' : '농장 전달용 전체 복사'}
                  </button>
                </div>

                <details className="kakao-preview-box">
                  <summary>복사될 전달 문구 미리보기 ({farmSummary.cards.length}개 묶음)</summary>
                  <pre className="kakao-copy-preview">{fullTransferText}</pre>
                </details>

                <div className="kakao-farm-card-list">
                  {farmSummary.cards.map(card => {
                    const cardSubtotal = (copyLang === 'en' ? card.unitsEn : card.units).totalLine;
                    const hasLinkedMessageItem = selectedMessage
                      ? card.items.some(it => it.sourceKeys.some(k => messageKeys.has(k)))
                      : false;
                    return (
                      <article
                        key={card.key}
                        className={'kakao-farm-card' + (hasLinkedMessageItem ? ' kakao-card-linked' : '')}
                        aria-label={card.title}
                      >
                        <header className="kakao-farm-card-head">
                          <div className="kakao-farm-card-heading">
                            <strong>{card.title}</strong>
                            <span className="kakao-farm-badge">{card.cycle}</span>
                            {card.isNamedFarm && (
                              <span className="kakao-designated-farm-badge">지정농장</span>
                            )}
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
                              {copiedCardKey === card.key ? '복사됨' : card.isNamedFarm ? '이 농장 복사' : '이 묶음 복사'}
                            </button>
                          </div>
                        </header>
                        <div className="kakao-farm-table-wrap">
                          <table className="kakao-farm-card-table">
                            <thead>
                              <tr>
                                <th scope="col">번호</th>
                                <th scope="col">품목명</th>
                                <th scope="col">DB 품목명 (영문)</th>
                                <th scope="col">수량</th>
                                <th scope="col">비고</th>
                              </tr>
                            </thead>
                            <tbody>
                              {card.items.map((item, idx) => {
                                const isPicked = selectedTotal && item.totalKeys.includes(selectedTotal.key);
                                const isLinkedFromMessage = selectedMessage
                                  ? item.sourceKeys.some(k => messageKeys.has(k))
                                  : false;
                                const displayName = [item.product, item.packSpec].filter(Boolean).join(' · ');
                                const remarks = [...new Set([
                                  item.breakdownNote,
                                  item.revisions,
                                  copyFormat === 'detailed' ? item.customers : '',
                                  ...item.requestNotes,
                                ].filter(Boolean))].join(' · ');
                                const isMinusQty = Number(item.quantity) < 0;
                                return (
                                  <tr
                                    key={item.key}
                                    data-farm-line-key={item.key}
                                    className={(isPicked || isLinkedFromMessage) ? 'kakao-linked' : ''}
                                  >
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
                                    <td className="kakao-col-db-en">{item.dbProdName || '–'}</td>
                                    <td className={'kakao-col-qty' + (isMinusQty ? ' is-minus' : '')}>{formatUnitDisplay(item.quantity, item.unit, copyLang)}</td>
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

              <details className="kakao-secondary-ledger">
                <summary className="kakao-ledger-subheading">차수 · 원문 대조 원장 보기 ({totals.length}행)</summary>
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
              </details>
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
                {pastedFeed
                  ? '직접 붙여넣은 카톡 원문'
                  : `최근 ${activeFeed?.windowDays || windowDays}일 (${activeFeed?.windowFrom || activeFeed?.from || '최근'} ~ ${activeFeed?.reviewThrough || '오늘'}) · 수입방`}
              </p>
              <input
                type="search"
                aria-label="카톡 원문 검색"
                placeholder="시각·품목·농장·정리처리된 내용 검색"
                value={sourceQuery}
                onChange={e => { setSourceQuery(e.target.value); setMessageLimit(kakaoMessagePageSize); }}
              />
              <div className="kakao-source-controls" role="group" aria-label="카톡 요청 유형">
                {requestFilters.map(type => (
                  <button key={type} type="button" aria-pressed={sourceFilter === type} onClick={() => { setSourceFilter(type); setMessageLimit(kakaoMessagePageSize); }}>
                    {type === '정리처리됨' ? `정리처리됨 (${cleanedEntries.length})` : type}
                  </button>
                ))}
                <span role="status">최신순 · {visibleEntries.length} / {shownEntries.length}건</span>
              </div>
              {selectedTotal && (
                <p className="kakao-match-notice">
                  {selectedTotal.product} {selectedTotal.quantity} {selectedTotal.unit}의 근거 원문{' '}
                  <button type="button" onClick={() => setFocus(null)}>매칭 해제</button>
                </p>
              )}
              <div className="kakao-source-list" role="region" aria-label="카톡 요청 목록" tabIndex={0} ref={sourceList}>
                {visibleEntries.map(entry => entry.isCleaned ? renderCleanedRow(entry) : renderMessage(entry))}
                {visibleEntries.length < shownEntries.length && (
                  <button type="button" className="kakao-more-sources" onClick={() => setMessageLimit(n => n + kakaoMessagePageSize)}>
                    카톡 원문 {Math.min(kakaoMessagePageSize, shownEntries.length - visibleEntries.length)}건 더 보기
                  </button>
                )}
                {activeFeed && !shownEntries.length && (!loading || pastedFeed) && (!error || pastedFeed) && (
                  <p>표시할 카톡 요청이 없습니다.</p>
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
                      <button type="button" disabled={!!manual[m.id]} onClick={() => restoreCleaned(m)}>
                        {manual[m.id] ? '검토로 가져옴' : '복원 · 발주로 검토'}
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
        .kakao-period-group {
          display: inline-flex;
          gap: 4px;
          align-items: center;
        }
        .kakao-toolbar .kakao-collection-summary {
          margin: 4px 0 2px;
          font-size: 13px;
          color: #334155;
          font-weight: 500;
          font-variant-numeric: tabular-nums;
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
          content-visibility: auto;
          contain-intrinsic-size: 0 220px;
        }
        .kakao-farm-card.kakao-card-linked {
          border-color: #d97706;
          box-shadow: 0 0 0 2px #fde68a;
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
        .kakao-designated-farm-badge {
          display: inline-block;
          padding: 1px 7px;
          border-radius: 4px;
          font-size: 12.5px;
          font-weight: 700;
          background: #dbeafe;
          color: #1e3a8a;
          border: 1px solid #93c5fd;
          white-space: nowrap;
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
        .kakao-col-db-en {
          color: #1e3a8a;
          font-size: 13px;
          font-weight: 500;
        }
        .kakao-col-qty {
          white-space: nowrap;
          font-weight: 700;
          color: #0f172a;
          text-align: right !important;
        }
        .kakao-col-qty.is-minus {
          color: #be123c;
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
          margin: 0;
          font-size: 13px;
          color: #334155;
          font-weight: 700;
        }
        .kakao-secondary-ledger > .kakao-table {
          margin-top: 8px;
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
        .kakao-additions button.kakao-source-included {
          display: inline-flex;
          align-items: center;
          white-space: nowrap;
          padding: 2px 8px;
          border-radius: 999px;
          background: #dcfce7;
          border: 1px solid #86efac;
          color: #14532d;
          font-weight: 700;
          font-size: 12.5px;
          line-height: 1.35;
        }
        .kakao-additions button.kakao-source-included:hover:not(:disabled) {
          background: #bbf7d0;
          border-color: #22c55e;
        }
        .kakao-additions button.kakao-source-included[aria-pressed='true'],
        .kakao-additions button.kakao-source-included.is-active {
          background: #15803d;
          border-color: #15803d;
          color: #ffffff;
        }
        .kakao-additions button.kakao-source-included.is-cancel {
          background: #ffe4e6;
          border-color: #fda4af;
          color: #9f1239;
        }
        .kakao-additions button.kakao-source-included.is-cancel:hover:not(:disabled) {
          background: #fecdd3;
          border-color: #fb7185;
        }
        .kakao-additions button.kakao-source-included.is-cancel[aria-pressed='true'],
        .kakao-additions button.kakao-source-included.is-cancel.is-active {
          background: #be123c;
          border-color: #be123c;
          color: #ffffff;
        }
        .kakao-source-split-wrap {
          container-type: inline-size;
          margin: 6px 0;
        }
        .kakao-source-split {
          display: grid;
          grid-template-columns: minmax(0, 1fr);
          gap: 8px;
          align-items: start;
        }
        @container (min-width: 420px) {
          .kakao-source-split {
            grid-template-columns: minmax(0, 0.9fr) minmax(0, 1.1fr);
            gap: 10px;
            align-items: start;
          }
        }
        .kakao-source-raw-pane {
          min-width: 0;
          padding: 6px 8px;
          border: 1px solid #e2e8f0;
          border-radius: 6px;
          background: #f8fafc;
        }
        .kakao-source-db-pane {
          min-width: 0;
          padding: 6px 8px;
          border: 1px solid #e2e8f0;
          border-left: 3px solid #94a3b8;
          border-radius: 6px;
          background: #ffffff;
          font-variant-numeric: tabular-nums;
        }
        .kakao-source-db-pane.is-added {
          border-left-color: #10b981;
        }
        .kakao-source-db-pane.is-cancelled {
          border-left-color: #e11d48;
        }
        .kakao-source-db-pane.is-review {
          border-left-color: #94a3b8;
        }
        .kakao-pane-head {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 6px;
          margin-bottom: 4px;
        }
        .kakao-pane-label {
          font-size: 12.5px;
          font-weight: 700;
          color: #334155;
        }
        .kakao-pane-count {
          font-size: 12.5px;
          color: #475569;
          font-weight: 600;
          font-variant-numeric: tabular-nums;
        }
        .kakao-pane-customer {
          display: inline-block;
          padding: 1px 6px;
          border-radius: 4px;
          background: #eff6ff;
          border: 1px solid #bfdbfe;
          color: #1e3a8a;
          font-size: 12.5px;
          font-weight: 700;
        }
        .kakao-db-empty {
          margin: 2px 0 0 !important;
          color: #475569;
          font-size: 12.5px !important;
        }
        .kakao-db-cancel-list {
          display: flex;
          flex-direction: column;
          gap: 4px;
          margin-top: 2px;
        }
        .kakao-db-cancel-row {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          justify-content: space-between;
          gap: 6px;
          padding: 3px 6px;
          border-radius: 5px;
          background: #fff1f2;
          border: 1px solid #fecdd3;
          font-size: 13px;
        }
        .kakao-db-cancel-qty {
          color: #be123c;
          font-weight: 700;
          font-variant-numeric: tabular-nums;
          white-space: nowrap;
        }
        .kakao-db-cancel-name {
          color: #0f172a;
          font-weight: 600;
          flex: 1 1 auto;
          min-width: 0;
          overflow-wrap: anywhere;
        }
        .kakao-db-cancel-badge {
          padding: 1px 6px;
          border-radius: 4px;
          background: #ffe4e6;
          color: #9f1239;
          font-size: 12.5px;
          font-weight: 700;
          white-space: nowrap;
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
          content-visibility: auto;
          contain-intrinsic-size: 0 180px;
        }
        .kakao-order-message:last-child {
          border-bottom: 0;
        }
        .kakao-cleaned-item {
          border-bottom: 1px solid #e2e8f0;
          background: #f8fafc;
          content-visibility: auto;
          contain-intrinsic-size: 0 36px;
        }
        .kakao-cleaned-item:last-child {
          border-bottom: 0;
        }
        .kakao-cleaned-row {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 5px 8px;
          min-height: 34px;
          max-width: 100%;
          min-width: 0;
        }
        .kakao-cleaned-badge {
          flex: 0 0 auto;
          display: inline-block;
          padding: 1px 6px;
          border-radius: 4px;
          background: #e2e8f0;
          color: #334155;
          font-size: 12.5px;
          font-weight: 700;
          line-height: 1.4;
          white-space: nowrap;
        }
        .kakao-analysis-badge {
          flex: 0 0 auto;
          display: inline-block;
          padding: 1px 6px;
          border-radius: 4px;
          font-size: 12.5px;
          font-weight: 600;
          line-height: 1.4;
          white-space: nowrap;
          font-variant-numeric: tabular-nums;
        }
        .kakao-analysis-ai {
          background: #e2e8f0;
          color: #1e293b;
          border: 1px solid #cbd5e1;
        }
        .kakao-analysis-fallback {
          background: #f8fafc;
          color: #475569;
          border: 1px solid #cbd5e1;
        }
        .kakao-cleaned-time {
          flex: 0 0 auto;
          color: #475569;
          font-size: 12.5px;
          white-space: nowrap;
          font-variant-numeric: tabular-nums;
        }
        .kakao-cleaned-text {
          flex: 1 1 0%;
          min-width: 0;
          max-width: 100%;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap !important;
          text-align: left;
          background: transparent !important;
          border: 0 !important;
          padding: 2px 4px !important;
          color: #334155 !important;
          font-size: 13.5px !important;
          font-weight: 400 !important;
          line-height: 1.4;
        }
        .kakao-cleaned-text:hover {
          color: #0f172a !important;
          text-decoration: underline;
          background: transparent !important;
        }
        .kakao-restore-btn {
          flex: 0 0 auto;
          padding: 2px 8px !important;
          font-size: 12.5px !important;
          font-weight: 600;
          white-space: nowrap;
          color: #1e3a8a !important;
          border-color: #93c5fd !important;
          background: #ffffff !important;
        }
        .kakao-restore-btn:hover:not(:disabled) {
          background: #eff6ff !important;
          border-color: #3b82f6 !important;
        }
        .kakao-cleaned-detail {
          padding: 6px 10px 8px;
          border-top: 1px dashed #cbd5e1;
          background: #ffffff;
        }
        .kakao-cleaned-reason {
          margin-bottom: 4px;
          color: #475569;
          font-size: 12.5px;
        }
        .kakao-source-body {
          margin: 2px 0 0;
          font-family: 'Pretendard Variable', 'Pretendard', -apple-system, BlinkMacSystemFont, 'Malgun Gothic', '맑은 고딕', 'Segoe UI', sans-serif;
          font-size: 13.5px;
          color: #0f172a;
          line-height: 1.55;
          white-space: pre-wrap;
          word-break: break-word;
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
