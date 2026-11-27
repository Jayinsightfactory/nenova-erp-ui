import desktopUi from '../../styles/DesktopOrderWorkspace.module.css';
import Head from 'next/head';
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { apiGet, apiPost } from '../../lib/useApi';
import {
  buildSalesPasteRows,
  buildSalesPasteAiPreview,
  buildSalesPasteOrderChanges,
  buildSalesPasteText,
  buildSalesPasteWeekChoices,
  mergeSalesPasteHandoffWeekChoices,
  normalizeSalesPasteInputText,
  replaceSalesPasteProduct,
  replaceSalesPasteUnit,
  resolveDetectedSalesPasteScope,
  salesManagerCustomers,
  salesManagerOptions,
  salesPasteUnitOptions,
} from '../../lib/salesPasteOrder';
import {
  KAKAO_ORDER_HANDOFF_KEY,
  KAKAO_ORDER_SYNC_CHANNEL,
  KAKAO_ORDER_SYNC_PING_KEY,
} from '../../lib/kakaoOrderErpStatus';

const productLabel = (row) =>
  row.displayName || row.prodName || row.inputName || '-';

export default function SalesPasteOrderPage() {
  const baseWeekChoices = useMemo(() => buildSalesPasteWeekChoices(new Date()), []);
  const [kakaoHandoff, setKakaoHandoff] = useState(null);
  const [kakaoSourceOpen, setKakaoSourceOpen] = useState(false);
  const activeKakaoGroup = kakaoHandoff?.groups?.[kakaoHandoff.activeGroupIndex || 0] || null;
  const weekChoices = useMemo(
    () => mergeSalesPasteHandoffWeekChoices(baseWeekChoices, activeKakaoGroup),
    [baseWeekChoices, activeKakaoGroup],
  );
  const [year, setYear] = useState(
    baseWeekChoices[0]?.year || String(new Date().getFullYear()),
  );
  const [week, setWeek] = useState(baseWeekChoices[0]?.week || '');
  const [user, setUser] = useState({});
  const [customers, setCustomers] = useState([]);
  const [manager, setManager] = useState('');
  const [custKey, setCustKey] = useState('');
  const [query, setQuery] = useState('');
  const [products, setProducts] = useState([]);
  const [loadedProductScope, setLoadedProductScope] = useState('');
  const [text, setText] = useState('');
  const [rows, setRows] = useState([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [logs, setLogs] = useState([]);
  const [operationLogs, setOperationLogs] = useState([]);
  const [matchEditor, setMatchEditor] = useState(null);
  const [analysisPreview, setAnalysisPreview] = useState({ status: 'idle', items: [], error: '' });
  const [analysisLogs, setAnalysisLogs] = useState([]);
  const [lastAppliedChanges, setLastAppliedChanges] = useState([]);
  const submitLock = useRef(false);
  const imageEvidence = useRef(null);
  const analysisScope = useRef('');
  analysisScope.current = JSON.stringify([year, week, custKey]);
  const detectedScopeChange = useRef(false);
  const kakaoNeedsCustomerPickRef = useRef(false);
  const appliedHandoffKeyRef = useRef('');
  const autoAnalyzedKeyRef = useRef('');

  useEffect(() => {
    Promise.all([apiGet('/api/auth/me'), apiGet('/api/orders/my-customers')])
      .then(([me, list]) => {
        const nextUser = me.user || {};
        const nextCustomers = list.customers || [];
        setUser(nextUser);
        setCustomers(nextCustomers);
        const mine = String(nextUser.userName || '').trim();
        setManager(mine);
      })
      .catch((error) => setMessage(error.message));
  }, []);

  const managers = useMemo(
    () => salesManagerOptions(customers, user),
    [customers, user],
  );
  const managerCustomers = useMemo(
    () => salesManagerCustomers(customers, manager),
    [customers, manager],
  );
  const visibleCustomers = useMemo(() => {
    const token = query.trim().toLowerCase();
    return managerCustomers
      .filter(
        (row) =>
          !token ||
          `${row.CustName} ${row.OrderCode || ''} ${row.CustArea || ''}`
            .toLowerCase()
            .includes(token),
      )
      .slice(0, token ? 100 : 40);
  }, [managerCustomers, query]);
  const selectedCustomer = useMemo(
    () => customers.find((row) => String(row.CustKey) === String(custKey)),
    [customers, custKey],
  );
  const currentOrders = useMemo(
    () => products.filter((row) => Number(row.CurrentQty || 0) > 0),
    [products],
  );
  const unmatched = useMemo(
    () =>
      rows.filter(
        (row) => !row.prodKey || !(Number(row.qty) > 0) || row.unitConflict || row.unitConversionInvalid,
      ),
    [rows],
  );
  const pendingOrderChanges = useMemo(() => buildSalesPasteOrderChanges(rows), [rows]);
  const visibleOrderChanges = pendingOrderChanges.length ? pendingOrderChanges : lastAppliedChanges;
  const changedProductKeys = useMemo(
    () => new Set(visibleOrderChanges.map((row) => Number(row.prodKey))),
    [visibleOrderChanges],
  );

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('mode') !== 'kakao-import') return;
    try {
      const raw = localStorage.getItem(KAKAO_ORDER_HANDOFF_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.groups) && parsed.groups.length > 0) {
        setKakaoHandoff({
          ...parsed,
          activeGroupIndex: Number.isInteger(parsed.activeGroupIndex) ? parsed.activeGroupIndex : 0,
        });
      }
    } catch {}
  }, []);

  useEffect(() => {
    if (detectedScopeChange.current) detectedScopeChange.current = false;
    else {
      imageEvidence.current = null;
      setRows([]);
      setText('');
      setMessage('');
      setAnalysisPreview({ status: 'idle', items: [], error: '' });
      setLastAppliedChanges([]);
    }
    if (!custKey || !year || !week) {
      setProducts([]);
      setLoadedProductScope('');
      return;
    }
    let active = true;
    setBusy(true);
    apiGet('/api/orders/my-customers', { custKey, year, week })
      .then((result) => {
        if (active) {
          setProducts(result.products || []);
          setLoadedProductScope(`${custKey}:${year}:${week}`);
        }
      })
      .catch((error) => {
        if (active) setMessage(error.message);
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, [custKey, year, week]);

  useEffect(() => {
    if (kakaoNeedsCustomerPickRef.current && !custKey) return;
    if (
      custKey &&
      managerCustomers.some((row) => String(row.CustKey) === String(custKey))
    )
      return;
    setCustKey(managerCustomers[0] ? String(managerCustomers[0].CustKey) : '');
  }, [manager, managerCustomers, custKey]);

  useEffect(() => {
    if (!activeKakaoGroup || !customers.length) return;
    const applyKey = `${kakaoHandoff?.handoffId || 'handoff'}:${activeKakaoGroup.groupKey}`;
    if (appliedHandoffKeyRef.current === applyKey) return;
    appliedHandoffKeyRef.current = applyKey;

    detectedScopeChange.current = true;
    setYear(activeKakaoGroup.year);
    setWeek(activeKakaoGroup.week);
    setRows([]);
    setAnalysisPreview({ status: 'idle', items: [], error: '' });
    setLastAppliedChanges([]);
    setText(activeKakaoGroup.pasteText || '');

    const matchedCustomer = activeKakaoGroup.custKey
      ? customers.find((c) => Number(c.CustKey) === Number(activeKakaoGroup.custKey))
      : null;

    if (matchedCustomer) {
      kakaoNeedsCustomerPickRef.current = false;
      const nextManager = String(matchedCustomer.ManagerName || '').trim();
      if (nextManager) setManager(nextManager);
      setCustKey(String(matchedCustomer.CustKey));
      setQuery('');
      setMessage(
        activeKakaoGroup.majorWeekOnly
          ? `수입방 카톡 발주 ${activeKakaoGroup.itemCount}건을 불러왔습니다. 원문에 대차수(${activeKakaoGroup.originalWeekLabel})만 표기되어 ${activeKakaoGroup.week}로 설정되었으니 1. 등록 차수를 꼭 확인하세요.`
          : `수입방 카톡 발주 ${activeKakaoGroup.itemCount}건을 불러왔습니다. 전산 품목 매칭 결과를 확인한 뒤 [주문만 등록]을 누르세요.`,
      );
    } else {
      kakaoNeedsCustomerPickRef.current = true;
      const hintToken = String(activeKakaoGroup.rawCustomer || '').trim().toLowerCase();
      const candidateRow =
        (activeKakaoGroup.customerCandidates?.[0]?.custKey &&
          customers.find((c) => Number(c.CustKey) === Number(activeKakaoGroup.customerCandidates[0].custKey))) ||
        (hintToken
          ? customers.find((c) =>
              `${c.CustName} ${c.OrderCode || ''} ${c.CustArea || ''}`.toLowerCase().includes(hintToken),
            )
          : null);
      if (candidateRow?.ManagerName) {
        setManager(String(candidateRow.ManagerName).trim());
      }
      setCustKey('');
      setQuery(activeKakaoGroup.rawCustomer || '');
      setMessage(
        `거래처 [${activeKakaoGroup.rawCustomer || '미확인'}] 후보를 좁혔습니다. 3. 업체에서 정확한 거래처를 선택한 뒤 [기존 매칭으로 분석]을 눌러주세요.`,
      );
    }
  }, [activeKakaoGroup, customers, kakaoHandoff]);

  useEffect(() => {
    if (!activeKakaoGroup || !activeKakaoGroup.custKey || activeKakaoGroup.completedAt) return;
    if (!selectedCustomer || Number(selectedCustomer.CustKey) !== Number(activeKakaoGroup.custKey)) return;
    if (year !== activeKakaoGroup.year || week !== activeKakaoGroup.week) return;
    if (loadedProductScope !== `${custKey}:${year}:${week}`) return;
    if (!text.trim() || busy) return;
    const analyzeKey = `${kakaoHandoff?.handoffId || 'handoff'}:${activeKakaoGroup.groupKey}`;
    if (autoAnalyzedKeyRef.current === analyzeKey) return;
    autoAnalyzedKeyRef.current = analyzeKey;
    analyze();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeKakaoGroup, selectedCustomer, loadedProductScope, custKey, year, week, text, busy]);

  function selectKakaoHandoffGroup(nextIndex) {
    if (!kakaoHandoff?.groups?.[nextIndex]) return;
    appliedHandoffKeyRef.current = '';
    autoAnalyzedKeyRef.current = '';
    const updated = { ...kakaoHandoff, activeGroupIndex: nextIndex };
    setKakaoHandoff(updated);
    try {
      localStorage.setItem(KAKAO_ORDER_HANDOFF_KEY, JSON.stringify(updated));
    } catch {}
  }

  function dismissKakaoHandoff() {
    kakaoNeedsCustomerPickRef.current = false;
    setKakaoHandoff(null);
  }

  function pasteOrderImage(event) {
    const file = Array.from(event.clipboardData.files).find(item => item.type.startsWith('image/'));
    if (!file) return;
    event.preventDefault();
    if (busy || submitLock.current) return;
    if (!year || !week || !selectedCustomer) {
      setMessage('차수와 업체를 선택한 뒤 이미지를 붙여넣으세요.');
      return;
    }
    if (!['image/png', 'image/jpeg'].includes(file.type) || file.size > 4 * 1024 * 1024) {
      setMessage('4MB 이하 PNG 또는 JPEG 이미지를 붙여넣으세요.');
      return;
    }
    analyze(event, file);
  }

  async function analyze(_event, image) {
    if (!selectedCustomer || (!image && !text.trim()))
      return setMessage('업체를 선택하고 주문 내용을 붙여넣으세요.');
    setBusy(true);
    const startedAt = new Date().toISOString();
    const appendAnalysisLog = (status, detail) => setAnalysisLogs((previous) => [
      { at: new Date().toISOString(), status, detail },
      ...previous,
    ].slice(0, 20));
    const persistAnalysisLog = (step, detail) => apiPost('/api/log', {
      category: 'sales-paste-analysis',
      step,
      detail,
    }).catch(() => null);
    const scope = analysisScope.current;
    imageEvidence.current = null;
    setMessage(image ? '카톡 이미지에서 주문 내용을 읽는 중입니다…' : 'AI가 입력 문장을 분석 중입니다…');
    setAnalysisPreview({ status: 'analyzing', items: [], error: '', startedAt });
    appendAnalysisLog('시작', `${year} ${week} · ${selectedCustomer.CustName}`);
    persistAnalysisLog('시작', `year=${year} week=${week} custKey=${custKey} chars=${text.length}`);
    setRows([]);
    try {
      let input = text;
      let imageResult;
      if (image) {
        const data = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result).split(',')[1]);
          reader.onerror = () => reject(new Error('클립보드 이미지를 읽을 수 없습니다.'));
          reader.readAsDataURL(image);
        });
        imageResult = await apiPost('/api/orders/sales-paste-image', { mimeType: image.type, data });
        if (scope !== analysisScope.current) return;
        input = imageResult.text;
        setText(input);
      }
      const parsed = await apiPost('/api/orders/parse-paste', {
        selectedCustKey: Number(custKey),
        selectedOrderYear: year,
        // 분석 문맥용 헤더보다 사용자가 붙여넣은 원문의 차수를 우선 판정한다.
        sourceText: normalizeSalesPasteInputText(text),
        ...(image && { sourceText: '' }),
        text: buildSalesPasteText({
          year,
          week,
          customerName: selectedCustomer.CustName,
          text: input,
        }),
      });
      if (image && scope !== analysisScope.current) return;
      if (image && (parsed.orders || []).some(order => (order.items || []).some(item => item.action === '취소'))) {
        throw new Error('취소 주문은 이미지로 등록할 수 없습니다. 원문을 확인하세요.');
      }
      const previewItems = buildSalesPasteAiPreview(parsed);
      if (image && previewItems.length !== input.split('\n').length) {
        throw new Error('이미지에서 읽은 행과 주문 분석 행 수가 다릅니다. 원문을 확인하세요.');
      }
      const previewBase = {
        status: 'complete',
        items: previewItems,
        error: '',
        startedAt,
        completedAt: new Date().toISOString(),
        model: [imageResult?.model, parsed.analysisModel].filter(Boolean).join(' · '),
        source: parsed.parseSource || '',
        expectedCount: Number(parsed.expectedItemCount || 0),
        parsedCount: Number(parsed.parsedItemCount || previewItems.length),
        detectedWeek: parsed.detectedWeek || '',
      };
      setAnalysisPreview(previewBase);
      if ((parsed.orders || []).length !== 1)
        throw new Error(
          '여러 업체 구간이 감지되었습니다. 선택한 한 업체의 품목·수량만 붙여넣으세요.',
        );
      const detectedScope = image ? null : resolveDetectedSalesPasteScope(parsed.detectedWeek, weekChoices);
      if (!image && parsed.detectedWeek && !detectedScope)
        throw new Error(`입력 차수 ${parsed.detectedWeek}는 현재 선택 가능한 베이스~+3 범위가 아닙니다.`);
      let scopeProducts = products;
      if (detectedScope && (detectedScope.year !== year || detectedScope.week !== week)) {
        detectedScopeChange.current = true;
        setYear(detectedScope.year);
        setWeek(detectedScope.week);
        const refreshed = await apiGet('/api/orders/my-customers', {
          custKey,
          year: detectedScope.year,
          week: detectedScope.week,
        });
        scopeProducts = refreshed.products || [];
        setProducts(scopeProducts);
      }
      const nextRows = buildSalesPasteRows(parsed.orders || [], scopeProducts);
      if (!nextRows.length)
        throw new Error('분석된 품목이 없습니다. 붙여넣기 형식을 확인하세요.');
      if (imageResult) {
        imageEvidence.current = {
          model: imageResult.model,
          matchingModel: parsed.analysisModel,
          recommendation: (parsed.orders[0].items || []).map(item => ({
            prodKey: item.prodKey || null,
            qty: item.qty,
            unit: item.unit,
            candidates: (item.suggestedProducts || []).slice(0, 3).map(product => [product.ProdKey, product.MatchScore ?? null]),
          })),
        };
      }
      setRows(nextRows);
      const failed = nextRows.filter(
        (row) => !row.prodKey || !(Number(row.qty) > 0) || row.unitConflict || row.unitConversionInvalid,
      ).length;
      setMessage(
        failed
          ? `LLM 정밀분석 ${nextRows.length}건 · 업체 주문이력 반영 · 매칭/수량 확인 필요 ${failed}건`
          : `LLM 정밀분석 ${nextRows.length}건 · 업체 주문이력 반영 · 전부 등록 가능${detectedScope ? ` · 차수 ${detectedScope.week} 자동 선택` : ''}`,
      );
      const matchedCount = nextRows.filter((row) => row.prodKey && !row.unitConflict && !row.unitConversionInvalid).length;
      const logDetail = `${parsed.analysisModel || 'LLM'} · ${parsed.parseSource || '-'} · 인식 ${previewItems.length}행 · 최종 ${nextRows.length}품목 · 매칭 ${matchedCount} · 확인 ${failed}`;
      appendAnalysisLog('완료', logDetail);
      persistAnalysisLog('완료', `model=${parsed.analysisModel || '-'} source=${parsed.parseSource || '-'} expected=${parsed.expectedItemCount || 0} parsed=${parsed.parsedItemCount || previewItems.length} preview=${previewItems.length} final=${nextRows.length} matched=${matchedCount} unmatched=${failed}`);
    } catch (error) {
      setMessage(error.message);
      setAnalysisPreview((previous) => ({ ...previous, status: 'error', error: error.message, completedAt: new Date().toISOString() }));
      appendAnalysisLog('실패', error.message);
      persistAnalysisLog('실패', `year=${year} week=${week} custKey=${custKey} error=${error.message}`);
    } finally {
      setBusy(false);
    }
  }

  async function register() {
    if (submitLock.current || busy) return;
    if (!selectedCustomer || !rows.length || unmatched.length)
      return setMessage('미매칭 또는 0수량 품목을 모두 해결한 뒤 등록하세요.');
    if (
      !window.confirm(
        `${year}년 ${week} · ${manager} · ${selectedCustomer.CustName}\n${rows.length}개 품목을 주문에만 추가합니다. 분배는 변경하지 않습니다.`,
      )
    )
      return;
    submitLock.current = true;
    setBusy(true);
    const appendOperationLog = (status, detail) => setOperationLogs((previous) => [...previous, { at: new Date().toISOString(), status, detail }].slice(-100));
    setOperationLogs([]);
    appendOperationLog('시작', `${year}년 ${week} · ${selectedCustomer.CustName} · ${rows.length}개 품목`);
    setMessage('주문 원장에 등록하고 재조회 중입니다…');
    try {
      appendOperationLog('처리 중', '주문 DB 등록 요청 · 연도·차수·업체·품목 검증 중');
      const result = await apiPost('/api/orders', {
        source: 'sales-paste',
        orderMode: 'ADD',
        manager,
        custKey: Number(custKey),
        custName: selectedCustomer.CustName,
        year,
        week,
        items: rows.map((row) => ({
          prodKey: Number(row.prodKey),
          prodName: productLabel(row),
          qty: Number(row.qty),
          unit: row.unit,
          expectedCurrentQty: Number(row.currentQty || 0),
        })),
      });
      if (result.success === false || result.verified !== true)
        throw new Error(result.error || '주문등록 검증에 실패했습니다.');
      if (imageEvidence.current) {
        const evidence = imageEvidence.current;
        await apiPost('/api/log', {
          category: 'sales-paste-image-match',
          step: '등록 완료',
          detail: JSON.stringify({
            ...evidence, year, week, custKey, orderMasterKey: result.orderMasterKey,
            selected: rows.map(row => [row.prodKey, row.qty, row.unit]),
          }),
        }).catch(() => appendOperationLog('기록 실패', '주문은 등록됐으나 이미지 매칭 이력을 기록하지 못했습니다.'));
        imageEvidence.current = null;
      }
      (result.results || []).forEach((row) => appendOperationLog(row.status || '등록', `${row.prodName || row.ProdName || row.prodKey || '품목'} · ${row.message || row.qty || ''}`));
      appendOperationLog('처리 중', '주문 DB 반영 완료 · 현재 주문 재조회 중');
      const refreshed = await apiGet('/api/orders/my-customers', {
        custKey,
        year,
        week,
      });
      setProducts(refreshed.products || []);
      const log = {
        at: new Date().toISOString(),
        customer: selectedCustomer.CustName,
        manager,
        year,
        week,
        count: rows.length,
        results: result.results || [],
      };
      setLogs((previous) => [log, ...previous].slice(0, 20));
      setLastAppliedChanges(pendingOrderChanges.map((row) => ({ ...row, applied: true })));
      setRows([]);
      setText('');
      setMessage(
        `${result.message || '주문 등록 완료'} · 현재 주문 재조회 완료 · 분배 변경 없음`,
      );
      appendOperationLog('완료', `${result.message || '주문 등록 완료'} · 재조회 검증 완료 · 분배 변경 없음`);
      const orderMasterKey =
        result.orderMasterKey ||
        (result.results || []).find((r) => r.orderMasterKey)?.orderMasterKey ||
        null;
      try {
        localStorage.setItem(KAKAO_ORDER_SYNC_PING_KEY, String(Date.now()));
        if (typeof BroadcastChannel !== 'undefined') {
          const channel = new BroadcastChannel(KAKAO_ORDER_SYNC_CHANNEL);
          channel.postMessage({
            type: 'KAKAO_ORDER_REGISTERED',
            year,
            week,
            custKey: Number(custKey),
            orderMasterKey,
          });
          channel.close();
        }
      } catch {}
      if (kakaoHandoff && activeKakaoGroup) {
        const nextGroups = kakaoHandoff.groups.map((g, idx) =>
          idx === (kakaoHandoff.activeGroupIndex || 0)
            ? { ...g, completedOrderMasterKey: orderMasterKey, completedAt: new Date().toISOString() }
            : g,
        );
        const updatedHandoff = { ...kakaoHandoff, groups: nextGroups };
        setKakaoHandoff(updatedHandoff);
        try {
          localStorage.setItem(KAKAO_ORDER_HANDOFF_KEY, JSON.stringify(updatedHandoff));
        } catch {}
      }
    } catch (error) {
      appendOperationLog('실패', error.message || '주문등록 실패');
      setMessage(error.message || '주문등록 실패');
    } finally {
      submitLock.current = false;
      setBusy(false);
    }
  }

  async function searchProducts(rowIndex, searchText) {
    const q = String(searchText || '').trim();
    setMatchEditor((previous) => ({ ...(previous || {}), rowIndex, query: searchText, busy: true, error: '' }));
    if (!q) {
      setMatchEditor((previous) => ({ ...previous, busy: false, results: [], error: '검색어를 입력하세요.' }));
      return;
    }
    try {
      const result = await apiGet('/api/products/search', { q });
      setMatchEditor((previous) => previous?.rowIndex === rowIndex
        ? { ...previous, busy: false, results: result.products || [], error: '' }
        : previous);
    } catch (error) {
      setMatchEditor((previous) => previous?.rowIndex === rowIndex
        ? { ...previous, busy: false, results: [], error: error.message }
        : previous);
    }
  }

  function openMatchEditor(rowIndex) {
    const row = rows[rowIndex];
    const searchText = row?.inputName || row?.displayName || row?.prodName || '';
    setMatchEditor({ rowIndex, query: searchText, results: [], busy: false, error: '' });
    searchProducts(rowIndex, searchText);
  }

  async function applyMatchedProduct(rowIndex, product, { closeEditor = false } = {}) {
    const row = rows[rowIndex];
    if (!row || !product?.ProdKey) return;
    const mappingToken = row.matchName || row.inputName;
    try {
      const response = await fetch('/api/orders/mappings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          inputToken: mappingToken,
          prodKey: product.ProdKey,
          prodName: product.ProdName,
          displayName: product.DisplayName,
          flowerName: product.FlowerName,
          counName: product.CounName,
          unit: row.unit,
          force: true,
        }),
      });
      const saved = await response.json().catch(() => ({}));
      if (!response.ok || !saved.success) throw new Error(saved.error || '저장매칭 저장 실패');
      const nextRows = replaceSalesPasteProduct(rows, rowIndex, product, products);
      setRows(nextRows);
      if (closeEditor) setMatchEditor(null);
      const failed = nextRows.filter((item) => !item.prodKey || !(Number(item.qty) > 0) || item.unitConflict || item.unitConversionInvalid).length;
      setMessage(`품목 매칭 수정 완료 · ${product.DisplayName || product.ProdName}${failed ? ` · 확인 필요 ${failed}건` : ' · 전부 등록 가능'}`);
    } catch (error) {
      if (closeEditor) setMatchEditor((previous) => ({ ...previous, error: error.message }));
      else setMessage(`품목 매칭 수정 실패 · ${error.message}`);
    }
  }

  async function selectMatchedProduct(product) {
    return applyMatchedProduct(matchEditor?.rowIndex, product, { closeEditor: true });
  }

  function changeRowUnit(rowIndex, unit) {
    const nextRows = replaceSalesPasteUnit(rows, rowIndex, unit, products);
    setRows(nextRows);
    const row = nextRows.find((item, index) => index === rowIndex);
    setMessage(row?.unitConversionInvalid
      ? `${productLabel(row)} · ${unit} 단위 환산 기준이 없어 등록할 수 없습니다.`
      : `${productLabel(row)} · 입력 단위를 ${unit}(으)로 변경했습니다.`);
  }

  return (
    <>
      <Head>
        <title>영업부 붙여서 주문등록</title>
      </Head>
      <main className={`sales-paste-page ${desktopUi.page}`}>
        <header>
          <div>
            <h1 data-desktop-chrome>내 업체 주문등록</h1>
            <p>
              업체를 선택하고 품목·수량만 붙여넣습니다. 주문만 등록하며
              출고분배는 변경하지 않습니다.
            </p>
          </div>
          <strong>{user.userName || user.userId || '로그인 사용자'}</strong>
        </header>
        <nav className="entry-tabs" aria-label="주문 입력 방식">
          <Link href="/orders/my-customers">수량 직접 입력</Link>
          <span aria-current="page">붙여서 주문등록</span>
        </nav>
        {kakaoHandoff && activeKakaoGroup && (
          <section className="kakao-handoff-banner" aria-label="수입방 카톡 발주 이관 정보">
            <div className="kakao-handoff-head">
              <div>
                <strong>수입방 카톡 발주 반자동 넘겨받기</strong>
                <span>
                  {activeKakaoGroup.year}년 {activeKakaoGroup.week}차 ·{' '}
                  {activeKakaoGroup.custName || activeKakaoGroup.rawCustomer || '거래처 선택 필요'} · 품목{' '}
                  {activeKakaoGroup.itemCount}건
                </span>
                {activeKakaoGroup.completedAt && (
                  <em className="kakao-handoff-done">
                    등록 완료{activeKakaoGroup.completedOrderMasterKey ? ` (#${activeKakaoGroup.completedOrderMasterKey})` : ''}
                  </em>
                )}
              </div>
              <div className="kakao-handoff-controls">
                {activeKakaoGroup.sourceMessages?.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setKakaoSourceOpen((prev) => !prev)}
                  >
                    {kakaoSourceOpen
                      ? '카톡 원문 접기'
                      : `카톡 원문 근거 보기 (${activeKakaoGroup.sourceMessages.length}건)`}
                  </button>
                )}
                <button type="button" onClick={dismissKakaoHandoff}>
                  배너 닫기
                </button>
              </div>
            </div>
            {activeKakaoGroup.majorWeekOnly && (
              <p className="kakao-handoff-warn" role="alert">
                카톡 원문에 세부차수 없이 대차수({activeKakaoGroup.originalWeekLabel})만 기재되어 기본 차수({activeKakaoGroup.week})로 설정되었습니다. 등록 전 아래 1. 등록 차수에서 1차/2차 여부를 반드시 확인하세요.
              </p>
            )}
            {activeKakaoGroup.items?.some((it) => /^(?:FB|HB|QB|EB)$/i.test(it.sourceUnit)) && (
              <p className="kakao-handoff-unit-note">
                원문 박스 규격 참고:{' '}
                {activeKakaoGroup.items
                  .filter((it) => /^(?:FB|HB|QB|EB)$/i.test(it.sourceUnit))
                  .map((it) => `${it.product} ${it.quantity}${it.sourceUnit}`)
                  .join(' · ')}
              </p>
            )}
            {kakaoHandoff.groups.length > 1 && (
              <div className="kakao-handoff-groups" role="group" aria-label="이관된 거래처 묶음 선택">
                {kakaoHandoff.groups.map((grp, idx) => (
                  <button
                    key={grp.groupKey}
                    type="button"
                    className={idx === (kakaoHandoff.activeGroupIndex || 0) ? 'active' : ''}
                    onClick={() => selectKakaoHandoffGroup(idx)}
                  >
                    {grp.year}/{grp.week} · {grp.custName || grp.rawCustomer} ({grp.itemCount}건)
                    {grp.completedAt ? ' [등록완료]' : ''}
                  </button>
                ))}
              </div>
            )}
            {kakaoSourceOpen && activeKakaoGroup.sourceMessages?.length > 0 && (
              <div className="kakao-handoff-sources">
                {activeKakaoGroup.sourceMessages.map((msg) => (
                  <article key={msg.id}>
                    <small>
                      {msg.room} · {msg.time}
                    </small>
                    <pre>{msg.text}</pre>
                  </article>
                ))}
              </div>
            )}
          </section>
        )}
        <section className="scope">
          <div>
            <b>1. 등록 차수</b>
            <div className="week-groups">
              {[0, 1, 2, 3].map((offset) => (
                <div key={offset}>
                  <small>
                    {offset === 0 ? '베이스 차수' : `베이스 +${offset}`}
                  </small>
                  {weekChoices
                    .filter((choice) => choice.offset === offset)
                    .map((choice) => (
                      <button
                        key={`${choice.year}-${choice.week}`}
                        className={
                          year === choice.year && week === choice.week
                            ? 'active'
                            : ''
                        }
                        onClick={() => {
                          setYear(choice.year);
                          setWeek(choice.week);
                        }}
                      >
                        {choice.year}년 {choice.label}
                      </button>
                    ))}
                </div>
              ))}
            </div>
          </div>
          <label>
            <b>2. 담당자</b>
            <select
              value={manager}
              onChange={(event) => setManager(event.target.value)}
            >
              {managers.map((name) => (
                <option key={name}>{name}</option>
              ))}
            </select>
            <small>로그인 계정 담당자가 기본 선택됩니다.</small>
          </label>
          <div>
            <b>3. 업체</b>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="업체명·클라이언트 번호 검색"
            />
            <div className="customers">
              {visibleCustomers.map((row) => (
                <button
                  key={row.CustKey}
                  className={
                    String(row.CustKey) === String(custKey) ? 'active' : ''
                  }
                  onClick={() => {
                    kakaoNeedsCustomerPickRef.current = false;
                    setCustKey(String(row.CustKey));
                  }}
                >
                  <span>
                    {row.CustName}
                    {row.OrderCode && <mark>{row.OrderCode}</mark>}
                  </span>
                  <small>
                    {row.CustArea || '-'} · 최근 {row.LastOrderWeek || '없음'}
                  </small>
                </button>
              ))}
            </div>
          </div>
        </section>
        {selectedCustomer && (
          <div className="selected">
            <b>{selectedCustomer.CustName}</b>
            <span>
              {year}년 {week} · 담당 {manager}
            </span>
            <em>주문만 등록 / 분배 보존</em>
          </div>
        )}
        {message && (
          <div className="notice" role="status">
            {message}
          </div>
        )}
        <div className="workspace">
          <section className="paste-box">
            <div className="paste-analysis-grid">
              <div className="paste-entry">
                <h2>붙여넣기 입력</h2>
                <aside className="entry-guide">
                  <b>담당자 입력 규칙</b>
                  <span>첫 줄: 차수 · 국가/화종 · 추가 또는 취소</span>
                  <span>다음 줄부터: 품목명 수량 단위 (예: 휘슬러 1박스)</span>
                  <span>합계·대화·배송 메모는 주문 품목과 다른 줄에 적고, 한 번에 한 업체만 등록</span>
                </aside>
                <textarea
                  value={text}
                  onPaste={pasteOrderImage}
                  readOnly={busy}
                  onChange={(event) => {
                    if (imageEvidence.current) {
                      imageEvidence.current = null;
                      setRows([]);
                    }
                    setText(event.target.value);
                  }}
                  placeholder={
                    '카톡 이미지 또는 주문 텍스트를 Ctrl+V로 붙여넣으세요.\n예) 돈셀 2박스\n문라이트 3박스'
                  }
                />
                <div className="actions">
                  <button
                    onClick={analyze}
                    disabled={busy || !custKey || !text.trim()}
                  >
                    {busy ? '처리 중' : '기존 매칭으로 분석'}
                  </button>
                  <button
                    className="register"
                    onClick={register}
                    disabled={busy || !rows.length || Boolean(unmatched.length)}
                  >
                    주문만 등록
                  </button>
                </div>
              </div>
              <div className="analysis">
                <div className="analysis-heading">
                  <h2>
                    분석 결과 <small>{rows.length}건</small>
                  </h2>
                  <span>원문 → 전산 매칭을 비교하고, 오른쪽 대안을 누르면 즉시 변경됩니다.</span>
                </div>
                {rows.length ? (
                  <table>
                    <colgroup>
                      <col className="col-status" />
                      <col className="col-input" />
                      <col className="col-match" />
                      <col className="col-qty" />
                      <col className="col-current" />
                      <col className="col-final" />
                      <col className="col-edit" />
                    </colgroup>
                    <thead>
                      <tr>
                        <th>상태</th>
                        <th>입력값</th>
                        <th>매칭값</th>
                        <th>수량</th>
                        <th>현재 주문</th>
                        <th>등록 후</th>
                        <th>매칭 수정</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row, index) => (
                        <tr
                          key={`${row.prodKey || row.inputName}-${index}`}
                          className={
                            !row.prodKey || row.unitConflict || row.unitConversionInvalid ? 'bad' : ''
                          }
                        >
                          <td>
                            {row.prodKey &&
                            Number(row.qty) > 0 &&
                            !row.unitConflict && !row.unitConversionInvalid
                              ? '매칭'
                              : row.unitConflict
                                ? '단위 충돌'
                                : row.unitConversionInvalid
                                  ? '환산 불가'
                                : '확인 필요'}
                          </td>
                          <td className="match-source-cell">
                            <span className="cell-kicker">붙여넣기 원문</span>
                            <b>{row.inputName || '-'}</b>
                            <small>{row.customerInput || ''}</small>
                          </td>
                          <td className="match-target-cell">
                            <span className="cell-kicker">전산 매칭</span>
                            <b>{productLabel(row)}</b>
                            <small>{[row.counName, row.flowerName, row.outUnit].filter(Boolean).join(' · ')}</small>
                          </td>
                          <td>
                            <div className="quantity-unit">
                              <b>{row.qty}</b>
                              <select
                                aria-label={`${row.inputName || productLabel(row)} 입력 단위`}
                                value={row.unit || ''}
                                onChange={(event) => changeRowUnit(index, event.target.value)}
                              >
                                {salesPasteUnitOptions(row).map((unit) => (
                                  <option key={unit} value={unit}>
                                    {unit}{unit === row.defaultUnit ? ' (기본)' : ''}
                                  </option>
                                ))}
                              </select>
                            </div>
                          </td>
                          <td>
                            {row.currentQty} {row.outUnit || row.unit}
                          </td>
                          <td>
                            {row.finalQty ?? '-'} {row.outUnit || row.unit}
                          </td>
                          <td>
                            <div className="match-shortcuts">
                              {(row.suggestedProducts || [])
                                .filter((product) => Number(product.ProdKey) !== Number(row.prodKey))
                                .slice(0, 3)
                                .map((product, rank) => (
                                  <button
                                    key={product.ProdKey}
                                    className="match-candidate"
                                    type="button"
                                    title={`대안 ${rank + 1} · ${product.DisplayName || product.ProdName}`}
                                    onClick={() => applyMatchedProduct(index, product)}
                                  >
                                    <small>대안 {rank + 1}</small>
                                    <b>{product.DisplayName || product.ProdName}</b>
                                  </button>
                                ))}
                              <button className="match-edit" type="button" onClick={() => openMatchEditor(index)}>
                                더보기
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <p className="empty">
                    붙여넣기 후 분석하면 기존 품목 매칭 결과와 현재 주문수량이
                    바로 옆에 표시됩니다.
                  </p>
                )}
              </div>
            </div>
          </section>
          <aside>
            <section className="current-orders">
              <h2>현재 주문등록 현황</h2>
              <p>
                {selectedCustomer?.CustName || '업체'} · {year}년 {week}
              </p>
              {!!visibleOrderChanges.length && (
                <div className="order-change-summary" aria-live="polite">
                  <b>{pendingOrderChanges.length ? '변경 예정' : '방금 등록 변경'} {visibleOrderChanges.length}건</b>
                  {visibleOrderChanges.map((change) => (
                    <div key={change.prodKey}>
                      <span>
                        <small>{change.flowerName}</small>
                        <strong>{change.label}</strong>
                      </span>
                      <em>
                        {change.beforeQty} → {change.afterQty} {change.unit}
                        <small>+{change.deltaQty} {change.unit}</small>
                      </em>
                    </div>
                  ))}
                </div>
              )}
              {busy && !products.length ? (
                <div className="empty">조회 중…</div>
              ) : currentOrders.length ? (
                <div className="current-list">
                  {currentOrders.map((row) => (
                    <div key={row.ProdKey} className={changedProductKeys.has(Number(row.ProdKey)) ? 'changed' : ''}>
                      <span>
                        <small>
                          {row.CountryFlower || row.FlowerName || ''}
                        </small>
                        <b>{row.DisplayName || row.ProdName}</b>
                      </span>
                      <strong>
                        {Number(row.CurrentQty)} {row.OutUnit}
                      </strong>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="empty">현재 등록된 주문이 없습니다.</div>
              )}
            </section>
            <section className={`ai-preview ${analysisPreview.status}`} aria-live="polite">
              <h2>AI 인식 결과</h2>
              {analysisPreview.status === 'idle' && (
                <div className="empty">분석을 누르면 AI가 읽은 품목과 수량이 여기에 표시됩니다.</div>
              )}
              {analysisPreview.status === 'analyzing' && (
                <div className="ai-loading"><span />AI 문장 분석 및 기존 매칭 대조 중…</div>
              )}
              {analysisPreview.error && <div className="match-error" role="alert">분석 실패: {analysisPreview.error}</div>}
              {analysisPreview.status !== 'idle' && analysisPreview.status !== 'analyzing' && (
                <div className="ai-meta">
                  <b>{analysisPreview.model || '분석 모델'}</b>
                  <span>{analysisPreview.source === 'llm' ? 'LLM 선택' : analysisPreview.source === 'rules' ? '규칙 교차검증 선택' : analysisPreview.source || '-'}</span>
                  <span>원문 {analysisPreview.expectedCount || '-'}행 · 인식 {analysisPreview.parsedCount || analysisPreview.items.length}행</span>
                  {analysisPreview.detectedWeek && <span>차수 {analysisPreview.detectedWeek}</span>}
                </div>
              )}
              {!!analysisPreview.items.length && (
                <div className="ai-items">
                  {analysisPreview.items.map((item) => (
                    <div key={item.id} className={item.prodKey ? 'matched' : 'unmatched'}>
                      <span>
                        <b>{item.inputName}</b>
                        <small>{item.customerName} · {item.action}</small>
                      </span>
                      <strong>{item.qty} {item.unit}</strong>
                      <em>{item.prodKey ? `✓ ${item.matchedName}` : '⚠ 품목 매칭 필요'}</em>
                    </div>
                  ))}
                </div>
              )}
              {!!analysisLogs.length && (
                <details className="analysis-log">
                  <summary>분석 실행 로그 {analysisLogs.length}건</summary>
                  {analysisLogs.map((log, index) => <div key={`${log.at}-${index}`}><b>{log.status}</b><span>{new Date(log.at).toLocaleTimeString('ko-KR')} · {log.detail}</span></div>)}
                </details>
              )}
            </section>
            <section>
              <h2>주문등록 실시간 진행 로그</h2>
              {operationLogs.length ? <div className="operation-logs" role="log" aria-live="polite">{operationLogs.map((log, index) => <div key={`${log.at}-${index}`}><b>{log.status}</b><span>{new Date(log.at).toLocaleTimeString('ko-KR')} · {log.detail}</span></div>)}</div> : <div className="empty">등록 버튼을 누르면 DB 처리와 재조회 단계가 표시됩니다.</div>}
            </section>
            <section>
              <h2>이번 작업 로그</h2>
              {logs.length ? (
                <div className="logs">
                  {logs.map((log, index) => (
                    <div key={`${log.at}-${index}`}>
                      <b>
                        {log.customer} · {log.count}건
                      </b>
                      <span>
                        {new Date(log.at).toLocaleString('ko-KR')} · {log.year}{' '}
                        {log.week}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="empty">이 화면에서 실행한 작업이 없습니다.</div>
              )}
            </section>
          </aside>
        </div>
        {matchEditor && (
          <div className="match-modal" role="dialog" aria-modal="true" aria-label="품목 매칭 검색">
            <div className="match-card">
              <header>
                <div>
                  <h2>후순위 품목 더보기</h2>
                  <p>입력값: {rows[matchEditor.rowIndex]?.inputName || '-'}</p>
                </div>
                <button type="button" onClick={() => setMatchEditor(null)}>닫기</button>
              </header>
              <form onSubmit={(event) => { event.preventDefault(); searchProducts(matchEditor.rowIndex, matchEditor.query); }}>
                <input autoFocus value={matchEditor.query || ''} onChange={(event) => setMatchEditor((previous) => ({ ...previous, query: event.target.value }))} placeholder="품목명·품종·국가 검색" />
                <button type="submit" disabled={matchEditor.busy}>{matchEditor.busy ? '검색 중' : '검색'}</button>
              </form>
              {matchEditor.error && <div className="match-error" role="alert">{matchEditor.error}</div>}
              <h3 className="match-more-title">검색 결과 · 클릭하면 바로 매칭 변경</h3>
              <div className="match-results">
                {(matchEditor.results || [])
                  .filter((product) => Number(product.ProdKey) !== Number(rows[matchEditor.rowIndex]?.prodKey))
                  .map((product, rank) => (
                  <button key={product.ProdKey} type="button" onClick={() => selectMatchedProduct(product)}>
                    <em>대안 {rank + 1}</em>
                    <b>{product.DisplayName || product.ProdName}</b>
                    <span>{product.ProdName}</span>
                    <small>{product.CounName || '-'} · {product.FlowerName || '-'} · {product.OutUnit || '-'}</small>
                  </button>
                ))}
                {!matchEditor.busy && !(matchEditor.results || []).some((product) => Number(product.ProdKey) !== Number(rows[matchEditor.rowIndex]?.prodKey)) && !matchEditor.error && <div className="empty">다른 후순위 품목이 없습니다. 검색어를 바꿔보세요.</div>}
              </div>
              <footer>선택한 매칭은 저장되어 다음 분석에도 동일하게 적용됩니다.</footer>
            </div>
          </div>
        )}
      </main>
      <style jsx>{`
        .sales-paste-page {
          max-width: 1880px;
          margin: auto;
          padding: 8px 14px;
          color: #172033;
        }
        header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 10px 14px;
          background: #123b7a;
          color: #fff;
          border-radius: 7px;
        }
        h1 {
          margin: 0;
          font-size: 22px;
        }
        header p {
          margin: 2px 0 0;
          color: #dbeafe;
        }
        header > strong {
          padding: 7px 12px;
          background: #ffffff1f;
          border-radius: 20px;
        }
        .entry-tabs {
          display: flex;
          gap: 4px;
          padding-top: 7px;
        }
        .entry-tabs :global(a),
        .entry-tabs span {
          padding: 7px 14px;
          border: 1px solid #aebbd0;
          border-radius: 6px;
          text-decoration: none;
          color: #344054;
          background: #fff;
          font-weight: 800;
        }
        .entry-tabs span {
          background: #155bd7;
          color: #fff;
          border-color: #155bd7;
        }
        .kakao-handoff-banner {
          margin-top: 8px;
          padding: 9px 12px;
          border: 1px solid #93c5fd;
          border-radius: 6px;
          background: #f8fbff;
          color: #0f172a;
        }
        .kakao-handoff-head {
          display: flex;
          flex-wrap: wrap;
          justify-content: space-between;
          align-items: center;
          gap: 8px;
        }
        .kakao-handoff-head strong {
          margin-right: 8px;
          color: #1e3a8a;
          font-size: 14px;
        }
        .kakao-handoff-head span {
          font-size: 13.5px;
          color: #334155;
        }
        .kakao-handoff-done {
          margin-left: 8px;
          padding: 2px 7px;
          border-radius: 4px;
          background: #dcfce7;
          color: #166534;
          font-style: normal;
          font-weight: 700;
          font-size: 12.5px;
        }
        .kakao-handoff-controls {
          display: flex;
          gap: 6px;
        }
        .kakao-handoff-controls button,
        .kakao-handoff-groups button {
          padding: 5px 10px;
          background: #fff;
          font-size: 13px;
          font-weight: 700;
          color: #1e293b;
          cursor: pointer;
        }
        .kakao-handoff-groups button.active {
          background: #155bd7;
          border-color: #155bd7;
          color: #fff;
        }
        .kakao-handoff-warn {
          margin: 6px 0 0;
          padding: 6px 9px;
          border-radius: 5px;
          background: #fffbeb;
          border: 1px solid #fde68a;
          color: #92400e;
          font-size: 13px;
          font-weight: 600;
        }
        .kakao-handoff-unit-note {
          margin: 5px 0 0;
          font-size: 12.5px;
          color: #475569;
        }
        .kakao-handoff-groups {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
          margin-top: 7px;
        }
        .kakao-handoff-sources {
          margin-top: 8px;
          display: grid;
          gap: 6px;
        }
        .kakao-handoff-sources article {
          padding: 7px 9px;
          border: 1px solid #cbd5e1;
          border-radius: 5px;
          background: #fff;
        }
        .kakao-handoff-sources small {
          display: block;
          margin-bottom: 4px;
          color: #475569;
          font-weight: 600;
        }
        .kakao-handoff-sources pre {
          margin: 0;
          white-space: pre-wrap;
          font-family: 'Pretendard Variable', 'Pretendard', -apple-system, BlinkMacSystemFont, 'Malgun Gothic', '맑은 고딕', sans-serif;
          font-size: 13px;
          line-height: 1.45;
        }
        .scope {
          display: grid;
          grid-template-columns: 1.3fr 220px 1.5fr;
          gap: 10px;
          margin-top: 8px;
          padding: 8px;
          background: #f3f6fa;
          border: 1px solid #c9d4e3;
        }
        .scope > div,
        .scope > label {
          display: flex;
          flex-direction: column;
          gap: 5px;
        }
        .scope select,
        .scope input,
        button,
        textarea {
          border: 1px solid #aebbd0;
          border-radius: 5px;
        }
        .scope select,
        .scope input {
          height: 34px;
          padding: 0 8px;
        }
        .week-groups {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 4px;
        }
        .week-groups > div {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 3px;
        }
        .week-groups small {
          grid-column: 1/-1;
        }
        .week-groups button {
          min-height: 30px;
          background: white;
          font-weight: 700;
        }
        .week-groups button.active,
        .customers button.active {
          background: #155bd7;
          color: #fff;
          border-color: #155bd7;
        }
        .customers {
          display: flex;
          flex-wrap: wrap;
          gap: 4px;
          max-height: 112px;
          overflow-y: auto;
          overflow-x: hidden;
          padding-bottom: 2px;
        }
        .customers button {
          min-width: 135px;
          flex: 0 0 135px;
          display: flex;
          flex-direction: column;
          align-items: flex-start;
          padding: 5px 7px;
          background: white;
        }
        .customers mark {
          margin-left: 5px;
          padding: 1px 3px;
          background: #fff3cd;
          border-radius: 3px;
        }
        .selected {
          display: flex;
          gap: 12px;
          align-items: center;
          padding: 6px 10px;
          background: #eaf2ff;
          border: 1px solid #9fc2f2;
        }
        .selected em {
          margin-left: auto;
          font-style: normal;
          color: #087443;
          font-weight: 800;
        }
        .notice {
          padding: 7px 10px;
          background: #fff5d8;
          border: 1px solid #e9bd50;
        }
        .workspace {
          display: grid;
          grid-template-columns: minmax(0, 1fr) 310px;
          gap: 10px;
          margin-top: 8px;
        }
        .paste-box,
        aside section {
          border: 1px solid #c9d4e3;
          background: #fff;
          padding: 9px;
        }
        h2 {
          font-size: 15px;
          margin: 0 0 6px;
        }
        .paste-box textarea {
          width: 100%;
          height: 250px;
          resize: vertical;
          padding: 9px;
          font: 14px/1.45 sans-serif;
        }
        .paste-analysis-grid {
          display: grid;
          grid-template-columns: minmax(275px, 300px) minmax(0, 1fr);
          gap: 10px;
          align-items: start;
        }
        .paste-entry,
        .analysis {
          min-width: 0;
        }
        .entry-guide {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 3px 12px;
          margin: 0 0 6px;
          padding: 5px 8px;
          border: 1px solid #f1d48a;
          background: #fff9e8;
          color: #624800;
          font-size: 12px;
          line-height: 1.25;
        }
        .entry-guide b { color: #8a5700; }
        .actions {
          display: flex;
          justify-content: flex-end;
          gap: 6px;
          margin: 5px 0;
        }
        .actions button {
          padding: 7px 13px;
          background: #eaf2ff;
          font-weight: 800;
        }
        .actions .register {
          background: #087443;
          color: white;
        }
        .actions button:disabled {
          opacity: 0.45;
        }
        .analysis {
          max-height: calc(100vh - 365px);
          overflow: auto;
        }
        .analysis-heading {
          display: flex;
          justify-content: space-between;
          align-items: baseline;
          gap: 12px;
          margin-bottom: 6px;
        }
        .analysis-heading h2 { margin: 0; }
        .analysis-heading > span {
          color: #526278;
          font-size: 11px;
          text-align: right;
        }
        table {
          width: 100%;
          min-width: 1000px;
          border-collapse: collapse;
          font-size: 12px;
        }
        th,
        td {
          padding: 5px;
          border: 1px solid #d8e0ea;
          text-align: left;
        }
        th {
          position: sticky;
          top: 0;
          background: #e8eef6;
        }
        .bad {
          background: #fff0ee;
          color: #a11;
        }
        .analysis td:nth-child(4),
        .analysis td:nth-child(5),
        .analysis td:nth-child(6) {
          text-align: right;
        }
        .col-status { width: 55px; }
        .col-input { width: 240px; }
        .col-match { width: 270px; }
        .col-qty { width: 90px; }
        .col-current,
        .col-final { width: 65px; }
        .col-edit { width: 240px; }
        .match-source-cell,
        .match-target-cell {
          min-width: 0;
          vertical-align: top;
          overflow-wrap: anywhere;
        }
        .match-source-cell > b,
        .match-target-cell > b {
          display: block;
          margin-top: 2px;
          font-size: 13px;
          line-height: 1.32;
        }
        .match-target-cell {
          background: #f4f8ff;
          border-left: 3px solid #7ba5df;
        }
        .cell-kicker {
          display: inline-block;
          padding: 1px 5px;
          border-radius: 9px;
          background: #e8eef6;
          color: #526278;
          font-size: 9px;
          font-weight: 800;
        }
        .match-target-cell .cell-kicker {
          background: #dbeafe;
          color: #174b91;
        }
        .quantity-unit {
          display: flex;
          align-items: center;
          justify-content: flex-end;
          gap: 4px;
          white-space: nowrap;
        }
        .quantity-unit select {
          max-width: 82px;
          padding: 3px 2px;
          border: 1px solid #9aaac0;
          border-radius: 4px;
          background: #fff;
          font-size: 11px;
        }
        .match-shortcuts {
          display: grid;
          grid-template-columns: 1fr;
          gap: 3px;
          min-width: 0;
          text-align: left;
        }
        .match-candidate {
          min-width: 0;
          padding: 3px 5px;
          background: #eef5ff;
          border-color: #9ab7df;
          color: #163d74;
          cursor: pointer;
          text-align: left;
        }
        .match-candidate small,
        .match-candidate b {
          display: block;
          overflow: hidden;
        }
        .match-candidate small {
          color: #62718a;
          font-size: 10px;
        }
        .match-candidate b {
          display: -webkit-box;
          min-height: 29px;
          font-size: 11px;
          line-height: 1.3;
          white-space: normal;
          overflow-wrap: anywhere;
          -webkit-box-orient: vertical;
          -webkit-line-clamp: 2;
        }
        .match-edit {
          justify-self: start;
          padding: 4px 7px;
          white-space: nowrap;
          background: #fff;
          color: #155bd7;
          font-weight: 800;
        }
        .analysis td small {
          display: block;
          color: #65758b;
        }
        .empty {
          padding: 16px;
          text-align: center;
          color: #65758b;
          background: #f8fafc;
        }
        aside {
          display: flex;
          flex-direction: column;
          gap: 8px;
          max-height: calc(100vh - 245px);
          overflow: auto;
        }
        .current-list > div {
          display: flex;
          justify-content: space-between;
          gap: 8px;
          padding: 4px;
          border-bottom: 1px solid #e5eaf0;
        }
        .current-orders {
          border-top: 3px solid #c62828;
        }
        .order-change-summary {
          margin-bottom: 7px;
          border: 1px solid #ef9a9a;
          background: #fff2f2;
          color: #9f1717;
        }
        .order-change-summary > b {
          display: block;
          padding: 5px 7px;
          border-bottom: 1px solid #efb1b1;
          background: #ffdede;
        }
        .order-change-summary > div {
          display: flex;
          justify-content: space-between;
          gap: 8px;
          padding: 5px 7px;
          border-bottom: 1px solid #f4cccc;
        }
        .order-change-summary span,
        .order-change-summary em {
          display: flex;
          flex-direction: column;
          min-width: 0;
        }
        .order-change-summary strong {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .order-change-summary em {
          align-items: flex-end;
          flex: 0 0 auto;
          font-style: normal;
          font-weight: 900;
          color: #c62828;
        }
        .order-change-summary em small { color: #c62828; }
        .current-list > div.changed {
          background: #fff0f0;
          box-shadow: inset 3px 0 #d32f2f;
        }
        .current-list > div.changed strong { color: #c62828; }
        .ai-preview {
          border-top: 3px solid #155bd7;
        }
        .ai-loading {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 14px;
          color: #155bd7;
          font-weight: 800;
          background: #eef5ff;
        }
        .ai-loading span {
          width: 14px;
          height: 14px;
          border: 2px solid #aac7f5;
          border-top-color: #155bd7;
          border-radius: 50%;
          animation: spin .8s linear infinite;
        }
        @keyframes spin { to { transform: rotate(360deg); } }
        .ai-meta {
          display: flex;
          flex-wrap: wrap;
          gap: 5px;
          margin-bottom: 6px;
        }
        .ai-meta > * {
          padding: 2px 6px;
          border-radius: 10px;
          background: #eef2f7;
          font-size: 10px;
        }
        .ai-items {
          max-height: 290px;
          overflow: auto;
          border: 1px solid #d8e0ea;
        }
        .ai-items > div {
          display: grid;
          grid-template-columns: minmax(0, 1fr) 70px minmax(100px, 1fr);
          gap: 6px;
          align-items: center;
          padding: 5px 6px;
          border-bottom: 1px solid #e5eaf0;
          font-size: 11px;
        }
        .ai-items > div.unmatched { background: #fff4e5; }
        .ai-items span { display: flex; min-width: 0; flex-direction: column; }
        .ai-items strong { text-align: right; white-space: nowrap; color: #155bd7; }
        .ai-items em { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #087443; font-style: normal; }
        .ai-items > div.unmatched em { color: #b54708; }
        .analysis-log {
          margin-top: 7px;
          font-size: 11px;
        }
        .analysis-log summary { cursor: pointer; font-weight: 800; color: #526278; }
        .analysis-log > div { display: flex; gap: 6px; padding: 3px; border-top: 1px solid #eee; }
        .analysis-log span { min-width: 0; overflow-wrap: anywhere; }
        .operation-logs { max-height: 220px; overflow: auto; } .operation-logs > div { display: grid; grid-template-columns: 55px minmax(0,1fr); gap: 6px; padding: 4px 0; border-top: 1px solid #dbeafe; } .operation-logs b { color: #1d4ed8; } .operation-logs span { overflow-wrap: anywhere; }
        .current-list span {
          display: flex;
          min-width: 0;
          flex-direction: column;
        }
        .current-list b {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .current-list strong {
          color: #155bd7;
          white-space: nowrap;
        }
        .logs > div {
          display: flex;
          flex-direction: column;
          padding: 5px;
          border-bottom: 1px solid #eee;
        }
        .logs span,
        small {
          color: #65758b;
        }
        .match-modal {
          position: fixed;
          inset: 0;
          z-index: 1000;
          display: grid;
          place-items: center;
          padding: 24px;
          background: #0f172a66;
        }
        .match-card {
          width: min(920px, 96vw);
          max-height: min(760px, 92vh);
          display: flex;
          flex-direction: column;
          overflow: hidden;
          border-radius: 9px;
          background: #fff;
          box-shadow: 0 18px 50px #0f172a55;
        }
        .match-card header {
          border-radius: 0;
          padding: 10px 14px;
        }
        .match-card header p {
          margin: 2px 0 0;
          font-size: 12px;
        }
        .match-card header button {
          padding: 5px 10px;
          background: #fff;
        }
        .match-card form {
          display: flex;
          gap: 6px;
          padding: 9px;
          border-bottom: 1px solid #d8e0ea;
        }
        .match-card form input {
          flex: 1;
          min-width: 0;
          height: 36px;
          padding: 0 10px;
          border: 2px solid #155bd7;
          border-radius: 5px;
        }
        .match-card form button {
          padding: 0 18px;
          background: #155bd7;
          color: #fff;
          font-weight: 800;
        }
        .match-results {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 5px;
          padding: 9px;
          overflow: auto;
        }
        .match-results > button {
          display: flex;
          min-width: 0;
          flex-direction: column;
          align-items: flex-start;
          padding: 8px;
          background: #fff;
          text-align: left;
        }
        .match-results > button:hover {
          border-color: #155bd7;
          background: #eef5ff;
        }
        .match-results span,
        .match-results b {
          max-width: 100%;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .match-results span {
          font-size: 11px;
          color: #526278;
        }
        .match-error {
          padding: 7px 10px;
          background: #fff0ee;
          color: #a11;
        }
        .match-more-title {
          margin: 0;
          padding: 7px 10px 0;
          font-size: 13px;
          color: #344054;
        }
        .match-results button em {
          color: #155bd7;
          font-size: 10px;
          font-style: normal;
          font-weight: 800;
        }
        .match-card footer {
          padding: 7px 10px;
          background: #f3f6fa;
          color: #526278;
          font-size: 12px;
        }
        @media (max-width: 1400px) {
          .workspace {
            grid-template-columns: 1fr;
          }
          aside {
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            max-height: none;
          }
        }
        @media (max-width: 1000px) {
          .scope {
            grid-template-columns: 1fr;
          }
          .workspace {
            grid-template-columns: 1fr;
          }
          .paste-analysis-grid {
            grid-template-columns: 1fr;
          }
          aside {
            display: flex;
            max-height: none;
          }
          .analysis {
            max-height: none;
          }
          .match-results {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
    </>
  );
}
