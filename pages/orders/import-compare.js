import { useState, useEffect, useMemo, useCallback, Fragment } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { apiGet } from '../../lib/useApi';
import { mergeBaselineCandidates, buildCompareRows, roundQty } from '../../lib/orderImportCompareLogic';

const FONT_STACK = "'Pretendard Variable', 'Pretendard', -apple-system, BlinkMacSystemFont, 'Malgun Gothic', '맑은 고딕', 'Segoe UI', sans-serif";

const ROW_STATUS_STYLE = {
  SAME: {
    bg: '#ffffff',
    color: '#64748b',
    borderLeft: '3px solid transparent',
    badgeBg: '#f1f5f9',
    badgeColor: '#475569',
  },
  INCREASED: {
    bg: '#eff6ff',
    color: '#1d4ed8',
    borderLeft: '3px solid #2563eb',
    badgeBg: '#dbeafe',
    badgeColor: '#1d4ed8',
  },
  DECREASED: {
    bg: '#fffbeb',
    color: '#b45309',
    borderLeft: '3px solid #d97706',
    badgeBg: '#fef3c7',
    badgeColor: '#b45309',
  },
  UNALLOCATED: {
    bg: '#fef2f2',
    color: '#b91c1c',
    borderLeft: '3px solid #dc2626',
    badgeBg: '#fee2e2',
    badgeColor: '#b91c1c',
  },
  ADDED: {
    bg: '#f0fdfa',
    color: '#0f766e',
    borderLeft: '3px solid #0d9488',
    badgeBg: '#ccfbf1',
    badgeColor: '#0f766e',
  },
};

function formatSubWeekButtonLabel(orderWeek) {
  const m = String(orderWeek || '').match(/^(\d{2})-(\d{2})$/);
  if (!m) return String(orderWeek || '');
  return `${orderWeek} (${Number(m[2])}차)`;
}

function formatKstTimestamp(ts) {
  const s = String(ts || '').replace('T', ' ').trim();
  return s.slice(0, 16) || '-';
}

function formatDiffText(row) {
  if (row.status === 'SAME') return '0';
  if (row.status === 'UNALLOCATED') return `미분배 (${row.diff})`;
  if (row.status === 'ADDED') return `신규 (+${row.diff})`;
  if (row.diff > 0) return `+${row.diff}`;
  return String(row.diff);
}

