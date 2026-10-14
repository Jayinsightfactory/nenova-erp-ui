import { useState, useEffect, useCallback, useRef } from 'react';
import { apiGet, apiPost, apiDelete } from '../../lib/useApi';
import { useWeekInput, getCurrentWeek, WeekInput } from '../../lib/useWeekInput';
import { useLang } from '../../lib/i18n';
import { distributeProductName, distributePreviousStock, distributePreviousStockTotal } from '../../lib/distributeProductDisplay';
import DistributionPicker from '../../components/shipment/DistributionPicker';
import { distributionQuantityRemark, distributionWeekOptions, hasDistributionDrafts, parseDistributionFavorite,
  sortDistributionCustomers, sortDistributionProducts } from '../../lib/shipmentDistributionWorkspace.js';

const fmt = n => Number(n || 0).toLocaleString();
const PG_SEP = '::';
const pgLabel = (country, flower) => `${country || ''}${flower || ''}`;
const countryFlowerFromGroup = (prodGroup, prodGroups) => {
  if (!prodGroup) return '';
  const g = prodGroups.find((x) => x.key === prodGroup);
  if (g?.country && g?.flower) return pgLabel(g.country, g.flower);
  if (prodGroup.includes(PG_SEP)) {
    const [country, flower] = prodGroup.split(PG_SEP);
    return pgLabel(country, flower);
  }
  return prodGroup;
};
const shipDayGroupKey = (item) => {
  const country = String(item?.CounName || '').trim();
  const flower = String(item?.FlowerName || '').trim();
  if (country && flower) return `${country}${PG_SEP}${flower}`;
  return String(item?.CountryFlower || '').trim();
};

// 차수(예: "15-01") → 정상 출고일(YYYY-MM-DD) 변환
function weekToShipDate(weekStr, year = new Date().getFullYear()) {
  try {
    const [wStr, dStr] = weekStr.split('-');
    const weekNum = parseInt(wStr, 10);
    const delivNum = parseInt(dStr, 10) || 1;
    const jan4 = new Date(year, 0, 4);
    const dayOfWeek = jan4.getDay() || 7;
    const monday = new Date(jan4);
    monday.setDate(jan4.getDate() - dayOfWeek + 1 + (weekNum - 1) * 7);
    const offsets = [0, 0, 3, 5];
    monday.setDate(monday.getDate() + (offsets[delivNum] ?? 0));
    return `${monday.getFullYear()}-${String(monday.getMonth()+1).padStart(2,'0')}-${String(monday.getDate()).padStart(2,'0')}`;
  } catch { return null; }
}
const WEEK_SUFFIXES = ['-01', '-02'];
const DAY_NAMES = ['월','화','수','목','금'];
const DAY_NAMES_TAB2 = ['월','화','수','목','금','토','일'];
const EXE_DAY_NUM = { 월: 2, 화: 3, 수: 4, 목: 5, 금: 6, 토: 7, 일: 1 };
const PRODUCT_FAVORITE_PAGE = 'shipment-distribute-products';

function mapCustWeekGridRow(row) {
  const dayByKr = {};
  for (const d of DAY_NAMES_TAB2) {
    dayByKr[d] = Number(row[`day${EXE_DAY_NUM[d]}`]) || 0;
  }
  const totalOut = Number(row.OutQuantity) || 0;
  const daySum = Object.values(dayByKr).reduce((a, b) => a + b, 0);
  return {
    ProdKey: row.ProdKey,
    ProdName: row.ProdName,
    OutUnit: row.OutUnit,
    EstUnit: row.EstUnit,
    SdetailKey: row.SdetailKey,
    출고수량: totalOut || daySum,
    _exeWeekGrid: true,
    _dayByKr: dayByKr,
  };
}

// 출고수량을 요일별로 자동 균등 분배
function autoSplitQty(totalQty, dayCount) {
  if (dayCount <= 0 || totalQty <= 0) return [];
  const base = Math.floor(totalQty / dayCount);
  const remainder = totalQty - base * dayCount;
  return Array.from({ length: dayCount }, (_, i) => base + (i < remainder ? 1 : 0));
}

