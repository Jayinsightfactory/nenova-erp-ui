import { useState, useEffect, useMemo, useCallback, Fragment } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { apiGet, apiPost } from '../../lib/useApi';
import {
  mergeBaselineCandidates,
  buildCompareRows,
  buildUpdateCostPayload,
  pickDefaultOrderWeek,
  roundQty,
} from '../../lib/orderImportCompareLogic';

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

function formatNum(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '0';
  return n.toLocaleString('ko-KR', { maximumFractionDigits: 4 });
}

function formatDiffText(row) {
  if (row.status === 'SAME') return '0';
  if (row.status === 'UNALLOCATED') return `미분배 (${formatNum(row.diff)})`;
  if (row.status === 'ADDED') return `신규 (+${formatNum(row.diff)})`;
  if (row.diff > 0) return `+${formatNum(row.diff)}`;
  return formatNum(row.diff);
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
  const [showAllExcelCols, setShowAllExcelCols] = useState(true);
  const [initializedFromQuery, setInitializedFromQuery] = useState(false);

  const [priceEdits, setPriceEdits] = useState({});
  const [savingPrices, setSavingPrices] = useState(false);
  const [priceSaveNotice, setPriceSaveNotice] = useState(null);

  useEffect(() => {
    setPriceEdits({});
    setPriceSaveNotice(null);
  }, [orderYear, orderWeek, custKey]);

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

  const fetchCompare = useCallback(async (yr, wk, ck, { preserveSelection = false } = {}) => {
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
      if (preserveSelection) {
        const validIds = new Set(list.map((c) => c.id));
        setSelectedCandidateIds((prev) => prev.filter((id) => validIds.has(id)));
      } else {
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
      }
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
      const availableWeeks = opt?.weeks || [];
      const wk = (qWeek && availableWeeks.some((w) => w.orderWeek === qWeek))
        ? qWeek
        : (opt?.defaultOrderWeek || availableWeeks[0]?.orderWeek || '');
      if (yr) setOrderYear(yr);
      if (wk) {
        setOrderWeek(wk);
        if (wk !== qWeek && yr) {
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
    const firstWk = opt?.defaultOrderWeek || opt?.weeks?.[0]?.orderWeek || '';
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
    const targetWeek = pickDefaultOrderWeek(candidatesInParent) || candidatesInParent[0]?.orderWeek || '';
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

  const pricePayload = useMemo(
    () => buildUpdateCostPayload(allRows, priceEdits),
    [allRows, priceEdits],
  );

  const invalidProdKeySet = useMemo(
    () => new Set(pricePayload.invalidRows.map((r) => Number(r.prodKey))),
    [pricePayload.invalidRows],
  );

  const fillableBaselinePriceRows = useMemo(
    () =>
      allRows.filter(
        (row) =>
          row.prodKey &&
          Number(row.unitPrice) > 0 &&
          Array.isArray(row.shipmentDetails) &&
          row.shipmentDetails.length > 0 &&
          Math.abs(Number(row.unitPrice) - Number(row.shipCost ?? 0)) >= 0.5,
      ),
    [allRows],
  );

  const handleFillAllBaselinePrices = () => {
    if (fillableBaselinePriceRows.length === 0) return;
    setPriceEdits((prev) => {
      const next = { ...prev };
      for (const row of fillableBaselinePriceRows) {
        next[String(row.prodKey)] = String(row.unitPrice);
      }
      return next;
    });
    setPriceSaveNotice(null);
  };

  const handleCancelPriceEdits = () => {
    setPriceEdits({});
    setPriceSaveNotice(null);
  };

  const handleSavePrices = async () => {
    if (savingPrices) return;
    if (pricePayload.invalidRows.length > 0) {
      const names = pricePayload.invalidRows.map((r) => r.prodName || String(r.prodKey)).join(', ');
      setPriceSaveNotice({
        type: 'error',
        text: `유효하지 않은 단가가 입력되었습니다 (${names}). 0 이상의 숫자만 입력해 주세요.`,
      });
      return;
    }
    if (pricePayload.items.length === 0) return;
    if (
      pricePayload.hasFixedTarget &&
      typeof window !== 'undefined' &&
      !window.confirm('확정(마감)된 출고분배 행이 포함되어 있습니다. 확정 상태를 유지한 채 분배단가와 금액만 수정할까요?')
    ) {
      return;
    }

    const savedProdCount = pricePayload.editedRowCount;
    const savedDetailCount = pricePayload.detailRowCount;
    setSavingPrices(true);
    setPriceSaveNotice(null);
    try {
      const res = await apiPost('/api/estimate/update-cost', {
        items: pricePayload.items,
        mode: 'once',
        orderYear: Number(orderYear),
        custKey: Number(custKey),
      });
      if (!res?.success) {
        throw new Error(res?.error || '분배단가 저장에 실패했습니다.');
      }
      setPriceEdits({});
      setPriceSaveNotice({
        type: 'success',
        text: `분배단가 ${savedProdCount}품목 (${savedDetailCount}행) 수정 완료 · 출고분배 금액 자동 재계산`,
      });
      await fetchCompare(orderYear, orderWeek, custKey, { preserveSelection: true });
    } catch (err) {
      if (err?.status === 409 || err?.code === 'ERP_EDIT_LOCKED') {
        setPriceSaveNotice({
          type: 'error',
          text: '다른 담당자가 해당 차수 출고분배를 편집 중입니다. 잠시 후 다시 시도해 주세요.',
        });
      } else {
        setPriceSaveNotice({
          type: 'error',
          text: err?.message || '분배단가 저장 중 오류가 발생했습니다.',
        });
      }
    } finally {
      setSavingPrices(false);
    }
  };

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
  const visibleExcelCols = useMemo(() => {
    if (!canShowExcelCols) return [];
    const headers = mergedBaseline.excelHeaders || [];
    return headers
      .map((header, idx) => ({
        idx,
        header: String(header ?? '').trim(),
      }))
      .filter(
        ({ idx, header }) =>
          header !== '' ||
          allRows.some((r) => String(r.rawCells?.[idx] ?? '').trim() !== ''),
      );
  }, [canShowExcelCols, mergedBaseline.excelHeaders, allRows]);
  const effectiveShowExcelCols =
    showAllExcelCols && canShowExcelCols && visibleExcelCols.length > 0;
  const hasAnyUnitPrice = useMemo(
    () => allRows.some((r) => r.unitPrice != null && Number(r.unitPrice) > 0),
    [allRows],
  );
  const hasAnyNote = useMemo(
    () => allRows.some((r) => Boolean(String(r.note || '').trim())),
    [allRows],
  );
  const leftColCount = effectiveShowExcelCols
    ? 1 + visibleExcelCols.length + 1
    : 3;
  const rightColCount = effectiveShowExcelCols
    ? 4
    : 4 + (hasAnyUnitPrice ? 1 : 0) + (hasAnyNote ? 1 : 0);
  const totalColCount = leftColCount + rightColCount;

  const footerTotals = useMemo(() => {
    const baselineTotal = roundQty(
      filteredRows.reduce((s, r) => s + (Number(r.baselineQty) || 0), 0),
    );
    const shipTotal = roundQty(
      filteredRows.reduce((s, r) => s + (Number(r.shipQty) || 0), 0),
    );
    const shipAmountTotal = Math.round(
      filteredRows.reduce((s, r) => s + (Number(r.shipAmount) || 0), 0),
    );
    return {
      baselineTotal,
      shipTotal,
      netDiff: roundQty(shipTotal - baselineTotal),
      shipAmountTotal,
    };
  }, [filteredRows]);

  const tdCompactStyle = {
    padding: '2px 7px',
    borderBottom: '1px solid #e2e8f0',
    fontSize: 13.5,
    lineHeight: 1.25,
    height: 26,
    verticalAlign: 'middle',
    whiteSpace: 'nowrap',
  };

  const thCompactStyle = {
    padding: '4px 7px',
    fontSize: 13,
    lineHeight: 1.2,
    whiteSpace: 'nowrap',
    position: 'sticky',
    top: 0,
    zIndex: 2,
    background: '#f1f5f9',
    borderBottom: '2px solid #cbd5e1',
  };

  const renderTableRow = (row, idx) => {
    const st = ROW_STATUS_STYLE[row.status] || ROW_STATUS_STYLE.SAME;
    const rowLabel = row.rowNos?.length
      ? row.rowNos.join(', ')
      : row.rowNo != null
        ? String(row.rowNo)
        : '-';
    const erpTitle = row.displayName || row.prodName || '';
    const baseName = row.inputName || erpTitle || '-';
    const detailText = String(row.colorOrDetail || '').trim();
    const showInlineDetail = Boolean(
      detailText && !baseName.toLowerCase().includes(detailText.toLowerCase()),
    );
    const inlineName = showInlineDetail ? `${baseName} (${detailText})` : baseName;
    const showErpSub = Boolean(
      erpTitle &&
        row.inputName &&
        erpTitle.replace(/\s+/g, '').toLowerCase() !==
          row.inputName.replace(/\s+/g, '').toLowerCase(),
    );
    const nameTooltipParts = [
      baseName,
      showErpSub ? `ERP: ${erpTitle}` : '',
      detailText ? `칼라/품종: ${detailText}` : '',
      row.unitMixed ? '단위혼재' : '',
    ].filter(Boolean);
    const hasConversion =
      row.sources?.length === 1 &&
      row.sources[0].unit !== row.outUnit &&
      row.sources[0].qty !== row.baselineQty;
    const qtyTooltipParts = [];
    if (hasConversion) {
      qtyTooltipParts.push(
        `원본 ${row.sources[0].qty}${row.sources[0].unit} → ${row.baselineQty}${row.outUnit}`,
      );
    }
    if (row.sources?.length > 1) {
      qtyTooltipParts.push(
        row.sources
          .map((s) => `${s.dateKey ? s.dateKey.slice(5) : s.label}: ${s.outQty}`)
          .join(' + '),
      );
    }
    if (row.unitMixed) {
      qtyTooltipParts.push('단위혼재');
    }
    const unitLabel = row.outUnit || row.unit || '';
    const shipUnitLabel = row.shipUnit || row.outUnit || row.unit || '';

    return (
      <tr
        key={`${row.prodKey || 'n'}-${row.status}-${idx}`}
        style={{ background: st.bg, color: st.color }}
      >
        <td
          style={{
            ...tdCompactStyle,
            width: 38,
            borderLeft: st.borderLeft,
            fontVariantNumeric: 'tabular-nums',
            color: '#475569',
            textAlign: 'center',
          }}
        >
          {rowLabel}
        </td>

        {effectiveShowExcelCols ? (
          Array.isArray(row.rawCells) ? (
            visibleExcelCols.map(({ idx: cIdx }) => (
              <td
                key={`raw-${cIdx}`}
                style={{
                  ...tdCompactStyle,
                  color: '#0f172a',
                  maxWidth: 220,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
                title={String(row.rawCells?.[cIdx] ?? '')}
              >
                {row.rawCells?.[cIdx] ?? ''}
              </td>
            ))
          ) : (
            <td
              colSpan={visibleExcelCols.length}
              style={{
                ...tdCompactStyle,
                color: '#0f172a',
                fontWeight: 600,
                maxWidth: 360,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
              title={nameTooltipParts.join(' · ')}
            >
              {inlineName}
            </td>
          )
        ) : (
          <td
            style={{
              ...tdCompactStyle,
              minWidth: 220,
              maxWidth: 420,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              color: '#0f172a',
              fontWeight: 600,
            }}
            title={nameTooltipParts.join(' · ')}
          >
            {inlineName}
          </td>
        )}

        <td
          title={qtyTooltipParts.length > 0 ? qtyTooltipParts.join(' · ') : undefined}
          style={{
            ...tdCompactStyle,
            width: 96,
            borderRight: '2px solid #94a3b8',
            textAlign: 'right',
            fontWeight: 700,
            fontVariantNumeric: 'tabular-nums',
            color: '#0f172a',
          }}
        >
          {formatNum(row.baselineQty)}
          {unitLabel ? ` ${unitLabel}` : ''}
          {row.sources?.length > 1 && (
            <span style={{ marginLeft: 3, fontSize: 12.5, fontWeight: 500, color: '#475569' }}>
              ({row.sources.length}일)
            </span>
          )}
        </td>

        <td
          style={{
            ...tdCompactStyle,
            width: 96,
            textAlign: 'right',
            fontWeight: 700,
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {formatNum(row.shipQty)}
          {shipUnitLabel ? ` ${shipUnitLabel}` : ''}
        </td>
        <td
          style={{
            ...tdCompactStyle,
            width: 96,
            textAlign: 'right',
            fontWeight: 800,
            fontVariantNumeric: 'tabular-nums',
            color: st.color,
          }}
        >
          {formatDiffText(row)}
        </td>
        <td
          style={{
            ...tdCompactStyle,
            width: 68,
            textAlign: 'center',
          }}
        >
          <span
            style={{
              display: 'inline-block',
              padding: '1px 6px',
              borderRadius: 4,
              background: st.badgeBg,
              color: st.badgeColor,
              fontSize: 12.5,
              lineHeight: 1.15,
              fontWeight: 700,
            }}
          >
            {row.statusLabel}
          </span>
        </td>
        <td
          style={{
            ...tdCompactStyle,
            width: 158,
            minWidth: 158,
            textAlign: 'right',
          }}
        >
          {Array.isArray(row.shipmentDetails) && row.shipmentDetails.length > 0 ? (
            (() => {
              const pkKey = String(row.prodKey);
              const hasEdit = Object.prototype.hasOwnProperty.call(priceEdits, pkKey);
              const rawVal = hasEdit
                ? priceEdits[pkKey]
                : row.shipCost != null
                  ? String(row.shipCost)
                  : '';
              const isInvalid = row.prodKey != null && invalidProdKeySet.has(Number(row.prodKey));
              const parsedVal = Number(String(rawVal).replace(/[,\s]+/g, ''));
              const isModified =
                hasEdit &&
                String(rawVal).trim() !== '' &&
                !isInvalid &&
                (Math.abs(parsedVal - Number(row.shipCost ?? 0)) >= 0.5 || row.hasMixedShipCost);
              const canApplyBaseline =
                Number(row.unitPrice) > 0 &&
                Math.abs(Number(row.unitPrice) - Number(row.shipCost ?? 0)) >= 0.5;
              const mixedTooltip = row.hasMixedShipCost
                ? `세부 행 단가 혼재: ${row.shipmentDetails
                    .map((d) => `${Number(d.cost || 0).toLocaleString()}원`)
                    .join(', ')}`
                : undefined;

              return (
                <div
                  style={{
                    display: 'inline-flex',
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'flex-end',
                    gap: 4,
                    flexWrap: 'nowrap',
                  }}
                >
                  {row.hasFixed && (
                    <span
                      style={{
                        padding: '1px 5px',
                        borderRadius: 4,
                        background: '#fef3c7',
                        color: '#92400e',
                        fontSize: 12.5,
                        lineHeight: 1.15,
                        fontWeight: 700,
                        whiteSpace: 'nowrap',
                      }}
                    >
                      확정
                    </span>
                  )}
                  {row.hasMixedShipCost && (
                    <span
                      title={mixedTooltip}
                      style={{
                        padding: '1px 5px',
                        borderRadius: 4,
                        background: '#e0e7ff',
                        color: '#1e3a8a',
                        fontSize: 12.5,
                        lineHeight: 1.15,
                        fontWeight: 700,
                        cursor: 'help',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      복수
                    </span>
                  )}
                  {canApplyBaseline && (
                    <button
                      type="button"
                      disabled={savingPrices}
                      onClick={() =>
                        setPriceEdits((prev) => ({ ...prev, [pkKey]: String(row.unitPrice) }))
                      }
                      title={`최초단가 ${Number(row.unitPrice).toLocaleString()}원 적용`}
                      style={{
                        height: 22,
                        padding: '1px 6px',
                        borderRadius: 4,
                        border: '1px solid #cbd5e1',
                        background: '#f8fafc',
                        color: '#1e3a8a',
                        fontSize: 12.5,
                        lineHeight: 1.15,
                        fontWeight: 600,
                        fontFamily: FONT_STACK,
                        cursor: savingPrices ? 'wait' : 'pointer',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      적용
                    </button>
                  )}
                  <input
                    type="text"
                    inputMode="numeric"
                    aria-label={`${erpTitle || row.inputName || '품목'} 분배단가`}
                    value={rawVal}
                    disabled={savingPrices}
                    onChange={(e) => {
                      const nextVal = e.target.value;
                      setPriceEdits((prev) => ({ ...prev, [pkKey]: nextVal }));
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        if (pricePayload.invalidRows.length > 0 || pricePayload.editedRowCount > 0) {
                          void handleSavePrices();
                        }
                      }
                    }}
                    style={{
                      width: 82,
                      height: 22,
                      padding: '1px 6px',
                      borderRadius: 4,
                      border: isInvalid
                        ? '1.5px solid #dc2626'
                        : isModified
                          ? '1.5px solid #2563eb'
                          : '1px solid #cbd5e1',
                      background: isInvalid ? '#fef2f2' : isModified ? '#eff6ff' : '#ffffff',
                      color: '#0f172a',
                      fontSize: 13,
                      fontWeight: isModified ? 700 : 500,
                      fontFamily: FONT_STACK,
                      fontVariantNumeric: 'tabular-nums',
                      textAlign: 'right',
                      boxSizing: 'border-box',
                    }}
                  />
                </div>
              );
            })()
          ) : (
            <span style={{ color: '#64748b', fontVariantNumeric: 'tabular-nums' }}>-</span>
          )}
        </td>

        {!effectiveShowExcelCols && hasAnyUnitPrice && (
          <td
            style={{
              ...tdCompactStyle,
              width: 80,
              textAlign: 'right',
              fontVariantNumeric: 'tabular-nums',
              color: '#334155',
            }}
          >
            {row.unitPrice > 0 ? Number(row.unitPrice).toLocaleString() : '-'}
          </td>
        )}
        {!effectiveShowExcelCols && hasAnyNote && (
          <td
            title={row.note || ''}
            style={{
              ...tdCompactStyle,
              minWidth: 90,
              maxWidth: 180,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              color: '#475569',
            }}
          >
            {row.note || '-'}
          </td>
        )}
      </tr>
    );
  };

  return (
    <div
      style={{
        fontFamily: FONT_STACK,
        maxWidth: 1680,
        margin: '0 auto',
        padding: '10px 16px 40px',
        color: '#0f172a',
        fontSize: 13.5,
      }}
    >
      {/* 1. 목적 우선 헤더 */}
      <div
        style={{
          background: '#ffffff',
          border: '1px solid #cbd5e1',
          borderLeft: '4px solid #1e3a8a',
          borderRadius: 6,
          padding: '8px 12px',
          marginBottom: 8,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 10,
          flexWrap: 'wrap',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span
            style={{
              fontSize: 12.5,
              fontWeight: 700,
              color: '#1e3a8a',
              letterSpacing: '0.02em',
              background: '#eff6ff',
              border: '1px solid #bfdbfe',
              borderRadius: 4,
              padding: '2px 7px',
            }}
          >
            핵심 목적 · PURPOSE
          </span>
          <h1 style={{ margin: 0, fontSize: 17, fontWeight: 800, color: '#0f172a' }}>
            최초주문등록 과 분배 비교
          </h1>
          <span style={{ fontSize: 13, color: '#475569' }}>
            세부차수 기준으로 최초주문등록 수량과 현재 출고분배 수량을 대조합니다.
          </span>
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <Link
            href="/orders/import"
            style={{
              display: 'inline-block',
              padding: '5px 11px',
              borderRadius: 6,
              border: '1px solid #cbd5e1',
              background: '#f8fafc',
              color: '#0f172a',
              fontSize: 13,
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
          padding: '8px 12px',
          marginBottom: 8,
        }}
      >
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div>
            <label
              htmlFor="compare-year"
              style={{ display: 'block', fontSize: 12.5, fontWeight: 700, color: '#334155', marginBottom: 3 }}
            >
              연도
            </label>
            <select
              id="compare-year"
              value={orderYear}
              onChange={(e) => void handleYearChange(e.target.value)}
              style={{
                padding: '4px 8px',
                border: '1px solid #cbd5e1',
                borderRadius: 5,
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
              style={{ display: 'block', fontSize: 12.5, fontWeight: 700, color: '#334155', marginBottom: 3 }}
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
                  padding: '4px 8px',
                  border: '1px solid #cbd5e1',
                  borderRadius: 5,
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
                  minWidth: 130,
                  padding: '4px 8px',
                  border: '1px solid #cbd5e1',
                  borderRadius: 5,
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
                  padding: '4px 8px',
                  border: '1px solid #cbd5e1',
                  borderRadius: 5,
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
            <div style={{ fontSize: 12.5, fontWeight: 700, color: '#334155', marginBottom: 3 }}>
              세부차수 선택
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
              {subWeeksInParent.length === 0 ? (
                <span style={{ fontSize: 13, color: '#475569' }}>선택된 주차의 세부차수가 없습니다.</span>
              ) : (
                subWeeksInParent.map((w) => {
                  const active = w.orderWeek === orderWeek;
                  const shipCustCount = Number(w.shipmentCustomerCount) || 0;
                  const hasShip = Boolean(w.hasShipment);
                  const badgeText = shipCustCount > 0
                    ? `분배 ${shipCustCount}`
                    : hasShip
                      ? '분배'
                      : '주문만';
                  return (
                    <button
                      key={w.orderWeek}
                      type="button"
                      aria-pressed={active}
                      disabled={optionsLoading}
                      onClick={() => void handleWeekChange(w.orderWeek)}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 5,
                        padding: '4px 10px',
                        borderRadius: 5,
                        border: active ? '1px solid #0f172a' : '1px solid #cbd5e1',
                        background: active ? '#0f172a' : '#ffffff',
                        color: active ? '#ffffff' : '#334155',
                        fontSize: 13,
                        fontWeight: active ? 700 : 600,
                        fontFamily: FONT_STACK,
                        fontVariantNumeric: 'tabular-nums',
                        cursor: optionsLoading ? 'wait' : 'pointer',
                      }}
                    >
                      <span>{formatSubWeekButtonLabel(w.orderWeek)}</span>
                      <span
                        style={{
                          padding: '1px 6px',
                          borderRadius: 4,
                          fontSize: 12.5,
                          fontWeight: 600,
                          fontFamily: FONT_STACK,
                          fontVariantNumeric: 'tabular-nums',
                          background: active
                            ? (hasShip ? '#1e293b' : '#334155')
                            : (hasShip ? '#eff6ff' : '#f1f5f9'),
                          color: active
                            ? (hasShip ? '#e2e8f0' : '#cbd5e1')
                            : (hasShip ? '#1d4ed8' : '#475569'),
                        }}
                      >
                        {badgeText}
                      </span>
                    </button>
                  );
                })
              )}
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {optionsLoading && (
              <span style={{ fontSize: 12.5, color: '#475569' }}>차수·업체 불러오는 중…</span>
            )}
            <button
              type="button"
              disabled={!orderYear || !orderWeek || !custKey || compareLoading}
              onClick={() => void fetchCompare(orderYear, orderWeek, custKey)}
              style={{
                padding: '5px 12px',
                borderRadius: 5,
                border: 'none',
                background: '#1e3a8a',
                color: '#ffffff',
                fontSize: 13,
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
          padding: '8px 12px',
          marginBottom: 8,
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: 6,
            marginBottom: 6,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: '#0f172a' }}>거래처 선택</span>
            <button
              type="button"
              aria-pressed={customerScope === 'shipment'}
              onClick={() => setCustomerScope('shipment')}
              style={{
                padding: '4px 10px',
                borderRadius: 5,
                border: customerScope === 'shipment' ? '1px solid #0f172a' : '1px solid #cbd5e1',
                background: customerScope === 'shipment' ? '#0f172a' : '#ffffff',
                color: customerScope === 'shipment' ? '#ffffff' : '#334155',
                fontSize: 13,
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
                padding: '4px 10px',
                borderRadius: 5,
                border: customerScope === 'all' ? '1px solid #0f172a' : '1px solid #cbd5e1',
                background: customerScope === 'all' ? '#0f172a' : '#ffffff',
                color: customerScope === 'all' ? '#ffffff' : '#334155',
                fontSize: 13,
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
                  marginLeft: 2,
                  padding: '2px 8px',
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

          <div style={{ position: 'relative', minWidth: 220 }}>
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
                padding: '4px 9px',
                border: '1px solid #cbd5e1',
                borderRadius: 5,
                fontSize: 13,
                fontFamily: FONT_STACK,
                color: '#0f172a',
                boxSizing: 'border-box',
              }}
            />
            {custSearching && (
              <span style={{ position: 'absolute', right: 8, top: 5, fontSize: 12.5, color: '#475569' }}>
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
            gap: 5,
            alignItems: 'center',
            paddingBottom: 6,
            marginBottom: 6,
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
              padding: '3px 9px',
              borderRadius: 4,
              border: selectedManager === 'ALL' ? '1px solid #1e3a8a' : '1px solid #cbd5e1',
              background: selectedManager === 'ALL' ? '#1e3a8a' : '#f8fafc',
              color: selectedManager === 'ALL' ? '#ffffff' : '#334155',
              fontSize: 13,
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
                  padding: '3px 9px',
                  borderRadius: 4,
                  border: active ? '1px solid #1e3a8a' : '1px solid #cbd5e1',
                  background: active ? '#1e3a8a' : '#f8fafc',
                  color: active ? '#ffffff' : '#334155',
                  fontSize: 13,
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
              gap: 5,
              maxHeight: 108,
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
                    padding: '3px 9px',
                    borderRadius: 4,
                    border: active ? '1px solid #0f172a' : '1px solid #cbd5e1',
                    background: active ? '#0f172a' : '#f8fafc',
                    color: active ? '#ffffff' : '#0f172a',
                    fontSize: 13,
                    fontWeight: active ? 700 : 500,
                    fontFamily: FONT_STACK,
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 5,
                  }}
                >
                  <span>{c.custName}</span>
                  {c.hasUploadSnapshot && (
                    <span
                      style={{
                        padding: '1px 5px',
                        borderRadius: 4,
                        background: active ? '#1d4ed8' : '#dbeafe',
                        color: active ? '#ffffff' : '#1d4ed8',
                        fontSize: 12.5,
                        lineHeight: 1.15,
                        fontWeight: 700,
                      }}
                    >
                      업로드
                    </span>
                  )}
                  {customerScope === 'all' && !c.hasShipment && (
                    <span
                      style={{
                        padding: '1px 5px',
                        borderRadius: 4,
                        background: active ? '#475569' : '#e2e8f0',
                        color: active ? '#ffffff' : '#475569',
                        fontSize: 12.5,
                        lineHeight: 1.15,
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
          <div style={{ fontSize: 13, color: '#475569', padding: '2px 0' }}>
            {custQuery.trim() ? (
              <div>
                <div style={{ marginBottom: 6 }}>
                  현재 목록({customerScope === 'shipment' ? '분배 거래처만' : '전체'})에서
                  {' '}
                  &ldquo;{custQuery.trim()}&rdquo; 검색 결과가 없습니다.
                  {customerScope === 'shipment' && customersInWeek.length > shipmentCustomersCount && (
                    <button
                      type="button"
                      onClick={() => setCustomerScope('all')}
                      style={{
                        marginLeft: 8,
                        padding: '2px 8px',
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
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, maxHeight: 108, overflowY: 'auto' }}>
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
                            padding: '3px 9px',
                            borderRadius: 4,
                            border: active ? '1px solid #0f172a' : '1px solid #cbd5e1',
                            background: active ? '#0f172a' : '#ffffff',
                            color: active ? '#ffffff' : '#0f172a',
                            fontSize: 13,
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
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span>이 세부차수에 분배된 거래처가 없습니다.</span>
                <button
                  type="button"
                  onClick={() => setCustomerScope('all')}
                  style={{
                    padding: '3px 9px',
                    borderRadius: 4,
                    border: '1px solid #1e3a8a',
                    background: '#eff6ff',
                    color: '#1e3a8a',
                    fontSize: 13,
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
            padding: '8px 12px',
            marginBottom: 8,
            borderRadius: 6,
            border: '1px solid #fecaca',
            background: '#fef2f2',
            color: '#b91c1c',
            fontSize: 13,
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
              padding: '8px 12px',
              marginBottom: 8,
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: 6,
                marginBottom: 6,
              }}
            >
              <div>
                <strong style={{ fontSize: 14, color: '#0f172a' }}>
                  최초주문등록 기준 선택 — {custLabel || compareData.customer?.custName || `업체 #${custKey}`} · {orderYear}년 {orderWeek}
                </strong>
                <span style={{ marginLeft: 8, fontSize: 12.5, color: '#475569' }}>
                  여러 날짜·등록건을 체크하면 수량이 합산되어 비교됩니다.
                </span>
              </div>
              <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                <button
                  type="button"
                  onClick={selectEarliestOne}
                  style={{
                    padding: '3px 8px',
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
                    padding: '3px 8px',
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
                    padding: '3px 8px',
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
                    padding: '3px 8px',
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
              <div style={{ padding: '6px 0', color: '#475569', fontSize: 13 }}>
                이 세부차수에 저장된 업로드 스냅샷이나 직접 주문등록 이력이 없습니다.
              </div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ background: '#f8fafc', borderBottom: '1px solid #cbd5e1' }}>
                    <th style={{ padding: '4px 8px', textAlign: 'center', width: 44 }}>선택</th>
                    <th style={{ padding: '4px 8px', textAlign: 'left', width: 100 }}>구분</th>
                    <th style={{ padding: '4px 8px', textAlign: 'left', width: 140 }}>등록일시 (KST)</th>
                    <th style={{ padding: '4px 8px', textAlign: 'left' }}>파일명 / 출처</th>
                    <th style={{ padding: '4px 8px', textAlign: 'right', width: 90 }}>품목 수</th>
                    <th style={{ padding: '4px 8px', textAlign: 'right', width: 100 }}>수량 합계</th>
                    <th style={{ padding: '4px 8px', textAlign: 'center', width: 100 }}>미리보기</th>
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
                          <td style={{ padding: '3px 8px', textAlign: 'center' }}>
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggleCandidate(c.id)}
                              aria-label={`${c.label} ${formatKstTimestamp(c.timestamp)}`}
                            />
                          </td>
                          <td style={{ padding: '3px 8px' }}>
                            <span
                              style={{
                                display: 'inline-block',
                                padding: '1px 6px',
                                borderRadius: 4,
                                fontSize: 12.5,
                                lineHeight: 1.15,
                                fontWeight: 700,
                                background: isUpload ? '#dbeafe' : '#fef3c7',
                                color: isUpload ? '#1d4ed8' : '#b45309',
                              }}
                            >
                              {isUpload ? '엑셀업로드' : '직접등록'}
                            </span>
                          </td>
                          <td style={{ padding: '3px 8px', fontVariantNumeric: 'tabular-nums', color: '#334155' }}>
                            {formatKstTimestamp(c.timestamp)}
                          </td>
                          <td style={{ padding: '3px 8px', color: '#0f172a', fontWeight: 600 }}>
                            {c.label}
                            {c.sheetName ? (
                              <span style={{ marginLeft: 8, fontSize: 12.5, fontWeight: 400, color: '#475569' }}>
                                ({c.sheetName})
                              </span>
                            ) : null}
                          </td>
                          <td style={{ padding: '3px 8px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                            {(c.items || []).length}
                          </td>
                          <td style={{ padding: '3px 8px', textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                            {totalQty}
                          </td>
                          <td style={{ padding: '3px 8px', textAlign: 'center' }}>
                            <button
                              type="button"
                              onClick={() => togglePreview(c.id)}
                              style={{
                                padding: '2px 7px',
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
                            <td colSpan={7} style={{ padding: '8px 14px' }}>
                              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                                <thead>
                                  <tr style={{ borderBottom: '1px solid #cbd5e1', color: '#334155' }}>
                                    <th style={{ padding: '3px 7px', textAlign: 'center', width: 60 }}>행</th>
                                    <th style={{ padding: '3px 7px', textAlign: 'left' }}>품명</th>
                                    <th style={{ padding: '3px 7px', textAlign: 'right', width: 100 }}>수량</th>
                                    <th style={{ padding: '3px 7px', textAlign: 'left', width: 80 }}>단위</th>
                                    <th style={{ padding: '3px 7px', textAlign: 'right', width: 110 }}>단가</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {(c.items || []).map((it, pIdx) => (
                                    <tr key={pIdx} style={{ borderBottom: '1px solid #e2e8f0' }}>
                                      <td style={{ padding: '3px 7px', textAlign: 'center', fontVariantNumeric: 'tabular-nums' }}>
                                        {it.rowNo ?? pIdx + 1}
                                      </td>
                                      <td style={{ padding: '3px 7px' }}>
                                        {it.inputName || it.displayName || it.prodName}
                                      </td>
                                      <td style={{ padding: '3px 7px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
                                        {it.qty}
                                      </td>
                                      <td style={{ padding: '3px 7px' }}>{it.unit || it.outUnit}</td>
                                      <td style={{ padding: '3px 7px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
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
                  marginTop: 6,
                  padding: '6px 10px',
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
              padding: '8px 12px',
              marginBottom: 8,
            }}
          >
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(4, minmax(160px, 1fr))',
                gap: 0,
                border: '1px solid #cbd5e1',
                borderRadius: 5,
                overflow: 'hidden',
                marginBottom: 8,
              }}
            >
              <div style={{ padding: '6px 10px', borderRight: '1px solid #cbd5e1', background: '#f8fafc', display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 6 }}>
                <span style={{ fontSize: 12.5, fontWeight: 700, color: '#475569' }}>최초등록 합계</span>
                <span style={{ fontSize: 16, fontWeight: 800, color: '#0f172a', fontVariantNumeric: 'tabular-nums' }}>
                  {formatNum(summary.baselineTotalQty)}
                  <span style={{ marginLeft: 5, fontSize: 12.5, fontWeight: 500, color: '#475569' }}>
                    ({summary.baselineItemCount}품목)
                  </span>
                </span>
              </div>
              <div style={{ padding: '6px 10px', borderRight: '1px solid #cbd5e1', background: '#f8fafc', display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 6 }}>
                <span style={{ fontSize: 12.5, fontWeight: 700, color: '#475569' }}>현재 분배 합계</span>
                <span style={{ fontSize: 16, fontWeight: 800, color: '#0f172a', fontVariantNumeric: 'tabular-nums' }}>
                  {formatNum(summary.shipTotalQty)}
                  <span style={{ marginLeft: 5, fontSize: 12.5, fontWeight: 500, color: '#475569' }}>
                    ({summary.shipItemCount}품목)
                  </span>
                </span>
              </div>
              <div style={{ padding: '6px 10px', borderRight: '1px solid #cbd5e1', background: '#f8fafc', display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 6 }}>
                <span style={{ fontSize: 12.5, fontWeight: 700, color: '#475569' }}>순 증감</span>
                <span
                  style={{
                    fontSize: 16,
                    fontWeight: 800,
                    color: summary.netDiff > 0 ? '#1d4ed8' : summary.netDiff < 0 ? '#b45309' : '#0f172a',
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {summary.netDiff > 0 ? `+${formatNum(summary.netDiff)}` : formatNum(summary.netDiff)}
                  <span style={{ marginLeft: 5, fontSize: 12.5, fontWeight: 500, color: '#475569' }}>
                    (동일 {summary.sameCount})
                  </span>
                </span>
              </div>
              <div style={{ padding: '6px 10px', background: '#f8fafc', display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 6 }}>
                <span style={{ fontSize: 12.5, fontWeight: 700, color: '#475569' }}>변경 품목</span>
                <span style={{ fontSize: 15, fontWeight: 800, color: '#0f172a', fontVariantNumeric: 'tabular-nums' }}>
                  {summary.changedCount}건
                  <span style={{ marginLeft: 5, fontSize: 12.5, fontWeight: 500, color: '#475569' }}>
                    (+{summary.increasedCount} / -{summary.decreasedCount} / 미{summary.unallocatedCount} / 신{summary.addedCount})
                  </span>
                </span>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
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
                  minWidth: 200,
                  padding: '4px 9px',
                  border: '1px solid #cbd5e1',
                  borderRadius: 5,
                  fontSize: 13,
                  fontFamily: FONT_STACK,
                }}
              />

              {canShowExcelCols && (
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={showAllExcelCols}
                    onChange={(e) => setShowAllExcelCols(e.target.checked)}
                  />
                  업로드 원본 양식 열 보기
                </label>
              )}

              <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                {fillableBaselinePriceRows.length > 0 && (
                  <button
                    type="button"
                    disabled={savingPrices}
                    onClick={handleFillAllBaselinePrices}
                    style={{
                      padding: '4px 10px',
                      borderRadius: 5,
                      border: '1px solid #cbd5e1',
                      background: '#f8fafc',
                      color: '#0f172a',
                      fontSize: 13,
                      fontWeight: 600,
                      fontFamily: FONT_STACK,
                      cursor: savingPrices ? 'wait' : 'pointer',
                    }}
                  >
                    최초단가 일괄 채우기
                  </button>
                )}

                {Object.keys(priceEdits).length > 0 && (
                  <button
                    type="button"
                    disabled={savingPrices}
                    onClick={handleCancelPriceEdits}
                    style={{
                      padding: '4px 10px',
                      borderRadius: 5,
                      border: '1px solid #cbd5e1',
                      background: '#ffffff',
                      color: '#334155',
                      fontSize: 13,
                      fontWeight: 600,
                      fontFamily: FONT_STACK,
                      cursor: savingPrices ? 'wait' : 'pointer',
                    }}
                  >
                    단가 수정 취소
                  </button>
                )}

                <button
                  type="button"
                  disabled={pricePayload.editedRowCount === 0 || savingPrices}
                  onClick={() => void handleSavePrices()}
                  style={{
                    padding: '4px 12px',
                    borderRadius: 5,
                    border: 'none',
                    background: '#1e3a8a',
                    color: '#ffffff',
                    fontSize: 13,
                    fontWeight: 700,
                    fontFamily: FONT_STACK,
                    fontVariantNumeric: 'tabular-nums',
                    cursor: pricePayload.editedRowCount === 0 || savingPrices ? 'not-allowed' : 'pointer',
                    opacity: pricePayload.editedRowCount === 0 || savingPrices ? 0.5 : 1,
                  }}
                >
                  {savingPrices ? '저장 중…' : `분배단가 저장 (${pricePayload.editedRowCount}품목)`}
                </button>

                <span style={{ fontSize: 12.5, color: '#475569', fontVariantNumeric: 'tabular-nums' }}>
                  표시 {filteredRows.length}행 / 전체 {allRows.length}행
                </span>
              </div>
            </div>

            {priceSaveNotice && (
              <div
                role={priceSaveNotice.type === 'error' ? 'alert' : 'status'}
                style={{
                  marginTop: 6,
                  padding: '6px 10px',
                  borderRadius: 5,
                  border: priceSaveNotice.type === 'error' ? '1px solid #fecaca' : '1px solid #bbf7d0',
                  background: priceSaveNotice.type === 'error' ? '#fef2f2' : '#f0fdf4',
                  color: priceSaveNotice.type === 'error' ? '#b91c1c' : '#166534',
                  fontSize: 13,
                  fontWeight: 600,
                }}
              >
                {priceSaveNotice.text}
              </div>
            )}
          </div>

          {/* 5. 비교 테이블 (고밀도 출고내역서 양식 + 주문↔분배 밀착) */}
          <div
            style={{
              background: '#ffffff',
              border: '1px solid #cbd5e1',
              borderRadius: 6,
              overflowX: 'auto',
              width: 'fit-content',
              minWidth: 'min(740px, 100%)',
              maxWidth: '100%',
            }}
          >
            <table
              style={{
                width: 'auto',
                minWidth: 740,
                maxWidth: '100%',
                borderCollapse: 'collapse',
                fontSize: 13.5,
              }}
            >
              <thead>
                <tr>
                  <th style={{ ...thCompactStyle, textAlign: 'center', width: 38 }}>NO</th>
                  {effectiveShowExcelCols ? (
                    visibleExcelCols.map(({ idx: hIdx, header }) => (
                      <th key={`hdr-${hIdx}`} style={{ ...thCompactStyle, textAlign: 'left' }}>
                        {header || `열${hIdx + 1}`}
                      </th>
                    ))
                  ) : (
                    <th style={{ ...thCompactStyle, textAlign: 'left', minWidth: 220, maxWidth: 420 }}>
                      품목명
                    </th>
                  )}
                  <th
                    style={{
                      ...thCompactStyle,
                      textAlign: 'right',
                      width: 96,
                      borderRight: '2px solid #94a3b8',
                    }}
                  >
                    주문수량
                  </th>
                  <th style={{ ...thCompactStyle, textAlign: 'right', width: 96, background: '#f8fafc' }}>
                    분배수량
                  </th>
                  <th style={{ ...thCompactStyle, textAlign: 'right', width: 96, background: '#f8fafc' }}>
                    차이
                  </th>
                  <th style={{ ...thCompactStyle, textAlign: 'center', width: 68, background: '#f8fafc' }}>
                    구분
                  </th>
                  <th
                    style={{
                      ...thCompactStyle,
                      textAlign: 'right',
                      width: 158,
                      minWidth: 158,
                      background: '#f8fafc',
                    }}
                  >
                    분배단가
                  </th>
                  {!effectiveShowExcelCols && hasAnyUnitPrice && (
                    <th style={{ ...thCompactStyle, textAlign: 'right', width: 80, background: '#f8fafc' }}>
                      최초단가
                    </th>
                  )}
                  {!effectiveShowExcelCols && hasAnyNote && (
                    <th
                      style={{
                        ...thCompactStyle,
                        textAlign: 'left',
                        minWidth: 90,
                        maxWidth: 180,
                        background: '#f8fafc',
                      }}
                    >
                      비고
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {filteredRows.length === 0 ? (
                  <tr>
                    <td colSpan={totalColCount} style={{ padding: '18px 14px', textAlign: 'center', color: '#475569' }}>
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
                            colSpan={totalColCount}
                            style={{ padding: '3px 8px', fontSize: 12.5, fontWeight: 700, color: '#0f766e' }}
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
              {filteredRows.length > 0 && (
                <tfoot>
                  <tr
                    style={{
                      background: '#f1f5f9',
                      borderTop: '2px solid #94a3b8',
                      fontWeight: 800,
                      color: '#0f172a',
                    }}
                  >
                    <td
                      colSpan={leftColCount - 1}
                      style={{
                        padding: '4px 8px',
                        fontSize: 13,
                        textAlign: 'center',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      합 계 ({filteredRows.length}품목)
                    </td>
                    <td
                      style={{
                        padding: '4px 7px',
                        borderRight: '2px solid #94a3b8',
                        textAlign: 'right',
                        fontSize: 13.5,
                        fontVariantNumeric: 'tabular-nums',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {formatNum(footerTotals.baselineTotal)}
                    </td>
                    <td
                      style={{
                        padding: '4px 7px',
                        textAlign: 'right',
                        fontSize: 13.5,
                        fontVariantNumeric: 'tabular-nums',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {formatNum(footerTotals.shipTotal)}
                    </td>
                    <td
                      style={{
                        padding: '4px 7px',
                        textAlign: 'right',
                        fontSize: 13.5,
                        fontVariantNumeric: 'tabular-nums',
                        whiteSpace: 'nowrap',
                        color:
                          footerTotals.netDiff > 0
                            ? '#1d4ed8'
                            : footerTotals.netDiff < 0
                              ? '#b45309'
                              : '#0f172a',
                      }}
                    >
                      {footerTotals.netDiff > 0
                        ? `+${formatNum(footerTotals.netDiff)}`
                        : formatNum(footerTotals.netDiff)}
                    </td>
                    <td
                      style={{
                        padding: '4px 7px',
                        textAlign: 'center',
                        fontSize: 12.5,
                        color: '#475569',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      분배금액
                    </td>
                    <td
                      style={{
                        padding: '4px 7px',
                        textAlign: 'right',
                        fontSize: 13.5,
                        fontVariantNumeric: 'tabular-nums',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {formatNum(footerTotals.shipAmountTotal)}원
                    </td>
                    {!effectiveShowExcelCols && hasAnyUnitPrice && <td style={{ padding: '4px 7px' }} />}
                    {!effectiveShowExcelCols && hasAnyNote && <td style={{ padding: '4px 7px' }} />}
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </>
      )}
    </div>
  );
}
