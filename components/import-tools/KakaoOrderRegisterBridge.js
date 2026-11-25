import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  KAKAO_ORDER_HANDOFF_KEY,
  KAKAO_ORDER_SYNC_CHANNEL,
  KAKAO_ORDER_SYNC_PING_KEY,
  buildKakaoOrderHandoffPayload,
  classifyKakaoItemErpStatus,
  extractScopesFromKakaoEntries,
} from '../../lib/kakaoOrderErpStatus';

export function useKakaoOrderRegisterBridge({
  scopedMessages = [],
  viewItem,
  sourceTypeFn,
  orderScope = null,
}) {
  const [erpData, setErpData] = useState({ customers: [], erpOrders: [], checkedAt: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [refreshTick, setRefreshTick] = useState(0);
  const [selectedKeys, setSelectedKeys] = useState(() => new Set());
  const [bridgeNotice, setBridgeNotice] = useState('');

  const scopedEntries = useMemo(() => {
    const out = [];
    for (const message of scopedMessages || []) {
      const messageType = sourceTypeFn ? sourceTypeFn(message) : '추가';
      const defaultYear = String(message?.time || '').match(/^\d{4}/)?.[0] || '';
      for (const rawItem of message?.items || []) {
        const row = viewItem ? viewItem(rawItem) : rawItem;
        out.push({
          key: row.key,
          row,
          message,
          messageType,
          messageKind: message.kind || 'addition',
          messageText: message.text || '',
          defaultYear,
        });
      }
    }
    return out;
  }, [scopedMessages, viewItem, sourceTypeFn]);

  const scopesParam = useMemo(
    () => extractScopesFromKakaoEntries(scopedEntries, orderScope).join(','),
    [scopedEntries, orderScope],
  );

  const triggerRefresh = useCallback(() => {
    setRefreshTick((prev) => prev + 1);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    async function loadErpStatus() {
      setLoading(true);
      try {
        const qs = scopesParam ? `?scopes=${encodeURIComponent(scopesParam)}` : '';
        const response = await fetch(`/api/import/tools/kakao-order-status${qs}`, {
          signal: controller.signal,
          cache: 'no-store',
        });
        const body = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(body.error || 'ERP 주문 대조 정보를 불러오지 못했습니다.');
        }
        if (!controller.signal.aborted) {
          setErpData({
            customers: Array.isArray(body.customers) ? body.customers : [],
            erpOrders: Array.isArray(body.erpOrders) ? body.erpOrders : [],
            checkedAt: String(body.checkedAt || ''),
          });
          setError('');
        }
      } catch (err) {
        if (!controller.signal.aborted) {
          setError(err.message || 'ERP 주문 대조 조회 실패');
        }
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    }
    loadErpStatus();
    return () => controller.abort();
  }, [scopesParam, refreshTick]);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const onFocus = () => triggerRefresh();
    const onVisibility = () => {
      if (document.visibilityState === 'visible') triggerRefresh();
    };
    const onStorage = (event) => {
      if (event.key === KAKAO_ORDER_SYNC_PING_KEY) triggerRefresh();
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('storage', onStorage);

    let channel = null;
    if (typeof BroadcastChannel !== 'undefined') {
      try {
        channel = new BroadcastChannel(KAKAO_ORDER_SYNC_CHANNEL);
        channel.onmessage = (event) => {
          if (event?.data?.type === 'KAKAO_ORDER_REGISTERED') {
            triggerRefresh();
          }
        };
      } catch {}
    }

    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('storage', onStorage);
      if (channel) {
        try {
          channel.close();
        } catch {}
      }
    };
  }, [triggerRefresh]);

  const evaluated = useMemo(() => {
    const byKey = new Map();
    const list = [];
    const counts = {
      registered: 0,
      diffQty: 0,
      unregistered: 0,
      customerCheck: 0,
      noCustomer: 0,
      cancelled: 0,
      hold: 0,
    };

    for (const entry of scopedEntries) {
      const evaluation = classifyKakaoItemErpStatus(entry.row, {
        messageType: entry.messageType,
        messageKind: entry.messageKind,
        messageText: entry.messageText,
        orderScope,
        defaultYear: entry.defaultYear,
        customers: erpData.customers,
        erpOrders: erpData.erpOrders,
      });
      const enriched = { ...entry, evaluation };
      byKey.set(entry.key, enriched);
      list.push(enriched);

      if (evaluation.status === 'REGISTERED') counts.registered += 1;
      else if (evaluation.status === 'DIFF_QTY') counts.diffQty += 1;
      else if (evaluation.status === 'UNREGISTERED') counts.unregistered += 1;
      else if (evaluation.status === 'CUSTOMER_CHECK') counts.customerCheck += 1;
      else if (evaluation.status === 'NO_CUSTOMER') counts.noCustomer += 1;
      else if (evaluation.status === 'CANCELLED') counts.cancelled += 1;
      else counts.hold += 1;
    }

    return { byKey, list, counts };
  }, [scopedEntries, orderScope, erpData]);

  const selectedEntries = useMemo(
    () => evaluated.list.filter((entry) => selectedKeys.has(entry.key) && entry.evaluation.eligible),
    [evaluated.list, selectedKeys],
  );

  const toggleItem = useCallback(
    (key, nextChecked) => {
      const target = evaluated.byKey.get(key);
      if (!target || !target.evaluation.eligible) return;
      setBridgeNotice('');
      setSelectedKeys((prev) => {
        const next = new Set(prev);
        if (nextChecked) next.add(key);
        else next.delete(key);
        return next;
      });
    },
    [evaluated.byKey],
  );

  const selectAllUnregistered = useCallback(() => {
    const autoKeys = evaluated.list
      .filter((entry) => entry.evaluation.autoSelectable)
      .map((entry) => entry.key);
    setSelectedKeys(new Set(autoKeys));
    setBridgeNotice(
      autoKeys.length > 0
        ? `미등록 주문가능 ${autoKeys.length}건을 선택했습니다. [선택 건 주문등록으로 넘기기]를 눌러 진행하세요.`
        : '현재 선택 가능한 미등록 국내 거래처 발주 건이 없습니다.',
    );
  }, [evaluated.list]);

  const clearSelection = useCallback(() => {
    setSelectedKeys(new Set());
    setBridgeNotice('');
  }, []);

  const handoffToSalesPaste = useCallback(
    (overrideEntries = null) => {
      const entries = Array.isArray(overrideEntries) ? overrideEntries : selectedEntries;
      const payload = buildKakaoOrderHandoffPayload(entries);
      if (!payload.groups.length) {
        setBridgeNotice('주문등록으로 넘길 미등록 국내 거래처 품목을 먼저 선택하세요.');
        return false;
      }
      try {
        localStorage.setItem(KAKAO_ORDER_HANDOFF_KEY, JSON.stringify(payload));
      } catch {
        setBridgeNotice('브라우저 임시 저장소를 사용할 수 없어 주문등록 데이터를 전달하지 못했습니다.');
        return false;
      }

      const first = payload.groups[0];
      const params = new URLSearchParams({
        mode: 'kakao-import',
        year: String(first.year),
        week: String(first.week),
      });
      if (first.custKey) params.set('custKey', String(first.custKey));
      const targetUrl = `/orders/sales-paste?${params.toString()}`;

      const opened = typeof window !== 'undefined' ? window.open(targetUrl, '_blank') : null;
      if (!opened && typeof window !== 'undefined') {
        window.location.assign(targetUrl);
      }
      setBridgeNotice(
        `선택한 ${entries.length}건(${payload.groups.length}개 거래처·차수 묶음)을 영업 주문등록 화면으로 전달했습니다. 등록 완료 후 이 화면의 배지가 자동 갱신됩니다.`,
      );
      return true;
    },
    [selectedEntries],
  );

  return {
    loading,
    error,
    checkedAt: erpData.checkedAt,
    byKey: evaluated.byKey,
    entries: evaluated.list,
    counts: evaluated.counts,
    selectedKeys,
    selectedEntries,
    bridgeNotice,
    triggerRefresh,
    toggleItem,
    selectAllUnregistered,
    clearSelection,
    handoffToSalesPaste,
  };
}