export default function Distribute() {
  const { t } = useLang();
  const [tab, setTab] = useState(0); // 0:품목기준 1:출고일지정 2:집계
  const weekInput = useWeekInput('');
  const week = weekInput.value;
  const selectedOrderYear = String(week || '').match(/^(\d{4})-/)?.[1] || '';
  const apiGetDistribute = useCallback(
    (params) => apiGet('/api/shipment/distribute', { ...params, year: selectedOrderYear }),
    [selectedOrderYear],
  );
  const [prodGroup, setProdGroup] = useState('');
  const [prodGroups, setProdGroups] = useState([]);
  const [prodGroupsLoading, setProdGroupsLoading] = useState(false);
  const [viewMode, setViewMode] = useState('prod'); // 'prod'=품목기준 'cust'=업체기준

  // 품목기준
  const [products, setProducts] = useState([]);
  const [selectedProd, setSelectedProd] = useState(null);
  const [custDist, setCustDist] = useState([]);
  const [distLoading, setDistLoading] = useState(false);
  const [inQty, setInQty] = useState(0);
  const [outQty, setOutQty] = useState(0);
  const [prodFilter, setProdFilter] = useState('');
  const [favoritesOnly, setFavoritesOnly] = useState(false);

  // 업체기준
  const [custList, setCustList] = useState([]);
  const [selectedCust, setSelectedCust] = useState(null);
  const [custItems, setCustItems] = useState([]);
  const [custLoading, setCustLoading] = useState(false);

  // 업체기준 인라인 편집: { [prodKey]: { outQty, cost } }
  const [custEditInputs, setCustEditInputs] = useState({});

  const [loading, setLoading] = useState(false);
  const [custFilter, setCustFilter] = useState('');
  const [distMode, setDistMode] = useState('ratio');
  const [err, setErr] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveModal, setSaveModal] = useState(null); // 저장 완료 모달
  const [outInputs, setOutInputs] = useState({});
  const [fixLoading, setFixLoading] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [historyData, setHistoryData] = useState([]);
  const [isFixed, setIsFixed] = useState(false);
  const [validateResult, setValidateResult] = useState(null);
  const [showValidate, setShowValidate] = useState(false);
  const [spLoading, setSpLoading] = useState(false);
  const [spModal, setSpModal] = useState(null);

  // 탭2: 출고요일 설정
  const [shipDayConfigs, setShipDayConfigs] = useState({}); // { 'prodGroup|suffix': '월,화,수' }
  const [shipDayLoading, setShipDayLoading] = useState(false);
  const [shipDaySaving, setShipDaySaving] = useState(false);
  // 탭2: 업체별 일별 수량 분배 { 'custKey|prodKey': { '월': 3, '화': 2, ... } }
  const [dailyQtyInputs, setDailyQtyInputs] = useState({});
  // 탭2: 품목별 출고일 오버라이드 { 'custKey|prodKey': '월,수' }
  const [prodDayOverrides, setProdDayOverrides] = useState({});
  const [tab2CustKey, setTab2CustKey] = useState(null);
  const [tab2Items, setTab2Items] = useState([]);
  const [tab2Loading, setTab2Loading] = useState(false);
  const [excelDownloading, setExcelDownloading] = useState(false);
  const [pivotRows, setPivotRows] = useState([]);
  const [pivotLoading, setPivotLoading] = useState(false);
  const [tab2UsesExeGrid, setTab2UsesExeGrid] = useState(false);
  const [selectedDistCust, setSelectedDistCust] = useState(null);
  const [farmRows, setFarmRows] = useState([]);
  const [farmLoading, setFarmLoading] = useState(false);
  const [favoriteProducts, setFavoriteProducts] = useState([]);
  const [favoritesPending, setFavoritesPending] = useState(false);
  const [favoriteError, setFavoriteError] = useState('');
  const [accountId, setAccountId] = useState('');
  const weekPickerRef = useRef(null);
  const productPickerRef = useRef(null);
  const customerPickerRef = useRef(null);
  const saveButtonRef = useRef(null);
  const saveModalConfirmRef = useRef(null);
  const productSearchRef = useRef(null);
  const customerSearchRef = useRef(null);
  const currentWeekRef = useRef(week);
  currentWeekRef.current = week;
  const currentGroupRef = useRef(prodGroup);
  currentGroupRef.current = prodGroup;
  const searchRequestRef = useRef(0);
  const productRequestRef = useRef(0);
  const customerRequestRef = useRef(0);
  const farmRequestRef = useRef(0);
  const tab2RequestRef = useRef(0);
  const pivotRequestRef = useRef(0);
  const favoritesRequestRef = useRef(0);
  const accountRef = useRef('');
  const saveInFlightRef = useRef(false);
  const anySaveModal = Boolean(saveModal || spModal || showValidate || showHistory);
  const saveBlocked = saving || loading || distLoading || custLoading || spLoading || fixLoading || shipDaySaving || anySaveModal;

  const loadFavoriteProducts = useCallback(async () => {
    const request = ++favoritesRequestRef.current;
    try {
      const auth = await apiGet('/api/auth/me');
      const uid = String(auth?.user?.userId || '');
      if (!uid) throw new Error('로그인 사용자를 확인하지 못했습니다.');
      if (request !== favoritesRequestRef.current) return;
      if (accountRef.current !== uid) {
        accountRef.current = uid;
        setAccountId(uid);
        setFavoriteProducts([]);
      }
      const data = await apiGet('/api/favorites', { page: PRODUCT_FAVORITE_PAGE });
      if (request !== favoritesRequestRef.current || accountRef.current !== uid) return;
      if (data?.success !== true) throw new Error(data?.error || '즐겨찾기를 읽지 못했습니다.');
      setFavoriteProducts((data.favorites || []).map(parseDistributionFavorite).filter(Boolean));
      setFavoriteError('');
    } catch (error) {
      if (request === favoritesRequestRef.current) {
        accountRef.current = '';
        setAccountId('');
        setFavoriteProducts([]);
        setFavoriteError(error.message || '즐겨찾기 조회에 실패했습니다.');
      }
    }
  }, []);

  useEffect(() => {
    loadFavoriteProducts();
    window.addEventListener('focus', loadFavoriteProducts);
    return () => {
      favoritesRequestRef.current += 1;
      window.removeEventListener('focus', loadFavoriteProducts);
    };
  }, [loadFavoriteProducts]);

  const toggleProductFavorite = async (prod, event) => {
    event?.stopPropagation();
    if (!accountId || favoritesPending) return;
    setFavoritesPending(true);
    setFavoriteError('');
    try {
      const auth = await apiGet('/api/auth/me');
      if (String(auth?.user?.userId || '') !== accountId) {
        await loadFavoriteProducts();
        throw new Error('로그인 계정이 바뀌어 즐겨찾기 목록을 다시 읽었습니다. 다시 선택해 주세요.');
      }
      const existing = favoriteProducts.find(row => row.prodKey === Number(prod.ProdKey));
      const result = existing
        ? await apiDelete('/api/favorites', { favoriteKey: existing.favoriteKey })
        : await apiPost('/api/favorites', {
          page: PRODUCT_FAVORITE_PAGE,
          name: String(prod.ProdName || prod.DisplayName || `품목 #${prod.ProdKey}`).slice(0, 100),
          filterData: JSON.stringify({ prodKey: Number(prod.ProdKey) }),
        });
      if (result?.success !== true) throw new Error(result?.error || '즐겨찾기를 저장하지 못했습니다.');
      await loadFavoriteProducts();
    } catch (error) { setFavoriteError(error.message || '즐겨찾기 변경에 실패했습니다.'); }
    finally { setFavoritesPending(false); }
  };

  useEffect(() => {
    const request = ++searchRequestRef.current;
    productRequestRef.current += 1;
    customerRequestRef.current += 1;
    farmRequestRef.current += 1;
    tab2RequestRef.current += 1;
    pivotRequestRef.current += 1;
    setProducts([]); setCustList([]);
    setSelectedProd(null); setCustDist([]); setOutInputs({});
    setSelectedCust(null); setCustItems([]); setCustEditInputs({});
    setSelectedDistCust(null); setFarmRows([]);
    setTab2CustKey(null); setTab2Items([]); setDailyQtyInputs({});
    setPivotRows([]);
    if (!week || !selectedOrderYear) return;
    const cf = countryFlowerFromGroup(prodGroup, prodGroups);
    setLoading(true);
    Promise.all([
      apiGetDistribute({ type: 'products', week, ...(prodGroup && { prodGroup }), ...(cf && { countryFlower: cf }) }),
      apiGetDistribute(cf ? { type: 'customers', week, countryFlower: cf } : { type: 'custList', week }),
    ]).then(([prodRes, custRes]) => {
      if (request !== searchRequestRef.current || week !== currentWeekRef.current || prodGroup !== currentGroupRef.current) return;
      if (prodRes?.success !== true || custRes?.success !== true) throw new Error('분배 조회 결과를 확인하지 못했습니다.');
      setProducts(sortDistributionProducts(prodRes.products || []));
      setCustList(sortDistributionCustomers(custRes.customers || []));
    }).catch(error => { if (request === searchRequestRef.current) setErr(error.message); })
      .finally(() => { if (request === searchRequestRef.current) setLoading(false); });
  }, [week, prodGroup]);

  const confirmDraftDiscard = () => !saving && (!hasDistributionDrafts(custDist, outInputs, custItems, custEditInputs) ||
    window.confirm('저장하지 않은 출고수량 또는 단가 변경이 있습니다. 선택을 바꾸면 입력값이 사라집니다. 계속하시겠습니까?'));
  const closeSaveModal = () => { setSaveModal(null); requestAnimationFrame(() => saveButtonRef.current?.focus()); };
  useEffect(() => {
    if (!saveModal) return undefined;
    saveModalConfirmRef.current?.focus();
    const onEscape = event => { if (event.key === 'Escape') { event.preventDefault(); closeSaveModal(); } };
    window.addEventListener('keydown', onEscape);
    return () => window.removeEventListener('keydown', onEscape);
  }, [saveModal]);
  const guardedWeekInput = {
    ...weekInput,
    props: { ...weekInput.props,
      onChange: event => { if (confirmDraftDiscard()) weekInput.props.onChange(event); },
    },
    setValue: value => { if (value !== week && confirmDraftDiscard()) weekInput.setValue(value); },
    prev: () => { if (confirmDraftDiscard()) weekInput.prev(); },
    next: () => { if (confirmDraftDiscard()) weekInput.next(); },
    prevWeek: () => { if (confirmDraftDiscard()) weekInput.prevWeek(); },
    nextWeek: () => { if (confirmDraftDiscard()) weekInput.nextWeek(); },
  };

  // ── 출고요일 설정 로드
  const loadShipDayConfigs = useCallback(async () => {
    setShipDayLoading(true);
    try {
      const d = await apiGet('/api/shipment/ship-days', {});
      const map = {};
      (d.configs || []).forEach(c => {
        map[`${c.ProdGroup}|${c.WeekSuffix}`] = c.ShipDays;
      });
      setShipDayConfigs(map);
    } catch (e) { setErr(e.message); } finally { setShipDayLoading(false); }
  }, []);

  useEffect(() => { loadShipDayConfigs(); }, [loadShipDayConfigs]);

  // 품목그룹 목록 — DB CounName+FlowerName (nenova.exe / 주문등록 동일)
  const loadProdGroups = useCallback(async (wk) => {
    setProdGroupsLoading(true);
    try {
      const d = await apiGetDistribute({ type: 'groups', ...(wk ? { week: wk } : {}) });
      return d.groups || [];
    } catch (e) {
      return [];
    } finally {
      setProdGroupsLoading(false);
    }
  }, [apiGetDistribute]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const groups = await loadProdGroups(week || '');
      if (cancelled) return;
      setProdGroups(groups);
      setProdGroup(prev => (prev && groups.some(g => g.key === prev) ? prev : ''));
    })();
    return () => { cancelled = true; };
  }, [week, loadProdGroups]);

  const selectedProdGroupLabel = prodGroups.find(g => g.key === prodGroup)?.label || prodGroup.replace(PG_SEP, '');

  // 출고요일 설정 저장
  const saveShipDayConfigs = async () => {
    setShipDaySaving(true); setErr('');
    try {
      const configs = Object.entries(shipDayConfigs).map(([key, days]) => {
        const lastPipe = key.lastIndexOf('|');
        const prodGroupKey = lastPipe > 0 ? key.slice(0, lastPipe) : key;
        const weekSuffix = lastPipe > 0 ? key.slice(lastPipe + 1) : '-01';
        return { prodGroup: prodGroupKey, weekSuffix, custKey: 0, shipDays: days };
      });
      const res = await fetch('/api/shipment/ship-days', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ configs }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      setSuccessMsg('✅ 출고요일 설정 저장 완료');
      setTimeout(() => setSuccessMsg(''), 3000);
    } catch (e) { setErr(e.message); } finally { setShipDaySaving(false); }
  };

  // 출고요일 토글
  const toggleShipDay = (prodGroup, suffix, day) => {
    const key = `${prodGroup}|${suffix}`;
    const current = (shipDayConfigs[key] || '').split(',').filter(Boolean);
    const idx = current.indexOf(day);
    if (idx >= 0) current.splice(idx, 1);
    else current.push(day);
    // 월~금 순서 정렬
    current.sort((a, b) => DAY_NAMES.indexOf(a) - DAY_NAMES.indexOf(b));
    setShipDayConfigs(prev => ({ ...prev, [key]: current.join(',') }));
  };

  // 품목의 출고요일 가져오기 (오버라이드 → 기본설정 → 빈배열)
  const getShipDays = (custKey, prodKey, prodGroup) => {
    const overKey = `${custKey}|${prodKey}`;
    if (prodDayOverrides[overKey]) return prodDayOverrides[overKey].split(',').filter(Boolean);
    // 차수 접미사 파악 (week = "14-01" → suffix = "-01")
    const suffix = week ? `-${week.split('-').pop()}` : '-01';
    const cfgKey = `${prodGroup}|${suffix}`;
    const days = (shipDayConfigs[cfgKey] || '').split(',').filter(Boolean);
    return days;
  };

  // 탭2 업체 선택 → 품목+출고수량 로드 → 자동 일별 분배
  const loadTab2Items = async (ck) => {
    if (!week || !ck) return;
    const request = ++tab2RequestRef.current;
    const requestedWeek = week;
    setTab2CustKey(ck);
    setTab2Loading(true);
    const cf = countryFlowerFromGroup(prodGroup, prodGroups);
    try {
      let items = [];
      let usesExe = false;
      if (cf) {
        const d = await apiGetDistribute({
          type: 'custWeekGrid',
          week,
          custKey: ck,
          countryFlower: cf,
        });
        items = (d.rows || []).map(mapCustWeekGridRow);
        usesExe = items.length > 0;
      }
      if (!usesExe) {
        const d = await apiGetDistribute({ type: 'custItems', week, custKey: ck });
        items = d.items || [];
      }
      if (request !== tab2RequestRef.current || requestedWeek !== currentWeekRef.current) return;
      items = sortDistributionProducts(items);
      setTab2UsesExeGrid(usesExe);
      setTab2Items(items);
      const newInputs = {};
      items.forEach(item => {
        if (item._exeWeekGrid && item._dayByKr) {
          newInputs[`${ck}|${item.ProdKey}`] = { ...item._dayByKr };
          return;
        }
        const days = getShipDays(ck, item.ProdKey, shipDayGroupKey(item));
        const totalQty = item.출고수량 || item.주문수량 || 0;
        if (days.length > 0 && totalQty > 0) {
          const splits = autoSplitQty(totalQty, days.length);
          const dayMap = {};
          days.forEach((day, i) => { dayMap[day] = splits[i] || 0; });
          newInputs[`${ck}|${item.ProdKey}`] = dayMap;
        }
      });
      setDailyQtyInputs(prev => ({ ...prev, ...newInputs }));
    } catch (e) { if (request === tab2RequestRef.current) setErr(e.message); }
    finally { if (request === tab2RequestRef.current) setTab2Loading(false); }
  };

  // 일별 수량 변경 → 자동 조정
  const handleDailyQtyChange = (custKey, prodKey, day, value, totalQty, days) => {
    const key = `${custKey}|${prodKey}`;
    const current = { ...(dailyQtyInputs[key] || {}) };
    const newVal = parseFloat(value) || 0;
    current[day] = newVal;

    // 나머지 요일에 남은 수량 자동 분배
    const otherDays = days.filter(d => d !== day);
    const usedByThis = newVal;
    const remaining = Math.max(0, totalQty - usedByThis);

    if (otherDays.length > 0) {
      const splits = autoSplitQty(remaining, otherDays.length);
      otherDays.forEach((d, i) => { current[d] = splits[i] || 0; });
    }

    setDailyQtyInputs(prev => ({ ...prev, [key]: current }));
  };

  // 엑셀 다운로드
  const handleExcelDownload = async (singleCustKey) => {
    if (!week) { setErr('차수를 입력하세요.'); return; }
    setExcelDownloading(true); setErr('');
    try {
      const params = new URLSearchParams({ week });
      if (singleCustKey) params.set('custKey', singleCustKey);
      // 출고요일 설정과 일별 수량을 쿼리에 포함
      params.set('shipDayConfigs', JSON.stringify(shipDayConfigs));
      params.set('dailyQtyInputs', JSON.stringify(dailyQtyInputs));
      params.set('prodDayOverrides', JSON.stringify(prodDayOverrides));

      const res = await fetch(`/api/shipment/excel-download?${params.toString()}`);
      if (!res.ok) { const e = await res.json(); throw new Error(e.error || '다운로드 실패'); }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = res.headers.get('Content-Disposition')?.split('filename=')[1]?.replace(/"/g,'') || `출고_${week}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
      setSuccessMsg('✅ 엑셀 다운로드 완료');
      setTimeout(() => setSuccessMsg(''), 3000);
    } catch (e) { setErr(e.message); } finally { setExcelDownloading(false); }
  };

  const handleFix = async () => {
    if (!week) { setErr('차수를 입력하세요.'); return; }
    // 사전검증
    setFixLoading(true); setErr('');
    try {
      const orderYear = selectedOrderYear;
      const vRes = await fetch(`/api/shipment/fix?week=${encodeURIComponent(week)}&orderYear=${encodeURIComponent(orderYear)}`);
      const vData = await vRes.json();
      if (vData.issueCount > 0) {
        setValidateResult(vData);
        setShowValidate(true);
        setFixLoading(false);
        return;
      }
    } catch(e) { /* 검증 실패해도 확정 진행 허용 */ }
    await doFix();
  };

  const doFix = async () => {
    if (!confirm(`[${week}] 차수를 확정하시겠습니까?\n\n확정 시 재고가 업데이트되고 견적서에 반영됩니다.`)) { setFixLoading(false); return; }
    setFixLoading(true); setErr('');
    try {
      const res = await fetch('/api/shipment/fix', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ week, orderYear: selectedOrderYear, action: 'fix' }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      setIsFixed(true);
      setShowValidate(false);
      setSuccessMsg('✅ ' + data.message);
      setTimeout(() => setSuccessMsg(''), 5000);
      handleSearch();
    } catch(e) { setErr(e.message); } finally { setFixLoading(false); }
  };

  const handleUnfix = async () => {
    if (!week) { setErr('차수를 입력하세요.'); return; }
    if (!confirm(`[${week}] 확정을 취소 / Cancelar하시겠습니까?`)) return;
    setFixLoading(true); setErr('');
    try {
      const res = await fetch('/api/shipment/fix', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ week, orderYear: selectedOrderYear, action: 'unfix' }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      setIsFixed(false);
      setSuccessMsg('✅ ' + data.message);
      setTimeout(() => setSuccessMsg(''), 3000);
      handleSearch();
    } catch(e) { setErr(e.message); } finally { setFixLoading(false); }
  };

  const handleSpDistribute = async (action) => {
    if (!week) { setErr('차수를 입력하세요.'); return; }
    if (action === 'one' && !selectedProd) { setErr('개별 전산 출고분배는 품목을 먼저 선택하세요.'); return; }
    if (action === 'group' && !prodGroup) { setErr('꽃/품목그룹을 선택하세요. 전체 차수 실행은 사용하지 않습니다.'); return; }

    const label = action === 'one'
      ? `${week}차 ${selectedProd.DisplayName || selectedProd.ProdName} 개별 출고분배`
      : action === 'group'
        ? `${week}차 ${selectedProdGroupLabel} 일괄출고분배`
        : `${week}차 전체 일괄출고분배`;
    if (!confirm(`${label}를 전산 nenova.exe와 같은 저장 프로시저 경로로 실행하시겠습니까?\n\n실행 전 KeyNumbering/확정상태를 확인하고, 실행 후 출고일/중복 출고상세 검증에 실패하면 롤백합니다.`)) return;

    setSpLoading(true);
    setErr('');
    setSuccessMsg('');
    setSpModal({
      running: true,
      title: label,
      logs: [
        `${label} 시작`,
        '전산 저장 프로시저 확인 중',
        'KeyNumbering, 확정상태, 출고일 정합성을 함께 검사합니다.',
      ],
    });
    try {
      const res = await fetch('/api/shipment/distribute-sp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          week,
          year: selectedOrderYear,
          prodKey: action === 'one' ? selectedProd.ProdKey : undefined,
          prodGroup: action === 'group' ? prodGroup : undefined,
          distributionType: distMode === 'prior' ? 2 : 1, // 2=우선 분배, 1=비율 분배 (nenova.exe @DistributionType)
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.success === false) throw new Error(data.error || '전산 출고분배 실행 실패');
      setSpModal({
        running: false,
        title: label,
        logs: data.logs || [],
        before: data.before,
        after: data.after,
        procedureName: data.procedureName,
      });
      setSuccessMsg(`✅ ${label} 완료`);
      setTimeout(() => setSuccessMsg(''), 5000);
      await handleSearch();
      if (action === 'one' && selectedProd) await selectProd(selectedProd);
    } catch (e) {
      setErr(e.message);
      setSpModal(prev => ({
        ...(prev || { title: label }),
        running: false,
        failed: true,
        logs: [...((prev || {}).logs || []), `오류: ${e.message}`],
      }));
    } finally {
      setSpLoading(false);
    }
  };

  // 개별 초기화 — nenova.exe "개별 초기화"(usp_DistributeClear) 와 동일. 선택 품목의 출고분배를 되돌린다.
  const handleClearOne = async () => {
    if (!week) { setErr('차수를 입력하세요.'); return; }
    if (!selectedProd?.ProdKey) { setErr('초기화할 품목을 먼저 선택하세요.'); return; }
    const label = `${week}차 ${selectedProd.DisplayName || selectedProd.ProdName} 개별 초기화`;
    if (!confirm(`${label}\n\n선택 품목의 출고분배를 전산 nenova.exe와 동일한 경로(usp_DistributeClear)로 되돌립니다.\n확정된 분배는 먼저 확정취소해야 합니다. 계속하시겠습니까?`)) return;
    setSpLoading(true); setErr(''); setSuccessMsg('');
    try {
      const res = await fetch('/api/shipment/distribute-clear', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ week, year: selectedOrderYear, prodKey: selectedProd.ProdKey }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.success === false) throw new Error(data.error || '개별 초기화 실패');
      setSuccessMsg(`✅ ${label} 완료`);
      setTimeout(() => setSuccessMsg(''), 4000);
      await handleSearch();
      if (selectedProd) await selectProd(selectedProd);
    } catch (e) {
      setErr(e.message);
    } finally {
      setSpLoading(false);
    }
  };

  const handleHistory = async () => {
    if (!week) { setErr('차수를 입력하세요.'); return; }
    try {
      const d = await apiGet('/api/shipment/history', {
        startDate: '2020-01-01',
        endDate: new Date().toISOString().slice(0,10),
        search: week,
      });
      setHistoryData(d.history || []);
      setShowHistory(true);
    } catch(e) { setErr(e.message); }
  };

  const handleSearch = async () => {
    if (!week) { setErr('차수를 입력하세요.'); return; }
    if (!confirmDraftDiscard()) return;
    const request = ++searchRequestRef.current;
    const requestedWeek = week;
    const requestedGroup = prodGroup;
    productRequestRef.current += 1;
    customerRequestRef.current += 1;
    setLoading(true); setErr('');
    const cf = countryFlowerFromGroup(prodGroup, prodGroups);

    try {
      const [prodRes, custRes] = await Promise.all([
        apiGetDistribute({
          type: 'products',
          week,
          ...(prodGroup && { prodGroup }),
          ...(cf && { countryFlower: cf }),
        }),
        apiGetDistribute(cf
          ? { type: 'customers', week, countryFlower: cf }
          : { type: 'custList', week }),
      ]);
      if (request !== searchRequestRef.current || requestedWeek !== currentWeekRef.current || requestedGroup !== currentGroupRef.current) return;
      if (prodRes?.success !== true || custRes?.success !== true) throw new Error('분배 조회 결과를 확인하지 못했습니다.');
      const nextProducts = sortDistributionProducts(prodRes.products || []);
      setProducts(nextProducts);
      const customers = sortDistributionCustomers(custRes.customers || []);
      setCustList(customers);
      const matchingProd = nextProducts.find(p => Number(p.ProdKey) === Number(selectedProd?.ProdKey));
      const matchingCust = customers.find(c => Number(c.CustKey) === Number(selectedCust?.CustKey));
      if (matchingProd && viewMode === 'prod') selectProd(matchingProd, { skipDraftCheck: true });
      else if (matchingCust && viewMode === 'cust') selectCust(matchingCust, { skipDraftCheck: true });
      else if (viewMode === 'prod') { setSelectedProd(null); setCustDist([]); setOutInputs({}); }
      else { setSelectedCust(null); setCustItems([]); setCustEditInputs({}); }
      if (custFilter && !customers.some(c => c.CustName.includes(custFilter.trim())))
        setErr(`거래처 "${custFilter}" 를 이 차수에서 찾을 수 없습니다.`);
    } catch(e) { if (request === searchRequestRef.current) setErr(e.message); }
    finally { if (request === searchRequestRef.current) setLoading(false); }
  };

  const loadPivotRows = useCallback(async () => {
    const cf = countryFlowerFromGroup(prodGroup, prodGroups);
    if (!week || !cf) { setPivotRows([]); return; }
    const request = ++pivotRequestRef.current;
    const requestedWeek = week;
    setPivotLoading(true);
    try {
      const d = await apiGetDistribute({ type: 'pivot', week, countryFlower: cf });
      if (request === pivotRequestRef.current && requestedWeek === currentWeekRef.current)
        setPivotRows(sortDistributionProducts(d.rows || []));
    } catch {
      if (request === pivotRequestRef.current) setPivotRows([]);
    } finally {
      if (request === pivotRequestRef.current) setPivotLoading(false);
    }
  }, [week, prodGroup, prodGroups]);

  useEffect(() => {
    if (tab === 2) loadPivotRows();
  }, [tab, loadPivotRows]);

  // 품목 클릭 → 거래처 분배 정보 로드
  const selectProd = async (prod, { skipDraftCheck = false } = {}) => {
    if ((saving || loading) && !skipDraftCheck) return;
    if (!week || !products.some(p => Number(p.ProdKey) === Number(prod?.ProdKey))) return;
    if (!skipDraftCheck && !confirmDraftDiscard()) return;
    const request = ++productRequestRef.current;
    const requestedWeek = week;
    setSelectedProd(prod);
    setSelectedDistCust(null);
    setFarmRows([]);
    setOutInputs({}); setCustDist([]);
    setInQty(prod.inQty || 0);
    setOutQty(prod.outQty || 0);
    setDistLoading(true);
    try {
      const d = await apiGetDistribute({ type:'custDist', week, prodKey: prod.ProdKey });
      if (request !== productRequestRef.current || requestedWeek !== currentWeekRef.current) return;
      if (d?.success !== true) throw new Error('거래처 분배 조회 결과를 확인하지 못했습니다.');
      setCustDist(sortDistributionCustomers(d.customers || []));
      // 기존 출고수량으로 초기화
      const inputs = {};
      (d.customers||[]).forEach(c => { inputs[c.CustKey] = c.출고수량 || 0; });
      setOutInputs(inputs);
      setInQty(prod.inQty || 0);
      setOutQty(d.totalOut || 0);
    } catch(e) { if (request === productRequestRef.current) setErr(e.message); }
    finally { if (request === productRequestRef.current) setDistLoading(false); }
  };

  const selectDistCustRow = async (c) => {
    const request = ++farmRequestRef.current;
    const requestedWeek = week;
    setSelectedDistCust(c);
    if (!c?.SdetailKey || !selectedProd?.ProdKey) {
      setFarmRows([]);
      return;
    }
    setFarmLoading(true);
    try {
      const d = await apiGetDistribute({
        type: 'shipmentFarms',
        prodKey: selectedProd.ProdKey,
        sdetailKey: c.SdetailKey,
      });
      if (request === farmRequestRef.current && requestedWeek === currentWeekRef.current) setFarmRows(d.farms || []);
    } catch (e) {
      if (request === farmRequestRef.current) { setFarmRows([]); setErr(e.message); }
    } finally {
      if (request === farmRequestRef.current) setFarmLoading(false);
    }
  };

  // 업체 선택 → 해당 업체 주문 품목 로드
  const selectCust = async (cust, { skipDraftCheck = false } = {}) => {
    if ((saving || loading) && !skipDraftCheck) return;
    if (!week || !custList.some(c => Number(c.CustKey) === Number(cust?.CustKey))) return;
    if (!skipDraftCheck && !confirmDraftDiscard()) return;
    const request = ++customerRequestRef.current;
    const requestedWeek = week;
    setSelectedCust(cust);
    setCustItems([]); setCustEditInputs({});
    setCustLoading(true);
    try {
      const d = await apiGetDistribute({ type:'custItems', week, custKey: cust.CustKey });
      if (request !== customerRequestRef.current || requestedWeek !== currentWeekRef.current) return;
      if (d?.success !== true) throw new Error('업체 품목 조회 결과를 확인하지 못했습니다.');
      const items = sortDistributionProducts(d.items || []);
      setCustItems(items);
      // 편집 입력값 초기화: 기존 출고수량 + 기존 단가
      const inputs = {};
      items.forEach(item => {
        inputs[item.ProdKey] = { outQty: item.출고수량 || 0, cost: item.Cost || 0 };
      });
      setCustEditInputs(inputs);
    } catch(e) { if (request === customerRequestRef.current) setErr(e.message); }
    finally { if (request === customerRequestRef.current) setCustLoading(false); }
  };

  // 업체기준 저장
  const handleSaveCustItems = async () => {
    if (saveBlocked || saveInFlightRef.current) return;
    if (!selectedCust || !week) { setErr('업체와 차수를 선택하세요.'); return; }
    saveInFlightRef.current = true;
    const submittedWeek = week;
    const submittedCust = selectedCust;
    setSaving(true); setErr('');
    try {
      const entries = custItems.map(item => {
        const edit = custEditInputs[item.ProdKey] || {};
        const qty = edit.outQty !== undefined ? parseFloat(edit.outQty) || 0 : (item.출고수량 || 0);
        const cost = edit.cost !== undefined ? parseFloat(edit.cost) || 0 : (item.Cost || 0);
        return { custKey: selectedCust.CustKey, prodKey: item.ProdKey, outQty: qty, cost };
      });
      const res = await fetch('/api/shipment/distribute', {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ week, year: selectedOrderYear, entries })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.success !== true || data.verified !== true) throw new Error(data.error || '출고분배 저장 검증에 실패했습니다.');
      if (submittedWeek !== currentWeekRef.current) return;
      const savedItems = custItems.filter(item => {
        const edit = custEditInputs[item.ProdKey] || {};
        return (edit.outQty !== undefined ? parseFloat(edit.outQty)||0 : (item.출고수량||0)) > 0;
      });
      setSaveModal({
        prodName: selectedCust.CustName,
        week,
        savedCount: savedItems.length,
        totalQty: savedItems.reduce((a, item) => {
          const edit = custEditInputs[item.ProdKey] || {};
          return a + (edit.outQty !== undefined ? parseFloat(edit.outQty)||0 : (item.출고수량||0));
        }, 0),
      });
      if (Number(submittedCust.CustKey) === Number(selectedCust?.CustKey)) selectCust(submittedCust, { skipDraftCheck: true }); // 새로고침
    } catch(e) { setErr(e.message); } finally { saveInFlightRef.current = false; setSaving(false); }
  };

  // 비율 분배 자동 계산
  const autoDistribute = () => {
    if (saving || loading) return;
    if (!selectedProd || custDist.length === 0) {
      setErr('품목을 선택하고 조회된 거래처 분배 정보가 있어야 자동 계산할 수 있습니다.');
      return;
    }

    const available = selectedProd.inQty || 0; // 입고 가능 수량
    const newInputs = {};

    if (distMode === 'ratio') {
      // ── 비율 분배: 입고수량을 주문비율대로 나눔
      const totalOrder = custDist.reduce((a,b) => a+(b.주문수량||0), 0);
      if (totalOrder === 0) { alert('주문 수량이 없습니다.'); return; }

      let allocated = 0;
      const sorted = [...custDist].sort((a,b) => (b.주문수량||0)-(a.주문수량||0));

      sorted.forEach((c, idx) => {
        if (idx === sorted.length - 1) {
          // 마지막 거래처: 나머지 전부 (반올림 오차 보정)
          newInputs[c.CustKey] = Math.max(0, available - allocated);
        } else {
          const ratio = (c.주문수량||0) / totalOrder;
          const qty = Math.floor(ratio * available); // 소수점 버림
          newInputs[c.CustKey] = qty;
          allocated += qty;
        }
      });

    } else {
      // ── 우선 분배: 주문수량 순서대로 입고수량 소진
      let remain = available;
      const sorted = [...custDist].sort((a,b) => (b.주문수량||0)-(a.주문수량||0));

      sorted.forEach(c => {
        const want = c.주문수량||0;
        const give = Math.min(want, remain);
        newInputs[c.CustKey] = give;
        remain = Math.max(0, remain - give);
      });
    }

    setOutInputs(newInputs);
    setOutQty(Object.values(newInputs).reduce((a,b)=>a+b,0));
    setErr('');
    setSuccessMsg('분배 수량을 자동 계산했습니다. 실제 DB 저장은 상단 저장 버튼을 눌러야 적용됩니다.');
    setTimeout(() => setSuccessMsg(''), 3000);
  };

  const fillOrderQuantities = () => {
    if (saving || loading) return;
    if (!selectedProd || custDist.length === 0) {
      setErr('품목을 선택하고 조회된 거래처 분배 정보가 있어야 주문수량을 채울 수 있습니다.');
      return;
    }
    const nextInputs = {};
    custDist.forEach(c => { nextInputs[c.CustKey] = c.주문수량 || 0; });
    setOutInputs(nextInputs);
    setOutQty(Object.values(nextInputs).reduce((a,b)=>a+(b||0),0));
    setErr('');
    setSuccessMsg('주문수량 기준으로 출고수량 입력값을 채웠습니다. 실제 DB 저장은 상단 저장 버튼을 눌러야 적용됩니다.');
    setTimeout(() => setSuccessMsg(''), 3000);
  };

  // 저장
  const handleSave = async () => {
    if (saveBlocked || saveInFlightRef.current) return;
    if (!selectedProd || !week) { setErr('품목과 차수를 선택하세요.'); return; }
    saveInFlightRef.current = true;
    const submittedWeek = week;
    const submittedProd = selectedProd;
    setSaving(true); setErr('');
    try {
      const entries = custDist.map(c => ({
        custKey: c.CustKey,
        prodKey: selectedProd.ProdKey,
        outQty: Number(outInputs[c.CustKey]) || 0,
        cost: Number(c.Cost ?? c.단가 ?? selectedProd.Cost ?? 0),
      }));
      const res = await fetch('/api/shipment/distribute', {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ week, year: selectedOrderYear, entries })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.success !== true || data.verified !== true) throw new Error(data.error || '출고분배 저장 검증에 실패했습니다.');
      if (submittedWeek !== currentWeekRef.current) return;
      const savedCount = custDist.filter(c => (outInputs[c.CustKey]||0) > 0).length;
      const totalSaved = Object.values(outInputs).reduce((a,b)=>a+(b||0),0);
      setSaveModal({
        prodName: selectedProd.ProdName,
        week,
        savedCount,
        totalQty: totalSaved,
      });
      if (Number(submittedProd.ProdKey) === Number(selectedProd?.ProdKey)) selectProd(submittedProd, { skipDraftCheck: true }); // 새로고침
    } catch(e) { setErr(e.message); } finally { saveInFlightRef.current = false; setSaving(false); }
  };

  const favoriteKeys = new Set(favoriteProducts.map(row => row.prodKey));
  const filteredProds = sortDistributionProducts(products, prodFilter)
    .filter(p => !favoritesOnly || favoriteKeys.has(Number(p.ProdKey)));
  const filteredCustomers = sortDistributionCustomers(custList, custFilter);
  const totalOutInput = Object.values(outInputs).reduce((a,b)=>a+b,0);
  const remain = (inQty||0) - totalOutInput;
  const selectedFlower = prodGroups.find(group => group.key === prodGroup)?.flower || '';
  const previousStock = distributePreviousStock(selectedProd);

  const tabs = ['출고 분배 및 농장 정보','출고일 지정','출고 분배 집계'];

  const handleQuantityEnter = event => {
    if (event.key !== 'Enter' || event.ctrlKey || event.altKey || event.metaKey || event.shiftKey ||
      event.repeat || event.isComposing || event.nativeEvent?.isComposing || event.keyCode === 229) return;
    event.preventDefault();
    if (saveBlocked || saveInFlightRef.current) return;
    const quantities = Array.from(document.querySelectorAll('[data-distribute-qty="true"]'))
      .filter(input => !input.disabled && !input.readOnly && input.getClientRects().length > 0 &&
        window.getComputedStyle(input).visibility !== 'hidden');
    const next = quantities[quantities.indexOf(event.currentTarget) + 1];
    if (next) { next.focus(); next.select?.(); }
    else saveButtonRef.current?.focus();
  };

  useEffect(() => {
    const onShortcut = event => {
      if (event.ctrlKey && !event.altKey && !event.metaKey && String(event.key).toLowerCase() === 's') {
        event.preventDefault();
        if (!saveBlocked && !saveInFlightRef.current && !event.repeat && !event.isComposing && event.keyCode !== 229)
          saveButtonRef.current?.click();
        return;
      }
      if (anySaveModal || saving) return;
      if (event.ctrlKey && event.altKey && ['1', '2', '3', '4'].includes(event.key)) {
        event.preventDefault();
        if (event.key === '1') weekPickerRef.current?.click();
        if (event.key === '2') productPickerRef.current?.click();
        if (event.key === '3') customerPickerRef.current?.click();
        if (event.key === '4') document.querySelector('[data-distribute-qty="true"]')?.focus();
      } else if (event.ctrlKey && event.key === 'Enter') {
        event.preventDefault();
        handleSearch();
      }
    };
    window.addEventListener('keydown', onShortcut);
    return () => window.removeEventListener('keydown', onShortcut);
  });

  return (
    <div data-testid="distribution-workspace" style={{display:'flex',flexDirection:'column',minHeight:'calc(100vh - 104px)',minWidth:0}}>
      <style>{`@media (max-width: 900px) { .distribution-workspace-grid { grid-template-columns: minmax(0, 1fr) !important; } }`}</style>
      {/* 툴바 */}
      <div style={{background:'var(--surface)',border:'1px solid var(--border)',borderRadius:'8px 8px 0 0',padding:'10px 14px',display:'flex',alignItems:'center',gap:10,flexWrap:'wrap',flexShrink:0}}>
        <WeekInput weekInput={guardedWeekInput} label="차수" />
        <DistributionPicker label="차수" value={week} triggerRef={weekPickerRef} shortcut="Ctrl+Alt+1" disabled={saving}
          options={distributionWeekOptions(week).map(value => ({ key: value, label: value, selected: value === week }))}
          onSelect={option => guardedWeekInput.setValue(option.key)} testId="distribution-week-picker" />
        <DistributionPicker label="품목그룹" value={selectedProdGroupLabel || '전체'} disabled={saving || prodGroupsLoading}
          options={[{ key: '', label: '전체', selected: !prodGroup }, ...prodGroups.map(g => ({ key: g.key, label: g.label, selected: g.key === prodGroup }))]}
          onSelect={option => { if (option.key !== prodGroup && confirmDraftDiscard()) setProdGroup(option.key); }} />
        <DistributionPicker label="품목" value={selectedProd?.ProdName || ''} triggerRef={productPickerRef}
          shortcut="Ctrl+Alt+2" disabled={saving || !products.length || loading}
          options={sortDistributionProducts(products).filter(p => !favoritesOnly || favoriteKeys.has(Number(p.ProdKey))).map(p => ({ key: p.ProdKey,
            label: p.ProdName || p.DisplayName || `#${p.ProdKey}`,
            hint: `${favoriteKeys.has(Number(p.ProdKey)) ? '★ ' : ''}#${p.ProdKey}`,
            selected: Number(p.ProdKey) === Number(selectedProd?.ProdKey), product: p }))}
          onSelect={option => { setViewMode('prod'); selectProd(option.product); }} testId="distribution-product-picker" />
        <DistributionPicker label="업체" value={selectedCust?.CustName || ''} triggerRef={customerPickerRef}
          shortcut="Ctrl+Alt+3" disabled={saving || !custList.length || loading}
          options={sortDistributionCustomers(custList).map(c => ({ key: c.CustKey, label: c.CustName,
            hint: `#${c.CustKey}`, selected: Number(c.CustKey) === Number(selectedCust?.CustKey), customer: c }))}
          onSelect={option => { setViewMode('cust'); selectCust(option.customer); }} testId="distribution-customer-picker" />
        <span className="filter-label">거래처</span>
        <input ref={customerSearchRef} className="filter-input" placeholder="업체 목록 검색" value={custFilter||''} disabled={saving}
          onChange={e=>setCustFilter(e.target.value)}
          onKeyDown={e=>e.key==='Enter' && handleSearch()}
          style={{minWidth:150, borderColor: custFilter ? 'var(--blue)' : undefined, fontWeight: custFilter ? 600 : undefined}} />
        {custFilter && (
          <button className="btn btn-sm" disabled={saving || loading} style={{padding:'2px 7px',fontSize:11}} onClick={()=>{if (!confirmDraftDiscard()) return;setCustFilter('');setSelectedCust(null);setCustItems([]);setCustEditInputs({});setViewMode('prod');}}>✕</button>
        )}
        <div style={{marginLeft:'auto',display:'flex',gap:6,flexWrap:'wrap'}}>
          <button className="btn btn-secondary btn-sm" onClick={handleSearch} disabled={saving}>🔍 조회</button>
          <button className="btn btn-success btn-sm" onClick={handleFix} disabled={fixLoading||isFixed}>
            {fixLoading?'처리중... / Procesando': isFixed?'✅ 확정됨 / Confirmado':'✅ 확정 / Confirmar'}
          </button>
          <button className="btn btn-secondary btn-sm" onClick={handleUnfix} disabled={fixLoading||!isFixed}>
            ↩️ 확정취소 / Cancelar / Anular
          </button>
          <button className="btn btn-success btn-sm" onClick={() => handleSpDistribute('group')} disabled={spLoading || fixLoading || isFixed || !week || !prodGroup} title="선택한 차수와 꽃/품목그룹만 dbo.usp_DistributeOne 경로로 일괄 분배합니다.">
            {spLoading ? '전산분배 중...' : '전산 선택꽃 일괄출고분배'}
          </button>
          <button ref={saveButtonRef} className="btn btn-primary btn-sm" aria-keyshortcuts="Control+S" onClick={viewMode==='cust' ? handleSaveCustItems : handleSave} disabled={saveBlocked}>{saving?'저장중... / Guardando':'💾 저장 / Guardar'}</button>
          <button className="btn btn-secondary btn-sm" onClick={handleHistory}>📋 내역 조회 / Historial</button>
          <button className="btn btn-success btn-sm" onClick={() => handleExcelDownload()} disabled={excelDownloading}>
            {excelDownloading ? '다운로드중...' : '📥 엑셀 다운 / Excel'}
          </button>
          <button className="btn btn-sm" onClick={() => window.opener ? window.close() : history.back()}>✖️ 닫기 / Cerrar</button>
        </div>
      </div>
      <div style={{padding:'5px 14px',fontSize:11,color:'var(--text3)',background:'var(--surface)'}}>
        단축키: Ctrl+Alt+1 차수 · Ctrl+Alt+2 품목 · Ctrl+Alt+3 업체 · Ctrl+Alt+4 수량 · Ctrl+Enter 조회 · 수량 Enter 다음 입력(마지막은 저장 버튼 이동) · Ctrl+S 저장. Enter 이동만으로 저장되지 않습니다.
      </div>
      {favoriteError && <div role="alert" style={{padding:'6px 14px',background:'var(--red-bg)',color:'var(--red)'}}>즐겨찾기: {favoriteError}</div>}

      {/* 알림 */}
      {err && <div style={{padding:'6px 14px',background:'var(--red-bg)',color:'var(--red)',fontSize:12,borderLeft:'3px solid var(--red)',flexShrink:0}}>⚠️ {err}</div>}
      {successMsg && <div style={{padding:'6px 14px',background:'var(--green-bg)',color:'var(--green)',fontSize:12,flexShrink:0}}>{successMsg}</div>}

      {/* 저장 완료 모달 */}
      {saveModal && (
        <div className="modal-overlay" onClick={closeSaveModal}>
          <div className="modal" role="dialog" aria-modal="true" aria-label="출고 분배 저장 완료" style={{maxWidth:380, textAlign:'center'}}
            onClick={e=>e.stopPropagation()} onKeyDown={event => {
              if (event.key === 'Tab') { event.preventDefault(); saveModalConfirmRef.current?.focus(); }
            }}>
            <div className="modal-header" style={{background:'#E8F8E8', borderBottom:'2px solid #66BB66'}}>
              <span className="modal-title" style={{color:'#006600'}}>✅ 출고 분배 저장 완료</span>
            </div>
            <div className="modal-body" style={{padding:'20px 24px'}}>
              <div style={{fontSize:15, fontWeight:'bold', marginBottom:16, color:'#006600'}}>
                출고 분배가 저장되었습니다.
              </div>
              <table style={{width:'100%', borderCollapse:'collapse', fontSize:12, marginBottom:16}}>
                <tbody>
                  <tr style={{borderBottom:'1px solid var(--border)'}}>
                    <td style={{padding:'6px 4px', color:'var(--text3)', width:100}}>품목</td>
                    <td style={{padding:'6px 4px', fontWeight:'bold'}}>{saveModal.prodName}</td>
                  </tr>
                  <tr style={{borderBottom:'1px solid var(--border)'}}>
                    <td style={{padding:'6px 4px', color:'var(--text3)'}}>차수</td>
                    <td style={{padding:'6px 4px', fontWeight:'bold', color:'var(--blue)'}}>{saveModal.week}</td>
                  </tr>
                  <tr style={{borderBottom:'1px solid var(--border)'}}>
                    <td style={{padding:'6px 4px', color:'var(--text3)'}}>거래처 수</td>
                    <td style={{padding:'6px 4px', fontWeight:'bold'}}>{saveModal.savedCount}개</td>
                  </tr>
                  <tr>
                    <td style={{padding:'6px 4px', color:'var(--text3)'}}>총 출고수량</td>
                    <td style={{padding:'6px 4px', fontWeight:'bold', color:'var(--amber)'}}>{saveModal.totalQty.toLocaleString()}</td>
                  </tr>
                </tbody>
              </table>
              <button ref={saveModalConfirmRef} className="btn btn-primary" style={{width:'100%', height:36, fontSize:13}}
                onClick={closeSaveModal}>확인</button>
            </div>
          </div>
        </div>
      )}

      {spModal && (
        <div className="modal-overlay" onClick={() => !spModal.running && setSpModal(null)}>
          <div className="modal" style={{maxWidth:620}} onClick={e=>e.stopPropagation()}>
            <div className="modal-header" style={{background:spModal.failed?'#FDECEC':'#E8F8E8', borderBottom:`2px solid ${spModal.failed?'#CC3333':'#66BB66'}`}}>
              <span className="modal-title" style={{color:spModal.failed?'#AA0000':'#006600'}}>
                {spModal.running ? '전산 출고분배 진행 중' : spModal.failed ? '전산 출고분배 중단' : '전산 출고분배 완료'}
              </span>
            </div>
            <div className="modal-body" style={{padding:'18px 22px'}}>
              <div style={{fontSize:15,fontWeight:800,marginBottom:10}}>{spModal.title}</div>
              {spModal.procedureName && (
                <div style={{fontSize:12,color:'var(--text3)',marginBottom:10}}>실행 경로: dbo.{spModal.procedureName}</div>
              )}
              {spModal.before && spModal.after && (
                <table style={{width:'100%',borderCollapse:'collapse',fontSize:12,marginBottom:14}}>
                  <thead>
                    <tr style={{background:'#F8FAFC'}}>
                      <th style={{padding:6,border:'1px solid var(--border)'}}>구분</th>
                      <th style={{padding:6,border:'1px solid var(--border)',textAlign:'right'}}>품목</th>
                      <th style={{padding:6,border:'1px solid var(--border)',textAlign:'right'}}>업체</th>
                      <th style={{padding:6,border:'1px solid var(--border)',textAlign:'right'}}>출고합계</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td style={{padding:6,border:'1px solid var(--border)'}}>분배 전</td>
                      <td style={{padding:6,border:'1px solid var(--border)',textAlign:'right'}}>{fmt(spModal.before.productCount)}</td>
                      <td style={{padding:6,border:'1px solid var(--border)',textAlign:'right'}}>{fmt(spModal.before.customerCount)}</td>
                      <td style={{padding:6,border:'1px solid var(--border)',textAlign:'right'}}>{fmt(spModal.before.outQuantity)}</td>
                    </tr>
                    <tr>
                      <td style={{padding:6,border:'1px solid var(--border)'}}>분배 후</td>
                      <td style={{padding:6,border:'1px solid var(--border)',textAlign:'right'}}>{fmt(spModal.after.productCount)}</td>
                      <td style={{padding:6,border:'1px solid var(--border)',textAlign:'right'}}>{fmt(spModal.after.customerCount)}</td>
                      <td style={{padding:6,border:'1px solid var(--border)',textAlign:'right',fontWeight:800,color:'var(--blue)'}}>{fmt(spModal.after.outQuantity)}</td>
                    </tr>
                  </tbody>
                </table>
              )}
              <div style={{border:'1px solid var(--border)',borderRadius:6,background:'#FAFAFA',padding:10,maxHeight:240,overflowY:'auto',fontSize:12,lineHeight:1.7}}>
                {(spModal.logs || []).map((line, i) => (
                  <div key={i} style={{color:line.startsWith('오류')?'var(--red)':'var(--text2)'}}>• {line}</div>
                ))}
              </div>
              <button className="btn btn-primary" style={{width:'100%',height:36,marginTop:14}} disabled={spModal.running} onClick={() => setSpModal(null)}>
                확인
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 탭 */}
      <div style={{display:'flex',flexWrap:'wrap',borderBottom:'2px solid var(--border)',background:'var(--surface)',flexShrink:0}}>
        {tabs.map((t,i) => (
          <button type="button" key={t} onClick={()=>setTab(i)} aria-current={tab===i?'page':undefined}
            style={{padding:'9px 16px',fontSize:13,fontWeight:600,cursor:'pointer',color:tab===i?'var(--blue)':'var(--text3)',borderBottom:tab===i?'2px solid var(--blue)':'2px solid transparent',marginBottom:-2,whiteSpace:'nowrap'}}>
            {['🚚','📅','📊'][i]} {t}
          </button>
        ))}
        {/* 보기 모드 전환 */}
        {tab===0 && (
          <div style={{marginLeft:'auto',display:'flex',alignItems:'center',gap:6,padding:'0 14px'}}>
            <span style={{fontSize:11,color:'var(--text3)'}}>조회 기준:</span>
            <button className={`btn btn-sm ${viewMode==='prod'?'btn-primary':'btn-secondary'}`} disabled={loading} onClick={()=>setViewMode('prod')}>품목 기준</button>
            <button className={`btn btn-sm ${viewMode==='cust'?'btn-primary':'btn-secondary'}`} disabled={loading} onClick={()=>setViewMode('cust')}>업체 기준</button>
          </div>
        )}
      </div>

      {/* 탭1 본문 */}
      {tab === 0 && (
        <div className="distribution-workspace-grid" style={{display:'grid',gridTemplateColumns: viewMode==='prod'?'minmax(360px, 34%) minmax(0, 1fr)':'minmax(240px, 28%) minmax(0, 1fr)',alignItems:'start',background:'var(--surface)',border:'1px solid var(--border)',borderTop:'none',borderRadius:'0 0 8px 8px'}}>

          {/* ── 품목 기준: 왼쪽 품목 목록 ── */}
          {viewMode === 'prod' && (
            <div style={{borderRight:'1px solid var(--border)',minWidth:0}}>
              <div style={{padding:'8px 12px',background:'#F8FAFC',borderBottom:'1px solid var(--border)',display:'flex',gap:6,flexWrap:'wrap'}}>
                <input ref={productSearchRef} className="filter-input" placeholder="품목명 검색 (ProdName A-Z)" value={prodFilter} onChange={e=>setProdFilter(e.target.value)} style={{flex:1,height:28,fontSize:12,minWidth:0}}/>
                <button type="button" className={`btn btn-sm ${favoritesOnly?'btn-primary':'btn-secondary'}`}
                  aria-pressed={favoritesOnly} onClick={() => setFavoritesOnly(value => !value)}>★ 즐겨찾기만</button>
              </div>
              <div style={{overflowX:'auto'}}>
                {loading ? <div className="skeleton" style={{margin:12,height:300,borderRadius:8}}></div> : (
                  <table className="tbl" style={{fontSize:12,minWidth:620}}>
                    <thead>
                      <tr>
                        <th style={{minWidth:180}}>품목명(색상)</th><th>단위</th>
                        <th style={{textAlign:'right'}}>box</th><th style={{textAlign:'right'}}>단</th><th style={{textAlign:'right'}}>송이</th>
                        <th style={{textAlign:'right',color:'var(--text3)'}}>전차수 잔량</th>
                        <th style={{textAlign:'right',color:'var(--blue)'}}>입고</th>
                        <th style={{textAlign:'right'}}>출고</th>
                        <th style={{textAlign:'right',color:'var(--green)'}}>현재고</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredProds.length === 0
                        ? <tr><td colSpan={9} style={{textAlign:'center',padding:32,color:'var(--text3)'}}>{favoritesOnly ? '이 차수에 즐겨찾기 품목이 없습니다.' : '차수 선택 후 조회하세요'}</td></tr>
                        : filteredProds.map((p, productIndex) => {
                          const isSelected = selectedProd?.ProdKey === p.ProdKey;
                          const hasStock = p.inQty > 0;
                          return (
                            <tr key={p.ProdKey} className={isSelected?'selected':''} onClick={()=>selectProd(p)} style={{cursor:'pointer',background:hasStock&&!isSelected?'#F0F7FF':undefined}}>
                              <td style={{minWidth:180,maxWidth:240,whiteSpace:'normal',overflowWrap:'anywhere',fontWeight:hasStock?600:400,color:hasStock?'var(--blue)':'var(--text2)'}}>
                                <button type="button" data-product-select className="btn btn-sm" disabled={loading || saving}
                                  aria-label={`${p.ProdName} 선택`} title={p.DisplayName || p.ProdName}
                                  onClick={e=>{e.stopPropagation();selectProd(p);}}
                                  onKeyDown={e=>{
                                    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
                                    e.preventDefault();
                                    const nextIndex = Math.max(0, Math.min(filteredProds.length - 1, productIndex + (e.key === 'ArrowDown' ? 1 : -1)));
                                    e.currentTarget.closest('tbody')?.querySelectorAll('button[data-product-select]')[nextIndex]?.focus();
                                  }}
                                  style={{padding:0,border:0,background:'transparent',color:'inherit',font:'inherit',textAlign:'left',whiteSpace:'normal',overflowWrap:'anywhere',cursor:'pointer',marginRight:4}}>{distributeProductName(p, selectedFlower)}</button>
                                <button type="button" className="btn btn-sm" onClick={event=>toggleProductFavorite(p,event)}
                                  disabled={!accountId || favoritesPending} aria-label={`${p.ProdName} ${favoriteKeys.has(Number(p.ProdKey))?'즐겨찾기 해제':'즐겨찾기 추가'}`}
                                  aria-pressed={favoriteKeys.has(Number(p.ProdKey))}
                                  title="이 계정의 품목 즐겨찾기">{favoriteKeys.has(Number(p.ProdKey))?'★':'☆'}</button>
                              </td>
                              <td style={{color:'var(--text3)'}}>{p.OutUnit}</td>
                              <td className="num">{p.BunchOf1Box||0}</td>
                              <td className="num">{p.SteamOf1Box||0}</td>
                              <td className="num">{(p.BunchOf1Box||0)*(p.SteamOf1Box||0)}</td>
                              <td className="num" style={{color:'var(--text3)'}} title={distributePreviousStock(p)==null?'품종 선택 후 전차수 잔량 확인':undefined}>{distributePreviousStock(p)?.toFixed(2) ?? '—'}</td>
                              <td className="num" style={{color:'var(--blue)',fontWeight:p.inQty>0?700:400}}>{p.inQty?.toFixed(2)||'—'}</td>
                              <td className="num">{p.outQty?.toFixed(2)||'—'}</td>
                              <td className="num" style={{fontWeight:700,color:(p.prevStock-p.outQty)>0?'var(--green)':'var(--text3)'}}>{((p.prevStock||0)-(p.outQty||0)).toFixed(2)}</td>
                            </tr>
                          );
                        })}
                    </tbody>
                    <tfoot>
                      <tr className="foot">
                        <td colSpan={5}>합계</td>
                        <td className="num">{distributePreviousStockTotal(filteredProds)?.toFixed(2) ?? '—'}</td>
                        <td className="num">{filteredProds.reduce((a,b)=>a+(b.inQty||0),0).toFixed(2)}</td>
                        <td className="num">{filteredProds.reduce((a,b)=>a+(b.outQty||0),0).toFixed(2)}</td>
                        <td className="num">{filteredProds.reduce((a,b)=>a+((b.prevStock||0)-(b.outQty||0)),0).toFixed(2)}</td>
                      </tr>
                    </tfoot>
                  </table>
                )}
              </div>
            </div>
          )}

          {/* ── 업체 기준: 왼쪽 업체 목록 ── */}
          {viewMode === 'cust' && (
            <div style={{borderRight:'1px solid var(--border)',minWidth:0}}>
              <div style={{padding:'8px 12px',background:'#F8FAFC',borderBottom:'1px solid var(--border)',fontSize:11,fontWeight:700,color:'var(--text2)'}}>거래처 목록</div>
              <div style={{overflowX:'auto'}}>
                {loading ? <div className="skeleton" style={{margin:12,height:200,borderRadius:8}}></div> : (
                  <table className="tbl" style={{fontSize:12}}>
                    <thead><tr><th>거래처명</th><th>지역</th><th>코드</th></tr></thead>
                    <tbody>
                      {filteredCustomers.length === 0
                        ? <tr><td colSpan={3} style={{textAlign:'center',padding:24,color:'var(--text3)'}}>차수 조회 후 표시</td></tr>
                        : filteredCustomers.map(c => (
                          <tr key={c.CustKey} className={selectedCust?.CustKey===c.CustKey?'selected':''}>
                            <td className="name"><button type="button" className="btn btn-sm" disabled={loading || saving} onClick={()=>selectCust(c)}>{c.CustName}</button></td>
                            <td><span className="badge badge-gray" style={{fontSize:10}}>{c.CustArea}</span></td>
                            <td style={{fontFamily:'var(--mono)',fontSize:11}}>{c.OrderCode}</td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          )}

          {/* ── 오른쪽: 거래처 분배 정보 (품목기준) / 품목 목록 (업체기준) ── */}
          <div style={{minWidth:0}}>
            {viewMode === 'prod' && (
              <>
                {/* 분배 컨트롤 */}
                <div style={{padding:'8px 14px',background:'#F8FAFC',borderBottom:'1px solid var(--border)',display:'flex',alignItems:'center',gap:14,flexWrap:'wrap'}}>
                  <span style={{fontSize:12,fontWeight:600,color:'var(--text2)'}}>분배방식</span>
                  <label style={{display:'flex',alignItems:'center',gap:5,fontSize:13,cursor:'pointer'}}>
                    <input type="radio" name="distMode" checked={distMode==='ratio'} onChange={()=>setDistMode('ratio')}/> 비율 분배
                  </label>
                  <label style={{display:'flex',alignItems:'center',gap:5,fontSize:13,cursor:'pointer'}}>
                    <input type="radio" name="distMode" checked={distMode==='prior'} onChange={()=>setDistMode('prior')}/> 우선 분배
                  </label>
                  <button className="btn btn-success btn-sm" onClick={() => handleSpDistribute('one')} disabled={spLoading || !selectedProd || custDist.length === 0 || isFixed} title="nenova.exe 개별출고분배와 같은 dbo.usp_DistributeOne 경로로 저장합니다.">전산 개별출고분배</button>
                  <button className="btn btn-warning btn-sm" onClick={handleClearOne} disabled={spLoading || !selectedProd || isFixed} title="nenova.exe 개별 초기화와 같은 dbo.usp_DistributeClear 경로로 이 품목의 출고분배를 DB에서 되돌립니다. (확정된 분배는 먼저 확정취소)">전산 개별 초기화</button>
                  <button className="btn btn-secondary btn-sm" onClick={autoDistribute} disabled={saving || loading || !selectedProd || custDist.length === 0} title="화면 입력값만 자동 계산합니다. DB 반영은 상단 저장 버튼으로 적용됩니다.">화면 비율계산</button>
                  <button className="btn btn-secondary btn-sm" onClick={fillOrderQuantities} disabled={saving || loading || !selectedProd || custDist.length === 0} title="주문수량을 출고수량 입력값으로 채웁니다. DB 반영은 상단 저장 버튼으로 적용됩니다.">주문수량 채우기</button>
                  <button className="btn btn-secondary btn-sm" disabled={saving || loading} onClick={()=>{const o={};custDist.forEach(c=>{o[c.CustKey]=0;});setOutInputs(o);setOutQty(0);}}>🔄 개별 초기화</button>
                </div>
                {/* 입고/출고/잔량 */}
                <div style={{display:'flex',borderBottom:'1px solid var(--border)',background:'var(--bg)',flexShrink:0}}>
                  {[['입고수량',inQty,'var(--blue)'],['출고수량',totalOutInput,'var(--text1)'],['잔량',remain,remain<0?'var(--red)':remain===0?'var(--green)':'var(--amber)']].map(([label,val,color])=>(
                    <div key={label} style={{flex:1,padding:'10px 16px',textAlign:'center',borderRight:'1px solid var(--border)'}}>
                      <div style={{fontSize:11,color:'var(--text3)',marginBottom:3}}>{label}</div>
                      <div style={{fontSize:20,fontWeight:900,fontFamily:'var(--mono)',color}}>{(val||0).toFixed(2)}</div>
                      {label === '입고수량' && selectedProd && <div style={{fontSize:12,color:'var(--text2)',marginTop:3}}>전차수 잔량 {previousStock == null ? '품종 선택 후 확인' : `${previousStock.toFixed(2)} ${selectedProd.OutUnit || ''}`}</div>}
                    </div>
                  ))}
                </div>
                {/* 거래처 분배 테이블 */}
                <div style={{overflowX:'auto'}}>
                  {!selectedProd
                    ? <div className="empty-state"><div className="empty-icon">←</div><div className="empty-text">품목을 선택하세요</div></div>
                    : distLoading ? <div className="skeleton" style={{margin:16,height:200,borderRadius:8}}></div>
                    : (
                      <>
                        <div style={{padding:'6px 14px',background:'var(--blue-bg)',fontSize:12,color:'var(--blue)',fontWeight:600}}>
                          {distributeProductName(selectedProd, selectedFlower)} — 거래처 분배 정보
                        </div>
                        <table className="tbl" style={{fontSize:12}}>
                          <thead>
                            <tr>
                              <th>거래처명</th><th>주문코드</th><th>단위</th>
                              <th style={{textAlign:'right'}}>주문수량</th>
                              <th style={{textAlign:'right',color:'var(--blue)'}}>출고수량 입력</th>
                              <th style={{textAlign:'right'}}>차이</th>
                              <th style={{textAlign:'right'}}>Box수량</th>
                              <th style={{textAlign:'right'}}>단수량</th>
                              <th style={{textAlign:'right'}}>송이수량</th>
                              <th style={{textAlign:'right'}}>단가</th>
                              <th>출고 비고 / 미저장 변경</th>
                            </tr>
                          </thead>
                          <tbody>
                            {custDist.length === 0
                              ? <tr><td colSpan={11} style={{textAlign:'center',padding:24,color:'var(--text3)'}}>주문 데이터 없음</td></tr>
                              : custDist.map(c => {
                                const outVal = outInputs[c.CustKey] || 0;
                                const diff = (c.주문수량||0) - outVal;
                                const boxQty = selectedProd.OutUnit==='박스' ? outVal : 0;
                                const bunchQty = selectedProd.OutUnit==='박스' ? Math.floor(outVal*(selectedProd.BunchOf1Box||1)) : selectedProd.OutUnit==='단' ? outVal : 0;
                                const steamQty = Math.floor(outVal*(selectedProd.SteamOf1Box||1));
                                const isSel = selectedDistCust?.CustKey === c.CustKey;
                                return (
                                  <tr key={c.CustKey}
                                    onClick={() => selectDistCustRow(c)}
                                    style={{ cursor: 'pointer', background: isSel ? 'var(--blue-bg)' : undefined }}>
                                    <td className="name">{c.CustName}</td>
                                    <td style={{fontFamily:'var(--mono)',fontSize:11}}>{c.주문코드}</td>
                                    <td style={{fontSize:11}}>{selectedProd.OutUnit || c.OutUnit || '—'}</td>
                                    <td className="num">{(c.주문수량||0).toFixed(2)}</td>
                                    <td>
                                      <input type="number" min={0} step={1} value={outVal||''} data-distribute-qty="true" aria-keyshortcuts="Enter" disabled={saving || loading}
                                        aria-label={`${c.CustName} ${selectedProd.ProdName} 출고수량 (${selectedProd.OutUnit || c.OutUnit || ''})`}
                                        onKeyDown={handleQuantityEnter}
                                        onChange={e=>{const v=parseFloat(e.target.value)||0;setOutInputs(o=>({...o,[c.CustKey]:v}));}}
                                        style={{width:75,height:26,border:`1px solid ${outVal>0?'var(--blue)':'var(--border2)'}`,borderRadius:4,textAlign:'right',fontSize:12,fontFamily:'var(--mono)',padding:'0 4px',background:outVal>0?'var(--blue-bg)':'var(--bg)',fontWeight:outVal>0?700:400}}
                                      />
                                    </td>
                                    <td className="num" style={{color:diff<0?'var(--red)':diff===0?'var(--green)':'var(--text3)'}}>{diff.toFixed(2)}</td>
                                    <td className="num">{boxQty||'—'}</td>
                                    <td className="num">{bunchQty||'—'}</td>
                                    <td className="num">{steamQty||'—'}</td>
                                    <td className="num">{fmt(c.Cost || selectedProd.Cost || 0)}</td>
                                    <td style={{fontSize:11,color:'var(--text3)'}}>
                                      <div>{distributionQuantityRemark(c.ShipmentDescr, c.출고수량, outVal, selectedProd.OutUnit || c.OutUnit)}</div>
                                      {c.비고 && c.비고 !== c.ShipmentDescr && <div>주문 메모: {c.비고}</div>}
                                    </td>
                                  </tr>
                                );
                              })}
                          </tbody>
                          <tfoot>
                            <tr className="foot">
                              <td colSpan={3}>합계</td>
                              <td className="num">{custDist.reduce((a,b)=>a+(b.주문수량||0),0).toFixed(2)}</td>
                              <td className="num" style={{color:'var(--blue)'}}>{totalOutInput.toFixed(2)}</td>
                              <td className="num" style={{color:remain<0?'var(--red)':remain===0?'var(--green)':'var(--amber)'}}>{remain.toFixed(2)}</td>
                              <td colSpan={5}></td>
                            </tr>
                          </tfoot>
                        </table>
                        {/* exe 농장 정보 (grdViewShipment_FocusedRowChanged) */}
                        <div style={{borderTop:'2px solid var(--border)',padding:'8px 14px',background:'#FAFAFA'}}>
                          <div style={{fontSize:12,fontWeight:700,marginBottom:8,color:'var(--text2)'}}>
                            ≡ 농장 정보
                            {selectedDistCust ? ` — ${selectedDistCust.CustName}` : ' (거래처 행 클릭)'}
                          </div>
                          {farmLoading ? (
                            <div className="skeleton" style={{height:60,borderRadius:6}} />
                          ) : !selectedDistCust ? (
                            <div style={{fontSize:11,color:'var(--text3)'}}>위 분배표에서 거래처를 클릭하면 농장별 입고/출고 잔량이 표시됩니다.</div>
                          ) : farmRows.length === 0 ? (
                            <div style={{fontSize:11,color:'var(--text3)'}}>농장 데이터 없음</div>
                          ) : (
                            <table className="tbl" style={{fontSize:11}}>
                              <thead>
                                <tr>
                                  <th>농장명</th><th>코드</th><th>주문코드</th>
                                  <th style={{textAlign:'right'}}>입고</th>
                                  <th style={{textAlign:'right'}}>출고</th>
                                  <th style={{textAlign:'right'}}>잔량</th>
                                </tr>
                              </thead>
                              <tbody>
                                {farmRows.map((f, i) => (
                                  <tr key={i}>
                                    <td>{f.FarmName}</td>
                                    <td style={{fontFamily:'var(--mono)'}}>{f.FarmCode}</td>
                                    <td style={{fontFamily:'var(--mono)'}}>{f.OrderCode}</td>
                                    <td className="num">{(f.wOutQuantity ?? 0).toLocaleString()}</td>
                                    <td className="num">{(f.sOutQuantity ?? 0).toLocaleString()}</td>
                                    <td className="num" style={{fontWeight:700,color:(f.Remainuantity||0)<0?'var(--red)':'var(--green)'}}>
                                      {(f.Remainuantity ?? 0).toLocaleString()}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          )}
                        </div>
                      </>
                    )}
                </div>
              </>
            )}

            {/* 업체 기준 오른쪽: 해당 업체 주문 품목 */}
            {viewMode === 'cust' && (
              <div style={{overflowX:'auto'}}>
                {!selectedCust
                  ? <div className="empty-state"><div className="empty-icon">←</div><div className="empty-text">업체를 선택하세요</div></div>
                  : custLoading ? <div className="skeleton" style={{margin:16,height:300,borderRadius:8}}></div>
                  : (
                    <>
                      <div style={{padding:'8px 14px',background:'var(--blue-bg)',fontSize:12,color:'var(--blue)',fontWeight:600,borderBottom:'1px solid var(--border-t)'}}>
                        {selectedCust.CustName} ({selectedCust.OrderCode}) — 주문 품목 목록
                      </div>
                      <table className="tbl" style={{fontSize:12}}>
                        <thead>
                          <tr>
                            <th>국가</th><th>꽃</th><th>품목명</th><th>단위</th>
                            <th style={{textAlign:'right',color:'var(--blue)'}}>주문수량</th>
                            <th style={{textAlign:'right',color:'var(--blue)'}}>출고수량 입력</th>
                            <th style={{textAlign:'right'}}>잔량</th>
                            <th style={{textAlign:'right',color:'var(--amber)'}}>단가 (편집)</th>
                            <th style={{textAlign:'right',color:'var(--text3)'}}>금액</th>
                            <th>출고 비고 / 미저장 변경</th>
                          </tr>
                        </thead>
                        <tbody>
                          {custItems.length === 0
                            ? <tr><td colSpan={10} style={{textAlign:'center',padding:24,color:'var(--text3)'}}>주문 데이터 없음</td></tr>
                            : custItems.map((item,i) => {
                              const edit = custEditInputs[item.ProdKey] || {};
                              const outVal = edit.outQty !== undefined ? edit.outQty : (item.출고수량 || 0);
                              const costVal = edit.cost !== undefined ? edit.cost : (item.Cost || 0);
                              const diff = (item.주문수량||0) - parseFloat(outVal||0);
                              const amount = parseFloat(outVal||0) * parseFloat(costVal||0);
                              return (
                                <tr key={i} style={{background:item.잔량>0?'#FFFBEB':undefined}}>
                                  <td style={{fontSize:11}}>{item.CounName}</td>
                                  <td style={{fontSize:11}}>{item.FlowerName}</td>
                                  <td style={{fontWeight:500}}>{item.DisplayName || item.ProdName}</td>
                                  <td style={{fontSize:11}}>{item.OutUnit}</td>
                                  <td className="num" style={{color:'var(--blue)',fontWeight:700}}>{(item.주문수량||0).toFixed(2)}</td>
                                  <td>
                                    <input type="number" min={0} step={0.1} value={outVal||''} data-distribute-qty="true" aria-keyshortcuts="Enter" disabled={saving || loading}
                                      aria-label={`${selectedCust.CustName} ${item.ProdName} 출고수량 (${item.OutUnit || ''})`}
                                      onKeyDown={handleQuantityEnter}
                                      onChange={e=>setCustEditInputs(prev=>({...prev,[item.ProdKey]:{...(prev[item.ProdKey]||{}),outQty:e.target.value}}))}
                                      style={{width:80,height:26,border:`1px solid ${parseFloat(outVal)>0?'var(--blue)':'var(--border2)'}`,borderRadius:4,textAlign:'right',fontSize:12,fontFamily:'var(--mono)',padding:'0 4px',background:parseFloat(outVal)>0?'var(--blue-bg)':'var(--bg)',fontWeight:parseFloat(outVal)>0?700:400}}
                                    />
                                  </td>
                                  <td className="num" style={{fontWeight:700,color:diff<0?'var(--red)':diff===0?'var(--green)':'var(--amber)'}}>{diff.toFixed(2)}</td>
                                  <td>
                                    <input type="number" min={0} step={1} value={costVal||''} disabled={saving || loading}
                                      onChange={e=>setCustEditInputs(prev=>({...prev,[item.ProdKey]:{...(prev[item.ProdKey]||{}),cost:e.target.value}}))}
                                      style={{width:90,height:26,border:'1px solid var(--amber)',borderRadius:4,textAlign:'right',fontSize:12,fontFamily:'var(--mono)',padding:'0 4px',background:'#FFFBEB'}}
                                    />
                                  </td>
                                  <td className="num" style={{color:'var(--text2)'}}>{amount>0?fmt(Math.round(amount)):'—'}</td>
                                  <td style={{fontSize:11,color:'var(--text3)'}}>
                                    <div>{distributionQuantityRemark(item.ShipmentDescr, item.출고수량, outVal, item.OutUnit)}</div>
                                    {item.비고 && item.비고 !== item.ShipmentDescr && <div>주문 메모: {item.비고}</div>}
                                  </td>
                                </tr>
                              );
                            })}
                        </tbody>
                        <tfoot>
                          <tr className="foot">
                            <td colSpan={4}>합계</td>
                            <td className="num">{custItems.reduce((a,b)=>a+(b.주문수량||0),0).toFixed(2)}</td>
                            <td className="num" style={{color:'var(--blue)'}}>
                              {custItems.reduce((a,item)=>{const e=custEditInputs[item.ProdKey]||{};return a+parseFloat(e.outQty!==undefined?e.outQty:(item.출고수량||0))||0;},0).toFixed(2)}
                            </td>
                            <td className="num">
                              {custItems.reduce((a,item)=>{const e=custEditInputs[item.ProdKey]||{};const q=parseFloat(e.outQty!==undefined?e.outQty:(item.출고수량||0))||0;return a+((item.주문수량||0)-q);},0).toFixed(2)}
                            </td>
                            <td></td>
                            <td className="num" style={{color:'var(--text2)',fontWeight:700}}>
                              {fmt(Math.round(custItems.reduce((a,item)=>{const e=custEditInputs[item.ProdKey]||{};const q=parseFloat(e.outQty!==undefined?e.outQty:(item.출고수량||0))||0;const c=parseFloat(e.cost!==undefined?e.cost:(item.Cost||0))||0;return a+q*c;},0)))}
                            </td>
                          </tr>
                        </tfoot>
                      </table>
                    </>
                  )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* 탭2: 출고일 지정 */}
      {tab === 1 && (
        <div style={{flex:1,overflow:'auto',border:'1px solid var(--border)',borderTop:'none',borderRadius:'0 0 8px 8px',background:'var(--surface)'}}>
          {/* 상단: 기본 출고요일 설정 */}
          <div style={{padding:'12px 16px',borderBottom:'2px solid var(--border)',background:'#F8FAFC'}}>
            <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:10}}>
              <span style={{fontSize:13,fontWeight:700}}>📅 품목그룹별 기본 출고요일 설정</span>
              <button className="btn btn-primary btn-sm" onClick={saveShipDayConfigs} disabled={shipDaySaving}>
                {shipDaySaving ? '저장중...' : '💾 출고요일 저장'}
              </button>
              {shipDayLoading && <span style={{fontSize:11,color:'var(--text3)'}}>로딩...</span>}
            </div>
            <div style={{overflowX:'auto'}}>
              <table className="tbl" style={{fontSize:12,minWidth:600}}>
                <thead>
                  <tr>
                    <th style={{width:180}}>품목그룹</th>
                    {WEEK_SUFFIXES.map(s => (
                      <th key={s} colSpan={5} style={{textAlign:'center',color:'var(--blue)'}}>
                        {s.replace('-','')+'차'}
                      </th>
                    ))}
                  </tr>
                  <tr>
                    <th></th>
                    {WEEK_SUFFIXES.map(s => DAY_NAMES.map(d => (
                      <th key={s+d} style={{textAlign:'center',fontSize:11,width:40,padding:'4px 2px'}}>{d}</th>
                    )))}
                  </tr>
                </thead>
                <tbody>
                  {prodGroups.map(pg => (
                    <tr key={pg.key}>
                      <td style={{fontWeight:600,fontSize:12}}>{pg.label}</td>
                      {WEEK_SUFFIXES.map(s => DAY_NAMES.map(d => {
                        const key = `${pg.key}|${s}`;
                        const checked = (shipDayConfigs[key] || '').split(',').includes(d);
                        return (
                          <td key={s+d} style={{textAlign:'center',padding:'3px 2px'}}>
                            <input type="checkbox" checked={checked}
                              onChange={() => toggleShipDay(pg.key, s, d)}
                              style={{cursor:'pointer',width:16,height:16}} />
                          </td>
                        );
                      }))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* 하단: 업체별 일별 수량 분배 */}
          <div className="distribution-workspace-grid" style={{display:'grid',gridTemplateColumns:'minmax(240px, 28%) minmax(0, 1fr)',alignItems:'start'}}>
            {/* 업체 목록 */}
            <div style={{borderRight:'1px solid var(--border)',minWidth:0}}>
              <div style={{padding:'8px 12px',background:'#F0F7FF',borderBottom:'1px solid var(--border)',fontSize:11,fontWeight:700}}>
                업체 선택 → 일별 분배
                {countryFlowerFromGroup(prodGroup, prodGroups) && (
                  <span style={{marginLeft:8,fontWeight:400,color:'var(--blue)'}}>(exe custWeekGrid)</span>
                )}
              </div>
              {custList.length === 0
                ? <div style={{padding:20,textAlign:'center',color:'var(--text3)',fontSize:12}}>차수 조회 후 표시</div>
                : sortDistributionCustomers(custList).map(c => (
                  <button type="button" key={c.CustKey}
                    onClick={() => loadTab2Items(c.CustKey)}
                    style={{
                      display:'block',width:'100%',textAlign:'left',padding:'6px 12px',fontSize:12,cursor:'pointer',
                      background: tab2CustKey === c.CustKey ? 'var(--blue-bg)' : undefined,
                      borderBottom:'1px solid var(--border)',
                      fontWeight: tab2CustKey === c.CustKey ? 700 : 400,
                    }}>
                    {c.CustName} <span style={{fontSize:10,color:'var(--text3)'}}>{c.CustArea}</span>
                  </button>
                ))
              }
            </div>

            {/* 품목별 일별 수량 */}
            <div style={{overflowX:'auto',minWidth:0}}>
              {!tab2CustKey
                ? <div className="empty-state"><div className="empty-icon">←</div><div className="empty-text">업체를 선택하세요</div></div>
                : tab2Loading
                ? <div className="skeleton" style={{margin:16,height:200,borderRadius:8}}></div>
                : (
                  <table className="tbl" style={{fontSize:12}}>
                    <thead>
                      <tr>
                        <th>품목명</th><th>단위</th>
                        <th style={{textAlign:'right'}}>출고수량</th>
                        {(tab2UsesExeGrid ? DAY_NAMES_TAB2 : DAY_NAMES).map(d => (
                          <th key={d} style={{textAlign:'center',color:'var(--blue)',width:65}}>{d}</th>
                        ))}
                        <th style={{textAlign:'right'}}>합계</th>
                        <th style={{textAlign:'center'}}>차이</th>
                      </tr>
                    </thead>
                    <tbody>
                      {tab2Items.length === 0
                        ? <tr><td colSpan={(tab2UsesExeGrid ? DAY_NAMES_TAB2 : DAY_NAMES).length + 5} style={{textAlign:'center',padding:24,color:'var(--text3)'}}>
                            {tab2UsesExeGrid ? '출고 데이터 없음' : '출고 데이터 없음 (탭1에서 먼저 분배하세요)'}
                          </td></tr>
                        : tab2Items.filter(item => (item.출고수량 || 0) > 0).map((item, i) => {
                          const totalQty = item.출고수량 || 0;
                          const dayCols = tab2UsesExeGrid ? DAY_NAMES_TAB2 : DAY_NAMES;
                          const days = tab2UsesExeGrid ? dayCols : getShipDays(tab2CustKey, item.ProdKey, shipDayGroupKey(item));
                          const key = `${tab2CustKey}|${item.ProdKey}`;
                          const dayInputs = dailyQtyInputs[key] || {};
                          const daySum = dayCols.reduce((a, d) => a + (parseFloat(dayInputs[d]) || 0), 0);
                          const diff = totalQty - daySum;

                          return (
                            <tr key={i} style={{background: diff !== 0 ? '#FFF3E0' : undefined}}>
                              <td style={{fontWeight:500}}>{item.DisplayName || item.ProdName}</td>
                              <td style={{fontSize:11}}>{item.OutUnit}</td>
                              <td className="num" style={{fontWeight:700,color:'var(--blue)'}}>{totalQty}</td>
                              {dayCols.map(d => {
                                const isActive = tab2UsesExeGrid || days.includes(d);
                                return (
                                  <td key={d} style={{textAlign:'center',padding:'2px 3px',background: isActive ? '#E3F2FD' : '#F5F5F5'}}>
                                    {isActive ? (
                                      <input type="number" min={0} step={1}
                                        value={dayInputs[d] ?? ''}
                                        onChange={e => handleDailyQtyChange(tab2CustKey, item.ProdKey, d, e.target.value, totalQty, days)}
                                        style={{width:50,height:24,textAlign:'right',fontSize:11,fontFamily:'var(--mono)',
                                          border:'1px solid var(--blue)',borderRadius:3,padding:'0 3px',
                                          background: (dayInputs[d] || 0) > 0 ? '#E3F2FD' : '#fff'}}
                                      />
                                    ) : (
                                      <span style={{color:'#ccc',fontSize:10}}>—</span>
                                    )}
                                  </td>
                                );
                              })}
                              <td className="num" style={{fontWeight:700}}>{daySum}</td>
                              <td className="num" style={{
                                fontWeight:700,
                                color: diff === 0 ? 'var(--green)' : diff > 0 ? 'var(--amber)' : 'var(--red)',
                              }}>
                                {diff === 0 ? '✓' : diff > 0 ? `+${diff}` : diff}
                              </td>
                            </tr>
                          );
                        })}
                    </tbody>
                    {tab2Items.filter(item => (item.출고수량 || 0) > 0).length > 0 && (
                      <tfoot>
                        <tr className="foot">
                          <td colSpan={2}>합계</td>
                          <td className="num">{tab2Items.reduce((a, b) => a + (b.출고수량 || 0), 0)}</td>
                          {(tab2UsesExeGrid ? DAY_NAMES_TAB2 : DAY_NAMES).map(d => {
                            const dayTotal = tab2Items.filter(item => (item.출고수량 || 0) > 0).reduce((a, item) => {
                              const key = `${tab2CustKey}|${item.ProdKey}`;
                              return a + (parseFloat(dailyQtyInputs[key]?.[d]) || 0);
                            }, 0);
                            return <td key={d} className="num">{dayTotal || ''}</td>;
                          })}
                          <td className="num">
                            {tab2Items.filter(item => (item.출고수량 || 0) > 0).reduce((a, item) => {
                              const key = `${tab2CustKey}|${item.ProdKey}`;
                              const dayCols = tab2UsesExeGrid ? DAY_NAMES_TAB2 : DAY_NAMES;
                              return a + dayCols.reduce((s, d) => s + (parseFloat(dailyQtyInputs[key]?.[d]) || 0), 0);
                            }, 0)}
                          </td>
                          <td></td>
                        </tr>
                      </tfoot>
                    )}
                  </table>
                )}
            </div>
          </div>
        </div>
      )}

      {/* 탭3: 출고 분배 집계 (exe GetPivotData) */}
      {tab === 2 && (
        <div style={{border:'1px solid var(--border)',borderTop:'none',borderRadius:'0 0 8px 8px',background:'var(--surface)'}}>
          <div style={{padding:'8px 14px',background:'#F8FAFC',borderBottom:'1px solid var(--border)',display:'flex',gap:8,alignItems:'center',justifyContent:'space-between'}}>
            <span style={{fontSize:12,color:'var(--text2)'}}>
              {countryFlowerFromGroup(prodGroup, prodGroups)
                ? `품목그룹 ${selectedProdGroupLabel} — 출고>0 집계 (nenova.exe GetPivotData)`
                : '품목그룹을 선택하고 조회하세요'}
            </span>
            <button className="btn btn-secondary btn-sm" onClick={loadPivotRows} disabled={pivotLoading || !countryFlowerFromGroup(prodGroup, prodGroups)}>새로고침</button>
          </div>
          <div style={{overflowX:'auto'}}>
            {pivotLoading ? (
              <div className="skeleton" style={{margin:16,height:200,borderRadius:8}} />
            ) : (
              <table className="tbl" style={{minWidth:800,fontSize:12}}>
                <thead>
                  <tr>
                    <th>국가</th><th>꽃</th><th>품목</th><th>거래처</th><th>지역</th><th>담당</th>
                    <th style={{textAlign:'right'}}>주문</th><th style={{textAlign:'right'}}>출고</th>
                  </tr>
                </thead>
                <tbody>
                  {pivotRows.length === 0 ? (
                    <tr><td colSpan={8} style={{textAlign:'center',padding:32,color:'var(--text3)'}}>데이터 없음</td></tr>
                  ) : pivotRows.map((r, i) => (
                    <tr key={`${r.CustName}-${r.ProdName}-${i}`}>
                      <td>{r.CounName}</td>
                      <td>{r.FlowerName}</td>
                      <td className="name">{r.ProdName}</td>
                      <td className="name">{r.CustName}</td>
                      <td>{r.CustArea}</td>
                      <td>{r.Manager}</td>
                      <td className="num">{(r.oOutQuantity ?? 0).toLocaleString()}</td>
                      <td className="num" style={{fontWeight:700,color:'var(--blue)'}}>{(r.sOutQuantity ?? 0).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* 확정 전 사전검증 모달 */}
      {showValidate && validateResult && (
        <div className="modal-overlay" onClick={() => setShowValidate(false)}>
          <div className="modal" style={{maxWidth:620}} onClick={e => e.stopPropagation()}>
            <div className="modal-header" style={{background:'#FFF3CD', borderBottom:'2px solid #FFC107'}}>
              <span className="modal-title" style={{color:'#856404'}}>⚠️ 확정 전 이슈 발견 ({validateResult.issueCount}건) — [{validateResult.week}]</span>
              <button className="modal-close" onClick={() => setShowValidate(false)}>✕</button>
            </div>
            <div className="modal-body" style={{padding:'16px 20px', maxHeight:'60vh', overflowY:'auto', fontSize:12}}>

              {validateResult.negative?.length > 0 && (
                <div style={{marginBottom:16}}>
                  <div style={{fontWeight:700, color:'#c00', marginBottom:6}}>🔴 마이너스 잔량 ({validateResult.negative.length}건) — 출고량이 입고+재고 초과</div>
                  <table style={{width:'100%', borderCollapse:'collapse', fontSize:11}}>
                    <thead><tr style={{background:'#f8d7da'}}>
                      <th style={{padding:'4px 6px', textAlign:'left'}}>품목</th>
                      <th style={{padding:'4px 6px'}}>전재고</th>
                      <th style={{padding:'4px 6px'}}>입고</th>
                      <th style={{padding:'4px 6px'}}>출고</th>
                      <th style={{padding:'4px 6px', color:'#c00'}}>잔량</th>
                    </tr></thead>
                    <tbody>{validateResult.negative.map((r,i) => (
                      <tr key={i} style={{borderBottom:'1px solid #f5c6cb'}}>
                        <td style={{padding:'3px 6px'}}>{r.ProdName}</td>
                        <td style={{padding:'3px 6px', textAlign:'center'}}>{r.prevStock}</td>
                        <td style={{padding:'3px 6px', textAlign:'center'}}>{r.inQty}</td>
                        <td style={{padding:'3px 6px', textAlign:'center'}}>{r.outQty}</td>
                        <td style={{padding:'3px 6px', textAlign:'center', color:'#c00', fontWeight:700}}>{r.remain}</td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
              )}

              {validateResult.duplicate?.length > 0 && (
                <div style={{marginBottom:16}}>
                  <div style={{fontWeight:700, color:'#856404', marginBottom:6}}>🟡 중복 출고 ({validateResult.duplicate.length}건) — 같은 거래처+품목에 복수 입력</div>
                  <table style={{width:'100%', borderCollapse:'collapse', fontSize:11}}>
                    <thead><tr style={{background:'#fff3cd'}}>
                      <th style={{padding:'4px 6px', textAlign:'left'}}>거래처</th>
                      <th style={{padding:'4px 6px', textAlign:'left'}}>품목</th>
                      <th style={{padding:'4px 6px'}}>건수</th>
                      <th style={{padding:'4px 6px'}}>합계</th>
                    </tr></thead>
                    <tbody>{validateResult.duplicate.map((r,i) => (
                      <tr key={i} style={{borderBottom:'1px solid #ffeeba'}}>
                        <td style={{padding:'3px 6px'}}>{r.CustName}</td>
                        <td style={{padding:'3px 6px'}}>{r.ProdName}</td>
                        <td style={{padding:'3px 6px', textAlign:'center', color:'#c00', fontWeight:700}}>{r.cnt}건</td>
                        <td style={{padding:'3px 6px', textAlign:'center'}}>{r.totalQty}</td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
              )}

              {validateResult.ghost?.length > 0 && (
                <div style={{marginBottom:16}}>
                  <div style={{fontWeight:700, color:'#555', marginBottom:6}}>⚪ 주문 없는 출고 ({validateResult.ghost.length}건) — 주문 미등록 상태에서 출고 분배됨</div>
                  <table style={{width:'100%', borderCollapse:'collapse', fontSize:11}}>
                    <thead><tr style={{background:'#e2e3e5'}}>
                      <th style={{padding:'4px 6px', textAlign:'left'}}>거래처</th>
                      <th style={{padding:'4px 6px', textAlign:'left'}}>품목</th>
                      <th style={{padding:'4px 6px'}}>수량</th>
                      <th style={{padding:'4px 6px'}}>확정여부</th>
                    </tr></thead>
                    <tbody>{validateResult.ghost.map((r,i) => (
                      <tr key={i} style={{borderBottom:'1px solid #d6d8db'}}>
                        <td style={{padding:'3px 6px'}}>{r.CustName}</td>
                        <td style={{padding:'3px 6px'}}>{r.ProdName}</td>
                        <td style={{padding:'3px 6px', textAlign:'center'}}>{r.OutQuantity}</td>
                        <td style={{padding:'3px 6px', textAlign:'center'}}>{r.isFix ? '확정' : '미확정'}</td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
              )}

              <div style={{color:'#666', fontSize:11, marginTop:8}}>위 이슈를 확인 후 수정하거나, 이상 없으면 그대로 확정할 수 있습니다.</div>
            </div>
            <div className="modal-footer" style={{display:'flex', gap:8, justifyContent:'flex-end', padding:'12px 20px'}}>
              <button className="btn btn-secondary btn-sm" onClick={() => setShowValidate(false)}>취소 / Cancelar</button>
              <button className="btn btn-warning btn-sm" style={{background:'#FFC107', color:'#000', border:'none'}}
                onClick={() => { setShowValidate(false); doFix(); }}>
                이슈 무시하고 확정
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 출고 분배 내역 조회 모달 */}
      {showHistory && (
        <div className="modal-overlay" onClick={()=>setShowHistory(false)}>
          <div className="modal" style={{maxWidth:860}} onClick={e=>e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">■ 출고 분배 내역 조회 — [{week}] 차수</span>
              <button className="btn btn-sm" onClick={()=>setShowHistory(false)}>{t('닫기')}</button>
            </div>
            <div className="modal-body" style={{padding:0,maxHeight:'70vh',overflowY:'auto'}}>
              <table className="tbl">
                <thead>
                  <tr>
                    <th>변경일자</th><th>차수</th><th>거래처명</th>
                    <th>국가</th><th>꽃</th><th>품목명</th>
                    <th>변경유형</th><th>변경항목</th>
                    <th style={{textAlign:'right'}}>기준값</th>
                    <th style={{textAlign:'right'}}>변경값</th>
                    <th>비고</th>
                  </tr>
                </thead>
                <tbody>
                  {historyData.length === 0
                    ? <tr><td colSpan={11} style={{textAlign:'center',padding:32,color:'var(--text3)'}}>변경 내역 없음</td></tr>
                    : historyData.map((r,i) => (
                      <tr key={i}>
                        <td style={{fontFamily:'var(--mono)',fontSize:11}}>{r.ChangeDtm}</td>
                        <td style={{fontFamily:'var(--mono)',fontWeight:'bold'}}>{r.week}</td>
                        <td>{r.CustName}</td>
                        <td>{r.country}</td>
                        <td>{r.flower}</td>
                        <td style={{fontSize:12}}>{r.name}</td>
                        <td>
                          <span className={`badge ${r.type==='신규'?'badge-green':r.type==='수정'?'badge-blue':'badge-red'}`}>
                            {r.type}
                          </span>
                        </td>
                        <td style={{fontSize:11}}>{r.변경항목||'수량'}</td>
                        <td className="num" style={{color:'var(--text3)'}}>{r.before}</td>
                        <td className="num" style={{fontWeight:'bold',color:r.type==='삭제'?'var(--red)':r.type==='신규'?'var(--green)':'var(--blue)'}}>{r.after}</td>
                        <td style={{fontSize:11,color:'var(--text3)'}}>{r.Descr||'—'}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={()=>setShowHistory(false)}>{t('닫기')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