export default function OrderImportComparePage() {
  const router = useRouter();

  const [years, setYears] = useState([]);
  const [weeks, setWeeks] = useState([]);
  const [customersInWeek, setCustomersInWeek] = useState([]);

  const [orderYear, setOrderYear] = useState('');
  const [orderWeek, setOrderWeek] = useState('');
  const [custKey, setCustKey] = useState('');
  const [custLabel, setCustLabel] = useState('');

  const [custQuery, setCustQuery] = useState('');
  const [customerScope, setCustomerScope] = useState('shipment');
  const [selectedManager, setSelectedManager] = useState('ALL');
  const [custSearchResults, setCustSearchResults] = useState([]);
  const [custSearching, setCustSearching] = useState(false);

  const [optionsLoading, setOptionsLoading] = useState(false);
  const [compareLoading, setCompareLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const [compareData, setCompareData] = useState(null);
  const [selectedCandidateIds, setSelectedCandidateIds] = useState([]);
  const [expandedPreviewIds, setExpandedPreviewIds] = useState(() => new Set());

  const [onlyChanged, setOnlyChanged] = useState(false);
  const [productSearch, setProductSearch] = useState('');
  const [showAllExcelCols, setShowAllExcelCols] = useState(false);
  const [initializedFromQuery, setInitializedFromQuery] = useState(false);

  const loadOptions = useCallback(async (targetYear = '', targetWeek = '') => {
    setOptionsLoading(true);
    try {
      const data = await apiGet('/api/orders/import-compare', {
        action: 'options',
        orderYear: targetYear || undefined,
        orderWeek: targetWeek || undefined,
      });
      if (!data?.success) throw new Error(data?.error || '옵션 조회 실패');
      setYears(data.years || []);
      setWeeks(data.weeks || []);
      setCustomersInWeek(data.customers || []);
      const resolvedYear = String(data.orderYear || targetYear || '');
      if (resolvedYear) setOrderYear(resolvedYear);
      return data;
    } catch (err) {
      setErrorMsg(err.message || '조회 옵션을 불러오지 못했습니다.');
      return null;
    } finally {
      setOptionsLoading(false);
    }
  }, []);

  const fetchCompare = useCallback(async (yr, wk, ck) => {
    if (!yr || !wk || !ck) return;
    setCompareLoading(true);
    setErrorMsg('');
    try {
      const data = await apiGet('/api/orders/import-compare', {
        orderYear: yr,
        orderWeek: wk,
        custKey: ck,
      });
      if (!data?.success) throw new Error(data?.error || '비교 데이터 조회 실패');
      setCompareData(data);
      if (data.customer?.custName) {
        setCustLabel(data.customer.custName);
      }

      const list = data.candidates || [];
      const firstUpload = list.find((c) => c.sourceKind === 'UPLOAD');
      const firstOrderDate = list.find((c) => c.sourceKind === 'ORDER_DATE');
      if (firstUpload) {
        setSelectedCandidateIds([firstUpload.id]);
      } else if (firstOrderDate) {
        setSelectedCandidateIds([firstOrderDate.id]);
      } else {
        setSelectedCandidateIds([]);
      }
      setExpandedPreviewIds(new Set());
    } catch (err) {
      setCompareData(null);
      setSelectedCandidateIds([]);
      setErrorMsg(err.message || '비교 데이터를 불러오지 못했습니다.');
    } finally {
      setCompareLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!router.isReady || initializedFromQuery) return;
    setInitializedFromQuery(true);
    const qYear = String(router.query.year || '').trim();
    const qWeek = String(router.query.week || '').trim();
    const qCust = String(router.query.custKey || '').trim();

    (async () => {
      const opt = await loadOptions(qYear, qWeek);
      let latestOpt = opt;
      const yr = qYear || String(opt?.orderYear || '');
      const wk = qWeek || opt?.weeks?.[0]?.orderWeek || '';
      if (yr) setOrderYear(yr);
      if (wk) {
        setOrderWeek(wk);
        if (!qWeek && yr) {
          latestOpt = (await loadOptions(yr, wk)) || opt;
        }
      }
      if (qCust && yr && wk) {
        const matched = (latestOpt?.customers || []).find(
          (c) => String(c.custKey) === qCust,
        );
        if (!matched || !matched.hasShipment) {
          setCustomerScope('all');
        }
        setCustKey(qCust);
        await fetchCompare(yr, wk, qCust);
      }
    })();
  }, [router.isReady, router.query, initializedFromQuery, loadOptions, fetchCompare]);

  const handleYearChange = async (nextYear) => {
    setOrderYear(nextYear);
    setOrderWeek('');
    setCustKey('');
    setCustLabel('');
    setCompareData(null);
    setSelectedCandidateIds([]);
    const opt = await loadOptions(nextYear, '');
    const firstWk = opt?.weeks?.[0]?.orderWeek || '';
    if (firstWk) {
      setOrderWeek(firstWk);
      await loadOptions(nextYear, firstWk);
    }
  };

  const handleWeekChange = async (nextWeek) => {
    if (!nextWeek) return;
    setOrderWeek(nextWeek);
    setCompareData(null);
    setSelectedCandidateIds([]);
    const opt = await loadOptions(orderYear, nextWeek);
    const nextCustomers = opt?.customers || [];
    const matched = custKey
      ? nextCustomers.find((c) => String(c.custKey) === String(custKey))
      : null;
    if (matched) {
      if (!matched.hasShipment && customerScope === 'shipment') {
        setCustomerScope('all');
      }
      await fetchCompare(orderYear, nextWeek, custKey);
    } else {
      setCustKey('');
      setCustLabel('');
    }
  };

  const handleParentWeekChange = async (nextParentWeek) => {
    if (!nextParentWeek) return;
    const candidatesInParent = weeks
      .filter(
        (w) =>
          String(w.parentWeek || String(w.orderWeek || '').slice(0, 2)) ===
          String(nextParentWeek),
      )
      .slice()
      .sort(
        (a, b) =>
          Number(String(a.orderWeek).slice(3)) - Number(String(b.orderWeek).slice(3)),
      );
    const targetWeek = candidatesInParent[0]?.orderWeek || '';
    if (targetWeek) {
      await handleWeekChange(targetWeek);
    }
  };

  const handleSelectCustomer = async (nextCustKey, nextCustName = '') => {
    const keyStr = String(nextCustKey);
    setCustKey(keyStr);
    if (nextCustName) setCustLabel(nextCustName);
    setCustSearchResults([]);
    const inWeek = customersInWeek.find((c) => String(c.custKey) === keyStr);
    if (inWeek && !inWeek.hasShipment && customerScope === 'shipment') {
      setCustomerScope('all');
    }
    if (orderYear && orderWeek && nextCustKey) {
      await fetchCompare(orderYear, orderWeek, nextCustKey);
    }
  };

  const parentWeeks = useMemo(() => {
    const seen = new Set();
    const list = [];
    for (const w of weeks) {
      const pw = String(w.parentWeek || String(w.orderWeek || '').slice(0, 2));
      if (!pw || seen.has(pw)) continue;
      seen.add(pw);
      list.push({
        parentWeek: pw,
        label: `${Number(pw)}주차 (${pw})`,
      });
    }
    return list;
  }, [weeks]);

  const activeParentWeek = useMemo(() => {
    if (orderWeek) {
      const pw = String(orderWeek).slice(0, 2);
      if (pw) return pw;
    }
    return parentWeeks[0]?.parentWeek || '';
  }, [orderWeek, parentWeeks]);

  const subWeeksInParent = useMemo(() => {
    if (!activeParentWeek) return [];
    return weeks
      .filter(
        (w) =>
          String(w.parentWeek || String(w.orderWeek || '').slice(0, 2)) ===
          activeParentWeek,
      )
      .slice()
      .sort(
        (a, b) =>
          Number(String(a.orderWeek).slice(3)) - Number(String(b.orderWeek).slice(3)),
      );
  }, [weeks, activeParentWeek]);

  const shipmentCustomersCount = useMemo(
    () => customersInWeek.filter((c) => c.hasShipment).length,
    [customersInWeek],
  );

  const scopedCustomers = useMemo(
    () =>
      customerScope === 'shipment'
        ? customersInWeek.filter((c) => c.hasShipment)
        : customersInWeek,
    [customersInWeek, customerScope],
  );

  const managerOptions = useMemo(() => {
    const counts = new Map();
    for (const c of scopedCustomers) {
      const mgr = String(c.manager || '').trim() || '담당자 미지정';
      counts.set(mgr, (counts.get(mgr) || 0) + 1);
    }
    const list = [...counts.entries()].map(([name, count]) => ({ name, count }));
    list.sort((a, b) => {
      const aUnassigned = a.name === '담당자 미지정';
      const bUnassigned = b.name === '담당자 미지정';
      if (aUnassigned !== bUnassigned) return aUnassigned ? 1 : -1;
      if (b.count !== a.count) return b.count - a.count;
      return a.name.localeCompare(b.name, 'ko');
    });
    return list;
  }, [scopedCustomers]);

  useEffect(() => {
    if (selectedManager === 'ALL') return;
    if (!managerOptions.some((m) => m.name === selectedManager)) {
      setSelectedManager('ALL');
    }
  }, [managerOptions, selectedManager]);

  const filteredCustomers = useMemo(() => {
    const q = custQuery.trim().toLowerCase();
    return scopedCustomers.filter((c) => {
      const mgr = String(c.manager || '').trim() || '담당자 미지정';
      if (selectedManager !== 'ALL' && mgr !== selectedManager) return false;
      if (!q) return true;
      const hay = [c.custName, c.custArea, mgr].filter(Boolean).join(' ').toLowerCase();
      return hay.includes(q);
    });
  }, [scopedCustomers, selectedManager, custQuery]);

  useEffect(() => {
    const trimmed = String(custQuery || '').trim();
    if (!trimmed || filteredCustomers.length > 0) {
      setCustSearchResults([]);
      setCustSearching(false);
      return undefined;
    }

    let cancelled = false;
    const timer = setTimeout(async () => {
      setCustSearching(true);
      try {
        const d = await apiGet('/api/customers/search', { q: trimmed });
        if (!cancelled) {
          setCustSearchResults(d.customers || []);
        }
      } catch {
        if (!cancelled) {
          setCustSearchResults([]);
        }
      } finally {
        if (!cancelled) {
          setCustSearching(false);
        }
      }
    }, 180);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [custQuery, filteredCustomers.length]);

  const candidates = useMemo(() => compareData?.candidates || [], [compareData]);

  const toggleCandidate = (id) => {
    setSelectedCandidateIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  const togglePreview = (id) => {
    setExpandedPreviewIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectEarliestOne = () => {
    const firstUpload = candidates.find((c) => c.sourceKind === 'UPLOAD');
    const firstOrder = candidates.find((c) => c.sourceKind === 'ORDER_DATE');
    const target = firstUpload || firstOrder;
    setSelectedCandidateIds(target ? [target.id] : []);
  };

  const selectAllUploads = () => {
    setSelectedCandidateIds(candidates.filter((c) => c.sourceKind === 'UPLOAD').map((c) => c.id));
  };

  const selectAllOrderDates = () => {
    setSelectedCandidateIds(candidates.filter((c) => c.sourceKind === 'ORDER_DATE').map((c) => c.id));
  };

  const clearCandidates = () => {
    setSelectedCandidateIds([]);
  };

  const selectedCandidates = useMemo(
    () => candidates.filter((c) => selectedCandidateIds.includes(c.id)),
    [candidates, selectedCandidateIds],
  );

  const duplicateDateOverlapDates = useMemo(() => {
    const uploadDates = new Set(
      selectedCandidates.filter((c) => c.sourceKind === 'UPLOAD' && c.dateKey).map((c) => c.dateKey),
    );
    const orderDates = new Set(
      selectedCandidates.filter((c) => c.sourceKind === 'ORDER_DATE' && c.dateKey).map((c) => c.dateKey),
    );
    return [...uploadDates].filter((d) => orderDates.has(d));
  }, [selectedCandidates]);

  const mergedBaseline = useMemo(
    () => mergeBaselineCandidates(selectedCandidates),
    [selectedCandidates],
  );

  const compareResult = useMemo(
    () => buildCompareRows(mergedBaseline, compareData?.shipmentItems || []),
    [mergedBaseline, compareData],
  );

  const { rows: allRows, summary } = compareResult;

  const filteredRows = useMemo(() => {
    const q = productSearch.trim().toLowerCase();
    return allRows.filter((row) => {
      if (onlyChanged && row.status === 'SAME') return false;
      if (!q) return true;
      const haystack = [
        row.inputName,
        row.prodName,
        row.displayName,
        row.colorOrDetail,
        row.note,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [allRows, onlyChanged, productSearch]);

  const mainRows = useMemo(
    () => filteredRows.filter((r) => r.status !== 'ADDED'),
    [filteredRows],
  );
  const addedRows = useMemo(
    () => filteredRows.filter((r) => r.status === 'ADDED'),
    [filteredRows],
  );

  const canShowExcelCols = Boolean(
    mergedBaseline.isSingleUpload && mergedBaseline.excelHeaders?.length,
  );
  const effectiveShowExcelCols = showAllExcelCols && canShowExcelCols;
  const leftColCount = effectiveShowExcelCols
    ? 2 + mergedBaseline.excelHeaders.length + 2
    : 7;

  const renderTableRow = (row, idx) => {
    const st = ROW_STATUS_STYLE[row.status] || ROW_STATUS_STYLE.SAME;
    const rowLabel = row.rowNos?.length
      ? row.rowNos.join(', ')
      : row.rowNo != null
        ? String(row.rowNo)
        : '-';
    const erpTitle = row.displayName || row.prodName || '';
    const showErpSub = Boolean(
      erpTitle &&
        row.inputName &&
        erpTitle.replace(/\s+/g, '').toLowerCase() !==
          row.inputName.replace(/\s+/g, '').toLowerCase(),
    );
    const hasConversion =
      row.sources?.length === 1 &&
      row.sources[0].unit !== row.outUnit &&
      row.sources[0].qty !== row.baselineQty;

    return (
      <tr
        key={`${row.prodKey || 'n'}-${row.status}-${idx}`}
        style={{ background: st.bg, color: st.color }}
      >
        <td
          style={{
            padding: '8px 10px',
            borderBottom: '1px solid #e2e8f0',
            borderLeft: st.borderLeft,
            fontVariantNumeric: 'tabular-nums',
            color: '#475569',
            whiteSpace: 'nowrap',
            textAlign: 'center',
          }}
        >
          {rowLabel}
        </td>

        {effectiveShowExcelCols ? (
          <>
            {mergedBaseline.excelHeaders.map((_, cIdx) => (
              <td
                key={`raw-${cIdx}`}
                style={{
                  padding: '8px 10px',
                  borderBottom: '1px solid #e2e8f0',
                  color: '#0f172a',
                  maxWidth: 220,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
                title={String(row.rawCells?.[cIdx] ?? '')}
              >
                {row.rawCells?.[cIdx] ?? ''}
              </td>
            ))}
            <td style={{ padding: '8px 10px', borderBottom: '1px solid #e2e8f0', color: '#0f172a' }}>
              <div style={{ fontWeight: 600 }}>{erpTitle || row.inputName || '-'}</div>
            </td>
            <td
              style={{
                padding: '8px 10px',
                borderBottom: '1px solid #e2e8f0',
                borderRight: '2px solid #94a3b8',
                textAlign: 'right',
                fontWeight: 700,
                fontVariantNumeric: 'tabular-nums',
                color: '#0f172a',
                whiteSpace: 'nowrap',
              }}
            >
              {row.baselineQty} {row.outUnit}
            </td>
          </>
        ) : (
          <>
            <td style={{ padding: '8px 10px', borderBottom: '1px solid #e2e8f0', color: '#0f172a' }}>
              <div style={{ fontWeight: 600 }}>{row.inputName || erpTitle || '-'}</div>
              {showErpSub && (
                <div style={{ fontSize: 12.5, color: '#475569', marginTop: 2 }}>
                  ERP: {erpTitle}
                </div>
              )}
            </td>
            <td style={{ padding: '8px 10px', borderBottom: '1px solid #e2e8f0', color: '#334155' }}>
              {row.colorOrDetail || '-'}
            </td>
            <td
              style={{
                padding: '8px 10px',
                borderBottom: '1px solid #e2e8f0',
                color: '#334155',
                whiteSpace: 'nowrap',
              }}
            >
              <span>{row.outUnit || row.unit}</span>
              {row.unitMixed && (
                <span
                  style={{
                    marginLeft: 6,
                    padding: '1px 6px',
                    borderRadius: 4,
                    background: '#fef3c7',
                    color: '#92400e',
                    fontSize: 12.5,
                    fontWeight: 600,
                  }}
                >
                  단위혼재
                </span>
              )}
            </td>
            <td
              style={{
                padding: '8px 10px',
                borderBottom: '1px solid #e2e8f0',
                textAlign: 'right',
                fontWeight: 700,
                fontVariantNumeric: 'tabular-nums',
                color: '#0f172a',
                whiteSpace: 'nowrap',
              }}
            >
              <div>{row.baselineQty}</div>
              {hasConversion && (
                <div style={{ fontSize: 12.5, fontWeight: 400, color: '#475569' }}>
                  원본 {row.sources[0].qty}
                  {row.sources[0].unit} → {row.baselineQty}
                  {row.outUnit}
                </div>
              )}
              {row.sources?.length > 1 && (
                <div style={{ fontSize: 12.5, fontWeight: 400, color: '#475569', marginTop: 2 }}>
                  {row.sources
                    .map((s) => `${s.dateKey ? s.dateKey.slice(5) : s.label}: ${s.outQty}`)
                    .join(' + ')}
                </div>
              )}
            </td>
            <td
              style={{
                padding: '8px 10px',
                borderBottom: '1px solid #e2e8f0',
                textAlign: 'right',
                fontVariantNumeric: 'tabular-nums',
                color: '#334155',
                whiteSpace: 'nowrap',
              }}
            >
              {row.unitPrice > 0 ? Number(row.unitPrice).toLocaleString() : '-'}
            </td>
            <td
              style={{
                padding: '8px 10px',
                borderBottom: '1px solid #e2e8f0',
                borderRight: '2px solid #94a3b8',
                color: '#475569',
                maxWidth: 240,
              }}
            >
              {row.note || '-'}
            </td>
          </>
        )}

        <td
          style={{
            padding: '8px 10px',
            borderBottom: '1px solid #e2e8f0',
            textAlign: 'right',
            fontWeight: 700,
            fontVariantNumeric: 'tabular-nums',
            whiteSpace: 'nowrap',
          }}
        >
          {row.shipQty}
        </td>
        <td
          style={{
            padding: '8px 10px',
            borderBottom: '1px solid #e2e8f0',
            textAlign: 'right',
            fontWeight: 800,
            fontVariantNumeric: 'tabular-nums',
            whiteSpace: 'nowrap',
          }}
        >
          {formatDiffText(row)}
        </td>
        <td
          style={{
            padding: '8px 10px',
            borderBottom: '1px solid #e2e8f0',
            textAlign: 'center',
            whiteSpace: 'nowrap',
          }}
        >
          <span
            style={{
              display: 'inline-block',
              padding: '3px 8px',
              borderRadius: 4,
              background: st.badgeBg,
              color: st.badgeColor,
              fontSize: 12.5,
              fontWeight: 700,
            }}
          >
            {row.statusLabel}
          </span>
        </td>
      </tr>
    );
  };

  return (
    <div
      style={{
        fontFamily: FONT_STACK,
        maxWidth: 1680,
        margin: '0 auto',
        padding: '16px 20px 80px',
        color: '#0f172a',
        fontSize: 14,
      }}
    >
      {/* 1. 목적 우선 헤더 */}
      <div
        style={{
          background: '#ffffff',
          border: '1px solid #cbd5e1',
          borderLeft: '4px solid #1e3a8a',
          borderRadius: 6,
          padding: '14px 18px',
          marginBottom: 14,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          gap: 16,
          flexWrap: 'wrap',
        }}
      >
        <div>
          <div
            style={{
              fontSize: 12.5,
              fontWeight: 700,
              color: '#1e3a8a',
              letterSpacing: '0.03em',
              marginBottom: 4,
            }}
          >
            핵심 목적 · PURPOSE
          </div>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 800, color: '#0f172a' }}>
            최초주문등록 과 분배 비교
          </h1>
          <p style={{ margin: '6px 0 0', fontSize: 13.5, color: '#334155' }}>
            세부차수(1차·2차 등) 기준으로 최초주문등록 수량과 현재 출고분배 수량을 대조해 변경값만 확인합니다.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <Link
            href="/orders/import"
            style={{
              display: 'inline-block',
              padding: '8px 14px',
              borderRadius: 6,
              border: '1px solid #cbd5e1',
              background: '#f8fafc',
              color: '#0f172a',
              fontSize: 13.5,
              fontWeight: 600,
              textDecoration: 'none',
            }}
          >
            ← 업로드 주문등록
          </Link>
        </div>
      </div>

      {/* 2. 상단 필터 바 (연도 · 대차수 · 세부차수 버튼) */}
      <div
        style={{
          background: '#ffffff',
          border: '1px solid #cbd5e1',
          borderRadius: 6,
          padding: '14px 18px',
          marginBottom: 12,
        }}
      >
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div>
            <label
              htmlFor="compare-year"
              style={{ display: 'block', fontSize: 12.5, fontWeight: 700, color: '#334155', marginBottom: 4 }}
            >
              연도
            </label>
            <select
              id="compare-year"
              value={orderYear}
              onChange={(e) => void handleYearChange(e.target.value)}
              style={{
                padding: '7px 10px',
                border: '1px solid #cbd5e1',
                borderRadius: 6,
                fontSize: 13.5,
                fontFamily: FONT_STACK,
                fontVariantNumeric: 'tabular-nums',
                background: '#ffffff',
                color: '#0f172a',
              }}
            >
              {years.length === 0 && <option value="">연도 선택</option>}
              {years.map((yr) => (
                <option key={yr} value={String(yr)}>
                  {yr}년
                </option>
              ))}
            </select>
          </div>

          <div>
            <label
              htmlFor="compare-parent-week"
              style={{ display: 'block', fontSize: 12.5, fontWeight: 700, color: '#334155', marginBottom: 4 }}
            >
              대차수 (주차)
            </label>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <button
                type="button"
                aria-label="이전 주차"
                disabled={
                  optionsLoading ||
                  parentWeeks.findIndex((p) => p.parentWeek === activeParentWeek) < 0 ||
                  parentWeeks.findIndex((p) => p.parentWeek === activeParentWeek) >= parentWeeks.length - 1
                }
                onClick={() => {
                  const idx = parentWeeks.findIndex((p) => p.parentWeek === activeParentWeek);
                  if (idx >= 0 && idx < parentWeeks.length - 1) {
                    void handleParentWeekChange(parentWeeks[idx + 1].parentWeek);
                  }
                }}
                style={{
                  padding: '7px 10px',
                  border: '1px solid #cbd5e1',
                  borderRadius: 6,
                  background: '#f8fafc',
                  color: '#334155',
                  fontSize: 13.5,
                  fontWeight: 700,
                  fontFamily: FONT_STACK,
                  cursor: 'pointer',
                }}
              >
                ‹
              </button>
              <select
                id="compare-parent-week"
                value={activeParentWeek}
                onChange={(e) => void handleParentWeekChange(e.target.value)}
                style={{
                  minWidth: 140,
                  padding: '7px 10px',
                  border: '1px solid #cbd5e1',
                  borderRadius: 6,
                  fontSize: 13.5,
                  fontFamily: FONT_STACK,
                  fontVariantNumeric: 'tabular-nums',
                  background: '#ffffff',
                  color: '#0f172a',
                }}
              >
                {parentWeeks.length === 0 && <option value="">주차 선택</option>}
                {parentWeeks.map((pw) => (
                  <option key={pw.parentWeek} value={pw.parentWeek}>
                    {pw.label}
                  </option>
                ))}
              </select>
              <button
                type="button"
                aria-label="다음 주차"
                disabled={
                  optionsLoading ||
                  parentWeeks.findIndex((p) => p.parentWeek === activeParentWeek) <= 0
                }
                onClick={() => {
                  const idx = parentWeeks.findIndex((p) => p.parentWeek === activeParentWeek);
                  if (idx > 0) {
                    void handleParentWeekChange(parentWeeks[idx - 1].parentWeek);
                  }
                }}
                style={{
                  padding: '7px 10px',
                  border: '1px solid #cbd5e1',
                  borderRadius: 6,
                  background: '#f8fafc',
                  color: '#334155',
                  fontSize: 13.5,
                  fontWeight: 700,
                  fontFamily: FONT_STACK,
                  cursor: 'pointer',
                }}
              >
                ›
              </button>
            </div>
          </div>

          <div style={{ flex: 1, minWidth: 260 }}>
            <div style={{ fontSize: 12.5, fontWeight: 700, color: '#334155', marginBottom: 4 }}>
              세부차수 선택
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
              {subWeeksInParent.length === 0 ? (
                <span style={{ fontSize: 13.5, color: '#475569' }}>선택된 주차의 세부차수가 없습니다.</span>
              ) : (
                subWeeksInParent.map((w) => {
                  const active = w.orderWeek === orderWeek;
                  return (
                    <button
                      key={w.orderWeek}
                      type="button"
                      aria-pressed={active}
                      disabled={optionsLoading}
                      onClick={() => void handleWeekChange(w.orderWeek)}
                      style={{
                        padding: '7px 13px',
                        borderRadius: 6,
                        border: active ? '1px solid #0f172a' : '1px solid #cbd5e1',
                        background: active ? '#0f172a' : '#ffffff',
                        color: active ? '#ffffff' : '#334155',
                        fontSize: 13.5,
                        fontWeight: active ? 700 : 600,
                        fontFamily: FONT_STACK,
                        fontVariantNumeric: 'tabular-nums',
                        cursor: optionsLoading ? 'wait' : 'pointer',
                      }}
                    >
                      {formatSubWeekButtonLabel(w.orderWeek)}
                    </button>
                  );
                })
              )}
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {optionsLoading && (
              <span style={{ fontSize: 12.5, color: '#475569' }}>차수·업체 불러오는 중…</span>
            )}
            <button
              type="button"
              disabled={!orderYear || !orderWeek || !custKey || compareLoading}
              onClick={() => void fetchCompare(orderYear, orderWeek, custKey)}
              style={{
                padding: '8px 16px',
                borderRadius: 6,
                border: 'none',
                background: '#1e3a8a',
                color: '#ffffff',
                fontSize: 13.5,
                fontWeight: 700,
                fontFamily: FONT_STACK,
                cursor: !orderYear || !orderWeek || !custKey || compareLoading ? 'not-allowed' : 'pointer',
                opacity: !orderYear || !orderWeek || !custKey || compareLoading ? 0.55 : 1,
              }}
            >
              {compareLoading ? '조회 중…' : '새로고침'}
            </button>
          </div>
        </div>
      </div>

      {/* 2-2. 거래처 선택 패널 (분배 거래처 기본 + 담당자 버튼 필터 + 고밀도 거래처 그리드) */}
      <div
        style={{
          background: '#ffffff',
          border: '1px solid #cbd5e1',
          borderRadius: 6,
          padding: '14px 18px',
          marginBottom: 14,
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: 10,
            marginBottom: 10,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 13.5, fontWeight: 700, color: '#0f172a' }}>거래처 선택</span>
            <button
              type="button"
              aria-pressed={customerScope === 'shipment'}
              onClick={() => setCustomerScope('shipment')}
              style={{
                padding: '6px 12px',
                borderRadius: 6,
                border: customerScope === 'shipment' ? '1px solid #0f172a' : '1px solid #cbd5e1',
                background: customerScope === 'shipment' ? '#0f172a' : '#ffffff',
                color: customerScope === 'shipment' ? '#ffffff' : '#334155',
                fontSize: 13.5,
                fontWeight: customerScope === 'shipment' ? 700 : 600,
                fontFamily: FONT_STACK,
                fontVariantNumeric: 'tabular-nums',
                cursor: 'pointer',
              }}
            >
              분배 거래처만 ({shipmentCustomersCount})
            </button>
            <button
              type="button"
              aria-pressed={customerScope === 'all'}
              onClick={() => setCustomerScope('all')}
              style={{
                padding: '6px 12px',
                borderRadius: 6,
                border: customerScope === 'all' ? '1px solid #0f172a' : '1px solid #cbd5e1',
                background: customerScope === 'all' ? '#0f172a' : '#ffffff',
                color: customerScope === 'all' ? '#ffffff' : '#334155',
                fontSize: 13.5,
                fontWeight: customerScope === 'all' ? 700 : 600,
                fontFamily: FONT_STACK,
                fontVariantNumeric: 'tabular-nums',
                cursor: 'pointer',
              }}
            >
              전체 (주문·업로드 포함 {customersInWeek.length})
            </button>
            {custKey && (
              <span
                style={{
                  marginLeft: 4,
                  padding: '4px 10px',
                  borderRadius: 4,
                  background: '#eff6ff',
                  border: '1px solid #bfdbfe',
                  color: '#1e3a8a',
                  fontSize: 12.5,
                  fontWeight: 700,
                }}
              >
                선택됨: {custLabel || `업체 #${custKey}`}
              </span>
            )}
          </div>

          <div style={{ position: 'relative', minWidth: 250 }}>
            <label htmlFor="compare-customer-search" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>
              거래처명 검색
            </label>
            <input
              id="compare-customer-search"
              type="text"
              value={custQuery}
              onChange={(e) => setCustQuery(e.target.value)}
              placeholder="거래처명 · 담당자 검색"
              style={{
                width: '100%',
                padding: '7px 10px',
                border: '1px solid #cbd5e1',
                borderRadius: 6,
                fontSize: 13.5,
                fontFamily: FONT_STACK,
                color: '#0f172a',
                boxSizing: 'border-box',
              }}
            />
            {custSearching && (
              <span style={{ position: 'absolute', right: 10, top: 8, fontSize: 12.5, color: '#475569' }}>
                검색중…
              </span>
            )}
          </div>
        </div>

        {/* 담당자 버튼 바 */}
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 6,
            alignItems: 'center',
            paddingBottom: 10,
            marginBottom: 10,
            borderBottom: '1px solid #e2e8f0',
          }}
        >
          <span style={{ fontSize: 12.5, fontWeight: 700, color: '#475569', marginRight: 2 }}>
            담당자
          </span>
          <button
            type="button"
            aria-pressed={selectedManager === 'ALL'}
            onClick={() => setSelectedManager('ALL')}
            style={{
              padding: '5px 11px',
              borderRadius: 5,
              border: selectedManager === 'ALL' ? '1px solid #1e3a8a' : '1px solid #cbd5e1',
              background: selectedManager === 'ALL' ? '#1e3a8a' : '#f8fafc',
              color: selectedManager === 'ALL' ? '#ffffff' : '#334155',
              fontSize: 13.5,
              fontWeight: selectedManager === 'ALL' ? 700 : 600,
              fontFamily: FONT_STACK,
              fontVariantNumeric: 'tabular-nums',
              cursor: 'pointer',
            }}
          >
            전체 ({scopedCustomers.length})
          </button>
          {managerOptions.map((m) => {
            const active = selectedManager === m.name;
            return (
              <button
                key={m.name}
                type="button"
                aria-pressed={active}
                onClick={() => setSelectedManager(m.name)}
                style={{
                  padding: '5px 11px',
                  borderRadius: 5,
                  border: active ? '1px solid #1e3a8a' : '1px solid #cbd5e1',
                  background: active ? '#1e3a8a' : '#f8fafc',
                  color: active ? '#ffffff' : '#334155',
                  fontSize: 13.5,
                  fontWeight: active ? 700 : 600,
                  fontFamily: FONT_STACK,
                  fontVariantNumeric: 'tabular-nums',
                  cursor: 'pointer',
                }}
              >
                {m.name} ({m.count})
              </button>
            );
          })}
        </div>

        {/* 거래처 버튼 리스트 (고밀도 랩 그리드) */}
        {filteredCustomers.length > 0 ? (
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 6,
              maxHeight: 168,
              overflowY: 'auto',
              paddingRight: 4,
            }}
          >
            {filteredCustomers.map((c) => {
              const active = String(c.custKey) === String(custKey);
              return (
                <button
                  key={c.custKey}
                  type="button"
                  aria-pressed={active}
                  onClick={() => void handleSelectCustomer(c.custKey, c.custName)}
                  style={{
                    padding: '6px 11px',
                    borderRadius: 5,
                    border: active ? '1px solid #0f172a' : '1px solid #cbd5e1',
                    background: active ? '#0f172a' : '#f8fafc',
                    color: active ? '#ffffff' : '#0f172a',
                    fontSize: 13.5,
                    fontWeight: active ? 700 : 500,
                    fontFamily: FONT_STACK,
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                  }}
                >
                  <span>{c.custName}</span>
                  {c.hasUploadSnapshot && (
                    <span
                      style={{
                        padding: '1px 6px',
                        borderRadius: 4,
                        background: active ? '#1d4ed8' : '#dbeafe',
                        color: active ? '#ffffff' : '#1d4ed8',
                        fontSize: 12.5,
                        fontWeight: 700,
                      }}
                    >
                      업로드
                    </span>
                  )}
                  {customerScope === 'all' && !c.hasShipment && (
                    <span
                      style={{
                        padding: '1px 6px',
                        borderRadius: 4,
                        background: active ? '#475569' : '#e2e8f0',
                        color: active ? '#ffffff' : '#475569',
                        fontSize: 12.5,
                        fontWeight: 600,
                      }}
                    >
                      분배없음
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        ) : (
          <div style={{ fontSize: 13.5, color: '#475569', padding: '4px 0' }}>
            {custQuery.trim() ? (
              <div>
                <div style={{ marginBottom: 8 }}>
                  현재 목록({customerScope === 'shipment' ? '분배 거래처만' : '전체'})에서
                  {' '}
                  &ldquo;{custQuery.trim()}&rdquo; 검색 결과가 없습니다.
                  {customerScope === 'shipment' && customersInWeek.length > shipmentCustomersCount && (
                    <button
                      type="button"
                      onClick={() => setCustomerScope('all')}
                      style={{
                        marginLeft: 8,
                        padding: '3px 9px',
                        borderRadius: 4,
                        border: '1px solid #cbd5e1',
                        background: '#ffffff',
                        color: '#1e3a8a',
                        fontSize: 12.5,
                        fontWeight: 700,
                        fontFamily: FONT_STACK,
                        cursor: 'pointer',
                      }}
                    >
                      주문·업로드 포함 전체({customersInWeek.length})에서 보기
                    </button>
                  )}
                </div>
                {custSearchResults.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, maxHeight: 140, overflowY: 'auto' }}>
                    <span style={{ fontSize: 12.5, fontWeight: 700, color: '#334155', alignSelf: 'center', marginRight: 4 }}>
                      전체 ERP 거래처:
                    </span>
                    {custSearchResults.map((c) => {
                      const active = String(c.CustKey) === String(custKey);
                      return (
                        <button
                          key={c.CustKey}
                          type="button"
                          onClick={() => void handleSelectCustomer(c.CustKey, c.CustName)}
                          style={{
                            padding: '5px 10px',
                            borderRadius: 5,
                            border: active ? '1px solid #0f172a' : '1px solid #cbd5e1',
                            background: active ? '#0f172a' : '#ffffff',
                            color: active ? '#ffffff' : '#0f172a',
                            fontSize: 13.5,
                            fontWeight: 600,
                            fontFamily: FONT_STACK,
                            cursor: 'pointer',
                          }}
                        >
                          {c.CustName}
                          {c.CustArea ? ` (${c.CustArea})` : ''}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            ) : customerScope === 'shipment' && customersInWeek.length > 0 ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <span>이 세부차수에 분배된 거래처가 없습니다.</span>
                <button
                  type="button"
                  onClick={() => setCustomerScope('all')}
                  style={{
                    padding: '4px 10px',
                    borderRadius: 5,
                    border: '1px solid #1e3a8a',
                    background: '#eff6ff',
                    color: '#1e3a8a',
                    fontSize: 13.5,
                    fontWeight: 700,
                    fontFamily: FONT_STACK,
                    cursor: 'pointer',
                  }}
                >
                  전체 (주문·업로드 포함 {customersInWeek.length}) 보기
                </button>
              </div>
            ) : (
              <span>해당 세부차수에 표시할 거래처가 없습니다.</span>
            )}
          </div>
        )}
      </div>

      {errorMsg && (
        <div
          role="alert"
          style={{
            padding: '10px 14px',
            marginBottom: 14,
            borderRadius: 6,
            border: '1px solid #fecaca',
            background: '#fef2f2',
            color: '#b91c1c',
            fontSize: 13.5,
            fontWeight: 600,
          }}
        >
          {errorMsg}
        </div>
      )}

      {compareData && (
        <>
          {/* 3. 날짜/시점별 최초주문등록 체크 선택 (복수 선택 합산) */}
          <div
            style={{
              background: '#ffffff',
              border: '1px solid #cbd5e1',
              borderRadius: 6,
              padding: '14px 18px',
              marginBottom: 14,
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: 8,
                marginBottom: 10,
              }}
            >
              <div>
                <strong style={{ fontSize: 15, color: '#0f172a' }}>
                  최초주문등록 기준 선택 — {custLabel || compareData.customer?.custName || `업체 #${custKey}`} · {orderYear}년 {orderWeek}
                </strong>
                <span style={{ marginLeft: 10, fontSize: 13, color: '#475569' }}>
                  여러 날짜·등록건을 체크하면 수량이 합산되어 비교됩니다.
                </span>
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <button
                  type="button"
                  onClick={selectEarliestOne}
                  style={{
                    padding: '5px 10px',
                    borderRadius: 4,
                    border: '1px solid #cbd5e1',
                    background: '#f8fafc',
                    color: '#0f172a',
                    fontSize: 12.5,
                    fontWeight: 600,
                    fontFamily: FONT_STACK,
                    cursor: 'pointer',
                  }}
                >
                  최초 1건 선택
                </button>
                <button
                  type="button"
                  onClick={selectAllUploads}
                  style={{
                    padding: '5px 10px',
                    borderRadius: 4,
                    border: '1px solid #cbd5e1',
                    background: '#f8fafc',
                    color: '#0f172a',
                    fontSize: 12.5,
                    fontWeight: 600,
                    fontFamily: FONT_STACK,
                    cursor: 'pointer',
                  }}
                >
                  업로드 전체 선택
                </button>
                <button
                  type="button"
                  onClick={selectAllOrderDates}
                  style={{
                    padding: '5px 10px',
                    borderRadius: 4,
                    border: '1px solid #cbd5e1',
                    background: '#f8fafc',
                    color: '#0f172a',
                    fontSize: 12.5,
                    fontWeight: 600,
                    fontFamily: FONT_STACK,
                    cursor: 'pointer',
                  }}
                >
                  직접등록 전체 선택
                </button>
                <button
                  type="button"
                  onClick={clearCandidates}
                  style={{
                    padding: '5px 10px',
                    borderRadius: 4,
                    border: '1px solid #cbd5e1',
                    background: '#ffffff',
                    color: '#475569',
                    fontSize: 12.5,
                    fontWeight: 600,
                    fontFamily: FONT_STACK,
                    cursor: 'pointer',
                  }}
                >
                  선택 해제
                </button>
              </div>
            </div>

            {candidates.length === 0 ? (
              <div style={{ padding: '12px 0', color: '#475569', fontSize: 13.5 }}>
                이 세부차수에 저장된 업로드 스냅샷이나 직접 주문등록 이력이 없습니다.
              </div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13.5 }}>
                <thead>
                  <tr style={{ background: '#f8fafc', borderBottom: '1px solid #cbd5e1' }}>
                    <th style={{ padding: '7px 10px', textAlign: 'center', width: 44 }}>선택</th>
                    <th style={{ padding: '7px 10px', textAlign: 'left', width: 110 }}>구분</th>
                    <th style={{ padding: '7px 10px', textAlign: 'left', width: 150 }}>등록일시 (KST)</th>
                    <th style={{ padding: '7px 10px', textAlign: 'left' }}>파일명 / 출처</th>
                    <th style={{ padding: '7px 10px', textAlign: 'right', width: 100 }}>품목 수</th>
                    <th style={{ padding: '7px 10px', textAlign: 'right', width: 120 }}>수량 합계</th>
                    <th style={{ padding: '7px 10px', textAlign: 'center', width: 110 }}>미리보기</th>
                  </tr>
                </thead>
                <tbody>
                  {candidates.map((c) => {
                    const checked = selectedCandidateIds.includes(c.id);
                    const totalQty = roundQty(
                      (c.items || []).reduce((s, it) => s + (Number(it.outQty ?? it.qty) || 0), 0),
                    );
                    const previewOpen = expandedPreviewIds.has(c.id);
                    const isUpload = c.sourceKind === 'UPLOAD';

                    return (
                      <Fragment key={c.id}>
                        <tr style={{ background: checked ? '#f8fafc' : '#ffffff', borderBottom: '1px solid #e2e8f0' }}>
                          <td style={{ padding: '7px 10px', textAlign: 'center' }}>
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggleCandidate(c.id)}
                              aria-label={`${c.label} ${formatKstTimestamp(c.timestamp)}`}
                            />
                          </td>
                          <td style={{ padding: '7px 10px' }}>
                            <span
                              style={{
                                display: 'inline-block',
                                padding: '2px 8px',
                                borderRadius: 4,
                                fontSize: 12.5,
                                fontWeight: 700,
                                background: isUpload ? '#dbeafe' : '#fef3c7',
                                color: isUpload ? '#1d4ed8' : '#b45309',
                              }}
                            >
                              {isUpload ? '엑셀업로드' : '직접등록'}
                            </span>
                          </td>
                          <td style={{ padding: '7px 10px', fontVariantNumeric: 'tabular-nums', color: '#334155' }}>
                            {formatKstTimestamp(c.timestamp)}
                          </td>
                          <td style={{ padding: '7px 10px', color: '#0f172a', fontWeight: 600 }}>
                            {c.label}
                            {c.sheetName ? (
                              <span style={{ marginLeft: 8, fontSize: 12.5, fontWeight: 400, color: '#475569' }}>
                                ({c.sheetName})
                              </span>
                            ) : null}
                          </td>
                          <td style={{ padding: '7px 10px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                            {(c.items || []).length}
                          </td>
                          <td style={{ padding: '7px 10px', textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                            {totalQty}
                          </td>
                          <td style={{ padding: '7px 10px', textAlign: 'center' }}>
                            <button
                              type="button"
                              onClick={() => togglePreview(c.id)}
                              style={{
                                padding: '3px 8px',
                                borderRadius: 4,
                                border: '1px solid #cbd5e1',
                                background: '#ffffff',
                                color: '#334155',
                                fontSize: 12.5,
                                fontFamily: FONT_STACK,
                                cursor: 'pointer',
                              }}
                            >
                              {previewOpen ? '접기' : '품목 미리보기'}
                            </button>
                          </td>
                        </tr>
                        {previewOpen && (
                          <tr style={{ background: '#f8fafc', borderBottom: '1px solid #cbd5e1' }}>
                            <td colSpan={7} style={{ padding: '10px 18px' }}>
                              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                                <thead>
                                  <tr style={{ borderBottom: '1px solid #cbd5e1', color: '#334155' }}>
                                    <th style={{ padding: '4px 8px', textAlign: 'center', width: 60 }}>행</th>
                                    <th style={{ padding: '4px 8px', textAlign: 'left' }}>품명</th>
                                    <th style={{ padding: '4px 8px', textAlign: 'right', width: 100 }}>수량</th>
                                    <th style={{ padding: '4px 8px', textAlign: 'left', width: 80 }}>단위</th>
                                    <th style={{ padding: '4px 8px', textAlign: 'right', width: 110 }}>단가</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {(c.items || []).map((it, pIdx) => (
                                    <tr key={pIdx} style={{ borderBottom: '1px solid #e2e8f0' }}>
                                      <td style={{ padding: '4px 8px', textAlign: 'center', fontVariantNumeric: 'tabular-nums' }}>
                                        {it.rowNo ?? pIdx + 1}
                                      </td>
                                      <td style={{ padding: '4px 8px' }}>
                                        {it.inputName || it.displayName || it.prodName}
                                      </td>
                                      <td style={{ padding: '4px 8px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
                                        {it.qty}
                                      </td>
                                      <td style={{ padding: '4px 8px' }}>{it.unit || it.outUnit}</td>
                                      <td style={{ padding: '4px 8px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                                        {Number(it.unitPrice) > 0 ? Number(it.unitPrice).toLocaleString() : '-'}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            )}

            {duplicateDateOverlapDates.length > 0 && (
              <div
                role="status"
                style={{
                  marginTop: 10,
                  padding: '8px 12px',
                  borderRadius: 4,
                  border: '1px solid #fcd34d',
                  background: '#fffbeb',
                  color: '#b45309',
                  fontSize: 13,
                  fontWeight: 600,
                }}
              >
                안내: 같은 날짜({duplicateDateOverlapDates.join(', ')})의 엑셀업로드와 직접등록이 동시에 선택되었습니다. 동일 주문이 중복 합산될 수 있으니 필요 시 한쪽만 선택하세요.
              </div>
            )}
          </div>

          {/* 4. 요약 스트립 + 필터 바 */}
          <div
            style={{
              background: '#ffffff',
              border: '1px solid #cbd5e1',
              borderRadius: 6,
              padding: '14px 18px',
              marginBottom: 14,
            }}
          >
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(4, minmax(180px, 1fr))',
                gap: 0,
                border: '1px solid #cbd5e1',
                borderRadius: 6,
                overflow: 'hidden',
                marginBottom: 12,
              }}
            >
              <div style={{ padding: '10px 14px', borderRight: '1px solid #cbd5e1', background: '#f8fafc' }}>
                <div style={{ fontSize: 12.5, fontWeight: 700, color: '#475569' }}>최초등록 합계</div>
                <div style={{ fontSize: 20, fontWeight: 800, color: '#0f172a', fontVariantNumeric: 'tabular-nums', marginTop: 2 }}>
                  {summary.baselineTotalQty}
                </div>
                <div style={{ fontSize: 12.5, color: '#475569', fontVariantNumeric: 'tabular-nums' }}>
                  {summary.baselineItemCount}품목
                </div>
              </div>
              <div style={{ padding: '10px 14px', borderRight: '1px solid #cbd5e1', background: '#f8fafc' }}>
                <div style={{ fontSize: 12.5, fontWeight: 700, color: '#475569' }}>현재 분배 합계</div>
                <div style={{ fontSize: 20, fontWeight: 800, color: '#0f172a', fontVariantNumeric: 'tabular-nums', marginTop: 2 }}>
                  {summary.shipTotalQty}
                </div>
                <div style={{ fontSize: 12.5, color: '#475569', fontVariantNumeric: 'tabular-nums' }}>
                  {summary.shipItemCount}품목
                </div>
              </div>
              <div style={{ padding: '10px 14px', borderRight: '1px solid #cbd5e1', background: '#f8fafc' }}>
                <div style={{ fontSize: 12.5, fontWeight: 700, color: '#475569' }}>순 증감</div>
                <div
                  style={{
                    fontSize: 20,
                    fontWeight: 800,
                    color: summary.netDiff > 0 ? '#1d4ed8' : summary.netDiff < 0 ? '#b45309' : '#0f172a',
                    fontVariantNumeric: 'tabular-nums',
                    marginTop: 2,
                  }}
                >
                  {summary.netDiff > 0 ? `+${summary.netDiff}` : summary.netDiff}
                </div>
                <div style={{ fontSize: 12.5, color: '#475569', fontVariantNumeric: 'tabular-nums' }}>
                  동일 {summary.sameCount}품목
                </div>
              </div>
              <div style={{ padding: '10px 14px', background: '#f8fafc' }}>
                <div style={{ fontSize: 12.5, fontWeight: 700, color: '#475569' }}>변경 품목 수</div>
                <div style={{ fontSize: 20, fontWeight: 800, color: '#0f172a', fontVariantNumeric: 'tabular-nums', marginTop: 2 }}>
                  {summary.changedCount}건
                </div>
                <div style={{ fontSize: 12.5, color: '#475569', fontVariantNumeric: 'tabular-nums' }}>
                  증가 {summary.increasedCount} · 감소 {summary.decreasedCount} · 미분배 {summary.unallocatedCount} · 신규 {summary.addedCount}
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'center' }}>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13.5, fontWeight: 600, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={onlyChanged}
                  onChange={(e) => setOnlyChanged(e.target.checked)}
                />
                변경된 품목만 보기
              </label>

              <input
                type="text"
                value={productSearch}
                onChange={(e) => setProductSearch(e.target.value)}
                placeholder="품명 · 칼라 · 비고 검색"
                style={{
                  minWidth: 220,
                  padding: '6px 10px',
                  border: '1px solid #cbd5e1',
                  borderRadius: 6,
                  fontSize: 13.5,
                  fontFamily: FONT_STACK,
                }}
              />

              {canShowExcelCols && (
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13.5, fontWeight: 600, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={showAllExcelCols}
                    onChange={(e) => setShowAllExcelCols(e.target.checked)}
                  />
                  원본 엑셀 전체 열 보기
                </label>
              )}

              <span style={{ marginLeft: 'auto', fontSize: 12.5, color: '#475569', fontVariantNumeric: 'tabular-nums' }}>
                표시 {filteredRows.length}행 / 전체 {allRows.length}행
              </span>
            </div>
          </div>

          {/* 5. 비교 테이블 (좌측 원본 엑셀 양식 + 수직 구분선 + 우측 분배/변경차이) */}
          <div
            style={{
              background: '#ffffff',
              border: '1px solid #cbd5e1',
              borderRadius: 6,
              overflowX: 'auto',
            }}
          >
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13.5 }}>
              <thead>
                <tr style={{ background: '#f1f5f9', borderBottom: '2px solid #cbd5e1' }}>
                  <th style={{ padding: '9px 10px', textAlign: 'center', width: 56, whiteSpace: 'nowrap' }}>행</th>
                  {effectiveShowExcelCols ? (
                    <>
                      {mergedBaseline.excelHeaders.map((hdr, hIdx) => (
                        <th key={`hdr-${hIdx}`} style={{ padding: '9px 10px', textAlign: 'left', whiteSpace: 'nowrap' }}>
                          {hdr || `열${hIdx + 1}`}
                        </th>
                      ))}
                      <th style={{ padding: '9px 10px', textAlign: 'left', whiteSpace: 'nowrap' }}>ERP 품명</th>
                      <th
                        style={{
                          padding: '9px 10px',
                          textAlign: 'right',
                          borderRight: '2px solid #94a3b8',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        최초주문수량
                      </th>
                    </>
                  ) : (
                    <>
                      <th style={{ padding: '9px 10px', textAlign: 'left', minWidth: 210 }}>품명</th>
                      <th style={{ padding: '9px 10px', textAlign: 'left', minWidth: 120 }}>칼라/품종</th>
                      <th style={{ padding: '9px 10px', textAlign: 'left', width: 90 }}>단위</th>
                      <th style={{ padding: '9px 10px', textAlign: 'right', minWidth: 120 }}>최초주문수량</th>
                      <th style={{ padding: '9px 10px', textAlign: 'right', width: 100 }}>단가</th>
                      <th
                        style={{
                          padding: '9px 10px',
                          textAlign: 'left',
                          minWidth: 140,
                          borderRight: '2px solid #94a3b8',
                        }}
                      >
                        비고
                      </th>
                    </>
                  )}
                  <th style={{ padding: '9px 10px', textAlign: 'right', width: 120, background: '#f8fafc' }}>
                    현재 분배수량
                  </th>
                  <th style={{ padding: '9px 10px', textAlign: 'right', width: 130, background: '#f8fafc' }}>
                    변경차이
                  </th>
                  <th style={{ padding: '9px 10px', textAlign: 'center', width: 100, background: '#f8fafc' }}>
                    구분
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.length === 0 ? (
                  <tr>
                    <td colSpan={leftColCount + 3} style={{ padding: '24px 16px', textAlign: 'center', color: '#475569' }}>
                      표시할 비교 행이 없습니다.
                    </td>
                  </tr>
                ) : (
                  <>
                    {mainRows.map((row, idx) => renderTableRow(row, idx))}
                    {addedRows.length > 0 && (
                      <>
                        <tr style={{ background: '#ecfeff', borderTop: '2px solid #0d9488', borderBottom: '1px solid #99f6e4' }}>
                          <td
                            colSpan={leftColCount + 3}
                            style={{ padding: '7px 12px', fontSize: 13, fontWeight: 700, color: '#0f766e' }}
                          >
                            최초주문등록 외 추가 분배 품목 ({addedRows.length}건)
                          </td>
                        </tr>
                        {addedRows.map((row, idx) => renderTableRow(row, idx))}
                      </>
                    )}
                  </>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