function statusToneClass(status) {
  if (status === 'REGISTERED') return 'is-registered';
  if (status === 'DIFF_QTY') return 'is-diff';
  if (status === 'UNREGISTERED') return 'is-unregistered';
  if (status === 'CUSTOMER_CHECK') return 'is-custcheck';
  if (status === 'NO_CUSTOMER') return 'is-nocust';
  return 'is-muted';
}

export function KakaoOrderRegisterPanel({ bridge, onFocusMessage }) {
  const [expanded, setExpanded] = useState(false);
  const [tableFilter, setTableFilter] = useState('actionable');

  if (!bridge) return null;
  const {
    loading,
    error,
    counts,
    entries,
    selectedKeys,
    selectedEntries,
    bridgeNotice,
    triggerRefresh,
    toggleItem,
    selectAllUnregistered,
    clearSelection,
    handoffToSalesPaste,
  } = bridge;

  const domesticEntries = entries.filter((e) =>
    ['REGISTERED', 'DIFF_QTY', 'UNREGISTERED', 'CUSTOMER_CHECK'].includes(e.evaluation.status),
  );
  const filteredRows = domesticEntries.filter((e) => {
    if (tableFilter === 'actionable') {
      return e.evaluation.status === 'UNREGISTERED' || e.evaluation.status === 'CUSTOMER_CHECK';
    }
    if (tableFilter === 'registered') {
      return e.evaluation.status === 'REGISTERED' || e.evaluation.status === 'DIFF_QTY';
    }
    return true;
  });

  return (
    <section className="kakao-erp-bridge" aria-label="국내 거래처 주문등록 대조 및 반자동 전달">
      <div className="kakao-erp-bridge-top">
        <div className="kakao-erp-bridge-title">
          <strong>국내 거래처 주문등록 대조</strong>
          <span className="kakao-erp-axis-note">
            해외 농장 합계와는 별도로 거래처가 지정된 발주의 전산(OrderMaster) 반영 여부만 대조합니다
          </span>
        </div>
        <div className="kakao-erp-bridge-actions">
          <button type="button" onClick={triggerRefresh} disabled={loading}>
            {loading ? '전산 대조 중…' : '전산 대조 새로고침'}
          </button>
          <button
            type="button"
            onClick={selectAllUnregistered}
            disabled={counts.unregistered === 0}
          >
            미등록 건 전체 선택 ({counts.unregistered})
          </button>
          {selectedEntries.length > 0 && (
            <button type="button" onClick={clearSelection}>
              선택 해제
            </button>
          )}
          <button
            type="button"
            className="kakao-erp-handoff-btn"
            disabled={selectedEntries.length === 0}
            onClick={() => handoffToSalesPaste()}
          >
            선택 건 주문등록으로 넘기기 ({selectedEntries.length}건)
          </button>
        </div>
      </div>

      <div className="kakao-erp-pills" role="group" aria-label="전산 주문등록 대조 요약">
        <span className="kakao-erp-pill is-registered">
          ERP 등록완료 <b>{counts.registered}</b>건
        </span>
        <span className="kakao-erp-pill is-diff">
          수량차이 <b>{counts.diffQty}</b>건
        </span>
        <span className="kakao-erp-pill is-unregistered">
          미등록 · 주문가능 <b>{counts.unregistered}</b>건
        </span>
        {counts.customerCheck > 0 && (
          <span className="kakao-erp-pill is-custcheck">
            거래처확인 <b>{counts.customerCheck}</b>건
          </span>
        )}
        <span className="kakao-erp-pill is-nocust">
          산지선발주 · 업체미지정 <b>{counts.noCustomer}</b>건
        </span>
        {domesticEntries.length > 0 && (
          <button
            type="button"
            className="kakao-erp-expand-btn"
            aria-expanded={expanded}
            onClick={() => setExpanded((prev) => !prev)}
          >
            {expanded ? '국내 거래처 대조 목록 접기 ▴' : `국내 거래처 대조 목록 보기 (${domesticEntries.length}건) ▾`}
          </button>
        )}
      </div>

      {error && (
        <p className="kakao-erp-alert" role="alert">
          {error}
        </p>
      )}
      {bridgeNotice && (
        <p className="kakao-erp-notice" role="status">
          {bridgeNotice}
        </p>
      )}

      {expanded && domesticEntries.length > 0 && (
        <div className="kakao-erp-table-box">
          <div className="kakao-erp-filter-bar" role="group" aria-label="대조 목록 필터">
            <button
              type="button"
              aria-pressed={tableFilter === 'actionable'}
              onClick={() => setTableFilter('actionable')}
            >
              미등록 · 확인필요 ({counts.unregistered + counts.customerCheck})
            </button>
            <button
              type="button"
              aria-pressed={tableFilter === 'registered'}
              onClick={() => setTableFilter('registered')}
            >
              ERP 등록완료 · 수량차이 ({counts.registered + counts.diffQty})
            </button>
            <button
              type="button"
              aria-pressed={tableFilter === 'all'}
              onClick={() => setTableFilter('all')}
            >
              전체 국내 거래처 건 ({domesticEntries.length})
            </button>
          </div>

          {filteredRows.length === 0 ? (
            <p className="kakao-erp-empty">해당 조건의 국내 거래처 발주 내역이 없습니다.</p>
          ) : (
            <div className="kakao-erp-table-scroll">
              <table className="kakao-erp-table">
                <thead>
                  <tr>
                    <th scope="col">주문선택</th>
                    <th scope="col">전산 상태</th>
                    <th scope="col">등록 차수</th>
                    <th scope="col">거래처 (CL)</th>
                    <th scope="col">국가 · 품목 · 수량</th>
                    <th scope="col">카톡 시각</th>
                    <th scope="col">동작</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.map((entry) => {
                    const { row, evaluation, message } = entry;
                    const checked = selectedKeys.has(entry.key) && evaluation.eligible;
                    const cust = evaluation.customerMatch?.customer;
                    const custDisplay = cust
                      ? `${cust.CustName}${cust.OrderCode ? ` (${cust.OrderCode})` : ''}`
                      : evaluation.customerMatch?.rawCustomer || row.customer || '-';
                    const scopeDisplay = evaluation.scope?.valid
                      ? `${evaluation.scope.year}/${evaluation.scope.orderWeek}${evaluation.scope.majorWeekOnly ? ' (세부차수 확인)' : ''}`
                      : `${row.year || ''}/${row.week || '-'}`;
                    return (
                      <tr key={entry.key}>
                        <td className="col-check">
                          <input
                            type="checkbox"
                            disabled={!evaluation.eligible}
                            checked={checked}
                            aria-label={`${custDisplay} ${row.product} 주문등록 선택`}
                            onChange={(e) => toggleItem(entry.key, e.target.checked)}
                          />
                        </td>
                        <td>
                          <span
                            className={`kakao-erp-badge ${statusToneClass(evaluation.status)}`}
                            title={evaluation.detailLabel}
                          >
                            {evaluation.badgeLabel}
                          </span>
                        </td>
                        <td className="col-cycle">{scopeDisplay}</td>
                        <td className="col-cust">{custDisplay}</td>
                        <td className="col-prod">
                          {[row.country, row.group].filter(Boolean).join(' ')} · <b>{row.product}</b>{' '}
                          <span>
                            {row.quantity}
                            {row.unit}
                          </span>
                        </td>
                        <td className="col-time">{message.time}</td>
                        <td className="col-act">
                          {evaluation.eligible && (
                            <button
                              type="button"
                              className="kakao-erp-mini-btn"
                              onClick={() => handoffToSalesPaste([entry])}
                            >
                              단건 넘기기
                            </button>
                          )}
                          {onFocusMessage && (
                            <button
                              type="button"
                              className="kakao-erp-mini-btn"
                              onClick={() => onFocusMessage(message.id)}
                            >
                              원문 위치
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      <style jsx global>{`
        .kakao-erp-bridge {
          margin: 0 0 10px;
          padding: 10px 12px;
          border: 1px solid #cbd5e1;
          border-radius: 10px;
          background: #ffffff;
          font-family: 'Pretendard Variable', 'Pretendard', -apple-system, BlinkMacSystemFont, 'Malgun Gothic', '맑은 고딕', 'Segoe UI', sans-serif;
          font-variant-numeric: tabular-nums;
        }
        .kakao-erp-bridge-top {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
        }
        .kakao-erp-bridge-title {
          display: flex;
          flex-wrap: wrap;
          align-items: baseline;
          gap: 8px;
        }
        .kakao-erp-bridge-title strong {
          font-size: 14.5px;
          color: #0f172a;
        }
        .kakao-erp-axis-note {
          font-size: 12.5px;
          color: #475569;
        }
        .kakao-erp-bridge-actions {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 6px;
        }
        .kakao-additions .kakao-erp-bridge-actions .kakao-erp-handoff-btn {
          background: #0f766e;
          border-color: #0f766e;
          color: #ffffff;
          font-weight: 700;
        }
        .kakao-additions .kakao-erp-bridge-actions .kakao-erp-handoff-btn:hover:not(:disabled) {
          background: #115e59;
          border-color: #115e59;
        }
        .kakao-erp-pills {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 6px;
          margin-top: 8px;
        }
        .kakao-erp-pill,
        .kakao-erp-badge {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          padding: 3px 8px;
          border-radius: 6px;
          font-size: 12.5px;
          font-weight: 600;
          line-height: 1.35;
          border: 1px solid #cbd5e1;
          background: #f8fafc;
          color: #334155;
          font-variant-numeric: tabular-nums;
        }
        .kakao-erp-pill.is-registered,
        .kakao-erp-badge.is-registered {
          background: #ecfdf5;
          border-color: #a7f3d0;
          color: #065f46;
        }
        .kakao-erp-pill.is-diff,
        .kakao-erp-badge.is-diff {
          background: #fffbeb;
          border-color: #fde68a;
          color: #92400e;
        }
        .kakao-erp-pill.is-unregistered,
        .kakao-erp-badge.is-unregistered {
          background: #eff6ff;
          border-color: #bfdbfe;
          color: #1d4ed8;
        }
        .kakao-erp-pill.is-custcheck,
        .kakao-erp-badge.is-custcheck {
          background: #f8fafc;
          border-color: #94a3b8;
          color: #1e293b;
        }
        .kakao-erp-pill.is-nocust,
        .kakao-erp-badge.is-nocust {
          background: #f1f5f9;
          border-color: #cbd5e1;
          color: #475569;
        }
        .kakao-additions .kakao-erp-expand-btn {
          margin-left: auto;
          padding: 4px 9px;
          font-size: 12.5px;
          font-weight: 600;
        }
        .kakao-erp-alert {
          margin: 6px 0 0;
          padding: 6px 9px;
          border-radius: 6px;
          background: #fffbeb;
          border: 1px solid #fde68a;
          color: #92400e;
          font-size: 13px;
        }
        .kakao-erp-notice {
          margin: 6px 0 0;
          padding: 6px 9px;
          border-radius: 6px;
          background: #f0fdf4;
          border: 1px solid #bbf7d0;
          color: #166534;
          font-size: 13px;
        }
        .kakao-erp-table-box {
          margin-top: 8px;
          padding-top: 8px;
          border-top: 1px solid #e2e8f0;
        }
        .kakao-erp-filter-bar {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
          margin-bottom: 8px;
        }
        .kakao-erp-table-scroll {
          max-height: 270px;
          overflow: auto;
          border: 1px solid #e2e8f0;
          border-radius: 6px;
        }
        .kakao-erp-table {
          width: 100%;
          border-collapse: collapse;
          font-size: 13px;
          background: #ffffff;
        }
        .kakao-erp-table th,
        .kakao-erp-table td {
          padding: 6px 8px;
          border-bottom: 1px solid #e2e8f0;
          text-align: left;
          vertical-align: middle;
        }
        .kakao-erp-table th {
          position: sticky;
          top: 0;
          background: #f8fafc;
          color: #334155;
          font-size: 12.5px;
          font-weight: 700;
          z-index: 1;
        }
        .kakao-erp-table .col-check {
          width: 64px;
          text-align: center;
        }
        .kakao-erp-table .col-cycle,
        .kakao-erp-table .col-time {
          white-space: nowrap;
          font-size: 12.5px;
          color: #475569;
        }
        .kakao-erp-table .col-act {
          white-space: nowrap;
          display: flex;
          gap: 4px;
        }
        .kakao-additions .kakao-erp-mini-btn {
          padding: 3px 7px;
          font-size: 12.5px;
        }
        .kakao-erp-empty {
          margin: 4px 0;
          color: #475569;
          font-size: 13px;
        }
        .kakao-msg-erp-list {
          margin: 6px 0;
          padding: 6px 8px;
          border: 1px solid #e2e8f0;
          border-radius: 6px;
          background: #ffffff;
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .kakao-msg-erp-row {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          justify-content: space-between;
          gap: 6px;
          font-size: 13px;
        }
        .kakao-msg-erp-label {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          color: #0f172a;
          cursor: pointer;
        }
        .kakao-msg-erp-label.is-disabled {
          cursor: default;
          color: #475569;
        }
        .kakao-msg-erp-cust {
          font-weight: 700;
          color: #1e293b;
        }
      `}</style>
    </section>
  );
}

export function KakaoMessageErpSummary({ message, visibleItems = [], viewItem, bridge }) {
  if (!bridge || !visibleItems.length) return null;

  const rows = visibleItems
    .map((base) => {
      const row = viewItem ? viewItem(base) : base;
      const entry = bridge.byKey.get(row.key);
      return entry ? { row, evaluation: entry.evaluation } : null;
    })
    .filter(Boolean);

  if (!rows.length) return null;

  return (
    <div className="kakao-msg-erp-list" aria-label="이 원문의 전산 주문등록 상태">
      {rows.map(({ row, evaluation }) => {
        if (evaluation.status === 'CANCELLED') return null;
        const checked = bridge.selectedKeys.has(row.key) && evaluation.eligible;
        const custLabel =
          evaluation.customerMatch?.customer?.CustName ||
          evaluation.customerMatch?.rawCustomer ||
          row.customer ||
          '산지선발주';
        return (
          <div key={row.key} className="kakao-msg-erp-row">
            <label className={`kakao-msg-erp-label ${evaluation.eligible ? '' : 'is-disabled'}`}>
              <input
                type="checkbox"
                disabled={!evaluation.eligible}
                checked={checked}
                aria-label={`${message.id} ${custLabel} ${row.product} 주문등록 선택`}
                onChange={(e) => bridge.toggleItem(row.key, e.target.checked)}
              />
              <span className="kakao-msg-erp-cust">[{custLabel}]</span>
              <span>
                {row.product} {row.quantity}
                {row.unit}
              </span>
            </label>
            <span
              className={`kakao-erp-badge ${statusToneClass(evaluation.status)}`}
              title={evaluation.detailLabel}
            >
              {evaluation.badgeLabel}
            </span>
          </div>
        );
      })}
    </div>
  );
}
