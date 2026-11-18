import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import WorkflowGuide from '../../components/WorkflowGuide';
import { apiGet, apiPost } from '../../lib/useApi';
import { useWeekInput, getCurrentWeek, WeekInput } from '../../lib/useWeekInput';
import { suggestDisplayName, filterProducts } from '../../lib/displayName';
import { customerMatchesSearch } from '../../lib/customerSearch';
import {
  distributionWeekButtons,
  distributionSubWeekButtons,
  mergeDistributionSearchCandidates,
  sortDistributionCustomers,
  sortDistributionProducts,
} from '../../lib/shipmentDistributionWorkspace.js';
import { runEditWithFixCycle } from '../../lib/fixCycleClient';
import { MENU_BACK_REQUEST_EVENT } from '../../lib/menuNavigationHistory';
import {
  ABSORB_ENTRY_MODES,
  ABSORB_UNIT_OPTIONS,
  buildAbsorbExecutionPlan,
  detectOrderRegistrationState,
  executeOrderAbsorbWorkflow,
  filterSameYearOrderRows,
  resolveAbsorbScope,
} from '../../lib/distributeOrderAbsorb.js';

const fmt = (n) => Number(n || 0).toLocaleString();
const fmtDec = (n) => {
  const num = Number(n || 0);
  return Number.isInteger(num) ? num.toLocaleString() : Number(num.toFixed(4)).toLocaleString(undefined, { maximumFractionDigits: 4 });
};

function tagRowsWithScope(rows = [], scope) {
  if (!Array.isArray(rows)) return [];
  return rows.map((row) => ({
    ...row,
    _scopedOrderYear: row?.OrderYear ?? row?.orderYear ?? row?.year ?? scope.orderYear,
    _scopedOrderWeek: row?.OrderWeek ?? row?.orderWeek ?? scope.orderWeek,
  }));
}

