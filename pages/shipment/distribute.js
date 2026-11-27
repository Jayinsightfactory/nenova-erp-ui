import DistributionMoveDialog from '../../components/shipment/DistributionMoveDialog';
import { createDistributionPeerReads, assertDistributionBatchSize } from '../../lib/shipmentDistributionPeers.js';
import { useDistributionViewport } from '../../lib/useDistributionViewport.js';
import DistributionScrollBar from '../../components/shipment/DistributionScrollBar';
import DistributionInlineDates, { DistributionInlineDatesHeader } from '../../components/shipment/DistributionInlineDates';
import DistributionKakaoFeed from '../../components/shipment/DistributionKakaoFeed';
import DistributionFixToggle from '../../components/shipment/DistributionFixToggle';
import DistributionConfirmationSummary from '../../components/shipment/DistributionConfirmationSummary';
import { majorInlineWeekScope } from '../../lib/shipmentMajorInlineDates.js';
import DistributionProductTree from '../../components/shipment/DistributionProductTree';
import DistributionDateFilter from '../../components/shipment/DistributionDateFilter';
import { favoriteDistributionRows, buildDistributionDateLookup, distributionFamilyMatches } from '../../lib/shipmentDistributionNavigation.js';
import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { apiGet, apiPost, apiDelete, apiPut } from '../../lib/useApi';
import { useWeekInput, WeekInput, formatWeekDisplay } from '../../lib/useWeekInput';
import { useLang } from '../../lib/i18n';
import { distributePreviousStock } from '../../lib/distributeProductDisplay';
import DistributionDateEditor from '../../components/shipment/DistributionDateEditor';
import WorkflowGuide from '../../components/WorkflowGuide';
import DistributionPicker from '../../components/shipment/DistributionPicker';
import { runEditWithFixCycle } from '../../lib/fixCycleClient';
import { customerMatchesSearch } from '../../lib/customerSearch';
import {
  distributionWeekOptions,
  distributionWeekButtons,
  distributionSubWeekButtons,
  distributionSaveLogLine,
  hasDistributionDrafts,
  mergeDistributionCustomerItems,
  parseDistributionFavorite,
  parseDistributionGroupFavorite,
  parseDistributionCountryFavorite,
  planDistributionMove,
  pendingDistributionOrderItems,
  pendingDistributionItem,
  distributionFixCycleScope,
  distributionCustomerSearchRows,
  mergeDistributionSearchCandidates,
  sortDistributionCustomers,
  sortDistributionProducts,
  distributionCountryGroups,
  distributionAddProductCandidates,
  distributionSelectionMatches,
  distributionPairFilterMatches,
  toNativeQty,
} from '../../lib/shipmentDistributionWorkspace.js';
import {
  PG_SEP,
  countryFlowerFromGroup,
  DAY_NAMES,
  PRODUCT_FAVORITE_PAGE,
  GROUP_FAVORITE_PAGE,
  COUNTRY_FAVORITE_PAGE,
  mapCustWeekGridRow,
  weekButtonStyle,
  pickButtonStyle,
  matchDistributeItemName,
  calculateAutoDistributeInputs,
} from '../../lib/shipmentDistributionPageHelpers.js';
import DistributionAddItemModal from '../../components/shipment/DistributionAddItemModal';
import {
  DistributionSaveCompleteModal,
  DistributionSpProgressModal,
  DistributionHistoryModal,
} from '../../components/shipment/DistributionStatusModals';
import DistributionFarmCustomerPanel from '../../components/shipment/DistributionFarmCustomerPanel';
import DistributionCustomerWorkspacePanel, {
  DistributionCustomerLeftNav,
} from '../../components/shipment/DistributionCustomerWorkspacePanel';
import DistributionScheduleAndPivotTabs from '../../components/shipment/DistributionScheduleAndPivotTabs';