export default function QuickAbsorbPage() {
  const router = useRouter();
  const weekInput = useWeekInput('', { deferDefault: true });
  const [explicitYear, setExplicitYear] = useState('');
  const [scopeInitialized, setScopeInitialized] = useState(false);

  const scopeState = useMemo(() => {
    if (!weekInput.value) return { scope: null, error: '' };
    try {
      const scope = resolveAbsorbScope({ week: weekInput.value, year: explicitYear });
      return { scope, error: '' };
    } catch (err) {
      return { scope: null, error: err.message };
    }
  }, [weekInput.value, explicitYear]);
  const activeScope = scopeState.scope;

  // ── 1. 차수·품목 목록 상태
  const [groups, setGroups] = useState([]);
  const [selectedGroupKey, setSelectedGroupKey] = useState('');
  const [weekProducts, setWeekProducts] = useState([]);
  const [productCatalog, setProductCatalog] = useState([]);
  const [prodSearch, setProdSearch] = useState('');
  const [showAllProducts, setShowAllProducts] = useState(false);
  const [selectedProd, setSelectedProd] = useState(null);
  const [productsLoading, setProductsLoading] = useState(false);

  // ── 2. 업체 목록 및 주문·출고 감지 상태
  const [allCustomers, setAllCustomers] = useState([]);
  const [custDistRows, setCustDistRows] = useState([]);
  const [custAdjustRows, setCustAdjustRows] = useState([]);
  const [custSearch, setCustSearch] = useState('');
  const [custFilter, setCustFilter] = useState('all'); // 'all' | 'unregistered' | 'registered'
  const [showAllCustomers, setShowAllCustomers] = useState(false);
  const [selectedCust, setSelectedCust] = useState(null);
  const [custLoading, setCustLoading] = useState(false);

  // ── 3. 분배 입력 및 확인 게이트 상태
  const [entryMode, setEntryMode] = useState(ABSORB_ENTRY_MODES.FINAL);
  const [qtyInput, setQtyInput] = useState('');
  const [unitInput, setUnitInput] = useState('박스');
  const [costInput, setCostInput] = useState('');
  const [outDateInput, setOutDateInput] = useState('');
  const [memoInput, setMemoInput] = useState('');
  const [confirmChecked, setConfirmChecked] = useState(false);

  // ── 4. 실행 상태 · 확정차수 확인 모달 · 이력
  const [progressSteps, setProgressSteps] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [errorBanner, setErrorBanner] = useState('');
  const [partialRecovery, setPartialRecovery] = useState(null);
  const [lastResult, setLastResult] = useState(null);
  const [sessionHistory, setSessionHistory] = useState([]);
  const [fixModalState, setFixModalState] = useState(null);

  const scopeReqSeqRef = useRef(0);
  const custDistReqSeqRef = useRef(0);
  const currentReqSeqRef = useRef(0);
  const prodListRef = useRef(null);
  const custListRef = useRef(null);

  // 초기 차수·연도 적용 (SSR과 초기 CSR 불일치 방지)
  const setWeekValue = weekInput.setValue;
  useEffect(() => {
    if (!router.isReady || scopeInitialized) return;
    const rawWeek = typeof router.query.week === 'string' ? router.query.week.trim() : '';
    const rawYear = typeof router.query.year === 'string' ? router.query.year.trim() : '';
    let initialFull = getCurrentWeek();
    let initYear = initialFull.slice(0, 4);
    if (rawWeek) {
      try {
        const parsed = resolveAbsorbScope({ week: rawWeek, year: rawYear });
        initialFull = parsed.fullWeek;
        initYear = parsed.orderYear;
      } catch {
        // 잘못된 query 는 무시하고 기본 차수 사용
      }
    } else if (/^\d{4}$/.test(rawYear)) {
      initYear = rawYear;
      initialFull = `${rawYear}-${initialFull.slice(5)}`;
    }
    setWeekValue(initialFull);
    setExplicitYear(initYear);
    setScopeInitialized(true);
  }, [router.isReady, router.query.week, router.query.year, scopeInitialized, setWeekValue]);

  // 차수 텍스트가 YYYY-NN-NN 으로 바뀌면 explicitYear 동기화
  useEffect(() => {
    const m = String(weekInput.value || '').match(/^(\d{4})-(\d{2}-\d{2})$/);
    if (m && m[1] !== explicitYear) {
      setExplicitYear(m[1]);
    }
  }, [weekInput.value, explicitYear]);

  // 초기 마스터 로드 (품목그룹, 전체 품목 카탈로그, 전체 활성 거래처)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [grpRes, catRes, custRes] = await Promise.all([
          apiGet('/api/shipment/distribute', { type: 'groups' }),
          apiGet('/api/shipment/distribute', { type: 'productCatalog' }),
          apiGet('/api/master/customers'),
        ]);
        if (cancelled) return;
        setGroups(Array.isArray(grpRes?.groups) ? grpRes.groups : []);
        setProductCatalog(Array.isArray(catRes?.products) ? catRes.products : []);
        setAllCustomers(Array.isArray(custRes?.data) ? custRes.data : []);
      } catch (err) {
        if (!cancelled) {
          setErrorBanner(`기초 마스터(품목·업체) 조회 실패: ${err.message}`);
        }
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // 차수 변경 시 현재 차수의 주문 있는 품목 조회
  const loadWeekProducts = useCallback(async (targetScope) => {
    if (!targetScope) return;
    const seq = ++scopeReqSeqRef.current;
    setProductsLoading(true);
    setErrorBanner('');
    try {
      const res = await apiGet('/api/shipment/distribute', {
        type: 'products',
        week: targetScope.orderWeek,
        year: targetScope.orderYear,
      });
      if (scopeReqSeqRef.current !== seq) return;
      setWeekProducts(tagRowsWithScope(res?.products || [], targetScope));
    } catch (err) {
      if (scopeReqSeqRef.current !== seq) return;
      setErrorBanner(`차수 품목 조회 실패: ${err.message}`);
    } finally {
      if (scopeReqSeqRef.current === seq) setProductsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!activeScope) return;
    loadWeekProducts(activeScope);
  }, [activeScope, loadWeekProducts]);

  // 품목 또는 차수 변경 시 해당 품목의 기존 주문/분배 거래처 목록(custDist) 조회
  const loadCustDistForScope = useCallback(async (targetScope, prodKey) => {
    if (!targetScope || !prodKey) {
      setCustDistRows([]);
      return [];
    }
    const seq = ++custDistReqSeqRef.current;
    setCustLoading(true);
    try {
      const res = await apiGet('/api/shipment/distribute', {
        type: 'custDist',
        week: targetScope.orderWeek,
        year: targetScope.orderYear,
        prodKey,
      });
      if (custDistReqSeqRef.current !== seq) return null;
      const tagged = tagRowsWithScope(
        (res?.customers || []).map((row) => ({ ...row, ProdKey: Number(row.ProdKey || prodKey) })),
        targetScope,
      );
      setCustDistRows(tagged);
      return tagged;
    } catch (err) {
      if (custDistReqSeqRef.current !== seq) return null;
      setErrorBanner(`업체 주문/분배 현황 조회 실패: ${err.message}`);
      return null;
    } finally {
      if (custDistReqSeqRef.current === seq) setCustLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!activeScope || !selectedProd?.ProdKey) {
      setCustDistRows([]);
      setCustAdjustRows([]);
      return;
    }
    loadCustDistForScope(activeScope, selectedProd.ProdKey);
  }, [activeScope, selectedProd?.ProdKey, loadCustDistForScope]);

  // 선택된 (업체, 품목, 연도, 차수)의 실제 ShipmentDetail 현재상태(adjust?type=current) 조회
  const loadCurrentShipmentForPair = useCallback(async (targetScope, custKey, prodKey) => {
    if (!targetScope || !custKey || !prodKey) {
      setCustAdjustRows([]);
      return [];
    }
    const seq = ++currentReqSeqRef.current;
    try {
      const res = await apiGet('/api/shipment/adjust', {
        type: 'current',
        week: targetScope.orderWeek,
        year: targetScope.orderYear,
        custKey,
        prodKey,
      });
      if (currentReqSeqRef.current !== seq) return null;
      const tagged = tagRowsWithScope(
        (res?.items || []).map((item) => ({ ...item, CustKey: custKey, ProdKey: item.prodKey ?? prodKey })),
        targetScope,
      );
      setCustAdjustRows(tagged);
      return tagged;
    } catch (err) {
      if (currentReqSeqRef.current !== seq) return null;
      setErrorBanner(`출고 상세 현재값 조회 실패: ${err.message}`);
      return null;
    }
  }, []);

  useEffect(() => {
    if (!activeScope || !selectedCust?.CustKey || !selectedProd?.ProdKey) {
      setCustAdjustRows([]);
      return;
    }
    loadCurrentShipmentForPair(activeScope, selectedCust.CustKey, selectedProd.ProdKey);
  }, [activeScope, selectedCust?.CustKey, selectedProd?.ProdKey, loadCurrentShipmentForPair]);

  // 품목 선택 시 기본 입력 단위 동기화 및 확인 체크 초기화
  const handleSelectProduct = useCallback((product) => {
    setSelectedProd(product || null);
    setConfirmChecked(false);
    setLastResult(null);
    setPartialRecovery(null);
    setErrorBanner('');
    if (product?.OutUnit) {
      setUnitInput(product.OutUnit);
    } else {
      setUnitInput('박스');
    }
  }, []);

  // 업체 선택 시 기존 분배 수량/단가(명시 0원 보존)로 입력 폼 초기화 (원장 OutUnit 으로 단위 동기화)
  const handleSelectCustomer = useCallback((customerRow) => {
    setSelectedCust(customerRow || null);
    setConfirmChecked(false);
    setLastResult(null);
    setPartialRecovery(null);
    setErrorBanner('');
    setUnitInput(selectedProd?.OutUnit || '박스');
    if (!customerRow) {
      setQtyInput('');
      setCostInput('');
      return;
    }
    const baseCost = customerRow.Cost ?? customerRow.단가 ?? selectedProd?.Cost ?? 0;
    setCostInput(baseCost === '' || baseCost === null || baseCost === undefined ? '' : String(baseCost));
    if (customerRow.hasActiveOrder && Number(customerRow.출고수량 || 0) > 0 && entryMode === ABSORB_ENTRY_MODES.FINAL) {
      setQtyInput(String(customerRow.출고수량));
    } else {
      setQtyInput('');
    }
  }, [entryMode, selectedProd?.Cost, selectedProd?.OutUnit]);

  // 상단 ← 뒤로가기 버튼 및 Escape 키 문맥 복귀 처리
  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key !== 'Escape') return;
      if (fixModalState) {
        event.preventDefault();
        fixModalState.resolve(false);
        setFixModalState(null);
        return;
      }
      if (selectedCust) {
        event.preventDefault();
        handleSelectCustomer(null);
      }
    };
    const onMenuBack = (event) => {
      if (fixModalState) {
        event.preventDefault();
        fixModalState.resolve(false);
        setFixModalState(null);
        return;
      }
      if (selectedCust) {
        if (qtyInput !== '' || confirmChecked) {
          if (!window.confirm('입력 중인 수량/확인 상태를 초기화하고 업체 선택 목록으로 돌아갈까요?')) {
            event.preventDefault();
            return;
          }
        }
        event.preventDefault();
        handleSelectCustomer(null);
        return;
      }
      if (selectedProd) {
        event.preventDefault();
        handleSelectProduct(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener(MENU_BACK_REQUEST_EVENT, onMenuBack);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener(MENU_BACK_REQUEST_EVENT, onMenuBack);
    };
  }, [fixModalState, selectedCust, selectedProd, qtyInput, confirmChecked, handleSelectCustomer, handleSelectProduct]);

  // 합쳐진 품목 후보 (현재 차수 주문 품목 우선 + 전체 활성 카탈로그)
  const mergedProducts = useMemo(() => {
    const metadata = new Map((productCatalog || []).map((p) => [Number(p.ProdKey), p]));
    const base = mergeDistributionSearchCandidates(weekProducts, productCatalog).map((row) => ({
      ...metadata.get(Number(row.ProdKey)),
      ...row,
    }));
    const groupFiltered = !selectedGroupKey
      ? base
      : base.filter((row) => {
          const [country, flower] = selectedGroupKey.split('::');
          const rowCountry = String(row.CounName || '').trim();
          const rowFlower = String(row.FlowerName || '').trim();
          return (!country || rowCountry === country) && (!flower || rowFlower === flower);
        });
    const needle = prodSearch.trim();
    if (!needle) return sortDistributionProducts(groupFiltered);
    const byDisplay = new Set(filterProducts(groupFiltered, needle).map((r) => Number(r.ProdKey)));
    const bySimple = new Set(sortDistributionProducts(groupFiltered, needle).map((r) => Number(r.ProdKey)));
    const combined = groupFiltered.filter((r) => byDisplay.has(Number(r.ProdKey)) || bySimple.has(Number(r.ProdKey)));
    return sortDistributionProducts(combined);
  }, [weekProducts, productCatalog, selectedGroupKey, prodSearch]);

  const visibleProducts = useMemo(() => (
    showAllProducts ? mergedProducts : mergedProducts.slice(0, 16)
  ), [mergedProducts, showAllProducts]);

  // 합쳐진 업체 목록: 동일 연도·차수 custDist 행을 우선 반영하고 나머지 활성 거래처는 미등록 상태로 병합
  const mergedCustomers = useMemo(() => {
    if (!activeScope) return [];
    const scopedDist = filterSameYearOrderRows(custDistRows, activeScope);
    const distByCust = new Map(scopedDist.map((row) => [Number(row.CustKey), row]));

    const catalogMap = new Map();
    for (const c of allCustomers) {
      const ck = Number(c.CustKey);
      if (ck > 0) catalogMap.set(ck, c);
    }
    for (const d of scopedDist) {
      const ck = Number(d.CustKey);
      if (ck > 0 && !catalogMap.has(ck)) catalogMap.set(ck, d);
    }

    const enriched = [...catalogMap.values()].map((c) => {
      const ck = Number(c.CustKey);
      const dist = distByCust.get(ck);
      const orderQty = Number(dist?.주문수량 || 0);
      const outQty = Number(dist?.출고수량 || 0);
      const hasActiveOrder = Boolean(dist && orderQty > 0);
      return {
        ...c,
        주문수량: orderQty,
        출고수량: outQty,
        SdetailKey: dist?.SdetailKey || null,
        단가: dist?.단가 ?? dist?.Cost ?? c?.Cost ?? selectedProd?.Cost ?? 0,
        Cost: dist?.Cost ?? dist?.단가 ?? c?.Cost ?? selectedProd?.Cost ?? 0,
        hasActiveOrder,
        _scopedOrderYear: activeScope.orderYear,
        _scopedOrderWeek: activeScope.orderWeek,
      };
    });

    const filteredByStatus = enriched.filter((c) => {
      if (custFilter === 'unregistered') return !c.hasActiveOrder;
      if (custFilter === 'registered') return c.hasActiveOrder;
      return true;
    });

    const matched = custSearch.trim()
      ? filteredByStatus.filter((c) => customerMatchesSearch(c, custSearch))
      : filteredByStatus;

    // 기존 주문 있는 업체를 상단, 미등록 업체를 이름순 정렬 (전체 필터 시)
    return sortDistributionCustomers(matched).sort((a, b) => Number(b.hasActiveOrder) - Number(a.hasActiveOrder));
  }, [activeScope, custDistRows, allCustomers, selectedProd?.Cost, custFilter, custSearch]);

  const visibleCustomers = useMemo(() => (
    showAllCustomers ? mergedCustomers : mergedCustomers.slice(0, 18)
  ), [mergedCustomers, showAllCustomers]);

  // 현재 선택 조합의 실시간 주문·분배 상태 감지
  const registrationState = useMemo(() => {
    if (!activeScope || !selectedCust || !selectedProd) return null;
    try {
      return detectOrderRegistrationState({
        scope: activeScope,
        customer: selectedCust,
        product: selectedProd,
        orderRows: custDistRows,
        shipmentRows: custAdjustRows,
      });
    } catch {
      return null;
    }
  }, [activeScope, selectedCust, selectedProd, custDistRows, custAdjustRows]);

  // 미리보기 계획 수립 (유효성·환산 오류를 즉시 노출)
  const planPreview = useMemo(() => {
    if (!activeScope || !selectedCust || !selectedProd || qtyInput === '') {
      return { plan: null, error: '' };
    }
    try {
      const plan = buildAbsorbExecutionPlan({
        scope: activeScope,
        customer: selectedCust,
        product: selectedProd,
        orderRows: custDistRows,
        shipmentRows: custAdjustRows,
        inputQty: qtyInput,
        inputUnit: unitInput,
        entryMode,
        unitCost: costInput,
        outDate: outDateInput,
        memo: memoInput,
        confirmGatePassed: confirmChecked,
      });
      return { plan, error: '' };
    } catch (err) {
      return { plan: null, error: err.message, code: err.code };
    }
  }, [
    activeScope,
    selectedCust,
    selectedProd,
    custDistRows,
    custAdjustRows,
    qtyInput,
    unitInput,
    entryMode,
    costInput,
    outDateInput,
    memoInput,
    confirmChecked,
  ]);

  const handleListKeyDown = useCallback((event, items, selectedKey, keyProp, onSelect, testIdPrefix) => {
    if (!['ArrowDown', 'ArrowUp'].includes(event.key) || !items.length) return;
    const currentIdx = items.findIndex((item) => Number(item[keyProp]) === Number(selectedKey));
    const targetItem = event.key === 'ArrowDown'
      ? items[currentIdx < 0 ? 0 : Math.min(items.length - 1, currentIdx + 1)]
      : items[currentIdx < 0 ? items.length - 1 : Math.max(0, currentIdx - 1)];
    if (!targetItem) return;
    event.preventDefault();
    onSelect(targetItem);
    if (event.target?.tagName !== 'INPUT' && testIdPrefix) {
      const el = document.querySelector(`[data-testid="${testIdPrefix}${targetItem[keyProp]}"]`);
      el?.focus?.();
    }
  }, []);

  const promptFixCycleConfirm = useCallback((fixScopeInfo, plan) => (
    new Promise((resolve) => {
      setFixModalState({ fixScopeInfo, plan, resolve });
    })
  ), []);

  // 원스톱 순차 흡수/분배 실행
  const handleExecuteAbsorb = async () => {
    if (submitting || !planPreview.plan) return;
    const plan = planPreview.plan;
    if (plan.requiresPrecedingOrder && !confirmChecked) {
      setErrorBanner('미등록 업체 선행 주문등록 확인 체크박스를 먼저 선택하세요.');
      return;
    }

    setSubmitting(true);
    setErrorBanner('');
    setPartialRecovery(null);
    setLastResult(null);
    setProgressSteps(['실행 준비 중']);

    const pushProgress = (msg) => {
      setProgressSteps((prev) => (prev[prev.length - 1] === msg ? prev : [...prev, msg]));
    };

    try {
      const outcome = await executeOrderAbsorbWorkflow(plan, {
        onProgress: pushProgress,
        refreshBeforeWrite: async () => {
          const [distRes, adjRes] = await Promise.all([
            apiGet('/api/shipment/distribute', {
              type: 'custDist',
              week: plan.scope.orderWeek,
              year: plan.scope.orderYear,
              prodKey: plan.product.prodKey,
            }),
            apiGet('/api/shipment/adjust', {
              type: 'current',
              week: plan.scope.orderWeek,
              year: plan.scope.orderYear,
              custKey: plan.customer.custKey,
              prodKey: plan.product.prodKey,
            }),
          ]);
          const freshOrders = tagRowsWithScope(
            (distRes?.customers || []).map((row) => ({ ...row, ProdKey: Number(row.ProdKey || plan.product.prodKey) })),
            plan.scope,
          );
          const freshShipments = tagRowsWithScope(
            (adjRes?.items || []).map((item) => ({ ...item, CustKey: plan.customer.custKey, ProdKey: item.prodKey ?? plan.product.prodKey })),
            plan.scope,
          );
          setCustDistRows(freshOrders);
          setCustAdjustRows(freshShipments);
          return { orderRows: freshOrders, shipmentRows: freshShipments };
        },
        checkFixedScopes: async (scope, prodKeys) => (
          apiGet('/api/shipment/distribute', {
            type: 'fixedScopes',
            week: scope.orderWeek,
            year: scope.orderYear,
            prodKeys: prodKeys.join(','),
          })
        ),
        confirmFixCycle: promptFixCycleConfirm,
        runFixCycle: runEditWithFixCycle,
        requestOrder: (payload) => apiPost('/api/orders', payload),
        requestDistribute: (payload) => apiPost('/api/shipment/distribute', payload),
        refreshAfter: async () => {
          const [, latestDist, latestAdj] = await Promise.all([
            loadWeekProducts(plan.scope),
            loadCustDistForScope(plan.scope, plan.product.prodKey),
            loadCurrentShipmentForPair(plan.scope, plan.customer.custKey, plan.product.prodKey),
          ]);
          return { latestDist, latestAdj };
        },
      });

      setLastResult(outcome);
      setConfirmChecked(false);
      setSessionHistory((prev) => [
        {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          timestamp: new Date().toLocaleTimeString('ko-KR'),
          fullWeek: plan.scope.fullWeek,
          custName: plan.customer.custName,
          prodName: plan.product.prodName,
          outUnit: plan.product.outUnit,
          beforeOutQty: plan.state.currentOutQty,
          afterOutQty: plan.conversion.targetOutQty,
          orderCreated: outcome.orderCreated,
          orderMasterKey: outcome.orderResult?.orderMasterKey || null,
          fixCycleUsed: outcome.fixCycleUsed,
          status: 'VERIFIED',
        },
        ...prev,
      ]);
      // 최신 입력 단위와 수량 표시 동기화
      if (entryMode === ABSORB_ENTRY_MODES.DELTA) {
        setQtyInput('');
      } else {
        setQtyInput(String(plan.conversion.inputQty));
      }
    } catch (err) {
      setErrorBanner(err.message);
      if (err.code === 'STEP2_DISTRIBUTE_FAILED_AFTER_ORDER' && err.step1Committed) {
        setPartialRecovery({
          orderMasterKey: err.step1Result?.orderMasterKey || null,
          shipmentMasterKey: err.step1Result?.shipmentMasterKey || null,
          message: err.message,
        });
        setConfirmChecked(false);
        await Promise.allSettled([
          loadWeekProducts(plan.scope),
          loadCustDistForScope(plan.scope, plan.product.prodKey),
          loadCurrentShipmentForPair(plan.scope, plan.customer.custKey, plan.product.prodKey),
        ]);
      } else if (err.code === 'ORDER_ALREADY_REGISTERED_CONFLICT') {
        setConfirmChecked(false);
      }
      setSessionHistory((prev) => [
        {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          timestamp: new Date().toLocaleTimeString('ko-KR'),
          fullWeek: plan.scope.fullWeek,
          custName: plan.customer.custName,
          prodName: plan.product.prodName,
          outUnit: plan.product.outUnit,
          beforeOutQty: plan.state.currentOutQty,
          afterOutQty: plan.conversion.targetOutQty,
          orderCreated: err.step1Committed === true,
          status: 'ERROR',
          error: err.message,
        },
        ...prev,
      ]);
    } finally {
      setSubmitting(false);
    }
  };

  const quickWeeks = useMemo(() => (activeScope ? distributionWeekButtons(activeScope.fullWeek, 2) : []), [activeScope]);
  const quickSubWeeks = useMemo(() => (activeScope ? distributionSubWeekButtons(activeScope.fullWeek, 4) : []), [activeScope]);

  return (
    <div className="quick-absorb-page" data-testid="quick-absorb-workspace">
      <div className="qa-header card">
        <div className="card-header" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
          <div>
            <span className="card-title" style={{ fontSize: 15 }}>⚡ 빠른 분배 · 미등록주문 통합입력</span>
            <span style={{ marginLeft: 10, fontSize: 12, color: 'var(--text3)' }}>
              주문등록 화면 왕복(A→B→A) 없이 한 화면에서 미등록 주문을 안전하게 선행 등록하고 출고분배까지 원스톱 반영합니다.
            </span>
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            {activeScope && (
              <span className="badge badge-blue" data-testid="absorb-active-scope">
                선택 연도 {activeScope.orderYear}년 · {activeScope.orderWeek}차
              </span>
            )}
            <Link href="/shipment/distribute" className="btn btn-sm">
              출고분배 화면으로 이동
            </Link>
          </div>
        </div>
        <div className="card-body" style={{ paddingTop: 6, paddingBottom: 6 }}>
          <WorkflowGuide workflowId="shipment-quick-absorb" initialRole="영업지원" />
        </div>
      </div>

      {/* 1. 차수 선택 툴바 */}
      <div className="filter-bar" data-testid="absorb-week-controls">
        <WeekInput weekInput={weekInput} label="대상 차수(연도포함)" />
        <label className="filter-label" htmlFor="absorb-year-select">조회 연도</label>
        <select
          id="absorb-year-select"
          className="filter-select"
          aria-label="대상 연도 선택"
          value={explicitYear}
          onChange={(e) => {
            const yr = e.target.value;
            setExplicitYear(yr);
            if (/^\d{4}-\d{2}-\d{2}$/.test(weekInput.value)) {
              weekInput.setValue(`${yr}-${weekInput.value.slice(5)}`);
            }
          }}
        >
          {[2024, 2025, 2026, 2027].map((yr) => (
            <option key={yr} value={String(yr)}>{yr}년</option>
          ))}
        </select>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={!activeScope || productsLoading}
          onClick={() => activeScope && loadWeekProducts(activeScope)}
        >
          {productsLoading ? '조회 중...' : '조회'}
        </button>

        {quickWeeks.length > 0 && (
          <div style={{ display: 'inline-flex', gap: 3, marginLeft: 8, flexWrap: 'wrap' }} aria-label="인접 주차 빠른 선택">
            {quickWeeks.map((wk) => (
              <button
                key={wk}
                type="button"
                className={`chip ${activeScope?.fullWeek === wk ? 'chip-active' : 'chip-inactive'}`}
                onClick={() => { weekInput.setValue(wk); setExplicitYear(wk.slice(0, 4)); }}
              >
                {wk.slice(5)}
              </button>
            ))}
          </div>
        )}
        {quickSubWeeks.length > 0 && (
          <div style={{ display: 'inline-flex', gap: 3, marginLeft: 6, flexWrap: 'wrap' }} aria-label="세부 차수 빠른 선택">
            {quickSubWeeks.map((wk) => (
              <button
                key={wk}
                type="button"
                className={`chip ${activeScope?.fullWeek === wk ? 'chip-active' : 'chip-inactive'}`}
                onClick={() => { weekInput.setValue(wk); setExplicitYear(wk.slice(0, 4)); }}
              >
                -{wk.slice(8)}
              </button>
            ))}
          </div>
        )}
      </div>

      {scopeState.error && (
        <div className="banner-err" role="alert" data-testid="absorb-scope-error">
          {scopeState.error}
        </div>
      )}

      {errorBanner && (
        <div className="banner-err" role="alert" data-testid="absorb-error-banner">
          {errorBanner}
        </div>
      )}

      {partialRecovery && (
        <div className="banner-warn" role="status" data-testid="absorb-partial-recovery">
          <strong>선행 주문등록 완료 · 분배 재시도 필요:</strong> 1단계 주문등록(OrderMasterKey #{partialRecovery.orderMasterKey || '-'})은 이미 커밋되었습니다.
          최신 원장 상태를 다시 불러왔으므로 수량을 확인한 뒤 <strong>기존 주문 보존 · 출고분배 저장</strong>을 다시 누르면 중복 주문 없이 2단계 출고분배만 실행됩니다.
        </div>
      )}

      {/* 2. 메인 3열 반응형 워크스페이스 (1. 품목 → 2. 업체 → 3. 환산/승인/반영) */}
      <div className="qa-grid">
        {/* 패널 1: 품목 선택 */}
        <section className="card qa-panel" aria-label="1단계 품목 선택">
          <div className="card-header">
            <span className="card-title">1. 품목 선택</span>
            <span style={{ fontSize: 11, color: 'var(--text3)', marginLeft: 'auto' }}>
              {mergedProducts.length}건 (차수주문 {weekProducts.length}건 + 카탈로그)
            </span>
          </div>
          <div className="card-body">
            <div style={{ display: 'flex', gap: 4, marginBottom: 6, flexWrap: 'wrap' }}>
              <input
                type="text"
                className="filter-input ime-ko"
                style={{ flex: 1, minWidth: 160, height: 28 }}
                placeholder="품목명·영문명·국가·꽃 검색 (예: 하이드, ㅋㄴㅇㅅ)"
                aria-label="품목 검색"
                data-testid="absorb-product-search"
                value={prodSearch}
                onChange={(e) => { setProdSearch(e.target.value); setShowAllProducts(false); }}
                onKeyDown={(e) => handleListKeyDown(e, visibleProducts, selectedProd?.ProdKey, 'ProdKey', handleSelectProduct, 'absorb-product-')}
              />
              <select
                className="filter-select"
                style={{ height: 28 }}
                aria-label="품종 그룹 필터"
                value={selectedGroupKey}
                onChange={(e) => { setSelectedGroupKey(e.target.value); setShowAllProducts(false); }}
              >
                <option value="">전체 품종</option>
                {groups.map((g) => (
                  <option key={g.key} value={g.key}>{g.label || g.key}</option>
                ))}
              </select>
            </div>

            <div className="qa-list" ref={prodListRef} role="listbox" aria-label="품목 목록">
              {visibleProducts.length === 0 ? (
                <div className="empty-state" style={{ padding: 16 }}>
                  <div className="empty-text">검색 조건에 맞는 품목이 없습니다.</div>
                </div>
              ) : (
                visibleProducts.map((p) => {
                  const isSelected = Number(selectedProd?.ProdKey) === Number(p.ProdKey);
                  const display = suggestDisplayName(p.ProdName) || p.DisplayName || p.ProdName;
                  return (
                    <button
                      key={p.ProdKey}
                      type="button"
                      role="option"
                      aria-selected={isSelected}
                      data-testid={`absorb-product-${p.ProdKey}`}
                      className={`qa-item ${isSelected ? 'qa-item-selected' : ''}`}
                      onClick={() => handleSelectProduct(p)}
                      onKeyDown={(e) => handleListKeyDown(e, visibleProducts, selectedProd?.ProdKey, 'ProdKey', handleSelectProduct, 'absorb-product-')}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6, alignItems: 'baseline' }}>
                        <span style={{ fontWeight: 700, textAlign: 'left', overflowWrap: 'anywhere' }}>{p.ProdName}</span>
                        <span className="badge badge-gray">{p.OutUnit || '박스'}</span>
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text3)', display: 'flex', justifyContent: 'space-between', gap: 6, flexWrap: 'wrap' }}>
                        <span>{display !== p.ProdName ? `${display} · ` : ''}{p.CounName || ''} {p.FlowerName || ''}</span>
                        <span>
                          입고 {fmtDec(p.inQty || 0)} · 주문 {fmtDec(p.orderQty || 0)} · 출고 {fmtDec(p.outQty || 0)}
                        </span>
                      </div>
                    </button>
                  );
                })
              )}
            </div>

            {mergedProducts.length > visibleProducts.length && (
              <div style={{ marginTop: 6, textAlign: 'center' }}>
                <button type="button" className="btn btn-sm" onClick={() => setShowAllProducts(true)}>
                  품목 전체 보기 ({mergedProducts.length - visibleProducts.length}건 더 보기)
                </button>
              </div>
            )}
          </div>
        </section>

        {/* 패널 2: 거래처 선택 및 주문 상태 감지 */}
        <section className="card qa-panel" aria-label="2단계 거래처 선택">
          <div className="card-header">
            <span className="card-title">2. 업체 선택 (미등록 감지)</span>
            <span style={{ fontSize: 11, color: 'var(--text3)', marginLeft: 'auto' }}>
              {selectedProd ? `${mergedCustomers.length}곳` : '품목 먼저 선택'}
            </span>
          </div>
          <div className="card-body">
            <div style={{ display: 'flex', gap: 4, marginBottom: 6, flexWrap: 'wrap' }}>
              <input
                type="text"
                className="filter-input ime-ko"
                style={{ flex: 1, minWidth: 160, height: 28 }}
                placeholder="업체명·코드·초성 검색 (예: 미카엘, alzkdpf)"
                aria-label="업체 검색"
                data-testid="absorb-customer-search"
                value={custSearch}
                onChange={(e) => { setCustSearch(e.target.value); setShowAllCustomers(false); }}
                onKeyDown={(e) => handleListKeyDown(e, visibleCustomers, selectedCust?.CustKey, 'CustKey', handleSelectCustomer, 'absorb-customer-')}
              />
            </div>

            <div style={{ display: 'flex', gap: 4, marginBottom: 6, flexWrap: 'wrap' }} role="group" aria-label="주문 등록 여부 필터">
              {[
                { key: 'all', label: '전체 활성 업체' },
                { key: 'unregistered', label: '미등록 업체만' },
                { key: 'registered', label: '기존 주문 업체만' },
              ].map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  data-testid={`absorb-customer-filter-${tab.key}`}
                  className={`chip ${custFilter === tab.key ? 'chip-active' : 'chip-inactive'}`}
                  onClick={() => { setCustFilter(tab.key); setShowAllCustomers(false); }}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {!selectedProd ? (
              <div className="banner-info">왼쪽에서 분배할 품목을 먼저 선택하세요.</div>
            ) : custLoading ? (
              <div className="banner-info">선택 차수·품목의 업체 주문 현황 조회 중...</div>
            ) : (
              <div className="qa-list" ref={custListRef} role="listbox" aria-label="업체 목록">
                {visibleCustomers.length === 0 ? (
                  <div className="empty-state" style={{ padding: 16 }}>
                    <div className="empty-text">조건에 맞는 활성 업체가 없습니다.</div>
                  </div>
                ) : (
                  visibleCustomers.map((c) => {
                    const isSelected = Number(selectedCust?.CustKey) === Number(c.CustKey);
                    return (
                      <button
                        key={c.CustKey}
                        type="button"
                        role="option"
                        aria-selected={isSelected}
                        data-testid={`absorb-customer-${c.CustKey}`}
                        className={`qa-item ${isSelected ? 'qa-item-selected' : ''}`}
                        onClick={() => handleSelectCustomer(c)}
                        onKeyDown={(e) => handleListKeyDown(e, visibleCustomers, selectedCust?.CustKey, 'CustKey', handleSelectCustomer, 'absorb-customer-')}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6, alignItems: 'center' }}>
                          <span style={{ fontWeight: 700, textAlign: 'left', overflowWrap: 'anywhere' }}>
                            {c.CustName} {c.OrderCode ? <small style={{ color: 'var(--text3)' }}>({c.OrderCode})</small> : null}
                          </span>
                          <span className={`badge ${c.hasActiveOrder ? 'badge-blue' : 'badge-amber'}`}>
                            {c.hasActiveOrder ? `주문 ${fmtDec(c.주문수량)}${selectedProd.OutUnit || ''}` : '미등록'}
                          </span>
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--text3)', display: 'flex', justifyContent: 'space-between', gap: 6 }}>
                          <span>{c.CustArea || '지역 미지정'} · {c.Manager || '-'}</span>
                          <span>현재 출고: {fmtDec(c.출고수량 || 0)}{selectedProd.OutUnit || ''}</span>
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            )}

            {selectedProd && mergedCustomers.length > visibleCustomers.length && (
              <div style={{ marginTop: 6, textAlign: 'center' }}>
                <button type="button" className="btn btn-sm" onClick={() => setShowAllCustomers(true)}>
                  업체 전체 보기 ({mergedCustomers.length - visibleCustomers.length}곳 더 보기)
                </button>
              </div>
            )}
          </div>
        </section>

        {/* 패널 3: 감지 결과 · 단위 환산 · 확인 게이트 · 원스톱 실행 */}
        <section className="card qa-panel" aria-label="3단계 수량 입력 및 통합 실행">
          <div className="card-header">
            <span className="card-title">3. 수량 환산 · 확인 · 실행</span>
          </div>
          <div className="card-body">
            {!selectedProd || !selectedCust || !registrationState ? (
              <div className="banner-info">
                품목과 업체를 선택하면 해당 <strong>연도·차수·업체·품목</strong>의 주문 등록 여부를 즉시 판별합니다.
              </div>
            ) : (
              <>
                {/* 주문 상태 감지 배너 */}
                <div
                  data-testid="absorb-detection-banner"
                  className={registrationState.requiresPrecedingOrder ? 'banner-warn' : 'banner-info'}
                  style={{ marginBottom: 8 }}
                >
                  <div style={{ fontWeight: 700, marginBottom: 3 }}>
                    {registrationState.requiresPrecedingOrder
                      ? '⚠ 주문 미등록 업체 감지 — 선행 주문등록 자동 흡수 대상'
                      : `✓ 기존 활성 주문 있음 (${fmtDec(registrationState.currentOrderQty)} ${selectedProd.OutUnit || '박스'}) — 주문 보존 · 분배만 반영`}
                  </div>
                  <div style={{ fontSize: 12 }}>
                    업무키: <code>{registrationState.scope.orderYear}</code> / <code>{registrationState.scope.orderWeek}</code> / 업체 <code>#{registrationState.custKey}</code>({selectedCust.CustName}) / 품목 <code>#{registrationState.prodKey}</code>({selectedProd.ProdName})
                  </div>
                  <div style={{ fontSize: 11, marginTop: 2 }}>
                    현재 주문: <strong>{fmtDec(registrationState.currentOrderQty)}{selectedProd.OutUnit || ''}</strong> ·
                    현재 출고분배: <strong>{fmtDec(registrationState.currentOutQty)}{selectedProd.OutUnit || ''}</strong> ·
                    기준 단가: <strong>{fmt(registrationState.expectedCost)}원</strong>
                  </div>
                </div>

                {/* 입력 폼 */}
                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label">입력 방식</label>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button
                        type="button"
                        data-testid="absorb-mode-final"
                        className={`chip ${entryMode === ABSORB_ENTRY_MODES.FINAL ? 'chip-active' : 'chip-inactive'}`}
                        onClick={() => setEntryMode(ABSORB_ENTRY_MODES.FINAL)}
                      >
                        최종 분배수량 (FINAL)
                      </button>
                      <button
                        type="button"
                        data-testid="absorb-mode-delta"
                        className={`chip ${entryMode === ABSORB_ENTRY_MODES.DELTA ? 'chip-active' : 'chip-inactive'}`}
                        onClick={() => setEntryMode(ABSORB_ENTRY_MODES.DELTA)}
                      >
                        추가 가산 (DELTA)
                      </button>
                    </div>
                  </div>
                  <div className="form-group">
                    <label className="form-label" htmlFor="absorb-unit-select">입력 단위 (원장 기준: {selectedProd.OutUnit || '박스'})</label>
                    <select
                      id="absorb-unit-select"
                      data-testid="absorb-unit-select"
                      className="form-control"
                      value={unitInput}
                      onChange={(e) => setUnitInput(e.target.value)}
                    >
                      {ABSORB_UNIT_OPTIONS.map((u) => (
                        <option key={u} value={u}>{u}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label" htmlFor="absorb-qty-input">분배 수량 ({unitInput})</label>
                    <input
                      id="absorb-qty-input"
                      data-testid="absorb-qty-input"
                      type="number"
                      min={0}
                      step="0.01"
                      className="form-control"
                      placeholder={`수량 입력 (${unitInput})`}
                      value={qtyInput}
                      onChange={(e) => { setQtyInput(e.target.value); setErrorBanner(''); }}
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label" htmlFor="absorb-cost-input">단가 (원 · 0원 허용)</label>
                    <input
                      id="absorb-cost-input"
                      data-testid="absorb-cost-input"
                      type="number"
                      min={0}
                      step="1"
                      className="form-control"
                      placeholder="단가 입력"
                      value={costInput}
                      onChange={(e) => setCostInput(e.target.value)}
                    />
                  </div>
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label" htmlFor="absorb-outdate-input">출고일 (선택 · 비우면 기본일)</label>
                    <input
                      id="absorb-outdate-input"
                      type="date"
                      className="form-control"
                      value={outDateInput}
                      onChange={(e) => setOutDateInput(e.target.value)}
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label" htmlFor="absorb-memo-input">주문 메모 (미등록 주문 시 기록)</label>
                    <input
                      id="absorb-memo-input"
                      type="text"
                      className="form-control ime-ko"
                      placeholder="선택 입력"
                      value={memoInput}
                      onChange={(e) => setMemoInput(e.target.value)}
                    />
                  </div>
                </div>

                {/* 환산·부작용 실시간 미리보기 */}
                {planPreview.error && qtyInput !== '' && (
                  planPreview.code === 'NO_DISTRIBUTION_CHANGE' ? (
                    <div
                      className="banner-info"
                      style={{ color: 'var(--text2)', background: '#F8FAFC', borderColor: 'var(--border)' }}
                      data-testid="absorb-plan-unchanged"
                    >
                      {lastResult?.success
                        ? '입력된 수량·단가가 방금 반영된 값과 일치합니다. 추가 수정하려면 새 수량 또는 단가를 입력하세요.'
                        : planPreview.error}
                    </div>
                  ) : (
                    <div className="banner-err" role="alert" data-testid="absorb-plan-error">
                      {planPreview.error}
                    </div>
                  )
                )}

                {planPreview.plan && (
                  <div className="card" style={{ marginTop: 6, marginBottom: 8 }} data-testid="absorb-plan-preview">
                    <div className="card-header">
                      <span className="card-title">저장 전 환산 및 원장 영향 미리보기</span>
                    </div>
                    <div className="card-body" style={{ fontSize: 12 }}>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 6, marginBottom: 8 }}>
                        <div className="qa-stat">
                          <span>최종 OutQuantity</span>
                          <strong>{fmtDec(planPreview.plan.conversion.targetOutQty)} {planPreview.plan.product.outUnit}</strong>
                        </div>
                        <div className="qa-stat">
                          <span>3단위 환산 (Box/Bunch/Steam)</span>
                          <strong>
                            {fmtDec(planPreview.plan.conversion.shipmentUnits.box)}박스 / {fmtDec(planPreview.plan.conversion.shipmentUnits.bunch)}단 / {fmtDec(planPreview.plan.conversion.shipmentUnits.steam)}송이
                          </strong>
                        </div>
                        <div className="qa-stat">
                          <span>견적 ({planPreview.plan.product.estUnit})</span>
                          <strong>{fmt(planPreview.plan.estimatePreview.estQuantity)} {planPreview.plan.product.estUnit}</strong>
                        </div>
                        <div className="qa-stat">
                          <span>합계 (부가세포함)</span>
                          <strong>{fmt(planPreview.plan.estimatePreview.gross)}원 (단가 {fmt(planPreview.plan.effectiveUnitCost)}원)</strong>
                        </div>
                      </div>

                      <div style={{ fontSize: 11, color: 'var(--text2)', background: '#F8FAFC', padding: 6, borderRadius: 4, border: '1px solid var(--border)' }}>
                        <div>
                          <strong>1단계 (OrderMaster/OrderDetail/빈 ShipmentMaster):</strong>{' '}
                          {planPreview.plan.requiresPrecedingOrder
                            ? `실행 예정 — source=manual-order, ${planPreview.plan.conversion.targetOutQty}${planPreview.plan.product.outUnit} 등록`
                            : '건너뜀 — 기존 주문수량 그대로 보존'}
                        </div>
                        <div>
                          <strong>2단계 (ShipmentDetail/ShipmentDate):</strong>{' '}
                          실행 예정 — source=distribution-workspace, {fmtDec(planPreview.plan.state.currentOutQty)} → {fmtDec(planPreview.plan.conversion.targetOutQty)}{planPreview.plan.product.outUnit}
                          {' '}(1단계 실패 시 즉시 중단 · 타 연도/타 업체 보존)
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* 미등록 업체 흡수 시 명시 확인 게이트 */}
                {registrationState.requiresPrecedingOrder && (
                  <label
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: 8,
                      padding: 8,
                      marginBottom: 8,
                      borderRadius: 6,
                      border: '1px solid #DDBB66',
                      background: 'var(--amber-bg)',
                      fontSize: 12,
                      cursor: 'pointer',
                    }}
                  >
                    <input
                      type="checkbox"
                      data-testid="absorb-confirm-checkbox"
                      checked={confirmChecked}
                      onChange={(e) => { setConfirmChecked(e.target.checked); setErrorBanner(''); }}
                      style={{ marginTop: 2 }}
                    />
                    <span>
                      <strong>[확인 게이트]</strong>{' '}
                      <code>{registrationState.scope.fullWeek}</code> <strong>{selectedCust.CustName}</strong>의{' '}
                      <strong>{selectedProd.ProdName}</strong> 주문이 미등록이므로, 1단계 선행 주문등록(빈 출고 연결 헤더 포함) 후 2단계 출고분배를 반영하는 것에 동의합니다.
                    </span>
                  </label>
                )}

                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    data-testid="absorb-submit-btn"
                    className={`btn ${registrationState.requiresPrecedingOrder ? 'btn-primary' : 'btn-success'}`}
                    disabled={
                      submitting
                      || !planPreview.plan
                      || (planPreview.plan.requiresPrecedingOrder && !confirmChecked)
                    }
                    onClick={handleExecuteAbsorb}
                  >
                    {submitting
                      ? '처리 중...'
                      : registrationState.requiresPrecedingOrder
                        ? '선행 주문등록 + 출고분배 즉시 반영'
                        : '기존 주문 보존 · 출고분배 저장'}
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm"
                    disabled={submitting}
                    onClick={() => handleSelectCustomer(null)}
                  >
                    업체 선택 초기화
                  </button>
                </div>

                {progressSteps.length > 0 && (
                  <div style={{ marginTop: 8, fontSize: 11, color: 'var(--text2)' }} aria-live="polite">
                    진행 단계: {progressSteps.join(' → ')}
                  </div>
                )}

                {lastResult?.success && (
                  <div className="banner-ok" role="status" style={{ marginTop: 8 }} data-testid="absorb-result-banner">
                    <strong>반영 및 검증 완료:</strong> {lastResult.summaryText}
                    {lastResult.orderCreated && lastResult.orderResult?.orderMasterKey && (
                      <div style={{ fontSize: 11, marginTop: 2 }}>
                        OrderMasterKey #{lastResult.orderResult.orderMasterKey}
                        {lastResult.orderResult?.shipmentMasterKey ? ` · ShipmentMasterKey #${lastResult.orderResult.shipmentMasterKey}` : ''}
                      </div>
                    )}
                    {lastResult.refreshError && (
                      <div style={{ fontSize: 11, color: 'var(--amber)' }}>
                        저장 후 화면 재조회 경고: {lastResult.refreshError}
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        </section>
      </div>

      {/* 4. 세션 내 처리 이력 */}
      <section className="card" style={{ marginTop: 8 }} data-testid="absorb-history-section" aria-label="처리 내역">
        <div className="card-header">
          <span className="card-title">이번 화면 처리 내역 ({sessionHistory.length}건)</span>
        </div>
        <div className="card-body" style={{ padding: 0, overflowX: 'auto' }}>
          <table className="tbl">
            <thead>
              <tr>
                <th>시각</th>
                <th>차수</th>
                <th>업체</th>
                <th>품목</th>
                <th>구분</th>
                <th style={{ textAlign: 'right' }}>분배 전 → 후</th>
                <th>상태</th>
              </tr>
            </thead>
            <tbody>
              {sessionHistory.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ textAlign: 'center', padding: 16, color: 'var(--text3)' }}>
                    아직 이 화면에서 실행한 내역이 없습니다.
                  </td>
                </tr>
              ) : (
                sessionHistory.map((item) => (
                  <tr key={item.id}>
                    <td>{item.timestamp}</td>
                    <td>{item.fullWeek}</td>
                    <td>{item.custName}</td>
                    <td>{item.prodName}</td>
                    <td>
                      <span className={`badge ${item.orderCreated ? 'badge-amber' : 'badge-blue'}`}>
                        {item.orderCreated ? '선행 주문등록 + 분배' : '주문 보존 + 분배'}
                      </span>
                    </td>
                    <td className="num">
                      {fmtDec(item.beforeOutQty)} → {fmtDec(item.afterOutQty)} {item.outUnit}
                    </td>
                    <td>
                      {item.status === 'VERIFIED' ? (
                        <span className="badge badge-green">검증 완료</span>
                      ) : (
                        <span className="badge badge-red" title={item.error}>중단: {item.error}</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* 확정차수 안전 사이클 확인 모달 */}
      {fixModalState && (
        <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="확정차수 해제 및 재확정 확인">
          <div className="modal">
            <div className="modal-header">
              <span className="modal-title">확정된 품목군 안전 저장 확인</span>
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => { fixModalState.resolve(false); setFixModalState(null); }}
              >
                닫기
              </button>
            </div>
            <div className="modal-body" style={{ fontSize: 12, lineHeight: 1.5 }}>
              <p>
                <strong>{fixModalState.plan.scope.fullWeek}</strong>의 품목군{' '}
                <strong>{fixModalState.fixScopeInfo.countryFlowers.join(', ')}</strong>이(가) 확정(isFix=1) 상태입니다.
              </p>
              <p style={{ marginTop: 6 }}>
                <code>확정해제 → {fixModalState.plan.requiresPrecedingOrder ? '선행 주문등록 + 출고분배' : '출고분배 저장'} → 재확정</code>{' '}
                안전 사이클로 진행할까요? (확정해제 실패 시 아무 원장도 쓰지 않고 중단하며, 저장 오류 시에도 원상복구 재확정까지 마칩니다.)
              </p>
            </div>
            <div className="modal-footer">
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => { fixModalState.resolve(true); setFixModalState(null); }}
              >
                확정해제 후 안전 진행
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => { fixModalState.resolve(false); setFixModalState(null); }}
              >
                취소
              </button>
            </div>
          </div>
        </div>
      )}

      <style jsx>{`
        .quick-absorb-page {
          width: 100%;
          min-width: 0;
        }
        .qa-grid {
          display: grid;
          grid-template-columns: minmax(280px, 1.05fr) minmax(280px, 1.05fr) minmax(360px, 1.3fr);
          gap: 8px;
          align-items: start;
        }
        .qa-panel {
          min-width: 0;
        }
        .qa-list {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .qa-item {
          width: 100%;
          text-align: left;
          padding: 7px 9px;
          border: 1px solid var(--border);
          border-radius: 6px;
          background: var(--surface);
          color: var(--text1);
          display: flex;
          flex-direction: column;
          gap: 3px;
        }
        .qa-item:hover {
          background: var(--blue-bg);
          border-color: #8caeee;
        }
        .qa-item-selected {
          background: var(--blue-sel);
          border-color: var(--blue);
          box-shadow: inset 3px 0 var(--blue);
        }
        .qa-stat {
          padding: 6px 8px;
          border: 1px solid var(--border);
          border-radius: 5px;
          background: #fff;
          display: flex;
          flex-direction: column;
          gap: 2px;
        }
        .qa-stat span {
          font-size: 11px;
          color: var(--text3);
        }
        .qa-stat strong {
          font-size: 12px;
          color: var(--text1);
        }
        @media (max-width: 1200px) {
          .qa-grid {
            grid-template-columns: 1fr 1fr;
          }
        }
        @media (max-width: 820px) {
          .qa-grid {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
    </div>
  );
}