export default function Distribute() {
  const { t } = useLang();
  const [tab, setTab] = useState(0);
  const [dateEditor, setDateEditor] = useState(null);
  const [majorInlineFacts, setMajorInlineFacts] = useState(null);
  const majorInlineFactsMap = useMemo(() => {
    if (!majorInlineFacts) return null;
    const map = new Map();
    for (const r of majorInlineFacts) {
      const key = String(r.CustKey) + '|' + String(r.ProdKey);
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(r);
    }
    return map;
  }, [majorInlineFacts]);
  const [inlineCalendar, setInlineCalendar] = useState([]), [inlineFacts, setInlineFacts] = useState([]), [dateDrafts, setDateDrafts] = useState({});
  const hasDateDrafts = Object.keys(dateDrafts).length > 0;
  const inlineFactsMap = useMemo(() => {
    const map = new Map();
    for (const r of inlineFacts) {
      const key = `${r.CustKey}|${r.ProdKey}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(r);
    }
    return map;
  }, [inlineFacts]);
  useEffect(() => {
    const warn = e => { if (hasDateDrafts) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [hasDateDrafts]);
  const weekInput = useWeekInput('');
  const week = weekInput.value;
  const selectedOrderYear = String(week || '').match(/^(\d{4})-/)?.[1] || '';
  const majorWeekScope = useMemo(() => majorInlineWeekScope(majorInlineFacts, selectedOrderYear, week), [majorInlineFacts, selectedOrderYear, week]);
  const apiGetDistribute = useCallback(
    (params) => apiGet('/api/shipment/distribute', { ...params, year: selectedOrderYear }),
    [selectedOrderYear],
  );
  const [prodGroup, setProdGroup] = useState('');
  const [farmCountry, setFarmCountry] = useState('');
  const [farmFamily, setFarmFamily] = useState('');
  const [expandedFamilies, setExpandedFamilies] = useState({});
  const [farmDate, setFarmDate] = useState(''), [customerDate, setCustomerDate] = useState('');
  const [dateIndex, setDateIndex] = useState([]), [dateIndexLoading, setDateIndexLoading] = useState(false), [dateIndexError, setDateIndexError] = useState('');
  const dateRequestRef = useRef(0), customerListRequestRef = useRef(0), dealerSearchRef = useRef(null);
  const dateLookup = useMemo(() => buildDistributionDateLookup(dateIndex), [dateIndex]);

  const [prodGroups, setProdGroups] = useState([]);
  const [showAllProdGroups, setShowAllProdGroups] = useState(false);
  const [prodGroupsLoading, setProdGroupsLoading] = useState(false);
  const viewMode = tab === 1 ? 'cust' : 'prod';
  const setViewMode = mode => requestTab(mode === 'cust' ? 1 : 0);
  const [saveLog, setSaveLog] = useState([]);
  const appendSaveLog = entry => setSaveLog(prev => [distributionSaveLogLine(entry), ...prev].slice(0, 30));

  const [products, setProducts] = useState([]);
  const [selectedProd, setSelectedProd] = useState(null);
  const [custDist, setCustDist] = useState([]);
  const [distLoading, setDistLoading] = useState(false);
  const [inQty, setInQty] = useState(0);
  const [, setOutQty] = useState(0);
  const [prodFilter, setProdFilter] = useState('');
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [farmCustomerSearch, setFarmCustomerSearch] = useState('');

  const [custList, setCustList] = useState([]);
  const [selectedCust, setSelectedCust] = useState(null);
  const [custItems, setCustItems] = useState([]);
  const [custLoading, setCustLoading] = useState(false);

  const [custEditInputs, setCustEditInputs] = useState({});
  const [fixedScopeMap, setFixedScopeMap] = useState({});
  const [pairSlot, setPairSlot] = useState(1);
  const [pairCust, setPairCust] = useState(null);
  const [pairItems, setPairItems] = useState([]);
  const [pairEditInputs, setPairEditInputs] = useState({});
  const [pairLoading, setPairLoading] = useState(false);
  const [moveQtyInputs, setMoveQtyInputs] = useState({});
  const [pairGroupFilter, setPairGroupFilter] = useState('');
  const [extraPeers, setExtraPeers] = useState([]);
  const extraLoading = extraPeers.filter(p => p.loading).length;
  const [customerReadError, setCustomerReadError] = useState(''), [pairReadError, setPairReadError] = useState('');
  const [appendCompany, setAppendCompany] = useState(false);
  const [showCustomerDates,setShowCustomerDates]=useState(true);
  const [moveOpen, setMoveOpen] = useState(false);
  const peerReads = useRef(createDistributionPeerReads());
  const [, setMultiMove] = useState({});
  const [addPanel, setAddPanel] = useState(null);
  const [showAllCustomers, setShowAllCustomers] = useState(false);
  const [custItemFilter, setCustItemFilter] = useState('');
  const [productCatalog, setProductCatalog] = useState(null);
  const productCatalogLoadingRef = useRef(false);
  const [prodAddedCusts, setProdAddedCusts] = useState([]);
  const [prodAddOpen, setProdAddOpen] = useState(false);
  const [prodAddManager, setProdAddManager] = useState(null);
  const [prodAddFilter, setProdAddFilter] = useState('');
  const [addProdFilter, setAddProdFilter] = useState('');
  const [addCustFilter, setAddCustFilter] = useState('');
  const [allCustomers, setAllCustomers] = useState([]);
  const [custFilter, setCustFilter] = useState('');
  const customerPool = (showAllCustomers || String(custFilter || '').trim())
    ? [...custList, ...allCustomers.filter(a => !custList.some(c => Number(c.CustKey) === Number(a.CustKey))).map(a => ({ ...a, noOrder: true }))]
    : custList;
  const loadAllCustomers = async () => {
    if (allCustomers.length > 0) return true;
    try {
      const res = await fetch('/api/master/customers');
      const d = await res.json().catch(() => ({}));
      if (!res.ok || d.success !== true) throw new Error(d.error || '전체 업체 목록을 불러오지 못했습니다.');
      setAllCustomers((d.data || []).map(c => ({ CustKey: c.CustKey, CustName: c.CustName, CustArea: c.CustArea, OrderCode: c.OrderCode, Manager: String(c.Manager || '').trim() })));
      return true;
    } catch (e) { setErr(e.message); return false; }
  };
  const inCustomerPool = (cust) => [...customerPool, ...allCustomers].some(c => Number(c.CustKey) === Number(cust?.CustKey));
  const toggleAllCustomers = async (on) => {
    setShowAllCustomers(on);
    if (on && !(await loadAllCustomers())) setShowAllCustomers(false);
  };

  const [productListLoading, setProductListLoading] = useState(false), [customerListLoading, setCustomerListLoading] = useState(false);
  const loading = tab === 1 ? customerListLoading : productListLoading;
  const setLoading = tab === 1 ? setCustomerListLoading : setProductListLoading;
  const [distMode, setDistMode] = useState('ratio');
  const [err, setErr] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveModal, setSaveModal] = useState(null);
  const [outInputs, setOutInputs] = useState({});
  const [fixLoading, setFixLoading] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [historyData, setHistoryData] = useState([]);
  const [isFixed, setIsFixed] = useState(true);
  const [spLoading, setSpLoading] = useState(false);
  const [spModal, setSpModal] = useState(null);

  const [shipDayConfigs, setShipDayConfigs] = useState({});
  const [shipDayLoading, setShipDayLoading] = useState(false);
  const [shipDaySaving, setShipDaySaving] = useState(false);
  const [dailyQtyInputs, setDailyQtyInputs] = useState({});
  const [prodDayOverrides] = useState({});
  const [tab2CustKey, setTab2CustKey] = useState(null);
  const [tab2Items, setTab2Items] = useState([]);
  const [tab2Loading, setTab2Loading] = useState(false);
  const [excelDownloading, setExcelDownloading] = useState(false);
  const [pivotRows, setPivotRows] = useState([]);
  const [pivotLoading, setPivotLoading] = useState(false);
  const [, setTab2UsesExeGrid] = useState(false);
  const [selectedDistCust, setSelectedDistCust] = useState(null);
  const [farmRows, setFarmRows] = useState([]);
  const [farmLoading, setFarmLoading] = useState(false);
  const [favoriteProducts, setFavoriteProducts] = useState([]);
  const [countryFavorite, setCountryFavorite] = useState(undefined);
  const [favoriteGroups, setFavoriteGroups] = useState([]);
  const groupChosenRef = useRef(false);
  const [favoritesPending, setFavoritesPending] = useState(false);
  const [favoriteError, setFavoriteError] = useState('');
  const [accountId, setAccountId] = useState('');
  const weekPickerRef = useRef(null);
  const productPickerRef = useRef(null);
  const saveButtonRef = useRef(null);
  const saveModalConfirmRef = useRef(null);
  const productSearchRef = useRef(null);
  const currentWeekRef = useRef(week);
  currentWeekRef.current = week;
  const currentGroupRef = useRef(prodGroup);
  currentGroupRef.current = prodGroup;
  const currentFarmCountryRef = useRef(farmCountry);
  currentFarmCountryRef.current = farmCountry;
  const searchRequestRef = useRef(0);
  const productRequestRef = useRef(0);
  const customerRequestRef = useRef(0);
  const pairRequestRef = useRef(0);
  const extraRequestRef = useRef(0);
  const farmRequestRef = useRef(0);
  const tab2RequestRef = useRef(0);
  const pivotRequestRef = useRef(0);
  const favoritesRequestRef = useRef(0);
  const accountRef = useRef('');
  const saveInFlightRef = useRef(false);
  const anySaveModal = Boolean(saveModal || spModal || showHistory || moveOpen);
  const saveBlocked = hasDateDrafts || tab > 1 || !!dateEditor || saving || loading || distLoading || custLoading || pairLoading || extraLoading > 0 || extraPeers.some(p => p.error) || !!customerReadError || !!pairReadError || spLoading || fixLoading || shipDaySaving || anySaveModal;

  const workspaceRef = useRef(null);
  useDistributionViewport(workspaceRef, `${tab}|${selectedProd?.ProdKey}|${selectedCust?.CustKey}|${distLoading}|${custLoading}|${pairLoading}|${extraLoading}|${showCustomerDates}`);

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
        setFavoriteGroups([]);
        setExpandedFamilies({});
        setCountryFavorite(undefined);
        setShowAllProdGroups(false);
      }
      const data = await apiGet('/api/favorites', { page: PRODUCT_FAVORITE_PAGE });
      if (request !== favoritesRequestRef.current || accountRef.current !== uid) return;
      if (data?.success !== true) throw new Error(data?.error || '즐겨찾기를 읽지 못했습니다.');
      setFavoriteProducts((data.favorites || []).map(parseDistributionFavorite).filter(Boolean));
      const groupData = await apiGet('/api/favorites', { page: GROUP_FAVORITE_PAGE });
      if (request !== favoritesRequestRef.current || accountRef.current !== uid) return;
      if (groupData?.success !== true) throw new Error(groupData?.error || '품종 즐겨찾기를 읽지 못했습니다.');
      setFavoriteGroups((groupData.favorites || []).map(parseDistributionGroupFavorite).filter(Boolean));
      const countryData = await apiGet('/api/favorites', { page: COUNTRY_FAVORITE_PAGE });
      if (request !== favoritesRequestRef.current || accountRef.current !== uid) return;
      if (countryData?.success !== true) throw new Error(countryData?.error || '국가 즐겨찾기를 읽지 못했습니다.');
      setCountryFavorite(parseDistributionCountryFavorite(countryData.favorites || []));
      setFavoriteError('');
    } catch (error) {
      if (request === favoritesRequestRef.current) {
        accountRef.current = '';
        setAccountId('');
        setFavoriteProducts([]);
        setFavoriteGroups([]);
        setExpandedFamilies({});
        setCountryFavorite(undefined);
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

  const toggleGroupFavorite = async (group, event) => {
    event?.stopPropagation();
    if (!accountId || favoritesPending || !group?.key) return;
    setFavoritesPending(true);
    setFavoriteError('');
    try {
      const existing = favoriteGroups.find(row => row.groupKey === group.key);
      const result = existing
        ? await apiDelete('/api/favorites', { favoriteKey: existing.favoriteKey })
        : await apiPost('/api/favorites', {
          page: GROUP_FAVORITE_PAGE,
          name: String(group.label || group.key.replace(PG_SEP, ' ')).slice(0, 100),
          filterData: JSON.stringify({ groupKey: group.key }),
        });
      if (result?.success !== true) throw new Error(result?.error || '품종 즐겨찾기를 저장하지 못했습니다.');
      await loadFavoriteProducts();
    } catch (error) { setFavoriteError(error.message || '품종 즐겨찾기 변경에 실패했습니다.'); }
    finally { setFavoritesPending(false); }
  };

  const selectedCountries = countryFavorite?.countries ?? [...new Set(favoriteGroups.map(f => f.groupKey.split(PG_SEP)[0]))];
  const toggleCountryFavorite = async country => {
    if (!accountId || favoritesPending) return;
    setFavoritesPending(true); setFavoriteError('');
    try {
      const auth = await apiGet('/api/auth/me');
      if (String(auth?.user?.userId || '') !== accountRef.current || accountRef.current !== accountId)
        throw new Error('로그인 계정이 바뀌었습니다. 다시 조회하세요.');
      const countries = selectedCountries.includes(country) ? selectedCountries.filter(v => v !== country) : [...selectedCountries, country];
      const body = { page: COUNTRY_FAVORITE_PAGE, name: '출고분배 국가', filterData: JSON.stringify({ version: 1, countries }) };
      const result = countryFavorite?.favoriteKey
        ? await apiPut('/api/favorites', { ...body, favoriteKey: countryFavorite.favoriteKey })
        : await apiPost('/api/favorites', body);
      if (result?.success !== true) throw new Error(result?.error || '국가 즐겨찾기 저장 실패');
      await loadFavoriteProducts();
    } catch (e) { setFavoriteError(e.message); }
    finally { setFavoritesPending(false); }
  };

  const confirmDateDraftDiscard = () => { if (!hasDateDrafts) return true; if (!window.confirm('저장하지 않은 출고일 수량이 있습니다. 날짜 입력을 취소하고 이동할까요?')) return false; setDateDrafts({}); return true; };
  const confirmFarmDraftDiscard = () => !saving && confirmDateDraftDiscard() && (!hasDistributionDrafts(custDist, outInputs, [], {}) || window.confirm('저장하지 않은 품목 분배가 있습니다. 선택을 바꾸면 이 품목 입력값이 사라집니다. 계속할까요?'));
  const confirmCustomerDraftDiscard = () => !saving && confirmDateDraftDiscard() && ((!hasDistributionDrafts([], {}, custItems, custEditInputs) && !hasDistributionDrafts([], {}, pairItems, pairEditInputs) && !extraPeers.some(p => hasDistributionDrafts([], {}, p.items, p.inputs))) || window.confirm('저장하지 않은 업체 분배가 있습니다. 업체 선택을 바꿀까요?'));
  const chooseProdGroup = (key) => {
    if (key !== prodGroup && !confirmFarmDraftDiscard()) return;
    setFarmFamily(key.includes(PG_SEP) && !key.endsWith(PG_SEP) ? key : ''); setProdFilter('');
    if (key && !key.endsWith(PG_SEP)) setExpandedFamilies(prev => ({ ...prev, [key]: true }));
    if (key === prodGroup) return;
    groupChosenRef.current = true; setProdGroup(key);
    if (key) { const country = key.split(PG_SEP)[0]; if (country) setFarmCountry(country); }
    setSelectedProd(null); setCustDist([]); setOutInputs({}); setSelectedDistCust(null); setFarmRows([]);
  };
  const chooseFarmCountry = country => {
    if ((country === farmCountry && !farmFamily && prodGroup === (country ? `${country}${PG_SEP}` : '')) || !confirmFarmDraftDiscard()) return;
    setFarmFamily(''); setProdFilter('');
    setSelectedProd(null); setCustDist([]); setOutInputs({}); setSelectedDistCust(null); setFarmRows([]);
    groupChosenRef.current = true; setFarmCountry(country); setProdGroup(country ? `${country}${PG_SEP}` : '');
  };

  const loadDateIndex = useCallback(async () => {
    if (!week || !selectedOrderYear) return;
    const request = ++dateRequestRef.current, requestedWeek = week; setDateIndexLoading(true); setDateIndexError('');
    try {
      const result = await apiGetDistribute({ type: 'workspaceDateIndex', week });
      if (request !== dateRequestRef.current || requestedWeek !== currentWeekRef.current) return;
      if (!result.success) throw new Error(result.error || '조회 결과 없음');
      setDateIndex(result.rows || []); setInlineFacts(result.dateFacts || []); setInlineCalendar(result.calendar || []); setMajorInlineFacts(Array.isArray(result.majorDateFacts) ? result.majorDateFacts : null);
    } catch (error) { if (request === dateRequestRef.current) { setDateIndexError(error.message); setFarmDate(''); setCustomerDate(''); } }
    finally { if (request === dateRequestRef.current) setDateIndexLoading(false); }
  }, [week, selectedOrderYear, apiGetDistribute]);
  useEffect(() => { setFarmDate(''); setCustomerDate(''); setDateIndex([]); setMajorInlineFacts(null); setInlineFacts([]); setInlineCalendar([]); setDateDrafts({}); loadDateIndex(); return () => { dateRequestRef.current += 1; }; }, [loadDateIndex]);
  useEffect(() => { if (saveModal) loadDateIndex(); }, [saveModal, loadDateIndex]);
  const loadWorkspaceCustomers=useCallback(async()=>{
    if(!week||!selectedOrderYear)return;const request=++customerListRequestRef.current,requestedWeek=week;
    setCustomerListLoading(true);setCustList([]);
    try{const data=await apiGetDistribute({type:'workspaceCustomers',week,prodGroup:''});
      if(request!==customerListRequestRef.current||requestedWeek!==currentWeekRef.current)return;
      if(!data.success)throw new Error(data.error||'업체 조회 실패');setCustList(sortDistributionCustomers(data.customers||[]));return data;
    }catch(e){if(request===customerListRequestRef.current)setErr(e.message);return {success:false,error:e.message};}
    finally{if(request===customerListRequestRef.current)setCustomerListLoading(false);}
  },[week,selectedOrderYear,apiGetDistribute]);
  useEffect(()=>{loadWorkspaceCustomers();return()=>{customerListRequestRef.current+=1;};},[loadWorkspaceCustomers]);

  const prevSearchWeekRef = useRef(week);
  useEffect(() => {
    const request = ++searchRequestRef.current;
    const keepCust = prevSearchWeekRef.current === week;
    prevSearchWeekRef.current = week;
    productRequestRef.current += 1;
    farmRequestRef.current += 1;
    setProducts([]);
    setSelectedProd(null); setCustDist([]); setOutInputs({});
    if (!keepCust) {
      customerRequestRef.current += 1; tab2RequestRef.current += 1; pivotRequestRef.current += 1;
      setSelectedCust(null); setCustItems([]); setCustEditInputs({});
      pairRequestRef.current += 1;
      setCustomerReadError(''); setPairReadError(''); setPairCust(null); setPairItems([]); setPairEditInputs({}); setPairSlot(1); setMoveQtyInputs({}); setPairGroupFilter('');
      extraRequestRef.current += 1; peerReads.current.reset(); setExtraPeers([]); setMultiMove({});
    }
    setProdAddedCusts([]); setProdAddOpen(false);
    setSelectedDistCust(null); setFarmRows([]);
    if (!keepCust) { setTab2CustKey(null); setTab2Items([]); setDailyQtyInputs({}); setPivotRows([]); }
    if (!week || !selectedOrderYear) return;
    const requestedCountry = farmCountry;
    setProductListLoading(true);
    apiGetDistribute({ type: 'products', week, prodGroup: farmCountry ? `${farmCountry}${PG_SEP}` : '' }).then(prodRes => {
      if (request !== searchRequestRef.current || week !== currentWeekRef.current || requestedCountry !== currentFarmCountryRef.current) return;
      if (!prodRes?.success) throw new Error('품목 조회 결과를 확인하지 못했습니다.'); setProducts(sortDistributionProducts(prodRes.products || []));
    }).catch(error => { if (request === searchRequestRef.current) setErr(error.message); }).finally(() => { if (request === searchRequestRef.current) setProductListLoading(false); });
  }, [week, farmCountry]);

  const extraHasDrafts = () => extraPeers.some(p => hasDistributionDrafts([], {}, p.items, p.inputs));
  const confirmDraftDiscard = () => !saving && confirmDateDraftDiscard() && ((!hasDistributionDrafts(custDist, outInputs, custItems, custEditInputs) &&
    !hasDistributionDrafts([], {}, pairItems, pairEditInputs) && !extraHasDrafts()) ||
    window.confirm('저장하지 않은 출고수량 또는 단가 변경이 있습니다. 선택을 바꾸면 입력값이 사라집니다. 계속하시겠습니까?'));
  const hasQuantityDraft = () => hasDistributionDrafts(custDist, outInputs, custItems, custEditInputs) ||
    hasDistributionDrafts([], {}, pairItems, pairEditInputs) || extraHasDrafts();
  const hasAnyDraft = () => hasDateDrafts || hasQuantityDraft();

  const discardDrafts = () => {
    if (saving || !hasAnyDraft()) return;
    if (!window.confirm('화면에서 바꾼 출고수량·단가·이동 내용을 모두 취소할까요? (저장된 DB 값은 그대로)')) return;
    const inputs = {};
    custDist.forEach(c => { inputs[c.CustKey] = c.출고수량 || 0; });
    setDateDrafts({}); setOutInputs(inputs);
    setCustEditInputs({}); setPairEditInputs({}); setMoveQtyInputs({});
    setCustItems(prev => prev.filter(item => !item.pendingOrder));
    setPairItems(prev => prev.filter(item => !item.pendingOrder));
    setExtraPeers(prev => prev.map(p => ({ ...p, items: p.items.filter(item => !item.pendingOrder), inputs: {} })));
  };

  const handleClose = () => {
    if (!confirmDraftDiscard()) return;
    if (window.opener && !window.opener.closed) { window.close(); return; }
    if (window.history.length > 1) { window.history.back(); return; }
    window.location.href = '/';
  };

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
    props: {
      ...weekInput.props,
      onChange: event => { if (confirmDraftDiscard()) weekInput.props.onChange(event); },
    },
    setValue: value => { if (value !== week && confirmDraftDiscard()) weekInput.setValue(value); },
    prev: () => { if (confirmDraftDiscard()) weekInput.prev(); },
    next: () => { if (confirmDraftDiscard()) weekInput.next(); },
    prevWeek: () => { if (confirmDraftDiscard()) weekInput.prevWeek(); },
    nextWeek: () => { if (confirmDraftDiscard()) weekInput.nextWeek(); },
  };

  const loadShipDayConfigs = useCallback(async () => {
    setShipDayLoading(true);
    try {
      const d = await apiGet('/api/shipment/ship-days', {});
      const map = {};
      (d.configs || []).forEach(c => { map[`${c.ProdGroup}|${c.WeekSuffix}`] = c.ShipDays; });
      setShipDayConfigs(map);
    } catch (e) { setErr(e.message); } finally { setShipDayLoading(false); }
  }, []);

  useEffect(() => { loadShipDayConfigs(); }, [loadShipDayConfigs]);

  const loadProdGroups = useCallback(async (wk) => {
    setProdGroupsLoading(true);
    try {
      const d = await apiGetDistribute({ type: 'groups', ...(wk ? { week: wk } : {}) });
      return d.groups || [];
    } catch {
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
      setProdGroup(prev => prev && groups.some(g => g.key === prev || (prev.endsWith(PG_SEP) && g.country === prev.slice(0, -2))) ? prev : '');
      setFarmCountry(prev => groups.some(g => g.country === prev) ? prev : '');
      setFarmFamily(prev => groups.some(g => g.key === prev) ? prev : '');
    })();
    return () => { cancelled = true; };
  }, [week, loadProdGroups]);

  useEffect(() => {
    if (countryFavorite === undefined || groupChosenRef.current || farmCountry || favoriteGroups.length === 0) return;
    const first = favoriteGroups.find(fav => prodGroups.some(g => g.key === fav.groupKey && (countryFavorite === null || countryFavorite.countries.includes(g.country))));
    if (first) { const country = first.groupKey.split(PG_SEP)[0]; setFarmCountry(country); setProdGroup(`${country}${PG_SEP}`); }
  }, [favoriteGroups, prodGroups, farmCountry, countryFavorite]);

  const countryGroups = countryFavorite === undefined && !showAllProdGroups ? [] : distributionCountryGroups(prodGroups).filter(g => showAllProdGroups || selectedCountries.includes(g.country)).sort((a, b) => Number(selectedCountries.includes(b.country)) - Number(selectedCountries.includes(a.country)) || a.country.localeCompare(b.country, 'ko'));
  useEffect(() => { if (tab === 0) ensureProductCatalog(); }, [tab]);
  const selectedProdGroupLabel = prodGroups.find(g => g.key === prodGroup)?.label || prodGroup.replace(PG_SEP, '');

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

  const toggleShipDay = (prodGroupKey, suffix, day) => {
    const key = `${prodGroupKey}|${suffix}`;
    const current = (shipDayConfigs[key] || '').split(',').filter(Boolean);
    const idx = current.indexOf(day);
    if (idx >= 0) current.splice(idx, 1);
    else current.push(day);
    current.sort((a, b) => DAY_NAMES.indexOf(a) - DAY_NAMES.indexOf(b));
    setShipDayConfigs(prev => ({ ...prev, [key]: current.join(',') }));
  };

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
        const d = await apiGetDistribute({ type: 'custWeekGrid', week, custKey: ck, countryFlower: cf });
        items = (d.rows || []).map(mapCustWeekGridRow);
        usesExe = items.length > 0;
      }
      if (!usesExe) {
        const d = await apiGetDistribute({ type: 'custItems', week, custKey: ck });
        items = d.items || [];
      }
      if (request !== tab2RequestRef.current || requestedWeek !== currentWeekRef.current) return;
      items = sortDistributionProducts(usesExe ? items : items.filter(item => distributionSelectionMatches(item, prodGroup)));
      setTab2UsesExeGrid(usesExe);
      setTab2Items(items);
      setDailyQtyInputs(Object.fromEntries(items.filter(item => item._exeWeekGrid).map(item => [`${ck}|${item.ProdKey}`, { ...item._dayByKr }])));
    } catch (e) { if (request === tab2RequestRef.current) setErr(e.message); }
    finally { if (request === tab2RequestRef.current) setTab2Loading(false); }
  };

  const handleExcelDownload = async (singleCustKey) => {
    if (!week) { setErr('차수를 입력하세요.'); return; }
    setExcelDownloading(true); setErr('');
    try {
      const params = new URLSearchParams({ week });
      if (singleCustKey) params.set('custKey', singleCustKey);
      params.set('shipDayConfigs', JSON.stringify(shipDayConfigs));
      params.set('dailyQtyInputs', JSON.stringify(dailyQtyInputs));
      params.set('prodDayOverrides', JSON.stringify(prodDayOverrides));

      const res = await fetch(`/api/shipment/excel-download?${params.toString()}`);
      if (!res.ok) { const e = await res.json(); throw new Error(e.error || '다운로드 실패'); }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = res.headers.get('Content-Disposition')?.split('filename=')[1]?.replace(/"/g, '') || `출고_${week}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
      setSuccessMsg('✅ 엑셀 다운로드 완료');
      setTimeout(() => setSuccessMsg(''), 3000);
    } catch (e) { setErr(e.message); } finally { setExcelDownloading(false); }
  };

  const handleSpDistribute = async (action) => {
    if (prodGroup.endsWith(PG_SEP)) { setErr('국가 전체 조회에서는 실행할 수 없습니다. 먼저 품종을 선택하세요.'); return; }
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
          distributionType: distMode === 'prior' ? 2 : 1,
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

  const handleClearOne = async () => {
    if (prodGroup.endsWith(PG_SEP)) { setErr('국가 전체 조회에서는 실행할 수 없습니다. 먼저 품종을 선택하세요.'); return; }
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
        endDate: new Date().toISOString().slice(0, 10),
        search: week,
      });
      setHistoryData(d.history || []);
      setShowHistory(true);
    } catch (e) { setErr(e.message); }
  };

  const handleSearch = async () => {
    if (!week) { setErr('차수를 입력하세요.'); return; }
    if (!confirmDraftDiscard()) return;
    const request = ++searchRequestRef.current;
    const requestedWeek = week;
    const requestedGroup = prodGroup;
    loadDateIndex();
    productRequestRef.current += 1;
    customerRequestRef.current += 1;
    setLoading(true); setErr('');
    const cf = countryFlowerFromGroup(prodGroup, prodGroups);

    try {
      const [prodRes, custRes] = await Promise.all([
        apiGetDistribute({
          type: 'products',
          week,
          prodGroup:farmCountry?`${farmCountry}${PG_SEP}`:'',
        }),
        loadWorkspaceCustomers(),
      ]);
      if (request !== searchRequestRef.current || requestedWeek !== currentWeekRef.current || requestedGroup !== currentGroupRef.current) return;
      if (prodRes?.success !== true || custRes?.success !== true) throw new Error('분배 조회 결과를 확인하지 못했습니다.');
      const nextProducts = sortDistributionProducts(prodRes.products || []);
      setProducts(nextProducts);
      const customers = sortDistributionCustomers(custRes.customers || []);
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
    if (tab === 3) loadPivotRows();
  }, [tab, loadPivotRows]);

  const selectProd = async (prod, { skipDraftCheck = false } = {}) => {
    if ((saving || loading) && !skipDraftCheck) return;
    if (!week || !mergeDistributionSearchCandidates(products, productCatalog).some(p => Number(p.ProdKey) === Number(prod?.ProdKey))) return;
    if (!skipDraftCheck && !confirmFarmDraftDiscard()) return;
    const request = ++productRequestRef.current;
    const requestedWeek = week;
    setSelectedProd(prod);
    if (prod.CounName && prod.FlowerName) setProdGroup(`${prod.CounName}${PG_SEP}${prod.FlowerName}`);
    setSelectedDistCust(null);
    setFarmRows([]);
    setOutInputs({}); setCustDist([]);
    setInQty(prod.inQty || 0);
    setOutQty(prod.outQty || 0);
    setDistLoading(true);
    try {
      const d = await apiGetDistribute({ type: 'custDist', week, prodKey: prod.ProdKey });
      if (request !== productRequestRef.current || requestedWeek !== currentWeekRef.current) return;
      if (d?.success !== true) throw new Error('거래처 분배 조회 결과를 확인하지 못했습니다.');
      setCustDist(sortDistributionCustomers(d.customers || []));
      const inputs = {};
      (d.customers || []).forEach(c => { inputs[c.CustKey] = c.출고수량 || 0; });
      setOutInputs(inputs);
      setInQty(prod.inQty || 0);
      setOutQty(d.totalOut || 0);
    } catch (e) { if (request === productRequestRef.current) setErr(e.message); }
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

  const selectCust = async (cust, { skipDraftCheck = false } = {}) => {
    if ((saving || loading) && !skipDraftCheck) return;
    if (!week || !inCustomerPool(cust)) return;
    if ([pairCust, ...extraPeers.map(p => p.cust)].some(c => Number(c?.CustKey) === Number(cust.CustKey))) { setErr('이미 다른 열에서 선택한 업체입니다.'); return; }
    if (!skipDraftCheck && !confirmCustomerDraftDiscard()) return;
    const request = ++customerRequestRef.current;
    const requestedWeek = week;
    setSelectedCust(cust); setPairSlot(1); setCustomerReadError('');
    setCustItems([]); setCustEditInputs({});
    setCustLoading(true);
    try {
      const d = await apiGetDistribute({ type: 'custItems', week, custKey: cust.CustKey });
      if (request !== customerRequestRef.current || requestedWeek !== currentWeekRef.current) return;
      if (d?.success !== true) throw new Error('업체 품목 조회 결과를 확인하지 못했습니다.');
      const items = sortDistributionProducts(d.items || []);
      setCustItems(items);
      const inputs = {};
      items.forEach(item => { inputs[item.ProdKey] = { outQty: item.출고수량 || 0, cost: item.Cost || 0 }; });
      setCustEditInputs(inputs);
    } catch (e) { if (request === customerRequestRef.current) { setErr(e.message); setCustomerReadError(e.message); } }
    finally { if (request === customerRequestRef.current) setCustLoading(false); }
  };

  const selectPairCust = async (cust, { skipDraftCheck = false } = {}) => {
    if ((saving || loading) && !skipDraftCheck) return;
    if (!week || !inCustomerPool(cust)) return;
    if (extraPeers.some(p => Number(p.cust.CustKey) === Number(cust.CustKey))) { setErr('이미 다른 열에서 선택한 업체입니다.'); return; }
    if (Number(cust.CustKey) === Number(selectedCust?.CustKey)) { setErr('업체 1과 같은 업체는 업체 2로 선택할 수 없습니다.'); return; }
    if (!skipDraftCheck && hasDistributionDrafts([], {}, pairItems, pairEditInputs) &&
      !window.confirm('업체 2의 저장하지 않은 변경이 있습니다. 업체를 바꾸면 입력값이 사라집니다. 계속하시겠습니까?')) return;
    const request = ++pairRequestRef.current;
    const requestedWeek = week;
    setPairCust(cust); setPairReadError('');
    setPairItems([]); setPairEditInputs({}); setMoveQtyInputs({}); setPairGroupFilter('');
    setPairLoading(true);
    try {
      const d = await apiGetDistribute({ type: 'custItems', week, custKey: cust.CustKey });
      if (request !== pairRequestRef.current || requestedWeek !== currentWeekRef.current) return;
      if (d?.success !== true) throw new Error('업체 2 품목 조회 결과를 확인하지 못했습니다.');
      const items = sortDistributionProducts(d.items || []);
      setPairItems(items);
      const inputs = {};
      items.forEach(item => { inputs[item.ProdKey] = { outQty: item.출고수량 || 0, cost: item.Cost || 0 }; });
      setPairEditInputs(inputs);
    } catch (e) { if (request === pairRequestRef.current) { setErr(e.message); setPairReadError(e.message); } }
    finally { if (request === pairRequestRef.current) setPairLoading(false); }
  };

  const clearPairCust = () => {
    if (hasDistributionDrafts([], {}, pairItems, pairEditInputs) &&
      !window.confirm('업체 2의 저장하지 않은 변경이 있습니다. 해제하면 입력값이 사라집니다. 계속하시겠습니까?')) return;
    if (pairLoading || extraLoading) return;
    pairRequestRef.current += 1;
    const next = extraPeers[0];
    if (next) { peerReads.current.cancel(week, next.cust.CustKey); setPairCust(next.cust); setPairItems(next.items); setPairEditInputs(next.inputs); setExtraPeers(prev => prev.slice(1)); }
    else { setPairCust(null); setPairItems([]); setPairEditInputs({}); }
    setPairReadError(next?.error || ''); setPairSlot(1); setMoveQtyInputs({}); setPairGroupFilter(''); setMultiMove({});
  };

  const updateExtra = (index, key, next) => setExtraPeers(prev => prev.map((p, i) => i === index ? { ...p, [key]: typeof next === 'function' ? next(p[key]) : next } : p));
  const selectExtraCust = async (cust, slot, { skipDraftCheck = false } = {}) => {
    if ((saving || loading) && !skipDraftCheck) return false;
    if (!week || !pairCust || !Number.isInteger(slot) || slot < 3 || (!inCustomerPool(cust) && !(skipDraftCheck && extraPeers.some(p => Number(p.cust.CustKey) === Number(cust?.CustKey))))) return false;
    const index = Math.min(slot - 3, extraPeers.length);
    const taken = [selectedCust, pairCust, ...extraPeers.filter((_, i) => i !== index).map(p => p.cust)];
    if (taken.some(c => Number(c?.CustKey) === Number(cust.CustKey))) { setErr('이미 다른 칸에 선택된 업체입니다.'); return false; }
    const prev = extraPeers[index];
    if (!skipDraftCheck && prev && Number(prev.cust.CustKey) !== Number(cust.CustKey) && hasDistributionDrafts([], {}, prev.items, prev.inputs) && !window.confirm(`업체 ${index + 3}의 저장하지 않은 변경이 있습니다. 업체를 바꾸시겠습니까?`)) return false;
    if (prev) peerReads.current.cancel(week, prev.cust.CustKey);
    let token; try { token = peerReads.current.start(week, cust.CustKey); } catch (e) { setErr(e.message); return false; }
    setExtraPeers(list => { const next = [...list]; next[index] = { cust, items: [], inputs: {}, loading: true, error: '' }; return next; });
    try {
      const d = await apiGetDistribute({ type: 'custItems', week, custKey: cust.CustKey });
      if (!peerReads.current.current(token, currentWeekRef.current)) return false;
      if (d?.success !== true) throw Error(`업체 ${index + 3} 품목 조회 결과를 확인하지 못했습니다.`);
      const items = sortDistributionProducts(d.items || []), inputs = {};
      items.forEach(item => { inputs[item.ProdKey] = { outQty: item.출고수량 || 0, cost: item.Cost || 0 }; });
      setExtraPeers(list => list.map(p => Number(p.cust.CustKey) === Number(cust.CustKey) ? { cust, items, inputs, loading: false, error: '' } : p)); return true;
    } catch (e) { if (peerReads.current.current(token, currentWeekRef.current)) { setErr(e.message); setExtraPeers(list => list.map(p => Number(p.cust.CustKey) === Number(cust.CustKey) ? { ...p, loading: false, error: e.message } : p)); } return false; }
  };

  const clearExtraCust = (index) => {
    const peer = extraPeers[index];
    if (!peer) return;
    if (hasDistributionDrafts([], {}, peer.items, peer.inputs) &&
      !window.confirm(`업체 ${index + 3}의 저장하지 않은 변경이 있습니다. 해제하면 입력값이 사라집니다. 계속하시겠습니까?`)) return;
    peerReads.current.cancel(week, peer.cust.CustKey);
    setExtraPeers(prev => prev.filter((_, i) => i !== index));
    setMultiMove({}); setPairSlot(1);
  };

  const chooseCustomerSlot = cust => {
    if (appendCompany) {
      if ([selectedCust, pairCust, ...extraPeers.map(p => p.cust)].some(c => Number(c?.CustKey) === Number(cust.CustKey))) return;
      if (!selectedCust) return selectCust(cust);
      if (!pairCust) return selectPairCust(cust);
      return selectExtraCust(cust, extraPeers.length + 3);
    }
    return !selectedCust ? selectCust(cust) : pairSlot >= 3 ? selectExtraCust(cust, pairSlot) : pairSlot === 2 ? selectPairCust(cust) : selectCust(cust);
  };

  const pairSides = () => [
    { cust: selectedCust, items: custItems, inputs: custEditInputs, setItems: setCustItems, setInputs: setCustEditInputs },
    { cust: pairCust, items: pairItems, inputs: pairEditInputs, setItems: setPairItems, setInputs: setPairEditInputs },
    ...extraPeers.map((p, i) => ({ cust: p.cust, items: p.items, inputs: p.inputs, loading: p.loading, error: p.error, setItems: next => updateExtra(i, 'items', next), setInputs: next => updateExtra(i, 'inputs', next) })),
  ];

  const moveDistributionQty = (prodKey, fromIndex, toIndex, factor = 1, quantityOverride) => {
    const sides = pairSides();
    if (!sides[fromIndex]?.cust || !sides[toIndex]?.cust || fromIndex === toIndex) return;
    const { items: fromItems, inputs: fromInputs, setInputs: setFromInputs } = sides[fromIndex];
    const { items: toItems, inputs: toInputs, setItems: setToItems, setInputs: setToInputs } = sides[toIndex];
    const source = fromItems.find(item => Number(item.ProdKey) === Number(prodKey));
    if (!source) return;
    const target = toItems.find(item => Number(item.ProdKey) === Number(prodKey));
    const fromQty = fromInputs[prodKey]?.outQty !== undefined ? parseFloat(fromInputs[prodKey].outQty) || 0 : (source.출고수량 || 0);
    const toQty = target ? (toInputs[prodKey]?.outQty !== undefined ? parseFloat(toInputs[prodKey].outQty) || 0 : (target.출고수량 || 0)) : 0;
    const raw = quantityOverride === undefined ? moveQtyInputs[prodKey] : quantityOverride;
    const requested = String(raw ?? '').trim() === '' ? '' : toNativeQty(raw, factor);
    const plan = planDistributionMove({ fromQty, toQty, requested });
    if (plan.moved <= 0) return;
    if (!target) setToItems(prev => [...prev, pendingDistributionItem(source)]);
    setFromInputs(prev => ({ ...prev, [prodKey]: { ...(prev[prodKey] || {}), outQty: plan.fromAfter } }));
    setToInputs(prev => ({ ...prev, [prodKey]: { ...(prev[prodKey] || {}), outQty: plan.toAfter, cost: prev[prodKey]?.cost ?? (target?.Cost ?? source.Cost ?? 0) } }));
    setMoveQtyInputs(prev => ({ ...prev, [prodKey]: '' }));
    return true;
  };

  const registerPendingOrders = async (cust, items, inputs) => {
    const pending = pendingDistributionOrderItems(items, inputs);
    if (!cust || pending.length === 0) return 0;
    const res = await fetch('/api/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ custKey: cust.CustKey, custName: cust.CustName, week, year: selectedOrderYear, source: 'distribute-pair', items: pending }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.success !== true) throw new Error(`${cust.CustName} 주문등록 실패: ${data.error || res.status}`);
    return pending.length;
  };

  const saveWithFixCycleIfNeeded = async ({ prodKeys, label, logName, mode, apply }) => {
    const keys = [...new Set(prodKeys.map(Number).filter(k => Number.isInteger(k) && k > 0))];
    if (keys.length === 0) return apply();
    const d = await apiGetDistribute({ type: 'fixedScopes', week, prodKeys: keys.join(',') });
    if (d?.success !== true) throw new Error(d?.error || '확정 상태를 확인하지 못해 저장하지 않았습니다.');
    const scope = distributionFixCycleScope(d.scopes || []);
    if (!scope.needed) return apply();
    if (scope.blocked.length > 0) throw new Error(`품목군이 없는 확정 품목(ProdKey ${scope.blocked.join(', ')})이 있어 자동 확정해제를 할 수 없습니다. 확정취소 후 다시 저장하세요.`);
    if (!window.confirm(`${week}차 ${scope.countryFlowers.join(', ')} 품목군이 확정되어 있습니다.\n\n${label}\n\n확정해제 → 저장 → 재확정 순서로 진행할까요?`)) {
      throw Object.assign(new Error('확정차수 저장을 취소했습니다.'), { cancelled: true });
    }
    return runEditWithFixCycle({
      weeks: [week],
      orderYear: selectedOrderYear,
      countryFlowers: scope.countryFlowers,
      stockProdKeys: keys,
      cycleSource: 'distribute-save',
      progress: step => appendSaveLog({ mode, name: logName, week, note: step }),
      apply,
    });
  };

  const handleSaveCustItems = async () => {
    if (saveBlocked || saveInFlightRef.current) return;
    if (!selectedCust || !week) { setErr('업체와 차수를 선택하세요.'); return; }
    const pairName = [selectedCust, pairCust, ...extraPeers.map(p => p.cust)].filter(Boolean).map(c => c.CustName).join(' + ');
    if (!hasDistributionDrafts([], {}, custItems, custEditInputs) && !hasDistributionDrafts([], {}, pairItems, pairEditInputs) && !extraHasDrafts()) {
      appendSaveLog({ mode: 'cust', name: pairName, week, skipped: true });
      return;
    }
    saveInFlightRef.current = true;
    const submittedWeek = week;
    const submittedCust = selectedCust;
    const submittedPair = pairCust;
    const submittedExtras = pairCust ? extraPeers : [];
    setSaving(true); setErr('');
    try {
      const toEntries = (cust, items, inputs) => items.flatMap(item => {
        const edit = inputs[item.ProdKey] || {};
        const qty = edit.outQty !== undefined ? parseFloat(edit.outQty) || 0 : (item.출고수량 || 0);
        const cost = edit.cost !== undefined ? parseFloat(edit.cost) || 0 : (item.Cost || 0);
        const changed = item.pendingOrder || qty !== Number(item.출고수량 || 0) || cost !== Number(item.Cost || 0);
        return changed ? [{ custKey: cust.CustKey, prodKey: item.ProdKey, outQty: qty, cost, expected: { outQty: Number(item.출고수량 || 0), cost: Number(item.Cost || 0) } }] : [];
      });
      const dropEmptyPending = (items, inputs) => items.filter(item => !item.pendingOrder || (parseFloat(inputs[item.ProdKey]?.outQty) || 0) > 0);
      const entries = [
        ...toEntries(selectedCust, dropEmptyPending(custItems, custEditInputs), custEditInputs),
        ...(pairCust ? toEntries(pairCust, dropEmptyPending(pairItems, pairEditInputs), pairEditInputs) : []),
        ...submittedExtras.flatMap(p => toEntries(p.cust, dropEmptyPending(p.items, p.inputs), p.inputs)),
      ];
      if (entries.length === 0) { appendSaveLog({ mode: 'cust', name: pairName, week, skipped: true }); return; }
      assertDistributionBatchSize(entries);
      await saveWithFixCycleIfNeeded({
        prodKeys: entries.map(entry => entry.prodKey),
        label: `${pairName} 분배 저장${pendingDistributionOrderItems(custItems, custEditInputs).length + pendingDistributionOrderItems(pairItems, pairEditInputs).length + submittedExtras.reduce((a, p) => a + pendingDistributionOrderItems(p.items, p.inputs).length, 0) > 0 ? ' (주문 없는 품목은 주문등록 포함)' : ''}`,
        logName: pairName, mode: 'cust',
        apply: async () => {
          const count = (await registerPendingOrders(selectedCust, custItems, custEditInputs))
            + (pairCust ? await registerPendingOrders(pairCust, pairItems, pairEditInputs) : 0);
          let extraCount = 0;
          for (const p of submittedExtras) extraCount += await registerPendingOrders(p.cust, p.items, p.inputs);
          const res = await fetch('/api/shipment/distribute', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ week, year: selectedOrderYear, entries, source:"distribution-workspace" })
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok || data.success !== true || data.verified !== true) throw new Error(data.error || '출고분배 저장 검증에 실패했습니다.');
          return count + extraCount;
        },
      });
      if (submittedWeek !== currentWeekRef.current) return;
      const savedItems = entries.filter(entry => entry.outQty > 0);
      const totalQty = savedItems.reduce((a, entry) => a + entry.outQty, 0);
      const custSides = [[submittedCust, custItems, custEditInputs], ...(submittedPair ? [[submittedPair, pairItems, pairEditInputs]] : []),
        ...submittedExtras.map(p => [p.cust, p.items, p.inputs])];
      const perCust = custSides.map(([cust, items, inputs]) => {
        const mine = entries.filter(entry => Number(entry.custKey) === Number(cust.CustKey));
        const saved = mine.filter(entry => entry.outQty > 0);
        return { cust, changed: mine.length, savedCount: saved.length, totalQty: saved.reduce((a, entry) => a + entry.outQty, 0), orderCount: pendingDistributionOrderItems(items, inputs).length };
      }).filter(x => x.changed > 0);
      setSaveModal({ prodName: perCust.map(x => `${x.cust.CustName} ${x.changed}건`).join(' / '), week, savedCount: savedItems.length, totalQty });
      perCust.forEach(x => appendSaveLog({ mode: 'cust', name: x.cust.CustName, week: submittedWeek, savedCount: x.savedCount, totalQty: x.totalQty, orderCount: x.orderCount }));
      if (Number(submittedCust.CustKey) === Number(selectedCust?.CustKey)) selectCust(submittedCust, { skipDraftCheck: true });
      if (submittedPair && Number(submittedPair.CustKey) === Number(pairCust?.CustKey)) selectPairCust(submittedPair, { skipDraftCheck: true });
      submittedExtras.forEach((p, i) => selectExtraCust(p.cust, i + 3, { skipDraftCheck: true }));
    } catch (e) {
      setErr(e.applyCommitted ? `분배 수량은 저장됐지만 재확정에 실패했습니다. ${e.message}` : e.message);
      appendSaveLog({ mode: 'cust', name: pairName, week: submittedWeek, ...(e.applyCommitted ? { note: `분배 저장 완료 · 재확정 실패: ${e.message}` } : { error: e.message }) });
    } finally { saveInFlightRef.current = false; setSaving(false); }
  };

  const autoDistribute = () => {
    if (saving || loading) return;
    if (!selectedProd || custDist.length === 0) {
      setErr('품목을 선택하고 조회된 거래처 분배 정보가 있어야 자동 계산할 수 있습니다.');
      return;
    }
    const { emptyOrder, inputs: newInputs } = calculateAutoDistributeInputs(custDist, selectedProd.inQty || 0, distMode);
    if (emptyOrder) { alert('주문 수량이 없습니다.'); return; }
    setOutInputs(newInputs);
    setOutQty(Object.values(newInputs).reduce((a, b) => a + b, 0));
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
    setOutQty(Object.values(nextInputs).reduce((a, b) => a + (b || 0), 0));
    setErr('');
    setSuccessMsg('주문수량 기준으로 출고수량 입력값을 채웠습니다. 실제 DB 저장은 상단 저장 버튼을 눌러야 적용됩니다.');
    setTimeout(() => setSuccessMsg(''), 3000);
  };

  const handleSave = async () => {
    if (saveBlocked || saveInFlightRef.current) return;
    if (!selectedProd || !week) { setErr('품목과 차수를 선택하세요.'); return; }
    if (!hasDistributionDrafts(custDistRows, outInputs)) {
      appendSaveLog({ mode: 'prod', name: selectedProd.ProdName, week, skipped: true });
      return;
    }
    saveInFlightRef.current = true;
    const submittedWeek = week;
    const submittedProd = selectedProd;
    setSaving(true); setErr('');
    try {
      const rows = custDistRows.filter(c => c.addedNoOrder
        ? (Number(outInputs[c.CustKey]) || 0) > 0
        : (Number(outInputs[c.CustKey]) || 0) !== Number(c.출고수량 || 0));
      const newOrders = rows.filter(c => c.addedNoOrder);
      const entries = rows.map(c => ({
        custKey: c.CustKey,
        prodKey: selectedProd.ProdKey,
        outQty: Number(outInputs[c.CustKey]) || 0,
        cost: Number(c.Cost ?? c.단가 ?? selectedProd.Cost ?? 0),
        expected: { outQty: Number(c.출고수량 || 0), cost: Number(c.Cost ?? c.단가 ?? selectedProd.Cost ?? 0) },
      }));
      await saveWithFixCycleIfNeeded({
        prodKeys: [selectedProd.ProdKey],
        label: `${selectedProd.ProdName} 분배 저장`,
        logName: selectedProd.ProdName, mode: 'prod',
        apply: async () => {
          for (const c of newOrders) {
            const orderRes = await fetch('/api/orders', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                custKey: c.CustKey, custName: c.CustName, week, year: selectedOrderYear, source: 'distribute-product-add',
                items: [{ prodKey: Number(selectedProd.ProdKey), qty: Number(outInputs[c.CustKey]) || 0, unit: selectedProd.OutUnit || '박스' }],
              }),
            });
            const orderData = await orderRes.json().catch(() => ({}));
            if (!orderRes.ok || orderData.success !== true) throw new Error(`${c.CustName} 주문등록 실패: ${orderData.error || orderRes.status}`);
          }
          const res = await fetch('/api/shipment/distribute', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ week, year: selectedOrderYear, entries, source:"distribution-workspace" })
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok || data.success !== true || data.verified !== true) throw new Error(data.error || '출고분배 저장 검증에 실패했습니다.');
        },
      });
      if (submittedWeek !== currentWeekRef.current) return;
      const savedCount = rows.length;
      const totalSaved = Object.values(outInputs).reduce((a, b) => a + (b || 0), 0);
      setSaveModal({ prodName: selectedProd.ProdName, week, savedCount, totalQty: totalSaved });
      appendSaveLog({ mode: 'prod', name: submittedProd.ProdName, week: submittedWeek, savedCount, totalQty: totalSaved, orderCount: newOrders.length });
      if (Number(submittedProd.ProdKey) === Number(selectedProd?.ProdKey)) selectProd(submittedProd, { skipDraftCheck: true });
    } catch (e) {
      setErr(e.applyCommitted ? `분배 수량은 저장됐지만 재확정에 실패했습니다. ${e.message}` : e.message);
      appendSaveLog({ mode: 'prod', name: submittedProd.ProdName, week: submittedWeek, ...(e.applyCommitted ? { note: `분배 저장 완료 · 재확정 실패: ${e.message}` } : { error: e.message }) });
    } finally { saveInFlightRef.current = false; setSaving(false); }
  };

  const custDistRows = selectedProd ? [...custDist, ...prodAddedCusts
    .filter(a => !custDist.some(c => Number(c.CustKey) === Number(a.CustKey)))
    .map(a => ({ CustKey: a.CustKey, CustName: a.CustName, 주문코드: a.OrderCode || '', 주문수량: 0, 출고수량: 0, Cost: selectedProd.Cost || 0, addedNoOrder: true }))].filter(c => c.addedNoOrder || dateLookup.matches(farmDate, selectedProd.ProdKey, c.CustKey)) : custDist;
  const visibleFarmCustomerRows = farmCustomerSearch.trim()
    ? custDistRows.filter(c => c.addedNoOrder || customerMatchesSearch(c, farmCustomerSearch.trim()))
    : custDistRows;
  const favoriteKeys = new Set(favoriteProducts.map(row => row.prodKey));
  const filteredProds = favoriteDistributionRows(sortDistributionProducts(distributionAddProductCandidates(products, productCatalog), prodFilter)
    .filter(p => String(prodFilter || '').trim() || !farmCountry || p.CounName === farmCountry)
    .filter(p => String(prodFilter || '').trim() || distributionFamilyMatches(p, farmFamily))
    .filter(p => !favoritesOnly || favoriteKeys.has(Number(p.ProdKey)))
    .filter(p => dateLookup.matches(farmDate, p.ProdKey)), favoriteKeys);
  const filteredCustomers = sortDistributionCustomers(customerPool, custFilter).filter(c => dateLookup.matches(customerDate, null, c.CustKey));
  const totalOutInput = Object.values(outInputs).reduce((a, b) => a + b, 0);
  const remain = (inQty||0) - totalOutInput;
  const selectedFlower = prodGroups.find(group => group.key === prodGroup)?.flower || '';
  const previousStock = distributePreviousStock(selectedProd);

  const tabs = ['출고분배 및 농장정보', '출고분배 및 업체정보', '출고일 지정', '출고 분배 집계'];
  const fixedScopeKeys = [...new Set([selectedProd?.ProdKey, ...custItems.map(i => i.ProdKey), ...pairItems.map(i => i.ProdKey), ...extraPeers.flatMap(p => p.items.map(i => i.ProdKey))]
    .map(Number).filter(k => Number.isInteger(k) && k > 0))].sort((a, b) => a - b).slice(0, 500).join(',');
  useEffect(() => {
    if (!week || !fixedScopeKeys) { setFixedScopeMap({}); return undefined; }
    let cancelled = false;
    apiGetDistribute({ type: 'fixedScopes', week, prodKeys: fixedScopeKeys, purpose: 'badge' }).then(d => {
      if (cancelled || d?.success !== true) return;
      setFixedScopeMap(Object.fromEntries((d.scopes || []).map(x => [Number(x.prodKey), { fixed: !!x.fixed, countryFlower: x.countryFlower || '' }])));
    }).catch(() => { if (!cancelled) setFixedScopeMap({}); });
    return () => { cancelled = true; };
  }, [week, fixedScopeKeys, saving, selectedCust?.CustKey, pairCust?.CustKey, extraPeers.map(p => p.cust.CustKey).join(',')]);
  const fixedBadge = (prodKey) => fixedScopeMap[Number(prodKey)]?.fixed
    ? <span data-ai-verify={`fixed-${prodKey}`} title={`${fixedScopeMap[Number(prodKey)].countryFlower} 품목군이 이 차수에 확정됨 — 저장 시 확정해제→저장→재확정`}
        style={{ display: 'inline-block', padding: '0 5px', marginRight: 4, borderRadius: 4, fontSize: 10, fontWeight: 700, background: '#FEE2E2', color: '#B91C1C' }}>🔒확정</span>
    : null;
  const ensureProductCatalog = () => {
    if (productCatalog || productCatalogLoadingRef.current) return;
    productCatalogLoadingRef.current = true;
    apiGetDistribute({ type: 'productCatalog' })
      .then(res => { if (res?.success === true) setProductCatalog(res.products || []); })
      .catch(() => { setErr('전체 품목 검색 목록을 불러오지 못했습니다. 검색창을 다시 선택해 주세요.'); })
      .finally(() => { productCatalogLoadingRef.current = false; });
  };
  const pairRows = mergeDistributionCustomerItems(custItems, pairItems, extraPeers.map(p => p.items));
  const searchCandidates = mergeDistributionSearchCandidates(products, productCatalog);
  const pairSearchRows = String(custItemFilter || '').trim()
    ? [...pairRows, ...sortDistributionProducts(searchCandidates.filter(p => matchDistributeItemName(p, custItemFilter) && !pairRows.some(r => Number(r.ProdKey) === Number(p.ProdKey))))
      .map(p => ({ ...p, extra: [], searchOnly: true }))]
    : pairRows;
  const custSearchRows = favoriteDistributionRows(distributionCustomerSearchRows(custItems, searchCandidates, custItemFilter, matchDistributeItemName)
    .filter(row => distributionPairFilterMatches(row, pairGroupFilter))
    .filter(row => dateLookup.matches(customerDate, row.ProdKey, selectedCust?.CustKey)), favoriteKeys);
  const addCustSearchItem = (prod, outQty) => {
    setCustItems(prev => prev.some(i => Number(i.ProdKey) === Number(prod.ProdKey)) ? prev : [...prev, pendingDistributionItem(prod)]);
    setCustEditInputs(prev => ({ ...prev, [prod.ProdKey]: { ...(prev[prod.ProdKey] || {}), outQty, cost: prev[prod.ProdKey]?.cost ?? (prod.Cost ?? 0) } }));
  };
  const fixedCount = (items) => items.filter(i => fixedScopeMap[Number(i.ProdKey)]?.fixed).length;

  const weekButtons = distributionWeekButtons(week, 3);
  const subWeekButtons = distributionSubWeekButtons(week);

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
      if (dateEditor) { if (event.ctrlKey && event.key.toLowerCase() === 's') event.preventDefault(); return; }
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
        if (event.key === '3' && requestTab(1)) setTimeout(() => dealerSearchRef.current?.focus(), 0);
        if (event.key === '4') document.querySelector('[data-distribute-qty="true"]')?.focus();
      } else if (event.ctrlKey && event.key === 'Enter') {
        event.preventDefault();
        handleSearch();
      }
    };
    window.addEventListener('keydown', onShortcut);
    return () => window.removeEventListener('keydown', onShortcut);
  });

  const requestTab = index => {
    if (index === tab) return true;
    if (hasAnyDraft()) { setErr('수량·단가·출고일 변경을 먼저 저장하거나 변경 취소한 후 탭을 이동하세요.'); return false; }
    setErr(''); setTab(index);
    if (index === 0 && selectedProd) selectProd(selectedProd, { skipDraftCheck: true });
    if (index === 1) { if (selectedCust) selectCust(selectedCust, { skipDraftCheck: true }); if (pairCust) selectPairCust(pairCust, { skipDraftCheck: true }); void (async () => { for (let i = 0; i < extraPeers.length; i++) await selectExtraCust(extraPeers[i].cust, i + 3, { skipDraftCheck: true }); })(); }
    return true;
  };

  const openDateEditor = (custKey, prod, label, inlineDraft = null) => {
    if (hasQuantityDraft()) { setErr('수량·단가 변경을 먼저 저장하거나 초기화한 후 출고일을 수정하세요.'); return; }
    setDateEditor({ scope: { orderYear: selectedOrderYear, orderWeek: week.slice(-5), custKey: Number(custKey), prodKey: Number(prod.ProdKey) }, label, inlineDraft, draftKey: `${custKey}|${prod.ProdKey}` });
  };
  const dateHeader = <DistributionInlineDatesHeader calendar={inlineCalendar} year={selectedOrderYear} week={week} />;
  const dateButton = (custKey, prod, label) => viewMode === 'cust' && !showCustomerDates ? null : <DistributionInlineDates commonWeeks={majorWeekScope.weeks} commonError={majorWeekScope.error} productInfo={prod} majorFacts={majorInlineFactsMap?.get(String(custKey) + '|' + String(prod.ProdKey)) ?? (majorInlineFactsMap ? [] : null)} calendar={inlineCalendar} facts={inlineFactsMap.get(`${custKey}|${prod.ProdKey}`) || []} year={selectedOrderYear} week={week}
    custKey={custKey} prodKey={prod.ProdKey} draft={dateDrafts[`${custKey}|${prod.ProdKey}`]} loading={dateIndexLoading} error={dateIndexError}
    disabled={saving || loading || hasQuantityDraft() || !!dateEditor} onDraft={draft => setDateDrafts(prev => { const next = { ...prev }, key = `${custKey}|${prod.ProdKey}`; if (draft) next[key] = draft; else delete next[key]; return next; })}
    onOpen={draft => openDateEditor(custKey, prod, label, draft)} />;

  return (
    <div ref={workspaceRef} data-testid="distribution-workspace" style={{ height: tab < 2 ? 'var(--distribution-available-height,var(--nv-page-inner-h,calc(100dvh - 104px)))' : undefined, overflow: tab < 2 ? 'hidden' : undefined, display: 'flex', flexDirection: 'column', minHeight: tab < 2 ? 0 : 'var(--nv-page-inner-h,calc(100vh - 104px))', minWidth: 0 }}>
      {dateEditor && <DistributionDateEditor {...dateEditor} onClose={() => setDateEditor(null)} onSaved={async () => {
        setDateDrafts(prev => { const next = { ...prev }; delete next[dateEditor.draftKey]; return next; });
        setSuccessMsg('출고일 분배 저장 완료 · 출고 총량·매출·확정 상태 유지');
        await loadDateIndex();
        if (tab === 2 && tab2CustKey) await loadTab2Items(tab2CustKey);
        else if (tab === 0 && selectedProd) await selectProd(selectedProd, { skipDraftCheck: true });
        else if (tab === 1 && selectedCust) await selectCust(selectedCust, { skipDraftCheck: true });
      }} />}
      <WorkflowGuide workflowId="shipment-distribution-dates" />
      <style jsx global>{`[data-testid=distribution-workspace] .tbl th,[data-testid=distribution-workspace] .tbl td { padding-left:4px;padding-right:4px; }
      .page-area:has([data-testid=distribution-workspace]) {padding:3px !important;}
      [data-ui-shell=popup] > div:has(> [data-testid=distribution-workspace]) {padding:3px !important;}
      .distribution-customer-table th:nth-child(1){width:150px}.distribution-customer-table th:nth-child(2){width:64px}.distribution-customer-table th:nth-child(3){width:40px}
      .distribution-customer-table th:nth-child(n+4):nth-child(-n+10){width:52px}
      .distribution-customer-table > thead > tr > th,.distribution-customer-table > tbody > tr > td{padding:2px !important;}
      .distribution-customer-table > tbody > tr > td:nth-child(n+4):nth-child(-n+10) input{width:50px !important;padding:0 2px !important;}
      .distribution-left-column,.distribution-detail-column{display:flex;flex-direction:column;height:100%;min-height:0;overflow:hidden;}
      .distribution-left-column> :not(.distribution-navigation-scroll),.distribution-detail-column> :not(.distribution-data-scroll):not(.distribution-detail-column){flex-shrink:0;}
      .distribution-navigation-scroll{flex:1;min-height:0;overflow:auto;overscroll-behavior:contain;}
      .distribution-data-scroll{flex:1;min-height:0;min-width:0;overflow:auto;overscroll-behavior:contain;scrollbar-gutter:stable;}
      .distribution-left-column [data-testid=distribution-pair-slots]{max-height:120px;overflow:auto;}
      .distribution-table-context{position:sticky;top:0;left:0;max-height:140px;overflow:auto;z-index:8;background:var(--surface);}
      .distribution-data-scroll > table > thead{position:sticky;top:var(--distribution-context-height,0px);z-index:7;background:var(--surface);}
      .distribution-with-kakao{display:grid;grid-template-columns:minmax(0,1fr) 300px;align-items:stretch;gap:4px;height:100%;min-height:0;overflow:hidden;}
      .distribution-customer-controls{display:flex;gap:10px;align-items:center;flex-wrap:wrap;padding:4px 5px;background:var(--surface);border-bottom:1px solid var(--border);font-size:12px;}
      .distribution-matrix-product{width:160px;min-width:130px;max-width:180px;position:sticky;left:0;z-index:2;background:var(--surface);white-space:normal!important;}
      .distribution-product-label{display:inline-block;max-width:180px;overflow-wrap:anywhere;}
      .distribution-kakao-feed{height:100%;max-height:100%!important;padding:6px;border-left:1px solid var(--border);min-width:0;background:var(--surface)}
      @media(min-width:901px) and (max-width:1400px){.distribution-with-kakao{grid-template-columns:minmax(0,1fr) 250px}}
      @media (max-width: 900px) { [data-testid=distribution-workspace]{height:auto!important;overflow:visible!important}.distribution-workspace-grid { grid-template-columns:minmax(0,1fr)!important;overflow:visible!important;grid-template-rows:auto!important}.distribution-left-column{height:auto;max-height:45vh}.distribution-with-kakao{height:auto;overflow:visible;grid-template-columns:minmax(0,1fr)}.distribution-detail-column{height:auto;overflow:visible}.distribution-data-scroll{max-height:65vh;flex:auto}.distribution-kakao-feed{border-top:1px solid var(--border)} }`}</style>
      <div data-testid="distribution-sticky-header" style={{ flexShrink: 0, position: 'sticky', top: 0, zIndex: 40, background: 'var(--surface)', boxShadow: '0 2px 4px #0002' }}>
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '8px 8px 0 0', padding: '4px 5px', display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', flexShrink: 0 }}>
          <WeekInput weekInput={guardedWeekInput} label="차수" />
          <DistributionPicker label="차수" value={week} triggerRef={weekPickerRef} shortcut="Ctrl+Alt+1" disabled={hasDateDrafts || saving}
            options={distributionWeekOptions(week).map(value => ({ key: value, label: value, selected: value === week }))}
            onSelect={option => guardedWeekInput.setValue(option.key)} testId="distribution-week-picker" />
          <DistributionConfirmationSummary week={week} refreshKey={`${saving}-${fixLoading}`} />
          {tab !== 1 && <>
            <DistributionPicker label="품목그룹" value={selectedProdGroupLabel || '전체'} disabled={hasDateDrafts || saving || prodGroupsLoading}
              options={[{ key: '', label: '전체', selected: !prodGroup }, ...prodGroups.map(g => ({ key: g.key, label: g.label, selected: g.key === prodGroup }))]}
              onSelect={option => chooseProdGroup(option.key)} />
            <DistributionPicker label="품목" value={selectedProd?.ProdName || ''} triggerRef={productPickerRef}
              shortcut="Ctrl+Alt+2" disabled={hasDateDrafts || saving || loading} onOpen={ensureProductCatalog} maxResults={80}
              options={favoriteDistributionRows(sortDistributionProducts(mergeDistributionSearchCandidates(products, productCatalog)), favoriteKeys).filter(p => !favoritesOnly || favoriteKeys.has(Number(p.ProdKey))).map(p => ({
                key: p.ProdKey,
                label: p.ProdName || p.DisplayName || `#${p.ProdKey}`,
                hint: `${favoriteKeys.has(Number(p.ProdKey)) ? '★ ' : ''}#${p.ProdKey}`,
                selected: Number(p.ProdKey) === Number(selectedProd?.ProdKey), product: p,
              }))}
              onSelect={option => { setViewMode('prod'); selectProd(option.product); }} testId="distribution-product-picker" />
          </>}
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <button className="btn btn-secondary btn-sm" onClick={handleSearch} disabled={hasDateDrafts || saving}>🔍 조회</button>
            {tab !== 1 && <>
              <DistributionFixToggle week={week} prodGroup={prodGroup} prodKey={selectedProd?.ProdKey} refreshKey={`${saving}-${loading}`} disabled={hasDateDrafts || saving || spLoading || hasQuantityDraft()}
                onFixed={setIsFixed} onBusy={setFixLoading} onError={setErr} onComplete={data => { setSuccessMsg('✅ ' + data.message); handleSearch(); }} />
              <button className="btn btn-success btn-sm" onClick={() => handleSpDistribute('group')} disabled={hasDateDrafts || spLoading || fixLoading || isFixed || !week || !prodGroup} title="선택한 차수와 꽃/품목그룹만 dbo.usp_DistributeOne 경로로 일괄 분배합니다.">
                {spLoading ? '전산분배 중...' : '전산 선택꽃 일괄출고분배'}
              </button>
            </>}
            {viewMode === 'cust' && selectedCust && (
              <button type="button" className="btn btn-sm" data-ai-verify="add-panel-open" disabled={hasDateDrafts || saving || loading}
                onClick={() => { setAddPanel({ side: 0, group: pairGroupFilter || '', prodKey: null, unit: '', manager: '' }); setAddCustFilter(''); setAddProdFilter(''); loadAllCustomers(); ensureProductCatalog(); }}
                title="품종 → 품목 → 수량 버튼으로 이 업체 출고수량에 더합니다 (주문 없는 품목은 저장 시 주문등록 후 분배)">➕ 품목추가·수량추가</button>
            )}
            <button type="button" className="btn btn-secondary btn-sm" data-ai-verify="discard-drafts" onClick={discardDrafts} disabled={saving || !hasAnyDraft()}
              title="화면에서 바꾼 출고수량·단가·이동을 모두 되돌립니다 (DB 값 그대로)">↶ 변경 취소</button>
            <button ref={saveButtonRef} className="btn btn-primary btn-sm" aria-keyshortcuts="Control+S" onClick={viewMode === 'cust' ? handleSaveCustItems : handleSave} disabled={saveBlocked}>{saving ? '저장중... / Guardando' : '💾 저장 / Guardar'}</button>
            <button className="btn btn-secondary btn-sm" onClick={handleHistory}>📋 내역 조회 / Historial</button>
            <button className="btn btn-success btn-sm" onClick={() => handleExcelDownload()} disabled={excelDownloading}>
              {excelDownloading ? '다운로드중...' : '📥 엑셀 다운 / Excel'}
            </button>
            <button className="btn btn-sm" onClick={handleClose}>✖️ 닫기 / Cerrar</button>
          </div>
        </div>
        <div data-testid="distribution-week-buttons" style={{ padding: '3px 5px', background: 'var(--surface)', borderLeft: '1px solid var(--border)', borderRight: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text2)' }}>차수</span>
          {weekButtons.length === 0 && <span style={{ fontSize: 11, color: 'var(--text3)' }}>차수를 2026-44-01 형식으로 입력하면 앞뒤 차수 버튼이 나타납니다.</span>}
          {weekButtons.map(value => (
            <button key={value} type="button" data-ai-verify={`week-${value}`} aria-pressed={value === week}
              disabled={hasDateDrafts || saving} onClick={() => guardedWeekInput.setValue(value)} style={weekButtonStyle(value, value === week)}>
              {formatWeekDisplay(value)}
            </button>
          ))}
          {subWeekButtons.length > 0 && <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text2)', marginLeft: 8 }}>세부차수</span>}
          {subWeekButtons.map(value => (
            <button key={value} type="button" data-ai-verify={`subweek-${value.slice(-2)}`} aria-pressed={value === week}
              disabled={hasDateDrafts || saving} onClick={() => guardedWeekInput.setValue(value)}
              style={{ ...weekButtonStyle(value, value === week), padding: '3px 10px', fontSize: 12 }}>
              -{value.slice(-2)}
            </button>
          ))}
        </div>
        {tab !== 1 && <>
          <div data-testid="distribution-group-buttons" style={{ maxHeight: '22vh', overflowY: 'auto', alignContent: 'start', padding: '4px 5px', background: 'var(--surface)', borderLeft: '1px solid var(--border)', borderRight: '1px solid var(--border)', borderTop: '1px solid var(--border-t)', display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text2)' }}>국가</span>
            <button type="button" data-ai-verify="group-all" aria-pressed={!farmCountry} disabled={hasDateDrafts || saving || prodGroupsLoading}
              onClick={() => chooseFarmCountry('')} style={pickButtonStyle(!farmCountry, true)}>전체</button>
            <button type="button" className="btn btn-sm btn-secondary" data-ai-verify="group-view-all" aria-pressed={showAllProdGroups}
              onClick={() => setShowAllProdGroups(value => !value)}>{showAllProdGroups ? '★ 즐겨찾기만 보기' : '국가 전체 보기'}</button>
            {!showAllProdGroups && countryGroups.length === 0 && <span style={{ fontSize: 12, color: 'var(--text3)' }}>즐겨찾기한 국가가 없습니다. 「국가 전체 보기」에서 국가와 품종의 ☆를 눌러 추가하세요.</span>}
            {countryGroups.map(({ country, groups }) => (
              <div key={country} data-testid={`distribution-country-${country}`} role="group" aria-label={`${country} 품종`}
                style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap', width: '100%', padding: '5px 0', borderTop: '1px solid var(--border-t)' }}>
                <h3 style={{ margin: 0, fontSize: 12, fontWeight: 700, color: 'var(--text2)', display: 'inline-flex', alignItems: 'center', gap: 3, minWidth: 84 }}>
                  <button type="button" data-ai-verify={`country-select-${country}`} data-distribution-country-select aria-pressed={farmCountry === country} disabled={hasDateDrafts || saving || prodGroupsLoading}
                    onClick={() => chooseFarmCountry(country)} style={{ ...pickButtonStyle(farmCountry === country, true), padding: '3px 5px' }}>{country}</button>
                  <button type="button" data-ai-verify={`country-fav-${country}`} aria-label={`${country} 국가 즐겨찾기 ${selectedCountries.includes(country) ? '해제' : '추가'}`}
                    aria-pressed={selectedCountries.includes(country)} disabled={!accountId || favoritesPending || countryFavorite === undefined} onClick={() => toggleCountryFavorite(country)}
                    style={{ ...pickButtonStyle(false, true), padding: '2px 4px', color: selectedCountries.includes(country) ? '#d97706' : 'var(--text3)' }}>{selectedCountries.includes(country) ? '★' : '☆'}</button>
                </h3>
                <div data-testid={`country-family-buttons-${country}`} style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
                  {groups.filter(g => showAllProdGroups || favoriteGroups.some(f => f.groupKey === g.key)).map(g => <button type="button" key={g.key} data-ai-verify={`country-family-${g.key}`} aria-pressed={farmFamily === g.key} disabled={hasDateDrafts || saving || prodGroupsLoading}
                    onClick={() => chooseProdGroup(g.key)} style={pickButtonStyle(farmFamily === g.key, true)}>{g.flower}</button>)}
                </div>
              </div>
            ))}
          </div>
        </>}
        <DistributionScrollBar viewMode={viewMode} selectionKey={`${tab}-${selectedProd?.ProdKey}-${selectedCust?.CustKey}-${pairCust?.CustKey}-${custLoading}-${distLoading}-${pairLoading}-${extraLoading}-${extraPeers.length}-${showCustomerDates}-${custItems.length}-${custDist.length}`} />
      </div>
      <details style={{ padding: '1px 5px', fontSize: 11, color: 'var(--text3)', background: 'var(--surface)' }}><summary>단축키·입력 안내 · 출고일은 선택 세부차수만 수정</summary>
        단축키: Ctrl+Alt+1 차수 · Ctrl+Alt+2 품목 · Ctrl+Alt+3 업체 · Ctrl+Alt+4 수량 · Ctrl+Enter 조회 · 수량 Enter 다음 입력(마지막은 저장 버튼 이동) · Ctrl+S 수량·단가 저장 · 출고일은 실제 날짜순 · 단/송이 수량 입력. Enter 이동만으로 저장되지 않습니다.
      </details>
      {favoriteError && <div role="alert" style={{ padding: '4px 5px', background: 'var(--red-bg)', color: 'var(--red)' }}>즐겨찾기: {favoriteError}</div>}

      {err && <div style={{ padding: '4px 5px', background: 'var(--red-bg)', color: 'var(--red)', fontSize: 12, borderLeft: '3px solid var(--red)', flexShrink: 0 }}>⚠️ {err}</div>}
      {successMsg && <div style={{ padding: '4px 5px', background: 'var(--green-bg)', color: 'var(--green)', fontSize: 12, flexShrink: 0 }}>{successMsg}</div>}
      {saveLog.length > 0 && (
        <div data-testid="distribution-save-log" role="status" aria-live="polite" style={{ padding: '4px 5px', background: 'var(--surface)', borderLeft: '3px solid var(--blue)', fontSize: 11, color: 'var(--text2)', flexShrink: 0, maxHeight: 84, overflowY: 'auto' }}>
          <div style={{ fontWeight: 700, color: 'var(--text3)', marginBottom: 2 }}>저장 로그 (Ctrl+S / 저장 버튼)</div>
          {saveLog.map((line, index) => (
            <div key={`${index}-${line}`} style={{ color: line.includes('저장 실패') ? 'var(--red)' : line.includes('저장 생략') ? 'var(--text3)' : 'var(--green)' }}>• {line}</div>
          ))}
        </div>
      )}

      <DistributionAddItemModal
        addPanel={addPanel}
        setAddPanel={setAddPanel}
        selectedCust={selectedCust}
        week={week}
        pairSides={pairSides}
        products={products}
        productCatalog={productCatalog}
        addProdFilter={addProdFilter}
        setAddProdFilter={setAddProdFilter}
        addCustFilter={addCustFilter}
        setAddCustFilter={setAddCustFilter}
        matchItemName={matchDistributeItemName}
        custList={custList}
        allCustomers={allCustomers}
        pairCust={pairCust}
        extraPeers={extraPeers}
        selectPairCust={selectPairCust}
        selectExtraCust={selectExtraCust}
        hasDateDrafts={hasDateDrafts}
        saving={saving}
        loading={loading}
        saveBlocked={saveBlocked}
        fixedBadge={fixedBadge}
        handleSaveCustItems={handleSaveCustItems}
      />

      <DistributionSaveCompleteModal
        saveModal={saveModal}
        closeSaveModal={closeSaveModal}
        saveModalConfirmRef={saveModalConfirmRef}
      />

      <DistributionSpProgressModal
        spModal={spModal}
        setSpModal={setSpModal}
      />

      <div style={{ display: 'flex', flexWrap: 'wrap', borderBottom: '2px solid var(--border)', background: 'var(--surface)', flexShrink: 0 }}>
        {tabs.map((tabLabel, i) => (
          <button type="button" key={tabLabel} onClick={() => requestTab(i)} aria-current={tab === i ? 'page' : undefined}
            style={{ padding: '9px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer', color: tab === i ? 'var(--blue)' : 'var(--text3)', borderBottom: tab === i ? '2px solid var(--blue)' : '2px solid transparent', marginBottom: -2, whiteSpace: 'nowrap' }}>
            {['🚚', '🏬', '📅', '📊'][i]} {tabLabel}
          </button>
        ))}
        {(tab === 0 || tab === 1) && (
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6, padding: '0 14px', fontSize: 11, color: 'var(--text3)' }}>
            조회 기준: <b style={{ color: 'var(--blue)' }}>{viewMode === 'prod' ? '품목 기준 (품목 → 거래처별 분배)' : '업체 기준 (업체 → 품목별 분배)'}</b>
          </div>
        )}
      </div>

      {(tab === 0 || tab === 1) && (
        <div className="distribution-workspace-grid" style={{ flex: 1, minHeight: 0, overflow: 'hidden', gridTemplateRows: 'minmax(0,1fr)', display: 'grid', gridTemplateColumns: viewMode === 'prod' ? 'minmax(210px, 20%) minmax(0, 1fr)' : 'minmax(240px, 28%) minmax(0, 1fr)', alignItems: 'start', background: 'var(--surface)', border: '1px solid var(--border)', borderTop: 'none', borderRadius: '0 0 8px 8px' }}>
          {viewMode === 'prod' && (
            <div className="distribution-left-column" style={{ borderRight: '1px solid var(--border)', minWidth: 0 }}>
              <DistributionDateFilter label="품종·품목" value={farmDate} onChange={setFarmDate} dates={dateLookup.dates} loading={dateIndexLoading} error={dateIndexError} />
              <div style={{ padding: '8px 12px', background: '#F8FAFC', borderBottom: '1px solid var(--border)', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <input ref={productSearchRef} className="filter-input" placeholder="품목·국가·품종 검색 (전체 품목)" value={prodFilter} onFocus={ensureProductCatalog} onChange={e => { if (e.target.value.trim()) ensureProductCatalog(); setProdFilter(e.target.value); }} style={{ flex: 1, height: 28, fontSize: 12, minWidth: 0 }} />
                <button type="button" className={`btn btn-sm ${favoritesOnly ? 'btn-primary' : 'btn-secondary'}`}
                  aria-pressed={favoritesOnly} onClick={() => setFavoritesOnly(value => !value)}>★ 즐겨찾기만</button>
              </div>
              <div className="distribution-navigation-scroll" data-testid="distribution-product-navigation" tabIndex={0}>
                {loading ? <div className="skeleton" style={{ margin: 12, height: 300, borderRadius: 8 }}></div> : (
                  <DistributionProductTree rows={filteredProds} favoriteKeys={favoriteKeys} groupFavorites={favoriteGroups} selectedProd={selectedProd}
                    activeFamily={prodGroup} onSelect={selectProd} onFavorite={toggleProductFavorite} onGroupFavorite={toggleGroupFavorite} onFamilySelect={chooseProdGroup}
                    expanded={expandedFamilies} setExpanded={setExpandedFamilies} disabled={loading || saving} favoritesDisabled={!accountId || favoritesPending} search={prodFilter} />
                )}
              </div>
            </div>
          )}

          {viewMode === 'cust' && (
            <DistributionCustomerLeftNav
              customerDate={customerDate}
              setCustomerDate={setCustomerDate}
              dateLookup={dateLookup}
              dateIndexLoading={dateIndexLoading}
              dateIndexError={dateIndexError}
              dealerSearchRef={dealerSearchRef}
              custFilter={custFilter}
              setCustFilter={setCustFilter}
              loadAllCustomers={loadAllCustomers}
              showAllCustomers={showAllCustomers}
              toggleAllCustomers={toggleAllCustomers}
              hasDateDrafts={hasDateDrafts}
              saving={saving}
              loading={loading}
              custList={custList}
              filteredCustomers={filteredCustomers}
              pairSlot={pairSlot}
              setPairSlot={setPairSlot}
              setAppendCompany={setAppendCompany}
              appendCompany={appendCompany}
              selectedCust={selectedCust}
              pairCust={pairCust}
              pairLoading={pairLoading}
              extraLoading={extraLoading}
              extraPeers={extraPeers}
              clearPairCust={clearPairCust}
              clearExtraCust={clearExtraCust}
              chooseCustomerSlot={chooseCustomerSlot}
            />
          )}

          <div className="distribution-with-kakao" style={{ minWidth: 0 }}>
            <div className="distribution-detail-column" data-testid="distribution-details-panel">
              {viewMode === 'prod' && (
                <div className="distribution-detail-column">
                  <div style={{ padding: '8px 14px', background: '#F8FAFC', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text2)' }}>분배방식</span>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 13, cursor: 'pointer' }}>
                      <input type="radio" name="distMode" checked={distMode === 'ratio'} onChange={() => setDistMode('ratio')} /> 비율 분배
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 13, cursor: 'pointer' }}>
                      <input type="radio" name="distMode" checked={distMode === 'prior'} onChange={() => setDistMode('prior')} /> 우선 분배
                    </label>
                    <button className="btn btn-success btn-sm" onClick={() => handleSpDistribute('one')} disabled={hasDateDrafts || spLoading || !selectedProd || custDist.length === 0 || isFixed} title="nenova.exe 개별출고분배와 같은 dbo.usp_DistributeOne 경로로 저장합니다.">전산 개별출고분배</button>
                    <button className="btn btn-warning btn-sm" onClick={handleClearOne} disabled={hasDateDrafts || spLoading || !selectedProd || isFixed} title="nenova.exe 개별 초기화와 같은 dbo.usp_DistributeClear 경로로 이 품목의 출고분배를 DB에서 되돌립니다. (확정된 분배는 먼저 확정취소)">전산 개별 초기화</button>
                    <button className="btn btn-secondary btn-sm" onClick={autoDistribute} disabled={hasDateDrafts || saving || loading || !selectedProd || custDist.length === 0} title="화면 입력값만 자동 계산합니다. DB 반영은 상단 저장 버튼으로 적용됩니다.">화면 비율계산</button>
                    <button className="btn btn-secondary btn-sm" onClick={fillOrderQuantities} disabled={hasDateDrafts || saving || loading || !selectedProd || custDist.length === 0} title="주문수량을 출고수량 입력값으로 채웁니다. DB 반영은 상단 저장 버튼으로 적용됩니다.">주문수량 채우기</button>
                    <button className="btn btn-secondary btn-sm" disabled={hasDateDrafts || saving || loading} onClick={() => { const o = {}; custDist.forEach(c => { o[c.CustKey] = 0; }); setOutInputs(o); setOutQty(0); }}>🔄 개별 초기화</button>
                  </div>
                  {selectedProd && fixedScopeMap[Number(selectedProd.ProdKey)] && (
                    <div data-testid="distribution-fixed-status" style={{
                      padding: '4px 5px', fontSize: 12, fontWeight: 700, borderBottom: '1px solid var(--border)',
                      background: fixedScopeMap[Number(selectedProd.ProdKey)].fixed ? '#FEF2F2' : '#F0FDF4',
                      color: fixedScopeMap[Number(selectedProd.ProdKey)].fixed ? '#B91C1C' : '#15803D',
                    }}>
                      {fixedScopeMap[Number(selectedProd.ProdKey)].fixed
                        ? `🔒 확정됨 — ${fixedScopeMap[Number(selectedProd.ProdKey)].countryFlower || '이 품목군'} (${week}). 수량·단가 저장은 확정해제 → 저장 → 재확정 순서입니다. 출고일만 수정하면 확정 상태를 유지합니다.`
                        : `미확정 — ${fixedScopeMap[Number(selectedProd.ProdKey)].countryFlower || '이 품목군'} (${week})`}
                    </div>
                  )}
                  <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', background: 'var(--bg)', flexShrink: 0 }}>
                    {[['전차수 재고',previousStock,'var(--text2)'],['입고수량',inQty,'var(--blue)'],['출고수량',totalOutInput,'var(--text1)'],['잔량',remain,remain<0?'var(--red)':remain===0?'var(--green)':'var(--amber)']].map(([label, val, color]) => (
                      <div key={label} data-testid={label === '전차수 재고' ? 'distribution-previous-stock' : undefined} style={{ flex: 1, padding: '10px 16px', textAlign: 'center', borderRight: '1px solid var(--border)' }}>
                        <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 3 }}>{label}{selectedProd?.OutUnit ? ` (${selectedProd.OutUnit})` : ''}</div>
                        {label === '전차수 재고' && val == null
                          ? <div style={{ fontSize: 12, color: 'var(--text3)', padding: '5px 0' }}>{selectedProd ? '위 품종 버튼을 고르면 표시' : '—'}</div>
                          : <div style={{ fontSize: 20, fontWeight: 900, fontFamily: 'var(--mono)', color }}>{(val || 0).toFixed(2)}</div>}
                      </div>
                    ))}
                  </div>
                  <DistributionFarmCustomerPanel
                    selectedProd={selectedProd}
                    selectedFlower={selectedFlower}
                    distLoading={distLoading}
                    farmCustomerSearch={farmCustomerSearch}
                    setFarmCustomerSearch={setFarmCustomerSearch}
                    visibleFarmCustomerRows={visibleFarmCustomerRows}
                    custDistRows={custDistRows}
                    custDist={custDist}
                    prodAddOpen={prodAddOpen}
                    setProdAddOpen={setProdAddOpen}
                    loadAllCustomers={loadAllCustomers}
                    prodAddedCusts={prodAddedCusts}
                    setProdAddedCusts={setProdAddedCusts}
                    allCustomers={allCustomers}
                    prodAddFilter={prodAddFilter}
                    setProdAddFilter={setProdAddFilter}
                    prodAddManager={prodAddManager}
                    setProdAddManager={setProdAddManager}
                    outInputs={outInputs}
                    setOutInputs={setOutInputs}
                    totalOutInput={totalOutInput}
                    remain={remain}
                    hasDateDrafts={hasDateDrafts}
                    saving={saving}
                    loading={loading}
                    dateHeader={dateHeader}
                    dateButton={dateButton}
                    handleQuantityEnter={handleQuantityEnter}
                    selectedDistCust={selectedDistCust}
                    selectDistCustRow={selectDistCustRow}
                    farmLoading={farmLoading}
                    farmRows={farmRows}
                  />
                </div>
              )}

              {viewMode === 'cust' && (
                <DistributionCustomerWorkspacePanel
                  showCustomerDates={showCustomerDates}
                  setShowCustomerDates={setShowCustomerDates}
                  hasDateDrafts={hasDateDrafts}
                  pairCust={pairCust}
                  saving={saving}
                  pairLoading={pairLoading}
                  extraLoading={extraLoading}
                  setMoveOpen={setMoveOpen}
                  customerReadError={customerReadError}
                  pairReadError={pairReadError}
                  selectCust={selectCust}
                  selectPairCust={selectPairCust}
                  selectExtraCust={selectExtraCust}
                  selectedCust={selectedCust}
                  extraPeers={extraPeers}
                  custLoading={custLoading}
                  pairRows={pairRows}
                  pairSearchRows={pairSearchRows}
                  custItemFilter={custItemFilter}
                  setCustItemFilter={setCustItemFilter}
                  ensureProductCatalog={ensureProductCatalog}
                  pairGroupFilter={pairGroupFilter}
                  setPairGroupFilter={setPairGroupFilter}
                  pairSides={pairSides}
                  matchItemName={matchDistributeItemName}
                  customerDate={customerDate}
                  dateLookup={dateLookup}
                  products={products}
                  custItems={custItems}
                  custSearchRows={custSearchRows}
                  custEditInputs={custEditInputs}
                  setCustEditInputs={setCustEditInputs}
                  addCustSearchItem={addCustSearchItem}
                  fixedBadge={fixedBadge}
                  fixedCount={fixedCount}
                  loading={loading}
                  handleQuantityEnter={handleQuantityEnter}
                  dateHeader={dateHeader}
                  dateButton={dateButton}
                />
              )}
            </div>
            <DistributionKakaoFeed />
          </div>
        </div>
      )}

      <DistributionScheduleAndPivotTabs
        tab={tab}
        saveShipDayConfigs={saveShipDayConfigs}
        shipDaySaving={shipDaySaving}
        shipDayLoading={shipDayLoading}
        prodGroups={prodGroups}
        shipDayConfigs={shipDayConfigs}
        toggleShipDay={toggleShipDay}
        custList={custList}
        loadTab2Items={loadTab2Items}
        tab2CustKey={tab2CustKey}
        tab2Loading={tab2Loading}
        tab2Items={tab2Items}
        dateHeader={dateHeader}
        dateButton={dateButton}
        prodGroup={prodGroup}
        selectedProdGroupLabel={selectedProdGroupLabel}
        loadPivotRows={loadPivotRows}
        pivotLoading={pivotLoading}
        pivotRows={pivotRows}
      />

      {moveOpen && pairCust && <DistributionMoveDialog rows={pairRows} sides={pairSides()} onMove={moveDistributionQty} onClose={() => setMoveOpen(false)} />}
      <DistributionHistoryModal showHistory={showHistory} setShowHistory={setShowHistory} week={week} historyData={historyData} t={t} />
    </div>
  );
}
